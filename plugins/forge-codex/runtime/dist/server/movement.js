import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase } from "./db.js";
import { HttpError } from "./errors.js";
import { recordActivityEvent } from "./repositories/activity-events.js";
import { createNote, getNoteById, updateNote } from "./repositories/notes.js";
import { createManualRewardGrant } from "./repositories/rewards.js";
import { listTaskRuns } from "./repositories/task-runs.js";
import { getDefaultUser } from "./repositories/users.js";
import { listWikiSpaces } from "./repositories/wiki-memory.js";
const movementPublishModeSchema = z.enum([
    "auto_publish",
    "draft_review",
    "no_publish"
]);
const movementRetentionModeSchema = z.enum([
    "aggregates_only",
    "keep_recent_raw"
]);
const movementVisibilitySchema = z.enum(["personal", "shared"]);
export const movementCategoryTags = [
    "home",
    "workplace",
    "school",
    "grocery",
    "bar",
    "cafe",
    "clinic",
    "gym",
    "forest",
    "mountain",
    "nature",
    "holiday",
    "social",
    "travel",
    "other"
];
const movementCanonicalCategoryTagSet = new Set(movementCategoryTags);
const movementCategoryTagAliases = new Map([
    ["home", "home"],
    ["house", "home"],
    ["flat", "home"],
    ["apartment", "home"],
    ["work", "workplace"],
    ["workplace", "workplace"],
    ["office", "workplace"],
    ["coworking", "workplace"],
    ["school", "school"],
    ["campus", "school"],
    ["university", "school"],
    ["college", "school"],
    ["grocery", "grocery"],
    ["groceries", "grocery"],
    ["supermarket", "grocery"],
    ["market", "grocery"],
    ["bar", "bar"],
    ["pub", "bar"],
    ["cafe", "cafe"],
    ["coffee", "cafe"],
    ["coffee-shop", "cafe"],
    ["coffeehouse", "cafe"],
    ["clinic", "clinic"],
    ["hospital", "clinic"],
    ["medical", "clinic"],
    ["gym", "gym"],
    ["fitness", "gym"],
    ["fitness-center", "gym"],
    ["forest", "forest"],
    ["woods", "forest"],
    ["woodland", "forest"],
    ["mountain", "mountain"],
    ["mountains", "mountain"],
    ["alps", "mountain"],
    ["nature", "nature"],
    ["outdoors", "nature"],
    ["park", "nature"],
    ["holiday", "holiday"],
    ["vacation", "holiday"],
    ["travel-holiday", "holiday"],
    ["social", "social"],
    ["friends", "social"],
    ["socializing", "social"],
    ["travel", "travel"],
    ["trip", "travel"],
    ["commute", "travel"],
    ["other", "other"]
]);
function slugifyMovementTag(value) {
    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
export function normalizeMovementCategoryTag(value) {
    const slug = slugifyMovementTag(value);
    if (!slug) {
        return "";
    }
    return movementCategoryTagAliases.get(slug) ?? slug;
}
export function canonicalizeMovementCategoryTags(values) {
    return uniqStrings(values
        .map((value) => normalizeMovementCategoryTag(value))
        .filter((value) => value.length > 0));
}
export function isImportantMovementCategoryTag(value) {
    return movementCanonicalCategoryTagSet.has(normalizeMovementCategoryTag(value));
}
export const movementCategoryTagSchema = z
    .string()
    .trim()
    .min(1)
    .max(64)
    .transform((value) => normalizeMovementCategoryTag(value))
    .refine((value) => value.length > 0, {
    message: "Movement category tags must contain letters or numbers."
});
const linkedEntitySchema = z.object({
    entityType: z.string().trim().min(1),
    entityId: z.string().trim().min(1),
    label: z.string().trim().default("")
});
const linkedPersonSchema = z.object({
    noteId: z.string().trim().min(1).optional(),
    label: z.string().trim().min(1)
});
const movementPlaceInputSchema = z.object({
    externalUid: z.string().trim().min(1).default(""),
    label: z.string().trim().min(1),
    aliases: z.array(z.string().trim()).default([]),
    latitude: z.number().finite(),
    longitude: z.number().finite(),
    radiusMeters: z.number().positive().max(2000).default(100),
    categoryTags: z.array(movementCategoryTagSchema).default([]).transform(canonicalizeMovementCategoryTags),
    visibility: movementVisibilitySchema.default("shared"),
    wikiNoteId: z.string().trim().min(1).nullable().default(null),
    linkedEntities: z.array(linkedEntitySchema).default([]),
    linkedPeople: z.array(linkedPersonSchema).default([]),
    metadata: z.record(z.string(), z.unknown()).default({})
});
const movementStayInputSchema = z.object({
    externalUid: z.string().trim().min(1),
    label: z.string().trim().default(""),
    status: z.string().trim().default("completed"),
    classification: z.string().trim().default("stationary"),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    centerLatitude: z.number().finite(),
    centerLongitude: z.number().finite(),
    radiusMeters: z.number().positive().default(100),
    sampleCount: z.number().int().nonnegative().default(0),
    placeExternalUid: z.string().trim().default(""),
    placeLabel: z.string().trim().default(""),
    tags: z.array(z.string().trim()).default([]),
    metadata: z.record(z.string(), z.unknown()).default({})
});
const movementTripPointInputSchema = z.object({
    externalUid: z.string().trim().default(""),
    recordedAt: z.string().datetime(),
    latitude: z.number().finite(),
    longitude: z.number().finite(),
    accuracyMeters: z.number().nonnegative().nullable().default(null),
    altitudeMeters: z.number().nullable().default(null),
    speedMps: z.number().nonnegative().nullable().default(null),
    isStopAnchor: z.boolean().default(false)
});
const movementTripStopInputSchema = z.object({
    externalUid: z.string().trim().default(""),
    label: z.string().trim().default(""),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    latitude: z.number().finite(),
    longitude: z.number().finite(),
    radiusMeters: z.number().positive().default(80),
    placeExternalUid: z.string().trim().default(""),
    metadata: z.record(z.string(), z.unknown()).default({})
});
const movementTripInputSchema = z.object({
    externalUid: z.string().trim().min(1),
    label: z.string().trim().default(""),
    status: z.string().trim().default("completed"),
    travelMode: z.string().trim().default("travel"),
    activityType: z.string().trim().default(""),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    startPlaceExternalUid: z.string().trim().default(""),
    endPlaceExternalUid: z.string().trim().default(""),
    distanceMeters: z.number().nonnegative().default(0),
    movingSeconds: z.number().int().nonnegative().default(0),
    idleSeconds: z.number().int().nonnegative().default(0),
    averageSpeedMps: z.number().nonnegative().nullable().default(null),
    maxSpeedMps: z.number().nonnegative().nullable().default(null),
    caloriesKcal: z.number().nonnegative().nullable().default(null),
    expectedMet: z.number().nonnegative().nullable().default(null),
    tags: z.array(z.string().trim()).default([]),
    linkedEntities: z.array(linkedEntitySchema).default([]),
    linkedPeople: z.array(linkedPersonSchema).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
    points: z.array(movementTripPointInputSchema).default([]),
    stops: z.array(movementTripStopInputSchema).default([])
});
export const movementSettingsInputSchema = z.object({
    trackingEnabled: z.boolean().default(false),
    publishMode: movementPublishModeSchema.default("auto_publish"),
    retentionMode: movementRetentionModeSchema.default("aggregates_only"),
    locationPermissionStatus: z.string().trim().default("not_determined"),
    motionPermissionStatus: z.string().trim().default("unknown"),
    backgroundTrackingReady: z.boolean().default(false),
    metadata: z.record(z.string(), z.unknown()).default({})
});
export const movementSyncPayloadSchema = z.object({
    settings: movementSettingsInputSchema.default({}),
    knownPlaces: z.array(movementPlaceInputSchema).default([]),
    stays: z.array(movementStayInputSchema).default([]),
    trips: z.array(movementTripInputSchema).default([])
});
export const movementPlaceMutationSchema = movementPlaceInputSchema.extend({
    userId: z.string().trim().min(1).nullable().optional(),
    source: z.string().trim().default("user")
});
export const movementPlacePatchSchema = movementPlaceInputSchema.partial();
export const movementSelectionAggregateSchema = z.object({
    stayIds: z.array(z.string().trim().min(1)).default([]),
    tripIds: z.array(z.string().trim().min(1)).default([]),
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().optional(),
    userIds: z.array(z.string().trim().min(1)).default([])
});
export const movementSettingsPatchSchema = movementSettingsInputSchema.partial();
export const movementTimelineQuerySchema = z.object({
    before: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(120).default(40),
    includeInvalid: z.coerce.boolean().default(false),
    userIds: z.array(z.string().trim().min(1)).default([])
});
export const movementStayPatchSchema = z.object({
    label: z.string().trim().optional(),
    status: z.string().trim().optional(),
    classification: z.string().trim().optional(),
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().optional(),
    centerLatitude: z.number().finite().optional(),
    centerLongitude: z.number().finite().optional(),
    radiusMeters: z.number().positive().optional(),
    sampleCount: z.number().int().nonnegative().optional(),
    placeId: z.string().trim().min(1).nullable().optional(),
    placeExternalUid: z.string().trim().min(1).nullable().optional(),
    placeLabel: z.string().trim().optional(),
    tags: z.array(z.string().trim()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
});
export const movementTripPatchSchema = z.object({
    label: z.string().trim().optional(),
    status: z.string().trim().optional(),
    travelMode: z.string().trim().optional(),
    activityType: z.string().trim().optional(),
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().optional(),
    startPlaceId: z.string().trim().min(1).nullable().optional(),
    endPlaceId: z.string().trim().min(1).nullable().optional(),
    startPlaceExternalUid: z.string().trim().min(1).nullable().optional(),
    endPlaceExternalUid: z.string().trim().min(1).nullable().optional(),
    distanceMeters: z.number().nonnegative().optional(),
    movingSeconds: z.number().int().nonnegative().optional(),
    idleSeconds: z.number().int().nonnegative().optional(),
    averageSpeedMps: z.number().nonnegative().nullable().optional(),
    maxSpeedMps: z.number().nonnegative().nullable().optional(),
    caloriesKcal: z.number().nonnegative().nullable().optional(),
    expectedMet: z.number().nonnegative().nullable().optional(),
    tags: z.array(z.string().trim()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
});
export const movementTripPointPatchSchema = z.object({
    recordedAt: z.string().datetime().optional(),
    latitude: z.number().finite().optional(),
    longitude: z.number().finite().optional(),
    accuracyMeters: z.number().nonnegative().nullable().optional(),
    altitudeMeters: z.number().nullable().optional(),
    speedMps: z.number().nonnegative().nullable().optional(),
    isStopAnchor: z.boolean().optional()
});
export const movementMobileBootstrapSchema = z.object({
    sessionId: z.string().trim().min(1),
    pairingToken: z.string().trim().min(1)
});
export const movementMobileTimelineSchema = movementMobileBootstrapSchema.extend({
    before: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(120).default(40)
});
export const movementMobilePlaceMutationSchema = movementMobileBootstrapSchema.extend({
    place: movementPlaceMutationSchema.omit({ userId: true, source: true })
});
export const movementMobileStayPatchSchema = movementMobileBootstrapSchema.extend({
    patch: movementStayPatchSchema
});
export const movementMobileTripPatchSchema = movementMobileBootstrapSchema.extend({
    patch: movementTripPatchSchema
});
function nowIso() {
    return new Date().toISOString();
}
function normalizeTripPointExternalUid(tripExternalUid, point, index) {
    const explicit = point.externalUid.trim();
    if (explicit.length > 0) {
        return explicit;
    }
    return `${tripExternalUid}::${point.recordedAt}::${index}`;
}
function deriveTripMetricsFromPoints(points, current) {
    if (points.length === 0) {
        return {
            startedAt: current.started_at,
            endedAt: current.ended_at,
            distanceMeters: 0,
            movingSeconds: 0,
            idleSeconds: 0,
            averageSpeedMps: null,
            maxSpeedMps: null
        };
    }
    const sorted = [...points].sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt));
    let distanceMeters = 0;
    let movingSeconds = 0;
    let maxSpeedMps = 0;
    const speedSamples = [];
    for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const next = sorted[index];
        const elapsedSeconds = Math.max(0, Math.round((Date.parse(next.recordedAt) - Date.parse(previous.recordedAt)) / 1000));
        const segmentDistance = haversineDistanceMeters({ latitude: previous.latitude, longitude: previous.longitude }, { latitude: next.latitude, longitude: next.longitude });
        const inferredSpeed = elapsedSeconds > 0 ? segmentDistance / elapsedSeconds : 0;
        distanceMeters += segmentDistance;
        movingSeconds += elapsedSeconds;
        maxSpeedMps = Math.max(maxSpeedMps, previous.speedMps ?? 0, next.speedMps ?? 0, inferredSpeed);
        speedSamples.push(...(previous.speedMps != null ? [previous.speedMps] : []), ...(next.speedMps != null ? [next.speedMps] : []), ...(inferredSpeed > 0 ? [inferredSpeed] : []));
    }
    const startedAt = sorted[0].recordedAt;
    const endedAt = sorted[sorted.length - 1].recordedAt;
    const durationSeconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
    return {
        startedAt,
        endedAt,
        distanceMeters: round(distanceMeters, 2),
        movingSeconds,
        idleSeconds: Math.max(0, durationSeconds - movingSeconds),
        averageSpeedMps: speedSamples.length > 0
            ? round(speedSamples.reduce((sum, value) => sum + value, 0) /
                speedSamples.length, 3)
            : null,
        maxSpeedMps: maxSpeedMps > 0 ? round(maxSpeedMps, 3) : null
    };
}
function listMovementTripPointTombstones(userId, tripExternalUid) {
    return getDatabase()
        .prepare(`SELECT *
       FROM movement_trip_point_tombstones
       WHERE user_id = ?
         AND trip_external_uid = ?`)
        .all(userId, tripExternalUid);
}
function listMovementTripPointOverrides(userId, tripExternalUid) {
    return getDatabase()
        .prepare(`SELECT *
       FROM movement_trip_point_overrides
       WHERE user_id = ?
         AND trip_external_uid = ?`)
        .all(userId, tripExternalUid);
}
function listMovementStayTombstones(userId) {
    return getDatabase()
        .prepare(`SELECT *
       FROM movement_stay_tombstones
       WHERE user_id = ?`)
        .all(userId);
}
function listMovementStayOverrides(userId) {
    return getDatabase()
        .prepare(`SELECT *
       FROM movement_stay_overrides
       WHERE user_id = ?`)
        .all(userId);
}
function listMovementTripTombstones(userId) {
    return getDatabase()
        .prepare(`SELECT *
       FROM movement_trip_tombstones
       WHERE user_id = ?`)
        .all(userId);
}
function listMovementTripOverrides(userId) {
    return getDatabase()
        .prepare(`SELECT *
       FROM movement_trip_overrides
       WHERE user_id = ?`)
        .all(userId);
}
function applyMovementStaySyncDirectives(userId, stay) {
    const tombstoned = new Set(listMovementStayTombstones(userId).map((row) => row.stay_external_uid));
    if (tombstoned.has(stay.externalUid)) {
        return null;
    }
    const override = listMovementStayOverrides(userId).find((row) => row.stay_external_uid === stay.externalUid);
    if (!override) {
        return stay;
    }
    return movementStayInputSchema.parse({
        ...stay,
        ...safeJsonParse(override.stay_json, {}),
        externalUid: stay.externalUid
    });
}
function applyMovementTripSyncDirectives(userId, trip) {
    const tombstoned = new Set(listMovementTripTombstones(userId).map((row) => row.trip_external_uid));
    if (tombstoned.has(trip.externalUid)) {
        return null;
    }
    const override = listMovementTripOverrides(userId).find((row) => row.trip_external_uid === trip.externalUid);
    if (!override) {
        return trip;
    }
    return movementTripInputSchema.parse({
        ...trip,
        ...safeJsonParse(override.trip_json, {}),
        externalUid: trip.externalUid
    });
}
function applyTripPointSyncDirectives(input) {
    const tombstonedExternalUids = new Set(listMovementTripPointTombstones(input.userId, input.tripExternalUid).map((row) => row.point_external_uid));
    const overridesByExternalUid = new Map(listMovementTripPointOverrides(input.userId, input.tripExternalUid).map((row) => {
        const parsed = safeJsonParse(row.point_json, {});
        return [row.point_external_uid, parsed];
    }));
    return input.points
        .map((point, index) => ({
        ...point,
        externalUid: normalizeTripPointExternalUid(input.tripExternalUid, point, index)
    }))
        .filter((point) => !tombstonedExternalUids.has(point.externalUid))
        .map((point) => {
        const override = overridesByExternalUid.get(point.externalUid);
        if (!override) {
            return point;
        }
        return movementTripPointInputSchema.parse({
            ...point,
            ...override,
            externalUid: point.externalUid
        });
    });
}
function mapTripStopRowToInput(stop) {
    const place = stop.place_id
        ? getDatabase()
            .prepare(`SELECT external_uid
           FROM movement_places
           WHERE id = ?`)
            .get(stop.place_id)
        : undefined;
    return {
        externalUid: stop.external_uid,
        label: stop.label,
        startedAt: stop.started_at,
        endedAt: stop.ended_at,
        latitude: stop.latitude,
        longitude: stop.longitude,
        radiusMeters: stop.radius_meters,
        placeExternalUid: place?.external_uid ?? "",
        metadata: safeJsonParse(stop.metadata_json, {})
    };
}
function replaceTripPoints(tripId, tripExternalUid, points) {
    getDatabase()
        .prepare(`DELETE FROM movement_trip_points WHERE trip_id = ?`)
        .run(tripId);
    const pointInsert = getDatabase().prepare(`INSERT INTO movement_trip_points (
       id, trip_id, external_uid, sequence_index, recorded_at, latitude, longitude,
       accuracy_meters, altitude_meters, speed_mps, is_stop_anchor, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const now = nowIso();
    points.forEach((point, index) => {
        const externalUid = normalizeTripPointExternalUid(tripExternalUid, point, index);
        pointInsert.run(`mtp_${randomUUID().replaceAll("-", "").slice(0, 10)}`, tripId, externalUid, index, point.recordedAt, point.latitude, point.longitude, point.accuracyMeters, point.altitudeMeters, point.speedMps, point.isStopAnchor ? 1 : 0, now);
    });
}
function refreshTripDerivedFields(tripId) {
    const trip = getDatabase()
        .prepare(`SELECT *
       FROM movement_trips
       WHERE id = ?`)
        .get(tripId);
    if (!trip) {
        return undefined;
    }
    const points = listTripPoints([tripId]).map((point) => ({
        externalUid: point.external_uid,
        recordedAt: point.recorded_at,
        latitude: point.latitude,
        longitude: point.longitude,
        accuracyMeters: point.accuracy_meters,
        altitudeMeters: point.altitude_meters,
        speedMps: point.speed_mps,
        isStopAnchor: point.is_stop_anchor === 1
    }));
    const metrics = deriveTripMetricsFromPoints(points, trip);
    const stops = listTripStops([tripId]);
    const startPlace = resolvePlaceForCoordinates(trip.user_id, points[0]
        ? {
            latitude: points[0].latitude,
            longitude: points[0].longitude
        }
        : stops[0]
            ? {
                latitude: stops[0].latitude,
                longitude: stops[0].longitude
            }
            : {
                latitude: 0,
                longitude: 0
            }) ?? resolvePlaceRowById(trip.user_id, trip.start_place_id);
    const endPlace = resolvePlaceForCoordinates(trip.user_id, points[points.length - 1]
        ? {
            latitude: points[points.length - 1].latitude,
            longitude: points[points.length - 1].longitude
        }
        : stops[stops.length - 1]
            ? {
                latitude: stops[stops.length - 1].latitude,
                longitude: stops[stops.length - 1].longitude
            }
            : {
                latitude: 0,
                longitude: 0
            }) ?? resolvePlaceRowById(trip.user_id, trip.end_place_id);
    const expectedMet = inferExpectedMet(trip.activity_type, metrics.averageSpeedMps);
    getDatabase()
        .prepare(`UPDATE movement_trips
       SET start_place_id = ?,
           end_place_id = ?,
           started_at = ?,
           ended_at = ?,
           distance_meters = ?,
           moving_seconds = ?,
           idle_seconds = ?,
           average_speed_mps = ?,
           max_speed_mps = ?,
           expected_met = ?,
           updated_at = ?
       WHERE id = ?`)
        .run(startPlace?.id ?? null, endPlace?.id ?? null, metrics.startedAt, metrics.endedAt, metrics.distanceMeters, metrics.movingSeconds, metrics.idleSeconds, metrics.averageSpeedMps, metrics.maxSpeedMps, expectedMet, nowIso(), tripId);
    reconcileMovementOverlapValidation(trip.user_id);
    return getDatabase()
        .prepare(`SELECT *
       FROM movement_trips
       WHERE id = ?`)
        .get(tripId);
}
function safeJsonParse(value, fallback) {
    if (!value) {
        return fallback;
    }
    try {
        return JSON.parse(value);
    }
    catch {
        return fallback;
    }
}
function uniqStrings(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
function round(value, digits = 0) {
    return Number(value.toFixed(digits));
}
function average(values) {
    return values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0;
}
function durationSeconds(startedAt, endedAt) {
    return Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
}
function dayKey(value) {
    return value.slice(0, 10);
}
function monthKey(value) {
    return value.slice(0, 7);
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function encodeMovementTimelineCursor(cursor) {
    return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
function decodeMovementTimelineCursor(rawValue) {
    if (!rawValue) {
        return null;
    }
    try {
        const parsed = JSON.parse(Buffer.from(rawValue, "base64url").toString("utf8"));
        if (typeof parsed.id !== "string" ||
            typeof parsed.kind !== "string" ||
            typeof parsed.startedAt !== "string" ||
            typeof parsed.endedAt !== "string") {
            return null;
        }
        if (parsed.kind !== "stay" && parsed.kind !== "trip") {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
function haversineDistanceMeters(left, right) {
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const earthRadius = 6_371_000;
    const deltaLatitude = toRadians(right.latitude - left.latitude);
    const deltaLongitude = toRadians(right.longitude - left.longitude);
    const a = Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
        Math.cos(toRadians(left.latitude)) *
            Math.cos(toRadians(right.latitude)) *
            Math.sin(deltaLongitude / 2) *
            Math.sin(deltaLongitude / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
}
function estimateMovementXp(categoryTags, distanceMeters) {
    const tags = new Set(canonicalizeMovementCategoryTags(categoryTags));
    if (tags.has("holiday")) {
        return 45;
    }
    if (tags.has("nature") || tags.has("forest") || tags.has("mountain")) {
        return 28;
    }
    if (tags.has("social") || tags.has("bar")) {
        return 22;
    }
    if (tags.has("grocery")) {
        return 14;
    }
    if (tags.has("workplace") || tags.has("school")) {
        return 6;
    }
    if (distanceMeters >= 10_000) {
        return 18;
    }
    if (distanceMeters >= 3_000) {
        return 10;
    }
    return 4;
}
function inferExpectedMet(activityType, averageSpeedMps) {
    const normalized = activityType.trim().toLowerCase();
    if (normalized.includes("bike") || normalized.includes("cycle")) {
        return averageSpeedMps && averageSpeedMps > 5 ? 7.5 : 6.8;
    }
    if (normalized.includes("run")) {
        return 8.5;
    }
    if (normalized.includes("walk")) {
        return averageSpeedMps && averageSpeedMps > 1.8 ? 4.3 : 3.2;
    }
    if (averageSpeedMps && averageSpeedMps > 5) {
        return 5.5;
    }
    if (averageSpeedMps && averageSpeedMps > 1.3) {
        return 3.1;
    }
    return 1.8;
}
function defaultMovementSettings(userId) {
    const now = nowIso();
    return {
        userId,
        trackingEnabled: false,
        publishMode: "auto_publish",
        retentionMode: "aggregates_only",
        locationPermissionStatus: "not_determined",
        motionPermissionStatus: "unknown",
        backgroundTrackingReady: false,
        lastCompanionSyncAt: null,
        metadata: {},
        createdAt: now,
        updatedAt: now
    };
}
function mapMovementSettings(row) {
    if (!row) {
        return null;
    }
    return {
        userId: row.user_id,
        trackingEnabled: row.tracking_enabled === 1,
        publishMode: row.publish_mode,
        retentionMode: row.retention_mode,
        locationPermissionStatus: row.location_permission_status,
        motionPermissionStatus: row.motion_permission_status,
        backgroundTrackingReady: row.background_tracking_ready === 1,
        lastCompanionSyncAt: row.last_companion_sync_at,
        metadata: safeJsonParse(row.metadata_json, {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function mapMovementPlace(row) {
    const linkedEntities = safeJsonParse(row.linked_entities_json, []);
    const linkedPeople = safeJsonParse(row.linked_people_json, []);
    const wikiNote = row.wiki_note_id ? getNoteById(row.wiki_note_id) : null;
    return {
        id: row.id,
        externalUid: row.external_uid,
        userId: row.user_id,
        label: row.label,
        aliases: safeJsonParse(row.aliases_json, []),
        latitude: row.latitude,
        longitude: row.longitude,
        radiusMeters: row.radius_meters,
        categoryTags: safeJsonParse(row.category_tags_json, []),
        visibility: row.visibility,
        wikiNoteId: row.wiki_note_id,
        linkedEntities,
        linkedPeople,
        metadata: safeJsonParse(row.metadata_json, {}),
        source: row.source,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        wikiNote: wikiNote && !Array.isArray(wikiNote)
            ? {
                id: wikiNote.id,
                title: wikiNote.title,
                slug: wikiNote.slug
            }
            : null
    };
}
function mapMovementStay(row, placesById) {
    const note = row.published_note_id ? getNoteById(row.published_note_id) : null;
    const metrics = safeJsonParse(row.metrics_json, {});
    return {
        id: row.id,
        externalUid: row.external_uid,
        pairingSessionId: row.pairing_session_id,
        userId: row.user_id,
        placeId: row.place_id,
        label: row.label,
        status: row.status,
        classification: row.classification,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        durationSeconds: durationSeconds(row.started_at, row.ended_at),
        centerLatitude: row.center_latitude,
        centerLongitude: row.center_longitude,
        radiusMeters: row.radius_meters,
        sampleCount: row.sample_count,
        weather: safeJsonParse(row.weather_json, {}),
        metrics,
        metadata: safeJsonParse(row.metadata_json, {}),
        publishedNoteId: row.published_note_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        place: row.place_id ? placesById.get(row.place_id) ?? null : null,
        note: note && !Array.isArray(note)
            ? {
                id: note.id,
                title: note.title,
                slug: note.slug
            }
            : null
    };
}
function mapMovementTrip(row, placesById, points = [], stops = []) {
    const note = row.published_note_id ? getNoteById(row.published_note_id) : null;
    return {
        id: row.id,
        externalUid: row.external_uid,
        pairingSessionId: row.pairing_session_id,
        userId: row.user_id,
        startPlaceId: row.start_place_id,
        endPlaceId: row.end_place_id,
        label: row.label,
        status: row.status,
        travelMode: row.travel_mode,
        activityType: row.activity_type,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        durationSeconds: durationSeconds(row.started_at, row.ended_at),
        distanceMeters: row.distance_meters,
        movingSeconds: row.moving_seconds,
        idleSeconds: row.idle_seconds,
        averageSpeedMps: row.average_speed_mps,
        maxSpeedMps: row.max_speed_mps,
        caloriesKcal: row.calories_kcal,
        expectedMet: row.expected_met,
        weather: safeJsonParse(row.weather_json, {}),
        tags: safeJsonParse(row.tags_json, []),
        linkedEntities: safeJsonParse(row.linked_entities_json, []),
        linkedPeople: safeJsonParse(row.linked_people_json, []),
        metadata: safeJsonParse(row.metadata_json, {}),
        publishedNoteId: row.published_note_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startPlace: row.start_place_id ? placesById.get(row.start_place_id) ?? null : null,
        endPlace: row.end_place_id ? placesById.get(row.end_place_id) ?? null : null,
        points: points.map((point) => ({
            id: point.id,
            externalUid: point.external_uid,
            recordedAt: point.recorded_at,
            latitude: point.latitude,
            longitude: point.longitude,
            accuracyMeters: point.accuracy_meters,
            altitudeMeters: point.altitude_meters,
            speedMps: point.speed_mps,
            isStopAnchor: point.is_stop_anchor === 1
        })),
        stops: stops.map((stop) => ({
            id: stop.id,
            externalUid: stop.external_uid,
            sequenceIndex: stop.sequence_index,
            label: stop.label,
            placeId: stop.place_id,
            startedAt: stop.started_at,
            endedAt: stop.ended_at,
            durationSeconds: stop.duration_seconds,
            latitude: stop.latitude,
            longitude: stop.longitude,
            radiusMeters: stop.radius_meters,
            metadata: safeJsonParse(stop.metadata_json, {}),
            place: stop.place_id ? placesById.get(stop.place_id) ?? null : null
        })),
        note: note && !Array.isArray(note)
            ? {
                id: note.id,
                title: note.title,
                slug: note.slug
            }
            : null
    };
}
function getMovementSettingsRow(userId) {
    return getDatabase()
        .prepare(`SELECT *
       FROM movement_settings
       WHERE user_id = ?`)
        .get(userId);
}
function ensureMovementSettings(userId) {
    const existing = getMovementSettingsRow(userId);
    if (existing) {
        return existing;
    }
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO movement_settings (
         user_id, tracking_enabled, publish_mode, retention_mode,
         location_permission_status, motion_permission_status,
         background_tracking_ready, last_companion_sync_at, metadata_json,
         created_at, updated_at
       )
       VALUES (?, 0, 'auto_publish', 'aggregates_only', 'not_determined', 'unknown', 0, NULL, '{}', ?, ?)`)
        .run(userId, now, now);
    return getMovementSettingsRow(userId);
}
function listMovementPlaceRows(userIds) {
    const params = [];
    const where = userIds && userIds.length > 0
        ? `WHERE user_id IN (${userIds.map(() => "?").join(",")})`
        : "";
    if (userIds) {
        params.push(...userIds);
    }
    return getDatabase()
        .prepare(`SELECT *
       FROM movement_places
       ${where}
       ORDER BY label COLLATE NOCASE ASC`)
        .all(...params);
}
function listMovementStayRows(userIds, dateKey) {
    const params = [];
    const whereClauses = [];
    if (userIds && userIds.length > 0) {
        whereClauses.push(`user_id IN (${userIds.map(() => "?").join(",")})`);
        params.push(...userIds);
    }
    if (dateKey) {
        whereClauses.push("substr(started_at, 1, 10) <= ? AND substr(ended_at, 1, 10) >= ?");
        params.push(dateKey, dateKey);
    }
    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    return getDatabase()
        .prepare(`SELECT *
       FROM movement_stays
       ${where}
       ORDER BY started_at DESC`)
        .all(...params);
}
function listMovementTripRows(userIds, options = {}) {
    const params = [];
    const whereClauses = [];
    if (userIds && userIds.length > 0) {
        whereClauses.push(`user_id IN (${userIds.map(() => "?").join(",")})`);
        params.push(...userIds);
    }
    if (options.dateKey) {
        whereClauses.push("substr(started_at, 1, 10) <= ? AND substr(ended_at, 1, 10) >= ?");
        params.push(options.dateKey, options.dateKey);
    }
    if (options.month) {
        whereClauses.push("substr(started_at, 1, 7) = ?");
        params.push(options.month);
    }
    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    return getDatabase()
        .prepare(`SELECT *
       FROM movement_trips
       ${where}
       ORDER BY started_at DESC`)
        .all(...params);
}
function listTripPoints(tripIds) {
    if (tripIds.length === 0) {
        return [];
    }
    const placeholders = tripIds.map(() => "?").join(", ");
    return getDatabase()
        .prepare(`SELECT *
       FROM movement_trip_points
       WHERE trip_id IN (${placeholders})
       ORDER BY trip_id ASC, sequence_index ASC`)
        .all(...tripIds);
}
function listTripStops(tripIds) {
    if (tripIds.length === 0) {
        return [];
    }
    const placeholders = tripIds.map(() => "?").join(", ");
    return getDatabase()
        .prepare(`SELECT *
       FROM movement_trip_stops
       WHERE trip_id IN (${placeholders})
       ORDER BY trip_id ASC, sequence_index ASC`)
        .all(...tripIds);
}
function defaultSpaceId() {
    return listWikiSpaces()[0]?.id;
}
function syncPlaceWikiMetadata(placeId) {
    const row = getDatabase()
        .prepare(`SELECT *
       FROM movement_places
       WHERE id = ?`)
        .get(placeId);
    if (!row?.wiki_note_id) {
        return;
    }
    const note = getNoteById(row.wiki_note_id);
    if (!note || Array.isArray(note)) {
        return;
    }
    updateNote(row.wiki_note_id, {
        frontmatter: {
            ...note.frontmatter,
            location: {
                latitude: row.latitude,
                longitude: row.longitude,
                radiusMeters: row.radius_meters
            },
            locationTags: safeJsonParse(row.category_tags_json, [])
        }
    }, { actor: "Movement sync", source: "system" });
}
function resolvePlaceForCoordinates(userId, point, preferredExternalUid = "") {
    const rows = listMovementPlaceRows([userId]);
    if (preferredExternalUid.trim().length > 0) {
        const direct = rows.find((row) => row.external_uid.trim().length > 0 &&
            row.external_uid === preferredExternalUid);
        if (direct) {
            return direct;
        }
    }
    let best = null;
    for (const row of rows) {
        const distance = haversineDistanceMeters(point, {
            latitude: row.latitude,
            longitude: row.longitude
        });
        if (distance <= Math.max(100, row.radius_meters)) {
            if (!best || distance < best.distance) {
                best = { row, distance };
            }
        }
    }
    return best?.row;
}
function rangesOverlap(leftStartedAt, leftEndedAt, rightStartedAt, rightEndedAt) {
    return leftStartedAt < rightEndedAt && rightStartedAt < leftEndedAt;
}
function movementValidation(metadata) {
    const validation = metadata.validation &&
        typeof metadata.validation === "object" &&
        !Array.isArray(metadata.validation)
        ? metadata.validation
        : null;
    return validation;
}
function hasInvalidMovementRecord(metadata) {
    const validation = movementValidation(metadata);
    return (validation?.invalid === true ||
        validation?.invalidOverlap === true ||
        validation?.invalidTinyMove === true);
}
function reconcileMovementOverlapValidation(userId) {
    const stayRows = listMovementStayRows([userId]);
    const tripRows = listMovementTripRows([userId]);
    const entries = [
        ...stayRows.map((row) => ({
            id: row.id,
            kind: "stay",
            startedAt: row.started_at,
            endedAt: row.ended_at,
            metadataJson: row.metadata_json,
            label: row.label || "stay"
        })),
        ...tripRows.map((row) => ({
            id: row.id,
            kind: "trip",
            startedAt: row.started_at,
            endedAt: row.ended_at,
            metadataJson: row.metadata_json,
            label: row.label || "trip"
        }))
    ].sort((left, right) => left.startedAt.localeCompare(right.startedAt) ||
        left.endedAt.localeCompare(right.endedAt) ||
        left.kind.localeCompare(right.kind) ||
        left.id.localeCompare(right.id));
    const overlapIssuesByKey = new Map();
    for (let index = 0; index < entries.length; index += 1) {
        const current = entries[index];
        for (let nextIndex = index + 1; nextIndex < entries.length; nextIndex += 1) {
            const next = entries[nextIndex];
            if (next.startedAt >= current.endedAt) {
                break;
            }
            if (!rangesOverlap(current.startedAt, current.endedAt, next.startedAt, next.endedAt)) {
                continue;
            }
            const currentKey = `${current.kind}:${current.id}`;
            const nextKey = `${next.kind}:${next.id}`;
            const currentIssues = overlapIssuesByKey.get(currentKey) ?? [];
            currentIssues.push(`Overlaps ${next.kind} ${next.id} from ${next.startedAt} to ${next.endedAt}.`);
            overlapIssuesByKey.set(currentKey, currentIssues);
            const nextIssues = overlapIssuesByKey.get(nextKey) ?? [];
            nextIssues.push(`Overlaps ${current.kind} ${current.id} from ${current.startedAt} to ${current.endedAt}.`);
            overlapIssuesByKey.set(nextKey, nextIssues);
        }
    }
    const now = nowIso();
    stayRows.forEach((row) => {
        const metadata = safeJsonParse(row.metadata_json, {});
        const issues = overlapIssuesByKey.get(`stay:${row.id}`) ?? [];
        const validation = {
            ...(metadata.validation &&
                typeof metadata.validation === "object" &&
                !Array.isArray(metadata.validation)
                ? metadata.validation
                : {}),
            invalidOverlap: issues.length > 0,
            overlapIssues: issues,
            checkedAt: now
        };
        const nextMetadata = {
            ...metadata,
            validation
        };
        if (JSON.stringify(nextMetadata) !== JSON.stringify(metadata)) {
            getDatabase()
                .prepare(`UPDATE movement_stays
           SET metadata_json = ?, updated_at = ?
           WHERE id = ?`)
                .run(JSON.stringify(nextMetadata), now, row.id);
        }
    });
    tripRows.forEach((row) => {
        const metadata = safeJsonParse(row.metadata_json, {});
        const issues = overlapIssuesByKey.get(`trip:${row.id}`) ?? [];
        const tinyMoveIssues = [
            row.distance_meters < 100
                ? `Distance ${Math.round(row.distance_meters)}m is below the 100m minimum for a valid move.`
                : null,
            durationSeconds(row.started_at, row.ended_at) < 5 * 60
                ? `Duration ${durationSeconds(row.started_at, row.ended_at)}s is below the 5 minute minimum for a valid move.`
                : null
        ].filter((value) => Boolean(value));
        const validation = {
            ...(metadata.validation &&
                typeof metadata.validation === "object" &&
                !Array.isArray(metadata.validation)
                ? metadata.validation
                : {}),
            invalid: issues.length > 0 || tinyMoveIssues.length > 0,
            invalidOverlap: issues.length > 0,
            invalidTinyMove: tinyMoveIssues.length > 0,
            overlapIssues: issues,
            tinyMoveIssues,
            checkedAt: now
        };
        const nextMetadata = {
            ...metadata,
            validation
        };
        if (JSON.stringify(nextMetadata) !== JSON.stringify(metadata)) {
            getDatabase()
                .prepare(`UPDATE movement_trips
           SET metadata_json = ?, updated_at = ?
           WHERE id = ?`)
                .run(JSON.stringify(nextMetadata), now, row.id);
        }
    });
}
function resolvePlaceRowById(userId, placeId) {
    if (!placeId) {
        return null;
    }
    return (getDatabase()
        .prepare(`SELECT *
         FROM movement_places
         WHERE id = ?
           AND user_id = ?`)
        .get(placeId, userId) ?? null);
}
function resolvePlaceForPatch(input) {
    if (input.explicitPlaceId !== undefined) {
        return resolvePlaceRowById(input.userId, input.explicitPlaceId);
    }
    if (input.explicitPlaceExternalUid !== undefined) {
        return input.explicitPlaceExternalUid
            ? resolvePlaceForCoordinates(input.userId, input.fallbackCoordinates, input.explicitPlaceExternalUid) ?? null
            : null;
    }
    return undefined;
}
function createMovementNote(input) {
    const spaceId = defaultSpaceId();
    if (!spaceId) {
        return null;
    }
    return createNote({
        kind: "evidence",
        title: input.title,
        slug: "",
        summary: "",
        contentMarkdown: input.contentMarkdown,
        spaceId,
        parentSlug: null,
        indexOrder: 0,
        showInIndex: false,
        aliases: [],
        userId: input.userId,
        author: null,
        links: [],
        tags: input.tags,
        destroyAt: null,
        sourcePath: "",
        frontmatter: input.frontmatter,
        revisionHash: ""
    }, { actor: "Movement sync", source: "system" });
}
function formatMovementDurationForNote(valueSeconds) {
    if (valueSeconds >= 86_400) {
        return `${round(valueSeconds / 86_400, 1)} days`;
    }
    if (valueSeconds >= 3_600) {
        return `${round(valueSeconds / 3_600, 1)} hours`;
    }
    return `${Math.max(1, Math.round(valueSeconds / 60))} minutes`;
}
function mergeMovementNoteTags(existingTags, existingFrontmatter, generatedTags) {
    const movement = existingFrontmatter.movement &&
        typeof existingFrontmatter.movement === "object" &&
        !Array.isArray(existingFrontmatter.movement)
        ? existingFrontmatter.movement
        : null;
    const previousGeneratedTags = Array.isArray(movement?.generatedTags)
        ? movement.generatedTags.filter((value) => typeof value === "string")
        : [];
    const previousGeneratedTagSet = new Set(previousGeneratedTags.map((tag) => tag.toLowerCase()));
    const preservedTags = existingTags.filter((tag) => !previousGeneratedTagSet.has(tag.toLowerCase()));
    return uniqStrings([...preservedTags, ...generatedTags]);
}
function syncMovementNote(input) {
    const existingNote = input.publishedNoteId
        ? getNoteById(input.publishedNoteId)
        : null;
    if (existingNote && !Array.isArray(existingNote)) {
        const updated = updateNote(existingNote.id, {
            title: input.title,
            contentMarkdown: input.contentMarkdown,
            tags: mergeMovementNoteTags(existingNote.tags ?? [], existingNote.frontmatter, input.generatedTags),
            frontmatter: {
                ...existingNote.frontmatter,
                ...input.frontmatter
            }
        }, { actor: "Movement sync", source: "system" });
        return updated?.id ?? existingNote.id;
    }
    const created = createMovementNote({
        userId: input.userId,
        title: input.title,
        contentMarkdown: input.contentMarkdown,
        tags: input.generatedTags,
        frontmatter: input.frontmatter
    });
    return created?.id ?? null;
}
function syncStayNote(settings, stay, place) {
    if (!settings || settings.publishMode === "no_publish") {
        return null;
    }
    const label = place?.label || stay.label || "Unlabeled stay";
    const durationSecondsValue = durationSeconds(stay.started_at, stay.ended_at);
    const live = stay.status.trim().toLowerCase() !== "completed" &&
        stay.status.trim().toLowerCase() !== "closed";
    const generatedTags = uniqStrings([
        "movement",
        "stay",
        ...(place ? safeJsonParse(place.category_tags_json, []) : [])
    ]);
    const content = [
        live ? `Currently staying at **${label}**.` : `Stayed at **${label}**.`,
        "",
        `- Started: ${stay.started_at}`,
        `- ${live ? "Current end" : "Ended"}: ${stay.ended_at}`,
        `- Duration: ${formatMovementDurationForNote(durationSecondsValue)}`,
        `- Radius: ${Math.round(stay.radius_meters)} m`,
        `- Classification: ${stay.classification || "stationary"}`
    ].join("\n");
    return syncMovementNote({
        userId: stay.user_id,
        publishedNoteId: stay.published_note_id,
        title: `Stay · ${label}`,
        contentMarkdown: content,
        generatedTags,
        frontmatter: {
            observedAt: stay.started_at,
            movement: {
                kind: "stay",
                state: live ? "live" : "closed",
                stayId: stay.id,
                publishMode: settings.publishMode,
                placeId: place?.id ?? null,
                placeLabel: label,
                startedAt: stay.started_at,
                endedAt: stay.ended_at,
                durationSeconds: durationSecondsValue,
                generatedTags
            }
        }
    });
}
function syncTripNote(settings, trip, startPlace, endPlace) {
    if (!settings || settings.publishMode === "no_publish") {
        return null;
    }
    const startLabel = startPlace?.label || "Unknown start";
    const endLabel = endPlace?.label || "Unknown end";
    const durationSecondsValue = durationSeconds(trip.started_at, trip.ended_at);
    const distanceKm = round(trip.distance_meters / 1000, 2);
    const live = trip.status.trim().toLowerCase() !== "completed" &&
        trip.status.trim().toLowerCase() !== "closed";
    const generatedTags = uniqStrings([
        "movement",
        "trip",
        ...safeJsonParse(trip.tags_json, [])
    ]);
    const content = [
        live
            ? `Currently moving from **${startLabel}** to **${endLabel}**.`
            : `Travelled from **${startLabel}** to **${endLabel}**.`,
        "",
        `- Started: ${trip.started_at}`,
        `- ${live ? "Current end" : "Ended"}: ${trip.ended_at}`,
        `- Duration: ${formatMovementDurationForNote(durationSecondsValue)}`,
        `- Distance: ${distanceKm} km`,
        `- Activity: ${trip.activity_type || trip.travel_mode}`
    ].join("\n");
    return syncMovementNote({
        userId: trip.user_id,
        publishedNoteId: trip.published_note_id,
        title: `Trip · ${startLabel} → ${endLabel}`,
        contentMarkdown: content,
        generatedTags,
        frontmatter: {
            observedAt: trip.started_at,
            movement: {
                kind: "trip",
                state: live ? "live" : "closed",
                tripId: trip.id,
                publishMode: settings.publishMode,
                startPlaceId: startPlace?.id ?? null,
                endPlaceId: endPlace?.id ?? null,
                startPlaceLabel: startLabel,
                endPlaceLabel: endLabel,
                startedAt: trip.started_at,
                endedAt: trip.ended_at,
                durationSeconds: durationSecondsValue,
                distanceMeters: trip.distance_meters,
                generatedTags
            }
        }
    });
}
function awardMovementXp(input) {
    const deltaXp = estimateMovementXp(input.categoryTags, input.distanceMeters);
    if (deltaXp <= 0) {
        return null;
    }
    return createManualRewardGrant({
        entityType: "system",
        entityId: input.entityId,
        deltaXp,
        reasonTitle: input.title,
        reasonSummary: `Movement activity reward for ${input.categoryTags.join(", ") || "general mobility"}.`,
        metadata: {}
    }, { actor: "Movement sync", source: "system" });
}
function upsertMovementSettings(userId, input) {
    const parsed = movementSettingsInputSchema.parse(input);
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO movement_settings (
         user_id, tracking_enabled, publish_mode, retention_mode,
         location_permission_status, motion_permission_status,
         background_tracking_ready, last_companion_sync_at, metadata_json,
         created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         tracking_enabled = excluded.tracking_enabled,
         publish_mode = excluded.publish_mode,
         retention_mode = excluded.retention_mode,
         location_permission_status = excluded.location_permission_status,
         motion_permission_status = excluded.motion_permission_status,
         background_tracking_ready = excluded.background_tracking_ready,
         last_companion_sync_at = excluded.last_companion_sync_at,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`)
        .run(userId, parsed.trackingEnabled ? 1 : 0, parsed.publishMode, parsed.retentionMode, parsed.locationPermissionStatus, parsed.motionPermissionStatus, parsed.backgroundTrackingReady ? 1 : 0, now, JSON.stringify(parsed.metadata), now, now);
    return mapMovementSettings(getMovementSettingsRow(userId));
}
function upsertMovementPlaceInternal(input) {
    const parsed = movementPlaceInputSchema.parse(input.place);
    const now = nowIso();
    const existing = input.id && input.id.trim().length > 0
        ? getDatabase()
            .prepare(`SELECT *
             FROM movement_places
             WHERE id = ?`)
            .get(input.id)
        : parsed.externalUid.trim().length > 0
            ? getDatabase()
                .prepare(`SELECT *
               FROM movement_places
               WHERE user_id = ?
                 AND source = ?
                 AND external_uid = ?`)
                .get(input.userId, input.source, parsed.externalUid)
            : undefined;
    const id = existing?.id ?? input.id ?? `mpl_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
        .prepare(`INSERT INTO movement_places (
         id, external_uid, user_id, label, aliases_json, latitude, longitude,
         radius_meters, category_tags_json, visibility, wiki_note_id,
         linked_entities_json, linked_people_json, metadata_json, source,
         created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         external_uid = excluded.external_uid,
         label = excluded.label,
         aliases_json = excluded.aliases_json,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         radius_meters = excluded.radius_meters,
         category_tags_json = excluded.category_tags_json,
         visibility = excluded.visibility,
         wiki_note_id = excluded.wiki_note_id,
         linked_entities_json = excluded.linked_entities_json,
         linked_people_json = excluded.linked_people_json,
         metadata_json = excluded.metadata_json,
         source = excluded.source,
         updated_at = excluded.updated_at`)
        .run(id, parsed.externalUid, input.userId, parsed.label, JSON.stringify(uniqStrings(parsed.aliases)), parsed.latitude, parsed.longitude, parsed.radiusMeters, JSON.stringify(canonicalizeMovementCategoryTags(parsed.categoryTags)), parsed.visibility, parsed.wikiNoteId, JSON.stringify(parsed.linkedEntities), JSON.stringify(parsed.linkedPeople), JSON.stringify(parsed.metadata), input.source, existing?.created_at ?? now, now);
    syncPlaceWikiMetadata(id);
    return mapMovementPlace(getDatabase()
        .prepare(`SELECT * FROM movement_places WHERE id = ?`)
        .get(id));
}
function replaceTripChildren(tripId, tripExternalUid, points, stops, userId) {
    replaceTripPoints(tripId, tripExternalUid, points);
    getDatabase()
        .prepare(`DELETE FROM movement_trip_stops WHERE trip_id = ?`)
        .run(tripId);
    const stopInsert = getDatabase().prepare(`INSERT INTO movement_trip_stops (
       id, external_uid, trip_id, sequence_index, label, place_id,
       started_at, ended_at, duration_seconds, latitude, longitude,
       radius_meters, metadata_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const now = nowIso();
    stops.forEach((stop, index) => {
        const matchedPlace = resolvePlaceForCoordinates(userId, { latitude: stop.latitude, longitude: stop.longitude }, stop.placeExternalUid);
        stopInsert.run(`mts_${randomUUID().replaceAll("-", "").slice(0, 10)}`, stop.externalUid, tripId, index, stop.label, matchedPlace?.id ?? null, stop.startedAt, stop.endedAt, durationSeconds(stop.startedAt, stop.endedAt), stop.latitude, stop.longitude, stop.radiusMeters, JSON.stringify(stop.metadata), now, now);
    });
}
function cleanupRawTripPoints(userId) {
    const staleTripRows = getDatabase()
        .prepare(`SELECT id
       FROM movement_trips
       WHERE user_id = ?
         AND ended_at <= datetime('now', '-30 day')`)
        .all(userId);
    for (const row of staleTripRows) {
        getDatabase()
            .prepare(`DELETE FROM movement_trip_points
         WHERE trip_id = ?
           AND is_stop_anchor = 0
           AND sequence_index NOT IN (
             SELECT MIN(sequence_index) FROM movement_trip_points WHERE trip_id = ?
             UNION
             SELECT MAX(sequence_index) FROM movement_trip_points WHERE trip_id = ?
           )`)
            .run(row.id, row.id, row.id);
    }
}
function upsertMovementStay(pairing, settings, input) {
    const parsed = movementStayInputSchema.parse(input);
    const existing = getDatabase()
        .prepare(`SELECT *
       FROM movement_stays
       WHERE user_id = ?
         AND external_uid = ?`)
        .get(pairing.user_id, parsed.externalUid);
    const now = nowIso();
    const matchedPlace = resolvePlaceForCoordinates(pairing.user_id, {
        latitude: parsed.centerLatitude,
        longitude: parsed.centerLongitude
    }, parsed.placeExternalUid);
    const metrics = {
        tags: uniqStrings(parsed.tags),
        durationSeconds: durationSeconds(parsed.startedAt, parsed.endedAt)
    };
    const id = existing?.id ?? `mst_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
        .prepare(`INSERT INTO movement_stays (
         id, external_uid, pairing_session_id, user_id, place_id, label,
         status, classification, started_at, ended_at, center_latitude,
         center_longitude, radius_meters, sample_count, weather_json,
         metrics_json, metadata_json, published_note_id, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, external_uid) DO UPDATE SET
         pairing_session_id = excluded.pairing_session_id,
         place_id = excluded.place_id,
         label = excluded.label,
         status = excluded.status,
         classification = excluded.classification,
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         center_latitude = excluded.center_latitude,
         center_longitude = excluded.center_longitude,
         radius_meters = excluded.radius_meters,
         sample_count = excluded.sample_count,
         weather_json = excluded.weather_json,
         metrics_json = excluded.metrics_json,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`)
        .run(id, parsed.externalUid, pairing.id, pairing.user_id, matchedPlace?.id ?? null, parsed.label || parsed.placeLabel, parsed.status, parsed.classification, parsed.startedAt, parsed.endedAt, parsed.centerLatitude, parsed.centerLongitude, parsed.radiusMeters, parsed.sampleCount, JSON.stringify({}), JSON.stringify(metrics), JSON.stringify(parsed.metadata), existing?.published_note_id ?? null, existing?.created_at ?? now, now);
    reconcileMovementOverlapValidation(pairing.user_id);
    const fresh = getDatabase()
        .prepare(`SELECT * FROM movement_stays WHERE user_id = ? AND external_uid = ?`)
        .get(pairing.user_id, parsed.externalUid);
    const freshMetadata = safeJsonParse(fresh.metadata_json, {});
    if (settings?.publishMode === "auto_publish" && !hasInvalidMovementRecord(freshMetadata)) {
        const publishedNoteId = syncStayNote(settings, fresh, matchedPlace);
        if (publishedNoteId && publishedNoteId !== fresh.published_note_id) {
            getDatabase()
                .prepare(`UPDATE movement_stays
           SET published_note_id = ?, updated_at = ?
           WHERE id = ?`)
                .run(publishedNoteId, nowIso(), fresh.id);
        }
    }
    return {
        mode: existing ? "updated" : "created",
        stayId: fresh.id
    };
}
function upsertMovementTrip(pairing, settings, input) {
    const parsed = movementTripInputSchema.parse(input);
    const existing = getDatabase()
        .prepare(`SELECT *
       FROM movement_trips
       WHERE user_id = ?
         AND external_uid = ?`)
        .get(pairing.user_id, parsed.externalUid);
    const now = nowIso();
    const canonicalPoints = applyTripPointSyncDirectives({
        userId: pairing.user_id,
        tripExternalUid: parsed.externalUid,
        points: parsed.points
    });
    const firstPoint = canonicalPoints[0] ?? null;
    const lastPoint = canonicalPoints[canonicalPoints.length - 1] ?? null;
    const startPlace = resolvePlaceForCoordinates(pairing.user_id, firstPoint
        ? {
            latitude: firstPoint.latitude,
            longitude: firstPoint.longitude
        }
        : parsed.stops[0]
            ? {
                latitude: parsed.stops[0].latitude,
                longitude: parsed.stops[0].longitude
            }
            : {
                latitude: 0,
                longitude: 0
            }, parsed.startPlaceExternalUid) ?? undefined;
    const endPlace = resolvePlaceForCoordinates(pairing.user_id, lastPoint
        ? {
            latitude: lastPoint.latitude,
            longitude: lastPoint.longitude
        }
        : parsed.stops[parsed.stops.length - 1]
            ? {
                latitude: parsed.stops[parsed.stops.length - 1].latitude,
                longitude: parsed.stops[parsed.stops.length - 1].longitude
            }
            : {
                latitude: 0,
                longitude: 0
            }, parsed.endPlaceExternalUid) ?? undefined;
    const derivedMetrics = deriveTripMetricsFromPoints(canonicalPoints, {
        started_at: parsed.startedAt,
        ended_at: parsed.endedAt,
        distance_meters: parsed.distanceMeters,
        moving_seconds: parsed.movingSeconds,
        idle_seconds: parsed.idleSeconds,
        average_speed_mps: parsed.averageSpeedMps,
        max_speed_mps: parsed.maxSpeedMps
    });
    const effectiveExpectedMet = parsed.expectedMet ??
        inferExpectedMet(parsed.activityType, derivedMetrics.averageSpeedMps ?? parsed.averageSpeedMps);
    const id = existing?.id ?? `mtr_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
        .prepare(`INSERT INTO movement_trips (
         id, external_uid, pairing_session_id, user_id, start_place_id,
         end_place_id, label, status, travel_mode, activity_type, started_at,
         ended_at, distance_meters, moving_seconds, idle_seconds,
         average_speed_mps, max_speed_mps, calories_kcal, expected_met,
         weather_json, tags_json, linked_entities_json, linked_people_json,
         metadata_json, published_note_id, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, external_uid) DO UPDATE SET
         pairing_session_id = excluded.pairing_session_id,
         start_place_id = excluded.start_place_id,
         end_place_id = excluded.end_place_id,
         label = excluded.label,
         status = excluded.status,
         travel_mode = excluded.travel_mode,
         activity_type = excluded.activity_type,
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         distance_meters = excluded.distance_meters,
         moving_seconds = excluded.moving_seconds,
         idle_seconds = excluded.idle_seconds,
         average_speed_mps = excluded.average_speed_mps,
         max_speed_mps = excluded.max_speed_mps,
         calories_kcal = excluded.calories_kcal,
         expected_met = excluded.expected_met,
         weather_json = excluded.weather_json,
         tags_json = excluded.tags_json,
         linked_entities_json = excluded.linked_entities_json,
         linked_people_json = excluded.linked_people_json,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`)
        .run(id, parsed.externalUid, pairing.id, pairing.user_id, startPlace?.id ?? null, endPlace?.id ?? null, parsed.label, parsed.status, parsed.travelMode, parsed.activityType, derivedMetrics.startedAt, derivedMetrics.endedAt, derivedMetrics.distanceMeters, derivedMetrics.movingSeconds, derivedMetrics.idleSeconds, derivedMetrics.averageSpeedMps, derivedMetrics.maxSpeedMps, parsed.caloriesKcal, effectiveExpectedMet, JSON.stringify({}), JSON.stringify(uniqStrings(parsed.tags)), JSON.stringify(parsed.linkedEntities), JSON.stringify(parsed.linkedPeople), JSON.stringify(parsed.metadata), existing?.published_note_id ?? null, existing?.created_at ?? now, now);
    reconcileMovementOverlapValidation(pairing.user_id);
    const fresh = getDatabase()
        .prepare(`SELECT * FROM movement_trips WHERE user_id = ? AND external_uid = ?`)
        .get(pairing.user_id, parsed.externalUid);
    replaceTripChildren(fresh.id, parsed.externalUid, canonicalPoints, parsed.stops, pairing.user_id);
    reconcileMovementOverlapValidation(pairing.user_id);
    const refreshed = getDatabase()
        .prepare(`SELECT * FROM movement_trips WHERE id = ?`)
        .get(fresh.id);
    const freshMetadata = safeJsonParse(refreshed.metadata_json, {});
    if (settings?.publishMode === "auto_publish" && !hasInvalidMovementRecord(freshMetadata)) {
        const publishedNoteId = syncTripNote(settings, refreshed, startPlace, endPlace);
        if (publishedNoteId && publishedNoteId !== refreshed.published_note_id) {
            getDatabase()
                .prepare(`UPDATE movement_trips
           SET published_note_id = ?, updated_at = ?
           WHERE id = ?`)
                .run(publishedNoteId, nowIso(), refreshed.id);
        }
    }
    if (!existing && settings?.publishMode === "auto_publish" && !hasInvalidMovementRecord(freshMetadata)) {
        awardMovementXp({
            userId: pairing.user_id,
            entityId: refreshed.id,
            categoryTags: uniqStrings([
                ...(startPlace
                    ? safeJsonParse(startPlace.category_tags_json, [])
                    : []),
                ...(endPlace
                    ? safeJsonParse(endPlace.category_tags_json, [])
                    : []),
                ...parsed.tags
            ]),
            distanceMeters: refreshed.distance_meters,
            title: "Movement exploration"
        });
    }
    return {
        mode: existing ? "updated" : "created",
        tripId: refreshed.id
    };
}
export function ingestMovementSync(pairing, payload) {
    const parsed = movementSyncPayloadSchema.parse(payload);
    const settings = upsertMovementSettings(pairing.user_id, parsed.settings);
    let createdCount = 0;
    let updatedCount = 0;
    parsed.knownPlaces.forEach((place) => {
        const existing = place.externalUid
            ? getDatabase()
                .prepare(`SELECT id
             FROM movement_places
             WHERE user_id = ?
               AND source = 'companion'
               AND external_uid = ?`)
                .get(pairing.user_id, place.externalUid)
            : undefined;
        upsertMovementPlaceInternal({
            userId: pairing.user_id,
            source: "companion",
            id: existing?.id ?? null,
            place
        });
        if (existing) {
            updatedCount += 1;
        }
        else {
            createdCount += 1;
        }
    });
    parsed.stays.forEach((stay) => {
        const canonicalStay = applyMovementStaySyncDirectives(pairing.user_id, stay);
        if (!canonicalStay) {
            return;
        }
        const result = upsertMovementStay(pairing, settings, canonicalStay);
        if (result.mode === "created") {
            createdCount += 1;
        }
        else {
            updatedCount += 1;
        }
    });
    parsed.trips.forEach((trip) => {
        const canonicalTrip = applyMovementTripSyncDirectives(pairing.user_id, trip);
        if (!canonicalTrip) {
            return;
        }
        const result = upsertMovementTrip(pairing, settings, canonicalTrip);
        if (result.mode === "created") {
            createdCount += 1;
        }
        else {
            updatedCount += 1;
        }
    });
    cleanupRawTripPoints(pairing.user_id);
    recordActivityEvent({
        entityType: "system",
        entityId: pairing.id,
        eventType: "movement_sync_completed",
        title: "Movement sync completed",
        description: "Forge Companion synchronized passive movement stays, trips, and known places.",
        actor: "Forge Companion",
        source: "system",
        metadata: {
            knownPlaces: parsed.knownPlaces.length,
            stays: parsed.stays.length,
            trips: parsed.trips.length
        }
    });
    return {
        createdCount,
        updatedCount,
        knownPlaces: parsed.knownPlaces.length,
        stays: parsed.stays.length,
        trips: parsed.trips.length,
        settings
    };
}
export function listMovementPlaces(userIds) {
    return listMovementPlaceRows(userIds).map(mapMovementPlace);
}
export function createMovementPlace(input, context) {
    const parsed = movementPlaceMutationSchema.parse(input);
    const place = upsertMovementPlaceInternal({
        userId: parsed.userId ?? getDefaultUser().id,
        source: parsed.source,
        place: parsed
    });
    recordActivityEvent({
        entityType: "system",
        entityId: place.id,
        eventType: "movement_place_created",
        title: "Movement place added",
        description: `Added ${place.label} as a known place for movement reasoning.`,
        actor: context.actor ?? null,
        source: context.source,
        metadata: {
            label: place.label,
            categoryTags: place.categoryTags
        }
    });
    return place;
}
export function updateMovementPlace(placeId, patch, context) {
    const existing = getDatabase()
        .prepare(`SELECT *
       FROM movement_places
       WHERE id = ?`)
        .get(placeId);
    if (!existing) {
        return undefined;
    }
    const parsed = movementPlacePatchSchema.parse(patch);
    const place = upsertMovementPlaceInternal({
        userId: existing.user_id,
        source: existing.source,
        id: placeId,
        place: {
            externalUid: parsed.externalUid ?? existing.external_uid,
            label: parsed.label ?? existing.label,
            aliases: parsed.aliases ?? safeJsonParse(existing.aliases_json, []),
            latitude: parsed.latitude ?? existing.latitude,
            longitude: parsed.longitude ?? existing.longitude,
            radiusMeters: parsed.radiusMeters ?? existing.radius_meters,
            categoryTags: parsed.categoryTags ??
                safeJsonParse(existing.category_tags_json, []),
            visibility: parsed.visibility ?? existing.visibility,
            wikiNoteId: parsed.wikiNoteId === undefined ? existing.wiki_note_id : parsed.wikiNoteId,
            linkedEntities: parsed.linkedEntities ??
                safeJsonParse(existing.linked_entities_json, []),
            linkedPeople: parsed.linkedPeople ??
                safeJsonParse(existing.linked_people_json, []),
            metadata: parsed.metadata ??
                safeJsonParse(existing.metadata_json, {})
        }
    });
    recordActivityEvent({
        entityType: "system",
        entityId: place.id,
        eventType: "movement_place_updated",
        title: "Movement place updated",
        description: `Updated ${place.label}.`,
        actor: context.actor ?? null,
        source: context.source,
        metadata: {
            categoryTags: place.categoryTags
        }
    });
    return place;
}
function buildMovementTimelineTitleForStay(stay) {
    return stay.place?.label || stay.label || "Stay";
}
function buildMovementTimelineSubtitleForStay(stay) {
    const metricTags = Array.isArray(stay.metrics.tags)
        ? (stay.metrics.tags ?? [])
        : [];
    const metadataTags = Array.isArray(stay.metadata.tags)
        ? (stay.metadata.tags ?? [])
        : [];
    const tags = uniqStrings([
        ...(stay.place?.categoryTags ?? []),
        ...metricTags,
        ...metadataTags
    ]);
    if (tags.length > 0) {
        return tags.join(" · ");
    }
    return stay.classification === "stationary" ? "Stay" : stay.classification;
}
function buildMovementTimelineTitleForTrip(trip) {
    return (trip.label ||
        `${trip.startPlace?.label ?? "Unknown"} → ${trip.endPlace?.label ?? "Unknown"}`);
}
function buildMovementTimelineSubtitleForTrip(trip) {
    const parts = [
        trip.distanceMeters > 0 ? `${round(trip.distanceMeters / 1000, 1)} km` : "",
        trip.activityType || trip.travelMode,
        trip.stops.length > 0 ? `${trip.stops.length} stop${trip.stops.length === 1 ? "" : "s"}` : ""
    ].filter(Boolean);
    return parts.join(" · ");
}
function compareMovementTimelineDescending(left, right) {
    return (right.endedAt.localeCompare(left.endedAt) ||
        right.startedAt.localeCompare(left.startedAt) ||
        right.kind.localeCompare(left.kind) ||
        right.id.localeCompare(left.id));
}
export function getMovementTimeline(input) {
    const parsed = movementTimelineQuerySchema.parse(input);
    const userIds = parsed.userIds.length > 0 ? parsed.userIds : undefined;
    const initialStayRows = listMovementStayRows(userIds);
    const initialTripRows = listMovementTripRows(userIds);
    const scopedUserIds = new Set();
    for (const row of initialStayRows) {
        scopedUserIds.add(row.user_id);
    }
    for (const row of initialTripRows) {
        scopedUserIds.add(row.user_id);
    }
    for (const scopedUserId of scopedUserIds) {
        reconcileMovementOverlapValidation(scopedUserId);
    }
    const places = listMovementPlaceRows(userIds).map(mapMovementPlace);
    const placesById = new Map(places.map((place) => [place.id, place]));
    const stayRows = listMovementStayRows(userIds);
    const tripRows = listMovementTripRows(userIds);
    const tripIds = tripRows.map((row) => row.id);
    const pointsByTrip = new Map();
    listTripPoints(tripIds).forEach((point) => {
        pointsByTrip.set(point.trip_id, [...(pointsByTrip.get(point.trip_id) ?? []), point]);
    });
    const stopsByTrip = new Map();
    listTripStops(tripIds).forEach((stop) => {
        stopsByTrip.set(stop.trip_id, [...(stopsByTrip.get(stop.trip_id) ?? []), stop]);
    });
    const chronological = [
        ...stayRows.map((row) => ({
            id: row.id,
            kind: "stay",
            startedAt: row.started_at,
            endedAt: row.ended_at,
            stay: mapMovementStay(row, placesById)
        })),
        ...tripRows.map((row) => ({
            id: row.id,
            kind: "trip",
            startedAt: row.started_at,
            endedAt: row.ended_at,
            trip: mapMovementTrip(row, placesById, pointsByTrip.get(row.id) ?? [], stopsByTrip.get(row.id) ?? [])
        }))
    ]
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt) ||
        left.endedAt.localeCompare(right.endedAt) ||
        left.kind.localeCompare(right.kind) ||
        left.id.localeCompare(right.id));
    const validChronological = chronological.filter((segment) => segment.kind === "stay"
        ? !hasInvalidMovementRecord(segment.stay.metadata)
        : !hasInvalidMovementRecord(segment.trip.metadata));
    let nextStayLane = "left";
    const stayLaneById = new Map();
    for (const segment of validChronological) {
        if (segment.kind === "stay") {
            stayLaneById.set(segment.id, nextStayLane);
            nextStayLane = nextStayLane === "left" ? "right" : "left";
        }
    }
    const timelineSource = parsed.includeInvalid ? chronological : validChronological;
    const decorated = timelineSource.map((segment, index) => {
        const previousStayId = [...timelineSource.slice(0, index)]
            .reverse()
            .find((candidate) => candidate.kind === "stay")?.id;
        const previousStayLane = previousStayId
            ? stayLaneById.get(previousStayId)
            : undefined;
        const nextStayLaneId = timelineSource
            .slice(index + 1)
            .find((candidate) => candidate.kind === "stay")?.id;
        const nextStayLane = nextStayLaneId ? stayLaneById.get(nextStayLaneId) : undefined;
        const cursor = {
            id: segment.id,
            kind: segment.kind,
            startedAt: segment.startedAt,
            endedAt: segment.endedAt
        };
        if (segment.kind === "stay") {
            const invalid = hasInvalidMovementRecord(segment.stay.metadata);
            const laneSide = stayLaneById.get(segment.id) ?? "left";
            return {
                id: segment.id,
                kind: "stay",
                startedAt: segment.startedAt,
                endedAt: segment.endedAt,
                durationSeconds: segment.stay.durationSeconds,
                laneSide,
                connectorFromLane: laneSide,
                connectorToLane: laneSide,
                title: buildMovementTimelineTitleForStay(segment.stay),
                subtitle: buildMovementTimelineSubtitleForStay(segment.stay),
                placeLabel: segment.stay.place?.label ?? segment.stay.placeId ?? null,
                tags: uniqStrings([
                    ...(segment.stay.place?.categoryTags ?? []),
                    ...(Array.isArray(segment.stay.metrics.tags)
                        ? (segment.stay.metrics.tags ?? [])
                        : [])
                ]),
                isInvalid: invalid,
                syncSource: segment.stay.pairingSessionId ? "companion" : "forge",
                cursor: encodeMovementTimelineCursor(cursor),
                stay: segment.stay,
                trip: null
            };
        }
        const invalid = hasInvalidMovementRecord(segment.trip.metadata);
        const laneSide = nextStayLane ?? previousStayLane ?? "left";
        return {
            id: segment.id,
            kind: "trip",
            startedAt: segment.startedAt,
            endedAt: segment.endedAt,
            durationSeconds: segment.trip.durationSeconds,
            laneSide,
            connectorFromLane: previousStayLane ?? laneSide,
            connectorToLane: nextStayLane ?? laneSide,
            title: buildMovementTimelineTitleForTrip(segment.trip),
            subtitle: buildMovementTimelineSubtitleForTrip(segment.trip),
            placeLabel: segment.trip.endPlace?.label ??
                segment.trip.startPlace?.label ??
                null,
            tags: uniqStrings([
                ...segment.trip.tags,
                ...(segment.trip.startPlace?.categoryTags ?? []),
                ...(segment.trip.endPlace?.categoryTags ?? [])
            ]),
            isInvalid: invalid,
            syncSource: segment.trip.pairingSessionId ? "companion" : "forge",
            cursor: encodeMovementTimelineCursor(cursor),
            stay: null,
            trip: segment.trip
        };
    });
    const descending = [...decorated].sort((left, right) => compareMovementTimelineDescending({
        id: left.id,
        kind: left.kind,
        startedAt: left.startedAt,
        endedAt: left.endedAt
    }, {
        id: right.id,
        kind: right.kind,
        startedAt: right.startedAt,
        endedAt: right.endedAt
    }));
    const beforeCursor = decodeMovementTimelineCursor(parsed.before);
    const filtered = beforeCursor
        ? descending.filter((segment) => compareMovementTimelineDescending({
            id: segment.id,
            kind: segment.kind,
            startedAt: segment.startedAt,
            endedAt: segment.endedAt
        }, beforeCursor) > 0)
        : descending;
    const segments = filtered.slice(0, parsed.limit);
    const nextCursor = filtered.length > segments.length && segments.length > 0
        ? segments[segments.length - 1].cursor
        : null;
    return {
        segments,
        nextCursor,
        hasMore: nextCursor !== null,
        invalidSegmentCount: chronological.length - validChronological.length
    };
}
export function updateMovementStay(stayId, patch, context, options = {}) {
    const existing = getDatabase()
        .prepare(`SELECT *
       FROM movement_stays
       WHERE id = ?`)
        .get(stayId);
    if (!existing) {
        return undefined;
    }
    if (options.userId && existing.user_id !== options.userId) {
        return undefined;
    }
    const parsed = movementStayPatchSchema.parse(patch);
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO movement_stay_overrides (
         id, user_id, stay_external_uid, stay_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, stay_external_uid) DO UPDATE SET
         stay_json = excluded.stay_json,
         updated_at = excluded.updated_at`)
        .run(`msto_${randomUUID().replaceAll("-", "").slice(0, 10)}`, existing.user_id, existing.external_uid, JSON.stringify(parsed), now, now);
    getDatabase()
        .prepare(`DELETE FROM movement_stay_tombstones
       WHERE user_id = ?
         AND stay_external_uid = ?`)
        .run(existing.user_id, existing.external_uid);
    const startedAt = parsed.startedAt ?? existing.started_at;
    const endedAt = parsed.endedAt ?? existing.ended_at;
    if (Date.parse(endedAt) < Date.parse(startedAt)) {
        throw new HttpError(400, "invalid_movement_stay_range", "Movement stay end time must be after the start time.");
    }
    const resolvedPlace = resolvePlaceForPatch({
        userId: existing.user_id,
        explicitPlaceId: hasOwn(parsed, "placeId") ? parsed.placeId : undefined,
        explicitPlaceExternalUid: hasOwn(parsed, "placeExternalUid") ? parsed.placeExternalUid : undefined,
        fallbackCoordinates: {
            latitude: parsed.centerLatitude ?? existing.center_latitude,
            longitude: parsed.centerLongitude ?? existing.center_longitude
        }
    }) ?? (hasOwn(parsed, "placeId") || hasOwn(parsed, "placeExternalUid")
        ? null
        : resolvePlaceRowById(existing.user_id, existing.place_id));
    const tags = parsed.tags !== undefined
        ? uniqStrings(parsed.tags)
        : Array.isArray((safeJsonParse(existing.metrics_json, {}).tags))
            ? uniqStrings((safeJsonParse(existing.metrics_json, {}).tags ??
                []))
            : [];
    const metrics = {
        ...safeJsonParse(existing.metrics_json, {}),
        tags
    };
    const metadata = {
        ...safeJsonParse(existing.metadata_json, {}),
        ...(parsed.metadata ?? {})
    };
    getDatabase()
        .prepare(`UPDATE movement_stays
       SET place_id = ?,
           label = ?,
           status = ?,
           classification = ?,
           started_at = ?,
           ended_at = ?,
           center_latitude = ?,
           center_longitude = ?,
           radius_meters = ?,
           sample_count = ?,
           metrics_json = ?,
           metadata_json = ?,
           updated_at = ?
       WHERE id = ?`)
        .run(resolvedPlace?.id ?? null, parsed.label ?? parsed.placeLabel ?? existing.label, parsed.status ?? existing.status, parsed.classification ?? existing.classification, startedAt, endedAt, parsed.centerLatitude ?? existing.center_latitude, parsed.centerLongitude ?? existing.center_longitude, parsed.radiusMeters ?? existing.radius_meters, parsed.sampleCount ?? existing.sample_count, JSON.stringify(metrics), JSON.stringify(metadata), nowIso(), stayId);
    reconcileMovementOverlapValidation(existing.user_id);
    const places = listMovementPlaceRows([existing.user_id]).map(mapMovementPlace);
    const placesById = new Map(places.map((place) => [place.id, place]));
    const updated = mapMovementStay(getDatabase()
        .prepare(`SELECT *
         FROM movement_stays
         WHERE id = ?`)
        .get(stayId), placesById);
    recordActivityEvent({
        entityType: "system",
        entityId: updated.id,
        eventType: "movement_stay_updated",
        title: "Movement stay updated",
        description: `Updated ${updated.place?.label ?? (updated.label || "movement stay")}.`,
        actor: context.actor ?? null,
        source: context.source,
        metadata: {
            placeId: updated.placeId,
            durationSeconds: updated.durationSeconds
        }
    });
    return updated;
}
export function updateMovementTrip(tripId, patch, context, options = {}) {
    const existing = getDatabase()
        .prepare(`SELECT *
       FROM movement_trips
       WHERE id = ?`)
        .get(tripId);
    if (!existing) {
        return undefined;
    }
    if (options.userId && existing.user_id !== options.userId) {
        return undefined;
    }
    const parsed = movementTripPatchSchema.parse(patch);
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO movement_trip_overrides (
         id, user_id, trip_external_uid, trip_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, trip_external_uid) DO UPDATE SET
         trip_json = excluded.trip_json,
         updated_at = excluded.updated_at`)
        .run(`mtro_${randomUUID().replaceAll("-", "").slice(0, 10)}`, existing.user_id, existing.external_uid, JSON.stringify(parsed), now, now);
    getDatabase()
        .prepare(`DELETE FROM movement_trip_tombstones
       WHERE user_id = ?
         AND trip_external_uid = ?`)
        .run(existing.user_id, existing.external_uid);
    const startedAt = parsed.startedAt ?? existing.started_at;
    const endedAt = parsed.endedAt ?? existing.ended_at;
    if (Date.parse(endedAt) < Date.parse(startedAt)) {
        throw new HttpError(400, "invalid_movement_trip_range", "Movement trip end time must be after the start time.");
    }
    const tripPoints = listTripPoints([tripId]);
    const fallbackStartPoint = tripPoints[0]
        ? {
            latitude: tripPoints[0].latitude,
            longitude: tripPoints[0].longitude
        }
        : { latitude: 0, longitude: 0 };
    const fallbackEndPoint = tripPoints[tripPoints.length - 1]
        ? {
            latitude: tripPoints[tripPoints.length - 1].latitude,
            longitude: tripPoints[tripPoints.length - 1].longitude
        }
        : fallbackStartPoint;
    const startPlace = resolvePlaceForPatch({
        userId: existing.user_id,
        explicitPlaceId: hasOwn(parsed, "startPlaceId") ? parsed.startPlaceId : undefined,
        explicitPlaceExternalUid: hasOwn(parsed, "startPlaceExternalUid")
            ? parsed.startPlaceExternalUid
            : undefined,
        fallbackCoordinates: fallbackStartPoint
    }) ?? (hasOwn(parsed, "startPlaceId") || hasOwn(parsed, "startPlaceExternalUid")
        ? null
        : resolvePlaceRowById(existing.user_id, existing.start_place_id));
    const endPlace = resolvePlaceForPatch({
        userId: existing.user_id,
        explicitPlaceId: hasOwn(parsed, "endPlaceId") ? parsed.endPlaceId : undefined,
        explicitPlaceExternalUid: hasOwn(parsed, "endPlaceExternalUid") ? parsed.endPlaceExternalUid : undefined,
        fallbackCoordinates: fallbackEndPoint
    }) ?? (hasOwn(parsed, "endPlaceId") || hasOwn(parsed, "endPlaceExternalUid")
        ? null
        : resolvePlaceRowById(existing.user_id, existing.end_place_id));
    const metadata = {
        ...safeJsonParse(existing.metadata_json, {}),
        ...(parsed.metadata ?? {})
    };
    getDatabase()
        .prepare(`UPDATE movement_trips
       SET start_place_id = ?,
           end_place_id = ?,
           label = ?,
           status = ?,
           travel_mode = ?,
           activity_type = ?,
           started_at = ?,
           ended_at = ?,
           distance_meters = ?,
           moving_seconds = ?,
           idle_seconds = ?,
           average_speed_mps = ?,
           max_speed_mps = ?,
           calories_kcal = ?,
           expected_met = ?,
           tags_json = ?,
           metadata_json = ?,
           updated_at = ?
       WHERE id = ?`)
        .run(startPlace?.id ?? null, endPlace?.id ?? null, parsed.label ?? existing.label, parsed.status ?? existing.status, parsed.travelMode ?? existing.travel_mode, parsed.activityType ?? existing.activity_type, startedAt, endedAt, parsed.distanceMeters ?? existing.distance_meters, parsed.movingSeconds ?? existing.moving_seconds, parsed.idleSeconds ?? existing.idle_seconds, parsed.averageSpeedMps === undefined
        ? existing.average_speed_mps
        : parsed.averageSpeedMps, parsed.maxSpeedMps === undefined ? existing.max_speed_mps : parsed.maxSpeedMps, parsed.caloriesKcal === undefined ? existing.calories_kcal : parsed.caloriesKcal, parsed.expectedMet === undefined ? existing.expected_met : parsed.expectedMet, JSON.stringify(parsed.tags !== undefined ? uniqStrings(parsed.tags) : safeJsonParse(existing.tags_json, [])), JSON.stringify(metadata), nowIso(), tripId);
    reconcileMovementOverlapValidation(existing.user_id);
    const places = listMovementPlaceRows([existing.user_id]).map(mapMovementPlace);
    const placesById = new Map(places.map((place) => [place.id, place]));
    const updated = mapMovementTrip(getDatabase()
        .prepare(`SELECT *
         FROM movement_trips
         WHERE id = ?`)
        .get(tripId), placesById, tripPoints, listTripStops([tripId]));
    recordActivityEvent({
        entityType: "system",
        entityId: updated.id,
        eventType: "movement_trip_updated",
        title: "Movement trip updated",
        description: `Updated ${updated.label || "movement trip"}.`,
        actor: context.actor ?? null,
        source: context.source,
        metadata: {
            startPlaceId: updated.startPlaceId,
            endPlaceId: updated.endPlaceId,
            distanceMeters: updated.distanceMeters
        }
    });
    return updated;
}
export function deleteMovementStay(stayId, context, options = {}) {
    const existing = getDatabase()
        .prepare(`SELECT *
       FROM movement_stays
       WHERE id = ?`)
        .get(stayId);
    if (!existing) {
        return undefined;
    }
    if (options.userId && existing.user_id !== options.userId) {
        return undefined;
    }
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO movement_stay_tombstones (
         id, user_id, stay_external_uid, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, stay_external_uid) DO UPDATE SET
         updated_at = excluded.updated_at`)
        .run(`mstt_${randomUUID().replaceAll("-", "").slice(0, 10)}`, existing.user_id, existing.external_uid, now, now);
    getDatabase()
        .prepare(`DELETE FROM movement_stay_overrides
       WHERE user_id = ?
         AND stay_external_uid = ?`)
        .run(existing.user_id, existing.external_uid);
    getDatabase()
        .prepare(`DELETE FROM movement_stays
       WHERE id = ?`)
        .run(stayId);
    reconcileMovementOverlapValidation(existing.user_id);
    recordActivityEvent({
        entityType: "system",
        entityId: stayId,
        eventType: "movement_stay_deleted",
        title: "Movement stay deleted",
        description: `Deleted ${existing.label || "movement stay"} and tombstoned it for sync.`,
        actor: context.actor ?? null,
        source: context.source,
        metadata: {
            stayExternalUid: existing.external_uid
        }
    });
    return {
        deletedStayId: stayId,
        deletedStayExternalUid: existing.external_uid
    };
}
export function deleteMovementTrip(tripId, context, options = {}) {
    const existing = getDatabase()
        .prepare(`SELECT *
       FROM movement_trips
       WHERE id = ?`)
        .get(tripId);
    if (!existing) {
        return undefined;
    }
    if (options.userId && existing.user_id !== options.userId) {
        return undefined;
    }
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO movement_trip_tombstones (
         id, user_id, trip_external_uid, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, trip_external_uid) DO UPDATE SET
         updated_at = excluded.updated_at`)
        .run(`mtrt_${randomUUID().replaceAll("-", "").slice(0, 10)}`, existing.user_id, existing.external_uid, now, now);
    getDatabase()
        .prepare(`DELETE FROM movement_trip_overrides
       WHERE user_id = ?
         AND trip_external_uid = ?`)
        .run(existing.user_id, existing.external_uid);
    getDatabase()
        .prepare(`DELETE FROM movement_trip_point_tombstones
       WHERE user_id = ?
         AND trip_external_uid = ?`)
        .run(existing.user_id, existing.external_uid);
    getDatabase()
        .prepare(`DELETE FROM movement_trip_point_overrides
       WHERE user_id = ?
         AND trip_external_uid = ?`)
        .run(existing.user_id, existing.external_uid);
    getDatabase()
        .prepare(`DELETE FROM movement_trips
       WHERE id = ?`)
        .run(tripId);
    reconcileMovementOverlapValidation(existing.user_id);
    recordActivityEvent({
        entityType: "system",
        entityId: tripId,
        eventType: "movement_trip_deleted",
        title: "Movement trip deleted",
        description: `Deleted ${existing.label || "movement trip"} and tombstoned it for sync.`,
        actor: context.actor ?? null,
        source: context.source,
        metadata: {
            tripExternalUid: existing.external_uid
        }
    });
    return {
        deletedTripId: tripId,
        deletedTripExternalUid: existing.external_uid
    };
}
export function updateMovementTripPoint(tripId, pointId, patch, context, options = {}) {
    const trip = getDatabase()
        .prepare(`SELECT *
       FROM movement_trips
       WHERE id = ?`)
        .get(tripId);
    if (!trip) {
        return undefined;
    }
    if (options.userId && trip.user_id !== options.userId) {
        return undefined;
    }
    const point = getDatabase()
        .prepare(`SELECT *
       FROM movement_trip_points
       WHERE id = ?
         AND trip_id = ?`)
        .get(pointId, tripId);
    if (!point) {
        return undefined;
    }
    const parsed = movementTripPointPatchSchema.parse(patch);
    const nextPoint = movementTripPointInputSchema.parse({
        externalUid: point.external_uid,
        recordedAt: parsed.recordedAt ?? point.recorded_at,
        latitude: parsed.latitude ?? point.latitude,
        longitude: parsed.longitude ?? point.longitude,
        accuracyMeters: parsed.accuracyMeters === undefined
            ? point.accuracy_meters
            : parsed.accuracyMeters,
        altitudeMeters: parsed.altitudeMeters === undefined
            ? point.altitude_meters
            : parsed.altitudeMeters,
        speedMps: parsed.speedMps === undefined ? point.speed_mps : parsed.speedMps,
        isStopAnchor: parsed.isStopAnchor === undefined
            ? point.is_stop_anchor === 1
            : parsed.isStopAnchor
    });
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO movement_trip_point_overrides (
         id, user_id, trip_external_uid, point_external_uid, point_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, trip_external_uid, point_external_uid) DO UPDATE SET
         point_json = excluded.point_json,
         updated_at = excluded.updated_at`)
        .run(`mtpo_${randomUUID().replaceAll("-", "").slice(0, 10)}`, trip.user_id, trip.external_uid, point.external_uid, JSON.stringify(nextPoint), now, now);
    getDatabase()
        .prepare(`DELETE FROM movement_trip_point_tombstones
       WHERE user_id = ?
         AND trip_external_uid = ?
         AND point_external_uid = ?`)
        .run(trip.user_id, trip.external_uid, point.external_uid);
    const currentPoints = listTripPoints([tripId]).map((row) => ({
        externalUid: row.external_uid,
        recordedAt: row.recorded_at,
        latitude: row.latitude,
        longitude: row.longitude,
        accuracyMeters: row.accuracy_meters,
        altitudeMeters: row.altitude_meters,
        speedMps: row.speed_mps,
        isStopAnchor: row.is_stop_anchor === 1
    }));
    const nextPoints = currentPoints
        .map((current) => current.externalUid === point.external_uid ? nextPoint : current)
        .sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt) ||
        left.externalUid.localeCompare(right.externalUid));
    replaceTripPoints(tripId, trip.external_uid, nextPoints);
    const refreshedTrip = refreshTripDerivedFields(tripId);
    if (!refreshedTrip) {
        return undefined;
    }
    const refreshedPoints = listTripPoints([tripId]);
    const updatedPoint = refreshedPoints.find((row) => row.external_uid === point.external_uid);
    if (!updatedPoint) {
        return undefined;
    }
    const places = listMovementPlaceRows([trip.user_id]).map(mapMovementPlace);
    const placesById = new Map(places.map((place) => [place.id, place]));
    const mappedTrip = mapMovementTrip(refreshedTrip, placesById, refreshedPoints, listTripStops([tripId]));
    recordActivityEvent({
        entityType: "system",
        entityId: tripId,
        eventType: "movement_trip_point_updated",
        title: "Movement datapoint updated",
        description: `Updated a raw movement datapoint inside ${refreshedTrip.label || "the selected trip"}.`,
        actor: context.actor ?? null,
        source: context.source,
        metadata: {
            tripId,
            pointId: updatedPoint.id,
            pointExternalUid: updatedPoint.external_uid
        }
    });
    return {
        point: {
            id: updatedPoint.id,
            externalUid: updatedPoint.external_uid,
            recordedAt: updatedPoint.recorded_at,
            latitude: updatedPoint.latitude,
            longitude: updatedPoint.longitude,
            accuracyMeters: updatedPoint.accuracy_meters,
            altitudeMeters: updatedPoint.altitude_meters,
            speedMps: updatedPoint.speed_mps,
            isStopAnchor: updatedPoint.is_stop_anchor === 1
        },
        trip: mappedTrip
    };
}
export function deleteMovementTripPoint(tripId, pointId, context, options = {}) {
    const trip = getDatabase()
        .prepare(`SELECT *
       FROM movement_trips
       WHERE id = ?`)
        .get(tripId);
    if (!trip) {
        return undefined;
    }
    if (options.userId && trip.user_id !== options.userId) {
        return undefined;
    }
    const point = getDatabase()
        .prepare(`SELECT *
       FROM movement_trip_points
       WHERE id = ?
         AND trip_id = ?`)
        .get(pointId, tripId);
    if (!point) {
        return undefined;
    }
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO movement_trip_point_tombstones (
         id, user_id, trip_external_uid, point_external_uid, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, trip_external_uid, point_external_uid) DO UPDATE SET
         updated_at = excluded.updated_at`)
        .run(`mtpt_${randomUUID().replaceAll("-", "").slice(0, 10)}`, trip.user_id, trip.external_uid, point.external_uid, now, now);
    getDatabase()
        .prepare(`DELETE FROM movement_trip_point_overrides
       WHERE user_id = ?
         AND trip_external_uid = ?
         AND point_external_uid = ?`)
        .run(trip.user_id, trip.external_uid, point.external_uid);
    const remainingPoints = listTripPoints([tripId])
        .filter((row) => row.id !== pointId)
        .map((row) => ({
        externalUid: row.external_uid,
        recordedAt: row.recorded_at,
        latitude: row.latitude,
        longitude: row.longitude,
        accuracyMeters: row.accuracy_meters,
        altitudeMeters: row.altitude_meters,
        speedMps: row.speed_mps,
        isStopAnchor: row.is_stop_anchor === 1
    }))
        .sort((left, right) => Date.parse(left.recordedAt) - Date.parse(right.recordedAt) ||
        left.externalUid.localeCompare(right.externalUid));
    replaceTripPoints(tripId, trip.external_uid, remainingPoints);
    const refreshedTrip = refreshTripDerivedFields(tripId);
    if (!refreshedTrip) {
        return undefined;
    }
    const places = listMovementPlaceRows([trip.user_id]).map(mapMovementPlace);
    const placesById = new Map(places.map((place) => [place.id, place]));
    const mappedTrip = mapMovementTrip(refreshedTrip, placesById, listTripPoints([tripId]), listTripStops([tripId]));
    recordActivityEvent({
        entityType: "system",
        entityId: tripId,
        eventType: "movement_trip_point_deleted",
        title: "Movement datapoint deleted",
        description: `Deleted a raw movement datapoint from ${refreshedTrip.label || "the selected trip"}.`,
        actor: context.actor ?? null,
        source: context.source,
        metadata: {
            tripId,
            pointExternalUid: point.external_uid
        }
    });
    return {
        deletedPointId: pointId,
        deletedPointExternalUid: point.external_uid,
        trip: mappedTrip
    };
}
export function getMovementSettings(userIds) {
    const effectiveUserId = userIds?.[0] ?? getDefaultUser().id;
    const row = ensureMovementSettings(effectiveUserId);
    const settings = mapMovementSettings(row) ?? defaultMovementSettings(effectiveUserId);
    return {
        ...settings,
        knownPlaceCount: listMovementPlaceRows([effectiveUserId]).length
    };
}
export function updateMovementSettings(userId, patch, context) {
    const existing = mapMovementSettings(ensureMovementSettings(userId)) ?? defaultMovementSettings(userId);
    const parsed = movementSettingsPatchSchema.parse(patch);
    const settings = upsertMovementSettings(userId, {
        trackingEnabled: parsed.trackingEnabled ?? existing.trackingEnabled,
        publishMode: parsed.publishMode ?? existing.publishMode,
        retentionMode: parsed.retentionMode ?? existing.retentionMode,
        locationPermissionStatus: parsed.locationPermissionStatus ?? existing.locationPermissionStatus,
        motionPermissionStatus: parsed.motionPermissionStatus ?? existing.motionPermissionStatus,
        backgroundTrackingReady: parsed.backgroundTrackingReady ?? existing.backgroundTrackingReady,
        metadata: {
            ...existing.metadata,
            ...(parsed.metadata ?? {})
        }
    });
    recordActivityEvent({
        entityType: "system",
        entityId: userId,
        eventType: "movement_settings_updated",
        title: "Movement settings updated",
        description: "Movement tracking behavior changed for the current Forge user.",
        actor: context.actor ?? null,
        source: context.source,
        metadata: settings ?? undefined
    });
    return settings;
}
function overlapSeconds(leftStart, leftEnd, rightStart, rightEnd) {
    const start = Math.max(Date.parse(leftStart), Date.parse(rightStart));
    const end = Math.min(Date.parse(leftEnd), Date.parse(rightEnd));
    return Math.max(0, Math.round((end - start) / 1000));
}
function computeSelectionAggregate(input) {
    const relevantTaskRuns = listTaskRuns({ userIds: input.userIds }).filter((run) => overlapSeconds(input.startedAt, input.endedAt, run.claimedAt, run.completedAt ?? run.updatedAt) > 0);
    const publishedNotes = [
        ...input.stays.map((stay) => stay.note).filter(Boolean),
        ...input.trips.map((trip) => trip.note).filter(Boolean)
    ];
    const selectionDuration = durationSeconds(input.startedAt, input.endedAt);
    const tripDistances = input.trips.reduce((sum, trip) => sum + trip.distanceMeters, 0);
    const calories = input.trips.reduce((sum, trip) => sum + (trip.caloriesKcal ?? 0), 0);
    const averageSpeedMps = average(input.trips
        .map((trip) => trip.averageSpeedMps)
        .filter((value) => typeof value === "number"));
    const placeLabels = uniqStrings(input.stays
        .map((stay) => stay.place?.label ?? stay.label)
        .filter(Boolean)
        .concat(input.trips.flatMap((trip) => [
        trip.startPlace?.label ?? "",
        trip.endPlace?.label ?? ""
    ])));
    const tags = uniqStrings(input.trips.flatMap((trip) => trip.tags).concat(input.stays.flatMap((stay) => Array.isArray(stay.metrics.tags)
        ? (stay.metrics.tags ?? [])
        : [])));
    return {
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        durationSeconds: selectionDuration,
        distanceMeters: round(tripDistances),
        caloriesKcal: round(calories),
        averageSpeedMps: round(averageSpeedMps, 2),
        stayCount: input.stays.length,
        tripCount: input.trips.length,
        noteCount: publishedNotes.length,
        taskRunCount: relevantTaskRuns.length,
        trackedWorkSeconds: relevantTaskRuns.reduce((sum, run) => {
            const end = run.completedAt ?? run.updatedAt;
            return sum + overlapSeconds(input.startedAt, input.endedAt, run.claimedAt, end);
        }, 0),
        placeLabels,
        tags
    };
}
export function getMovementDayDetail(input) {
    const targetDate = input.date ?? dayKey(nowIso());
    const placeRows = listMovementPlaceRows(input.userIds);
    const places = placeRows.map(mapMovementPlace);
    const placesById = new Map(places.map((place) => [place.id, place]));
    const stays = listMovementStayRows(input.userIds, targetDate).map((row) => mapMovementStay(row, placesById));
    const tripRows = listMovementTripRows(input.userIds, { dateKey: targetDate });
    const tripIds = tripRows.map((row) => row.id);
    const pointsByTrip = new Map();
    const stopsByTrip = new Map();
    listTripPoints(tripIds).forEach((point) => {
        pointsByTrip.set(point.trip_id, [...(pointsByTrip.get(point.trip_id) ?? []), point]);
    });
    listTripStops(tripIds).forEach((stop) => {
        stopsByTrip.set(stop.trip_id, [...(stopsByTrip.get(stop.trip_id) ?? []), stop]);
    });
    const trips = tripRows.map((row) => mapMovementTrip(row, placesById, pointsByTrip.get(row.id) ?? [], stopsByTrip.get(row.id) ?? []));
    const allSegments = [
        ...stays.map((stay) => ({
            id: stay.id,
            kind: "stay",
            startedAt: stay.startedAt,
            endedAt: stay.endedAt,
            durationSeconds: stay.durationSeconds,
            label: stay.place?.label ?? stay.label ?? "Stay",
            subtitle: stay.place?.categoryTags.join(" · ") ||
                (stay.classification === "stationary" ? "Stationary" : stay.classification),
            distanceMeters: 0,
            averageSpeedMps: 0,
            colorTone: stay.place?.categoryTags.includes("home")
                ? "from-sky-400/30 to-indigo-500/12"
                : "from-white/16 to-white/4",
            noteCount: stay.note ? 1 : 0
        })),
        ...trips.map((trip) => ({
            id: trip.id,
            kind: "trip",
            startedAt: trip.startedAt,
            endedAt: trip.endedAt,
            durationSeconds: trip.durationSeconds,
            label: trip.label ||
                `${trip.startPlace?.label ?? "Unknown"} → ${trip.endPlace?.label ?? "Unknown"}`,
            subtitle: `${round(trip.distanceMeters / 1000, 1)} km · ${trip.activityType || trip.travelMode}`,
            distanceMeters: trip.distanceMeters,
            averageSpeedMps: trip.averageSpeedMps ?? 0,
            colorTone: "from-emerald-300/26 to-cyan-400/12",
            noteCount: trip.note ? 1 : 0
        }))
    ].sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
    const dayStart = `${targetDate}T00:00:00.000Z`;
    const dayEnd = `${targetDate}T23:59:59.999Z`;
    const selectionAggregate = computeSelectionAggregate({
        startedAt: dayStart,
        endedAt: dayEnd,
        stays,
        trips,
        userIds: input.userIds
    });
    return {
        date: targetDate,
        settings: getMovementSettings(input.userIds),
        summary: {
            totalDistanceMeters: round(trips.reduce((sum, trip) => sum + trip.distanceMeters, 0)),
            totalMovingSeconds: trips.reduce((sum, trip) => sum + trip.movingSeconds, 0),
            totalIdleSeconds: stays.reduce((sum, stay) => sum + stay.durationSeconds, 0) +
                trips.reduce((sum, trip) => sum + trip.idleSeconds, 0),
            tripCount: trips.length,
            stayCount: stays.length,
            knownPlaceCount: places.length,
            caloriesKcal: round(trips.reduce((sum, trip) => sum + (trip.caloriesKcal ?? 0), 0)),
            averageSpeedMps: round(average(trips
                .map((trip) => trip.averageSpeedMps)
                .filter((value) => typeof value === "number")), 2)
        },
        segments: allSegments,
        stays,
        trips,
        places,
        selectionAggregate
    };
}
export function getMovementMonthSummary(input) {
    const targetMonth = input.month ?? monthKey(nowIso());
    const stays = listMovementStayRows(input.userIds).filter((row) => monthKey(row.started_at) === targetMonth);
    const trips = listMovementTripRows(input.userIds, { month: targetMonth });
    const byDay = new Map();
    for (const stay of stays) {
        const key = dayKey(stay.started_at);
        const current = byDay.get(key) ?? {
            distanceMeters: 0,
            movingSeconds: 0,
            idleSeconds: 0,
            caloriesKcal: 0,
            tripCount: 0,
            stayCount: 0,
            expectedMet: []
        };
        current.idleSeconds += durationSeconds(stay.started_at, stay.ended_at);
        current.stayCount += 1;
        byDay.set(key, current);
    }
    for (const trip of trips) {
        const key = dayKey(trip.started_at);
        const current = byDay.get(key) ?? {
            distanceMeters: 0,
            movingSeconds: 0,
            idleSeconds: 0,
            caloriesKcal: 0,
            tripCount: 0,
            stayCount: 0,
            expectedMet: []
        };
        current.distanceMeters += trip.distance_meters;
        current.movingSeconds += trip.moving_seconds;
        current.idleSeconds += trip.idle_seconds;
        current.caloriesKcal += trip.calories_kcal ?? 0;
        current.tripCount += 1;
        if (typeof trip.expected_met === "number") {
            current.expectedMet.push(trip.expected_met);
        }
        byDay.set(key, current);
    }
    return {
        month: targetMonth,
        days: [...byDay.entries()]
            .sort((left, right) => left[0].localeCompare(right[0]))
            .map(([dateKey, summary]) => ({
            dateKey,
            distanceMeters: round(summary.distanceMeters),
            movingSeconds: summary.movingSeconds,
            idleSeconds: summary.idleSeconds,
            caloriesKcal: round(summary.caloriesKcal),
            tripCount: summary.tripCount,
            stayCount: summary.stayCount,
            averageExpectedMet: round(average(summary.expectedMet), 2)
        })),
        totals: {
            distanceMeters: round(trips.reduce((sum, trip) => sum + trip.distance_meters, 0)),
            movingSeconds: trips.reduce((sum, trip) => sum + trip.moving_seconds, 0),
            idleSeconds: stays.reduce((sum, stay) => sum + durationSeconds(stay.started_at, stay.ended_at), 0) +
                trips.reduce((sum, trip) => sum + trip.idle_seconds, 0),
            tripCount: trips.length,
            stayCount: stays.length
        }
    };
}
export function getMovementAllTimeSummary(userIds) {
    const placeRows = listMovementPlaceRows(userIds);
    const stays = listMovementStayRows(userIds);
    const trips = listMovementTripRows(userIds);
    const tagBreakdown = new Map();
    placeRows.forEach((place) => {
        safeJsonParse(place.category_tags_json, []).forEach((tag) => {
            tagBreakdown.set(tag, (tagBreakdown.get(tag) ?? 0) + 1);
        });
    });
    return {
        summary: {
            knownPlaceCount: placeRows.length,
            stayCount: stays.length,
            tripCount: trips.length,
            totalDistanceMeters: round(trips.reduce((sum, trip) => sum + trip.distance_meters, 0)),
            totalMovingSeconds: trips.reduce((sum, trip) => sum + trip.moving_seconds, 0),
            totalIdleSeconds: stays.reduce((sum, stay) => sum + durationSeconds(stay.started_at, stay.ended_at), 0) +
                trips.reduce((sum, trip) => sum + trip.idle_seconds, 0),
            visitedCountries: new Set(placeRows
                .map((place) => safeJsonParse(place.metadata_json, {}))
                .map((metadata) => typeof metadata.countryCode === "string" ? metadata.countryCode : null)
                .filter((value) => Boolean(value))).size
        },
        categoryBreakdown: [...tagBreakdown.entries()]
            .map(([tag, count]) => ({ tag, count }))
            .sort((left, right) => right.count - left.count),
        recentTrips: trips
            .slice(0, 12)
            .map((trip) => ({
            id: trip.id,
            label: trip.label,
            startedAt: trip.started_at,
            distanceMeters: trip.distance_meters,
            activityType: trip.activity_type
        }))
    };
}
function buildStylizedCurve(points) {
    if (points.length <= 1) {
        return [];
    }
    const minLat = Math.min(...points.map((point) => point.latitude));
    const maxLat = Math.max(...points.map((point) => point.latitude));
    const minLng = Math.min(...points.map((point) => point.longitude));
    const maxLng = Math.max(...points.map((point) => point.longitude));
    const latRange = Math.max(0.0001, maxLat - minLat);
    const lngRange = Math.max(0.0001, maxLng - minLng);
    return points.map((point, index) => ({
        x: round((index / Math.max(1, points.length - 1)) * 100, 2),
        y: round(60 -
            (((point.latitude - minLat) / latRange) * 26 -
                ((point.longitude - minLng) / lngRange) * 8), 2)
    }));
}
export function getMovementTripDetail(tripId) {
    const tripRow = getDatabase()
        .prepare(`SELECT *
       FROM movement_trips
       WHERE id = ?`)
        .get(tripId);
    if (!tripRow) {
        return undefined;
    }
    const places = listMovementPlaceRows([tripRow.user_id]).map(mapMovementPlace);
    const placesById = new Map(places.map((place) => [place.id, place]));
    const points = listTripPoints([tripId]);
    const stops = listTripStops([tripId]);
    const trip = mapMovementTrip(tripRow, placesById, points, stops);
    const stylizedPath = buildStylizedCurve(trip.points.map((point) => ({
        latitude: point.latitude,
        longitude: point.longitude
    })));
    const selectionAggregate = computeSelectionAggregate({
        startedAt: trip.startedAt,
        endedAt: trip.endedAt,
        stays: [],
        trips: [trip],
        userIds: [trip.userId]
    });
    return {
        trip,
        stylizedPath: {
            curve: stylizedPath,
            startLabel: trip.startPlace?.label ?? "Start",
            endLabel: trip.endPlace?.label ?? "End",
            stops: trip.stops.map((stop, index) => ({
                id: stop.id,
                label: stop.label || stop.place?.label || `Stop ${index + 1}`,
                durationSeconds: stop.durationSeconds
            }))
        },
        selectionAggregate
    };
}
export function getMovementSelectionAggregate(input) {
    const parsed = movementSelectionAggregateSchema.parse(input);
    const placeRows = listMovementPlaceRows(parsed.userIds);
    const placesById = new Map(placeRows.map((row) => {
        const mapped = mapMovementPlace(row);
        return [mapped.id, mapped];
    }));
    const stayRows = parsed.stayIds.length > 0
        ? getDatabase()
            .prepare(`SELECT *
             FROM movement_stays
             WHERE id IN (${parsed.stayIds.map(() => "?").join(",")})`)
            .all(...parsed.stayIds)
        : [];
    const tripRows = parsed.tripIds.length > 0
        ? getDatabase()
            .prepare(`SELECT *
             FROM movement_trips
             WHERE id IN (${parsed.tripIds.map(() => "?").join(",")})`)
            .all(...parsed.tripIds)
        : [];
    const tripIds = tripRows.map((row) => row.id);
    const pointsByTrip = new Map();
    listTripPoints(tripIds).forEach((point) => {
        pointsByTrip.set(point.trip_id, [...(pointsByTrip.get(point.trip_id) ?? []), point]);
    });
    const stopsByTrip = new Map();
    listTripStops(tripIds).forEach((stop) => {
        stopsByTrip.set(stop.trip_id, [...(stopsByTrip.get(stop.trip_id) ?? []), stop]);
    });
    const stays = stayRows.map((row) => mapMovementStay(row, placesById));
    const trips = tripRows.map((row) => mapMovementTrip(row, placesById, pointsByTrip.get(row.id) ?? [], stopsByTrip.get(row.id) ?? []));
    const startedAt = parsed.startedAt ??
        [...stays.map((stay) => stay.startedAt), ...trips.map((trip) => trip.startedAt)]
            .sort()[0] ??
        nowIso();
    const endedAt = parsed.endedAt ??
        [...stays.map((stay) => stay.endedAt), ...trips.map((trip) => trip.endedAt)]
            .sort()
            .slice(-1)[0] ??
        nowIso();
    return computeSelectionAggregate({
        startedAt,
        endedAt,
        stays,
        trips,
        userIds: parsed.userIds
    });
}
export function getMovementMobileBootstrap(pairing) {
    const canonicalTripExternalUids = new Set();
    const canonicalStayExternalUids = new Set();
    getDatabase()
        .prepare(`SELECT DISTINCT trip_external_uid
         FROM movement_trip_point_tombstones
         WHERE user_id = ?
         UNION
         SELECT DISTINCT trip_external_uid
         FROM movement_trip_point_overrides
         WHERE user_id = ?`)
        .all(pairing.user_id, pairing.user_id).forEach((row) => {
        if (row.trip_external_uid.trim().length > 0) {
            canonicalTripExternalUids.add(row.trip_external_uid);
        }
    });
    getDatabase()
        .prepare(`SELECT DISTINCT stay_external_uid
         FROM movement_stay_tombstones
         WHERE user_id = ?
         UNION
         SELECT DISTINCT stay_external_uid
         FROM movement_stay_overrides
         WHERE user_id = ?`)
        .all(pairing.user_id, pairing.user_id).forEach((row) => {
        if (row.stay_external_uid.trim().length > 0) {
            canonicalStayExternalUids.add(row.stay_external_uid);
        }
    });
    const tripRows = canonicalTripExternalUids.size > 0
        ? getDatabase()
            .prepare(`SELECT *
             FROM movement_trips
             WHERE user_id = ?
               AND external_uid IN (${[...canonicalTripExternalUids]
            .map(() => "?")
            .join(",")})`)
            .all(pairing.user_id, ...canonicalTripExternalUids)
        : [];
    const stayRows = canonicalStayExternalUids.size > 0
        ? getDatabase()
            .prepare(`SELECT *
             FROM movement_stays
             WHERE user_id = ?
               AND external_uid IN (${[...canonicalStayExternalUids]
            .map(() => "?")
            .join(",")})`)
            .all(pairing.user_id, ...canonicalStayExternalUids)
        : [];
    const placeRows = listMovementPlaceRows([pairing.user_id]);
    const places = placeRows.map(mapMovementPlace);
    const placesById = new Map(places.map((place) => [place.id, place]));
    const pointsByTrip = new Map();
    listTripPoints(tripRows.map((row) => row.id)).forEach((point) => {
        pointsByTrip.set(point.trip_id, [...(pointsByTrip.get(point.trip_id) ?? []), point]);
    });
    const stopsByTrip = new Map();
    listTripStops(tripRows.map((row) => row.id)).forEach((stop) => {
        stopsByTrip.set(stop.trip_id, [...(stopsByTrip.get(stop.trip_id) ?? []), stop]);
    });
    return {
        settings: getMovementSettings([pairing.user_id]),
        places,
        stayOverrides: stayRows.map((stay) => mapMovementStay(stay, placesById)),
        tripOverrides: tripRows.map((trip) => mapMovementTrip(trip, placesById, pointsByTrip.get(trip.id) ?? [], stopsByTrip.get(trip.id) ?? [])),
        deletedStayExternalUids: listMovementStayTombstones(pairing.user_id).map((row) => row.stay_external_uid),
        deletedTripExternalUids: listMovementTripTombstones(pairing.user_id).map((row) => row.trip_external_uid)
    };
}
