import { createHash } from "node:crypto";
import {
  scanConversations,
  type DevrageReport,
  type MessageRole
} from "./devrage-scanner.js";
import { getDatabase, runInTransaction } from "../db.js";
import { psycheMetricsViewDataSchema, type PsycheMetricsViewData } from "../psyche-types.js";

const SWEAR_COUNT_KEY = "swear_count";
const SWEARING_MESSAGE_PERCENT_KEY = "swearing_message_percent";
const AVERAGE_MAX_CUMULATIVE_RAGE_KEY = "average_max_cumulative_rage";
const MAX_CUMULATIVE_RAGE_KEY = "max_cumulative_rage";
const DEFAULT_ROLE_FILTER = new Set<MessageRole>(["user"]);
const DAILY_RESYNC_INTERVAL_MS = 60 * 60 * 1000;

const PSYCHE_METRIC_DEFINITIONS = {
  [SWEAR_COUNT_KEY]: {
    metric: "devrageSwearCount",
    label: "Devrage swears",
    category: "conversationTone",
    unit: "swears",
    aggregation: "cumulative" as const
  },
  [SWEARING_MESSAGE_PERCENT_KEY]: {
    metric: "swearingMessagePercent",
    label: "Swearing messages",
    category: "conversationTone",
    unit: "%",
    aggregation: "discrete" as const
  },
  [AVERAGE_MAX_CUMULATIVE_RAGE_KEY]: {
    metric: "devrageAverageMaxCumulativeRage",
    label: "Average max cumulative rage",
    category: "conversationTone",
    unit: "score",
    aggregation: "discrete" as const
  },
  [MAX_CUMULATIVE_RAGE_KEY]: {
    metric: "devrageMaxCumulativeRage",
    label: "Max cumulative rage",
    category: "conversationTone",
    unit: "score",
    aggregation: "discrete" as const
  }
};

interface DevrageConversationMeasureRow {
  date_key: string;
  conversations: number;
  messages: number;
  messages_with_swears: number;
  swear_count: number;
  average_max_cumulative_rage: number;
  max_cumulative_rage: number;
  max_swearing_streak: number;
}

interface DevrageSyncStateRow {
  full_sync_completed_at: string | null;
  last_daily_sync_at: string | null;
  last_synced_date_key: string | null;
  updated_at: string;
}

interface DevrageMetricMeasureRow {
  date_key: string;
  metric_key: string;
  value: number;
  unit: string;
  sample_count: number;
  computed_at: string;
}

interface DevrageConversationTotalsRow {
  conversations: number;
  sources: number;
  messages: number;
  messages_with_swears: number;
  swear_count: number;
  average_max_cumulative_rage: number;
  max_cumulative_rage: number;
  max_swearing_streak: number;
}

export interface DevrageMetricPayload {
  generatedAt: string;
  hasData: boolean;
  latestDateKey: string | null;
  rawSwearCount: number;
  swearingMessagePercent: number;
  averageMaxCumulativeRage: number;
  maxCumulativeRage: number;
  maxSwearingStreak: number;
  conversationsScanned: number;
  messagesScanned: number;
  messagesWithSwears: number;
  dailyAverage: {
    rawSwearCount: number;
    swearingMessagePercent: number;
    averageMaxCumulativeRage: number;
    maxCumulativeRage: number;
  };
  weeklyAverage: {
    rawSwearCount: number;
    swearingMessagePercent: number;
    averageMaxCumulativeRage: number;
    maxCumulativeRage: number;
  };
  history: Array<{
    dateKey: string;
    rawSwearCount: number;
    swearingMessagePercent: number;
    averageMaxCumulativeRage: number;
    maxCumulativeRage: number;
    maxSwearingStreak: number;
    conversationsScanned: number;
    messagesScanned: number;
    messagesWithSwears: number;
  }>;
  sync: {
    fullSyncCompletedAt: string | null;
    lastDailySyncAt: string | null;
    lastSyncedDateKey: string | null;
  };
}

let syncInFlight: Promise<void> | null = null;

