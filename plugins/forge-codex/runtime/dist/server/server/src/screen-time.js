import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase } from "./db.js";
import { recordDiagnosticLog } from "./repositories/diagnostic-logs.js";
import { getDefaultUser } from "./repositories/users.js";
const screenTimeAuthorizationStatusSchema = z.enum([
    "not_determined",
    "denied",
    "approved",
    "unavailable"
]);
const screenTimeCaptureStateSchema = z.enum([
    "disabled",
    "capturing",
    "waiting_for_snapshot",
    "ready",
    "sync_paused",
    "unavailable",
    "needs_authorization"
]);
const screenTimeCaptureFreshnessSchema = z.enum([
    "empty",
    "fresh",
    "stale",
    "unavailable"
]);
const screenTimeAppUsageInputSchema = z.object({
    bundleIdentifier: z.string().trim().min(1),
    displayName: z.string().trim().default(""),
    categoryLabel: z.string().trim().nullable().default(null),
    totalActivitySeconds: z.number().int().nonnegative().default(0),
    pickupCount: z.number().int().nonnegative().default(0),
    notificationCount: z.number().int().nonnegative().default(0)
});
const screenTimeCategoryUsageInputSchema = z.object({
    categoryLabel: z.string().trim().min(1),
    totalActivitySeconds: z.number().int().nonnegative().default(0)
});
const screenTimeDaySummaryInputSchema = z.object({
    dateKey: z.string().trim().min(1),
    totalActivitySeconds: z.number().int().nonnegative().default(0),
    pickupCount: z.number().int().nonnegative().default(0),
    notificationCount: z.number().int().nonnegative().default(0),
    firstPickupAt: z.string().datetime().nullable().default(null),
    longestActivitySeconds: z.number().int().nonnegative().default(0),
    topAppBundleIdentifiers: z.array(z.string().trim().min(1)).default([]),
    topCategoryLabels: z.array(z.string().trim().min(1)).default([]),
    metadata: z.record(z.string(), z.unknown()).default({})
});
const screenTimeHourlySegmentInputSchema = z.object({
    dateKey: z.string().trim().min(1),
    hourIndex: z.number().int().min(0).max(23),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    totalActivitySeconds: z.number().int().nonnegative().default(0),
    pickupCount: z.number().int().nonnegative().default(0),
    notificationCount: z.number().int().nonnegative().default(0),
    firstPickupAt: z.string().datetime().nullable().default(null),
    longestActivityStartedAt: z.string().datetime().nullable().default(null),
    longestActivityEndedAt: z.string().datetime().nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).default({}),
    apps: z.array(screenTimeAppUsageInputSchema).default([]),
    categories: z.array(screenTimeCategoryUsageInputSchema).default([])
});
export const screenTimeSettingsInputSchema = z.object({
    trackingEnabled: z.boolean().default(false),
    syncEnabled: z.boolean().default(true),
    authorizationStatus: screenTimeAuthorizationStatusSchema.default("not_determined"),
    captureState: screenTimeCaptureStateSchema.default("disabled"),
    lastCapturedDayKey: z.string().trim().min(1).nullable().default(null),
    lastCaptureStartedAt: z.string().datetime().nullable().default(null),
    lastCaptureEndedAt: z.string().datetime().nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).default({})
});
export const screenTimeSettingsPatchSchema = screenTimeSettingsInputSchema.partial();
export const screenTimeSyncPayloadSchema = z.object({
    settings: screenTimeSettingsInputSchema.default({}),
    daySummaries: z.array(screenTimeDaySummaryInputSchema).default([]),
    hourlySegments: z.array(screenTimeHourlySegmentInputSchema).default([])
});
function nowIso() {
    return new Date().toISOString();
}
function round(value, digits = 0) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
function safeJsonParse(value, fallback) {
    try {
        return JSON.parse(value);
    }
    catch {
        return fallback;
    }
}
function average(values) {
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
const SCREEN_TIME_STALE_AFTER_HOURS = 36;
function hoursBetween(left, right) {
    return Math.max(0, (Date.parse(left) - Date.parse(right)) / 3_600_000);
}
function screenTimeCaptureStats(input) {
    const hasCapture = input.capturedDayCount > 0 || input.capturedHourCount > 0;
    const captureAgeHours = input.lastCaptureEndedAt
        ? round(hoursBetween(nowIso(), input.lastCaptureEndedAt), 1)
        : null;
    const captureWindowDays = input.lastCaptureStartedAt && input.lastCaptureEndedAt
        ? Math.max(1, Math.round(hoursBetween(input.lastCaptureEndedAt, input.lastCaptureStartedAt) / 24))
        : hasCapture
            ? 1
            : 0;
    const captureFreshness = input.authorizationStatus === "unavailable"
        ? "unavailable"
        : !hasCapture
            ? "empty"
            : captureAgeHours !== null && captureAgeHours <= SCREEN_TIME_STALE_AFTER_HOURS
                ? "fresh"
                : "stale";
    return {
        captureFreshness,
        captureAgeHours,
        capturedDayCount: input.capturedDayCount,
        capturedHourCount: input.capturedHourCount,
        captureWindowDays
    };
}
function overlapSeconds(leftStart, leftEnd, rightStart, rightEnd) {
    const start = Math.max(Date.parse(leftStart), Date.parse(rightStart));
    const end = Math.min(Date.parse(leftEnd), Date.parse(rightEnd));
    return Math.max(0, Math.round((end - start) / 1000));
}
function buildUserFilterClause(userIds) {
    const effectiveUserIds = userIds && userIds.length > 0 ? userIds : [getDefaultUser().id];
    return {
        effectiveUserIds,
        placeholders: effectiveUserIds.map(() => "?").join(", ")
    };
}
function ensureScreenTimeSettings(userId) {
    const existing = getDatabase()
        .prepare(`SELECT *
       FROM screen_time_settings
       WHERE user_id = ?`)
        .get(userId);
    if (existing) {
        return existing;
    }
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO screen_time_settings (
         user_id, tracking_enabled, sync_enabled, authorization_status, capture_state,
         last_captured_day_key, last_capture_started_at, last_capture_ended_at,
         metadata_json, created_at, updated_at
       ) VALUES (?, 0, 1, 'not_determined', 'disabled', NULL, NULL, NULL, '{}', ?, ?)`)
        .run(userId, now, now);
    return getDatabase()
        .prepare(`SELECT *
       FROM screen_time_settings
       WHERE user_id = ?`)
        .get(userId);
}
function mapScreenTimeSettings(row) {
    return {
        userId: row.user_id,
        trackingEnabled: row.tracking_enabled === 1,
        syncEnabled: row.sync_enabled === 1,
        authorizationStatus: row.authorization_status,
        captureState: row.capture_state,
        lastCapturedDayKey: row.last_captured_day_key,
        lastCaptureStartedAt: row.last_capture_started_at,
        lastCaptureEndedAt: row.last_capture_ended_at,
        metadata: safeJsonParse(row.metadata_json, {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function upsertScreenTimeSettings(userId, input) {
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO screen_time_settings (
         user_id, tracking_enabled, sync_enabled, authorization_status, capture_state,
         last_captured_day_key, last_capture_started_at, last_capture_ended_at,
         metadata_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         tracking_enabled = excluded.tracking_enabled,
         sync_enabled = excluded.sync_enabled,
         authorization_status = excluded.authorization_status,
         capture_state = excluded.capture_state,
         last_captured_day_key = excluded.last_captured_day_key,
         last_capture_started_at = excluded.last_capture_started_at,
         last_capture_ended_at = excluded.last_capture_ended_at,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`)
        .run(userId, input.trackingEnabled ? 1 : 0, input.syncEnabled ? 1 : 0, input.authorizationStatus, input.captureState, input.lastCapturedDayKey, input.lastCaptureStartedAt, input.lastCaptureEndedAt, JSON.stringify(input.metadata ?? {}), now, now);
    return mapScreenTimeSettings(ensureScreenTimeSettings(userId));
}
function listHourlySegmentRows(input) {
    const { effectiveUserIds, placeholders } = buildUserFilterClause(input.userIds);
    const conditions = [`user_id IN (${placeholders})`];
    const params = [...effectiveUserIds];
    if (input.dateKey) {
        conditions.push("date_key = ?");
        params.push(input.dateKey);
    }
    if (input.monthKey) {
        conditions.push("date_key LIKE ?");
        params.push(`${input.monthKey}-%`);
    }
    if (input.startedBefore) {
        conditions.push("started_at < ?");
        params.push(input.startedBefore);
    }
    if (input.endedAfter) {
        conditions.push("ended_at > ?");
        params.push(input.endedAfter);
    }
    return getDatabase()
        .prepare(`SELECT *
       FROM screen_time_hourly_segments
       WHERE ${conditions.join(" AND ")}
       ORDER BY started_at ASC`)
        .all(...params);
}
function listDaySummaryRows(input) {
    const { effectiveUserIds, placeholders } = buildUserFilterClause(input.userIds);
    const conditions = [`user_id IN (${placeholders})`];
    const params = [...effectiveUserIds];
    if (input.dateKey) {
        conditions.push("date_key = ?");
        params.push(input.dateKey);
    }
    if (input.monthKey) {
        conditions.push("date_key LIKE ?");
        params.push(`${input.monthKey}-%`);
    }
    return getDatabase()
        .prepare(`SELECT *
       FROM screen_time_day_summaries
       WHERE ${conditions.join(" AND ")}
       ORDER BY date_key ASC`)
        .all(...params);
}
function listAppUsageRows(segmentIds) {
    if (segmentIds.length === 0) {
        return [];
    }
    const placeholders = segmentIds.map(() => "?").join(", ");
    return getDatabase()
        .prepare(`SELECT *
       FROM screen_time_app_usage
       WHERE segment_id IN (${placeholders})
       ORDER BY total_activity_seconds DESC, display_name ASC`)
        .all(...segmentIds);
}
function listCategoryUsageRows(segmentIds) {
    if (segmentIds.length === 0) {
        return [];
    }
    const placeholders = segmentIds.map(() => "?").join(", ");
    return getDatabase()
        .prepare(`SELECT *
       FROM screen_time_category_usage
       WHERE segment_id IN (${placeholders})
       ORDER BY total_activity_seconds DESC, category_label ASC`)
        .all(...segmentIds);
}
function mapAppUsage(row) {
    return {
        id: row.id,
        bundleIdentifier: row.bundle_identifier,
        displayName: row.display_name,
        categoryLabel: row.category_label,
        totalActivitySeconds: row.total_activity_seconds,
        pickupCount: row.pickup_count,
        notificationCount: row.notification_count
    };
}
function mapCategoryUsage(row) {
    return {
        id: row.id,
        categoryLabel: row.category_label,
        totalActivitySeconds: row.total_activity_seconds
    };
}
function mapHourlySegment(row, apps, categories) {
    return {
        id: row.id,
        userId: row.user_id,
        pairingSessionId: row.pairing_session_id,
        sourceDevice: row.source_device,
        dateKey: row.date_key,
        hourIndex: row.hour_index,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        totalActivitySeconds: row.total_activity_seconds,
        pickupCount: row.pickup_count,
        notificationCount: row.notification_count,
        firstPickupAt: row.first_pickup_at,
        longestActivityStartedAt: row.longest_activity_started_at,
        longestActivityEndedAt: row.longest_activity_ended_at,
        metadata: safeJsonParse(row.metadata_json, {}),
        apps: apps.map(mapAppUsage),
        categories: categories.map(mapCategoryUsage)
    };
}
function aggregateAppUsage(rows) {
    const byBundle = new Map();
    rows.forEach((row) => {
        const existing = byBundle.get(row.bundleIdentifier);
        if (existing) {
            existing.totalActivitySeconds += row.totalActivitySeconds;
            existing.pickupCount += row.pickupCount;
            existing.notificationCount += row.notificationCount;
            if (!existing.displayName && row.displayName) {
                existing.displayName = row.displayName;
            }
            if (!existing.categoryLabel && row.categoryLabel) {
                existing.categoryLabel = row.categoryLabel;
            }
            return;
        }
        byBundle.set(row.bundleIdentifier, {
            id: `app_${row.bundleIdentifier}`,
            bundleIdentifier: row.bundleIdentifier,
            displayName: row.displayName,
            categoryLabel: row.categoryLabel,
            totalActivitySeconds: row.totalActivitySeconds,
            pickupCount: row.pickupCount,
            notificationCount: row.notificationCount
        });
    });
    return [...byBundle.values()].sort((left, right) => right.totalActivitySeconds - left.totalActivitySeconds ||
        right.pickupCount - left.pickupCount ||
        left.displayName.localeCompare(right.displayName));
}
function aggregateCategoryUsage(rows) {
    const byCategory = new Map();
    rows.forEach((row) => {
        const existing = byCategory.get(row.categoryLabel);
        if (existing) {
            existing.totalActivitySeconds += row.totalActivitySeconds;
            return;
        }
        byCategory.set(row.categoryLabel, {
            id: `cat_${row.categoryLabel}`,
            categoryLabel: row.categoryLabel,
            totalActivitySeconds: row.totalActivitySeconds
        });
    });
    return [...byCategory.values()].sort((left, right) => right.totalActivitySeconds - left.totalActivitySeconds ||
        left.categoryLabel.localeCompare(right.categoryLabel));
}
function upsertDaySummary(pairing, sourceDevice, summary) {
    const existing = getDatabase()
        .prepare(`SELECT id
       FROM screen_time_day_summaries
       WHERE user_id = ?
         AND source_device = ?
         AND date_key = ?`)
        .get(pairing.user_id, sourceDevice, summary.dateKey);
    const id = existing?.id ?? `std_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO screen_time_day_summaries (
         id, user_id, pairing_session_id, source_device, date_key,
         total_activity_seconds, pickup_count, notification_count, first_pickup_at,
         longest_activity_seconds, top_app_bundle_ids_json, top_category_labels_json,
         metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, source_device, date_key) DO UPDATE SET
         pairing_session_id = excluded.pairing_session_id,
         total_activity_seconds = excluded.total_activity_seconds,
         pickup_count = excluded.pickup_count,
         notification_count = excluded.notification_count,
         first_pickup_at = excluded.first_pickup_at,
         longest_activity_seconds = excluded.longest_activity_seconds,
         top_app_bundle_ids_json = excluded.top_app_bundle_ids_json,
         top_category_labels_json = excluded.top_category_labels_json,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`)
        .run(id, pairing.user_id, pairing.id, sourceDevice, summary.dateKey, summary.totalActivitySeconds, summary.pickupCount, summary.notificationCount, summary.firstPickupAt, summary.longestActivitySeconds, JSON.stringify(summary.topAppBundleIdentifiers), JSON.stringify(summary.topCategoryLabels), JSON.stringify(summary.metadata ?? {}), now, now);
    return existing ? "updated" : "created";
}
function replaceSegmentChildren(segmentId, apps, categories) {
    getDatabase()
        .prepare(`DELETE FROM screen_time_app_usage WHERE segment_id = ?`)
        .run(segmentId);
    getDatabase()
        .prepare(`DELETE FROM screen_time_category_usage WHERE segment_id = ?`)
        .run(segmentId);
    const now = nowIso();
    const insertApp = getDatabase().prepare(`INSERT INTO screen_time_app_usage (
       id, segment_id, bundle_identifier, display_name, category_label,
       total_activity_seconds, pickup_count, notification_count, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    apps.forEach((app) => {
        insertApp.run(`sta_${randomUUID().replaceAll("-", "").slice(0, 10)}`, segmentId, app.bundleIdentifier, app.displayName, app.categoryLabel, app.totalActivitySeconds, app.pickupCount, app.notificationCount, now, now);
    });
    const insertCategory = getDatabase().prepare(`INSERT INTO screen_time_category_usage (
       id, segment_id, category_label, total_activity_seconds, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`);
    categories.forEach((category) => {
        insertCategory.run(`stc_${randomUUID().replaceAll("-", "").slice(0, 10)}`, segmentId, category.categoryLabel, category.totalActivitySeconds, now, now);
    });
}
function upsertHourlySegment(pairing, sourceDevice, segment) {
    const existing = getDatabase()
        .prepare(`SELECT id
       FROM screen_time_hourly_segments
       WHERE user_id = ?
         AND source_device = ?
         AND date_key = ?
         AND hour_index = ?`)
        .get(pairing.user_id, sourceDevice, segment.dateKey, segment.hourIndex);
    const id = existing?.id ?? `sth_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO screen_time_hourly_segments (
         id, user_id, pairing_session_id, source_device, date_key, hour_index,
         started_at, ended_at, total_activity_seconds, pickup_count, notification_count,
         first_pickup_at, longest_activity_started_at, longest_activity_ended_at,
         metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, source_device, date_key, hour_index) DO UPDATE SET
         pairing_session_id = excluded.pairing_session_id,
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         total_activity_seconds = excluded.total_activity_seconds,
         pickup_count = excluded.pickup_count,
         notification_count = excluded.notification_count,
         first_pickup_at = excluded.first_pickup_at,
         longest_activity_started_at = excluded.longest_activity_started_at,
         longest_activity_ended_at = excluded.longest_activity_ended_at,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`)
        .run(id, pairing.user_id, pairing.id, sourceDevice, segment.dateKey, segment.hourIndex, segment.startedAt, segment.endedAt, segment.totalActivitySeconds, segment.pickupCount, segment.notificationCount, segment.firstPickupAt, segment.longestActivityStartedAt, segment.longestActivityEndedAt, JSON.stringify(segment.metadata ?? {}), now, now);
    replaceSegmentChildren(id, segment.apps, segment.categories);
    return existing ? "updated" : "created";
}
export function ingestScreenTimeSync(pairing, payload, sourceDevice = "iPhone") {
    const parsed = screenTimeSyncPayloadSchema.parse(payload);
    const settings = upsertScreenTimeSettings(pairing.user_id, parsed.settings);
    let createdCount = 0;
    let updatedCount = 0;
    parsed.daySummaries.forEach((summary) => {
        const mode = upsertDaySummary(pairing, sourceDevice, summary);
        if (mode === "created") {
            createdCount += 1;
        }
        else {
            updatedCount += 1;
        }
    });
    parsed.hourlySegments.forEach((segment) => {
        const mode = upsertHourlySegment(pairing, sourceDevice, segment);
        if (mode === "created") {
            createdCount += 1;
        }
        else {
            updatedCount += 1;
        }
    });
    recordDiagnosticLog({
        level: parsed.settings.authorizationStatus === "denied" ||
            parsed.settings.authorizationStatus === "unavailable"
            ? "warning"
            : "info",
        scope: "screen_time_sync",
        eventKey: "screen_time_sync_ingested",
        message: parsed.settings.authorizationStatus === "approved"
            ? `Ingested Screen Time payload with ${parsed.hourlySegments.length} hourly segments.`
            : `Screen Time sync reported ${parsed.settings.authorizationStatus}.`,
        entityType: "system",
        entityId: pairing.id,
        details: {
            userId: pairing.user_id,
            authorizationStatus: parsed.settings.authorizationStatus,
            captureState: parsed.settings.captureState,
            sourceDevice,
            daySummaries: parsed.daySummaries.length,
            hourlySegments: parsed.hourlySegments.length,
            createdCount,
            updatedCount
        }
    });
    if (parsed.settings.authorizationStatus === "approved" &&
        parsed.hourlySegments.length === 0) {
        recordDiagnosticLog({
            level: "warning",
            scope: "screen_time_sync",
            eventKey: "screen_time_capture_empty",
            message: "Screen Time was approved but no hourly segments were synced.",
            entityType: "system",
            entityId: pairing.id,
            details: {
                userId: pairing.user_id,
                sourceDevice,
                lastCapturedDayKey: parsed.settings.lastCapturedDayKey,
                captureState: parsed.settings.captureState
            }
        });
    }
    return {
        settings,
        createdCount,
        updatedCount,
        daySummaries: parsed.daySummaries.length,
        hourlySegments: parsed.hourlySegments.length
    };
}
export function getScreenTimeSettings(userIds) {
    const effectiveUserId = userIds?.[0] ?? getDefaultUser().id;
    const settings = mapScreenTimeSettings(ensureScreenTimeSettings(effectiveUserId));
    const capturedDayCount = getDatabase()
        .prepare(`SELECT COUNT(*) as count
       FROM screen_time_day_summaries
       WHERE user_id = ?`)
        .get(effectiveUserId);
    const capturedHourCount = getDatabase()
        .prepare(`SELECT COUNT(*) as count
       FROM screen_time_hourly_segments
       WHERE user_id = ?`)
        .get(effectiveUserId);
    return {
        ...settings,
        ...screenTimeCaptureStats({
            authorizationStatus: settings.authorizationStatus,
            lastCaptureStartedAt: settings.lastCaptureStartedAt,
            lastCaptureEndedAt: settings.lastCaptureEndedAt,
            capturedDayCount: capturedDayCount.count,
            capturedHourCount: capturedHourCount.count
        })
    };
}
export function updateScreenTimeSettings(userId, patch) {
    const existing = getScreenTimeSettings([userId]);
    const parsed = screenTimeSettingsPatchSchema.parse(patch);
    return upsertScreenTimeSettings(userId, {
        trackingEnabled: parsed.trackingEnabled ?? existing.trackingEnabled,
        syncEnabled: parsed.syncEnabled ?? existing.syncEnabled,
        authorizationStatus: parsed.authorizationStatus ?? existing.authorizationStatus,
        captureState: parsed.captureState ?? existing.captureState,
        lastCapturedDayKey: parsed.lastCapturedDayKey ?? existing.lastCapturedDayKey,
        lastCaptureStartedAt: parsed.lastCaptureStartedAt ?? existing.lastCaptureStartedAt,
        lastCaptureEndedAt: parsed.lastCaptureEndedAt ?? existing.lastCaptureEndedAt,
        metadata: {
            ...existing.metadata,
            ...(parsed.metadata ?? {})
        }
    });
}
export function getScreenTimeOverlapSummary(input) {
    const segmentRows = listHourlySegmentRows({
        userIds: input.userIds,
        startedBefore: input.endedAt,
        endedAfter: input.startedAt
    });
    if (segmentRows.length === 0) {
        return {
            estimatedScreenTimeSeconds: 0,
            pickupCount: 0,
            notificationCount: 0,
            topApps: [],
            topCategories: []
        };
    }
    const appRowsBySegment = new Map();
    listAppUsageRows(segmentRows.map((row) => row.id)).forEach((row) => {
        appRowsBySegment.set(row.segment_id, [...(appRowsBySegment.get(row.segment_id) ?? []), row]);
    });
    const categoryRowsBySegment = new Map();
    listCategoryUsageRows(segmentRows.map((row) => row.id)).forEach((row) => {
        categoryRowsBySegment.set(row.segment_id, [
            ...(categoryRowsBySegment.get(row.segment_id) ?? []),
            row
        ]);
    });
    let estimatedScreenTimeSeconds = 0;
    let pickupCount = 0;
    let notificationCount = 0;
    const weightedApps = [];
    const weightedCategories = [];
    segmentRows.forEach((row) => {
        const overlap = overlapSeconds(input.startedAt, input.endedAt, row.started_at, row.ended_at);
        const segmentSeconds = Math.max(1, overlapSeconds(row.started_at, row.ended_at, row.started_at, row.ended_at));
        const ratio = overlap / segmentSeconds;
        if (ratio <= 0) {
            return;
        }
        estimatedScreenTimeSeconds += row.total_activity_seconds * ratio;
        pickupCount += row.pickup_count * ratio;
        notificationCount += row.notification_count * ratio;
        (appRowsBySegment.get(row.id) ?? []).forEach((app) => {
            weightedApps.push({
                bundleIdentifier: app.bundle_identifier,
                displayName: app.display_name,
                categoryLabel: app.category_label,
                totalActivitySeconds: app.total_activity_seconds * ratio,
                pickupCount: app.pickup_count * ratio,
                notificationCount: app.notification_count * ratio
            });
        });
        (categoryRowsBySegment.get(row.id) ?? []).forEach((category) => {
            weightedCategories.push({
                categoryLabel: category.category_label,
                totalActivitySeconds: category.total_activity_seconds * ratio
            });
        });
    });
    return {
        estimatedScreenTimeSeconds: Math.round(estimatedScreenTimeSeconds),
        pickupCount: Math.round(pickupCount),
        notificationCount: Math.round(notificationCount),
        topApps: aggregateAppUsage(weightedApps).slice(0, 4).map((app) => ({
            ...app,
            totalActivitySeconds: Math.round(app.totalActivitySeconds),
            pickupCount: Math.round(app.pickupCount),
            notificationCount: Math.round(app.notificationCount)
        })),
        topCategories: aggregateCategoryUsage(weightedCategories)
            .slice(0, 4)
            .map((category) => ({
            ...category,
            totalActivitySeconds: Math.round(category.totalActivitySeconds)
        }))
    };
}
export function getScreenTimeDayDetail(input) {
    const targetDate = input.date ?? new Date().toISOString().slice(0, 10);
    const segmentRows = listHourlySegmentRows({
        userIds: input.userIds,
        dateKey: targetDate
    });
    const appRows = listAppUsageRows(segmentRows.map((row) => row.id));
    const categoryRows = listCategoryUsageRows(segmentRows.map((row) => row.id));
    const appRowsBySegment = new Map();
    appRows.forEach((row) => {
        appRowsBySegment.set(row.segment_id, [...(appRowsBySegment.get(row.segment_id) ?? []), row]);
    });
    const categoryRowsBySegment = new Map();
    categoryRows.forEach((row) => {
        categoryRowsBySegment.set(row.segment_id, [
            ...(categoryRowsBySegment.get(row.segment_id) ?? []),
            row
        ]);
    });
    const hourlySegments = segmentRows.map((row) => mapHourlySegment(row, appRowsBySegment.get(row.id) ?? [], categoryRowsBySegment.get(row.id) ?? []));
    const dayRows = listDaySummaryRows({
        userIds: input.userIds,
        dateKey: targetDate
    });
    const fallbackSummary = {
        totalActivitySeconds: hourlySegments.reduce((sum, segment) => sum + segment.totalActivitySeconds, 0),
        pickupCount: hourlySegments.reduce((sum, segment) => sum + segment.pickupCount, 0),
        notificationCount: hourlySegments.reduce((sum, segment) => sum + segment.notificationCount, 0),
        longestActivitySeconds: hourlySegments.reduce((max, segment) => {
            if (!segment.longestActivityStartedAt ||
                !segment.longestActivityEndedAt) {
                return max;
            }
            const seconds = overlapSeconds(segment.longestActivityStartedAt, segment.longestActivityEndedAt, segment.longestActivityStartedAt, segment.longestActivityEndedAt);
            return Math.max(max, seconds);
        }, 0)
    };
    const topApps = aggregateAppUsage(appRows.map((row) => ({
        bundleIdentifier: row.bundle_identifier,
        displayName: row.display_name,
        categoryLabel: row.category_label,
        totalActivitySeconds: row.total_activity_seconds,
        pickupCount: row.pickup_count,
        notificationCount: row.notification_count
    })));
    const topCategories = aggregateCategoryUsage(categoryRows.map((row) => ({
        categoryLabel: row.category_label,
        totalActivitySeconds: row.total_activity_seconds
    })));
    const firstPickupCandidates = dayRows
        .map((row) => row.first_pickup_at)
        .filter((value) => Boolean(value))
        .sort((left, right) => Date.parse(left) - Date.parse(right));
    return {
        date: targetDate,
        settings: getScreenTimeSettings(input.userIds),
        summary: {
            totalActivitySeconds: dayRows.reduce((sum, row) => sum + row.total_activity_seconds, 0) ||
                fallbackSummary.totalActivitySeconds,
            pickupCount: dayRows.reduce((sum, row) => sum + row.pickup_count, 0) ||
                fallbackSummary.pickupCount,
            notificationCount: dayRows.reduce((sum, row) => sum + row.notification_count, 0) ||
                fallbackSummary.notificationCount,
            firstPickupAt: firstPickupCandidates[0] ?? null,
            longestActivitySeconds: dayRows.reduce((max, row) => Math.max(max, row.longest_activity_seconds), 0) ||
                fallbackSummary.longestActivitySeconds,
            activeHourCount: hourlySegments.filter((segment) => segment.totalActivitySeconds > 0).length,
            averageHourlyActivitySeconds: round(average(hourlySegments
                .map((segment) => segment.totalActivitySeconds)
                .filter((value) => value > 0)))
        },
        hourlySegments,
        topApps: topApps.slice(0, 8),
        topCategories: topCategories.slice(0, 8)
    };
}
export function getScreenTimeMonthSummary(input) {
    const monthKey = input.month ?? new Date().toISOString().slice(0, 7);
    const dayRows = listDaySummaryRows({
        userIds: input.userIds,
        monthKey
    });
    const segmentRows = listHourlySegmentRows({
        userIds: input.userIds,
        monthKey
    });
    const appRows = listAppUsageRows(segmentRows.map((row) => row.id));
    const categoryRows = listCategoryUsageRows(segmentRows.map((row) => row.id));
    return {
        month: monthKey,
        days: dayRows.map((row) => ({
            dateKey: row.date_key,
            totalActivitySeconds: row.total_activity_seconds,
            pickupCount: row.pickup_count,
            notificationCount: row.notification_count,
            longestActivitySeconds: row.longest_activity_seconds
        })),
        totals: {
            totalActivitySeconds: dayRows.reduce((sum, row) => sum + row.total_activity_seconds, 0),
            pickupCount: dayRows.reduce((sum, row) => sum + row.pickup_count, 0),
            notificationCount: dayRows.reduce((sum, row) => sum + row.notification_count, 0),
            activeDays: dayRows.filter((row) => row.total_activity_seconds > 0).length
        },
        topApps: aggregateAppUsage(appRows.map((row) => ({
            bundleIdentifier: row.bundle_identifier,
            displayName: row.display_name,
            categoryLabel: row.category_label,
            totalActivitySeconds: row.total_activity_seconds,
            pickupCount: row.pickup_count,
            notificationCount: row.notification_count
        }))).slice(0, 10),
        topCategories: aggregateCategoryUsage(categoryRows.map((row) => ({
            categoryLabel: row.category_label,
            totalActivitySeconds: row.total_activity_seconds
        }))).slice(0, 10)
    };
}
export function getScreenTimeAllTimeSummary(userIds) {
    const dayRows = listDaySummaryRows({ userIds });
    const segmentRows = listHourlySegmentRows({ userIds });
    const appRows = listAppUsageRows(segmentRows.map((row) => row.id));
    const categoryRows = listCategoryUsageRows(segmentRows.map((row) => row.id));
    const weekdayMap = new Map();
    dayRows.forEach((row) => {
        const weekday = new Date(`${row.date_key}T12:00:00.000Z`).getUTCDay();
        const existing = weekdayMap.get(weekday) ?? {
            weekday,
            totalActivitySeconds: 0,
            pickupCount: 0,
            notificationCount: 0,
            days: 0
        };
        existing.totalActivitySeconds += row.total_activity_seconds;
        existing.pickupCount += row.pickup_count;
        existing.notificationCount += row.notification_count;
        existing.days += 1;
        weekdayMap.set(weekday, existing);
    });
    return {
        summary: {
            dayCount: dayRows.length,
            totalActivitySeconds: dayRows.reduce((sum, row) => sum + row.total_activity_seconds, 0),
            totalPickups: dayRows.reduce((sum, row) => sum + row.pickup_count, 0),
            totalNotifications: dayRows.reduce((sum, row) => sum + row.notification_count, 0),
            averageDailyActivitySeconds: round(average(dayRows.map((row) => row.total_activity_seconds))),
            averageDailyPickups: round(average(dayRows.map((row) => row.pickup_count)), 1)
        },
        weekdayPattern: [...weekdayMap.values()]
            .sort((left, right) => left.weekday - right.weekday)
            .map((row) => ({
            weekday: row.weekday,
            averageActivitySeconds: round(row.totalActivitySeconds / Math.max(1, row.days)),
            averagePickups: round(row.pickupCount / Math.max(1, row.days), 1),
            averageNotifications: round(row.notificationCount / Math.max(1, row.days), 1)
        })),
        topApps: aggregateAppUsage(appRows.map((row) => ({
            bundleIdentifier: row.bundle_identifier,
            displayName: row.display_name,
            categoryLabel: row.category_label,
            totalActivitySeconds: row.total_activity_seconds,
            pickupCount: row.pickup_count,
            notificationCount: row.notification_count
        }))).slice(0, 12),
        topCategories: aggregateCategoryUsage(categoryRows.map((row) => ({
            categoryLabel: row.category_label,
            totalActivitySeconds: row.total_activity_seconds
        }))).slice(0, 12)
    };
}
