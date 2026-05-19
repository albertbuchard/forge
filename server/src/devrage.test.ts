import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DevrageReport } from "forge-devrage";
import {
  closeDatabase,
  configureDatabase,
  initializeDatabase
} from "./db.js";
import {
  getDevrageMetricPayload,
  getNextDevrageMetricSync,
  getPsycheMetricsViewData,
  storeDevrageReport
} from "./services/devrage.js";
import { getPsycheOverview } from "./services/psyche.js";

function reportFixture(): DevrageReport {
  return {
    generatedAt: "2026-05-14T08:00:00.000Z",
    filesScanned: [],
    conversationsScanned: 3,
    messagesScanned: 30,
    messagesWithSwears: 6,
    totalSwears: 12,
    byAgent: [{ agent: "codex", messages: 30, messagesWithSwears: 6, swears: 12 }],
    bySource: [
      {
        source: "codex",
        conversations: 3,
        messages: 30,
        messagesWithSwears: 6,
        swears: 12
      }
    ],
    conversations: [
      {
        source: "codex",
        conversationId: "older",
        sourceFile: "/synthetic/codex/older.jsonl",
        updatedAt: "2026-05-12T10:00:00.000Z",
        dateKey: "2026-05-12",
        messages: 10,
        messagesWithSwears: 1,
        swears: 2
      },
      {
        source: "codex",
        conversationId: "yesterday",
        sourceFile: "/synthetic/codex/yesterday.jsonl",
        updatedAt: "2026-05-13T10:00:00.000Z",
        dateKey: "2026-05-13",
        messages: 8,
        messagesWithSwears: 2,
        swears: 4
      },
      {
        source: "codex",
        conversationId: "today",
        sourceFile: "/synthetic/codex/today.jsonl",
        updatedAt: "2026-05-14T10:00:00.000Z",
        dateKey: "2026-05-14",
        messages: 12,
        messagesWithSwears: 3,
        swears: 6
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

test("stores devrage as one history row per measured day", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-devrage-"));
  configureDatabase({ dataRoot: rootDir, seedDemoData: true });
  await initializeDatabase();

  try {
    storeDevrageReport(reportFixture(), {
      fullSync: true,
      syncedDateKey: null
    });

    const metric = getDevrageMetricPayload();
    assert.equal(metric.hasData, true);
    assert.equal(metric.latestDateKey, "2026-05-14");
    assert.equal(metric.rawSwearCount, 6);
    assert.equal(metric.messagesScanned, 12);
    assert.equal(metric.messagesWithSwears, 3);
    assert.equal(metric.swearingMessagePercent, 25);
    assert.equal(metric.history.length, 3);
    assert.equal(metric.dailyAverage.rawSwearCount, 4);
    assert.equal(metric.weeklyAverage.rawSwearCount, 4);
    assert.ok(metric.sync.fullSyncCompletedAt);

    const psyche = getPsycheOverview();
    assert.equal(psyche.devrageMetric.rawSwearCount, 6);
    assert.equal(psyche.devrageMetric.history.length, 3);

    const metricsView = getPsycheMetricsViewData();
    assert.equal(metricsView.summary.hasData, true);
    assert.equal(metricsView.summary.trackedDays, 3);
    assert.equal(metricsView.summary.metricCount, 2);
    assert.equal(metricsView.summary.latestDateKey, "2026-05-14");
    assert.equal(metricsView.context.conversationsScanned, 3);
    assert.equal(metricsView.context.messagesScanned, 30);
    assert.equal(metricsView.context.messagesWithSwears, 6);
    assert.equal(metricsView.context.totalSwears, 12);
    assert.equal(metricsView.context.dailyAverage.rawSwearCount, 4);
    assert.equal(metricsView.context.weeklyAverage.rawSwearCount, 4);
    const swearCountMetric = metricsView.metrics.find(
      (entry) => entry.metric === "devrageSwearCount"
    );
    assert.ok(swearCountMetric);
    assert.equal(swearCountMetric.latestValue, 6);
    assert.equal(swearCountMetric.coverageDays, 3);
    const percentMetric = metricsView.metrics.find(
      (entry) => entry.metric === "swearingMessagePercent"
    );
    assert.ok(percentMetric);
    assert.equal(percentMetric.latestValue, 25);
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("devrage metrics view stays empty before stored conversation history exists", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-devrage-empty-"));
  configureDatabase({ dataRoot: rootDir, seedDemoData: true });
  await initializeDatabase();

  try {
    const metric = getDevrageMetricPayload();
    assert.equal(metric.hasData, false);

    const metricsView = getPsycheMetricsViewData();
    assert.equal(metricsView.summary.hasData, false);
    assert.equal(metricsView.summary.trackedDays, 0);
    assert.equal(metricsView.summary.metricCount, 0);
    assert.equal(metricsView.metrics.length, 0);
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("daily devrage resync replaces only that day's measurement rows", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-devrage-resync-"));
  configureDatabase({ dataRoot: rootDir, seedDemoData: true });
  await initializeDatabase();

  try {
    storeDevrageReport(reportFixture(), {
      fullSync: true,
      syncedDateKey: null
    });
    const dailyReport = reportFixture();
    dailyReport.conversations = [
      {
        source: "codex",
        conversationId: "today",
        sourceFile: "/synthetic/codex/today.jsonl",
        updatedAt: "2026-05-14T11:00:00.000Z",
        dateKey: "2026-05-14",
        messages: 20,
        messagesWithSwears: 1,
        swears: 1
      }
    ];

    storeDevrageReport(dailyReport, {
      fullSync: false,
      syncedDateKey: "2026-05-14"
    });

    const metric = getDevrageMetricPayload();
    assert.equal(metric.history.length, 3);
    assert.equal(metric.rawSwearCount, 1);
    assert.equal(metric.messagesScanned, 20);
    assert.equal(metric.messagesWithSwears, 1);
    assert.equal(metric.swearingMessagePercent, 5);
    assert.equal(metric.sync.lastSyncedDateKey, "2026-05-14");
    assert.ok(metric.sync.lastDailySyncAt);
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("devrage sync refreshes today's rows after the hourly freshness window", () => {
  const freshToday = getNextDevrageMetricSync(
    {
      full_sync_completed_at: "2026-05-14T08:00:00.000Z",
      last_daily_sync_at: "2026-05-19T10:00:00.000Z",
      last_synced_date_key: "2026-05-19",
      updated_at: "2026-05-19T10:00:00.000Z"
    },
    new Date("2026-05-19T10:30:00.000Z")
  );
  assert.equal(freshToday, null);

  const staleToday = getNextDevrageMetricSync(
    {
      full_sync_completed_at: "2026-05-14T08:00:00.000Z",
      last_daily_sync_at: "2026-05-19T10:00:00.000Z",
      last_synced_date_key: "2026-05-19",
      updated_at: "2026-05-19T10:00:00.000Z"
    },
    new Date("2026-05-19T11:00:00.000Z")
  );
  assert.deepEqual(staleToday, { dateKey: "2026-05-19" });
});

test("devrage sync still starts with a full import and rolls to a new day", () => {
  assert.deepEqual(getNextDevrageMetricSync(null, new Date("2026-05-19T10:00:00.000Z")), {
    forceFull: true
  });

  const nextDay = getNextDevrageMetricSync(
    {
      full_sync_completed_at: "2026-05-14T08:00:00.000Z",
      last_daily_sync_at: "2026-05-18T20:00:00.000Z",
      last_synced_date_key: "2026-05-18",
      updated_at: "2026-05-18T20:00:00.000Z"
    },
    new Date("2026-05-19T10:00:00.000Z")
  );
  assert.deepEqual(nextDay, { dateKey: "2026-05-19" });
});