export async function syncDevrageMetricHistory(options: { forceFull?: boolean; dateKey?: string } = {}) {
  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = syncDevrageMetricHistoryInternal(options).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

export async function syncDevrageMetricHistoryIfNeeded() {
  const state = getDevrageSyncState();
  const nextSync = getNextDevrageMetricSync(state);
  if (nextSync) {
    await syncDevrageMetricHistory(nextSync);
  }
}

export function getNextDevrageMetricSync(
  state: DevrageSyncStateRow | null,
  now = new Date()
): { forceFull?: boolean; dateKey?: string } | null {
  if (!state?.full_sync_completed_at) {
    return { forceFull: true };
  }

  const today = todayDateKey(now);
  if (state.last_synced_date_key !== today) {
    return { dateKey: today };
  }

  const lastTodaySync = Date.parse(
    state.last_daily_sync_at ?? state.full_sync_completed_at ?? state.updated_at
  );
  if (!Number.isFinite(lastTodaySync)) {
    return { dateKey: today };
  }

  if (now.getTime() - lastTodaySync >= DAILY_RESYNC_INTERVAL_MS) {
    return { dateKey: today };
  }

  return null;
}

export function getDevrageMetricPayload(): DevrageMetricPayload {
  const generatedAt = nowIso();
  const state = getDevrageSyncState();
  const history = getDevrageDailyHistory(90);
  const latest = history[0] ?? null;
  const dailyAverages = getMetricAverages();
  const weeklyAverages = getMetricAverages(7);

  return {
    generatedAt,
    hasData: history.some((day) => day.conversationsScanned > 0),
    latestDateKey: latest?.dateKey ?? null,
    rawSwearCount: latest?.rawSwearCount ?? 0,
    swearingMessagePercent: latest?.swearingMessagePercent ?? 0,
    averageMaxCumulativeRage: latest?.averageMaxCumulativeRage ?? 0,
    maxCumulativeRage: latest?.maxCumulativeRage ?? 0,
    maxSwearingStreak: latest?.maxSwearingStreak ?? 0,
    conversationsScanned: latest?.conversationsScanned ?? 0,
    messagesScanned: latest?.messagesScanned ?? 0,
    messagesWithSwears: latest?.messagesWithSwears ?? 0,
    dailyAverage: {
      rawSwearCount: dailyAverages.rawSwearCount,
      swearingMessagePercent: dailyAverages.swearingMessagePercent,
      averageMaxCumulativeRage: dailyAverages.averageMaxCumulativeRage,
      maxCumulativeRage: dailyAverages.maxCumulativeRage
    },
    weeklyAverage: {
      rawSwearCount: weeklyAverages.rawSwearCount,
      swearingMessagePercent: weeklyAverages.swearingMessagePercent,
      averageMaxCumulativeRage: weeklyAverages.averageMaxCumulativeRage,
      maxCumulativeRage: weeklyAverages.maxCumulativeRage
    },
    history,
    sync: {
      fullSyncCompletedAt: state?.full_sync_completed_at ?? null,
      lastDailySyncAt: state?.last_daily_sync_at ?? null,
      lastSyncedDateKey: state?.last_synced_date_key ?? null
    }
  };
}

export function getPsycheMetricsViewData(): PsycheMetricsViewData {
  const rows = getDatabase()
    .prepare(
      `SELECT date_key, metric_key, value, unit, sample_count, computed_at
       FROM psyche_devrage_metric_measures
       ORDER BY date_key ASC, metric_key ASC`
    )
    .all() as unknown as DevrageMetricMeasureRow[];
  const metricBuckets = new Map<
    string,
    {
      label: string;
      category: string;
      unit: string;
      aggregation: "discrete" | "cumulative";
      days: Map<string, DevrageMetricMeasureRow[]>;
    }
  >();

  for (const row of rows) {
    const definition =
      PSYCHE_METRIC_DEFINITIONS[
        row.metric_key as keyof typeof PSYCHE_METRIC_DEFINITIONS
      ];
    if (!definition) {
      continue;
    }
    const bucket = metricBuckets.get(definition.metric) ?? {
      label: definition.label,
      category: definition.category,
      unit: definition.unit,
      aggregation: definition.aggregation,
      days: new Map<string, DevrageMetricMeasureRow[]>()
    };
    const dayRows = bucket.days.get(row.date_key) ?? [];
    dayRows.push(row);
    bucket.days.set(row.date_key, dayRows);
    metricBuckets.set(definition.metric, bucket);
  }

  const metrics = [...metricBuckets.entries()]
    .map(([metric, bucket]) => {
      const days = [...bucket.days.entries()]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([dateKey, entries]) => {
          const values = entries.map((entry) => Number(entry.value) || 0);
          const value = average(values);
          return {
            dateKey,
            average: round(value, bucket.aggregation === "cumulative" ? 0 : 1),
            minimum: round(Math.min(...values), bucket.aggregation === "cumulative" ? 0 : 1),
            maximum: round(Math.max(...values), bucket.aggregation === "cumulative" ? 0 : 1),
            latest: round(values.at(-1) ?? value, bucket.aggregation === "cumulative" ? 0 : 1),
            total:
              bucket.aggregation === "cumulative"
                ? round(sumNullable(values), 0)
                : null,
            sampleCount: entries.reduce((sum, entry) => sum + Number(entry.sample_count || 0), 0),
            latestSampleAt:
              entries
                .map((entry) => entry.computed_at)
                .filter(Boolean)
                .sort()
                .at(-1) ?? null
          };
        });
      const latestDay =
        [...days].reverse().find((day) =>
          psycheMetricPrimaryValue({
            aggregation: bucket.aggregation,
            latest: day.latest,
            average: day.average,
            total: day.total,
            maximum: day.maximum
          }) !== null
        ) ?? null;
      const recentValues = days
        .map((day) =>
          psycheMetricPrimaryValue({
            aggregation: bucket.aggregation,
            latest: day.latest,
            average: day.average,
            total: day.total,
            maximum: day.maximum
          })
        )
        .filter((value): value is number => value != null);
      const baselineValues = recentValues.slice(
        Math.max(0, recentValues.length - 8),
        recentValues.length - 1
      );
      const baselineValue =
        baselineValues.length > 0 ? average(baselineValues) : recentValues.at(-2) ?? null;
      const latestValue = latestDay
        ? psycheMetricPrimaryValue({
            aggregation: bucket.aggregation,
            latest: latestDay.latest,
            average: latestDay.average,
            total: latestDay.total,
            maximum: latestDay.maximum
          })
        : null;
      const digits = bucket.aggregation === "cumulative" ? 0 : 1;
      return {
        metric,
        label: bucket.label,
        category: bucket.category,
        unit: bucket.unit,
        aggregation: bucket.aggregation,
        latestValue: latestValue == null ? null : round(latestValue, digits),
        latestDateKey: latestDay?.dateKey ?? null,
        baselineValue: baselineValue == null ? null : round(baselineValue, digits),
        deltaValue:
          latestValue != null && baselineValue != null
            ? round(latestValue - baselineValue, digits)
            : null,
        coverageDays: days.filter((day) => day.sampleCount > 0).length,
        days
      };
    })
    .sort((left, right) => {
      if (left.category === right.category) {
        return left.label.localeCompare(right.label);
      }
      return left.category.localeCompare(right.category);
    });

  const latestDateKey = rows.map((row) => row.date_key).sort().at(-1) ?? null;
  const trackedDays = new Set(rows.map((row) => row.date_key)).size;
  const categoryBreakdown = [...new Set(metrics.map((metric) => metric.category))]
    .map((category) => {
      const categoryMetrics = metrics.filter((metric) => metric.category === category);
      return {
        category,
        metricCount: categoryMetrics.length,
        coverageDays: Math.max(...categoryMetrics.map((metric) => metric.coverageDays), 0)
      };
    })
    .sort((left, right) => right.metricCount - left.metricCount);
  const context = getDevrageConversationTotals();
  const dailyAverages = getMetricAverages();
  const weeklyAverages = getMetricAverages(7);
  const state = getDevrageSyncState();

  return psycheMetricsViewDataSchema.parse({
    summary: {
      hasData: metrics.length > 0 && context.conversations > 0,
      trackedDays,
      metricCount: metrics.length,
      latestDateKey,
      latestMetricCount: metrics.filter((metric) => metric.latestDateKey === latestDateKey).length,
      categoryBreakdown
    },
    context: {
      generatedAt: nowIso(),
      conversationsScanned: Number(context.conversations) || 0,
      sourceCount: Number(context.sources) || 0,
      messagesScanned: Number(context.messages) || 0,
      messagesWithSwears: Number(context.messages_with_swears) || 0,
      totalSwears: Number(context.swear_count) || 0,
      dailyAverage: {
        rawSwearCount: dailyAverages.rawSwearCount,
        swearingMessagePercent: dailyAverages.swearingMessagePercent,
        averageMaxCumulativeRage: dailyAverages.averageMaxCumulativeRage,
        maxCumulativeRage: dailyAverages.maxCumulativeRage
      },
      weeklyAverage: {
        rawSwearCount: weeklyAverages.rawSwearCount,
        swearingMessagePercent: weeklyAverages.swearingMessagePercent,
        averageMaxCumulativeRage: weeklyAverages.averageMaxCumulativeRage,
        maxCumulativeRage: weeklyAverages.maxCumulativeRage
      },
      sync: {
        fullSyncCompletedAt: state?.full_sync_completed_at ?? null,
        lastDailySyncAt: state?.last_daily_sync_at ?? null,
        lastSyncedDateKey: state?.last_synced_date_key ?? null
      }
    },
    metrics
  });
}

