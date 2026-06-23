import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeConversations,
  parseOpenClawTrajectoryLine,
  type ConversationRecord,
  type DevrageReport,
  type MessageRole
} from "./services/devrage-scanner.js";
import {
  closeDatabase,
  configureDatabase,
  getDatabase,
  initializeDatabase
} from "./db.js";
import {
  getDevrageMetricPayload,
  getNextDevrageMetricSync,
  getPsycheMetricsViewData,
  needsDevrageCumulativeRageBackfill,
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
    averageMaxCumulativeRage: 4,
    maxCumulativeRage: 6,
    maxSwearingStreak: 3,
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
        swears: 2,
        maxCumulativeRage: 2,
        maxSwearingStreak: 1
      },
      {
        source: "codex",
        conversationId: "yesterday",
        sourceFile: "/synthetic/codex/yesterday.jsonl",
        updatedAt: "2026-05-13T10:00:00.000Z",
        dateKey: "2026-05-13",
        messages: 8,
        messagesWithSwears: 2,
        swears: 4,
        maxCumulativeRage: 4,
        maxSwearingStreak: 2
      },
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
    assert.equal(metric.averageMaxCumulativeRage, 6);
    assert.equal(metric.maxCumulativeRage, 6);
    assert.equal(metric.maxSwearingStreak, 3);
    assert.equal(metric.history.length, 3);
    assert.equal(metric.dailyAverage.rawSwearCount, 4);
    assert.equal(metric.dailyAverage.averageMaxCumulativeRage, 4);
    assert.equal(metric.dailyAverage.maxCumulativeRage, 4);
    assert.equal(metric.weeklyAverage.rawSwearCount, 4);
    assert.equal(metric.weeklyAverage.averageMaxCumulativeRage, 4);
    assert.equal(metric.weeklyAverage.maxCumulativeRage, 4);
    assert.ok(metric.sync.fullSyncCompletedAt);

    const psyche = getPsycheOverview();
    assert.equal(psyche.devrageMetric.rawSwearCount, 6);
    assert.equal(psyche.devrageMetric.history.length, 3);

    const metricsView = getPsycheMetricsViewData();
    assert.equal(metricsView.summary.hasData, true);
    assert.equal(metricsView.summary.trackedDays, 3);
    assert.equal(metricsView.summary.metricCount, 4);
    assert.equal(metricsView.summary.latestDateKey, "2026-05-14");
    assert.equal(metricsView.context.conversationsScanned, 3);
    assert.equal(metricsView.context.messagesScanned, 30);
    assert.equal(metricsView.context.messagesWithSwears, 6);
    assert.equal(metricsView.context.totalSwears, 12);
    assert.equal(metricsView.context.dailyAverage.rawSwearCount, 4);
    assert.equal(metricsView.context.dailyAverage.averageMaxCumulativeRage, 4);
    assert.equal(metricsView.context.dailyAverage.maxCumulativeRage, 4);
    assert.equal(metricsView.context.weeklyAverage.rawSwearCount, 4);
    assert.equal(metricsView.context.weeklyAverage.averageMaxCumulativeRage, 4);
    assert.equal(metricsView.context.weeklyAverage.maxCumulativeRage, 4);
    const swearCountMetric = metricsView.metrics.find(
      (entry) => entry.metric === "devrageSwearCount"
    );
    assert.ok(swearCountMetric);
    assert.equal(swearCountMetric.latestValue, 6);
    assert.equal(swearCountMetric.baselineValue, 3);
    assert.equal(swearCountMetric.deltaValue, 3);
    assert.equal(swearCountMetric.coverageDays, 3);
    const percentMetric = metricsView.metrics.find(
      (entry) => entry.metric === "swearingMessagePercent"
    );
    assert.ok(percentMetric);
    assert.equal(percentMetric.latestValue, 25);
    assert.equal(percentMetric.baselineValue, 17.5);
    assert.equal(percentMetric.deltaValue, 7.5);
    const averageRageMetric = metricsView.metrics.find(
      (entry) => entry.metric === "devrageAverageMaxCumulativeRage"
    );
    assert.ok(averageRageMetric);
    assert.equal(averageRageMetric.latestValue, 6);
    assert.equal(averageRageMetric.baselineValue, 3);
    assert.equal(averageRageMetric.deltaValue, 3);
    const maxRageMetric = metricsView.metrics.find(
      (entry) => entry.metric === "devrageMaxCumulativeRage"
    );
    assert.ok(maxRageMetric);
    assert.equal(maxRageMetric.latestValue, 6);
    assert.equal(maxRageMetric.baselineValue, 3);
    assert.equal(maxRageMetric.deltaValue, 3);
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

