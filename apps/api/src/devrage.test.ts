import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeConversations,
  parseOpenClawTrajectoryLine,
  scanConversations,
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
  DevrageScanIncompleteError,
  getDevrageMetricPayload,
  getNextDevrageMetricSync,
  getPsycheMetricsViewData,
  needsDevrageCumulativeRageBackfill,
  storeDevrageReport
} from "./services/devrage.js";
import { getPsycheOverview } from "./services/psyche.js";
import { createTriggerReport } from "./repositories/psyche.js";

function createEmotionReport(input: {
  title: string;
  occurredAt: string | null;
  intensities: number[];
  userId?: string;
}) {
  return createTriggerReport(
    {
      title: input.title,
      status: "reviewed",
      eventTypeId: null,
      customEventType: "",
      eventSituation: "",
      occurredAt: input.occurredAt,
      emotions: input.intensities.map((intensity, index) => ({
        emotionDefinitionId: null,
        label: `Emotion ${index + 1}`,
        intensity,
        note: ""
      })),
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
      userId: input.userId ?? "user_operator"
    },
    { source: "ui", actor: "test" }
  );
}

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
    byAgent: [
      { agent: "codex", messages: 30, messagesWithSwears: 6, swears: 12 }
    ],
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

test("psyche metrics derive only dated emotion intensity with owner attribution and local-day grouping", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-psyche-derived-mood-")
  );
  configureDatabase({ dataRoot: rootDir, seedDemoData: true });
  await initializeDatabase();

  try {
    const now = "2026-05-14T10:00:00.000Z";
    getDatabase()
      .prepare(
        `INSERT INTO users (
           id, kind, handle, display_name, description, accent_color, created_at, updated_at
         ) VALUES (?, 'human', ?, ?, '', '#4f8a8b', ?, ?)`
      )
      .run("user_second", "second", "Second owner", now, now);
    const first = createEmotionReport({
      title: "Late evening report",
      occurredAt: "2026-05-14T23:30:00.000Z",
      intensities: [20, 40]
    });
    const second = createEmotionReport({
      title: "After midnight report",
      occurredAt: "2026-05-15T00:30:00.000Z",
      intensities: [80],
      userId: "user_second"
    });
    createEmotionReport({
      title: "Undated report",
      occurredAt: null,
      intensities: [100]
    });

    const utcView = getPsycheMetricsViewData({
      timeZone: "UTC",
      now: new Date("2026-05-15T01:00:00.000Z")
    });
    const utcMood = utcView.metrics.find(
      (metric) => metric.metric === "reportedEmotionIntensity"
    );
    assert.ok(utcMood);
    assert.equal(utcMood.family, "mood");
    assert.equal(utcMood.cadence, "event_based");
    assert.equal(utcMood.confidence.status, "not_estimated");
    assert.deepEqual(
      utcMood.days.map((day) => ({
        dateKey: day.dateKey,
        average: day.average,
        sampleCount: day.sampleCount
      })),
      [
        { dateKey: "2026-05-14", average: 30, sampleCount: 2 },
        { dateKey: "2026-05-15", average: 80, sampleCount: 1 }
      ]
    );
    assert.equal(utcMood.days[0]?.sourceRecords[0]?.sourceId, first.id);
    assert.equal(
      utcMood.days[0]?.sourceRecords[0]?.href,
      `/psyche/reports/${first.id}`
    );
    assert.equal(utcMood.days[1]?.sourceRecords[0]?.ownerUserId, "user_second");
    assert.equal(utcMood.days[1]?.sourceRecords[0]?.sourceId, second.id);
    assert.deepEqual(
      utcView.context.ownerScope.availableOwners.map((owner) => owner.userId),
      ["user_operator", "user_second"]
    );
    assert.match(
      utcView.context.dataQualityWarnings.join(" "),
      /no occurred-at/i
    );
    assert.equal(
      utcView.summary.familyAvailability.find(
        (family) => family.family === "urges"
      )?.status,
      "unsupported"
    );
    assert.match(
      utcView.summary.familyAvailability.find(
        (family) => family.family === "selfRegulation"
      )?.reason ?? "",
      /planned actions, not evidence/i
    );

    const newYorkView = getPsycheMetricsViewData({
      timeZone: "America/New_York",
      now: new Date("2026-05-15T01:00:00.000Z")
    });
    const newYorkMood = newYorkView.metrics.find(
      (metric) => metric.metric === "reportedEmotionIntensity"
    );
    assert.ok(newYorkMood);
    assert.equal(newYorkMood.days.length, 1);
    assert.equal(newYorkMood.days[0]?.dateKey, "2026-05-14");
    assert.equal(newYorkMood.days[0]?.average, 46.7);
    assert.equal(newYorkMood.days[0]?.sampleCount, 3);

    const unowned = createEmotionReport({
      title: "Unowned report",
      occurredAt: "2026-05-15T08:00:00.000Z",
      intensities: [55]
    });
    getDatabase()
      .prepare(
        `DELETE FROM entity_owners
         WHERE entity_type = 'trigger_report' AND entity_id = ?`
      )
      .run(unowned.id);
    storeDevrageReport(reportFixture(), {
      fullSync: true,
      syncedDateKey: null
    });

    const unscopedView = getPsycheMetricsViewData({
      timeZone: "UTC",
      now: new Date("2026-05-15T10:00:00.000Z")
    });
    assert.equal(unscopedView.context.ownerScope.mode, "unscoped_all_data");
    assert.deepEqual(unscopedView.context.ownerScope.effectiveUserIds, []);
    assert.equal(unscopedView.context.ownerScope.filterMode, "all_data");
    assert.equal(unscopedView.context.ownerScope.serverEnforced, false);
    assert.ok(
      unscopedView.metrics.some((metric) => metric.family === "conversation")
    );
    assert.ok(
      unscopedView.context.sources.some(
        (source) => source.sourceId === "conversation:codex"
      )
    );
    const unscopedSerialized = JSON.stringify(unscopedView);
    assert.match(unscopedSerialized, new RegExp(second.id));
    assert.match(unscopedSerialized, /After midnight report/);
    assert.match(unscopedSerialized, /Second owner/);
    assert.match(unscopedSerialized, new RegExp(unowned.id));
    assert.match(unscopedSerialized, /Unowned report/);

    const scopedView = getPsycheMetricsViewData({
      timeZone: "UTC",
      now: new Date("2026-05-15T10:00:00.000Z"),
      userIds: [" user_operator ", "user_operator"]
    });
    assert.equal(scopedView.context.ownerScope.mode, "scoped");
    assert.deepEqual(scopedView.context.ownerScope.effectiveUserIds, [
      "user_operator"
    ]);
    assert.equal(
      scopedView.context.ownerScope.filterMode,
      "server_attribution"
    );
    assert.equal(scopedView.context.ownerScope.serverEnforced, true);
    assert.deepEqual(scopedView.context.ownerScope.availableOwners, [
      { userId: "user_operator", displayName: "Operator" }
    ]);
    assert.deepEqual(
      scopedView.metrics.map((metric) => metric.metric),
      ["reportedEmotionIntensity"]
    );
    assert.equal(scopedView.context.conversationsScanned, 0);
    assert.equal(scopedView.context.sourceCount, 0);
    assert.equal(scopedView.context.messagesScanned, 0);
    assert.equal(scopedView.context.messagesWithSwears, 0);
    assert.equal(scopedView.context.totalSwears, 0);
    assert.deepEqual(scopedView.context.dailyAverage, {
      rawSwearCount: 0,
      swearingMessagePercent: 0,
      averageMaxCumulativeRage: 0,
      maxCumulativeRage: 0
    });
    assert.deepEqual(scopedView.context.weeklyAverage, {
      rawSwearCount: 0,
      swearingMessagePercent: 0,
      averageMaxCumulativeRage: 0,
      maxCumulativeRage: 0
    });
    assert.deepEqual(scopedView.context.sync, {
      fullSyncCompletedAt: null,
      lastDailySyncAt: null,
      lastSyncedDateKey: null
    });
    assert.equal(scopedView.context.freshness.status, "not_applicable");
    assert.deepEqual(scopedView.context.sources, [
      {
        sourceId: "trigger_reports",
        label: "Trigger reports",
        kind: "trigger_reports",
        recordCount: 1,
        linkedRecordCount: 1,
        href: "/psyche/reports",
        ownerAttribution: "attributed"
      }
    ]);
    assert.equal(
      scopedView.summary.familyAvailability.find(
        (family) => family.family === "conversation"
      )?.status,
      "unsupported"
    );
    assert.match(
      scopedView.summary.familyAvailability.find(
        (family) => family.family === "conversation"
      )?.reason ?? "",
      /no canonical owner attribution/i
    );
    assert.ok(
      scopedView.metrics
        .flatMap((metric) => metric.days)
        .flatMap((day) => day.sourceRecords)
        .every((record) => record.ownerUserId === "user_operator")
    );
    const scopedSerialized = JSON.stringify(scopedView);
    assert.doesNotMatch(scopedSerialized, new RegExp(second.id));
    assert.doesNotMatch(scopedSerialized, /After midnight report/);
    assert.doesNotMatch(scopedSerialized, /Second owner/);
    assert.doesNotMatch(scopedSerialized, new RegExp(unowned.id));
    assert.doesNotMatch(scopedSerialized, /Unowned report/);
    assert.doesNotMatch(scopedSerialized, /conversation:codex/);
    assert.doesNotMatch(scopedSerialized, /"codex"/);

    const emptyScopeView = getPsycheMetricsViewData({
      timeZone: "UTC",
      userIds: []
    });
    assert.equal(emptyScopeView.context.ownerScope.mode, "scoped");
    assert.equal(emptyScopeView.context.ownerScope.serverEnforced, true);
    assert.deepEqual(emptyScopeView.context.ownerScope.effectiveUserIds, []);
    assert.deepEqual(emptyScopeView.context.ownerScope.availableOwners, []);
    assert.deepEqual(emptyScopeView.metrics, []);
    assert.ok(
      emptyScopeView.context.sources.every((source) => source.recordCount === 0)
    );
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("devrage sync forces a full backfill when cumulative rage metric rows are missing", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-devrage-backfill-")
  );
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
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-devrage-resync-")
  );
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

