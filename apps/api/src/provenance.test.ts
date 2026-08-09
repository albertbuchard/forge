import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { buildOpenApiDocument } from "./openapi.js";
import { createGoal } from "./repositories/goals.js";
import { createProject } from "./repositories/projects.js";
import { createTask } from "./repositories/tasks.js";
import {
  buildDerivedDataProvenance,
  derivedDataProvenanceSchema,
  latestObservedAt
} from "./provenance.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import { buildWatchBootstrap } from "./watch-mobile.js";

const generatedAt = "2026-08-09T12:00:00.000Z";

function build(
  overrides: Partial<Parameters<typeof buildDerivedDataProvenance>[0]> = {}
) {
  return buildDerivedDataProvenance({
    generatedAt,
    observedAt: "2026-08-09T11:59:00.000Z",
    staleAfterSeconds: 600,
    sourceSummary: "Daily health aggregates",
    completeness: "complete",
    completenessReason: "All expected metrics are present.",
    confidence: {
      level: "high",
      reason: "The result comes directly from stored daily aggregates."
    },
    sources: [
      {
        id: "health-daily",
        label: "Daily health aggregates",
        kind: "aggregate",
        observedAt: "2026-08-09T11:59:00.000Z",
        detailRoute: "/api/v1/health/vitals"
      }
    ],
    ...overrides
  });
}

test("classifies fresh, stale, missing, future, and partial evidence truthfully", () => {
  assert.equal(build().freshness, "fresh");
  assert.equal(
    build({ observedAt: "2026-08-09T11:30:00.000Z" }).freshness,
    "stale"
  );
  assert.equal(build({ observedAt: null }).freshness, "missing");
  assert.equal(
    build({ observedAt: "2026-08-09T12:06:00.000Z" }).freshness,
    "future"
  );

  const partial = build({
    completeness: "partial",
    completenessReason: "2 of 8 expected signals are unavailable."
  });
  assert.equal(partial.completeness, "partial");
  assert.match(partial.statusDetail, /2 of 8 expected signals/);
  assert.deepEqual(derivedDataProvenanceSchema.parse(partial), partial);
});

test("preserves multi-source identity and exact evidence references", () => {
  const provenance = build({
    sources: [
      {
        id: "movement-stays",
        label: "Recorded stays",
        kind: "record",
        observedAt: "2026-08-09T11:45:00.000Z",
        detailRoute: "/api/v1/movement/day?date=2026-08-09"
      },
      {
        id: "movement-trips",
        label: "Recorded trips",
        kind: "record",
        observedAt: "2026-08-09T11:59:00.000Z",
        detailRoute: "/api/v1/movement/day?date=2026-08-09"
      }
    ],
    evidence: [
      {
        label: "Trip 7",
        reference: "movement_trip:trip_7",
        observedAt: "2026-08-09T11:59:00.000Z"
      }
    ]
  });

  assert.deepEqual(
    provenance.sources.map((source) => source.id),
    ["movement-stays", "movement-trips"]
  );
  assert.equal(provenance.evidence[0]?.reference, "movement_trip:trip_7");
});

test("selects the latest valid observation without treating malformed values as evidence", () => {
  assert.equal(
    latestObservedAt([
      null,
      "not-a-date",
      "2026-08-09T10:00:00.000Z",
      "2026-08-09T11:00:00.000Z"
    ]),
    "2026-08-09T11:00:00.000Z"
  );
  assert.equal(latestObservedAt([null, undefined, "bad"]), null);
});

