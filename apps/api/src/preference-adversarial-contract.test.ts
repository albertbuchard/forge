import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase, runInTransaction } from "./db.js";
import {
  createPreferenceContext,
  createPreferenceItem,
  refreshPreferenceWorkspace
} from "./repositories/preferences.js";

const dimensions = {
  novelty: 0,
  simplicity: 0,
  rigor: 0,
  aesthetics: 0,
  depth: 0,
  structure: 0,
  familiarity: 0,
  surprise: 0
};

async function issueOperatorSessionCookie(
  app: Awaited<ReturnType<typeof buildServer>>
) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: { host: "127.0.0.1:4317" }
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

async function issueScopedToken(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  userId: string,
  scopes: Array<"read" | "write"> = ["read", "write"],
  agentLabel = "Preference adversarial agent"
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label: `${agentLabel} token`,
      agentLabel,
      scopes,
      scopePolicy: { userIds: [userId], projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { token: { token: string } }).token.token;
}

function catalogPayload(userId: string, title: string) {
  return {
    userId,
    domain: "projects",
    title,
    description: "Owner-bound adversarial fixture.",
    scopeIn: "Owned options.",
    scopeOut: "Foreign options.",
    links: []
  };
}

function itemInput(label: string, domain: "projects" | "fashion" = "projects") {
  return {
    userId: "user_operator",
    domain,
    label,
    description: "",
    tags: [],
    featureWeights: dimensions,
    metadata: {},
    queueForCompare: false
  };
}