async function syncDevrageMetricHistoryInternal(options: { forceFull?: boolean; dateKey?: string }) {
  const dateKey = options.forceFull ? undefined : options.dateKey ?? todayDateKey();
  const report = await scanConversations({
    roles: DEFAULT_ROLE_FILTER,
    date: dateKey,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  });
  storeDevrageReport(report, {
    fullSync: Boolean(options.forceFull),
    syncedDateKey: dateKey ?? null
  });
}

export function storeDevrageReport(
  report: DevrageReport,
  options: { fullSync: boolean; syncedDateKey: string | null }
) {
  const scannedAt = nowIso();
  const affectedDateKeys = new Set(report.conversations.map((conversation) => conversation.dateKey));

  runInTransaction(() => {
    const database = getDatabase();
    const deleteDate = database.prepare(
      `DELETE FROM psyche_devrage_conversation_measures WHERE date_key = ?`
    );
    const insertConversation = database.prepare(
      `INSERT INTO psyche_devrage_conversation_measures (
         id, source, conversation_id, date_key, updated_at, messages,
         messages_with_swears, swear_count, max_cumulative_rage,
         max_swearing_streak, scanned_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source, conversation_id, date_key) DO UPDATE SET
         updated_at = excluded.updated_at,
         messages = excluded.messages,
         messages_with_swears = excluded.messages_with_swears,
         swear_count = excluded.swear_count,
         max_cumulative_rage = excluded.max_cumulative_rage,
         max_swearing_streak = excluded.max_swearing_streak,
         scanned_at = excluded.scanned_at`
    );

    for (const dateKey of affectedDateKeys) {
      deleteDate.run(dateKey);
    }

    for (const conversation of report.conversations) {
      insertConversation.run(
        stableId("devrage_conversation", conversation.source, conversation.conversationId, conversation.dateKey),
        conversation.source,
        conversation.conversationId,
        conversation.dateKey,
        conversation.updatedAt,
        conversation.messages,
        conversation.messagesWithSwears,
        conversation.swears,
        conversation.maxCumulativeRage,
        conversation.maxSwearingStreak,
        scannedAt
      );
    }

    for (const dateKey of affectedDateKeys) {
      recomputeMetricMeasuresForDate(dateKey, scannedAt);
    }

    upsertSyncState({
      fullSyncCompletedAt: options.fullSync ? scannedAt : undefined,
      lastDailySyncAt: options.fullSync ? undefined : scannedAt,
      lastSyncedDateKey: options.syncedDateKey ?? [...affectedDateKeys].sort().at(-1) ?? null,
      updatedAt: scannedAt
    });
  });
}