test("devrage sync forces a full backfill when cumulative rage metric rows are missing", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-devrage-backfill-"));
  configureDatabase({ dataRoot: rootDir, seedDemoData: true });
  await initializeDatabase();

  try {
    assert.equal(needsDevrageCumulativeRageBackfill(), false);

    const database = getDatabase();
    database
      .prepare(
        `INSERT INTO psyche_devrage_metric_measures (
           id, date_key, metric_key, value, unit, sample_count, computed_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "metric-old-count",
        "2026-05-14",
        "swear_count",
        6,
        "count",
        3,
        "2026-05-14T10:00:00.000Z",
        "metric-old-percent",
        "2026-05-14",
        "swearing_message_percent",
        25,
        "percent",
        30,
        "2026-05-14T10:00:00.000Z"
      );

    assert.equal(needsDevrageCumulativeRageBackfill(), true);
    assert.deepEqual(
      getNextDevrageMetricSync(
        {
          full_sync_completed_at: "2026-05-14T08:00:00.000Z",
          last_daily_sync_at: "2026-05-19T10:00:00.000Z",
          last_synced_date_key: "2026-05-19",
          updated_at: "2026-05-19T10:00:00.000Z"
        },
        new Date("2026-05-19T10:30:00.000Z"),
        true
      ),
      { forceFull: true }
    );

    database
      .prepare(
        `INSERT INTO psyche_devrage_metric_measures (
           id, date_key, metric_key, value, unit, sample_count, computed_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "metric-rage-average",
        "2026-05-14",
        "average_max_cumulative_rage",
        2,
        "score",
        3,
        "2026-05-14T10:00:00.000Z",
        "metric-rage-max",
        "2026-05-14",
        "max_cumulative_rage",
        6,
        "score",
        3,
        "2026-05-14T10:00:00.000Z"
      );

    assert.equal(needsDevrageCumulativeRageBackfill(), false);
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
        swears: 1,
        maxCumulativeRage: 1,
        maxSwearingStreak: 1
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
    assert.equal(metric.averageMaxCumulativeRage, 1);
    assert.equal(metric.maxCumulativeRage, 1);
    assert.equal(metric.maxSwearingStreak, 1);
    assert.equal(metric.sync.lastSyncedDateKey, "2026-05-14");
    assert.ok(metric.sync.lastDailySyncAt);
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("devrage scanner computes per-thread cumulative rage with one-point clean-message decay", () => {
  const conversations: ConversationRecord[] = [
    {
      source: "codex",
      conversationId: "thread-a",
      sourceFile: "/synthetic/thread-a.jsonl",
      updatedAt: "2026-05-14T10:00:00.000Z",
      messages: [
        message("thread-a", "Clean start", "2026-05-14T10:00:00.000Z"),
        message("thread-a", "fuck", "2026-05-14T10:01:00.000Z"),
        message("thread-a", "shit fuck", "2026-05-14T10:02:00.000Z"),
        message("thread-a", "clean cooldown", "2026-05-14T10:03:00.000Z"),
        message("thread-a", "wtf", "2026-05-14T10:04:00.000Z")
      ]
    },
    {
      source: "codex",
      conversationId: "thread-b",
      sourceFile: "/synthetic/thread-b.jsonl",
      updatedAt: "2026-05-14T11:00:00.000Z",
      messages: [
        message("thread-b", "shit", "2026-05-14T11:00:00.000Z"),
        message("thread-b", "clean", "2026-05-14T11:01:00.000Z")
      ]
    }
  ];

  const report = analyzeConversations(
    conversations,
    { roles: new Set<MessageRole>(["user"]), timeZone: "UTC" },
    "2026-05-14T12:00:00.000Z"
  );

  assert.equal(report.totalSwears, 5);
  assert.equal(report.messagesWithSwears, 4);
  assert.equal(report.averageMaxCumulativeRage, 2);
  assert.equal(report.maxCumulativeRage, 3);
  assert.equal(report.maxSwearingStreak, 2);
  assert.equal(report.conversations.find((conversation) => conversation.conversationId === "thread-a")?.maxCumulativeRage, 3);
  assert.equal(report.conversations.find((conversation) => conversation.conversationId === "thread-a")?.maxSwearingStreak, 2);
  assert.equal(report.daily[0]?.averageMaxCumulativeRage, 2);
  assert.equal(report.daily[0]?.maxCumulativeRage, 3);
});

test("OpenClaw trajectory parser reads the current submitted user prompt without compiled context", () => {
  const context = {
    source: "openclaw" as const,
    conversationId: "thread-1.trajectory",
    sourceFile: "/synthetic/thread-1.trajectory.jsonl",
    fallbackTimestamp: "2026-05-14T09:00:00.000Z",
    line: 4
  };
  const parsed = parseOpenClawTrajectoryLine(
    {
      type: "prompt.submitted",
      ts: "2026-05-14T10:00:00.000Z",
      data: {
        prompt: "what the fuck",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "older duplicate" }]
          }
        ]
      }
    },
    context
  );

  assert.equal(parsed?.conversationId, "thread-1");
  assert.equal(parsed?.role, "user");
  assert.equal(parsed?.text, "what the fuck");
  assert.equal(parsed?.timestamp, "2026-05-14T10:00:00.000Z");
});

function message(conversationId: string, text: string, timestamp: string) {
  return {
    agent: "codex",
    source: "codex" as const,
    conversationId,
    role: "user" as const,
    text,
    timestamp,
    sourceFile: `/synthetic/${conversationId}.jsonl`
  };
}

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
