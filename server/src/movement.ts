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
  "forest",
  "mountain",
  "nature",
  "holiday",
  "social",
  "travel",
  "other"
] as const;

export const movementCategoryTagSchema = z.enum(movementCategoryTags);

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
  categoryTags: z.array(movementCategoryTagSchema).default([]),
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
export const movementMobileBootstrapSchema = z.object({
  sessionId: z.string().trim().min(1),
  pairingToken: z.string().trim().min(1)
});

type ActivitySource = "ui" | "openclaw" | "agent" | "system";
type ActivityContext = {
  actor?: string | null;
  source: ActivitySource;
};

type PairingSessionLike = {
  id: string;
  user_id: string;
};

type MovementPlaceRow = {
  id: string;
  external_uid: string;
  user_id: string;
  label: string;
  aliases_json: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  category_tags_json: string;
  visibility: string;
  wiki_note_id: string | null;
  linked_entities_json: string;
  linked_people_json: string;
  metadata_json: string;
  source: string;
  created_at: string;
  updated_at: string;
};

type MovementStayRow = {
  id: string;
  external_uid: string;
  pairing_session_id: string | null;
  user_id: string;
  place_id: string | null;
  label: string;
  status: string;
  classification: string;
  started_at: string;
  ended_at: string;
  center_latitude: number;
  center_longitude: number;
  radius_meters: number;
  sample_count: number;
  weather_json: string;
  metrics_json: string;
  metadata_json: string;
  published_note_id: string | null;
  created_at: string;
  updated_at: string;
};

type MovementTripRow = {
  id: string;
  external_uid: string;
  pairing_session_id: string | null;
  user_id: string;
  start_place_id: string | null;
  end_place_id: string | null;
  label: string;
  status: string;
  travel_mode: string;
  activity_type: string;
  started_at: string;
  ended_at: string;
  distance_meters: number;
  moving_seconds: number;
  idle_seconds: number;
  average_speed_mps: number | null;
  max_speed_mps: number | null;
  calories_kcal: number | null;
  expected_met: number | null;
  weather_json: string;
  tags_json: string;
  linked_entities_json: string;
  linked_people_json: string;
  metadata_json: string;
  published_note_id: string | null;
  created_at: string;
  updated_at: string;
};

type MovementTripPointRow = {
  id: string;
  trip_id: string;
  sequence_index: number;
  recorded_at: string;
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  altitude_meters: number | null;
  speed_mps: number | null;
  is_stop_anchor: number;
  created_at: string;
};

