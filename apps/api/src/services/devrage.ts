import { createHash } from "node:crypto";
import {
  scanConversations,
  type DevrageReport,
  type MessageRole
} from "./devrage-scanner.js";
import { getDatabase, runInTransaction } from "../db.js";
import {
  psycheMetricsViewDataSchema,
  type PsycheMetricsViewData
} from "../psyche-types.js";

const SWEAR_COUNT_KEY = "swear_count";
const SWEARING_MESSAGE_PERCENT_KEY = "swearing_message_percent";
const AVERAGE_MAX_CUMULATIVE_RAGE_KEY = "average_max_cumulative_rage";
const MAX_CUMULATIVE_RAGE_KEY = "max_cumulative_rage";
const REPORTED_EMOTION_INTENSITY_METRIC = "reportedEmotionIntensity";
const DEFAULT_ROLE_FILTER = new Set<MessageRole>(["user"]);
const DAILY_RESYNC_INTERVAL_MS = 60 * 60 * 1000;
const DEVRAGE_SCAN_TIMEOUT_MS = 5_000;
const FRESHNESS_STALE_AFTER_MS = DAILY_RESYNC_INTERVAL_MS * 2;

type PsycheMetric = PsycheMetricsViewData["metrics"][number];
type PsycheMetricDay = PsycheMetric["days"][number];

const PSYCHE_METRIC_DEFINITIONS = {
  [SWEAR_COUNT_KEY]: {
    metric: "devrageSwearCount",
    label: "Devrage swears",
    category: "conversationTone",
    unit: "swears",
    aggregation: "cumulative" as const,
    family: "conversation" as const,
    cadence: "daily" as const,
    sampleUnit: "conversations",
    definition: {
      description: "Tracked swear tokens in user messages for each stored day.",
      calculation:
        "Daily sum of tracked swear tokens across scanned user-role messages.",
      interpretation:
        "A lexical conversation signal only; it is not a mood, anger, distress, or diagnostic score.",
      missingness:
        "No stored day means no authoritative scanner reading. A stored zero with samples is a measured zero."
    }
  },
  [SWEARING_MESSAGE_PERCENT_KEY]: {
    metric: "swearingMessagePercent",
    label: "Swearing messages",
    category: "conversationTone",
    unit: "%",
    aggregation: "discrete" as const,
    family: "conversation" as const,
    cadence: "daily" as const,
    sampleUnit: "messages",
    definition: {
      description: "Share of scanned user messages containing a tracked swear.",
      calculation:
        "Daily swear-bearing user messages divided by scanned user messages, multiplied by 100.",
      interpretation:
        "The rate controls for message volume but does not establish intent, emotion, or severity.",
      missingness:
        "No stored day means no authoritative scanner reading. A stored zero with samples is a measured zero."
    }
  },
  [AVERAGE_MAX_CUMULATIVE_RAGE_KEY]: {
    metric: "devrageAverageMaxCumulativeRage",
    label: "Average max cumulative rage",
    category: "conversationTone",
    unit: "score",
    aggregation: "discrete" as const,
    family: "conversation" as const,
    cadence: "daily" as const,
    sampleUnit: "conversations",
    definition: {
      description:
        "Average of each scanned conversation's highest running lexical score.",
      calculation:
        "Within each thread, tracked swear tokens add to a running score and clean user messages reduce it by one, floored at zero; the daily metric averages each thread's peak.",
      interpretation:
        "A deterministic conversation pattern, not a calibrated psychological scale.",
      missingness:
        "No stored day means no authoritative scanner reading. A stored zero with samples is a measured zero."
    }
  },
  [MAX_CUMULATIVE_RAGE_KEY]: {
    metric: "devrageMaxCumulativeRage",
    label: "Max cumulative rage",
    category: "conversationTone",
    unit: "score",
    aggregation: "discrete" as const,
    family: "conversation" as const,
    cadence: "daily" as const,
    sampleUnit: "conversations",
    definition: {
      description:
        "Highest running lexical score reached in any scanned conversation.",
      calculation:
        "Daily maximum thread peak from the same add-on-swear and cool-on-clean-message rule.",
      interpretation:
        "Sensitive to one extreme thread and unsuitable as a stand-alone wellbeing conclusion.",
      missingness:
        "No stored day means no authoritative scanner reading. A stored zero with samples is a measured zero."
    }
  }
};

