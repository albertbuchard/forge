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
  RELATIONSHIP_PROPOSAL_DEVELOPMENT_CASES,
  RELATIONSHIP_PROPOSAL_FIXTURE_VERSION,
  RELATIONSHIP_PROPOSAL_HELD_OUT_CASES,
  RELATIONSHIP_PROPOSAL_HELD_OUT_SHA256,
  type RelationshipProposalFixtureCase
} from "./fixtures/relationship-proposal-relevance.js";
import { buildOpenApiDocument } from "./openapi.js";
import { setEntityOwner } from "./repositories/entity-ownership.js";
import { createAgentToken } from "./repositories/settings.js";
import { createUser, getDefaultUser } from "./repositories/users.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import { resolveRouteSecurityContract } from "./security/route-contract.js";
import {
  RELATIONSHIP_PROPOSAL_GENERATOR_ID,
  RELATIONSHIP_PROPOSAL_GENERATOR_VERSION,
  RELATIONSHIP_PROPOSAL_MAX_COMPARISONS,
  RELATIONSHIP_PROPOSAL_MAX_PENDING_PER_OWNER,
  RELATIONSHIP_PROPOSAL_MAX_SOURCE_DOCUMENTS,
  generateRelationshipProposalCandidates,
  type RelationshipProposalSourceDocument
} from "./services/relationship-proposals.js";
import {
  createAgentTokenSchema,
  type RelationshipProposal,
  type RelationshipProposalRelation
} from "./types.js";

type TestApp = Awaited<ReturnType<typeof buildServer>>;

async function withTestServer(
  run: (app: TestApp, cookie: string) => Promise<void>,
  options: { seedDemoData?: boolean } = {}
) {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-relationship-proposals-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: options.seedDemoData ?? true,
    devrageMetricSync: false
  });
  const cookie = issueTestOperatorSessionCookie(app);
  try {
    await run(app, cookie);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function percentile(samples: number[], fraction: number) {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)]!;
}

function metricKey(input: {
  source: { entityType: string; entityId: string };
  target: { entityType: string; entityId: string };
  relationship: string;
}) {
  return `${input.source.entityType}:${input.source.entityId}>${input.target.entityType}:${input.target.entityId}:${input.relationship}`;
}

function expectedKey(fixture: RelationshipProposalFixtureCase) {
  return fixture.expected
    ? `${fixture.expected.sourceKey}>${fixture.expected.targetKey}:${fixture.expected.relationship}`
    : null;
}