function recomputeMetricMeasuresForDate(dateKey: string, computedAt: string) {
  const aggregate = getDatabase()
    .prepare(
      `SELECT
         COUNT(*) AS conversations,
         COALESCE(SUM(messages), 0) AS messages,
         COALESCE(SUM(messages_with_swears), 0) AS messages_with_swears,
         COALESCE(SUM(swear_count), 0) AS swear_count,
         COALESCE(AVG(max_cumulative_rage), 0) AS average_max_cumulative_rage,
         COALESCE(MAX(max_cumulative_rage), 0) AS max_cumulative_rage,
         COALESCE(MAX(max_swearing_streak), 0) AS max_swearing_streak
       FROM psyche_devrage_conversation_measures
       WHERE date_key = ?`
    )
    .get(dateKey) as unknown as Omit<DevrageConversationMeasureRow, "date_key">;
  const messages = Number(aggregate.messages) || 0;
  const messagesWithSwears = Number(aggregate.messages_with_swears) || 0;
  const swearCount = Number(aggregate.swear_count) || 0;
  const averageMaxCumulativeRage = Number(aggregate.average_max_cumulative_rage) || 0;
  const maxCumulativeRage = Number(aggregate.max_cumulative_rage) || 0;
  const percent = messages > 0 ? (messagesWithSwears / messages) * 100 : 0;

  upsertMetricMeasure(dateKey, SWEAR_COUNT_KEY, swearCount, "count", Number(aggregate.conversations) || 0, computedAt);
  upsertMetricMeasure(dateKey, SWEARING_MESSAGE_PERCENT_KEY, percent, "percent", messages, computedAt);
  upsertMetricMeasure(
    dateKey,
    AVERAGE_MAX_CUMULATIVE_RAGE_KEY,
    averageMaxCumulativeRage,
    "score",
    Number(aggregate.conversations) || 0,
    computedAt
  );
  upsertMetricMeasure(
    dateKey,
    MAX_CUMULATIVE_RAGE_KEY,
    maxCumulativeRage,
    "score",
    Number(aggregate.conversations) || 0,
    computedAt
  );
}