test("important derived-data routes expose the shared contract without an extra request", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-derived-provenance-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    taskRunWatchdog: false,
    devrageMetricSync: false,
    peerRuntime: false
  });

  try {
    const cookie = await issueTestOperatorSessionCookie(app);
    for (const [route, property] of [
      ["/api/v1/life-force", "lifeForce"],
      ["/api/v1/health/vitals", "vitals"],
      ["/api/v1/movement/day?date=2026-08-09", "movement"],
      ["/api/v1/operator/overview", "overview"]
    ] as const) {
      const response = await app.inject({
        method: "GET",
        url: route,
        headers: { cookie }
      });
      assert.equal(response.statusCode, 200, route);
      const payload = response.json() as Record<
        string,
        { provenance?: unknown }
      >;
      const provenance = derivedDataProvenanceSchema.parse(
        payload[property]?.provenance
      );
      assert.ok(provenance.sources.length > 0, route);
      assert.doesNotMatch(
        JSON.stringify(provenance),
        /storagePath|credential/i
      );
    }
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("empty Overview and Watch snapshots never treat request time as source evidence", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-empty-derived-provenance-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false,
    peerRuntime: false
  });

  try {
    const cookie = await issueTestOperatorSessionCookie(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/operator/overview",
      headers: { cookie }
    });
    assert.equal(response.statusCode, 200);
    const overview = derivedDataProvenanceSchema.parse(
      (response.json() as { overview: { provenance: unknown } }).overview
        .provenance
    );
    const watch = derivedDataProvenanceSchema.parse(
      buildWatchBootstrap({
        id: "pairing_empty_provenance",
        user_id: "user_operator"
      }).provenance
    );

    for (const provenance of [overview, watch]) {
      assert.equal(provenance.observedAt, null);
      assert.equal(provenance.freshness, "missing");
      assert.equal(provenance.completeness, "unknown");
      assert.equal(provenance.confidence.level, "unknown");
      assert.deepEqual(provenance.evidence, []);
    }
    assert.ok(watch.sources.every((source) => source.observedAt === null));

    const staleGoal = createGoal({
      title: "Stale provenance goal",
      description: "",
      horizon: "year",
      status: "active",
      targetPoints: 100,
      themeColor: "#336699",
      tagIds: [],
      notes: [],
      userId: "user_operator"
    });
    const staleProject = createProject({
      goalId: staleGoal.id,
      title: "Stale provenance project",
      userId: "user_operator"
    });
    const staleTask = createTask({
      title: "Stale provenance fixture",
      userId: "user_operator",
      owner: "Operator",
      goalId: staleGoal.id,
      projectId: staleProject.id,
      dueDate: "2026-08-09"
    });
    const staleAt = "2020-01-01T00:00:00.000Z";
    getDatabase()
      .prepare("UPDATE goals SET updated_at = ? WHERE id = ?")
      .run(staleAt, staleGoal.id);
    getDatabase()
      .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
      .run(staleAt, staleProject.id);
    getDatabase()
      .prepare("UPDATE tasks SET updated_at = ? WHERE id = ?")
      .run(staleAt, staleTask.id);

    const staleOverviewResponse = await app.inject({
      method: "GET",
      url: "/api/v1/operator/overview",
      headers: { cookie }
    });
    const staleOverview = derivedDataProvenanceSchema.parse(
      (
        staleOverviewResponse.json() as {
          overview: { provenance: unknown };
        }
      ).overview.provenance
    );
    const staleWatch = derivedDataProvenanceSchema.parse(
      buildWatchBootstrap(
        {
          id: "pairing_stale_provenance",
          user_id: "user_operator"
        },
        {
          anchorDateKey: "2026-08-09"
        }
      ).provenance
    );
    assert.equal(staleOverview.freshness, "stale");
    assert.equal(staleWatch.freshness, "stale");
    assert.equal(staleWatch.observedAt, staleAt);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("OpenAPI publishes the shared provenance contract on operator overview", () => {
  const document = buildOpenApiDocument() as {
    components: { schemas: Record<string, unknown> };
    paths: Record<
      string,
      {
        get?: {
          responses?: Record<
            string,
            { content?: { "application/json"?: { schema?: unknown } } }
          >;
        };
      }
    >;
  };

  assert.ok(document.components.schemas.DerivedDataProvenance);
  assert.ok(document.paths["/api/v1/operator/overview"]?.get);
});
