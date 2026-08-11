import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase, runInTransaction } from "./db.js";
import {
  LOCAL_SEARCH_DEVELOPMENT_QUERIES,
  LOCAL_SEARCH_HELD_OUT_QUERIES,
  LOCAL_SEARCH_HELD_OUT_QUERY_SHA256,
  LOCAL_SEARCH_RELEVANCE_ALL_DOCUMENTS,
  LOCAL_SEARCH_RELEVANCE_DOCUMENTS,
  LOCAL_SEARCH_RELEVANCE_EDGES,
  LOCAL_SEARCH_RELEVANCE_OTHER_USER_TOMBSTONES,
  LOCAL_SEARCH_RELEVANCE_PARTITIONS,
  LOCAL_SEARCH_RELEVANCE_FIXTURE_VERSION,
  type LocalSearchRelevanceQuery
} from "./fixtures/local-search-relevance.js";
import { buildOpenApiDocument } from "./openapi.js";
import { setEntityOwner } from "./repositories/entity-ownership.js";
import { createNote } from "./repositories/notes.js";
import { createUser } from "./repositories/users.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import { resolveRouteSecurityContract } from "./security/route-contract.js";
import {
  LOCAL_SEARCH_ELIGIBLE_ENTITY_TYPES,
  LOCAL_SEARCH_MAX_DOCUMENT_BYTES,
  LOCAL_SEARCH_MAX_DOCUMENTS,
  LOCAL_SEARCH_MAX_EVIDENCE,
  LOCAL_SEARCH_MAX_RELATIONSHIPS,
  LOCAL_SEARCH_MAX_RESULTS,
  getLocalSearchSourceRecordCount,
  listSupplementalLocalSearchDocuments,
  searchLocalDocuments,
  type LocalSearchDocument,
  type LocalSearchResponse
} from "./services/local-search.js";
import { createNoteSchema } from "./types.js";

type RelevanceMetrics = {
  normalizedDiscountedCumulativeGainAt10: number;
  meanReciprocalRankAt10: number;
  recallAt10: number;
  unauthorizedResultCount: number;
  perFamilyRecall: Record<string, number>;
};

function percentile(samples: number[], fraction: number) {
  assert.ok(samples.length > 0);
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)]!;
}

function keyForResult(result: LocalSearchResponse["results"][number]) {
  return `${result.entityType}:${result.entityId}`;
}

function discountedGain(relevances: number[]) {
  return relevances.reduce(
    (total, relevance, index) =>
      total + (2 ** relevance - 1) / Math.log2(index + 2),
    0
  );
}

function measureRelevance(
  queries: LocalSearchRelevanceQuery[]
): RelevanceMetrics {
  let normalizedDiscountedCumulativeGain = 0;
  let reciprocalRank = 0;
  let recalled = 0;
  let relevant = 0;
  let unauthorizedResultCount = 0;
  const familyCounts = new Map<
    string,
    { recalled: number; relevant: number }
  >();

  for (const query of queries) {
    const response = searchLocalDocuments({
      query: query.query,
      documents: LOCAL_SEARCH_RELEVANCE_ALL_DOCUMENTS,
      edges: LOCAL_SEARCH_RELEVANCE_EDGES,
      scopeTombstones: LOCAL_SEARCH_RELEVANCE_OTHER_USER_TOMBSTONES,
      limit: 10
    });
    const resultKeys = response.results.map(keyForResult);
    const relevanceByKey = new Map(
      query.judgments.map((judgment) => [
        judgment.documentKey,
        judgment.relevance
      ])
    );
    const resultRelevances = resultKeys.map(
      (key) => relevanceByKey.get(key) ?? 0
    );
    const idealRelevances = query.judgments
      .map((judgment) => judgment.relevance)
      .filter((relevance) => relevance > 0)
      .sort((left, right) => right - left)
      .slice(0, 10);
    const idealGain = discountedGain(idealRelevances);
    normalizedDiscountedCumulativeGain +=
      idealGain === 0 ? 1 : discountedGain(resultRelevances) / idealGain;
    const firstRelevant = resultRelevances.findIndex(
      (relevance) => relevance > 0
    );
    reciprocalRank += firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1);

    for (const judgment of query.judgments) {
      if (judgment.relevance === 0) {
        if (resultKeys.includes(judgment.documentKey)) {
          unauthorizedResultCount += 1;
        }
        continue;
      }
      relevant += 1;
      const family = familyCounts.get(judgment.entityType) ?? {
        recalled: 0,
        relevant: 0
      };
      family.relevant += 1;
      if (resultKeys.includes(judgment.documentKey)) {
        recalled += 1;
        family.recalled += 1;
      }
      familyCounts.set(judgment.entityType, family);
    }
  }

  return {
    normalizedDiscountedCumulativeGainAt10:
      normalizedDiscountedCumulativeGain / queries.length,
    meanReciprocalRankAt10: reciprocalRank / queries.length,
    recallAt10: recalled / relevant,
    unauthorizedResultCount,
    perFamilyRecall: Object.fromEntries(
      [...familyCounts].map(([family, counts]) => [
        family,
        counts.recalled / counts.relevant
      ])
    )
  };
}

