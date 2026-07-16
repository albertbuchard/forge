import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PsycheMetricsViewData } from "./psyche-types.js";
import type { DevrageReport } from "./services/devrage-scanner.js";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { storeDevrageReport } from "./services/devrage.js";
import { createTriggerReport } from "./repositories/psyche.js";

interface PsycheMetricsOpenApiContract {
  paths: Record<
    string,
    {
      get: {
        parameters: Array<{ name: string }>;
      };
    }
  >;
  components: {
    schemas: {
      PsycheMetricsViewData: {
        properties: {
          summary: { required: string[] };
          context: {
            required: string[];
            properties: {
              freshness: {
                properties: { status: { enum: string[] } };
              };
            };
          };
          metrics: {
            items: {
              required: string[];
              properties: {
                days: { items: { required: string[] } };
              };
            };
          };
        };
      };
    };
  };
}

function reportFixture(): DevrageReport {
  return {
    generatedAt: "2026-05-14T08:00:00.000Z",
    filesScanned: [],
    conversationsScanned: 1,
    messagesScanned: 12,
    messagesWithSwears: 3,
    totalSwears: 6,
    averageMaxCumulativeRage: 6,
    maxCumulativeRage: 6,
    maxSwearingStreak: 3,
    byAgent: [
      { agent: "codex", messages: 12, messagesWithSwears: 3, swears: 6 }
    ],
    bySource: [
      {
        source: "codex",
        conversations: 1,
        messages: 12,
        messagesWithSwears: 3,
        swears: 6
      }
    ],
    conversations: [
      {
        source: "codex",
        conversationId: "today",
        sourceFile: "/synthetic/codex/today.jsonl",
        updatedAt: "2026-05-14T10:00:00.000Z",
        dateKey: "2026-05-14",
        messages: 12,
        messagesWithSwears: 3,
        swears: 6,
        maxCumulativeRage: 6,
        maxSwearingStreak: 3
      }
    ],
    daily: [],
    topWords: [],
    actualWords: [],
    warnings: [],
    roleFilter: ["user"],
    sourceFilter: ["codex"],
    dateFilter: {}
  };
}

function createEmotionReport(input: {
  title: string;
  intensity: number;
  userId: string;
}) {
  return createTriggerReport(
    {
      title: input.title,
      status: "reviewed",
      eventTypeId: null,
      customEventType: "",
      eventSituation: "",
      occurredAt: "2026-05-14T09:00:00.000Z",
      emotions: [
        {
          emotionDefinitionId: null,
          label: "Tension",
          intensity: input.intensity,
          note: ""
        }
      ],
      thoughts: [],
      behaviors: [],
      consequences: {
        selfShortTerm: [],
        selfLongTerm: [],
        othersShortTerm: [],
        othersLongTerm: []
      },
      linkedPatternIds: [],
      linkedValueIds: [],
      linkedGoalIds: [],
      linkedProjectIds: [],
      linkedTaskIds: [],
      linkedBehaviorIds: [],
      linkedBeliefIds: [],
      linkedModeIds: [],
      modeOverlays: [],
      schemaLinks: [],
      modeTimeline: [],
      nextMoves: [],
      userId: input.userId
    },
    { source: "ui", actor: "test" }
  );
}

