import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { normalizePsycheVocabularyLabel } from "./repositories/psyche.js";

type TestApp = Awaited<ReturnType<typeof buildServer>>;

async function operatorCookie(app: TestApp) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: { host: "127.0.0.1:4317" }
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

async function issueToken(
  app: TestApp,
  cookie: string,
  label: string,
  scopes: string[],
  userId: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label,
      agentLabel: label,
      agentType: "assistant",
      trustLevel: "standard",
      autonomyMode: "approval_required",
      approvalMode: "approval_by_default",
      scopes,
      scopePolicy: { userIds: [userId], projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { token: { token: string } }).token.token;
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function withPsycheApp(run: (app: TestApp) => Promise<void>) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-psy-09-"));
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    devrageMetricSync: false,
    peerRuntime: false
  });
  try {
    await run(app);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

test("Psyche vocabulary normalization uses Unicode NFKC case folding", () => {
  const equivalentLabels = [
    ["ΟΣ", "οσ", "ος"],
    ["Straße", "STRASSE", "STRAẞE"],
    ["Café", "Cafe\u0301"],
    ["Ｆｅｅｄｂａｃｋ", "feedback"],
    ["\u13a0", "\uab70"],
    ["\u1fb3", "\u03b1\u03b9"],
    ["self\u00adworth", "selfworth"],
    ["feedback—rupture", "feedback rupture"],
    ["  feedback\t\nrupture  ", "feedback rupture"]
  ];
  for (const labels of equivalentLabels) {
    assert.equal(
      new Set(labels.map(normalizePsycheVocabularyLabel)).size,
      1,
      labels.join(" / ")
    );
  }
  assert.notEqual(
    normalizePsycheVocabularyLabel("Café"),
    normalizePsycheVocabularyLabel("Cafe")
  );
  assert.notEqual(
    normalizePsycheVocabularyLabel("ı"),
    normalizePsycheVocabularyLabel("i")
  );
});

test("Psyche vocabularies are owner-scoped, immutable when built in, and retry-safe", async () => {
  await withPsycheApp(async (app) => {
    const cookie = await operatorCookie(app);
    const settings = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: { cookie },
      payload: { security: { psycheAuthRequired: true } }
    });
    assert.equal(settings.statusCode, 200, settings.body);

    const psycheScopes = ["read", "write", "psyche.read", "psyche.write"];
    const ownerToken = await issueToken(
      app,
      cookie,
      "PSY-09 owner",
      psycheScopes,
      "user_operator"
    );
    const foreignToken = await issueToken(
      app,
      cookie,
      "PSY-09 foreign",
      psycheScopes,
      "user_forge_bot"
    );
    const ordinaryToken = await issueToken(
      app,
      cookie,
      "PSY-09 ordinary",
      ["read", "write"],
      "user_operator"
    );
    const psycheOnlyToken = await issueToken(
      app,
      cookie,
      "PSY-09 Psyche only",
      ["psyche.read", "psyche.write"],
      "user_operator"
    );

    const onboardingResponse = await app.inject({
      method: "GET",
      url: "/api/v1/agents/onboarding",
      headers: bearer(ownerToken)
    });
    assert.equal(onboardingResponse.statusCode, 200, onboardingResponse.body);
    const onboarding = onboardingResponse.json() as {
      onboarding: {
        entityCatalog: Array<{
          entityType: string;
          fieldGuide: Array<{ name: string }>;
          relationshipRules: string[];
          searchHints: string[];
        }>;
        entityConversationPlaybooks: Array<{
          focus: string;
          askSequence: string[];
        }>;
        toolInputCatalog: Array<{
          toolName: string;
          inputShape: string;
          notes: string[];
        }>;
      };
    };
    const eventCatalog = onboarding.onboarding.entityCatalog.find(
      (entry) => entry.entityType === "event_type"
    );
    const emotionCatalog = onboarding.onboarding.entityCatalog.find(
      (entry) => entry.entityType === "emotion_definition"
    );
    assert.deepEqual(
      eventCatalog?.fieldGuide.map((field) => field.name),
      ["label", "description", "userId"]
    );
    assert.deepEqual(
      emotionCatalog?.fieldGuide.map((field) => field.name),
      ["label", "description", "category", "userId"]
    );
    const eventGuidance = [
      ...(eventCatalog?.relationshipRules ?? []),
      ...(eventCatalog?.searchHints ?? [])
    ].join(" ");
    for (const expectation of [
      /customEventType.*own words/is,
      /read-only.*owner-scoped/is,
      /Unicode NFKC default case folding.*punctuation and whitespace normalization/is,
      /batch agent routes.*base read or write.*Psyche scope/is,
      /does not expose a separate aliases field/is
    ]) {
      assert.match(eventGuidance, expectation);
    }
    const emotionGuidance = [
      ...(emotionCatalog?.relationshipRules ?? []),
      ...(emotionCatalog?.searchHints ?? [])
    ].join(" ");
    for (const expectation of [
      /raw label/is,
      /read-only.*owner-scoped/is,
      /Unicode NFKC default case folding.*punctuation and whitespace normalization/is,
      /batch agent routes.*base read or write.*Psyche scope/is,
      /does not expose a separate aliases field/is
    ]) {
      assert.match(emotionGuidance, expectation);
    }
    for (const focus of ["event_type", "emotion_definition"]) {
      const playbook = onboarding.onboarding.entityConversationPlaybooks.find(
        (entry) => entry.focus === focus
      );
      assert.match(
        playbook?.askSequence.join(" ") ?? "",
        /Search existing.*batch CRUD/is
      );
    }
    const searchTool = onboarding.onboarding.toolInputCatalog.find(
      (entry) => entry.toolName === "forge_search_entities"
    );
    assert.match(searchTool?.inputShape ?? "", /userIds\?: string\[\]/);
    assert.match(
      searchTool?.notes.join(" ") ?? "",
      /searches\[\]\.userIds.*effective custom-vocabulary owner scope/is
    );
    assert.match(
      searchTool?.notes.join(" ") ?? "",
      /base read or write plus psyche\.read.*dedicated.*psyche\.read/is
    );
    const createTool = onboarding.onboarding.toolInputCatalog.find(
      (entry) => entry.toolName === "forge_create_entities"
    );
    assert.match(createTool?.inputShape ?? "", /idempotencyKey\?: string/);
    assert.match(
      createTool?.notes.join(" ") ?? "",
      /stable operations\[\]\.idempotencyKey.*exact retry.*hard deletion.*terminal/is
    );
    assert.match(
      createTool?.notes.join(" ") ?? "",
      /base write plus psyche\.write.*dedicated.*psyche\.write/is
    );

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/event-types",
      headers: bearer(ownerToken)
    });
    assert.equal(listResponse.statusCode, 200, listResponse.body);
    const builtIn = (
      listResponse.json() as {
        eventTypes: Array<{
          id: string;
          system: boolean;
          userId: string | null;
        }>;
      }
    ).eventTypes.find((entry) => entry.system);
    assert.ok(builtIn);
    const dedicatedBaseOnly = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/event-types",
      headers: bearer(ordinaryToken)
    });
    assert.equal(dedicatedBaseOnly.statusCode, 403, dedicatedBaseOnly.body);
    const dedicatedPsycheOnly = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/event-types",
      headers: bearer(psycheOnlyToken)
    });
    assert.equal(dedicatedPsycheOnly.statusCode, 200, dedicatedPsycheOnly.body);
    const batchPsycheOnly = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: bearer(psycheOnlyToken),
      payload: { searches: [{ entityTypes: ["event_type"], limit: 10 }] }
    });
    assert.equal(batchPsycheOnly.statusCode, 403, batchPsycheOnly.body);
    const foreignList = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/event-types",
      headers: bearer(foreignToken)
    });
    assert.equal(foreignList.statusCode, 200, foreignList.body);
    assert.match(foreignList.body, new RegExp(builtIn.id));

    const blockedExplicitSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: bearer(ordinaryToken),
      payload: {
        searches: [{ entityTypes: ["event_type"], limit: 10 }]
      }
    });
    assert.equal(
      blockedExplicitSearch.statusCode,
      403,
      blockedExplicitSearch.body
    );

    const implicitSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: bearer(ordinaryToken),
      payload: { searches: [{ query: builtIn.id, limit: 100 }] }
    });
    assert.equal(implicitSearch.statusCode, 200, implicitSearch.body);
    assert.doesNotMatch(implicitSearch.body, /"entityType":"event_type"/);

    const dedicatedWriteBaseOnly = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/event-types",
      headers: bearer(ordinaryToken),
      payload: { label: "Dedicated scope matrix", userId: "user_operator" }
    });
    assert.equal(
      dedicatedWriteBaseOnly.statusCode,
      403,
      dedicatedWriteBaseOnly.body
    );
    const dedicatedWritePsycheOnly = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/event-types",
      headers: bearer(psycheOnlyToken),
      payload: { label: "Dedicated scope matrix", userId: "user_operator" }
    });
    assert.equal(
      dedicatedWritePsycheOnly.statusCode,
      201,
      dedicatedWritePsycheOnly.body
    );
    const batchCreateOperation = {
      entityType: "emotion_definition",
      idempotencyKey: "psy-09-batch-scope",
      data: {
        label: "Batch scope matrix",
        category: "contract",
        userId: "user_operator"
      }
    };
    const batchWritePsycheOnly = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: bearer(psycheOnlyToken),
      payload: { operations: [batchCreateOperation] }
    });
    assert.equal(
      batchWritePsycheOnly.statusCode,
      403,
      batchWritePsycheOnly.body
    );
    const batchWriteBaseOnly = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: bearer(ordinaryToken),
      payload: { operations: [batchCreateOperation] }
    });
    assert.equal(batchWriteBaseOnly.statusCode, 403, batchWriteBaseOnly.body);
    const batchWriteCombined = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: bearer(ownerToken),
      payload: { operations: [batchCreateOperation] }
    });
    assert.equal(batchWriteCombined.statusCode, 200, batchWriteCombined.body);

    const createPayload = {
      label: "Feedback rupture",
      description:
        "A moment when feedback is experienced as relational rupture.",
      userId: "user_operator"
    };
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/event-types",
      headers: { ...bearer(ownerToken), "idempotency-key": "psy-09-event" },
      payload: createPayload
    });
    assert.equal(createResponse.statusCode, 201, createResponse.body);
    const eventType = (
      createResponse.json() as {
        eventType: { id: string; label: string; userId: string | null };
      }
    ).eventType;
    assert.equal(eventType.userId, "user_operator");

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/event-types",
      headers: { ...bearer(ownerToken), "idempotency-key": "psy-09-event" },
      payload: createPayload
    });
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(
      (replay.json() as { eventType: { id: string } }).eventType.id,
      eventType.id
    );

    const changedReplay = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/event-types",
      headers: { ...bearer(ownerToken), "idempotency-key": "psy-09-event" },
      payload: { ...createPayload, description: "Changed payload" }
    });
    assert.equal(changedReplay.statusCode, 409, changedReplay.body);
    assert.match(changedReplay.body, /idempotency_conflict/);

    const crossTypeKey = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/emotions",
      headers: { ...bearer(ownerToken), "idempotency-key": "psy-09-event" },
      payload: {
        label: "Same key, different vocabulary type",
        category: "contract",
        userId: "user_operator"
      }
    });
    assert.equal(crossTypeKey.statusCode, 201, crossTypeKey.body);

    const normalizedDuplicate = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/event-types",
      headers: bearer(ownerToken),
      payload: { ...createPayload, label: "feedback—rupture" }
    });
    assert.equal(normalizedDuplicate.statusCode, 409, normalizedDuplicate.body);
    assert.match(normalizedDuplicate.body, /psyche_vocabulary_duplicate/);

    const unsupportedAlias = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/event-types",
      headers: bearer(ownerToken),
      payload: { ...createPayload, label: "Separate label", aliases: ["Other"] }
    });
    assert.equal(unsupportedAlias.statusCode, 400, unsupportedAlias.body);

    const foreignDuplicate = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/event-types",
      headers: {
        ...bearer(foreignToken),
        "idempotency-key": "psy-09-event"
      },
      payload: { ...createPayload, userId: "user_forge_bot" }
    });
    assert.equal(foreignDuplicate.statusCode, 201, foreignDuplicate.body);

    const foreignRead = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/event-types/${eventType.id}`,
      headers: bearer(foreignToken)
    });
    assert.equal(foreignRead.statusCode, 404, foreignRead.body);

    const foreignUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/event-types/${eventType.id}`,
      headers: bearer(foreignToken),
      payload: { description: "Cross-owner write" }
    });
    assert.equal(foreignUpdate.statusCode, 404, foreignUpdate.body);

    for (const response of [
      await app.inject({
        method: "PATCH",
        url: `/api/v1/psyche/event-types/${builtIn.id}`,
        headers: bearer(ownerToken),
        payload: { label: "Changed built-in" }
      }),
      await app.inject({
        method: "DELETE",
        url: `/api/v1/psyche/event-types/${builtIn.id}`,
        headers: bearer(ownerToken)
      }),
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/update",
        headers: bearer(ownerToken),
        payload: {
          operations: [
            {
              entityType: "event_type",
              id: builtIn.id,
              patch: { label: "Changed by batch" }
            }
          ]
        }
      })
    ]) {
      assert.equal(response.statusCode, 409, response.body);
      assert.match(response.body, /system_vocabulary_immutable/);
    }

    const batchSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: bearer(ownerToken),
      payload: {
        searches: [
          {
            entityTypes: ["event_type"],
            query: "feedback rupture",
            userIds: ["user_operator"],
            limit: 20
          },
          {
            entityTypes: ["event_type"],
            ids: [builtIn.id],
            userIds: ["user_operator"],
            limit: 20
          }
        ]
      }
    });
    assert.equal(batchSearch.statusCode, 200, batchSearch.body);
    const batchResults = batchSearch.json() as {
      results: Array<{ matches: Array<{ id: string }> }>;
    };
    assert.deepEqual(
      batchResults.results[0]?.matches.map((item) => item.id),
      [eventType.id]
    );
    assert.deepEqual(
      batchResults.results[1]?.matches.map((item) => item.id),
      [builtIn.id]
    );

    const softDelete = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: bearer(ownerToken),
      payload: {
        operations: [{ entityType: "event_type", id: eventType.id }]
      }
    });
    assert.equal(softDelete.statusCode, 200, softDelete.body);
    assert.equal(
      (softDelete.json() as { results: Array<{ ok: boolean }> }).results[0]?.ok,
      true
    );

    const binnedReplay = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/event-types",
      headers: { ...bearer(ownerToken), "idempotency-key": "psy-09-event" },
      payload: createPayload
    });
    assert.equal(binnedReplay.statusCode, 409, binnedReplay.body);
    assert.match(
      binnedReplay.body,
      /psyche_vocabulary_idempotency_target_in_bin/
    );

    const restore = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: bearer(ownerToken),
      payload: {
        operations: [{ entityType: "event_type", id: eventType.id }]
      }
    });
    assert.equal(restore.statusCode, 200, restore.body);
    assert.equal(
      (restore.json() as { results: Array<{ ok: boolean }> }).results[0]?.ok,
      true
    );

    const hardDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/psyche/event-types/${eventType.id}?mode=hard`,
      headers: bearer(ownerToken)
    });
    assert.equal(hardDelete.statusCode, 200, hardDelete.body);
    const deletedReplay = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/event-types",
      headers: { ...bearer(ownerToken), "idempotency-key": "psy-09-event" },
      payload: createPayload
    });
    assert.equal(deletedReplay.statusCode, 409, deletedReplay.body);
    assert.match(
      deletedReplay.body,
      /psyche_vocabulary_idempotency_target_deleted/
    );
    const deletedChangedReplay = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/event-types",
      headers: { ...bearer(ownerToken), "idempotency-key": "psy-09-event" },
      payload: { ...createPayload, description: "Changed after deletion" }
    });
    assert.equal(
      deletedChangedReplay.statusCode,
      409,
      deletedChangedReplay.body
    );
    assert.match(deletedChangedReplay.body, /idempotency_conflict/);
    const terminalReceipt = getDatabase()
      .prepare(
        `SELECT owner_user_id, entity_type, entity_id, lifecycle_state
         FROM psyche_vocabulary_create_idempotency
         WHERE owner_user_id = ? AND entity_type = ? AND idempotency_key = ?`
      )
      .get("user_operator", "event_type", "psy-09-event") as {
      owner_user_id: string;
      entity_type: string;
      entity_id: string;
      lifecycle_state: string;
    };
    assert.deepEqual(
      { ...terminalReceipt },
      {
        owner_user_id: "user_operator",
        entity_type: "event_type",
        entity_id: eventType.id,
        lifecycle_state: "deleted"
      }
    );
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM event_types WHERE id = ?")
          .get(eventType.id) as { count: number }
      ).count,
      0
    );
  });
});

test("trigger reports preserve raw event and emotion wording across vocabulary changes", async () => {
  await withPsycheApp(async (app) => {
    const cookie = await operatorCookie(app);
    const token = await issueToken(
      app,
      cookie,
      "PSY-09 history",
      ["read", "write", "psyche.read", "psyche.write"],
      "user_operator"
    );
    const headers = bearer(token);

    const eventResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/event-types",
      headers,
      payload: { label: "Being corrected in public", userId: "user_operator" }
    });
    assert.equal(eventResponse.statusCode, 201, eventResponse.body);
    const eventTypeId = (eventResponse.json() as { eventType: { id: string } })
      .eventType.id;

    const emotionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/emotions",
      headers,
      payload: {
        label: "Exposed alarm",
        description: "A hot, visible sense of social danger.",
        category: "threat",
        userId: "user_operator"
      }
    });
    assert.equal(emotionResponse.statusCode, 201, emotionResponse.body);
    const emotionDefinitionId = (
      emotionResponse.json() as { emotion: { id: string } }
    ).emotion.id;

    const reportResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers,
      payload: {
        title: "Seminar correction",
        eventTypeId,
        customEventType: "",
        emotions: [
          {
            emotionDefinitionId,
            label: "My chest-drop alarm",
            intensity: 78,
            note: "My own words stay primary."
          }
        ],
        userId: "user_operator"
      }
    });
    assert.equal(reportResponse.statusCode, 201, reportResponse.body);
    const report = (
      reportResponse.json() as {
        report: {
          id: string;
          revision: number;
          customEventType: string;
          emotions: Array<{ label: string }>;
        };
      }
    ).report;
    assert.equal(report.customEventType, "Being corrected in public");
    assert.equal(report.emotions[0]?.label, "My chest-drop alarm");

    const eventUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/event-types/${eventTypeId}`,
      headers,
      payload: { label: "Public performance correction" }
    });
    assert.equal(eventUpdate.statusCode, 200, eventUpdate.body);
    const emotionUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/emotions/${emotionDefinitionId}`,
      headers,
      payload: { label: "Social threat activation" }
    });
    assert.equal(emotionUpdate.statusCode, 200, emotionUpdate.body);

    const afterRename = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/reports/${report.id}`,
      headers
    });
    assert.equal(afterRename.statusCode, 200, afterRename.body);
    const renamedReport = (
      afterRename.json() as {
        report: {
          customEventType: string;
          emotions: Array<{ label: string }>;
        };
      }
    ).report;
    assert.equal(renamedReport.customEventType, "Being corrected in public");
    assert.equal(renamedReport.emotions[0]?.label, "My chest-drop alarm");

    const softDelete = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers,
      payload: {
        operations: [
          { entityType: "event_type", id: eventTypeId },
          { entityType: "emotion_definition", id: emotionDefinitionId }
        ]
      }
    });
    assert.equal(softDelete.statusCode, 200, softDelete.body);

    const whileInBin = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/reports/${report.id}`,
      headers
    });
    assert.equal(whileInBin.statusCode, 200, whileInBin.body);
    const binnedReport = (
      whileInBin.json() as {
        report: {
          eventTypeId: string | null;
          customEventType: string;
          emotions: Array<{
            emotionDefinitionId: string | null;
            label: string;
          }>;
        };
      }
    ).report;
    assert.equal(binnedReport.eventTypeId, null);
    assert.equal(binnedReport.customEventType, "Being corrected in public");
    assert.equal(binnedReport.emotions[0]?.emotionDefinitionId, null);
    assert.equal(binnedReport.emotions[0]?.label, "My chest-drop alarm");

    const unrelatedUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/reports/${report.id}`,
      headers,
      payload: {
        expectedRevision: report.revision,
        title: "Seminar correction, reflected"
      }
    });
    assert.equal(unrelatedUpdate.statusCode, 200, unrelatedUpdate.body);
    const updatedWhileBinned = (
      unrelatedUpdate.json() as {
        report: {
          eventTypeId: string | null;
          emotions: Array<{ emotionDefinitionId: string | null }>;
        };
      }
    ).report;
    assert.equal(updatedWhileBinned.eventTypeId, null);
    assert.equal(updatedWhileBinned.emotions[0]?.emotionDefinitionId, null);

    const persistedReferences = getDatabase()
      .prepare(
        `SELECT event_type_id, emotions_json
         FROM trigger_reports
         WHERE id = ?`
      )
      .get(report.id) as { event_type_id: string; emotions_json: string };
    assert.equal(persistedReferences.event_type_id, eventTypeId);
    assert.equal(
      (
        JSON.parse(persistedReferences.emotions_json) as Array<{
          emotionDefinitionId: string | null;
        }>
      )[0]?.emotionDefinitionId,
      emotionDefinitionId
    );
    const managedLinks = getDatabase()
      .prepare(
        `SELECT relationship, target_entity_type, target_entity_id
         FROM entity_links
         WHERE source_entity_type = 'trigger_report'
           AND source_entity_id = ?
           AND relationship IN ('event_context', 'emotion_context')
         ORDER BY relationship`
      )
      .all(report.id);
    assert.deepEqual(
      managedLinks.map((link) => ({ ...link })),
      [
        {
          relationship: "emotion_context",
          target_entity_type: "emotion_definition",
          target_entity_id: emotionDefinitionId
        },
        {
          relationship: "event_context",
          target_entity_type: "event_type",
          target_entity_id: eventTypeId
        }
      ]
    );

    const restore = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers,
      payload: {
        operations: [
          { entityType: "event_type", id: eventTypeId },
          { entityType: "emotion_definition", id: emotionDefinitionId }
        ]
      }
    });
    assert.equal(restore.statusCode, 200, restore.body);

    const afterRestore = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/reports/${report.id}`,
      headers
    });
    assert.equal(afterRestore.statusCode, 200, afterRestore.body);
    const restoredReport = (
      afterRestore.json() as {
        report: {
          eventTypeId: string | null;
          customEventType: string;
          emotions: Array<{
            emotionDefinitionId: string | null;
            label: string;
          }>;
        };
      }
    ).report;
    assert.equal(restoredReport.eventTypeId, eventTypeId);
    assert.equal(restoredReport.customEventType, "Being corrected in public");
    assert.equal(
      restoredReport.emotions[0]?.emotionDefinitionId,
      emotionDefinitionId
    );
    assert.equal(restoredReport.emotions[0]?.label, "My chest-drop alarm");

    const hardDeleteEvent = await app.inject({
      method: "DELETE",
      url: `/api/v1/psyche/event-types/${eventTypeId}?mode=hard`,
      headers
    });
    assert.equal(hardDeleteEvent.statusCode, 200, hardDeleteEvent.body);
    const hardDeleteEmotion = await app.inject({
      method: "DELETE",
      url: `/api/v1/psyche/emotions/${emotionDefinitionId}?mode=hard`,
      headers
    });
    assert.equal(hardDeleteEmotion.statusCode, 200, hardDeleteEmotion.body);

    const afterDelete = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/reports/${report.id}`,
      headers
    });
    assert.equal(afterDelete.statusCode, 200, afterDelete.body);
    const preserved = (
      afterDelete.json() as {
        report: {
          eventTypeId: string | null;
          customEventType: string;
          emotions: Array<{
            emotionDefinitionId: string | null;
            label: string;
          }>;
        };
      }
    ).report;
    assert.equal(preserved.eventTypeId, null);
    assert.equal(preserved.customEventType, "Being corrected in public");
    assert.equal(preserved.emotions[0]?.emotionDefinitionId, null);
    assert.equal(preserved.emotions[0]?.label, "My chest-drop alarm");
  });
});

test("questionnaire storage has no event or emotion vocabulary dependency", async () => {
  await withPsycheApp(async () => {
    const questionnaireTables = getDatabase()
      .prepare(
        `SELECT name, sql
         FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'questionnaire_%'
         ORDER BY name`
      )
      .all() as Array<{ name: string; sql: string }>;

    assert.ok(questionnaireTables.length >= 4);
    for (const table of questionnaireTables) {
      assert.doesNotMatch(
        table.sql,
        /\bevent_types?\b|\bemotion_definitions?\b/i,
        `${table.name} must remain independent from reusable report vocabulary`
      );
    }
  });
});