test("devrage scanner attributes a multi-day thread to each message's own UTC day", () => {
  const conversations: ConversationRecord[] = [
    {
      source: "codex",
      conversationId: "multi-day",
      sourceFile: "/synthetic/multi-day.jsonl",
      updatedAt: "2026-05-15T00:02:00.000Z",
      messages: [
        message("multi-day", "shit", "2026-05-14T23:59:00.000Z"),
        message("multi-day", "clean", "2026-05-15T00:01:00.000Z"),
        message("multi-day", "fuck fuck", "2026-05-15T00:02:00.000Z")
      ]
    }
  ];

  const report = analyzeConversations(
    conversations,
    { roles: new Set<MessageRole>(["user"]), timeZone: "UTC" },
    "2026-05-15T01:00:00.000Z"
  );

  assert.equal(report.conversationsScanned, 1);
  assert.equal(report.conversations.length, 2);
  assert.deepEqual(
    report.daily.map((day) => ({
      dateKey: day.dateKey,
      conversations: day.conversations,
      messages: day.messages,
      swears: day.swears,
      maxCumulativeRage: day.maxCumulativeRage
    })),
    [
      {
        dateKey: "2026-05-15",
        conversations: 1,
        messages: 2,
        swears: 2,
        maxCumulativeRage: 2
      },
      {
        dateKey: "2026-05-14",
        conversations: 1,
        messages: 1,
        swears: 1,
        maxCumulativeRage: 1
      }
    ]
  );

  const firstDayOnly = analyzeConversations(conversations, {
    roles: new Set<MessageRole>(["user"]),
    date: "2026-05-14",
    timeZone: "UTC"
  });
  assert.equal(firstDayOnly.conversationsScanned, 1);
  assert.equal(firstDayOnly.messagesScanned, 1);
  assert.equal(firstDayOnly.conversations[0]?.dateKey, "2026-05-14");
});