type MovementTripStopRow = {
  id: string;
  external_uid: string;
  trip_id: string;
  sequence_index: number;
  label: string;
  place_id: string | null;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  latitude: number;
  longitude: number;
  radius_meters: number;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type MovementSettingsRow = {
  user_id: string;
  tracking_enabled: number;
  publish_mode: z.infer<typeof movementPublishModeSchema>;
  retention_mode: z.infer<typeof movementRetentionModeSchema>;
  location_permission_status: string;
  motion_permission_status: string;
  background_tracking_ready: number;
  last_companion_sync_at: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function uniqStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function round(value: number, digits = 0) {
  return Number(value.toFixed(digits));
}

function average(values: number[]) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function durationSeconds(startedAt: string, endedAt: string) {
  return Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
}

function dayKey(value: string) {
  return value.slice(0, 10);
}

function monthKey(value: string) {
  return value.slice(0, 7);
}

function haversineDistanceMeters(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number }
) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const deltaLatitude = toRadians(right.latitude - left.latitude);
  const deltaLongitude = toRadians(right.longitude - left.longitude);
  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos(toRadians(left.latitude)) *
      Math.cos(toRadians(right.latitude)) *
      Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function estimateMovementXp(categoryTags: string[], distanceMeters: number) {
  const tags = new Set(categoryTags);
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

function inferExpectedMet(activityType: string, averageSpeedMps: number | null) {
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

function defaultMovementSettings(userId: string) {
  const now = nowIso();
  return {
    userId,
    trackingEnabled: false,
    publishMode: "auto_publish" as const,
    retentionMode: "aggregates_only" as const,
    locationPermissionStatus: "not_determined",
    motionPermissionStatus: "unknown",
    backgroundTrackingReady: false,
    lastCompanionSyncAt: null as string | null,
    metadata: {},
    createdAt: now,
    updatedAt: now
  };
}

function mapMovementSettings(row?: MovementSettingsRow) {
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
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMovementPlace(row: MovementPlaceRow) {
  const linkedEntities = safeJsonParse<
    Array<z.infer<typeof linkedEntitySchema>>
  >(row.linked_entities_json, []);
  const linkedPeople = safeJsonParse<
    Array<z.infer<typeof linkedPersonSchema>>
  >(row.linked_people_json, []);
  const wikiNote = row.wiki_note_id ? getNoteById(row.wiki_note_id) : null;
  return {
    id: row.id,
    externalUid: row.external_uid,
    userId: row.user_id,
    label: row.label,
    aliases: safeJsonParse<string[]>(row.aliases_json, []),
    latitude: row.latitude,
    longitude: row.longitude,
    radiusMeters: row.radius_meters,
    categoryTags: safeJsonParse<string[]>(row.category_tags_json, []),
    visibility: row.visibility,
    wikiNoteId: row.wiki_note_id,
    linkedEntities,
    linkedPeople,
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    wikiNote:
      wikiNote && !Array.isArray(wikiNote)
        ? {
            id: wikiNote.id,
            title: wikiNote.title,
            slug: wikiNote.slug
          }
        : null
  };
}

function mapMovementStay(row: MovementStayRow, placesById: Map<string, ReturnType<typeof mapMovementPlace>>) {
  const note = row.published_note_id ? getNoteById(row.published_note_id) : null;
  const metrics = safeJsonParse<Record<string, unknown>>(row.metrics_json, {});
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
    weather: safeJsonParse<Record<string, unknown>>(row.weather_json, {}),
    metrics,
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
    publishedNoteId: row.published_note_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    place: row.place_id ? placesById.get(row.place_id) ?? null : null,
    note:
      note && !Array.isArray(note)
        ? {
            id: note.id,
            title: note.title,
            slug: note.slug
          }
        : null
  };
}

function mapMovementTrip(
  row: MovementTripRow,
  placesById: Map<string, ReturnType<typeof mapMovementPlace>>,
  points: MovementTripPointRow[] = [],
  stops: MovementTripStopRow[] = []
) {
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
    weather: safeJsonParse<Record<string, unknown>>(row.weather_json, {}),
    tags: safeJsonParse<string[]>(row.tags_json, []),
    linkedEntities: safeJsonParse<Array<z.infer<typeof linkedEntitySchema>>>(
      row.linked_entities_json,
      []
    ),
    linkedPeople: safeJsonParse<Array<z.infer<typeof linkedPersonSchema>>>(
      row.linked_people_json,
      []
    ),
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
    publishedNoteId: row.published_note_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startPlace: row.start_place_id ? placesById.get(row.start_place_id) ?? null : null,
    endPlace: row.end_place_id ? placesById.get(row.end_place_id) ?? null : null,
    points: points.map((point) => ({
      id: point.id,
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
      metadata: safeJsonParse<Record<string, unknown>>(stop.metadata_json, {}),
      place: stop.place_id ? placesById.get(stop.place_id) ?? null : null
    })),
    note:
      note && !Array.isArray(note)
        ? {
            id: note.id,
            title: note.title,
            slug: note.slug
          }
        : null
  };
}

function getMovementSettingsRow(userId: string) {
  return getDatabase()
    .prepare(
      `SELECT *
       FROM movement_settings
       WHERE user_id = ?`
    )
    .get(userId) as MovementSettingsRow | undefined;
}

function ensureMovementSettings(userId: string) {
  const existing = getMovementSettingsRow(userId);
  if (existing) {
    return existing;
  }
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO movement_settings (
         user_id, tracking_enabled, publish_mode, retention_mode,
         location_permission_status, motion_permission_status,
         background_tracking_ready, last_companion_sync_at, metadata_json,
         created_at, updated_at
       )
       VALUES (?, 0, 'auto_publish', 'aggregates_only', 'not_determined', 'unknown', 0, NULL, '{}', ?, ?)`
    )
    .run(userId, now, now);
  return getMovementSettingsRow(userId)!;
}

function listMovementPlaceRows(userIds?: string[]) {
  const params: string[] = [];
  const where =
    userIds && userIds.length > 0
      ? `WHERE user_id IN (${userIds.map(() => "?").join(",")})`
      : "";
  if (userIds) {
    params.push(...userIds);
  }
  return getDatabase()
    .prepare(
      `SELECT *
       FROM movement_places
       ${where}
       ORDER BY label COLLATE NOCASE ASC`
    )
    .all(...params) as MovementPlaceRow[];
}

function listMovementStayRows(userIds?: string[], dateKey?: string) {
  const params: string[] = [];
  const whereClauses: string[] = [];
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
    .prepare(
      `SELECT *
       FROM movement_stays
       ${where}
       ORDER BY started_at DESC`
    )
    .all(...params) as MovementStayRow[];
}

function listMovementTripRows(userIds?: string[], options: { dateKey?: string; month?: string } = {}) {
  const params: string[] = [];
  const whereClauses: string[] = [];
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
    .prepare(
      `SELECT *
       FROM movement_trips
       ${where}
       ORDER BY started_at DESC`
    )
    .all(...params) as MovementTripRow[];
}

function listTripPoints(tripIds: string[]) {
  if (tripIds.length === 0) {
    return [] as MovementTripPointRow[];
  }
  const placeholders = tripIds.map(() => "?").join(", ");
  return getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trip_points
       WHERE trip_id IN (${placeholders})
       ORDER BY trip_id ASC, sequence_index ASC`
    )
    .all(...tripIds) as MovementTripPointRow[];
}

function listTripStops(tripIds: string[]) {
  if (tripIds.length === 0) {
    return [] as MovementTripStopRow[];
  }
  const placeholders = tripIds.map(() => "?").join(", ");
  return getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trip_stops
       WHERE trip_id IN (${placeholders})
       ORDER BY trip_id ASC, sequence_index ASC`
    )
    .all(...tripIds) as MovementTripStopRow[];
}

function defaultSpaceId() {
  return listWikiSpaces()[0]?.id;
}

function syncPlaceWikiMetadata(placeId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT *
       FROM movement_places
       WHERE id = ?`
    )
    .get(placeId) as MovementPlaceRow | undefined;
  if (!row?.wiki_note_id) {
    return;
  }
  const note = getNoteById(row.wiki_note_id);
  if (!note || Array.isArray(note)) {
    return;
  }
  updateNote(
    row.wiki_note_id,
    {
      frontmatter: {
        ...note.frontmatter,
        location: {
          latitude: row.latitude,
          longitude: row.longitude,
          radiusMeters: row.radius_meters
        },
        locationTags: safeJsonParse<string[]>(row.category_tags_json, [])
      }
    },
    { actor: "Movement sync", source: "system" }
  );
}