function createDensePerformanceDocuments(): LocalSearchDocument[] {
  return Array.from({ length: LOCAL_SEARCH_MAX_DOCUMENTS }, (_, index) => {
    const source =
      LOCAL_SEARCH_RELEVANCE_DOCUMENTS[
        index % LOCAL_SEARCH_RELEVANCE_DOCUMENTS.length
      ]!;
    return {
      ...source,
      key: `${source.key}:performance:${index}`,
      entityId: `${source.entityId}-performance-${index}`,
      fields: source.fields.map((field) => ({ ...field }))
    };
  });
}

function createDensePerformanceEdges(
  documents: LocalSearchDocument[]
): typeof LOCAL_SEARCH_RELEVANCE_EDGES {
  return Array.from({ length: LOCAL_SEARCH_MAX_RELATIONSHIPS }, (_, index) => ({
    id: `edge_performance_${index}`,
    source: documents[index % documents.length]!.key,
    target: documents[(index + 1) % documents.length]!.key,
    relationKind: "entity_link",
    family: "contextual" as const,
    label: "Related record",
    strength: 0.7,
    directional: true,
    structural: false
  }));
}

test("KNOW-09 freezes a representative, owner-partitioned relevance fixture", () => {
  assert.equal(
    LOCAL_SEARCH_RELEVANCE_FIXTURE_VERSION,
    "forge-local-search-relevance-v1"
  );
  assert.equal(LOCAL_SEARCH_DEVELOPMENT_QUERIES.length, 80);
  assert.equal(LOCAL_SEARCH_HELD_OUT_QUERIES.length, 40);
  assert.equal(LOCAL_SEARCH_RELEVANCE_DOCUMENTS.length, 31);
  assert.deepEqual(
    [
      ...new Set(
        LOCAL_SEARCH_RELEVANCE_DOCUMENTS.map((item) => item.entityType)
      )
    ].sort(),
    [...LOCAL_SEARCH_ELIGIBLE_ENTITY_TYPES].sort()
  );
  assert.deepEqual(
    LOCAL_SEARCH_RELEVANCE_PARTITIONS.allowed.map((item) => item.title),
    LOCAL_SEARCH_RELEVANCE_PARTITIONS.other.map((item) => item.title)
  );
  assert.ok(
    LOCAL_SEARCH_RELEVANCE_PARTITIONS.allowed.every(
      (item, index) =>
        item.key !== LOCAL_SEARCH_RELEVANCE_PARTITIONS.other[index]?.key
    )
  );

  const heldOutFamilyAppearances = new Map<string, number>();
  for (const query of LOCAL_SEARCH_HELD_OUT_QUERIES) {
    assert.ok(query.query.length > 0 && query.query.length <= 200);
    assert.ok(query.judgments.some((judgment) => judgment.relevance === 0));
    assert.ok(query.judgments.some((judgment) => judgment.relevance === 3));
    for (const judgment of query.judgments) {
      assert.ok(
        judgment.relevance >= 0 && judgment.relevance <= 3,
        `${query.id} has an out-of-range relevance label`
      );
      if (judgment.relevance > 0) {
        heldOutFamilyAppearances.set(
          judgment.entityType,
          (heldOutFamilyAppearances.get(judgment.entityType) ?? 0) + 1
        );
      }
    }
  }
  for (const entityType of LOCAL_SEARCH_ELIGIBLE_ENTITY_TYPES) {
    assert.ok(
      (heldOutFamilyAppearances.get(entityType) ?? 0) >= 2,
      `${entityType} needs at least two held-out query judgments`
    );
  }

  const checksum = createHash("sha256")
    .update(JSON.stringify(LOCAL_SEARCH_HELD_OUT_QUERIES))
    .digest("hex");
  assert.equal(checksum, LOCAL_SEARCH_HELD_OUT_QUERY_SHA256);

  const normalizedTokens = (value: string) =>
    new Set(value.toLocaleLowerCase("en").match(/[a-z0-9]+/g) ?? []);
  for (const development of LOCAL_SEARCH_DEVELOPMENT_QUERIES.slice(
    LOCAL_SEARCH_RELEVANCE_DOCUMENTS.length * 2
  )) {
    const developmentTokens = normalizedTokens(development.query);
    for (const heldOut of LOCAL_SEARCH_HELD_OUT_QUERIES) {
      const heldOutTokens = normalizedTokens(heldOut.query);
      const intersection = [...developmentTokens].filter((token) =>
        heldOutTokens.has(token)
      ).length;
      const union = new Set([...developmentTokens, ...heldOutTokens]).size;
      assert.ok(
        union === 0 || intersection / union < 0.8,
        `${development.id} overlaps ${heldOut.id}; development and held-out queries must be independently authored`
      );
    }
  }
});

