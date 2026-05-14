import { createHash } from "node:crypto";
import { scanConversations } from "forge-devrage";
import { getDatabase, runInTransaction } from "../db.js";
const SWEAR_COUNT_KEY = "swear_count";
const SWEARING_MESSAGE_PERCENT_KEY = "swearing_message_percent";
const DEFAULT_ROLE_FILTER = new Set(["user"]);
let syncInFlight = null;
export async function syncDevrageMetricHistory(options = {}) {
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
    if (!state?.full_sync_completed_at) {
        await syncDevrageMetricHistory({ forceFull: true });
        return;
    }
    const today = todayDateKey();
    if (state.last_synced_date_key !== today) {
        await syncDevrageMetricHistory({ dateKey: today });
    }
}
export function getDevrageMetricPayload() {
    const generatedAt = nowIso();
    const state = getDevrageSyncState();
    const history = getDevrageDailyHistory(90);
    const latest = history[0] ?? null;
    const dailyAverages = getMetricAverages();
    const weeklyAverages = getMetricAverages(7);
    return {
        generatedAt,
        latestDateKey: latest?.dateKey ?? null,
        rawSwearCount: latest?.rawSwearCount ?? 0,
        swearingMessagePercent: latest?.swearingMessagePercent ?? 0,
        conversationsScanned: latest?.conversationsScanned ?? 0,
        messagesScanned: latest?.messagesScanned ?? 0,
        messagesWithSwears: latest?.messagesWithSwears ?? 0,
        dailyAverage: {
            rawSwearCount: dailyAverages.rawSwearCount,
            swearingMessagePercent: dailyAverages.swearingMessagePercent
        },
        weeklyAverage: {
            rawSwearCount: weeklyAverages.rawSwearCount,
            swearingMessagePercent: weeklyAverages.swearingMessagePercent
        },
        history,
        sync: {
            fullSyncCompletedAt: state?.full_sync_completed_at ?? null,
            lastDailySyncAt: state?.last_daily_sync_at ?? null,
            lastSyncedDateKey: state?.last_synced_date_key ?? null
        }
    };
}
async function syncDevrageMetricHistoryInternal(options) {
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
export function storeDevrageReport(report, options) {
    const scannedAt = nowIso();
    const affectedDateKeys = new Set(report.conversations.map((conversation) => conversation.dateKey));
    runInTransaction(() => {
        const database = getDatabase();
        const deleteDate = database.prepare(`DELETE FROM psyche_devrage_conversation_measures WHERE date_key = ?`);
        const insertConversation = database.prepare(`INSERT INTO psyche_devrage_conversation_measures (
         id, source, conversation_id, date_key, updated_at, messages,
         messages_with_swears, swear_count, scanned_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source, conversation_id, date_key) DO UPDATE SET
         updated_at = excluded.updated_at,
         messages = excluded.messages,
         messages_with_swears = excluded.messages_with_swears,
         swear_count = excluded.swear_count,
         scanned_at = excluded.scanned_at`);
        for (const dateKey of affectedDateKeys) {
            deleteDate.run(dateKey);
        }
        for (const conversation of report.conversations) {
            insertConversation.run(stableId("devrage_conversation", conversation.source, conversation.conversationId, conversation.dateKey), conversation.source, conversation.conversationId, conversation.dateKey, conversation.updatedAt, conversation.messages, conversation.messagesWithSwears, conversation.swears, scannedAt);
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
function recomputeMetricMeasuresForDate(dateKey, computedAt) {
    const aggregate = getDatabase()
        .prepare(`SELECT
         COUNT(*) AS conversations,
         COALESCE(SUM(messages), 0) AS messages,
         COALESCE(SUM(messages_with_swears), 0) AS messages_with_swears,
         COALESCE(SUM(swear_count), 0) AS swear_count
       FROM psyche_devrage_conversation_measures
       WHERE date_key = ?`)
        .get(dateKey);
    const messages = Number(aggregate.messages) || 0;
    const messagesWithSwears = Number(aggregate.messages_with_swears) || 0;
    const swearCount = Number(aggregate.swear_count) || 0;
    const percent = messages > 0 ? (messagesWithSwears / messages) * 100 : 0;
    upsertMetricMeasure(dateKey, SWEAR_COUNT_KEY, swearCount, "count", Number(aggregate.conversations) || 0, computedAt);
    upsertMetricMeasure(dateKey, SWEARING_MESSAGE_PERCENT_KEY, percent, "percent", messages, computedAt);
}
function upsertMetricMeasure(dateKey, metricKey, value, unit, sampleCount, computedAt) {
    getDatabase()
        .prepare(`INSERT INTO psyche_devrage_metric_measures (
         id, date_key, metric_key, value, unit, sample_count, computed_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date_key, metric_key) DO UPDATE SET
         value = excluded.value,
         unit = excluded.unit,
         sample_count = excluded.sample_count,
         computed_at = excluded.computed_at`)
        .run(stableId("devrage_metric", dateKey, metricKey), dateKey, metricKey, value, unit, sampleCount, computedAt);
}
function upsertSyncState(input) {
    const current = getDevrageSyncState();
    getDatabase()
        .prepare(`INSERT INTO psyche_devrage_sync_state (
         id, full_sync_completed_at, last_daily_sync_at, last_synced_date_key, updated_at
       )
       VALUES ('default', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         full_sync_completed_at = excluded.full_sync_completed_at,
         last_daily_sync_at = excluded.last_daily_sync_at,
         last_synced_date_key = excluded.last_synced_date_key,
         updated_at = excluded.updated_at`)
        .run(input.fullSyncCompletedAt ?? current?.full_sync_completed_at ?? null, input.lastDailySyncAt ?? current?.last_daily_sync_at ?? null, input.lastSyncedDateKey ?? current?.last_synced_date_key ?? null, input.updatedAt);
}
function getDevrageSyncState() {
    return (getDatabase()
        .prepare(`SELECT full_sync_completed_at, last_daily_sync_at, last_synced_date_key, updated_at
         FROM psyche_devrage_sync_state
         WHERE id = 'default'`)
        .get() ?? null);
}
function getDevrageDailyHistory(limit) {
    const rows = getDatabase()
        .prepare(`SELECT
         date_key,
         COUNT(*) AS conversations,
         COALESCE(SUM(messages), 0) AS messages,
         COALESCE(SUM(messages_with_swears), 0) AS messages_with_swears,
         COALESCE(SUM(swear_count), 0) AS swear_count
       FROM psyche_devrage_conversation_measures
       GROUP BY date_key
       ORDER BY date_key DESC
       LIMIT ?`)
        .all(limit);
    return rows.map((row) => {
        const messages = Number(row.messages) || 0;
        const messagesWithSwears = Number(row.messages_with_swears) || 0;
        return {
            dateKey: row.date_key,
            rawSwearCount: Number(row.swear_count) || 0,
            swearingMessagePercent: messages > 0 ? (messagesWithSwears / messages) * 100 : 0,
            conversationsScanned: Number(row.conversations) || 0,
            messagesScanned: messages,
            messagesWithSwears
        };
    });
}
function getMetricAverages(days) {
    const where = days
        ? `WHERE date_key IN (
         SELECT date_key FROM psyche_devrage_metric_measures
         GROUP BY date_key
         ORDER BY date_key DESC
         LIMIT ?
       )`
        : "";
    const rows = getDatabase()
        .prepare(`SELECT metric_key, AVG(value) AS value
       FROM psyche_devrage_metric_measures
       ${where}
       GROUP BY metric_key`)
        .all(...(days ? [days] : []));
    const swearAverage = rows.find((row) => row.metric_key === SWEAR_COUNT_KEY)?.value ?? 0;
    const percentAverage = rows.find((row) => row.metric_key === SWEARING_MESSAGE_PERCENT_KEY)?.value ?? 0;
    return {
        rawSwearCount: round(Number(swearAverage) || 0, 1),
        swearingMessagePercent: round(Number(percentAverage) || 0, 1)
    };
}
function stableId(prefix, ...parts) {
    const digest = createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 20);
    return `${prefix}_${digest}`;
}
function todayDateKey() {
    return new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date());
}
function nowIso() {
    return new Date().toISOString();
}
function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
