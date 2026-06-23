import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DevrageReport } from "./services/devrage-scanner.js";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { storeDevrageReport } from "./services/devrage.js";

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
    byAgent: [{ agent: "codex", messages: 12, messagesWithSwears: 3, swears: 6 }],
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

test("psyche metrics API returns stored devrage daily metrics", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-psyche-metrics-api-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    storeDevrageReport(reportFixture(), {
      fullSync: true,
      syncedDateKey: null
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/metrics"
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      metrics: {
        summary: { hasData: boolean; metricCount: number };
        metrics: Array<{ metric: string; latestValue: number | null }>;
      };
    };
    assert.equal(body.metrics.summary.hasData, true);
    assert.equal(body.metrics.summary.metricCount, 4);
    assert.equal(
      body.metrics.metrics.find((metric) => metric.metric === "devrageSwearCount")?.latestValue,
      6
    );
    assert.equal(
      body.metrics.metrics.find((metric) => metric.metric === "devrageMaxCumulativeRage")?.latestValue,
      6
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