function resolvePlaceForCoordinates(
  userId: string,
  point: { latitude: number; longitude: number },
  preferredExternalUid = ""
) {
  const rows = listMovementPlaceRows([userId]);
  if (preferredExternalUid.trim().length > 0) {
    const direct = rows.find(
      (row) =>
        row.external_uid.trim().length > 0 &&
        row.external_uid === preferredExternalUid
    );
    if (direct) {
      return direct;
    }
  }
  let best: { row: MovementPlaceRow; distance: number } | null = null;
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

function createMovementNote(input: {
  userId: string;
  title: string;
  contentMarkdown: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
}) {
  const spaceId = defaultSpaceId();
  if (!spaceId) {
    return null;
  }
  return createNote(
    {
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
    },
    { actor: "Movement sync", source: "system" }
  );
}

function maybeCreateStayNote(
  settings: ReturnType<typeof mapMovementSettings>,
  stay: MovementStayRow,
  place: MovementPlaceRow | undefined
) {
  if (!settings || settings.publishMode === "no_publish") {
    return null;
  }
  const label = place?.label || stay.label || "Unlabeled stay";
  const durationMinutes = Math.round(durationSeconds(stay.started_at, stay.ended_at) / 60);
  const content = [
    `Stayed at **${label}** for ${durationMinutes} minutes.`,
    "",
    `- Started: ${stay.started_at}`,
    `- Ended: ${stay.ended_at}`,
    `- Radius: ${Math.round(stay.radius_meters)} m`
  ].join("\n");
  return createMovementNote({
    userId: stay.user_id,
    title: `Stay · ${label}`,
    contentMarkdown: content,
    tags: uniqStrings([
      "movement",
      "stay",
      ...(place ? safeJsonParse<string[]>(place.category_tags_json, []) : [])
    ]),
    frontmatter: {
      observedAt: stay.started_at,
      movement: {
        kind: "stay",
        stayId: stay.id,
        publishMode: settings.publishMode,
        placeId: place?.id ?? null
      }
    }
  });
}

function maybeCreateTripNote(
  settings: ReturnType<typeof mapMovementSettings>,
  trip: MovementTripRow,
  startPlace: MovementPlaceRow | undefined,
  endPlace: MovementPlaceRow | undefined
) {
  if (!settings || settings.publishMode === "no_publish") {
    return null;
  }
  const startLabel = startPlace?.label || "Unknown start";
  const endLabel = endPlace?.label || "Unknown end";
  const distanceKm = round(trip.distance_meters / 1000, 2);
  const content = [
    `Travelled from **${startLabel}** to **${endLabel}**.`,
    "",
    `- Started: ${trip.started_at}`,
    `- Ended: ${trip.ended_at}`,
    `- Distance: ${distanceKm} km`,
    `- Activity: ${trip.activity_type || trip.travel_mode}`
  ].join("\n");
  return createMovementNote({
    userId: trip.user_id,
    title: `Trip · ${startLabel} → ${endLabel}`,
    contentMarkdown: content,
    tags: uniqStrings([
      "movement",
      "trip",
      ...safeJsonParse<string[]>(trip.tags_json, [])
    ]),
    frontmatter: {
      observedAt: trip.started_at,
      movement: {
        kind: "trip",
        tripId: trip.id,
        publishMode: settings.publishMode,
        startPlaceId: startPlace?.id ?? null,
        endPlaceId: endPlace?.id ?? null
      }
    }
  });
}

function awardMovementXp(input: {
  userId: string;
  entityId: string;
  categoryTags: string[];
  distanceMeters: number;
  title: string;
}) {
  const deltaXp = estimateMovementXp(input.categoryTags, input.distanceMeters);
  if (deltaXp <= 0) {
    return null;
  }
  return createManualRewardGrant(
    {
      entityType: "system",
      entityId: input.entityId,
      deltaXp,
      reasonTitle: input.title,
      reasonSummary: `Movement activity reward for ${input.categoryTags.join(", ") || "general mobility"}.`,
      metadata: {}
    },
    { actor: "Movement sync", source: "system" }
  );
}

function upsertMovementSettings(
  userId: string,
  input: z.infer<typeof movementSettingsInputSchema>
) {
  const parsed = movementSettingsInputSchema.parse(input);
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO movement_settings (
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
         updated_at = excluded.updated_at`
    )
    .run(
      userId,
      parsed.trackingEnabled ? 1 : 0,
      parsed.publishMode,
      parsed.retentionMode,
      parsed.locationPermissionStatus,
      parsed.motionPermissionStatus,
      parsed.backgroundTrackingReady ? 1 : 0,
      now,
      JSON.stringify(parsed.metadata),
      now,
      now
    );
  return mapMovementSettings(getMovementSettingsRow(userId));
}

function upsertMovementPlaceInternal(input: {
  userId: string;
  source: string;
  id?: string | null;
  place: z.infer<typeof movementPlaceInputSchema>;
}) {
  const parsed = movementPlaceInputSchema.parse(input.place);
  const now = nowIso();
  const existing =
    input.id && input.id.trim().length > 0
      ? (getDatabase()
          .prepare(
            `SELECT *
             FROM movement_places
             WHERE id = ?`
          )
          .get(input.id) as MovementPlaceRow | undefined)
      : parsed.externalUid.trim().length > 0
        ? (getDatabase()
            .prepare(
              `SELECT *
               FROM movement_places
               WHERE user_id = ?
                 AND source = ?
                 AND external_uid = ?`
            )
            .get(input.userId, input.source, parsed.externalUid) as
            | MovementPlaceRow
            | undefined)
        : undefined;
  const id = existing?.id ?? input.id ?? `mpl_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  getDatabase()
    .prepare(
      `INSERT INTO movement_places (
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
         updated_at = excluded.updated_at`
    )
    .run(
      id,
      parsed.externalUid,
      input.userId,
      parsed.label,
      JSON.stringify(uniqStrings(parsed.aliases)),
      parsed.latitude,
      parsed.longitude,
      parsed.radiusMeters,
      JSON.stringify(uniqStrings(parsed.categoryTags)),
      parsed.visibility,
      parsed.wikiNoteId,
      JSON.stringify(parsed.linkedEntities),
      JSON.stringify(parsed.linkedPeople),
      JSON.stringify(parsed.metadata),
      input.source,
      existing?.created_at ?? now,
      now
    );
  syncPlaceWikiMetadata(id);
  return mapMovementPlace(
    getDatabase()
      .prepare(`SELECT * FROM movement_places WHERE id = ?`)
      .get(id) as MovementPlaceRow
  );
}

function replaceTripChildren(
  tripId: string,
  points: z.infer<typeof movementTripPointInputSchema>[],
  stops: z.infer<typeof movementTripStopInputSchema>[],
  userId: string
) {
  getDatabase()
    .prepare(`DELETE FROM movement_trip_points WHERE trip_id = ?`)
    .run(tripId);
  getDatabase()
    .prepare(`DELETE FROM movement_trip_stops WHERE trip_id = ?`)
    .run(tripId);

  const pointInsert = getDatabase().prepare(
    `INSERT INTO movement_trip_points (
       id, trip_id, sequence_index, recorded_at, latitude, longitude,
       accuracy_meters, altitude_meters, speed_mps, is_stop_anchor, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const stopInsert = getDatabase().prepare(
    `INSERT INTO movement_trip_stops (
       id, external_uid, trip_id, sequence_index, label, place_id,
       started_at, ended_at, duration_seconds, latitude, longitude,
       radius_meters, metadata_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const now = nowIso();

  points.forEach((point, index) => {
    pointInsert.run(
      `mtp_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      tripId,
      index,
      point.recordedAt,
      point.latitude,
      point.longitude,
      point.accuracyMeters,
      point.altitudeMeters,
      point.speedMps,
      point.isStopAnchor ? 1 : 0,
      now
    );
  });

  stops.forEach((stop, index) => {
    const matchedPlace = resolvePlaceForCoordinates(
      userId,
      { latitude: stop.latitude, longitude: stop.longitude },
      stop.placeExternalUid
    );
    stopInsert.run(
      `mts_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      stop.externalUid,
      tripId,
      index,
      stop.label,
      matchedPlace?.id ?? null,
      stop.startedAt,
      stop.endedAt,
      durationSeconds(stop.startedAt, stop.endedAt),
      stop.latitude,
      stop.longitude,
      stop.radiusMeters,
      JSON.stringify(stop.metadata),
      now,
      now
    );
  });
}

function cleanupRawTripPoints(userId: string) {
  const staleTripRows = getDatabase()
    .prepare(
      `SELECT id
       FROM movement_trips
       WHERE user_id = ?
         AND ended_at <= datetime('now', '-30 day')`
    )
    .all(userId) as Array<{ id: string }>;
  for (const row of staleTripRows) {
    getDatabase()
      .prepare(
        `DELETE FROM movement_trip_points
         WHERE trip_id = ?
           AND is_stop_anchor = 0
           AND sequence_index NOT IN (
             SELECT MIN(sequence_index) FROM movement_trip_points WHERE trip_id = ?
             UNION
             SELECT MAX(sequence_index) FROM movement_trip_points WHERE trip_id = ?
           )`
      )
      .run(row.id, row.id, row.id);
  }
}

function upsertMovementStay(
  pairing: PairingSessionLike,
  settings: ReturnType<typeof mapMovementSettings>,
  input: z.infer<typeof movementStayInputSchema>
) {
  const parsed = movementStayInputSchema.parse(input);
  const existing = getDatabase()
    .prepare(
      `SELECT *
       FROM movement_stays
       WHERE user_id = ?
         AND external_uid = ?`
    )
    .get(pairing.user_id, parsed.externalUid) as MovementStayRow | undefined;
  const now = nowIso();
  const matchedPlace = resolvePlaceForCoordinates(
    pairing.user_id,
    {
      latitude: parsed.centerLatitude,
      longitude: parsed.centerLongitude
    },
    parsed.placeExternalUid
  );
  const metrics = {
    tags: uniqStrings(parsed.tags),
    durationSeconds: durationSeconds(parsed.startedAt, parsed.endedAt)
  };
  const id = existing?.id ?? `mst_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  getDatabase()
    .prepare(
      `INSERT INTO movement_stays (
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
         updated_at = excluded.updated_at`
    )
    .run(
      id,
      parsed.externalUid,
      pairing.id,
      pairing.user_id,
      matchedPlace?.id ?? null,
      parsed.label || parsed.placeLabel,
      parsed.status,
      parsed.classification,
      parsed.startedAt,
      parsed.endedAt,
      parsed.centerLatitude,
      parsed.centerLongitude,
      parsed.radiusMeters,
      parsed.sampleCount,
      JSON.stringify({}),
      JSON.stringify(metrics),
      JSON.stringify(parsed.metadata),
      existing?.published_note_id ?? null,
      existing?.created_at ?? now,
      now
    );
  const fresh = getDatabase()
    .prepare(`SELECT * FROM movement_stays WHERE user_id = ? AND external_uid = ?`)
    .get(pairing.user_id, parsed.externalUid) as MovementStayRow;
  if (!existing && settings?.publishMode === "auto_publish") {
    const note = maybeCreateStayNote(settings, fresh, matchedPlace);
    if (note) {
      getDatabase()
        .prepare(
          `UPDATE movement_stays
           SET published_note_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(note.id, nowIso(), fresh.id);
    }
  }
  return {
    mode: existing ? "updated" as const : "created" as const,
    stayId: fresh.id
  };
}

function upsertMovementTrip(
  pairing: PairingSessionLike,
  settings: ReturnType<typeof mapMovementSettings>,
  input: z.infer<typeof movementTripInputSchema>
) {
  const parsed = movementTripInputSchema.parse(input);
  const existing = getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trips
       WHERE user_id = ?
         AND external_uid = ?`
    )
    .get(pairing.user_id, parsed.externalUid) as MovementTripRow | undefined;
  const now = nowIso();
  const firstPoint = parsed.points[0] ?? null;
  const lastPoint = parsed.points[parsed.points.length - 1] ?? null;
  const startPlace =
    resolvePlaceForCoordinates(
      pairing.user_id,
      firstPoint
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
            },
      parsed.startPlaceExternalUid
    ) ?? undefined;
  const endPlace =
    resolvePlaceForCoordinates(
      pairing.user_id,
      lastPoint
        ? {
            latitude: lastPoint.latitude,
            longitude: lastPoint.longitude
          }
        : parsed.stops[parsed.stops.length - 1]
          ? {
              latitude: parsed.stops[parsed.stops.length - 1]!.latitude,
              longitude: parsed.stops[parsed.stops.length - 1]!.longitude
            }
          : {
              latitude: 0,
              longitude: 0
            },
      parsed.endPlaceExternalUid
    ) ?? undefined;
  const effectiveExpectedMet =
    parsed.expectedMet ?? inferExpectedMet(parsed.activityType, parsed.averageSpeedMps);
  const id = existing?.id ?? `mtr_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  getDatabase()
    .prepare(
      `INSERT INTO movement_trips (
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
         updated_at = excluded.updated_at`
    )
    .run(
      id,
      parsed.externalUid,
      pairing.id,
      pairing.user_id,
      startPlace?.id ?? null,
      endPlace?.id ?? null,
      parsed.label,
      parsed.status,
      parsed.travelMode,
      parsed.activityType,
      parsed.startedAt,
      parsed.endedAt,
      parsed.distanceMeters,
      parsed.movingSeconds,
      parsed.idleSeconds,
      parsed.averageSpeedMps,
      parsed.maxSpeedMps,
      parsed.caloriesKcal,
      effectiveExpectedMet,
      JSON.stringify({}),
      JSON.stringify(uniqStrings(parsed.tags)),
      JSON.stringify(parsed.linkedEntities),
      JSON.stringify(parsed.linkedPeople),
      JSON.stringify(parsed.metadata),
      existing?.published_note_id ?? null,
      existing?.created_at ?? now,
      now
    );
  const fresh = getDatabase()
    .prepare(`SELECT * FROM movement_trips WHERE user_id = ? AND external_uid = ?`)
    .get(pairing.user_id, parsed.externalUid) as MovementTripRow;
  replaceTripChildren(fresh.id, parsed.points, parsed.stops, pairing.user_id);
  if (!existing && settings?.publishMode === "auto_publish") {
    const note = maybeCreateTripNote(settings, fresh, startPlace, endPlace);
    if (note) {
      getDatabase()
        .prepare(
          `UPDATE movement_trips
           SET published_note_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(note.id, nowIso(), fresh.id);
    }
    awardMovementXp({
      userId: pairing.user_id,
      entityId: fresh.id,
      categoryTags: uniqStrings([
        ...(startPlace
          ? safeJsonParse<string[]>(startPlace.category_tags_json, [])
          : []),
        ...(endPlace
          ? safeJsonParse<string[]>(endPlace.category_tags_json, [])
          : []),
        ...parsed.tags
      ]),
      distanceMeters: fresh.distance_meters,
      title: "Movement exploration"
    });
  }
  return {
    mode: existing ? "updated" as const : "created" as const,
    tripId: fresh.id
  };
}

export function ingestMovementSync(
  pairing: PairingSessionLike,
  payload: z.infer<typeof movementSyncPayloadSchema>
) {
  const parsed = movementSyncPayloadSchema.parse(payload);
  const settings = upsertMovementSettings(pairing.user_id, parsed.settings);
  let createdCount = 0;
  let updatedCount = 0;

  parsed.knownPlaces.forEach((place) => {
    const existing = place.externalUid
      ? (getDatabase()
          .prepare(
            `SELECT id
             FROM movement_places
             WHERE user_id = ?
               AND source = 'companion'
               AND external_uid = ?`
          )
          .get(pairing.user_id, place.externalUid) as { id: string } | undefined)
      : undefined;
    upsertMovementPlaceInternal({
      userId: pairing.user_id,
      source: "companion",
      id: existing?.id ?? null,
      place
    });
    if (existing) {
      updatedCount += 1;
    } else {
      createdCount += 1;
    }
  });

  parsed.stays.forEach((stay) => {
    const result = upsertMovementStay(pairing, settings, stay);
    if (result.mode === "created") {
      createdCount += 1;
    } else {
      updatedCount += 1;
    }
  });

  parsed.trips.forEach((trip) => {
    const result = upsertMovementTrip(pairing, settings, trip);
    if (result.mode === "created") {
      createdCount += 1;
    } else {
      updatedCount += 1;
    }
  });

  cleanupRawTripPoints(pairing.user_id);

  recordActivityEvent({
    entityType: "system",
    entityId: pairing.id,
    eventType: "movement_sync_completed",
    title: "Movement sync completed",
    description:
      "Forge Companion synchronized passive movement stays, trips, and known places.",
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

export function listMovementPlaces(userIds?: string[]) {
  return listMovementPlaceRows(userIds).map(mapMovementPlace);
}

export function createMovementPlace(
  input: z.input<typeof movementPlaceMutationSchema>,
  context: ActivityContext
) {
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

export function updateMovementPlace(
  placeId: string,
  patch: z.input<typeof movementPlacePatchSchema>,
  context: ActivityContext
) {
  const existing = getDatabase()
    .prepare(
      `SELECT *
       FROM movement_places
       WHERE id = ?`
    )
    .get(placeId) as MovementPlaceRow | undefined;
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
      aliases: parsed.aliases ?? safeJsonParse<string[]>(existing.aliases_json, []),
      latitude: parsed.latitude ?? existing.latitude,
      longitude: parsed.longitude ?? existing.longitude,
      radiusMeters: parsed.radiusMeters ?? existing.radius_meters,
      categoryTags:
        parsed.categoryTags ??
        safeJsonParse<Array<z.infer<typeof movementCategoryTagSchema>>>(
          existing.category_tags_json,
          []
        ),
      visibility: parsed.visibility ?? (existing.visibility as "personal" | "shared"),
      wikiNoteId:
        parsed.wikiNoteId === undefined ? existing.wiki_note_id : parsed.wikiNoteId,
      linkedEntities:
        parsed.linkedEntities ??
        safeJsonParse<Array<z.infer<typeof linkedEntitySchema>>>(
          existing.linked_entities_json,
          []
        ),
      linkedPeople:
        parsed.linkedPeople ??
        safeJsonParse<Array<z.infer<typeof linkedPersonSchema>>>(
          existing.linked_people_json,
          []
        ),
      metadata:
        parsed.metadata ??
        safeJsonParse<Record<string, unknown>>(existing.metadata_json, {})
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

export function getMovementSettings(userIds?: string[]) {
  const effectiveUserId = userIds?.[0] ?? getDefaultUser().id;
  const row = ensureMovementSettings(effectiveUserId);
  const settings = mapMovementSettings(row) ?? defaultMovementSettings(effectiveUserId);
  return {
    ...settings,
    knownPlaceCount: listMovementPlaceRows([effectiveUserId]).length
  };
}

export function updateMovementSettings(
  userId: string,
  patch: z.input<typeof movementSettingsPatchSchema>,
  context: ActivityContext
) {
  const existing = mapMovementSettings(ensureMovementSettings(userId)) ?? defaultMovementSettings(userId);
  const parsed = movementSettingsPatchSchema.parse(patch);
  const settings = upsertMovementSettings(userId, {
    trackingEnabled: parsed.trackingEnabled ?? existing.trackingEnabled,
    publishMode: parsed.publishMode ?? existing.publishMode,
    retentionMode: parsed.retentionMode ?? existing.retentionMode,
    locationPermissionStatus:
      parsed.locationPermissionStatus ?? existing.locationPermissionStatus,
    motionPermissionStatus:
      parsed.motionPermissionStatus ?? existing.motionPermissionStatus,
    backgroundTrackingReady:
      parsed.backgroundTrackingReady ?? existing.backgroundTrackingReady,
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
    description:
      "Movement tracking behavior changed for the current Forge user.",
    actor: context.actor ?? null,
    source: context.source,
    metadata: settings ?? undefined
  });
  return settings;
}

function overlapSeconds(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string
) {
  const start = Math.max(Date.parse(leftStart), Date.parse(rightStart));
  const end = Math.min(Date.parse(leftEnd), Date.parse(rightEnd));
  return Math.max(0, Math.round((end - start) / 1000));
}

function computeSelectionAggregate(input: {
  startedAt: string;
  endedAt: string;
  stays: ReturnType<typeof mapMovementStay>[];
  trips: ReturnType<typeof mapMovementTrip>[];
  userIds?: string[];
}) {
  const relevantTaskRuns = listTaskRuns({ userIds: input.userIds }).filter((run) =>
    overlapSeconds(
      input.startedAt,
      input.endedAt,
      run.claimedAt,
      run.completedAt ?? run.updatedAt
    ) > 0
  );
  const publishedNotes = [
    ...input.stays.map((stay) => stay.note).filter(Boolean),
    ...input.trips.map((trip) => trip.note).filter(Boolean)
  ];
  const selectionDuration = durationSeconds(input.startedAt, input.endedAt);
  const tripDistances = input.trips.reduce((sum, trip) => sum + trip.distanceMeters, 0);
  const calories = input.trips.reduce(
    (sum, trip) => sum + (trip.caloriesKcal ?? 0),
    0
  );
  const averageSpeedMps = average(
    input.trips
      .map((trip) => trip.averageSpeedMps)
      .filter((value): value is number => typeof value === "number")
  );
  const placeLabels = uniqStrings(
    input.stays
      .map((stay) => stay.place?.label ?? stay.label)
      .filter(Boolean)
      .concat(
        input.trips.flatMap((trip) => [
          trip.startPlace?.label ?? "",
          trip.endPlace?.label ?? ""
        ])
      )
  );
  const tags = uniqStrings(
    input.trips.flatMap((trip) => trip.tags).concat(
      input.stays.flatMap((stay) =>
        Array.isArray((stay.metrics as Record<string, unknown>).tags)
          ? (((stay.metrics as Record<string, unknown>).tags as string[]) ?? [])
          : []
      )
    )
  );
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

export function getMovementDayDetail(input: {
  date?: string;
  userIds?: string[];
}) {
  const targetDate = input.date ?? dayKey(nowIso());
  const placeRows = listMovementPlaceRows(input.userIds);
  const places = placeRows.map(mapMovementPlace);
  const placesById = new Map(places.map((place) => [place.id, place]));
  const stays = listMovementStayRows(input.userIds, targetDate).map((row) =>
    mapMovementStay(row, placesById)
  );
  const tripRows = listMovementTripRows(input.userIds, { dateKey: targetDate });
  const tripIds = tripRows.map((row) => row.id);
  const pointsByTrip = new Map<string, MovementTripPointRow[]>();
  const stopsByTrip = new Map<string, MovementTripStopRow[]>();
  listTripPoints(tripIds).forEach((point) => {
    pointsByTrip.set(point.trip_id, [...(pointsByTrip.get(point.trip_id) ?? []), point]);
  });
  listTripStops(tripIds).forEach((stop) => {
    stopsByTrip.set(stop.trip_id, [...(stopsByTrip.get(stop.trip_id) ?? []), stop]);
  });
  const trips = tripRows.map((row) =>
    mapMovementTrip(
      row,
      placesById,
      pointsByTrip.get(row.id) ?? [],
      stopsByTrip.get(row.id) ?? []
    )
  );

  const allSegments = [
    ...stays.map((stay) => ({
      id: stay.id,
      kind: "stay" as const,
      startedAt: stay.startedAt,
      endedAt: stay.endedAt,
      durationSeconds: stay.durationSeconds,
      label: stay.place?.label ?? stay.label ?? "Stay",
      subtitle:
        stay.place?.categoryTags.join(" · ") ||
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
      kind: "trip" as const,
      startedAt: trip.startedAt,
      endedAt: trip.endedAt,
      durationSeconds: trip.durationSeconds,
      label:
        trip.label ||
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
      totalIdleSeconds:
        stays.reduce((sum, stay) => sum + stay.durationSeconds, 0) +
        trips.reduce((sum, trip) => sum + trip.idleSeconds, 0),
      tripCount: trips.length,
      stayCount: stays.length,
      knownPlaceCount: places.length,
      caloriesKcal: round(
        trips.reduce((sum, trip) => sum + (trip.caloriesKcal ?? 0), 0)
      ),
      averageSpeedMps: round(
        average(
          trips
            .map((trip) => trip.averageSpeedMps)
            .filter((value): value is number => typeof value === "number")
        ),
        2
      )
    },
    segments: allSegments,
    stays,
    trips,
    places,
    selectionAggregate
  };
}

export function getMovementMonthSummary(input: {
  month?: string;
  userIds?: string[];
}) {
  const targetMonth = input.month ?? monthKey(nowIso());
  const stays = listMovementStayRows(input.userIds).filter(
    (row) => monthKey(row.started_at) === targetMonth
  );
  const trips = listMovementTripRows(input.userIds, { month: targetMonth });
  const byDay = new Map<
    string,
    {
      distanceMeters: number;
      movingSeconds: number;
      idleSeconds: number;
      caloriesKcal: number;
      tripCount: number;
      stayCount: number;
      expectedMet: number[];
    }
  >();
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
      idleSeconds:
        stays.reduce((sum, stay) => sum + durationSeconds(stay.started_at, stay.ended_at), 0) +
        trips.reduce((sum, trip) => sum + trip.idle_seconds, 0),
      tripCount: trips.length,
      stayCount: stays.length
    }
  };
}

export function getMovementAllTimeSummary(userIds?: string[]) {
  const placeRows = listMovementPlaceRows(userIds);
  const stays = listMovementStayRows(userIds);
  const trips = listMovementTripRows(userIds);
  const tagBreakdown = new Map<string, number>();
  placeRows.forEach((place) => {
    safeJsonParse<string[]>(place.category_tags_json, []).forEach((tag) => {
      tagBreakdown.set(tag, (tagBreakdown.get(tag) ?? 0) + 1);
    });
  });
  return {
    summary: {
      knownPlaceCount: placeRows.length,
      stayCount: stays.length,
      tripCount: trips.length,
      totalDistanceMeters: round(
        trips.reduce((sum, trip) => sum + trip.distance_meters, 0)
      ),
      totalMovingSeconds: trips.reduce((sum, trip) => sum + trip.moving_seconds, 0),
      totalIdleSeconds:
        stays.reduce((sum, stay) => sum + durationSeconds(stay.started_at, stay.ended_at), 0) +
        trips.reduce((sum, trip) => sum + trip.idle_seconds, 0),
      visitedCountries:
        new Set(
          placeRows
            .map((place) => safeJsonParse<Record<string, unknown>>(place.metadata_json, {}))
            .map((metadata) =>
              typeof metadata.countryCode === "string" ? metadata.countryCode : null
            )
            .filter((value): value is string => Boolean(value))
        ).size
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

function buildStylizedCurve(points: Array<{ latitude: number; longitude: number }>) {
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
    y: round(
      60 -
        (((point.latitude - minLat) / latRange) * 26 -
          ((point.longitude - minLng) / lngRange) * 8),
      2
    )
  }));
}

export function getMovementTripDetail(tripId: string) {
  const tripRow = getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trips
       WHERE id = ?`
    )
    .get(tripId) as MovementTripRow | undefined;
  if (!tripRow) {
    return undefined;
  }
  const places = listMovementPlaceRows([tripRow.user_id]).map(mapMovementPlace);
  const placesById = new Map(places.map((place) => [place.id, place]));
  const points = listTripPoints([tripId]);
  const stops = listTripStops([tripId]);
  const trip = mapMovementTrip(tripRow, placesById, points, stops);
  const stylizedPath = buildStylizedCurve(
    trip.points.map((point) => ({
      latitude: point.latitude,
      longitude: point.longitude
    }))
  );
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

export function getMovementSelectionAggregate(
  input: z.input<typeof movementSelectionAggregateSchema>
) {
  const parsed = movementSelectionAggregateSchema.parse(input);
  const placeRows = listMovementPlaceRows(parsed.userIds);
  const placesById = new Map(placeRows.map((row) => {
    const mapped = mapMovementPlace(row);
    return [mapped.id, mapped] as const;
  }));
  const stayRows =
    parsed.stayIds.length > 0
      ? (getDatabase()
          .prepare(
            `SELECT *
             FROM movement_stays
             WHERE id IN (${parsed.stayIds.map(() => "?").join(",")})`
          )
          .all(...parsed.stayIds) as MovementStayRow[])
      : [];
  const tripRows =
    parsed.tripIds.length > 0
      ? (getDatabase()
          .prepare(
            `SELECT *
             FROM movement_trips
             WHERE id IN (${parsed.tripIds.map(() => "?").join(",")})`
          )
          .all(...parsed.tripIds) as MovementTripRow[])
      : [];
  const tripIds = tripRows.map((row) => row.id);
  const pointsByTrip = new Map<string, MovementTripPointRow[]>();
  listTripPoints(tripIds).forEach((point) => {
    pointsByTrip.set(point.trip_id, [...(pointsByTrip.get(point.trip_id) ?? []), point]);
  });
  const stopsByTrip = new Map<string, MovementTripStopRow[]>();
  listTripStops(tripIds).forEach((stop) => {
    stopsByTrip.set(stop.trip_id, [...(stopsByTrip.get(stop.trip_id) ?? []), stop]);
  });
  const stays = stayRows.map((row) => mapMovementStay(row, placesById));
  const trips = tripRows.map((row) =>
    mapMovementTrip(
      row,
      placesById,
      pointsByTrip.get(row.id) ?? [],
      stopsByTrip.get(row.id) ?? []
    )
  );
  const startedAt =
    parsed.startedAt ??
    [...stays.map((stay) => stay.startedAt), ...trips.map((trip) => trip.startedAt)]
      .sort()[0] ??
    nowIso();
  const endedAt =
    parsed.endedAt ??
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

export function getMovementMobileBootstrap(pairing: PairingSessionLike) {
  return {
    settings: getMovementSettings([pairing.user_id]),
    places: listMovementPlaces([pairing.user_id])
  };
}