test("Settings Bin preference records and counts are owner-scoped", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-bin-scope-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const operatorToken = await issueScopedToken(app, cookie, "user_operator");
    const botToken = await issueScopedToken(app, cookie, "user_forge_bot");
    const created: Array<{
      userId: string;
      catalogId: string;
      itemId: string;
    }> = [];

    for (const [userId, title] of [
      ["user_operator", "Operator archived catalog"],
      ["user_forge_bot", "Bot archived catalog"]
    ] as const) {
      const catalogResponse = await app.inject({
        method: "POST",
        url: "/api/v1/preferences/catalogs",
        headers: { cookie },
        payload: catalogPayload(userId, title)
      });
      assert.equal(catalogResponse.statusCode, 201, catalogResponse.body);
      const catalogId = catalogResponse.json().catalog.id as string;
      const itemResponse = await app.inject({
        method: "POST",
        url: "/api/v1/preferences/catalog-items",
        headers: { cookie },
        payload: { catalogId, label: `${title} item` }
      });
      assert.equal(itemResponse.statusCode, 201, itemResponse.body);
      const itemId = itemResponse.json().item.id as string;

      const firstDelete = await app.inject({
        method: "DELETE",
        url: `/api/v1/preferences/catalog-items/${itemId}`,
        headers: { cookie }
      });
      const retryDelete = await app.inject({
        method: "DELETE",
        url: `/api/v1/preferences/catalog-items/${itemId}`,
        headers: { cookie }
      });
      assert.equal(firstDelete.statusCode, 200, firstDelete.body);
      assert.equal(retryDelete.statusCode, 200, retryDelete.body);
      assert.equal(firstDelete.json().item.archived, true);
      assert.deepEqual(retryDelete.json(), firstDelete.json());

      const catalogDelete = await app.inject({
        method: "DELETE",
        url: `/api/v1/preferences/catalogs/${catalogId}`,
        headers: { cookie }
      });
      assert.equal(catalogDelete.statusCode, 200, catalogDelete.body);
      created.push({ userId, catalogId, itemId });
    }

    for (const [userId, token] of [
      ["user_operator", operatorToken],
      ["user_forge_bot", botToken]
    ] as const) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/settings/bin",
        headers: { authorization: `Bearer ${token}` }
      });
      assert.equal(response.statusCode, 200, response.body);
      const bin = response.json().bin as {
        totalCount: number;
        countsByEntityType: Record<string, number>;
        records: Array<{ entityType: string; entityId: string }>;
      };
      const own = created.find((entry) => entry.userId === userId)!;
      const foreign = created.find((entry) => entry.userId !== userId)!;
      assert.ok(
        bin.records.some((record) => record.entityId === own.catalogId)
      );
      assert.ok(bin.records.some((record) => record.entityId === own.itemId));
      assert.ok(
        bin.records.every((record) => record.entityId !== foreign.catalogId)
      );
      assert.ok(
        bin.records.every((record) => record.entityId !== foreign.itemId)
      );
      assert.equal(bin.totalCount, bin.records.length);
      for (const entityType of [
        "preference_catalog",
        "preference_catalog_item"
      ]) {
        assert.equal(
          bin.countsByEntityType[entityType],
          bin.records.filter((record) => record.entityType === entityType)
            .length
        );
      }
    }
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("entity-backed preference enqueue applies Wiki ACLs without disclosing existence", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-source-acl-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const token = await issueScopedToken(app, cookie, "user_operator");
    const createSpace = async (
      label: string,
      visibility: "personal" | "shared"
    ) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/wiki/spaces",
        headers: { cookie },
        payload: { label, ownerUserId: "user_forge_bot", visibility }
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().space.id as string;
    };
    const createPage = async (spaceId: string, title: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/wiki/pages",
        headers: { cookie },
        payload: {
          spaceId,
          title,
          contentMarkdown: `# ${title}`,
          summary: `${title} summary`,
          links: []
        }
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().page.id as string;
    };
    const privatePageId = await createPage(
      await createSpace("Private foreign source", "personal"),
      "Private foreign page"
    );
    const sharedSpaceId = await createSpace("Shared foreign source", "shared");
    const sharedPageId = await createPage(sharedSpaceId, "Shared foreign page");
    const sharedPatchPageId = await createPage(
      sharedSpaceId,
      "Second shared foreign page"
    );
    const headers = { authorization: `Bearer ${token}` };
    const linkedCatalogPayload = (title: string, entityId: string) => ({
      ...catalogPayload("user_operator", title),
      links: [
        {
          entityType: "note",
          entityId,
          relationship: "related"
        }
      ]
    });
    const hiddenCatalogCreate = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers,
      payload: linkedCatalogPayload("Hidden catalog link", privatePageId)
    });
    const missingCatalogCreate = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers,
      payload: linkedCatalogPayload("Missing catalog link", "note_missing")
    });
    assert.equal(hiddenCatalogCreate.statusCode, 404);
    assert.deepEqual(hiddenCatalogCreate.json(), missingCatalogCreate.json());

    const readableCatalogCreate = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers,
      payload: linkedCatalogPayload("Readable catalog link", sharedPageId)
    });
    assert.equal(
      readableCatalogCreate.statusCode,
      201,
      readableCatalogCreate.body
    );
    const readableCatalogId = readableCatalogCreate.json().catalog.id as string;
    const hiddenCatalogPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/preferences/catalogs/${readableCatalogId}`,
      headers,
      payload: { links: linkedCatalogPayload("ignored", privatePageId).links }
    });
    const missingCatalogPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/preferences/catalogs/${readableCatalogId}`,
      headers,
      payload: {
        links: linkedCatalogPayload("ignored", "note_missing").links
      }
    });
    assert.equal(hiddenCatalogPatch.statusCode, 404);
    assert.deepEqual(hiddenCatalogPatch.json(), missingCatalogPatch.json());
    const missingCatalogPrivateLinkPatch = await app.inject({
      method: "PATCH",
      url: "/api/v1/preferences/catalogs/catalog_missing",
      headers,
      payload: { links: linkedCatalogPayload("ignored", privatePageId).links }
    });
    const missingCatalogSharedLinkPatch = await app.inject({
      method: "PATCH",
      url: "/api/v1/preferences/catalogs/catalog_missing",
      headers,
      payload: { links: linkedCatalogPayload("ignored", sharedPageId).links }
    });
    assert.equal(missingCatalogPrivateLinkPatch.statusCode, 404);
    assert.deepEqual(
      missingCatalogPrivateLinkPatch.json(),
      missingCatalogSharedLinkPatch.json(),
      "a missing catalog must be resolved before link ACLs to avoid a target-access oracle"
    );

    const batchCatalogPayload = (
      title: string,
      entityId: string,
      clientRef: string
    ) => ({
      atomic: true,
      operations: [
        {
          entityType: "preference_catalog",
          clientRef,
          data: linkedCatalogPayload(title, entityId)
        }
      ]
    });
    const hiddenBatchCreate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers,
      payload: batchCatalogPayload(
        "Hidden batch catalog link",
        privatePageId,
        "hidden"
      )
    });
    const missingBatchCreate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers,
      payload: batchCatalogPayload(
        "Missing batch catalog link",
        "note_missing",
        "missing"
      )
    });
    assert.equal(hiddenBatchCreate.statusCode, 404);
    assert.deepEqual(hiddenBatchCreate.json(), missingBatchCreate.json());

    const batchCatalogUpdatePayload = (entityId: string) => ({
      atomic: true,
      operations: [
        {
          entityType: "preference_catalog",
          id: readableCatalogId,
          patch: {
            links: linkedCatalogPayload("ignored", entityId).links
          }
        }
      ]
    });
    const hiddenBatchUpdate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers,
      payload: batchCatalogUpdatePayload(privatePageId)
    });
    const missingBatchUpdate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers,
      payload: batchCatalogUpdatePayload("note_missing")
    });
    assert.equal(hiddenBatchUpdate.statusCode, 404);
    assert.deepEqual(hiddenBatchUpdate.json(), missingBatchUpdate.json());
    const missingBatchPrivateLinkUpdate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers,
      payload: {
        ...batchCatalogUpdatePayload(privatePageId),
        operations: [
          {
            ...batchCatalogUpdatePayload(privatePageId).operations[0],
            id: "catalog_missing"
          }
        ]
      }
    });
    const missingBatchSharedLinkUpdate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers,
      payload: {
        ...batchCatalogUpdatePayload(sharedPageId),
        operations: [
          {
            ...batchCatalogUpdatePayload(sharedPageId).operations[0],
            id: "catalog_missing"
          }
        ]
      }
    });
    assert.equal(missingBatchPrivateLinkUpdate.statusCode, 404);
    assert.deepEqual(
      missingBatchPrivateLinkUpdate.json(),
      missingBatchSharedLinkUpdate.json()
    );

    const readableBatchUpdate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers,
      payload: batchCatalogUpdatePayload(sharedPatchPageId)
    });
    assert.equal(readableBatchUpdate.statusCode, 200, readableBatchUpdate.body);

    const payload = (entityId: string) => ({
      userId: "user_operator",
      domain: "projects",
      entityType: "note",
      entityId,
      tags: []
    });
    const hidden = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items/from-entity",
      headers,
      payload: payload(privatePageId)
    });
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items/from-entity",
      headers,
      payload: payload("note_missing")
    });
    assert.equal(hidden.statusCode, 404);
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(hidden.json(), missing.json());

    const readable = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items/from-entity",
      headers,
      payload: payload(sharedPageId)
    });
    assert.equal(readable.statusCode, 201, readable.body);
    assert.equal(readable.json().item.sourceEntityType, "note");
    assert.equal(readable.json().item.sourceEntityId, sharedPageId);

    const directPayload = (entityId: string, label: string) => ({
      ...itemInput(label),
      sourceEntityType: "note",
      sourceEntityId: entityId
    });
    const hiddenDirectCreate = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items",
      headers,
      payload: directPayload(privatePageId, "Hidden direct source")
    });
    const missingDirectCreate = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items",
      headers,
      payload: directPayload("note_missing", "Missing direct source")
    });
    assert.equal(hiddenDirectCreate.statusCode, 404);
    assert.deepEqual(hiddenDirectCreate.json(), missingDirectCreate.json());

    const readableDirectCreate = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items",
      headers,
      payload: directPayload(sharedPageId, "Readable direct source")
    });
    assert.equal(
      readableDirectCreate.statusCode,
      201,
      readableDirectCreate.body
    );

    const patchTarget = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items",
      headers,
      payload: itemInput("Direct source patch target")
    });
    assert.equal(patchTarget.statusCode, 201, patchTarget.body);
    const patchTargetId = patchTarget.json().item.id as string;
    const sourcePatch = (entityId: string) => ({
      sourceEntityType: "note",
      sourceEntityId: entityId
    });
    const hiddenDirectPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/preferences/items/${patchTargetId}`,
      headers,
      payload: sourcePatch(privatePageId)
    });
    const missingDirectPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/preferences/items/${patchTargetId}`,
      headers,
      payload: sourcePatch("note_missing")
    });
    assert.equal(hiddenDirectPatch.statusCode, 404);
    assert.deepEqual(hiddenDirectPatch.json(), missingDirectPatch.json());

    const readableDirectPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/preferences/items/${patchTargetId}`,
      headers,
      payload: sourcePatch(sharedPatchPageId)
    });
    assert.equal(readableDirectPatch.statusCode, 200, readableDirectPatch.body);
    assert.equal(
      readableDirectPatch.json().item.sourceEntityId,
      sharedPatchPageId
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("workspace reads stay pure while refresh owns initialization, provenance, ownership, and null clearing", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-pure-read-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const readToken = await issueScopedToken(
      app,
      cookie,
      "user_operator",
      ["read"],
      "Read-only preference agent"
    );
    const writeToken = await issueScopedToken(
      app,
      cookie,
      "user_operator",
      ["read", "write"],
      "Authenticated preference writer"
    );
    const workspaceUrl =
      "/api/v1/preferences/workspace?userId=user_operator&domain=fashion";
    const countRows = () =>
      getDatabase()
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM preference_profiles WHERE domain = 'fashion') AS profiles,
             (SELECT COUNT(*) FROM preference_snapshots
               INNER JOIN preference_profiles
                 ON preference_profiles.id = preference_snapshots.profile_id
               WHERE preference_profiles.domain = 'fashion') AS snapshots`
        )
        .get() as { profiles: number; snapshots: number };
    const before = countRows();
    const missing = await app.inject({
      method: "GET",
      url: workspaceUrl,
      headers: { authorization: `Bearer ${readToken}` }
    });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().code, "preferences_workspace_not_initialized");
    assert.deepEqual(countRows(), before);

    const forbiddenRefresh = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/workspace/refresh",
      headers: { authorization: `Bearer ${readToken}` },
      payload: { userId: "user_operator", domain: "fashion" }
    });
    assert.equal(forbiddenRefresh.statusCode, 403);
    assert.deepEqual(countRows(), before);

    const refresh = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/workspace/refresh",
      headers: {
        authorization: `Bearer ${writeToken}`,
        "x-forge-source": "agent",
        "x-forge-actor": "Spoofed writer"
      },
      payload: {
        userId: "user_operator",
        domain: "fashion",
        itemLimit: 10,
        itemOffset: 0,
        historyLimit: 5
      }
    });
    assert.equal(refresh.statusCode, 200, refresh.body);
    const workspace = refresh.json().workspace as {
      profile: { id: string };
      selectedContext: { id: string };
      contexts: Array<{ id: string }>;
    };
    const latestSnapshot = getDatabase()
      .prepare(
        `SELECT summary_metrics_json
         FROM preference_snapshots
         WHERE context_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`
      )
      .get(workspace.selectedContext.id) as { summary_metrics_json: string };
    const summary = JSON.parse(latestSnapshot.summary_metrics_json) as {
      refreshSource: string;
      refreshActor: string;
    };
    assert.equal(summary.refreshSource, "agent");
    assert.equal(summary.refreshActor, "Authenticated preference writer");

    const contextOwners = getDatabase()
      .prepare(
        `SELECT entity_id, user_id
         FROM entity_owners
         WHERE entity_type = 'preference_context'
           AND entity_id IN (${workspace.contexts.map(() => "?").join(", ")})`
      )
      .all(...workspace.contexts.map((context) => context.id)) as Array<{
      entity_id: string;
      user_id: string;
    }>;
    assert.equal(contextOwners.length, workspace.contexts.length);
    assert.ok(
      contextOwners.every((owner) => owner.user_id === "user_operator")
    );

    const scopedSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { authorization: `Bearer ${writeToken}` },
      payload: {
        searches: [
          {
            entityTypes: ["preference_context"],
            ids: workspace.contexts.map((context) => context.id),
            userIds: ["user_operator"],
            limit: 200
          }
        ]
      }
    });
    assert.equal(scopedSearch.statusCode, 200, scopedSearch.body);
    assert.equal(
      scopedSearch.json().results[0].matches.length,
      workspace.contexts.length
    );

    const itemResponse = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items",
      headers: { authorization: `Bearer ${writeToken}` },
      payload: itemInput("Manual override target", "fashion")
    });
    assert.equal(itemResponse.statusCode, 201, itemResponse.body);
    const itemId = itemResponse.json().item.id as string;
    const scorePatch = (
      manualStatus: string | null,
      manualScore: number | null,
      confidenceLock: number | null
    ) => ({
      userId: "user_operator",
      domain: "fashion",
      contextId: workspace.selectedContext.id,
      manualStatus,
      manualScore,
      confidenceLock
    });
    const set = await app.inject({
      method: "PATCH",
      url: `/api/v1/preferences/items/${itemId}/score`,
      headers: { authorization: `Bearer ${writeToken}` },
      payload: scorePatch("liked", 0.75, 0.9)
    });
    assert.equal(set.statusCode, 200, set.body);
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/preferences/items/${itemId}/score`,
      headers: { authorization: `Bearer ${writeToken}` },
      payload: scorePatch(null, null, null)
    });
    assert.equal(cleared.statusCode, 200, cleared.body);
    const scoreRow = getDatabase()
      .prepare(
        `SELECT manual_status, manual_score, confidence_lock
         FROM preference_item_scores
         WHERE context_id = ? AND item_id = ?`
      )
      .get(workspace.selectedContext.id, itemId) as {
      manual_status: string | null;
      manual_score: number | null;
      confidence_lock: number | null;
    };
    assert.deepEqual(
      { ...scoreRow },
      {
        manual_status: null,
        manual_score: null,
        confidence_lock: null
      }
    );

    const beforePureRead = countRows();
    const read = await app.inject({
      method: "GET",
      url: workspaceUrl,
      headers: { authorization: `Bearer ${readToken}` }
    });
    assert.equal(read.statusCode, 200, read.body);
    assert.deepEqual(countRows(), beforePureRead);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("judgment receipt, activity, and projection changes commit or roll back together", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-judgment-tx-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const token = await issueScopedToken(
      app,
      cookie,
      "user_operator",
      ["read", "write"],
      "Judgment transaction agent"
    );
    const workspace = refreshPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects"
    });
    const left = createPreferenceItem(itemInput("Atomic left"));
    const right = createPreferenceItem(itemInput("Atomic right"));
    const payload = {
      userId: "user_operator",
      domain: "projects",
      contextId: workspace.selectedContext.id,
      leftItemId: left.id,
      rightItemId: right.id,
      outcome: "left",
      strength: 1,
      reasonTags: ["adversarial"]
    };
    const key = "judgment-atomic-retry-v1";
    const countRows = () =>
      getDatabase()
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM pairwise_judgments
               WHERE left_item_id = ? AND right_item_id = ?) AS judgments,
             (SELECT COUNT(*) FROM preference_judgment_receipts
               WHERE user_id = 'user_operator' AND idempotency_key = ?) AS receipts,
             (SELECT COUNT(*) FROM activity_events
               WHERE event_type = 'preference_judgment_recorded'
                 AND json_extract(metadata_json, '$.leftItemId') = ?
                 AND json_extract(metadata_json, '$.rightItemId') = ?) AS activities,
             (SELECT COUNT(*) FROM preference_snapshots
               WHERE context_id = ?) AS snapshots`
        )
        .get(
          left.id,
          right.id,
          key,
          left.id,
          right.id,
          workspace.selectedContext.id
        ) as {
        judgments: number;
        receipts: number;
        activities: number;
        snapshots: number;
      };
    const before = countRows();
    getDatabase().exec(
      `CREATE TRIGGER fail_preference_snapshot_for_atomic_test
       BEFORE INSERT ON preference_snapshots
       BEGIN
         SELECT RAISE(ABORT, 'forced preference projection failure');
       END`
    );
    const failed = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/judgments",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": key
      },
      payload
    });
    assert.equal(failed.statusCode, 500);
    assert.deepEqual(countRows(), before);
    getDatabase().exec("DROP TRIGGER fail_preference_snapshot_for_atomic_test");

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/judgments",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": key
      },
      payload
    });
    const retry = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/judgments",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": key
      },
      payload
    });
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(retry.statusCode, 201, retry.body);
    assert.deepEqual(retry.json(), first.json());
    const committed = countRows();
    assert.equal(committed.judgments, 1);
    assert.equal(committed.receipts, 1);
    assert.equal(committed.activities, 1);
    assert.equal(committed.snapshots, before.snapshots + 1);

    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/judgments",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": key
      },
      payload: { ...payload, outcome: "right" }
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().code, "idempotency_conflict");
    assert.deepEqual(countRows(), committed);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("workspace pagination and model evidence coverage remain bounded per context", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-pref-coverage-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const base = refreshPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects"
    });
    const left = createPreferenceItem(itemInput("Coverage left"));
    const right = createPreferenceItem(itemInput("Coverage right"));
    const secondContext = createPreferenceContext({
      userId: "user_operator",
      domain: "projects",
      name: "Coverage comparison context",
      description: "",
      shareMode: "isolated",
      active: true,
      isDefault: false,
      decayDays: 90
    });
    const statement = getDatabase().prepare(
      `INSERT INTO pairwise_judgments (
         id, profile_id, context_id, user_id, left_item_id, right_item_id,
         outcome, strength, response_time_ms, source, reason_tags_json, created_at
       ) VALUES (?, ?, ?, 'user_operator', ?, ?, 'left', 1, NULL, 'system', '[]', ?)`
    );
    runInTransaction(() => {
      for (let index = 0; index < 1001; index += 1) {
        statement.run(
          `coverage_primary_${index}`,
          base.profile.id,
          base.selectedContext.id,
          left.id,
          right.id,
          `2026-07-15T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`
        );
      }
      statement.run(
        "coverage_secondary_0",
        base.profile.id,
        secondContext.id,
        left.id,
        right.id,
        "2026-07-15T13:00:00.000Z"
      );
    });

    const page = refreshPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects",
      contextId: base.selectedContext.id,
      itemLimit: 1,
      itemOffset: 1,
      historyLimit: 5
    });
    assert.deepEqual(page.presentation, {
      itemLimit: 1,
      itemOffset: 1,
      totalItems: 2,
      returnedItems: 1,
      hasMore: false,
      nextOffset: null,
      historyLimit: 5
    });
    assert.equal(page.scores.length, 1);
    assert.ok(page.map.length <= 1);
    assert.equal(page.history.judgments.length, 5);
    assert.equal(page.evidenceCoverage.totalJudgments, 1002);
    assert.equal(page.evidenceCoverage.consideredJudgments, 1001);
    assert.equal(page.evidenceCoverage.truncated, true);
    assert.deepEqual(
      page.evidenceCoverage.contexts.find(
        (context) => context.contextId === base.selectedContext.id
      ),
      {
        contextId: base.selectedContext.id,
        totalJudgments: 1001,
        consideredJudgments: 1000,
        truncated: true
      }
    );
    assert.deepEqual(
      page.evidenceCoverage.contexts.find(
        (context) => context.contextId === secondContext.id
      ),
      {
        contextId: secondContext.id,
        totalJudgments: 1,
        consideredJudgments: 1,
        truncated: false
      }
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