test("KNOW-09 development queries meet the retrieval target before the held-out gate", (t) => {
  const metrics = measureRelevance(LOCAL_SEARCH_DEVELOPMENT_QUERIES);
  t.diagnostic(`KNOW-09 development retrieval ${JSON.stringify(metrics)}`);
  assert.ok(
    metrics.normalizedDiscountedCumulativeGainAt10 >= 0.85,
    JSON.stringify(metrics)
  );
  assert.ok(metrics.meanReciprocalRankAt10 >= 0.8, JSON.stringify(metrics));
  assert.ok(metrics.recallAt10 >= 0.85, JSON.stringify(metrics));
  assert.equal(metrics.unauthorizedResultCount, 0);
});

test("KNOW-09 applies tombstones before tokenization and returns exact bounded evidence", () => {
  const deletedKey = "note:note_restore";
  const scopedKey = "artifact:artifact_privacy_audit";
  const response = searchLocalDocuments({
    query: "checksum privacy",
    documents: LOCAL_SEARCH_RELEVANCE_DOCUMENTS,
    edges: LOCAL_SEARCH_RELEVANCE_EDGES,
    deletionTombstones: new Set([deletedKey]),
    scopeTombstones: new Set([scopedKey]),
    limit: LOCAL_SEARCH_MAX_RESULTS
  });
  assert.ok(
    !response.results.some((result) => keyForResult(result) === deletedKey)
  );
  assert.ok(
    !response.results.some((result) => keyForResult(result) === scopedKey)
  );
  assert.equal(response.coverage.deletionTombstonesApplied, 1);
  assert.equal(response.coverage.scopeTombstonesApplied, 1);
  assert.ok(response.results.length <= LOCAL_SEARCH_MAX_RESULTS);
  assert.ok(
    response.results.every(
      (result) =>
        result.evidence.length > 0 &&
        result.evidence.length <= LOCAL_SEARCH_MAX_EVIDENCE &&
        result.sourceHref.startsWith("/")
    )
  );

  const structural = searchLocalDocuments({
    query: "checksum decrypt",
    documents: LOCAL_SEARCH_RELEVANCE_DOCUMENTS,
    edges: LOCAL_SEARCH_RELEVANCE_EDGES,
    limit: 10
  });
  const relatedTask = structural.results.find(
    (result) => keyForResult(result) === "task:task_rotate_keys"
  );
  assert.ok(relatedTask);
  assert.ok(
    relatedTask.evidence.some(
      (evidence) =>
        evidence.kind === "relationship" &&
        evidence.relatedEntityId === "note_restore"
    )
  );

  const note = structural.results.find(
    (result) => keyForResult(result) === deletedKey
  );
  assert.ok(note);
  for (const evidence of note.evidence) {
    if (evidence.kind !== "text") continue;
    const source = LOCAL_SEARCH_RELEVANCE_DOCUMENTS.find(
      (document) => document.key === deletedKey
    )?.fields.find((field) => field.key === evidence.field)?.value;
    assert.ok(source);
    assert.ok(
      source.includes(evidence.excerpt.replace(/^…/, "").replace(/…$/, ""))
    );
  }
});