function upsertMetricMeasure(
  dateKey: string,
  metricKey: string,
  value: number,
  unit: string,
  sampleCount: number,
  computedAt: string
) {
  getDatabase()
    .prepare(
      `INSERT INTO psyche_devrage_metric_measures (
         id, date_key, metric_key, value, unit, sample_count, computed_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date_key, metric_key) DO UPDATE SET
         value = excluded.value,
         unit = excluded.unit,
         sample_count = excluded.sample_count,
         computed_at = excluded.computed_at`
    )
    .run(stableId("devrage_metric", dateKey, metricKey), dateKey, metricKey, value, unit, sampleCount, computedAt);
}

function upsertSyncState(input: {
  fullSyncCompletedAt?: string;
  lastDailySyncAt?: string;
  lastSyncedDateKey: string | null;
  updatedAt: string;
}) {
  const current = getDevrageSyncState();
  getDatabase()
    .prepare(
      `INSERT INTO psyche_devrage_sync_state (
         id, full_sync_completed_at, last_daily_sync_at, last_synced_date_key, updated_at
       )
       VALUES ('default', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         full_sync_completed_at = excluded.full_sync_completed_at,
         last_daily_sync_at = excluded.last_daily_sync_at,
         last_synced_date_key = excluded.last_synced_date_key,
         updated_at = excluded.updated_at`
    )
    .run(
      input.fullSyncCompletedAt ?? current?.full_sync_completed_at ?? null,
      input.lastDailySyncAt ?? current?.last_daily_sync_at ?? null,
      input.lastSyncedDateKey ?? current?.last_synced_date_key ?? null,
      input.updatedAt
    );
}

function getDevrageSyncState(): DevrageSyncStateRow | null {
  return (
    (getDatabase()
      .prepare(
        `SELECT full_sync_completed_at, last_daily_sync_at, last_synced_date_key, updated_at
         FROM psyche_devrage_sync_state
         WHERE id = 'default'`
      )
      .get() as DevrageSyncStateRow | undefined) ?? null
  );
}