test("devrage scanner uses the requested local time zone at midnight boundaries", () => {
  const report = analyzeConversations(
    [
      {
        source: "codex",
        conversationId: "zurich-midnight",
        sourceFile: "/synthetic/zurich-midnight.jsonl",
        updatedAt: "2026-05-14T22:01:00.000Z",
        messages: [
          message("zurich-midnight", "shit", "2026-05-14T21:59:00.000Z"),
          message("zurich-midnight", "fuck", "2026-05-14T22:01:00.000Z")
        ]
      }
    ],
    { roles: new Set<MessageRole>(["user"]), timeZone: "Europe/Zurich" },
    "2026-05-15T01:00:00.000Z"
  );

  assert.deepEqual(
    report.daily.map((day) => ({
      dateKey: day.dateKey,
      messages: day.messages
    })),
    [
      { dateKey: "2026-05-15", messages: 1 },
      { dateKey: "2026-05-14", messages: 1 }
    ]
  );
});

test("devrage scanner reports adapter failures as partial without losing warnings", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-devrage-adapter-failure-")
  );
  const previousDataHome = process.env["XDG_DATA_HOME"];

  try {
    const opencodeDir = path.join(rootDir, "opencode");
    await mkdir(opencodeDir, { recursive: true });
    await writeFile(
      path.join(opencodeDir, "opencode.db"),
      "not a sqlite database",
      "utf8"
    );
    process.env["XDG_DATA_HOME"] = rootDir;

    const report = await scanConversations({
      roles: new Set<MessageRole>(["user"]),
      sources: new Set(["opencode"]),
      timeZone: "UTC"
    });

    assert.equal(report.scanStatus, "partial");
    assert.deepEqual(report.failedSources, ["opencode"]);
    assert.equal(report.warnings.length, 1);
    assert.match(
      report.warnings[0]?.reason ?? "",
      /(opencode adapter failed|opencode database skipped)/i
    );
  } finally {
    if (previousDataHome === undefined) {
      delete process.env["XDG_DATA_HOME"];
    } else {
      process.env["XDG_DATA_HOME"] = previousDataHome;
    }
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("devrage scanner bounds oversized JSONL records and completes promptly", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-devrage-bounded-record-")
  );
  const previousHome = process.env["HOME"];

  try {
    const sessionDir = path.join(
      rootDir,
      ".codex",
      "sessions",
      "2026",
      "07",
      "15"
    );
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "oversized.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-07-15T10:00:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "x".repeat(32_000) }]
        }
      })}\n`,
      "utf8"
    );
    process.env["HOME"] = rootDir;

    const startedAt = performance.now();
    const budgetReport = await scanConversations({
      roles: new Set<MessageRole>(["user"]),
      sources: new Set(["codex"]),
      timeZone: "UTC",
      maxFileBytes: 64_000,
      maxRecordChars: 64_000,
      maxScanBytes: 1_024
    });
    const report = await scanConversations({
      roles: new Set<MessageRole>(["user"]),
      sources: new Set(["codex"]),
      timeZone: "UTC",
      maxFileBytes: 64_000,
      maxRecordChars: 1_024,
      maxScanBytes: 64_000
    });
    const elapsedMs = performance.now() - startedAt;

    assert.ok(elapsedMs < 2_000, `bounded scan took ${elapsedMs}ms`);
    assert.equal(budgetReport.scanStatus, "partial");
    assert.match(budgetReport.warnings[0]?.reason ?? "", /total scan limit/i);
    assert.equal(report.scanStatus, "partial");
    assert.deepEqual(report.failedSources, ["codex"]);
    assert.equal(report.messagesScanned, 0);
    assert.match(
      report.warnings[0]?.reason ?? "",
      /record exceeds.*scan limit/i
    );
  } finally {
    if (previousHome === undefined) {
      delete process.env["HOME"];
    } else {
      process.env["HOME"] = previousHome;
    }
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("devrage scanner cancellation returns partial status without hanging", async () => {
  const controller = new AbortController();
  controller.abort(new Error("test cancellation"));
  const startedAt = performance.now();

  const report = await scanConversations({
    roles: new Set<MessageRole>(["user"]),
    sources: new Set(["codex"]),
    timeZone: "UTC",
    signal: controller.signal
  });
  const elapsedMs = performance.now() - startedAt;

  assert.ok(elapsedMs < 250, `cancelled scan took ${elapsedMs}ms`);
  assert.equal(report.scanStatus, "partial");
  assert.deepEqual(report.failedSources, ["codex"]);
  assert.match(report.warnings[0]?.reason ?? "", /test cancellation/i);
});

test("empty authoritative daily scans remove only the requested day's stale rows", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-devrage-empty-daily-")
  );
  configureDatabase({ dataRoot: rootDir, seedDemoData: true });
  await initializeDatabase();

  try {
    storeDevrageReport(reportFixture(), {
      fullSync: true,
      syncedDateKey: null
    });
    const emptyDailyReport = reportFixture();
    emptyDailyReport.conversations = [];
    emptyDailyReport.scanStatus = "complete";

    storeDevrageReport(emptyDailyReport, {
      fullSync: false,
      syncedDateKey: "2026-05-14"
    });

    const database = getDatabase();
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM psyche_devrage_conversation_measures
             WHERE date_key = '2026-05-14'`
          )
          .get() as { count: number }
      ).count,
      0
    );
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM psyche_devrage_metric_measures
             WHERE date_key = '2026-05-14'`
          )
          .get() as { count: number }
      ).count,
      0
    );
    assert.equal(getDevrageMetricPayload().latestDateKey, "2026-05-13");
    assert.equal(
      getDevrageMetricPayload().sync.lastSyncedDateKey,
      "2026-05-14"
    );
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("daily authoritative rescans delete removed conversations and retain other days", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-devrage-removed-daily-")
  );
  configureDatabase({ dataRoot: rootDir, seedDemoData: true });
  await initializeDatabase();

  try {
    const initialReport = reportFixture();
    initialReport.conversations.push({
      source: "codex",
      conversationId: "today-removed",
      sourceFile: "/synthetic/codex/today-removed.jsonl",
      updatedAt: "2026-05-14T11:00:00.000Z",
      dateKey: "2026-05-14",
      messages: 2,
      messagesWithSwears: 1,
      swears: 1,
      maxCumulativeRage: 1,
      maxSwearingStreak: 1
    });
    storeDevrageReport(initialReport, { fullSync: true, syncedDateKey: null });

    const dailyReport = reportFixture();
    dailyReport.conversations = [dailyReport.conversations[2]!];
    storeDevrageReport(dailyReport, {
      fullSync: false,
      syncedDateKey: "2026-05-14"
    });

    const storedRows = getDatabase()
      .prepare(
        `SELECT conversation_id, date_key
         FROM psyche_devrage_conversation_measures
         ORDER BY date_key, conversation_id`
      )
      .all() as Array<{ conversation_id: string; date_key: string }>;
    assert.deepEqual(
      storedRows.map((row) => ({ ...row })),
      [
        { conversation_id: "older", date_key: "2026-05-12" },
        { conversation_id: "yesterday", date_key: "2026-05-13" },
        { conversation_id: "today", date_key: "2026-05-14" }
      ]
    );
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("full authoritative rescans delete obsolete conversation and metric rows", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-devrage-full-reconcile-")
  );
  configureDatabase({ dataRoot: rootDir, seedDemoData: true });
  await initializeDatabase();

  try {
    storeDevrageReport(reportFixture(), {
      fullSync: true,
      syncedDateKey: null
    });
    getDatabase()
      .prepare(
        `INSERT INTO psyche_devrage_metric_measures (
           id, date_key, metric_key, value, unit, sample_count, computed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "stale-metric",
        "2026-05-01",
        "swear_count",
        99,
        "count",
        1,
        "2026-05-01T12:00:00.000Z"
      );

    const replacementReport = reportFixture();
    replacementReport.conversations = [replacementReport.conversations[2]!];
    storeDevrageReport(replacementReport, {
      fullSync: true,
      syncedDateKey: null
    });

    assert.deepEqual(
      (
        getDatabase()
          .prepare(
            `SELECT DISTINCT date_key
           FROM psyche_devrage_conversation_measures
           ORDER BY date_key`
          )
          .all() as Array<{ date_key: string }>
      ).map((row) => row.date_key),
      ["2026-05-14"]
    );
    assert.deepEqual(
      (
        getDatabase()
          .prepare(
            `SELECT DISTINCT date_key
             FROM psyche_devrage_metric_measures
             ORDER BY date_key`
          )
          .all() as Array<{ date_key: string }>
      ).map((row) => row.date_key),
      ["2026-05-14"]
    );
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("empty authoritative full scans clear stale rows and stale date state", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-devrage-empty-full-")
  );
  configureDatabase({ dataRoot: rootDir, seedDemoData: true });
  await initializeDatabase();

  try {
    storeDevrageReport(reportFixture(), {
      fullSync: true,
      syncedDateKey: null
    });
    const emptyReport = reportFixture();
    emptyReport.conversations = [];
    emptyReport.scanStatus = "complete";
    storeDevrageReport(emptyReport, { fullSync: true, syncedDateKey: null });

    const database = getDatabase();
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM psyche_devrage_conversation_measures`
          )
          .get() as { count: number }
      ).count,
      0
    );
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM psyche_devrage_metric_measures`
          )
          .get() as { count: number }
      ).count,
      0
    );
    const state = database
      .prepare(
        `SELECT full_sync_completed_at, last_synced_date_key
         FROM psyche_devrage_sync_state
         WHERE id = 'default'`
      )
      .get() as {
      full_sync_completed_at: string | null;
      last_synced_date_key: string | null;
    };
    assert.ok(state.full_sync_completed_at);
    assert.equal(state.last_synced_date_key, null);
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("partial devrage reports preserve stored evidence and freshness state", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-devrage-partial-")
  );
  configureDatabase({ dataRoot: rootDir, seedDemoData: true });
  await initializeDatabase();

  try {
    storeDevrageReport(reportFixture(), {
      fullSync: true,
      syncedDateKey: null
    });
    const database = getDatabase();
    const evidenceBefore = database
      .prepare(`SELECT * FROM psyche_devrage_conversation_measures ORDER BY id`)
      .all();
    const metricsBefore = database
      .prepare(`SELECT * FROM psyche_devrage_metric_measures ORDER BY id`)
      .all();
    const stateBefore = database
      .prepare(`SELECT * FROM psyche_devrage_sync_state WHERE id = 'default'`)
      .get();
    const partialReport = reportFixture();
    partialReport.conversations = [];
    partialReport.scanStatus = "partial";
    partialReport.failedSources = ["codex"];
    partialReport.warnings = [
      {
        file: "/synthetic/codex/broken.jsonl",
        line: 4,
        reason: "Invalid JSONL record skipped."
      }
    ];

    assert.throws(
      () =>
        storeDevrageReport(partialReport, {
          fullSync: true,
          syncedDateKey: null
        }),
      (error) => {
        assert.ok(error instanceof DevrageScanIncompleteError);
        assert.deepEqual(error.failedSources, ["codex"]);
        assert.deepEqual(error.warnings, partialReport.warnings);
        assert.match(error.message, /freshness state were preserved/i);
        return true;
      }
    );

    assert.deepEqual(
      database
        .prepare(
          `SELECT * FROM psyche_devrage_conversation_measures ORDER BY id`
        )
        .all(),
      evidenceBefore
    );
    assert.deepEqual(
      database
        .prepare(`SELECT * FROM psyche_devrage_metric_measures ORDER BY id`)
        .all(),
      metricsBefore
    );
    assert.deepEqual(
      database
        .prepare(`SELECT * FROM psyche_devrage_sync_state WHERE id = 'default'`)
        .get(),
      stateBefore
    );
    const metricsView = getPsycheMetricsViewData();
    assert.equal(metricsView.context.freshness.status, "partial");
    assert.equal(
      metricsView.context.freshness.lastSuccessfulAt,
      (stateBefore as { full_sync_completed_at: string }).full_sync_completed_at
    );
    assert.match(
      metricsView.context.freshness.warnings.join(" "),
      /source scan did not complete/i
    );
    assert.match(
      metricsView.context.freshness.warnings.join(" "),
      /invalid JSONL record skipped/i
    );
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
  assert.equal(
    report.conversations.find(
      (conversation) => conversation.conversationId === "thread-a"
    )?.maxCumulativeRage,
    3
  );
  assert.equal(
    report.conversations.find(
      (conversation) => conversation.conversationId === "thread-a"
    )?.maxSwearingStreak,
    2
  );
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
  assert.deepEqual(
    getNextDevrageMetricSync(null, new Date("2026-05-19T10:00:00.000Z")),
    {
      forceFull: true
    }
  );

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