const REPORTED_EMOTION_INTENSITY_DEFINITION = {
  metric: REPORTED_EMOTION_INTENSITY_METRIC,
  label: "Reported emotion intensity",
  category: "mood",
  unit: "/100",
  aggregation: "discrete" as const,
  family: "mood" as const,
  cadence: "event_based" as const,
  sampleUnit: "emotion ratings",
  definition: {
    description:
      "Average intensity of emotions explicitly entered on dated trigger reports.",
    calculation:
      "Arithmetic mean of the report-entered 0-100 emotion intensities for each local calendar day.",
    interpretation:
      "This describes reported emotional intensity without inferring valence, mood quality, cause, or diagnosis.",
    missingness:
      "Trigger reports are event-based. A day without a dated emotion report is no observation, not zero emotion."
  }
};

const UNESTIMATED_CONFIDENCE = {
  status: "not_estimated" as const,
  rationale:
    "The aggregate is deterministic, but Forge has no calibration, uncertainty model, or validated confidence threshold for this signal."
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

interface TriggerReportMetricRow {
  id: string;
  title: string;
  occurred_at: string | null;
  emotions_json: string;
  updated_at: string;
  user_id: string | null;
  display_name: string | null;
}

interface DevrageSourceRow {
  source: string;
  record_count: number;
}

interface MoodMetricResult {
  metric: PsycheMetric | null;
  sourceRecordCount: number;
  owners: Array<{ userId: string; displayName: string }>;
  unattributedRecordCount: number;
  warnings: string[];
}

interface DevrageRuntimeSyncIssue {
  database: unknown;
  attemptedAt: string;
  warnings: string[];
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

export class DevrageScanIncompleteError extends Error {
  readonly warnings: DevrageReport["warnings"];
  readonly failedSources: NonNullable<DevrageReport["failedSources"]>;

  constructor(report: DevrageReport) {
    const failedSources = report.failedSources ?? [];
    const warningSummary = report.warnings
      .slice(0, 3)
      .map((warning) => `${warning.file}:${warning.line} ${warning.reason}`)
      .join("; ");
    super(
      `Devrage scan was partial${failedSources.length > 0 ? ` for ${failedSources.join(", ")}` : ""}; ` +
        `stored metrics and freshness state were preserved${warningSummary ? `. ${warningSummary}` : "."}`
    );
    this.name = "DevrageScanIncompleteError";
    this.warnings = report.warnings;
    this.failedSources = failedSources;
  }
}

let syncInFlight: Promise<void> | null = null;
let latestRuntimeSyncIssue: DevrageRuntimeSyncIssue | null = null;

export async function syncDevrageMetricHistory(
  options: { forceFull?: boolean; dateKey?: string } = {}
) {
  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = syncDevrageMetricHistoryInternal(options)
    .catch((error: unknown) => {
      if (!(error instanceof DevrageScanIncompleteError)) {
        latestRuntimeSyncIssue = {
          database: getDatabase(),
          attemptedAt: nowIso(),
          warnings: [
            error instanceof Error
              ? error.message
              : "The conversation scanner failed without an error message."
          ]
        };
      }
      throw error;
    })
    .finally(() => {
      syncInFlight = null;
    });
  return syncInFlight;
}

export async function syncDevrageMetricHistoryIfNeeded() {
  const state = getDevrageSyncState();
  const nextSync = getNextDevrageMetricSync(
    state,
    new Date(),
    needsDevrageCumulativeRageBackfill()
  );
  if (nextSync) {
    await syncDevrageMetricHistory(nextSync);
  }
}

export function getNextDevrageMetricSync(
  state: DevrageSyncStateRow | null,
  now = new Date(),
  needsCumulativeRageBackfill = false
): { forceFull?: boolean; dateKey?: string } | null {
  if (!state?.full_sync_completed_at) {
    return { forceFull: true };
  }

  if (needsCumulativeRageBackfill) {
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

export function needsDevrageCumulativeRageBackfill() {
  const rows = getDatabase()
    .prepare(
      `SELECT metric_key, COUNT(*) AS count
       FROM psyche_devrage_metric_measures
       WHERE metric_key IN (?, ?, ?, ?)
       GROUP BY metric_key`
    )
    .all(
      SWEAR_COUNT_KEY,
      SWEARING_MESSAGE_PERCENT_KEY,
      AVERAGE_MAX_CUMULATIVE_RAGE_KEY,
      MAX_CUMULATIVE_RAGE_KEY
    ) as Array<{ metric_key: string; count: number }>;
  const counts = new Map(
    rows.map((row) => [row.metric_key, Number(row.count) || 0])
  );
  const legacyRows =
    (counts.get(SWEAR_COUNT_KEY) ?? 0) > 0 ||
    (counts.get(SWEARING_MESSAGE_PERCENT_KEY) ?? 0) > 0;

  if (!legacyRows) {
    return false;
  }

  return (
    (counts.get(AVERAGE_MAX_CUMULATIVE_RAGE_KEY) ?? 0) === 0 ||
    (counts.get(MAX_CUMULATIVE_RAGE_KEY) ?? 0) === 0
  );
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

export function getPsycheMetricsViewData(
  options: { timeZone?: string; now?: Date; userIds?: string[] } = {}
): PsycheMetricsViewData {
  const generatedAt = (options.now ?? new Date()).toISOString();
  const ownerScoped = options.userIds !== undefined;
  const effectiveUserIds = [
    ...new Set(
      (options.userIds ?? [])
        .map((userId) => userId.trim())
        .filter((userId) => userId.length > 0)
    )
  ];
  const effectiveUserIdSet = ownerScoped ? new Set(effectiveUserIds) : null;
  const rows = ownerScoped
    ? []
    : (getDatabase()
        .prepare(
          `SELECT date_key, metric_key, value, unit, sample_count, computed_at
           FROM psyche_devrage_metric_measures
           ORDER BY date_key ASC, metric_key ASC`
        )
        .all() as unknown as DevrageMetricMeasureRow[]);
  const conversationMetrics = Object.entries(PSYCHE_METRIC_DEFINITIONS).flatMap(
    ([metricKey, definition]) => {
      const metricRows = rows.filter((row) => row.metric_key === metricKey);
      if (metricRows.length === 0) {
        return [];
      }
      const dayBuckets = new Map<string, DevrageMetricMeasureRow[]>();
      for (const row of metricRows) {
        const entries = dayBuckets.get(row.date_key) ?? [];
        entries.push(row);
        dayBuckets.set(row.date_key, entries);
      }
      const days = [...dayBuckets.entries()]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([dateKey, entries]) => {
          const values = entries.map((entry) => Number(entry.value) || 0);
          const value = average(values);
          return {
            dateKey,
            average: round(
              value,
              definition.aggregation === "cumulative" ? 0 : 1
            ),
            minimum: round(
              Math.min(...values),
              definition.aggregation === "cumulative" ? 0 : 1
            ),
            maximum: round(
              Math.max(...values),
              definition.aggregation === "cumulative" ? 0 : 1
            ),
            latest: round(
              values.at(-1) ?? value,
              definition.aggregation === "cumulative" ? 0 : 1
            ),
            total:
              definition.aggregation === "cumulative"
                ? round(sumNullable(values), 0)
                : null,
            sampleCount: entries.reduce(
              (sum, entry) => sum + Number(entry.sample_count || 0),
              0
            ),
            latestSampleAt:
              entries
                .map((entry) => entry.computed_at)
                .filter(Boolean)
                .sort()
                .at(-1) ?? null,
            sourceRecords: []
          };
        });
      return [
        finalizePsycheMetric(
          {
            ...definition,
            confidence: UNESTIMATED_CONFIDENCE,
            source: {
              kind: "conversation_scanner" as const,
              label: "Local conversation scanner",
              href: null,
              ownerAttribution: "unattributed" as const
            }
          },
          days
        )
      ];
    }
  );
  const timeZone =
    options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const moodResult = buildReportedEmotionIntensityMetric(
    generatedAt,
    timeZone,
    effectiveUserIdSet
  );
  const metrics = [
    ...conversationMetrics,
    ...(moodResult.metric ? [moodResult.metric] : [])
  ].sort((left, right) => {
    if (left.category === right.category) {
      return left.label.localeCompare(right.label);
    }
    return left.category.localeCompare(right.category);
  });

  const metricDateKeys = metrics.flatMap((metric) =>
    metric.days.map((day) => day.dateKey)
  );
  const latestDateKey = metricDateKeys.sort().at(-1) ?? null;
  const trackedDays = new Set(metricDateKeys).size;
  const categoryBreakdown = [
    ...new Set(metrics.map((metric) => metric.category))
  ]
    .map((category) => {
      const categoryMetrics = metrics.filter(
        (metric) => metric.category === category
      );
      return {
        category,
        metricCount: categoryMetrics.length,
        coverageDays: Math.max(
          ...categoryMetrics.map((metric) => metric.coverageDays),
          0
        )
      };
    })
    .sort((left, right) => right.metricCount - left.metricCount);
  const context: DevrageConversationTotalsRow = ownerScoped
    ? {
        conversations: 0,
        sources: 0,
        messages: 0,
        messages_with_swears: 0,
        swear_count: 0,
        average_max_cumulative_rage: 0,
        max_cumulative_rage: 0,
        max_swearing_streak: 0
      }
    : getDevrageConversationTotals();
  const emptyAverages = {
    rawSwearCount: 0,
    swearingMessagePercent: 0,
    averageMaxCumulativeRage: 0,
    maxCumulativeRage: 0
  };
  const dailyAverages = ownerScoped ? emptyAverages : getMetricAverages();
  const weeklyAverages = ownerScoped ? emptyAverages : getMetricAverages(7);
  const state = ownerScoped ? null : getDevrageSyncState();
  const freshness: PsycheMetricsViewData["context"]["freshness"] = ownerScoped
    ? {
        status: "not_applicable",
        lastSuccessfulAt: null,
        lastAttemptAt: null,
        warningCount: 0,
        warnings: []
      }
    : getMetricsFreshness(state, generatedAt);
  const conversationSources = ownerScoped
    ? []
    : (getDatabase()
        .prepare(
          `SELECT source, COUNT(*) AS record_count
           FROM psyche_devrage_conversation_measures
           GROUP BY source
           ORDER BY source`
        )
        .all() as unknown as DevrageSourceRow[]);
  const familyAvailability: PsycheMetricsViewData["summary"]["familyAvailability"] =
    [
      {
        family: "mood",
        status: moodResult.metric ? "available" : "no_data",
        metricCount: moodResult.metric ? 1 : 0,
        reason: moodResult.metric
          ? `Derived from ${moodResult.sourceRecordCount} dated trigger report${moodResult.sourceRecordCount === 1 ? "" : "s"} with explicit 0-100 emotion intensities.`
          : ownerScoped
            ? "No trigger report attributed to the effective owner scope has both an occurred-at date and at least one explicit 0-100 emotion intensity."
            : "No active trigger report has both an occurred-at date and at least one explicit 0-100 emotion intensity."
      },
      {
        family: "urges",
        status: "unsupported",
        metricCount: 0,
        reason:
          "No dated canonical urge-intensity field exists. Behavior urge stories and trigger-report behaviors are text, so Forge does not manufacture a numeric urge series."
      },
      {
        family: "selfRegulation",
        status: "unsupported",
        metricCount: 0,
        reason:
          "No dated canonical completed self-regulation outcome exists. Trigger-report next moves are planned actions, not evidence of completed regulation."
      },
      {
        family: "conversation",
        status: ownerScoped
          ? "unsupported"
          : conversationMetrics.length > 0
            ? "available"
            : "no_data",
        metricCount: conversationMetrics.length,
        reason: ownerScoped
          ? "Conversation scanner rows have no canonical owner attribution and are excluded from owner-scoped responses."
          : conversationMetrics.length > 0
            ? "Stored daily scanner aggregates are available; conversation rows have no canonical owner attribution."
            : "No authoritative stored conversation-scanner metric rows are available."
      }
    ];

  return psycheMetricsViewDataSchema.parse({
    summary: {
      hasData: metrics.length > 0,
      trackedDays,
      metricCount: metrics.length,
      latestDateKey,
      latestMetricCount: metrics.filter(
        (metric) => metric.latestDateKey === latestDateKey
      ).length,
      categoryBreakdown,
      familyAvailability
    },
    context: {
      generatedAt,
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
        fullSyncCompletedAt: ownerScoped
          ? null
          : (state?.full_sync_completed_at ?? null),
        lastDailySyncAt: ownerScoped
          ? null
          : (state?.last_daily_sync_at ?? null),
        lastSyncedDateKey: ownerScoped
          ? null
          : (state?.last_synced_date_key ?? null)
      },
      freshness,
      ownerScope: {
        mode: ownerScoped ? "scoped" : "unscoped_all_data",
        effectiveUserIds,
        availableOwners: moodResult.owners,
        filterMode: ownerScoped ? "server_attribution" : "all_data",
        serverEnforced: ownerScoped,
        unattributedRecordCount: ownerScoped
          ? 0
          : Number(context.conversations) + moodResult.unattributedRecordCount,
        limitation: ownerScoped
          ? "Only trigger reports attributed to the effective user IDs are included. Unattributed trigger reports and all conversation scanner rows are excluded because conversation ownership is unavailable."
          : "This response is intentionally unscoped and may include attributed and unattributed trigger reports plus unattributed conversation scanner rows."
      },
      sources: [
        {
          sourceId: "trigger_reports",
          label: "Trigger reports",
          kind: "trigger_reports",
          recordCount: moodResult.sourceRecordCount,
          linkedRecordCount: moodResult.sourceRecordCount,
          href: "/psyche/reports",
          ownerAttribution:
            moodResult.sourceRecordCount === 0
              ? "attributed"
              : moodResult.unattributedRecordCount > 0
                ? "mixed"
                : "attributed"
        },
        ...conversationSources.map((source) => ({
          sourceId: `conversation:${source.source}`,
          label: source.source,
          kind: "conversation_scanner" as const,
          recordCount: Number(source.record_count) || 0,
          linkedRecordCount: 0,
          href: null,
          ownerAttribution: "unattributed" as const
        }))
      ],
      dataQualityWarnings: moodResult.warnings
    },
    metrics
  });
}

function buildReportedEmotionIntensityMetric(
  generatedAt: string,
  timeZone: string,
  ownerUserIds: Set<string> | null
): MoodMetricResult {
  const rows = getDatabase()
    .prepare(
      `SELECT
         trigger_reports.id,
         trigger_reports.title,
         trigger_reports.occurred_at,
         trigger_reports.emotions_json,
         trigger_reports.updated_at,
         entity_owners.user_id,
         users.display_name
       FROM trigger_reports
       LEFT JOIN deleted_entities
         ON deleted_entities.entity_type = 'trigger_report'
        AND deleted_entities.entity_id = trigger_reports.id
       LEFT JOIN entity_owners
         ON entity_owners.entity_type = 'trigger_report'
        AND entity_owners.entity_id = trigger_reports.id
        AND entity_owners.role = 'owner'
       LEFT JOIN users ON users.id = entity_owners.user_id
       WHERE trigger_reports.domain_id = 'domain_psyche'
         AND deleted_entities.entity_id IS NULL
       ORDER BY trigger_reports.occurred_at, trigger_reports.updated_at, trigger_reports.id`
    )
    .all() as unknown as TriggerReportMetricRow[];
  const dayBuckets = new Map<
    string,
    {
      values: number[];
      sourceRecords: PsycheMetricDay["sourceRecords"];
      latestSampleAt: string;
    }
  >();
  const owners = new Map<string, string>();
  let sourceRecordCount = 0;
  let unattributedRecordCount = 0;
  let malformedEmotionRecords = 0;
  let invalidEmotionEntries = 0;
  let undatedEmotionRecords = 0;
  let invalidDateRecords = 0;

  for (const row of rows) {
    if (ownerUserIds && (!row.user_id || !ownerUserIds.has(row.user_id))) {
      continue;
    }
    const parsedIntensities = parseEmotionIntensities(row.emotions_json);
    if (parsedIntensities === null) {
      malformedEmotionRecords += 1;
      continue;
    }
    const intensities = parsedIntensities.values;
    invalidEmotionEntries += parsedIntensities.invalidEntryCount;
    if (intensities.length === 0) {
      continue;
    }
    if (!row.occurred_at) {
      undatedEmotionRecords += 1;
      continue;
    }
    const dateKey = dateKeyInTimeZone(row.occurred_at, timeZone);
    if (!dateKey) {
      invalidDateRecords += 1;
      continue;
    }
    const reportAverage = round(average(intensities), 1);
    const sourceRecord: PsycheMetricDay["sourceRecords"][number] = {
      sourceType: "trigger_report",
      sourceId: row.id,
      label: row.title,
      href: `/psyche/reports/${encodeURIComponent(row.id)}`,
      observedAt: row.occurred_at,
      recordedAt: row.updated_at,
      ownerUserId: row.user_id,
      ownerDisplayName: row.display_name,
      value: reportAverage,
      sampleCount: intensities.length
    };
    const bucket = dayBuckets.get(dateKey) ?? {
      values: [],
      sourceRecords: [],
      latestSampleAt: row.updated_at
    };
    bucket.values.push(...intensities);
    bucket.sourceRecords.push(sourceRecord);
    if (row.updated_at > bucket.latestSampleAt) {
      bucket.latestSampleAt = row.updated_at;
    }
    dayBuckets.set(dateKey, bucket);
    sourceRecordCount += 1;
    if (row.user_id) {
      owners.set(row.user_id, row.display_name?.trim() || row.user_id);
    } else {
      unattributedRecordCount += 1;
    }
  }

  const days: PsycheMetricDay[] = [...dayBuckets.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([dateKey, bucket]) => {
      const dailyAverage = round(average(bucket.values), 1);
      return {
        dateKey,
        average: dailyAverage,
        minimum: round(Math.min(...bucket.values), 1),
        maximum: round(Math.max(...bucket.values), 1),
        latest: dailyAverage,
        total: null,
        sampleCount: bucket.values.length,
        latestSampleAt: bucket.latestSampleAt || generatedAt,
        sourceRecords: bucket.sourceRecords.sort((left, right) =>
          left.observedAt.localeCompare(right.observedAt)
        )
      };
    });
  const warnings = [
    ...(malformedEmotionRecords > 0
      ? [
          `${malformedEmotionRecords} trigger report${malformedEmotionRecords === 1 ? " has" : "s have"} malformed emotion data and was excluded.`
        ]
      : []),
    ...(invalidEmotionEntries > 0
      ? [
          `${invalidEmotionEntries} emotion ${invalidEmotionEntries === 1 ? "entry has" : "entries have"} a missing, non-numeric, or out-of-range intensity and ${invalidEmotionEntries === 1 ? "was" : "were"} excluded from the metric.`
        ]
      : []),
    ...(undatedEmotionRecords > 0
      ? [
          `${undatedEmotionRecords} trigger report${undatedEmotionRecords === 1 ? " has" : "s have"} emotion intensity but no occurred-at date and was excluded.`
        ]
      : []),
    ...(invalidDateRecords > 0
      ? [
          `${invalidDateRecords} trigger report${invalidDateRecords === 1 ? " has" : "s have"} an invalid occurred-at value and was excluded.`
        ]
      : [])
  ];

  return {
    metric:
      days.length > 0
        ? finalizePsycheMetric(
            {
              ...REPORTED_EMOTION_INTENSITY_DEFINITION,
              confidence: UNESTIMATED_CONFIDENCE,
              source: {
                kind: "trigger_reports",
                label: "Dated trigger-report emotions",
                href: "/psyche/reports",
                ownerAttribution:
                  unattributedRecordCount > 0 ? "mixed" : "attributed"
              }
            },
            days
          )
        : null,
    sourceRecordCount,
    owners: [...owners.entries()]
      .map(([userId, displayName]) => ({ userId, displayName }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName)),
    unattributedRecordCount,
    warnings
  };
}

function finalizePsycheMetric(
  definition: Omit<
    PsycheMetric,
    | "latestValue"
    | "latestDateKey"
    | "baselineValue"
    | "deltaValue"
    | "coverageDays"
    | "days"
  >,
  days: PsycheMetricDay[]
): PsycheMetric {
  const latestDay =
    [...days].reverse().find(
      (day) =>
        psycheMetricPrimaryValue({
          aggregation: definition.aggregation,
          latest: day.latest,
          average: day.average,
          total: day.total,
          maximum: day.maximum
        }) !== null
    ) ?? null;
  const recentValues = days
    .map((day) =>
      psycheMetricPrimaryValue({
        aggregation: definition.aggregation,
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
    baselineValues.length > 0
      ? average(baselineValues)
      : (recentValues.at(-2) ?? null);
  const latestValue = latestDay
    ? psycheMetricPrimaryValue({
        aggregation: definition.aggregation,
        latest: latestDay.latest,
        average: latestDay.average,
        total: latestDay.total,
        maximum: latestDay.maximum
      })
    : null;
  const digits = definition.aggregation === "cumulative" ? 0 : 1;
  return {
    ...definition,
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
}

function parseEmotionIntensities(
  value: string
): { values: number[]; invalidEntryCount: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const intensities: number[] = [];
  let invalidEntryCount = 0;
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || !("intensity" in entry)) {
      invalidEntryCount += 1;
      continue;
    }
    const intensity = (entry as { intensity: unknown }).intensity;
    if (
      typeof intensity !== "number" ||
      !Number.isFinite(intensity) ||
      intensity < 0 ||
      intensity > 100
    ) {
      invalidEntryCount += 1;
      continue;
    }
    intensities.push(intensity);
  }
  return { values: intensities, invalidEntryCount };
}

function dateKeyInTimeZone(value: string, timeZone: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function getMetricsFreshness(
  state: DevrageSyncStateRow | null,
  generatedAt: string
): PsycheMetricsViewData["context"]["freshness"] {
  const runtimeIssue =
    latestRuntimeSyncIssue?.database === getDatabase()
      ? latestRuntimeSyncIssue
      : null;
  const lastSuccessfulAt =
    [state?.full_sync_completed_at, state?.last_daily_sync_at]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  if (runtimeIssue) {
    const warnings = [...new Set(runtimeIssue.warnings)];
    return {
      status: "partial",
      lastSuccessfulAt,
      lastAttemptAt: runtimeIssue.attemptedAt,
      warningCount: warnings.length,
      warnings
    };
  }
  if (!lastSuccessfulAt) {
    return {
      status: "not_synced",
      lastSuccessfulAt: null,
      lastAttemptAt: state?.updated_at ?? null,
      warningCount: 0,
      warnings: []
    };
  }
  const elapsed = Date.parse(generatedAt) - Date.parse(lastSuccessfulAt);
  return {
    status:
      !Number.isFinite(elapsed) || elapsed > FRESHNESS_STALE_AFTER_MS
        ? "stale"
        : "current",
    lastSuccessfulAt,
    lastAttemptAt: state?.updated_at ?? lastSuccessfulAt,
    warningCount: 0,
    warnings: []
  };
}

async function syncDevrageMetricHistoryInternal(options: {
  forceFull?: boolean;
  dateKey?: string;
}) {
  const dateKey = options.forceFull
    ? undefined
    : (options.dateKey ?? todayDateKey());
  const controller = new AbortController();
  const cancelForShutdown = () => {
    controller.abort(new Error("Forge is shutting down."));
  };
  const timeout = setTimeout(() => {
    controller.abort(
      new Error(`Devrage scan exceeded ${DEVRAGE_SCAN_TIMEOUT_MS}ms.`)
    );
  }, DEVRAGE_SCAN_TIMEOUT_MS);
  timeout.unref?.();
  process.once("SIGINT", cancelForShutdown);
  process.once("SIGTERM", cancelForShutdown);

  try {
    const report = await scanConversations({
      roles: DEFAULT_ROLE_FILTER,
      date: dateKey,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      signal: controller.signal
    });
    storeDevrageReport(report, {
      fullSync: Boolean(options.forceFull),
      syncedDateKey: dateKey ?? null
    });
  } finally {
    clearTimeout(timeout);
    process.off("SIGINT", cancelForShutdown);
    process.off("SIGTERM", cancelForShutdown);
  }
}

export function storeDevrageReport(
  report: DevrageReport,
  options: { fullSync: boolean; syncedDateKey: string | null }
) {
  assertAuthoritativeDevrageReport(report);
  const reportDateKeys = new Set(
    report.conversations.map((conversation) => conversation.dateKey)
  );
  const dailyDateKey = options.fullSync ? null : options.syncedDateKey;
  if (!options.fullSync && !dailyDateKey) {
    throw new Error("A daily devrage scan requires syncedDateKey.");
  }
  if (dailyDateKey) {
    const unexpectedDateKey = [...reportDateKeys].find(
      (dateKey) => dateKey !== dailyDateKey
    );
    if (unexpectedDateKey) {
      throw new Error(
        `Daily devrage scan for ${dailyDateKey} contained a row for ${unexpectedDateKey}.`
      );
    }
  }

  const scannedAt = nowIso();

  runInTransaction(() => {
    const database = getDatabase();
    const deleteConversationDate = database.prepare(
      `DELETE FROM psyche_devrage_conversation_measures WHERE date_key = ?`
    );
    const deleteMetricDate = database.prepare(
      `DELETE FROM psyche_devrage_metric_measures WHERE date_key = ?`
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

    if (options.fullSync) {
      database.prepare(`DELETE FROM psyche_devrage_metric_measures`).run();
      database
        .prepare(`DELETE FROM psyche_devrage_conversation_measures`)
        .run();
    } else if (dailyDateKey) {
      deleteMetricDate.run(dailyDateKey);
      deleteConversationDate.run(dailyDateKey);
    }

    for (const conversation of report.conversations) {
      insertConversation.run(
        stableId(
          "devrage_conversation",
          conversation.source,
          conversation.conversationId,
          conversation.dateKey
        ),
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

    for (const dateKey of reportDateKeys) {
      recomputeMetricMeasuresForDate(dateKey, scannedAt);
    }

    upsertSyncState({
      fullSyncCompletedAt: options.fullSync ? scannedAt : undefined,
      lastDailySyncAt: options.fullSync ? undefined : scannedAt,
      lastSyncedDateKey: options.fullSync
        ? ([...reportDateKeys].sort().at(-1) ?? null)
        : dailyDateKey,
      updatedAt: scannedAt
    });
  });
  if (latestRuntimeSyncIssue?.database === getDatabase()) {
    latestRuntimeSyncIssue = null;
  }
}

function assertAuthoritativeDevrageReport(report: DevrageReport) {
  if (
    report.scanStatus === "partial" ||
    report.warnings.length > 0 ||
    (report.failedSources?.length ?? 0) > 0
  ) {
    latestRuntimeSyncIssue = {
      database: getDatabase(),
      attemptedAt: nowIso(),
      warnings: [
        ...(report.failedSources?.map(
          (source) => `${source}: source scan did not complete`
        ) ?? []),
        ...report.warnings.map((warning) => warning.reason)
      ]
    };
    throw new DevrageScanIncompleteError(report);
  }
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
  const averageMaxCumulativeRage =
    Number(aggregate.average_max_cumulative_rage) || 0;
  const maxCumulativeRage = Number(aggregate.max_cumulative_rage) || 0;
  const percent = messages > 0 ? (messagesWithSwears / messages) * 100 : 0;

  upsertMetricMeasure(
    dateKey,
    SWEAR_COUNT_KEY,
    swearCount,
    "count",
    Number(aggregate.conversations) || 0,
    computedAt
  );
  upsertMetricMeasure(
    dateKey,
    SWEARING_MESSAGE_PERCENT_KEY,
    percent,
    "percent",
    messages,
    computedAt
  );
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
    .run(
      stableId("devrage_metric", dateKey, metricKey),
      dateKey,
      metricKey,
      value,
      unit,
      sampleCount,
      computedAt
    );
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
      input.lastSyncedDateKey,
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

function getDevrageDailyHistory(
  limit: number
): DevrageMetricPayload["history"] {
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
      swearingMessagePercent:
        messages > 0 ? (messagesWithSwears / messages) * 100 : 0,
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
    .all(...(days ? [days] : [])) as Array<{
    metric_key: string;
    value: number | null;
  }>;
  const swearAverage =
    rows.find((row) => row.metric_key === SWEAR_COUNT_KEY)?.value ?? 0;
  const percentAverage =
    rows.find((row) => row.metric_key === SWEARING_MESSAGE_PERCENT_KEY)
      ?.value ?? 0;
  const averageMaxCumulativeRage =
    rows.find((row) => row.metric_key === AVERAGE_MAX_CUMULATIVE_RAGE_KEY)
      ?.value ?? 0;
  const maxCumulativeRage =
    rows.find((row) => row.metric_key === MAX_CUMULATIVE_RAGE_KEY)?.value ?? 0;

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
  const digest = createHash("sha256")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, 20);
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