test("KNOW-09 maps normalized evidence positions back to exact raw excerpts", () => {
  const cases = [
    {
      query: "resume",
      body: `${"prefix     —     ".repeat(12)}the résumé is ready`,
      expected: "résumé"
    },
    {
      query: "punctuation",
      body: `${"alpha...beta!!!".repeat(12)} punctuation survives`,
      expected: "punctuation"
    },
    {
      query: "spacing",
      body: `${"word\t\t\t\n".repeat(30)}spacing remains exact`,
      expected: "spacing"
    }
  ];

  for (const [index, fixture] of cases.entries()) {
    const source = LOCAL_SEARCH_RELEVANCE_DOCUMENTS[0]!;
    const document: LocalSearchDocument = {
      ...source,
      key: `${source.key}:offset:${index}`,
      entityId: `${source.entityId}-offset-${index}`,
      fields: [
        {
          key: "source_text",
          label: "Source text",
          value: fixture.body,
          weight: 2
        }
      ]
    };
    const response = searchLocalDocuments({
      query: fixture.query,
      documents: [document]
    });
    const evidence = response.results[0]?.evidence[0];
    assert.equal(evidence?.kind, "text");
    assert.ok(evidence.kind === "text");
    assert.match(evidence.excerpt, new RegExp(fixture.expected, "u"));
    assert.ok(
      fixture.body.includes(
        evidence.excerpt.replace(/^…/, "").replace(/…$/, "")
      )
    );
  }
});

test("KNOW-09 rejects aggregate text bytes and authorized relationships before indexing", () => {
  const source = LOCAL_SEARCH_RELEVANCE_DOCUMENTS[0]!;
  const oversized: LocalSearchDocument = {
    ...source,
    fields: [
      {
        key: "source_text",
        label: "Source text",
        value: "x".repeat(LOCAL_SEARCH_MAX_DOCUMENT_BYTES + 1),
        weight: 1
      }
    ]
  };
  assert.throws(
    () => searchLocalDocuments({ query: "text", documents: [oversized] }),
    /bytes of authorized indexable record text/
  );

  const documents = createDensePerformanceDocuments();
  const edges = createDensePerformanceEdges(documents);
  assert.doesNotThrow(() =>
    searchLocalDocuments({ query: "restore", documents, edges, limit: 10 })
  );
  assert.throws(
    () =>
      searchLocalDocuments({
        query: "restore",
        documents,
        edges: [...edges, { ...edges[0]!, id: "edge_performance_overflow" }],
        limit: 10
      }),
    /authorized relationships/
  );
});