function measureFixture(cases: RelationshipProposalFixtureCase[]) {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let unauthorizedCandidateCount = 0;
  const eligibleRecords = new Set<string>();
  const coveredRecords = new Set<string>();
  const byKind = new Map<
    RelationshipProposalRelation,
    { tp: number; fp: number; fn: number; eligible: Set<string>; covered: Set<string> }
  >();

  for (const fixture of cases) {
    const result = generateRelationshipProposalCandidates({
      ownerUserId: "fixture-owner",
      documents: [fixture.source, fixture.target]
    });
    unauthorizedCandidateCount += result.unauthorizedCandidateCount;
    const expected = expectedKey(fixture);
    const predictions = result.candidates.map(metricKey);
    const correct = expected !== null && predictions.includes(expected);
    if (expected && fixture.expected) {
      const kind = fixture.expected.relationship;
      const kindCounts = byKind.get(kind) ?? {
        tp: 0,
        fp: 0,
        fn: 0,
        eligible: new Set<string>(),
        covered: new Set<string>()
      };
      const endpointKeys = [fixture.expected.sourceKey, fixture.expected.targetKey];
      endpointKeys.forEach((key) => {
        eligibleRecords.add(key);
        kindCounts.eligible.add(key);
      });
      if (correct) {
        truePositives += 1;
        kindCounts.tp += 1;
        endpointKeys.forEach((key) => {
          coveredRecords.add(key);
          kindCounts.covered.add(key);
        });
      } else {
        falseNegatives += 1;
        kindCounts.fn += 1;
      }
      const wrongPredictions = predictions.filter((key) => key !== expected).length;
      falsePositives += wrongPredictions;
      kindCounts.fp += wrongPredictions;
      byKind.set(kind, kindCounts);
    } else {
      falsePositives += predictions.length;
    }
    assert.equal(
      result.candidates.some(
        (candidate) =>
          candidate.source.authorized === false ||
          candidate.target.authorized === false ||
          candidate.source.deleted === true ||
          candidate.target.deleted === true
      ),
      false,
      `${fixture.id} returned an unauthorized or deleted endpoint`
    );
  }

  const precision =
    truePositives + falsePositives === 0
      ? 1
      : truePositives / (truePositives + falsePositives);
  const recall = truePositives / (truePositives + falseNegatives);
  const coverage = coveredRecords.size / eligibleRecords.size;
  return {
    precision,
    recall,
    coverage,
    unauthorizedCandidateCount,
    byKind: Object.fromEntries(
      [...byKind].map(([kind, counts]) => [
        kind,
        {
          precision:
            counts.tp + counts.fp === 0
              ? 1
              : counts.tp / (counts.tp + counts.fp),
          recall: counts.tp / (counts.tp + counts.fn),
          coverage: counts.covered.size / counts.eligible.size
        }
      ])
    ) as Record<
      RelationshipProposalRelation,
      { precision: number; recall: number; coverage: number }
    >
  };
}

function assertAcceptanceMetrics(metrics: ReturnType<typeof measureFixture>) {
  assert.ok(metrics.precision >= 0.95, JSON.stringify(metrics));
  assert.ok(metrics.recall >= 0.7, JSON.stringify(metrics));
  assert.ok(metrics.coverage >= 0.6, JSON.stringify(metrics));
  assert.equal(metrics.unauthorizedCandidateCount, 0, JSON.stringify(metrics));
  for (const kind of ["supports", "informs", "related"] as const) {
    assert.ok(metrics.byKind[kind].precision >= 0.95, JSON.stringify(metrics));
    assert.ok(metrics.byKind[kind].recall >= 0.7, JSON.stringify(metrics));
    assert.ok(metrics.byKind[kind].coverage >= 0.6, JSON.stringify(metrics));
  }
}