function getDevrageDailyHistory(limit: number): DevrageMetricPayload["history"] {
  const rows = getDatabase()
    .prepare(
      `SELECT
         date_key,
         COUNT(*) AS conversations,
         COALESCE(SUM(messages), 0) AS messages,
         COALESCE(SUM(messages_with_swears), 0) AS messages_with_swears,
         COALESCE(SUM(swear_count), 0) AS swear_count,
         COALESCE(AVG(max_cumulative_rage), 0) AS average_max_cumulative_rage,
         COALESCE(MAX(max_cumulative_rage), 0) AS max_cumulative_rage,
         COALESCE(MAX(max_swearing_streak), 0) AS max_swearing_streak
       FROM psyche_devrage_conversation_measures
       GROUP BY date_key
       ORDER BY date_key DESC
       LIMIT ?`
    )
    .all(limit) as unknown as DevrageConversationMeasureRow[];

  return rows.map((row) => {
    const messages = Number(row.messages) || 0;
    const messagesWithSwears = Number(row.messages_with_swears) || 0;
    return {
      dateKey: row.date_key,
      rawSwearCount: Number(row.swear_count) || 0,
      swearingMessagePercent: messages > 0 ? (messagesWithSwears / messages) * 100 : 0,
      averageMaxCumulativeRage: Number(row.average_max_cumulative_rage) || 0,
      maxCumulativeRage: Number(row.max_cumulative_rage) || 0,
      maxSwearingStreak: Number(row.max_swearing_streak) || 0,
      conversationsScanned: Number(row.conversations) || 0,
      messagesScanned: messages,
      messagesWithSwears
    };
  });
}

function getMetricAverages(days?: number) {
  const where = days
    ? `WHERE date_key IN (
         SELECT date_key FROM psyche_devrage_metric_measures
         GROUP BY date_key
         ORDER BY date_key DESC
         LIMIT ?
       )`
    : "";
  const rows = getDatabase()
    .prepare(
      `SELECT metric_key, AVG(value) AS value
       FROM psyche_devrage_metric_measures
       ${where}
       GROUP BY metric_key`
    )
    .all(...(days ? [days] : [])) as Array<{ metric_key: string; value: number | null }>;
  const swearAverage = rows.find((row) => row.metric_key === SWEAR_COUNT_KEY)?.value ?? 0;
  const percentAverage = rows.find((row) => row.metric_key === SWEARING_MESSAGE_PERCENT_KEY)?.value ?? 0;
  const averageMaxCumulativeRage =
    rows.find((row) => row.metric_key === AVERAGE_MAX_CUMULATIVE_RAGE_KEY)?.value ?? 0;
  const maxCumulativeRage = rows.find((row) => row.metric_key === MAX_CUMULATIVE_RAGE_KEY)?.value ?? 0;

  return {
    rawSwearCount: round(Number(swearAverage) || 0, 1),
    swearingMessagePercent: round(Number(percentAverage) || 0, 1),
    averageMaxCumulativeRage: round(Number(averageMaxCumulativeRage) || 0, 1),
    maxCumulativeRage: round(Number(maxCumulativeRage) || 0, 1)
  };
}

function getDevrageConversationTotals(): DevrageConversationTotalsRow {
  return getDatabase()
    .prepare(
      `SELECT
         COUNT(*) AS conversations,
         COUNT(DISTINCT source) AS sources,
         COALESCE(SUM(messages), 0) AS messages,
         COALESCE(SUM(messages_with_swears), 0) AS messages_with_swears,
         COALESCE(SUM(swear_count), 0) AS swear_count,
         COALESCE(AVG(max_cumulative_rage), 0) AS average_max_cumulative_rage,
         COALESCE(MAX(max_cumulative_rage), 0) AS max_cumulative_rage,
         COALESCE(MAX(max_swearing_streak), 0) AS max_swearing_streak
       FROM psyche_devrage_conversation_measures`
    )
    .get() as unknown as DevrageConversationTotalsRow;
}

function psycheMetricPrimaryValue(metric: {
  aggregation: string;
  latest: number | null;
  average: number | null;
  total: number | null;
  maximum: number | null;
}) {
  if (metric.aggregation === "cumulative") {
    return metric.total ?? metric.latest;
  }
  return metric.latest ?? metric.average ?? metric.maximum;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sumNullable(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0);
}

function stableId(prefix: string, ...parts: string[]) {
  const digest = createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 20);
  return `${prefix}_${digest}`;
}

function todayDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function nowIso() {
  return new Date().toISOString();
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