test("KNOW-09 keeps dense transient ranking within the frozen resource budget", (t) => {
  const rssBefore = process.memoryUsage().rss;
  const documents = createDensePerformanceDocuments();
  const serializedBytes = Buffer.byteLength(JSON.stringify(documents));
  assert.ok(
    serializedBytes <= 3 * 1024 * 1024,
    `${serializedBytes} transient bytes`
  );
  assert.ok(
    serializedBytes / documents.length <= 1_024,
    `${serializedBytes / documents.length} bytes per source record`
  );

  for (let index = 0; index < 5; index += 1) {
    searchLocalDocuments({
      query: "restore encrypted archive after failure",
      documents,
      limit: 10
    });
  }
  const samples: number[] = [];
  for (let index = 0; index < 40; index += 1) {
    const startedAt = performance.now();
    searchLocalDocuments({
      query: "restore encrypted archive after failure",
      documents,
      limit: 10
    });
    samples.push(performance.now() - startedAt);
  }
  const p95 = percentile(samples, 0.95);
  const rssDelta = Math.max(0, process.memoryUsage().rss - rssBefore);
  t.diagnostic(
    `KNOW-09 dense rank p95=${p95.toFixed(3)}ms; serialized=${serializedBytes}B; bytes/source=${(serializedBytes / documents.length).toFixed(3)}; RSS delta=${rssDelta}B`
  );
  assert.ok(p95 <= 35, `dense pure-rank p95 was ${p95.toFixed(3)} ms`);
  assert.ok(rssDelta <= 50 * 1024 * 1024, `RSS grew by ${rssDelta} bytes`);
});

test("KNOW-09 held-out retrieval passes once against the checksum-sealed fixture", (t) => {
  const metrics = measureRelevance(LOCAL_SEARCH_HELD_OUT_QUERIES);
  t.diagnostic(`KNOW-09 held-out retrieval ${JSON.stringify(metrics)}`);
  assert.ok(
    metrics.normalizedDiscountedCumulativeGainAt10 >= 0.85,
    JSON.stringify(metrics)
  );
  assert.ok(metrics.meanReciprocalRankAt10 >= 0.8, JSON.stringify(metrics));
  assert.ok(metrics.recallAt10 >= 0.85, JSON.stringify(metrics));
  assert.equal(metrics.unauthorizedResultCount, 0);
  assert.deepEqual(
    Object.keys(metrics.perFamilyRecall).sort(),
    [...LOCAL_SEARCH_ELIGIBLE_ENTITY_TYPES].sort()
  );
  for (const [family, recall] of Object.entries(metrics.perFamilyRecall)) {
    assert.ok(recall >= 0.6, `${family} held-out recall was ${recall}`);
  }
});