function insertPendingProposal(input: {
  id: string;
  ownerUserId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationship?: RelationshipProposalRelation;
  revision?: number;
  expiresAt?: string;
}) {
  const now = "2026-08-09T12:00:00.000Z";
  getDatabase()
    .prepare(
      `INSERT INTO relationship_proposals (
         id, owner_user_id, source_entity_type, source_entity_id,
         target_entity_type, target_entity_id, canonical_pair_key,
         relationship, evidence_json, explanation, confidence,
         generator_id, generator_version, generation_epoch, status,
         revision, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.ownerUserId,
      input.sourceType,
      input.sourceId,
      input.targetType,
      input.targetId,
      [
        `${input.sourceType}:${input.sourceId}`,
        `${input.targetType}:${input.targetId}`
      ]
        .sort()
        .join("\u001f"),
      input.relationship ?? "supports",
      JSON.stringify([
        {
          sourceField: "Title",
          targetField: "Title",
          matchedTerms: ["bounded", "review"]
        }
      ]),
      "The records share bounded review terms.",
      0.94,
      RELATIONSHIP_PROPOSAL_GENERATOR_ID,
      RELATIONSHIP_PROPOSAL_GENERATOR_VERSION,
      input.id,
      input.revision ?? 1,
      input.expiresAt ?? "2099-08-16T12:00:00.000Z",
      now,
      now
    );
}

test("SYS-20 freezes 80 development and 40 independently sealed held-out pairs", () => {
  assert.equal(RELATIONSHIP_PROPOSAL_FIXTURE_VERSION, "forge-relationship-proposals-v1");
  assert.equal(RELATIONSHIP_PROPOSAL_DEVELOPMENT_CASES.length, 80);
  assert.equal(RELATIONSHIP_PROPOSAL_HELD_OUT_CASES.length, 40);
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(RELATIONSHIP_PROPOSAL_HELD_OUT_CASES))
      .digest("hex"),
    RELATIONSHIP_PROPOSAL_HELD_OUT_SHA256
  );
  const developmentVocabulary = new Set(
    RELATIONSHIP_PROPOSAL_DEVELOPMENT_CASES.flatMap((fixture) => [
      fixture.source.title,
      fixture.target.title
    ])
  );
  assert.ok(
    RELATIONSHIP_PROPOSAL_HELD_OUT_CASES.every(
      (fixture) =>
        !developmentVocabulary.has(fixture.source.title) &&
        !developmentVocabulary.has(fixture.target.title)
    )
  );
  for (const partition of [
    RELATIONSHIP_PROPOSAL_DEVELOPMENT_CASES,
    RELATIONSHIP_PROPOSAL_HELD_OUT_CASES
  ]) {
    for (const kind of ["supports", "informs", "related"] as const) {
      assert.ok(
        partition.filter((fixture) => fixture.expected?.relationship === kind)
          .length >= 10
      );
    }
    assert.ok(partition.some((fixture) => fixture.negativeKind === "same_title"));
    assert.ok(partition.some((fixture) => fixture.negativeKind === "deleted"));
    assert.ok(partition.some((fixture) => fixture.negativeKind === "unauthorized"));
    assert.ok(partition.some((fixture) => fixture.negativeKind === "unrelated"));
  }
});

test("SYS-20 development pairs meet the frozen candidate thresholds", () => {
  assertAcceptanceMetrics(measureFixture(RELATIONSHIP_PROPOSAL_DEVELOPMENT_CASES));
});

test("SYS-20 sealed held-out pairs meet aggregate and every enabled-kind gate", () => {
  const metrics = measureFixture(RELATIONSHIP_PROPOSAL_HELD_OUT_CASES);
  assertAcceptanceMetrics(metrics);
  process.stdout.write(`SYS-20 held-out metrics ${JSON.stringify(metrics)}\n`);
});

test("SYS-20 migration is additive, retry-safe, bounded, and rejects invalid rows atomically", async () => {
  await withTestServer(async () => {
    const columns = getDatabase()
      .prepare("SELECT name FROM pragma_table_info('relationship_proposals')")
      .all() as Array<{ name: string }>;
    assert.ok(columns.some((column) => column.name === "owner_user_id"));
    assert.ok(columns.some((column) => column.name === "revision"));
    assert.ok(columns.some((column) => column.name === "expires_at"));
    const before = (
      getDatabase()
        .prepare("SELECT count(*) AS count FROM relationship_proposals")
        .get() as { count: number }
    ).count;
    assert.throws(() =>
      runInTransaction(() => {
        getDatabase()
          .prepare(
            `INSERT INTO relationship_proposals (
               id, owner_user_id, source_entity_type, source_entity_id,
               target_entity_type, target_entity_id, canonical_pair_key,
               relationship, evidence_json, explanation, confidence,
               generator_id, generator_version, generation_epoch,
               expires_at, created_at, updated_at
             ) VALUES ('invalid', ?, 'task', 'same', 'task', 'same',
                       'task:same', 'related', '[]', 'invalid', 2,
                       'test', '1', 'one', ?, ?, ?)`
          )
          .run(
            getDefaultUser().id,
            "2099-01-01T00:00:00.000Z",
            "2026-08-09T00:00:00.000Z",
            "2026-08-09T00:00:00.000Z"
          );
      })
    );
    const after = (
      getDatabase()
        .prepare("SELECT count(*) AS count FROM relationship_proposals")
        .get() as { count: number }
    ).count;
    assert.equal(after, before);
  });
});

test("SYS-20 operator routes keep proposals owner-scoped and write no link before acceptance", async () => {
  await withTestServer(async (app, cookie) => {
    const owner = getDefaultUser();
    const other = createUser({
      kind: "human",
      handle: "proposal-other",
      displayName: "Proposal other",
      description: "",
      accentColor: "#aabbcc"
    });
    const goal = getDatabase()
      .prepare("SELECT id FROM goals ORDER BY id LIMIT 1")
      .get() as { id: string };
    const task = getDatabase()
      .prepare("SELECT id FROM tasks ORDER BY id LIMIT 1")
      .get() as { id: string };
    getDatabase()
      .prepare("UPDATE goals SET title = ?, description = ? WHERE id = ?")
      .run("Violet compass milestone", "Reach the violet compass milestone", goal.id);
    getDatabase()
      .prepare("UPDATE tasks SET title = ?, description = ? WHERE id = ?")
      .run("Prepare violet compass milestone", "Advance violet compass milestone", task.id);
    setEntityOwner("goal", goal.id, owner.id);
    setEntityOwner("task", task.id, owner.id);

    const linksBefore = (
      getDatabase().prepare("SELECT count(*) AS count FROM entity_links").get() as {
        count: number;
      }
    ).count;
    const generated = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-proposals/generate",
      headers: { cookie },
      payload: { ownerUserId: owner.id }
    });
    assert.equal(generated.statusCode, 200, generated.body);
    const payload = generated.json() as {
      proposals: RelationshipProposal[];
      total: number;
      shown: number;
      generation: { created: number; unauthorizedCandidateCount: number };
    };
    assert.equal(payload.generation.unauthorizedCandidateCount, 0);
    assert.ok(payload.generation.created >= 1, generated.body);
    const proposal = payload.proposals.find(
      (item) =>
        item.relationship === "supports" &&
        item.source.entityId === task.id &&
        item.target.entityId === goal.id
    );
    assert.ok(proposal, generated.body);
    assert.equal(
      (
        getDatabase().prepare("SELECT count(*) AS count FROM entity_links").get() as {
          count: number;
        }
      ).count,
      linksBefore
    );

    const wrongOwnerList = await app.inject({
      method: "GET",
      url: `/api/v1/relationship-proposals?ownerUserId=${encodeURIComponent(other.id)}`,
      headers: { cookie }
    });
    assert.equal(wrongOwnerList.statusCode, 200);
    assert.equal((wrongOwnerList.json() as { total: number }).total, 0);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/relationship-proposals/${proposal.id}/accept`,
      headers: { cookie },
      payload: { ownerUserId: owner.id, expectedRevision: proposal.revision }
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT count(*) AS count FROM entity_links
             WHERE source_entity_type = 'task' AND source_entity_id = ?
               AND target_entity_type = 'goal' AND target_entity_id = ?
               AND relationship = 'supports'`
          )
          .get(task.id, goal.id) as { count: number }
      ).count,
      1
    );
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/relationship-proposals/${proposal.id}/accept`,
      headers: { cookie },
      payload: { ownerUserId: owner.id, expectedRevision: proposal.revision }
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.headers["idempotency-replayed"], "true");
    const opposite = await app.inject({
      method: "POST",
      url: `/api/v1/relationship-proposals/${proposal.id}/reject`,
      headers: { cookie },
      payload: { ownerUserId: owner.id, expectedRevision: proposal.revision }
    });
    assert.equal(opposite.statusCode, 409, opposite.body);
  });
});