test("psyche metrics API returns stored devrage daily metrics", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-psyche-metrics-api-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    storeDevrageReport(reportFixture(), {
      fullSync: true,
      syncedDateKey: null
    });
    const triggerReport = createEmotionReport({
      title: "API source report",
      intensity: 65,
      userId: "user_operator"
    });
    const now = "2026-05-14T10:00:00.000Z";
    getDatabase()
      .prepare(
        `INSERT INTO users (
           id, kind, handle, display_name, description, accent_color, created_at, updated_at
         ) VALUES (?, 'human', ?, ?, '', '#4f8a8b', ?, ?)`
      )
      .run("user_second", "second", "Second owner", now, now);
    const foreignReport = createEmotionReport({
      title: "Foreign API report",
      intensity: 85,
      userId: "user_second"
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/metrics"
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      metrics: {
        summary: {
          hasData: boolean;
          metricCount: number;
          familyAvailability: Array<{
            family: string;
            status: string;
            reason: string;
          }>;
        };
        context: {
          freshness: { status: string };
          ownerScope: {
            mode: string;
            effectiveUserIds: string[];
            filterMode: string;
            serverEnforced: boolean;
            availableOwners: Array<{
              userId: string;
              displayName: string;
            }>;
          };
          sources: Array<{ sourceId: string; label: string }>;
        };
        metrics: Array<{
          metric: string;
          latestValue: number | null;
          confidence: { status: string };
          days: Array<{
            sourceRecords: Array<{ sourceId: string; href: string | null }>;
          }>;
        }>;
      };
    };
    assert.equal(body.metrics.summary.hasData, true);
    assert.equal(body.metrics.summary.metricCount, 5);
    assert.equal(
      body.metrics.metrics.find(
        (metric) => metric.metric === "devrageSwearCount"
      )?.latestValue,
      6
    );
    assert.equal(
      body.metrics.metrics.find(
        (metric) => metric.metric === "devrageMaxCumulativeRage"
      )?.latestValue,
      6
    );
    const moodMetric = body.metrics.metrics.find(
      (metric) => metric.metric === "reportedEmotionIntensity"
    );
    assert.ok(moodMetric);
    assert.equal(moodMetric.latestValue, 75);
    assert.equal(moodMetric.confidence.status, "not_estimated");
    assert.equal(
      moodMetric.days[0]?.sourceRecords[0]?.sourceId,
      triggerReport.id
    );
    assert.equal(
      moodMetric.days[0]?.sourceRecords[0]?.href,
      `/psyche/reports/${triggerReport.id}`
    );
    assert.equal(body.metrics.context.freshness.status, "current");
    assert.equal(body.metrics.context.ownerScope.mode, "unscoped_all_data");
    assert.deepEqual(body.metrics.context.ownerScope.effectiveUserIds, []);
    assert.equal(body.metrics.context.ownerScope.filterMode, "all_data");
    assert.equal(body.metrics.context.ownerScope.serverEnforced, false);
    assert.deepEqual(
      body.metrics.context.ownerScope.availableOwners.map(
        (owner) => owner.userId
      ),
      ["user_operator", "user_second"]
    );
    assert.ok(
      body.metrics.context.sources.some(
        (source) => source.sourceId === "trigger_reports"
      )
    );
    assert.ok(
      body.metrics.context.sources.some(
        (source) => source.sourceId === "conversation:codex"
      )
    );
    const unscopedSerialized = JSON.stringify(body.metrics);
    assert.match(unscopedSerialized, new RegExp(foreignReport.id));
    assert.match(unscopedSerialized, /Foreign API report/);
    assert.match(unscopedSerialized, /Second owner/);
    assert.equal(
      body.metrics.summary.familyAvailability.find(
        (family) => family.family === "urges"
      )?.status,
      "unsupported"
    );

    const scopedResponse = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/metrics?userIds=user_operator&timeZone=UTC"
    });
    assert.equal(scopedResponse.statusCode, 200);
    const scoped = (scopedResponse.json() as { metrics: PsycheMetricsViewData })
      .metrics;
    assert.equal(scoped.context.ownerScope.mode, "scoped");
    assert.deepEqual(scoped.context.ownerScope.effectiveUserIds, [
      "user_operator"
    ]);
    assert.equal(scoped.context.ownerScope.filterMode, "server_attribution");
    assert.equal(scoped.context.ownerScope.serverEnforced, true);
    assert.deepEqual(
      scoped.context.ownerScope.availableOwners.map((owner) => owner.userId),
      ["user_operator"]
    );
    assert.deepEqual(
      scoped.metrics.map((metric) => metric.metric),
      ["reportedEmotionIntensity"]
    );
    assert.equal(scoped.context.conversationsScanned, 0);
    assert.equal(scoped.context.messagesScanned, 0);
    assert.equal(scoped.context.sourceCount, 0);
    assert.equal(scoped.context.freshness.status, "not_applicable");
    assert.ok(
      scoped.context.sources.every(
        (source) => source.kind !== "conversation_scanner"
      )
    );
    assert.ok(
      scoped.metrics
        .flatMap((metric) => metric.days)
        .flatMap((day) => day.sourceRecords)
        .every((record) => record.ownerUserId === "user_operator")
    );
    const scopedSerialized = JSON.stringify(scoped);
    assert.doesNotMatch(scopedSerialized, new RegExp(foreignReport.id));
    assert.doesNotMatch(scopedSerialized, /Foreign API report/);
    assert.doesNotMatch(scopedSerialized, /Second owner/);
    assert.doesNotMatch(scopedSerialized, /conversation:codex/);
    assert.doesNotMatch(scopedSerialized, /"codex"/);

    const invalidTimeZoneResponse = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/metrics?userIds=user_operator&timeZone=Mars%2FOlympus"
    });
    assert.equal(invalidTimeZoneResponse.statusCode, 400);

    const openApiResponse = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json"
    });
    assert.equal(openApiResponse.statusCode, 200);
    const document = openApiResponse.json() as PsycheMetricsOpenApiContract;
    const operation = document.paths["/api/v1/psyche/metrics"].get;
    assert.deepEqual(
      operation.parameters.map((parameter: { name: string }) => parameter.name),
      ["userIds", "timeZone"]
    );
    const schema = document.components.schemas.PsycheMetricsViewData;
    assert.ok(
      schema.properties.summary.required.includes("familyAvailability")
    );
    assert.ok(schema.properties.context.required.includes("ownerScope"));
    assert.ok(schema.properties.context.required.includes("freshness"));
    assert.ok(schema.properties.context.required.includes("sources"));
    assert.ok(
      schema.properties.context.properties.freshness.properties.status.enum.includes(
        "not_applicable"
      )
    );
    const metricSchema = schema.properties.metrics.items;
    assert.ok(metricSchema.required.includes("definition"));
    assert.ok(metricSchema.required.includes("confidence"));
    assert.ok(metricSchema.required.includes("source"));
    assert.ok(
      metricSchema.properties.days.items.required.includes("sourceRecords")
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