test("KNOW-09 publishes an operator-only route with fail-closed people scope and early capacity refusal", async (t) => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-know09-search-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    devrageMetricSync: false
  });
  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const allowedUser = createUser({
      kind: "human",
      handle: "know09-allowed",
      displayName: "KNOW-09 allowed",
      description: "",
      accentColor: "#336699"
    });
    const otherUser = createUser({
      kind: "human",
      handle: "know09-other",
      displayName: "KNOW-09 other",
      description: "",
      accentColor: "#663399"
    });
    const now = new Date().toISOString();
    runInTransaction(() => {
      const database = getDatabase();
      const insertProfile = database.prepare(
        `INSERT INTO preference_profiles (
           id, user_id, domain, model_version, created_at, updated_at
         ) VALUES (?, ?, 'general', 'know09', ?, ?)`
      );
      const insertCatalog = database.prepare(
        `INSERT INTO preference_catalogs (
           id, profile_id, domain, slug, title, description, source,
           archived, created_at, updated_at
         ) VALUES (?, ?, 'general', ?, ?, ?, 'custom', 0, ?, ?)`
      );
      const insertCatalogItem = database.prepare(
        `INSERT INTO preference_catalog_items (
           id, catalog_id, label, description, tags_json,
           feature_weights_json, position, archived, created_at, updated_at
         ) VALUES (?, ?, ?, ?, '[]', '{}', 0, 0, ?, ?)`
      );
      const insertContext = database.prepare(
        `INSERT INTO preference_contexts (
           id, profile_id, name, description, share_mode, active,
           is_default, decay_days, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'blended', 1, 0, 90, ?, ?)`
      );
      const insertPreferenceItem = database.prepare(
        `INSERT INTO preference_items (
           id, profile_id, label, description, tags_json,
           feature_weights_json, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, '[]', '{}', '{}', ?, ?)`
      );
      const insertLifeEvent = database.prepare(
        `INSERT INTO life_events (
           id, title, short_description, description, starts_at, ends_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertQuestionnaire = database.prepare(
        `INSERT INTO questionnaire_instruments (
           id, key, slug, title, description, source_class, availability,
           is_system, status, owner_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'custom', 'available', 0, 'active', ?, ?, ?)`
      );
      const insertSleep = database.prepare(
        `INSERT INTO health_sleep_sessions (
           id, external_uid, user_id, source, started_at, ended_at,
           annotations_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertWorkout = database.prepare(
        `INSERT INTO health_workout_sessions (
           id, external_uid, user_id, source, workout_type, started_at,
           ended_at, annotations_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'walking', ?, ?, ?, ?, ?)`
      );

      for (const [suffix, userId, secret] of [
        ["allowed", allowedUser.id, "citrine"],
        ["other", otherUser.id, "vermilion"]
      ] as const) {
        const profileId = `preference_profile_know09_${suffix}`;
        const catalogId = `preference_catalog_know09_${suffix}`;
        insertProfile.run(profileId, userId, now, now);
        insertCatalog.run(
          catalogId,
          profileId,
          `know09-${suffix}`,
          `${secret} preference catalog`,
          `${secret} catalog description`,
          now,
          now
        );
        insertCatalogItem.run(
          `preference_catalog_item_know09_${suffix}`,
          catalogId,
          `${secret} catalog choice`,
          `${secret} catalog item description`,
          now,
          now
        );
        insertContext.run(
          `preference_context_know09_${suffix}`,
          profileId,
          `${secret} preference context`,
          `${secret} context description`,
          now,
          now
        );
        insertPreferenceItem.run(
          `preference_item_know09_${suffix}`,
          profileId,
          `${secret} preference item`,
          `${secret} item description`,
          now,
          now
        );
        const lifeEventId = `life_event_know09_${suffix}`;
        insertLifeEvent.run(
          lifeEventId,
          `${secret} life event`,
          `${secret} milestone`,
          `${secret} life event description`,
          now,
          now,
          now,
          now
        );
        setEntityOwner("life_event", lifeEventId, userId);
        insertQuestionnaire.run(
          `questionnaire_know09_${suffix}`,
          `know09_${suffix}`,
          `know09-${suffix}`,
          `${secret} questionnaire`,
          `${secret} questionnaire description`,
          userId,
          now,
          now
        );
        insertSleep.run(
          `sleep_know09_${suffix}`,
          `sleep_external_know09_${suffix}`,
          userId,
          `${secret}_sleep_source`,
          now,
          now,
          JSON.stringify({ rawSecret: `${secret}_raw_sleep_payload` }),
          now,
          now
        );
        insertWorkout.run(
          `workout_know09_${suffix}`,
          `workout_external_know09_${suffix}`,
          userId,
          `${secret}_workout_source`,
          now,
          now,
          JSON.stringify({ rawSecret: `${secret}_raw_workout_payload` }),
          now,
          now
        );
      }
    });

    const scopedSupplemental = listSupplementalLocalSearchDocuments([
      allowedUser.id
    ]);
    const scopedKeys = new Set(scopedSupplemental.map((item) => item.key));
    for (const [entityType, idPrefix] of [
      ["life_event", "life_event"],
      ["preference_catalog", "preference_catalog"],
      ["preference_catalog_item", "preference_catalog_item"],
      ["preference_context", "preference_context"],
      ["preference_item", "preference_item"],
      ["questionnaire_instrument", "questionnaire"],
      ["sleep_session", "sleep"],
      ["workout_session", "workout"]
    ] as const) {
      assert.ok(
        scopedKeys.has(`${entityType}:${idPrefix}_know09_allowed`),
        `${entityType} must include the selected person's record`
      );
      assert.ok(
        !scopedKeys.has(`${entityType}:${idPrefix}_know09_other`),
        `${entityType} must exclude the other person's record`
      );
    }
    assert.ok(
      scopedSupplemental.some(
        (item) =>
          item.entityType === "questionnaire_instrument" &&
          !item.entityId.startsWith("questionnaire_know09_")
      ),
      "system questionnaires remain available in a selected-person scope"
    );
    const serializedSupplemental = JSON.stringify(scopedSupplemental);
    assert.doesNotMatch(serializedSupplemental, /raw_sleep_payload/);
    assert.doesNotMatch(serializedSupplemental, /raw_workout_payload/);

    const allowedNote = createNote(
      createNoteSchema.parse({
        kind: "evidence",
        title: "Shared research note",
        contentMarkdown: "Allowed citrine continuity evidence.",
        userId: allowedUser.id
      }),
      { source: "system", actor: "KNOW-09 readiness" }
    );
    const otherNote = createNote(
      createNoteSchema.parse({
        kind: "evidence",
        title: "Shared research note",
        contentMarkdown: "Private vermilion counterexample.",
        userId: otherUser.id
      }),
      { source: "system", actor: "KNOW-09 readiness" }
    );
    const deletedNote = createNote(
      createNoteSchema.parse({
        kind: "evidence",
        title: "Deleted cobalt record",
        contentMarkdown: "Deleted cobalt evidence must not be indexed.",
        userId: allowedUser.id
      }),
      { source: "system", actor: "KNOW-09 readiness" }
    );
    getDatabase()
      .prepare(
        `INSERT INTO deleted_entities (
           entity_type, entity_id, title, subtitle, deleted_at,
           deleted_by_actor, deleted_source, delete_reason, snapshot_json
         ) VALUES ('note', ?, ?, '', ?, 'KNOW-09 readiness', 'system', 'fixture', '{}')`
      )
      .run(deletedNote.id, deletedNote.title, now);

    const anonymous = await app.inject({
      method: "GET",
      url: "/api/v1/local-search?q=continuity"
    });
    assert.equal(anonymous.statusCode, 401);
    const anonymousMalformed = await app.inject({
      method: "GET",
      url: `/api/v1/local-search?q=${"x".repeat(201)}`
    });
    assert.equal(anonymousMalformed.statusCode, 401);

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: { cookie },
      payload: {
        label: "KNOW-09 read token",
        scopes: ["read"],
        scopePolicy: {
          userIds: [allowedUser.id],
          projectIds: [],
          tagIds: []
        }
      }
    });
    assert.equal(tokenResponse.statusCode, 201, tokenResponse.body);
    const token = (tokenResponse.json() as { token: { token: string } }).token
      .token;
    const tokenSearch = await app.inject({
      method: "GET",
      url: "/api/v1/local-search?q=continuity",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(tokenSearch.statusCode, 403);

    const missingScope = await app.inject({
      method: "GET",
      url: "/api/v1/local-search?q=continuity&userIds=user_missing",
      headers: { cookie }
    });
    assert.equal(missingScope.statusCode, 404);
    assert.deepEqual(missingScope.json(), {
      code: "local_search_scope_unavailable",
      error: "The selected people are unavailable.",
      statusCode: 404
    });

    const allowedSearch = await app.inject({
      method: "GET",
      url: `/api/v1/local-search?q=shared%20research%20note&userIds=${encodeURIComponent(allowedUser.id)}`,
      headers: { cookie }
    });
    assert.equal(allowedSearch.statusCode, 200, allowedSearch.body);
    const allowedPayload = allowedSearch.json() as LocalSearchResponse;
    assert.ok(
      allowedPayload.results.some(
        (result) => result.entityId === allowedNote.id
      )
    );
    assert.ok(
      !allowedPayload.results.some((result) => result.entityId === otherNote.id)
    );

    const foreignTerm = await app.inject({
      method: "GET",
      url: `/api/v1/local-search?q=vermilion&userIds=${encodeURIComponent(allowedUser.id)}`,
      headers: { cookie }
    });
    assert.equal(foreignTerm.statusCode, 200, foreignTerm.body);
    assert.ok(
      !(foreignTerm.json() as LocalSearchResponse).results.some(
        (result) => result.entityId === otherNote.id
      )
    );
    const deletedTerm = await app.inject({
      method: "GET",
      url: `/api/v1/local-search?q=cobalt&userIds=${encodeURIComponent(allowedUser.id)}`,
      headers: { cookie }
    });
    assert.equal(deletedTerm.statusCode, 200, deletedTerm.body);
    assert.ok(
      !(deletedTerm.json() as LocalSearchResponse).results.some(
        (result) => result.entityId === deletedNote.id
      )
    );

    for (let index = 0; index < 3; index += 1) {
      await app.inject({
        method: "GET",
        url: "/api/v1/local-search?q=Forge&limit=10",
        headers: { cookie }
      });
    }
    const routeSamples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const startedAt = performance.now();
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/local-search?q=Forge&limit=10",
        headers: { cookie }
      });
      routeSamples.push(performance.now() - startedAt);
      assert.equal(response.statusCode, 200, response.body);
    }
    const routeP95 = percentile(routeSamples, 0.95);
    t.diagnostic(
      `KNOW-09 local-search route p95=${routeP95.toFixed(3)}ms; measured=${routeSamples.length}; warmups=3; threshold=150ms`
    );
    assert.ok(
      routeP95 <= 150,
      `local-search route p95 was ${routeP95.toFixed(3)} ms`
    );

    const countBeforeCapacityFixture = getLocalSearchSourceRecordCount();
    const rowsToInsert = Math.max(
      0,
      LOCAL_SEARCH_MAX_DOCUMENTS - countBeforeCapacityFixture
    );
    runInTransaction(() => {
      const insert = getDatabase().prepare(
        `INSERT INTO tags (id, name, kind, color, description, created_at)
         VALUES (?, ?, 'category', '#336699', '', ?)`
      );
      for (let index = 0; index < rowsToInsert; index += 1) {
        insert.run(
          `tag_know09_capacity_${index}`,
          `KNOW-09 capacity ${index}`,
          now
        );
      }
    });
    assert.equal(getLocalSearchSourceRecordCount(), LOCAL_SEARCH_MAX_DOCUMENTS);
    const maximumEnvelope = await app.inject({
      method: "GET",
      url: "/api/v1/local-search?q=capacity",
      headers: { cookie }
    });
    assert.equal(maximumEnvelope.statusCode, 200, maximumEnvelope.body);
    const maximumPayload = maximumEnvelope.json() as LocalSearchResponse;
    assert.ok(
      maximumPayload.coverage.indexedDocuments > 0 &&
        maximumPayload.coverage.indexedDocuments <= LOCAL_SEARCH_MAX_DOCUMENTS
    );
    assert.ok(
      Buffer.byteLength(JSON.stringify(maximumPayload), "utf8") <
        LOCAL_SEARCH_MAX_DOCUMENT_BYTES
    );

    getDatabase()
      .prepare(
        `INSERT INTO tags (id, name, kind, color, description, created_at)
         VALUES (?, ?, 'category', '#336699', '', ?)`
      )
      .run("tag_know09_capacity_overflow", "KNOW-09 capacity overflow", now);
    const capacity = await app.inject({
      method: "GET",
      url: "/api/v1/local-search?q=capacity",
      headers: { cookie }
    });
    assert.equal(capacity.statusCode, 413, capacity.body);
    const capacityError = capacity.json() as {
      code: string;
      error: string;
    };
    assert.equal(capacityError.code, "local_search_capacity_exceeded");
    assert.match(capacityError.error, /750/);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("KNOW-09 OpenAPI and route security state the bounded operator contract", () => {
  const contract = resolveRouteSecurityContract({
    method: "GET",
    routePath: "/api/v1/local-search"
  });
  assert.equal(contract.securityClass, "protected");
  assert.equal(contract.allowsAnonymousAdmission, false);
  assert.deepEqual(contract.acceptedLegacyScopes, []);

  const document = buildOpenApiDocument() as {
    components?: { schemas?: Record<string, unknown> };
    paths?: Record<string, Record<string, unknown>>;
  };
  assert.ok(document.components?.schemas?.LocalSearchResponse);
  const operation = document.paths?.["/api/v1/local-search"]?.get as {
    security?: unknown;
    description?: string;
  };
  assert.deepEqual(operation.security, [{ operatorSession: [] }]);
  assert.match(operation.description ?? "", /does not use embeddings/i);
  assert.match(operation.description ?? "", /750 source records/);
  assert.match(operation.description ?? "", /3 MiB/);
  assert.match(operation.description ?? "", /750 authorized relationships/);
});