test("SYS-20 rejection, stale acceptance, and concurrent opposite decisions preserve link integrity", async () => {
  await withTestServer(async (app, cookie) => {
    const owner = getDefaultUser();
    const other = createUser({
      kind: "human",
      handle: "proposal-transition-other",
      displayName: "Proposal transition other",
      description: "",
      accentColor: "#ccbbaa"
    });
    const goals = getDatabase()
      .prepare("SELECT id FROM goals ORDER BY id LIMIT 3")
      .all() as Array<{ id: string }>;
    const tasks = getDatabase()
      .prepare("SELECT id FROM tasks ORDER BY id LIMIT 3")
      .all() as Array<{ id: string }>;
    assert.ok(goals.length >= 3 && tasks.length >= 3);
    goals.forEach((item) => setEntityOwner("goal", item.id, owner.id));
    tasks.forEach((item) => setEntityOwner("task", item.id, owner.id));

    insertPendingProposal({
      id: "proposal-reject",
      ownerUserId: owner.id,
      sourceType: "task",
      sourceId: tasks[0]!.id,
      targetType: "goal",
      targetId: goals[0]!.id
    });
    const linksBeforeReject = (
      getDatabase().prepare("SELECT count(*) AS count FROM entity_links").get() as {
        count: number;
      }
    ).count;
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-proposals/proposal-reject/reject",
      headers: { cookie },
      payload: { ownerUserId: owner.id, expectedRevision: 1 }
    });
    assert.equal(rejected.statusCode, 200, rejected.body);
    assert.equal(
      (
        getDatabase().prepare("SELECT count(*) AS count FROM entity_links").get() as {
          count: number;
        }
      ).count,
      linksBeforeReject
    );
    const rejectedRow = getDatabase()
      .prepare(
        "SELECT status, evidence_json, explanation FROM relationship_proposals WHERE id = 'proposal-reject'"
      )
      .get() as { status: string; evidence_json: string; explanation: string };
    assert.equal(rejectedRow.status, "rejected");
    assert.equal(rejectedRow.evidence_json, "[]");
    assert.equal(rejectedRow.explanation, "Rejected by a human reviewer.");

    insertPendingProposal({
      id: "proposal-stale",
      ownerUserId: owner.id,
      sourceType: "task",
      sourceId: tasks[1]!.id,
      targetType: "goal",
      targetId: goals[1]!.id
    });
    setEntityOwner("goal", goals[1]!.id, other.id);
    const stale = await app.inject({
      method: "POST",
      url: "/api/v1/relationship-proposals/proposal-stale/accept",
      headers: { cookie },
      payload: { ownerUserId: owner.id, expectedRevision: 1 }
    });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT count(*) AS count FROM entity_links
             WHERE source_entity_id = ? AND target_entity_id = ?`
          )
          .get(tasks[1]!.id, goals[1]!.id) as { count: number }
      ).count,
      0
    );

    insertPendingProposal({
      id: "proposal-race",
      ownerUserId: owner.id,
      sourceType: "task",
      sourceId: tasks[2]!.id,
      targetType: "goal",
      targetId: goals[2]!.id
    });
    const race = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/relationship-proposals/proposal-race/accept",
        headers: { cookie },
        payload: { ownerUserId: owner.id, expectedRevision: 1 }
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/relationship-proposals/proposal-race/reject",
        headers: { cookie },
        payload: { ownerUserId: owner.id, expectedRevision: 1 }
      })
    ]);
    assert.deepEqual(
      race.map((response) => response.statusCode).sort(),
      [200, 409]
    );
    const terminal = getDatabase()
      .prepare(
        "SELECT status, link_created FROM relationship_proposals WHERE id = 'proposal-race'"
      )
      .get() as { status: "accepted" | "rejected"; link_created: number };
    const raceLinkCount = (
      getDatabase()
        .prepare(
          "SELECT count(*) AS count FROM entity_links WHERE source_entity_id = ? AND target_entity_id = ?"
        )
        .get(tasks[2]!.id, goals[2]!.id) as { count: number }
    ).count;
    assert.equal(raceLinkCount, terminal.status === "accepted" ? 1 : 0);
    assert.equal(terminal.link_created, raceLinkCount);
  });
});

test("SYS-20 operator-only contract denies agents and publishes bounded OpenAPI", async () => {
  for (const [method, routePath] of [
    ["GET", "/api/v1/relationship-proposals"],
    ["POST", "/api/v1/relationship-proposals/generate"],
    ["POST", "/api/v1/relationship-proposals/:id/accept"],
    ["POST", "/api/v1/relationship-proposals/:id/reject"]
  ] as const) {
    const contract = resolveRouteSecurityContract({ method, routePath });
    assert.equal(contract.securityClass, "protected");
    assert.equal(contract.allowsAnonymousAdmission, false);
    assert.deepEqual(contract.acceptedLegacyScopes, []);
  }
  const document = buildOpenApiDocument() as {
    components?: { schemas?: Record<string, unknown> };
    paths?: Record<string, Record<string, unknown>>;
  };
  assert.ok(document.components?.schemas?.RelationshipProposal);
  assert.ok(document.paths?.["/api/v1/relationship-proposals"]?.get);
  assert.ok(document.paths?.["/api/v1/relationship-proposals/generate"]?.post);
  assert.ok(document.paths?.["/api/v1/relationship-proposals/{id}/accept"]?.post);
  assert.ok(document.paths?.["/api/v1/relationship-proposals/{id}/reject"]?.post);

  await withTestServer(async (app) => {
    const owner = getDefaultUser();
    const token = createAgentToken(
      createAgentTokenSchema.parse({
        label: "Relationship proposal agent",
        agentLabel: "Relationship proposal agent",
        scopes: ["read", "write"],
        scopePolicy: { userIds: [owner.id], projectIds: [], tagIds: [] }
      }),
      { actor: "SYS-20 test", source: "system" }
    ).token;
    for (const request of [
      {
        method: "GET" as const,
        url: `/api/v1/relationship-proposals?ownerUserId=${owner.id}`
      },
      {
        method: "POST" as const,
        url: "/api/v1/relationship-proposals/generate",
        payload: { ownerUserId: owner.id }
      }
    ]) {
      const denied = await app.inject({
        ...request,
        headers: { authorization: `Bearer ${token}` }
      });
      assert.equal(denied.statusCode, 403, denied.body);
    }
  });
});

test("SYS-20 maximum envelope remains bounded in time, comparisons, memory, storage, and list shape", async () => {
  const base = RELATIONSHIP_PROPOSAL_DEVELOPMENT_CASES[0]!.source;
  const documents: RelationshipProposalSourceDocument[] = Array.from(
    { length: RELATIONSHIP_PROPOSAL_MAX_SOURCE_DOCUMENTS },
    (_, index) => ({
      ...base,
      key: `task:performance-${index}`,
      entityType: index % 2 === 0 ? "task" : "project",
      entityId: `performance-${index}`,
      title: `isolated performance token${index} envelope`,
      detail: `isolated performance token${index} envelope`,
      fields: [],
      ownerUserId: "fixture-owner"
    })
  );
  for (let index = 0; index < 3; index += 1) {
    generateRelationshipProposalCandidates({
      ownerUserId: "fixture-owner",
      documents
    });
  }
  const rssBefore = process.memoryUsage().rss;
  const samples: number[] = [];
  let rssAfterEight = rssBefore;
  let finalResult: ReturnType<typeof generateRelationshipProposalCandidates> | null = null;
  for (let index = 0; index < 30; index += 1) {
    const startedAt = performance.now();
    finalResult = generateRelationshipProposalCandidates({
      ownerUserId: "fixture-owner",
      documents
    });
    samples.push(performance.now() - startedAt);
    if (index === 7) rssAfterEight = process.memoryUsage().rss;
  }
  assert.ok(finalResult);
  assert.equal(finalResult.consideredDocuments, RELATIONSHIP_PROPOSAL_MAX_SOURCE_DOCUMENTS);
  assert.equal(finalResult.comparisons, RELATIONSHIP_PROPOSAL_MAX_COMPARISONS);
  assert.equal(finalResult.truncated, true);
  const generationP95Ms = percentile(samples, 0.95);
  const rssDeltaBytes = Math.max(0, rssAfterEight - rssBefore);
  assert.ok(generationP95Ms <= 500, JSON.stringify(samples));
  assert.ok(
    rssDeltaBytes <= 50 * 1024 * 1024,
    `eight-transition RSS delta ${rssDeltaBytes} bytes`
  );

  await withTestServer(async (app, cookie) => {
    const owner = getDefaultUser();
    const endpoints = getDatabase()
      .prepare("SELECT id FROM tasks ORDER BY id LIMIT 1")
      .get() as { id: string };
    const target = getDatabase()
      .prepare("SELECT id FROM goals ORDER BY id LIMIT 1")
      .get() as { id: string };
    setEntityOwner("task", endpoints.id, owner.id);
    setEntityOwner("goal", target.id, owner.id);
    for (let index = 0; index < RELATIONSHIP_PROPOSAL_MAX_PENDING_PER_OWNER; index += 1) {
      insertPendingProposal({
        id: `performance-proposal-${index}`,
        ownerUserId: owner.id,
        sourceType: "task",
        sourceId: endpoints.id,
        targetType: "goal",
        targetId: target.id
      });
    }
    const listSamples: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      await app.inject({
        method: "GET",
        url: `/api/v1/relationship-proposals?ownerUserId=${owner.id}&limit=20`,
        headers: { cookie }
      });
    }
    let responseBody: { total: number; shown: number; proposals: unknown[] } = {
      total: 0,
      shown: 0,
      proposals: []
    };
    for (let index = 0; index < 30; index += 1) {
      const startedAt = performance.now();
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/relationship-proposals?ownerUserId=${owner.id}&limit=20`,
        headers: { cookie }
      });
      listSamples.push(performance.now() - startedAt);
      assert.equal(response.statusCode, 200, response.body);
      responseBody = response.json() as {
        total: number;
        shown: number;
        proposals: unknown[];
      };
    }
    assert.equal(responseBody.total, RELATIONSHIP_PROPOSAL_MAX_PENDING_PER_OWNER);
    assert.equal(responseBody.shown, 20);
    assert.equal(responseBody.proposals.length, 20);
    const listP95Ms = percentile(listSamples, 0.95);
    assert.ok(listP95Ms <= 500, JSON.stringify(listSamples));
    const bytes = Buffer.byteLength(
      JSON.stringify(
        getDatabase()
          .prepare(
            `SELECT * FROM relationship_proposals WHERE owner_user_id = ?`
          )
          .all(owner.id)
      )
    );
    assert.ok(bytes <= 1024 * 1024, `proposal storage ${bytes} bytes`);
    assert.ok(
      bytes / RELATIONSHIP_PROPOSAL_MAX_PENDING_PER_OWNER <= 8 * 1024,
      `proposal storage ${bytes / RELATIONSHIP_PROPOSAL_MAX_PENDING_PER_OWNER} bytes/record`
    );
    process.stdout.write(
      `SYS-20 maximum envelope ${JSON.stringify({
        sourceDocuments: RELATIONSHIP_PROPOSAL_MAX_SOURCE_DOCUMENTS,
        comparisons: finalResult.comparisons,
        generationP95Ms,
        listP95Ms,
        rssDeltaBytes,
        storedProposalBytes: bytes,
        bytesPerProposal: bytes / RELATIONSHIP_PROPOSAL_MAX_PENDING_PER_OWNER,
        pending: RELATIONSHIP_PROPOSAL_MAX_PENDING_PER_OWNER,
        shown: responseBody.shown
      })}\n`
    );
  });
});
