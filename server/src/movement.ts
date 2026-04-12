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
import { getScreenTimeOverlapSummary } from "./screen-time.js";

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
] as const;

const movementCanonicalCategoryTagSet = new Set<string>(movementCategoryTags);

const movementCategoryTagAliases = new Map<string, (typeof movementCategoryTags)[number]>([
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

function slugifyMovementTag(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeMovementCategoryTag(value: string) {
  const slug = slugifyMovementTag(value);
  if (!slug) {
    return "";
  }
  return movementCategoryTagAliases.get(slug) ?? slug;
}

export function canonicalizeMovementCategoryTags(values: string[]) {
  return uniqStrings(
    values
      .map((value) => normalizeMovementCategoryTag(value))
      .filter((value) => value.length > 0)
  );
}

export function isImportantMovementCategoryTag(value: string) {
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
const movementBoxKindSchema = z.enum(["stay", "trip", "missing"]);
const movementBoxSourceKindSchema = z.enum(["automatic", "user_defined"]);
const movementBoxOriginSchema = z.enum([
  "recorded",
  "continued_stay",
  "repaired_gap",
  "missing",
  "user_defined",
  "user_invalidated"
]);
const movementUserBoxSchemaBase = z.object({
  kind: movementBoxKindSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  title: z.string().trim().default(""),
  subtitle: z.string().trim().default(""),
  placeLabel: z.string().trim().nullable().default(null),
  anchorExternalUid: z.string().trim().min(1).nullable().default(null),
  tags: z.array(z.string().trim()).default([]),
  distanceMeters: z.number().nonnegative().nullable().default(null),
  averageSpeedMps: z.number().nonnegative().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const movementUserBoxCreateSchema = movementUserBoxSchemaBase.superRefine(
  (value, ctx) => {
    if (Date.parse(value.endedAt) <= Date.parse(value.startedAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endedAt"],
        message: "Movement boxes must end after they start."
      });
    }
  }
);
export const movementUserBoxPatchSchema =
  movementUserBoxSchemaBase.partial().superRefine((value, ctx) => {
    if (value.startedAt && value.endedAt) {
      if (Date.parse(value.endedAt) <= Date.parse(value.startedAt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endedAt"],
          message: "Movement boxes must end after they start."
        });
      }
    }
  });
export const movementUserBoxPreflightSchema = movementUserBoxSchemaBase.extend({
  excludeBoxId: z.string().trim().min(1).nullable().optional(),
  rangeStart: z.string().datetime().nullable().optional(),
  rangeEnd: z.string().datetime().nullable().optional()
});
export const movementAutomaticBoxInvalidateSchema = z.object({
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
  title: z.string().trim().optional(),
  subtitle: z.string().trim().optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
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
export const movementMobileUserBoxCreateSchema = movementMobileBootstrapSchema.extend({
  box: movementUserBoxCreateSchema
});
export const movementMobileUserBoxPatchSchema = movementMobileBootstrapSchema.extend({
  patch: movementUserBoxPatchSchema
});
export const movementMobileUserBoxPreflightSchema = movementMobileBootstrapSchema.extend({
  draft: movementUserBoxPreflightSchema
});
export const movementMobileAutomaticBoxInvalidateSchema =
  movementMobileBootstrapSchema.extend({
    invalidate: movementAutomaticBoxInvalidateSchema
  });
export const movementMobileStayPatchSchema = movementMobileBootstrapSchema.extend({
  patch: movementStayPatchSchema
});
export const movementMobileTripPatchSchema = movementMobileBootstrapSchema.extend({
  patch: movementTripPatchSchema
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
  external_uid: string;
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

type MovementTripPointTombstoneRow = {
  id: string;
  user_id: string;
  trip_external_uid: string;
  point_external_uid: string;
  created_at: string;
  updated_at: string;
};

type MovementTripPointOverrideRow = {
  id: string;
  user_id: string;
  trip_external_uid: string;
  point_external_uid: string;
  point_json: string;
  created_at: string;
  updated_at: string;
};

type MovementStayTombstoneRow = {
  id: string;
  user_id: string;
  stay_external_uid: string;
  created_at: string;
  updated_at: string;
};

type MovementStayOverrideRow = {
  id: string;
  user_id: string;
  stay_external_uid: string;
  stay_json: string;
  created_at: string;
  updated_at: string;
};

type MovementTripTombstoneRow = {
  id: string;
  user_id: string;
  trip_external_uid: string;
  created_at: string;
  updated_at: string;
};

type MovementTripOverrideRow = {
  id: string;
  user_id: string;
  trip_external_uid: string;
  trip_json: string;
  created_at: string;
  updated_at: string;
};

type MovementBoxRow = {
  id: string;
  user_id: string;
  kind: z.infer<typeof movementBoxKindSchema>;
  source_kind: z.infer<typeof movementBoxSourceKindSchema>;
  origin: z.infer<typeof movementBoxOriginSchema>;
  started_at: string;
  ended_at: string;
  title: string;
  subtitle: string;
  place_label: string | null;
  anchor_external_uid: string | null;
  tags_json: string;
  distance_meters: number | null;
  average_speed_mps: number | null;
  editable: number;
  override_count: number;
  overridden_automatic_box_ids_json: string;
  true_started_at: string | null;
  true_ended_at: string | null;
  overridden_started_at: string | null;
  overridden_ended_at: string | null;
  overridden_by_box_id: string | null;
  overridden_user_box_ids_json: string;
  override_ranges_json: string;
  is_overridden: number;
  is_fully_hidden: number;
  raw_stay_ids_json: string;
  raw_trip_ids_json: string;
  raw_point_count: number;
  has_legacy_corrections: number;
  legacy_origin_key: string | null;
  metadata_json: string;
  deleted_at: string | null;
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

type MovementTimelineLaneSide = "left" | "right";

type MovementTimelineCursor = {
  endedAt: string;
  startedAt: string;
  kind: "stay" | "trip" | "missing";
  id: string;
};

const MISSING_MOVEMENT_DATA_THRESHOLD_SECONDS = 60 * 60;

function nowIso() {
  return new Date().toISOString();
}

function normalizeTripPointExternalUid(
  tripExternalUid: string,
  point: z.infer<typeof movementTripPointInputSchema>,
  index: number
) {
  const explicit = point.externalUid.trim();
  if (explicit.length > 0) {
    return explicit;
  }
  return `${tripExternalUid}::${point.recordedAt}::${index}`;
}

function deriveTripMetricsFromPoints(
  points: z.infer<typeof movementTripPointInputSchema>[],
  current: Pick<
    MovementTripRow,
    | "started_at"
    | "ended_at"
    | "distance_meters"
    | "moving_seconds"
    | "idle_seconds"
    | "average_speed_mps"
    | "max_speed_mps"
  >
) {
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

  const sorted = [...points].sort(
    (left, right) =>
      Date.parse(left.recordedAt) - Date.parse(right.recordedAt)
  );
  let distanceMeters = 0;
  let movingSeconds = 0;
  let maxSpeedMps = 0;
  const speedSamples: number[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const next = sorted[index]!;
    const elapsedSeconds = Math.max(
      0,
      Math.round(
        (Date.parse(next.recordedAt) - Date.parse(previous.recordedAt)) / 1000
      )
    );
    const segmentDistance = haversineDistanceMeters(
      { latitude: previous.latitude, longitude: previous.longitude },
      { latitude: next.latitude, longitude: next.longitude }
    );
    const inferredSpeed =
      elapsedSeconds > 0 ? segmentDistance / elapsedSeconds : 0;

    distanceMeters += segmentDistance;
    movingSeconds += elapsedSeconds;
    maxSpeedMps = Math.max(
      maxSpeedMps,
      previous.speedMps ?? 0,
      next.speedMps ?? 0,
      inferredSpeed
    );
    speedSamples.push(
      ...(previous.speedMps != null ? [previous.speedMps] : []),
      ...(next.speedMps != null ? [next.speedMps] : []),
      ...(inferredSpeed > 0 ? [inferredSpeed] : [])
    );
  }

  const startedAt = sorted[0]!.recordedAt;
  const endedAt = sorted[sorted.length - 1]!.recordedAt;
  const durationSeconds = Math.max(
    0,
    Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)
  );

  return {
    startedAt,
    endedAt,
    distanceMeters: round(distanceMeters, 2),
    movingSeconds,
    idleSeconds: Math.max(0, durationSeconds - movingSeconds),
    averageSpeedMps:
      speedSamples.length > 0
        ? round(
            speedSamples.reduce((sum, value) => sum + value, 0) /
              speedSamples.length,
            3
          )
        : null,
    maxSpeedMps: maxSpeedMps > 0 ? round(maxSpeedMps, 3) : null
  };
}

function listMovementTripPointTombstones(
  userId: string,
  tripExternalUid: string
) {
  return getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trip_point_tombstones
       WHERE user_id = ?
         AND trip_external_uid = ?`
    )
    .all(userId, tripExternalUid) as MovementTripPointTombstoneRow[];
}

function listMovementTripPointOverrides(
  userId: string,
  tripExternalUid: string
) {
  return getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trip_point_overrides
       WHERE user_id = ?
         AND trip_external_uid = ?`
    )
    .all(userId, tripExternalUid) as MovementTripPointOverrideRow[];
}

function listMovementStayTombstones(userId: string) {
  return getDatabase()
    .prepare(
      `SELECT *
       FROM movement_stay_tombstones
       WHERE user_id = ?`
    )
    .all(userId) as MovementStayTombstoneRow[];
}

function listMovementStayOverrides(userId: string) {
  return getDatabase()
    .prepare(
      `SELECT *
       FROM movement_stay_overrides
       WHERE user_id = ?`
    )
    .all(userId) as MovementStayOverrideRow[];
}

function listMovementTripTombstones(userId: string) {
  return getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trip_tombstones
       WHERE user_id = ?`
    )
    .all(userId) as MovementTripTombstoneRow[];
}

function listMovementTripOverrides(userId: string) {
  return getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trip_overrides
       WHERE user_id = ?`
    )
    .all(userId) as MovementTripOverrideRow[];
}

function listMovementBoxRows(input: {
  userIds?: string[];
  sourceKinds?: Array<z.infer<typeof movementBoxSourceKindSchema>>;
  includeDeleted?: boolean;
}) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (input.userIds && input.userIds.length > 0) {
    clauses.push(`user_id IN (${input.userIds.map(() => "?").join(",")})`);
    values.push(...input.userIds);
  }
  if (input.sourceKinds && input.sourceKinds.length > 0) {
    clauses.push(`source_kind IN (${input.sourceKinds.map(() => "?").join(",")})`);
    values.push(...input.sourceKinds);
  }
  if (!input.includeDeleted) {
    clauses.push(`deleted_at IS NULL`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return getDatabase()
    .prepare(
      `SELECT *
       FROM movement_boxes
       ${where}
       ORDER BY started_at ASC, ended_at ASC, created_at ASC`
    )
    .all(...values) as MovementBoxRow[];
}

function getMovementBoxRow(id: string) {
  return getDatabase()
    .prepare(
      `SELECT *
       FROM movement_boxes
       WHERE id = ?`
    )
    .get(id) as MovementBoxRow | undefined;
}

function movementBoxTags(row: MovementBoxRow) {
  return uniqStrings(safeJsonParse<string[]>(row.tags_json, []));
}

function movementBoxMetadata(row: MovementBoxRow) {
  return safeJsonParse<Record<string, unknown>>(row.metadata_json, {});
}

function movementBoxRawStayIds(row: MovementBoxRow) {
  return safeJsonParse<string[]>(row.raw_stay_ids_json, []);
}

function movementBoxRawTripIds(row: MovementBoxRow) {
  return safeJsonParse<string[]>(row.raw_trip_ids_json, []);
}

function movementBoxOverriddenAutomaticBoxIds(row: MovementBoxRow) {
  return safeJsonParse<string[]>(row.overridden_automatic_box_ids_json, []);
}

type MovementBoxOverrideRange = {
  startedAt: string;
  endedAt: string;
};

function movementBoxOverriddenUserBoxIds(row: MovementBoxRow) {
  return safeJsonParse<string[]>(row.overridden_user_box_ids_json, []);
}

function movementBoxOverrideRanges(row: MovementBoxRow) {
  return safeJsonParse<MovementBoxOverrideRange[]>(row.override_ranges_json, []);
}

function normalizeMovementBoxTitle(row: MovementBoxRow) {
  const title = row.title.trim();
  if (row.kind !== "missing") {
    return title;
  }
  if (row.source_kind === "automatic") {
    return "Missing data";
  }
  if (title.length === 0) {
    return row.origin === "user_invalidated"
      ? "User invalidated movement"
      : "User-defined missing data";
  }
  const normalized = title.toLowerCase();
  if (
    normalized === "stay" ||
    normalized === "continued stay" ||
    normalized === "repaired stay"
  ) {
    return row.origin === "user_invalidated"
      ? "User invalidated movement"
      : "User-defined missing data";
  }
  return title;
}

function normalizeMovementBoxSubtitle(row: MovementBoxRow) {
  const subtitle = row.subtitle.trim();
  if (row.kind !== "missing") {
    return subtitle;
  }
  if (row.source_kind === "automatic") {
    return "No trusted movement signal for this period.";
  }
  if (subtitle.length > 0) {
    return subtitle;
  }
  return row.origin === "user_invalidated"
    ? "Overrides the automatic movement box with missing data."
    : "User-defined missing-data override.";
}

function mapMovementBoxRow(row: MovementBoxRow) {
  return {
    id: row.id,
    boxId: row.id,
    kind: row.kind,
    sourceKind: row.source_kind,
    origin: row.origin,
    editable: row.editable === 1,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    trueStartedAt: row.true_started_at ?? row.started_at,
    trueEndedAt: row.true_ended_at ?? row.ended_at,
    visibleStartedAt: row.started_at,
    visibleEndedAt: row.ended_at,
    durationSeconds: durationSeconds(row.started_at, row.ended_at),
    title: normalizeMovementBoxTitle(row),
    subtitle: normalizeMovementBoxSubtitle(row),
    placeLabel: row.place_label,
    anchorExternalUid: row.anchor_external_uid,
    tags: movementBoxTags(row),
    distanceMeters: row.distance_meters ?? 0,
    averageSpeedMps: row.average_speed_mps ?? 0,
    overrideCount: row.override_count,
    overriddenAutomaticBoxIds: movementBoxOverriddenAutomaticBoxIds(row),
    overriddenUserBoxIds: movementBoxOverriddenUserBoxIds(row),
    isFullyHidden: row.is_fully_hidden === 1,
    rawStayIds: movementBoxRawStayIds(row),
    rawTripIds: movementBoxRawTripIds(row),
    rawPointCount: row.raw_point_count,
    hasLegacyCorrections: row.has_legacy_corrections === 1,
    metadata: {
      ...movementBoxMetadata(row),
      overrideRanges: movementBoxOverrideRanges(row),
      overriddenStartedAt: row.overridden_started_at,
      overriddenEndedAt: row.overridden_ended_at,
      overriddenByBoxId: row.overridden_by_box_id,
      isOverridden: row.is_overridden === 1
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function insertMovementBox(input: {
  id?: string;
  userId: string;
  kind: z.infer<typeof movementBoxKindSchema>;
  sourceKind: z.infer<typeof movementBoxSourceKindSchema>;
  origin: z.infer<typeof movementBoxOriginSchema>;
  startedAt: string;
  endedAt: string;
  title?: string;
  subtitle?: string;
  placeLabel?: string | null;
  anchorExternalUid?: string | null;
  tags?: string[];
  distanceMeters?: number | null;
  averageSpeedMps?: number | null;
  editable?: boolean;
  overrideCount?: number;
  overriddenAutomaticBoxIds?: string[];
  overriddenUserBoxIds?: string[];
  trueStartedAt?: string | null;
  trueEndedAt?: string | null;
  overriddenStartedAt?: string | null;
  overriddenEndedAt?: string | null;
  overriddenByBoxId?: string | null;
  overrideRanges?: MovementBoxOverrideRange[];
  isOverridden?: boolean;
  isFullyHidden?: boolean;
  rawStayIds?: string[];
  rawTripIds?: string[];
  rawPointCount?: number;
  hasLegacyCorrections?: boolean;
  legacyOriginKey?: string | null;
  metadata?: Record<string, unknown>;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}) {
  const now = nowIso();
  const existingByLegacyOriginKey =
    input.legacyOriginKey != null
      ? ((getDatabase()
          .prepare(
            `SELECT id
             FROM movement_boxes
             WHERE user_id = ?
               AND legacy_origin_key = ?`
          )
          .get(input.userId, input.legacyOriginKey) as { id: string } | undefined) ??
        null)
      : null;
  const id =
    existingByLegacyOriginKey?.id ??
    input.id ??
    `mbx_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  getDatabase()
    .prepare(
      `INSERT INTO movement_boxes (
         id, user_id, kind, source_kind, origin, started_at, ended_at, title, subtitle,
         place_label, anchor_external_uid, tags_json, distance_meters, average_speed_mps,
         editable, override_count, overridden_automatic_box_ids_json,
         true_started_at, true_ended_at, overridden_started_at, overridden_ended_at,
         overridden_by_box_id, overridden_user_box_ids_json, override_ranges_json,
         is_overridden, is_fully_hidden, raw_stay_ids_json,
         raw_trip_ids_json, raw_point_count, has_legacy_corrections, legacy_origin_key,
         metadata_json, deleted_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         source_kind = excluded.source_kind,
         origin = excluded.origin,
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         title = excluded.title,
         subtitle = excluded.subtitle,
         place_label = excluded.place_label,
         anchor_external_uid = excluded.anchor_external_uid,
         tags_json = excluded.tags_json,
         distance_meters = excluded.distance_meters,
         average_speed_mps = excluded.average_speed_mps,
         editable = excluded.editable,
         override_count = excluded.override_count,
         overridden_automatic_box_ids_json = excluded.overridden_automatic_box_ids_json,
         true_started_at = excluded.true_started_at,
         true_ended_at = excluded.true_ended_at,
         overridden_started_at = excluded.overridden_started_at,
         overridden_ended_at = excluded.overridden_ended_at,
         overridden_by_box_id = excluded.overridden_by_box_id,
         overridden_user_box_ids_json = excluded.overridden_user_box_ids_json,
         override_ranges_json = excluded.override_ranges_json,
         is_overridden = excluded.is_overridden,
         is_fully_hidden = excluded.is_fully_hidden,
         raw_stay_ids_json = excluded.raw_stay_ids_json,
         raw_trip_ids_json = excluded.raw_trip_ids_json,
         raw_point_count = excluded.raw_point_count,
         has_legacy_corrections = excluded.has_legacy_corrections,
         legacy_origin_key = excluded.legacy_origin_key,
         metadata_json = excluded.metadata_json,
         deleted_at = excluded.deleted_at,
         updated_at = excluded.updated_at`
    )
    .run(
      id,
      input.userId,
      input.kind,
      input.sourceKind,
      input.origin,
      input.startedAt,
      input.endedAt,
      input.title ?? "",
      input.subtitle ?? "",
      input.placeLabel ?? null,
      input.anchorExternalUid ?? null,
      JSON.stringify(uniqStrings(input.tags ?? [])),
      input.distanceMeters ?? null,
      input.averageSpeedMps ?? null,
      input.editable ? 1 : 0,
      input.overrideCount ?? 0,
      JSON.stringify(input.overriddenAutomaticBoxIds ?? []),
      input.trueStartedAt ?? input.startedAt,
      input.trueEndedAt ?? input.endedAt,
      input.overriddenStartedAt ?? null,
      input.overriddenEndedAt ?? null,
      input.overriddenByBoxId ?? null,
      JSON.stringify(input.overriddenUserBoxIds ?? []),
      JSON.stringify(input.overrideRanges ?? []),
      input.isOverridden ? 1 : 0,
      input.isFullyHidden ? 1 : 0,
      JSON.stringify(input.rawStayIds ?? []),
      JSON.stringify(input.rawTripIds ?? []),
      input.rawPointCount ?? 0,
      input.hasLegacyCorrections ? 1 : 0,
      input.legacyOriginKey ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.deletedAt ?? null,
      input.createdAt ?? now,
      input.updatedAt ?? now
    );
  return getMovementBoxRow(id)!;
}

function softDeleteMovementBox(id: string) {
  const now = nowIso();
  getDatabase()
    .prepare(
      `UPDATE movement_boxes
       SET deleted_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(now, now, id);
}

function applyMovementStaySyncDirectives(
  userId: string,
  stay: z.infer<typeof movementStayInputSchema>
) {
  const tombstoned = new Set(
    listMovementStayTombstones(userId).map((row) => row.stay_external_uid)
  );
  if (tombstoned.has(stay.externalUid)) {
    return null;
  }
  const override = listMovementStayOverrides(userId).find(
    (row) => row.stay_external_uid === stay.externalUid
  );
  if (!override) {
    return stay;
  }
  return movementStayInputSchema.parse({
    ...stay,
    ...safeJsonParse<Partial<z.infer<typeof movementStayInputSchema>>>(
      override.stay_json,
      {}
    ),
    externalUid: stay.externalUid
  });
}

function applyMovementTripSyncDirectives(
  userId: string,
  trip: z.infer<typeof movementTripInputSchema>
) {
  const tombstoned = new Set(
    listMovementTripTombstones(userId).map((row) => row.trip_external_uid)
  );
  if (tombstoned.has(trip.externalUid)) {
    return null;
  }
  const override = listMovementTripOverrides(userId).find(
    (row) => row.trip_external_uid === trip.externalUid
  );
  if (!override) {
    return trip;
  }
  return movementTripInputSchema.parse({
    ...trip,
    ...safeJsonParse<Partial<z.infer<typeof movementTripInputSchema>>>(
      override.trip_json,
      {}
    ),
    externalUid: trip.externalUid
  });
}

function applyTripPointSyncDirectives(input: {
  userId: string;
  tripExternalUid: string;
  points: z.infer<typeof movementTripPointInputSchema>[];
}) {
  const tombstonedExternalUids = new Set(
    listMovementTripPointTombstones(input.userId, input.tripExternalUid).map(
      (row) => row.point_external_uid
    )
  );
  const overridesByExternalUid = new Map(
    listMovementTripPointOverrides(input.userId, input.tripExternalUid).map(
      (row) => {
        const parsed = safeJsonParse<
          Partial<z.infer<typeof movementTripPointInputSchema>>
        >(row.point_json, {});
        return [row.point_external_uid, parsed] as const;
      }
    )
  );

  return input.points
    .map((point, index) => ({
      ...point,
      externalUid: normalizeTripPointExternalUid(
        input.tripExternalUid,
        point,
        index
      )
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

function mapTripStopRowToInput(stop: MovementTripStopRow) {
  const place = stop.place_id
    ? (getDatabase()
        .prepare(
          `SELECT external_uid
           FROM movement_places
           WHERE id = ?`
        )
        .get(stop.place_id) as { external_uid: string } | undefined)
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
    metadata: safeJsonParse<Record<string, unknown>>(stop.metadata_json, {})
  };
}

function replaceTripPoints(
  tripId: string,
  tripExternalUid: string,
  points: z.infer<typeof movementTripPointInputSchema>[]
) {
  getDatabase()
    .prepare(`DELETE FROM movement_trip_points WHERE trip_id = ?`)
    .run(tripId);

  const pointInsert = getDatabase().prepare(
    `INSERT INTO movement_trip_points (
       id, trip_id, external_uid, sequence_index, recorded_at, latitude, longitude,
       accuracy_meters, altitude_meters, speed_mps, is_stop_anchor, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const now = nowIso();

  points.forEach((point, index) => {
    const externalUid = normalizeTripPointExternalUid(tripExternalUid, point, index);
    pointInsert.run(
      `mtp_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      tripId,
      externalUid,
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
}

function refreshTripDerivedFields(tripId: string) {
  const trip = getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trips
       WHERE id = ?`
    )
    .get(tripId) as MovementTripRow | undefined;
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
  const startPlace =
    resolvePlaceForCoordinates(
      trip.user_id,
      points[0]
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
            }
    ) ?? resolvePlaceRowById(trip.user_id, trip.start_place_id);
  const endPlace =
    resolvePlaceForCoordinates(
      trip.user_id,
      points[points.length - 1]
        ? {
            latitude: points[points.length - 1]!.latitude,
            longitude: points[points.length - 1]!.longitude
          }
        : stops[stops.length - 1]
          ? {
              latitude: stops[stops.length - 1]!.latitude,
              longitude: stops[stops.length - 1]!.longitude
            }
          : {
              latitude: 0,
              longitude: 0
            }
    ) ?? resolvePlaceRowById(trip.user_id, trip.end_place_id);
  const expectedMet = inferExpectedMet(trip.activity_type, metrics.averageSpeedMps);
  getDatabase()
    .prepare(
      `UPDATE movement_trips
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
       WHERE id = ?`
    )
    .run(
      startPlace?.id ?? null,
      endPlace?.id ?? null,
      metrics.startedAt,
      metrics.endedAt,
      metrics.distanceMeters,
      metrics.movingSeconds,
      metrics.idleSeconds,
      metrics.averageSpeedMps,
      metrics.maxSpeedMps,
      expectedMet,
      nowIso(),
      tripId
    );
  reconcileMovementOverlapValidation(trip.user_id);
  return getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trips
       WHERE id = ?`
    )
    .get(tripId) as MovementTripRow;
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

function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function encodeMovementTimelineCursor(cursor: MovementTimelineCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeMovementTimelineCursor(rawValue?: string) {
  if (!rawValue) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(rawValue, "base64url").toString("utf8")
    ) as MovementTimelineCursor;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.kind !== "string" ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.endedAt !== "string"
    ) {
      return null;
    }
    if (
      parsed.kind !== "stay" &&
      parsed.kind !== "trip" &&
      parsed.kind !== "missing"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
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

function enrichMovementSegmentWithScreenTime<T extends {
  startedAt: string;
  endedAt: string;
}>(segment: T, userIds?: string[]) {
  return {
    ...segment,
    ...getScreenTimeOverlapSummary({
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      userIds
    })
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

function rangesOverlap(
  leftStartedAt: string,
  leftEndedAt: string,
  rightStartedAt: string,
  rightEndedAt: string
) {
  return leftStartedAt < rightEndedAt && rightStartedAt < leftEndedAt;
}

function movementValidation(metadata: Record<string, unknown>) {
  const validation =
    metadata.validation &&
    typeof metadata.validation === "object" &&
    !Array.isArray(metadata.validation)
      ? (metadata.validation as Record<string, unknown>)
      : null;
  return validation;
}

function hasInvalidMovementRecord(metadata: Record<string, unknown>) {
  const validation = movementValidation(metadata);
  return (
    validation?.invalid === true ||
    validation?.invalidOverlap === true ||
    validation?.invalidTinyMove === true
  );
}

function reconcileMovementOverlapValidation(userId: string) {
  const stayRows = listMovementStayRows([userId]);
  const tripRows = listMovementTripRows([userId]);
  const entries = [
    ...stayRows.map((row) => ({
      id: row.id,
      kind: "stay" as const,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      metadataJson: row.metadata_json,
      label: row.label || "stay"
    })),
    ...tripRows.map((row) => ({
      id: row.id,
      kind: "trip" as const,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      metadataJson: row.metadata_json,
      label: row.label || "trip"
    }))
  ].sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt) ||
    left.endedAt.localeCompare(right.endedAt) ||
    left.kind.localeCompare(right.kind) ||
    left.id.localeCompare(right.id)
  );

  const overlapIssuesByKey = new Map<string, string[]>();
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index]!;
    for (let nextIndex = index + 1; nextIndex < entries.length; nextIndex += 1) {
      const next = entries[nextIndex]!;
      if (next.startedAt >= current.endedAt) {
        break;
      }
      if (!rangesOverlap(current.startedAt, current.endedAt, next.startedAt, next.endedAt)) {
        continue;
      }
      const currentKey = `${current.kind}:${current.id}`;
      const nextKey = `${next.kind}:${next.id}`;
      const currentIssues = overlapIssuesByKey.get(currentKey) ?? [];
      currentIssues.push(
        `Overlaps ${next.kind} ${next.id} from ${next.startedAt} to ${next.endedAt}.`
      );
      overlapIssuesByKey.set(currentKey, currentIssues);
      const nextIssues = overlapIssuesByKey.get(nextKey) ?? [];
      nextIssues.push(
        `Overlaps ${current.kind} ${current.id} from ${current.startedAt} to ${current.endedAt}.`
      );
      overlapIssuesByKey.set(nextKey, nextIssues);
    }
  }

  const now = nowIso();
  stayRows.forEach((row) => {
    const metadata = safeJsonParse<Record<string, unknown>>(row.metadata_json, {});
    const issues = overlapIssuesByKey.get(`stay:${row.id}`) ?? [];
    const validation = {
      ...(
        metadata.validation &&
        typeof metadata.validation === "object" &&
        !Array.isArray(metadata.validation)
          ? (metadata.validation as Record<string, unknown>)
          : {}
      ),
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
        .prepare(
          `UPDATE movement_stays
           SET metadata_json = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(JSON.stringify(nextMetadata), now, row.id);
    }
  });
  tripRows.forEach((row) => {
    const metadata = safeJsonParse<Record<string, unknown>>(row.metadata_json, {});
    const issues = overlapIssuesByKey.get(`trip:${row.id}`) ?? [];
    const tinyMoveIssues = [
      row.distance_meters < 100
        ? `Distance ${Math.round(row.distance_meters)}m is below the 100m minimum for a valid move.`
        : null,
      durationSeconds(row.started_at, row.ended_at) < 5 * 60
        ? `Duration ${durationSeconds(row.started_at, row.ended_at)}s is below the 5 minute minimum for a valid move.`
        : null
    ].filter((value): value is string => Boolean(value));
    const validation = {
      ...(
        metadata.validation &&
        typeof metadata.validation === "object" &&
        !Array.isArray(metadata.validation)
          ? (metadata.validation as Record<string, unknown>)
          : {}
      ),
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
        .prepare(
          `UPDATE movement_trips
           SET metadata_json = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(JSON.stringify(nextMetadata), now, row.id);
    }
  });
}

function resolvePlaceRowById(userId: string, placeId: string | null | undefined) {
  if (!placeId) {
    return null;
  }
  return (
    (getDatabase()
      .prepare(
        `SELECT *
         FROM movement_places
         WHERE id = ?
           AND user_id = ?`
      )
      .get(placeId, userId) as MovementPlaceRow | undefined) ?? null
  );
}

function resolvePlaceForPatch(input: {
  userId: string;
  explicitPlaceId?: string | null;
  explicitPlaceExternalUid?: string | null;
  fallbackCoordinates: { latitude: number; longitude: number };
}) {
  if (input.explicitPlaceId !== undefined) {
    return resolvePlaceRowById(input.userId, input.explicitPlaceId);
  }
  if (input.explicitPlaceExternalUid !== undefined) {
    return input.explicitPlaceExternalUid
      ? resolvePlaceForCoordinates(
          input.userId,
          input.fallbackCoordinates,
          input.explicitPlaceExternalUid
        ) ?? null
      : null;
  }
  return undefined;
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

function formatMovementDurationForNote(valueSeconds: number) {
  if (valueSeconds >= 86_400) {
    return `${round(valueSeconds / 86_400, 1)} days`;
  }
  if (valueSeconds >= 3_600) {
    return `${round(valueSeconds / 3_600, 1)} hours`;
  }
  return `${Math.max(1, Math.round(valueSeconds / 60))} minutes`;
}

function mergeMovementNoteTags(
  existingTags: string[],
  existingFrontmatter: Record<string, unknown>,
  generatedTags: string[]
) {
  const movement =
    existingFrontmatter.movement &&
    typeof existingFrontmatter.movement === "object" &&
    !Array.isArray(existingFrontmatter.movement)
      ? (existingFrontmatter.movement as Record<string, unknown>)
      : null;
  const previousGeneratedTags = Array.isArray(movement?.generatedTags)
    ? movement.generatedTags.filter(
        (value): value is string => typeof value === "string"
      )
    : [];
  const previousGeneratedTagSet = new Set(
    previousGeneratedTags.map((tag) => tag.toLowerCase())
  );
  const preservedTags = existingTags.filter(
    (tag) => !previousGeneratedTagSet.has(tag.toLowerCase())
  );
  return uniqStrings([...preservedTags, ...generatedTags]);
}

function syncMovementNote(input: {
  userId: string;
  publishedNoteId: string | null;
  title: string;
  contentMarkdown: string;
  generatedTags: string[];
  frontmatter: Record<string, unknown>;
}) {
  const existingNote = input.publishedNoteId
    ? getNoteById(input.publishedNoteId)
    : null;
  if (existingNote && !Array.isArray(existingNote)) {
    const updated = updateNote(
      existingNote.id,
      {
        title: input.title,
        contentMarkdown: input.contentMarkdown,
        tags: mergeMovementNoteTags(
          existingNote.tags ?? [],
          existingNote.frontmatter,
          input.generatedTags
        ),
        frontmatter: {
          ...existingNote.frontmatter,
          ...input.frontmatter
        }
      },
      { actor: "Movement sync", source: "system" }
    );
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

function syncStayNote(
  settings: ReturnType<typeof mapMovementSettings>,
  stay: MovementStayRow,
  place: MovementPlaceRow | undefined
) {
  if (!settings || settings.publishMode === "no_publish") {
    return null;
  }
  const label = place?.label || stay.label || "Unlabeled stay";
  const durationSecondsValue = durationSeconds(stay.started_at, stay.ended_at);
  const live =
    stay.status.trim().toLowerCase() !== "completed" &&
    stay.status.trim().toLowerCase() !== "closed";
  const generatedTags = uniqStrings([
    "movement",
    "stay",
    ...(place ? safeJsonParse<string[]>(place.category_tags_json, []) : [])
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

function syncTripNote(
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
  const durationSecondsValue = durationSeconds(trip.started_at, trip.ended_at);
  const distanceKm = round(trip.distance_meters / 1000, 2);
  const live =
    trip.status.trim().toLowerCase() !== "completed" &&
    trip.status.trim().toLowerCase() !== "closed";
  const generatedTags = uniqStrings([
    "movement",
    "trip",
    ...safeJsonParse<string[]>(trip.tags_json, [])
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
      JSON.stringify(canonicalizeMovementCategoryTags(parsed.categoryTags)),
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
  tripExternalUid: string,
  points: z.infer<typeof movementTripPointInputSchema>[],
  stops: z.infer<typeof movementTripStopInputSchema>[],
  userId: string
) {
  replaceTripPoints(tripId, tripExternalUid, points);
  getDatabase()
    .prepare(`DELETE FROM movement_trip_stops WHERE trip_id = ?`)
    .run(tripId);
  const stopInsert = getDatabase().prepare(
    `INSERT INTO movement_trip_stops (
       id, external_uid, trip_id, sequence_index, label, place_id,
       started_at, ended_at, duration_seconds, latitude, longitude,
       radius_meters, metadata_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const now = nowIso();

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
  reconcileMovementOverlapValidation(pairing.user_id);
  const fresh = getDatabase()
    .prepare(`SELECT * FROM movement_stays WHERE user_id = ? AND external_uid = ?`)
    .get(pairing.user_id, parsed.externalUid) as MovementStayRow;
  const freshMetadata = safeJsonParse<Record<string, unknown>>(fresh.metadata_json, {});
  if (settings?.publishMode === "auto_publish" && !hasInvalidMovementRecord(freshMetadata)) {
    const publishedNoteId = syncStayNote(settings, fresh, matchedPlace);
    if (publishedNoteId && publishedNoteId !== fresh.published_note_id) {
      getDatabase()
        .prepare(
          `UPDATE movement_stays
           SET published_note_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(publishedNoteId, nowIso(), fresh.id);
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
  const canonicalPoints = applyTripPointSyncDirectives({
    userId: pairing.user_id,
    tripExternalUid: parsed.externalUid,
    points: parsed.points
  });
  const firstPoint = canonicalPoints[0] ?? null;
  const lastPoint = canonicalPoints[canonicalPoints.length - 1] ?? null;
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
  const derivedMetrics = deriveTripMetricsFromPoints(canonicalPoints, {
    started_at: parsed.startedAt,
    ended_at: parsed.endedAt,
    distance_meters: parsed.distanceMeters,
    moving_seconds: parsed.movingSeconds,
    idle_seconds: parsed.idleSeconds,
    average_speed_mps: parsed.averageSpeedMps,
    max_speed_mps: parsed.maxSpeedMps
  });
  const effectiveExpectedMet =
    parsed.expectedMet ??
    inferExpectedMet(
      parsed.activityType,
      derivedMetrics.averageSpeedMps ?? parsed.averageSpeedMps
    );
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
      derivedMetrics.startedAt,
      derivedMetrics.endedAt,
      derivedMetrics.distanceMeters,
      derivedMetrics.movingSeconds,
      derivedMetrics.idleSeconds,
      derivedMetrics.averageSpeedMps,
      derivedMetrics.maxSpeedMps,
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
  reconcileMovementOverlapValidation(pairing.user_id);
  const fresh = getDatabase()
    .prepare(`SELECT * FROM movement_trips WHERE user_id = ? AND external_uid = ?`)
    .get(pairing.user_id, parsed.externalUid) as MovementTripRow;
  replaceTripChildren(
    fresh.id,
    parsed.externalUid,
    canonicalPoints,
    parsed.stops,
    pairing.user_id
  );
  reconcileMovementOverlapValidation(pairing.user_id);
  const refreshed = getDatabase()
    .prepare(`SELECT * FROM movement_trips WHERE id = ?`)
    .get(fresh.id) as MovementTripRow;
  const freshMetadata = safeJsonParse<Record<string, unknown>>(refreshed.metadata_json, {});
  if (settings?.publishMode === "auto_publish" && !hasInvalidMovementRecord(freshMetadata)) {
    const publishedNoteId = syncTripNote(settings, refreshed, startPlace, endPlace);
    if (publishedNoteId && publishedNoteId !== refreshed.published_note_id) {
      getDatabase()
        .prepare(
          `UPDATE movement_trips
           SET published_note_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(publishedNoteId, nowIso(), refreshed.id);
    }
  }
  if (!existing && settings?.publishMode === "auto_publish" && !hasInvalidMovementRecord(freshMetadata)) {
    awardMovementXp({
      userId: pairing.user_id,
      entityId: refreshed.id,
      categoryTags: uniqStrings([
        ...(startPlace
          ? safeJsonParse<string[]>(startPlace.category_tags_json, [])
          : []),
        ...(endPlace
          ? safeJsonParse<string[]>(endPlace.category_tags_json, [])
          : []),
        ...parsed.tags
      ]),
      distanceMeters: refreshed.distance_meters,
      title: "Movement exploration"
    });
  }
  return {
    mode: existing ? "updated" as const : "created" as const,
    tripId: refreshed.id
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
    const canonicalStay = applyMovementStaySyncDirectives(pairing.user_id, stay);
    if (!canonicalStay) {
      return;
    }
    const result = upsertMovementStay(pairing, settings, canonicalStay);
    if (result.mode === "created") {
      createdCount += 1;
    } else {
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
    } else {
      updatedCount += 1;
    }
  });

  cleanupRawTripPoints(pairing.user_id);
  rebuildAutomaticMovementBoxes(pairing.user_id);

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

function buildMovementTimelineTitleForStay(stay: ReturnType<typeof mapMovementStay>) {
  return stay.place?.label || stay.label || "Stay";
}

function buildMovementTimelineSubtitleForStay(
  stay: ReturnType<typeof mapMovementStay>
) {
  const metricTags = Array.isArray((stay.metrics as Record<string, unknown>).tags)
    ? (((stay.metrics as Record<string, unknown>).tags as string[]) ?? [])
    : [];
  const metadataTags = Array.isArray((stay.metadata as Record<string, unknown>).tags)
    ? (((stay.metadata as Record<string, unknown>).tags as string[]) ?? [])
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

function buildMovementTimelineTitleForTrip(trip: ReturnType<typeof mapMovementTrip>) {
  return (
    trip.label ||
    `${trip.startPlace?.label ?? "Unknown"} → ${trip.endPlace?.label ?? "Unknown"}`
  );
}

function buildMovementTimelineSubtitleForTrip(
  trip: ReturnType<typeof mapMovementTrip>
) {
  const parts = [
    trip.distanceMeters > 0 ? `${round(trip.distanceMeters / 1000, 1)} km` : "",
    trip.activityType || trip.travelMode,
    trip.stops.length > 0 ? `${trip.stops.length} stop${trip.stops.length === 1 ? "" : "s"}` : ""
  ].filter(Boolean);
  return parts.join(" · ");
}

function compareMovementTimelineDescending(
  left: MovementTimelineCursor,
  right: MovementTimelineCursor
) {
  return (
    right.endedAt.localeCompare(left.endedAt) ||
    right.startedAt.localeCompare(left.startedAt) ||
    right.kind.localeCompare(left.kind) ||
    right.id.localeCompare(left.id)
  );
}

type MovementGapBoundary = {
  latitude: number;
  longitude: number;
  placeLabel: string | null;
  placeExternalUid: string | null;
} | null;

type MovementGapSourceSegment<TKind extends "stay" | "trip", TPayload> = {
  id: string;
  kind: TKind;
  startedAt: string;
  endedAt: string;
  payload: TPayload;
  startBoundary: MovementGapBoundary;
  endBoundary: MovementGapBoundary;
};

type MovementDerivedGapSegment = {
  id: string;
  kind: "stay" | "trip" | "missing";
  origin: "continued_stay" | "repaired_gap" | "missing";
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  displacementMeters: number | null;
  placeLabel: string | null;
  suppressedShortJump: boolean;
  startBoundary: MovementGapBoundary;
  endBoundary: MovementGapBoundary;
};

type MovementNormalizedGapSegment<TPayload> = {
  id: string;
  kind: "stay" | "trip" | "missing";
  origin: "recorded" | "continued_stay" | "repaired_gap" | "missing";
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  payload: TPayload | null;
  displacementMeters: number | null;
  placeLabel: string | null;
  suppressedShortJump: boolean;
  startBoundary: MovementGapBoundary;
  endBoundary: MovementGapBoundary;
};

function movementBoundaryDistanceMeters(
  left: MovementGapBoundary,
  right: MovementGapBoundary
) {
  if (!left || !right) {
    return null;
  }
  return haversineDistanceMeters(
    {
      latitude: left.latitude,
      longitude: left.longitude
    },
    {
      latitude: right.latitude,
      longitude: right.longitude
    }
  );
}

function movementBoundariesShareAnchor(
  left: MovementGapBoundary,
  right: MovementGapBoundary
) {
  if (!left || !right) {
    return false;
  }
  if (
    left.placeExternalUid &&
    right.placeExternalUid &&
    left.placeExternalUid === right.placeExternalUid
  ) {
    return true;
  }
  const displacementMeters = movementBoundaryDistanceMeters(left, right);
  return displacementMeters !== null && displacementMeters <= 100;
}

function buildDerivedMovementGapSegment(input: {
  id: string;
  kind: "stay" | "trip" | "missing";
  origin: "continued_stay" | "repaired_gap" | "missing";
  startedAt: string;
  endedAt: string;
  displacementMeters?: number | null;
  placeLabel?: string | null;
  suppressedShortJump?: boolean;
  startBoundary?: MovementGapBoundary;
  endBoundary?: MovementGapBoundary;
}) {
  return {
    id: input.id,
    kind: input.kind,
    origin: input.origin,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationSeconds: durationSeconds(input.startedAt, input.endedAt),
    displacementMeters: input.displacementMeters ?? null,
    placeLabel: input.placeLabel ?? null,
    suppressedShortJump: input.suppressedShortJump ?? false,
    startBoundary: input.startBoundary ?? null,
    endBoundary: input.endBoundary ?? null
  } satisfies MovementDerivedGapSegment;
}

function coalesceMovementStayCoverageSegments<TPayload>(
  segments: MovementNormalizedGapSegment<TPayload>[]
) {
  const coalesced: MovementNormalizedGapSegment<TPayload>[] = [];
  for (const segment of segments) {
    const previous = coalesced[coalesced.length - 1];
    const shouldMerge =
      previous &&
      previous.kind === "stay" &&
      segment.kind === "stay" &&
      (previous.origin !== "recorded" || segment.origin !== "recorded") &&
      durationSeconds(previous.endedAt, segment.startedAt) === 0 &&
      movementBoundariesShareAnchor(previous.endBoundary, segment.startBoundary);

    if (!shouldMerge || !previous) {
      coalesced.push(segment);
      continue;
    }

    const mergedOrigin =
      previous.origin === "continued_stay" || segment.origin === "continued_stay"
        ? "continued_stay"
        : previous.origin === "repaired_gap" || segment.origin === "repaired_gap"
          ? "repaired_gap"
          : "recorded";
    coalesced[coalesced.length - 1] = {
      id: `coalesced_stay_${previous.id}_${segment.id}`,
      kind: "stay",
      origin: mergedOrigin,
      startedAt: previous.startedAt,
      endedAt: segment.endedAt,
      durationSeconds: durationSeconds(previous.startedAt, segment.endedAt),
      payload: null,
      displacementMeters: null,
      placeLabel:
        previous.placeLabel ??
        segment.placeLabel ??
        previous.endBoundary?.placeLabel ??
        segment.startBoundary?.placeLabel ??
        null,
      suppressedShortJump: previous.suppressedShortJump || segment.suppressedShortJump,
      startBoundary: previous.startBoundary,
      endBoundary: segment.endBoundary
    };
  }
  return coalesced;
}

// Movement repair rules are intentionally duplicated here and in the companion.
// They are binding, and the tests are expected to enforce them:
// 1. Every positive-duration interval must be labeled as stay, trip, or missing.
// 2. Missing is never allowed for gaps under one hour.
// 3. Any move with cumulative distance under 100m is invalid and must be repaired into stay.
// 4. Any move with duration under 5 minutes is invalid and must be repaired into stay.
// 5. For gaps under one hour:
//    - same place / same anchor => continue stay
//    - different place => repaired trip only when boundary displacement is >100m
//      and the gap lasts at least 5 minutes
//    - otherwise => repaired stay
function normalizeMovementCoverageSegments<
  T extends MovementGapSourceSegment<"stay" | "trip", unknown>
>(
  segments: T[],
  options: { rangeStart?: string; rangeEnd?: string; allowStayCoalescing?: boolean } = {}
) {
  const sorted = [...segments]
    .sort((left, right) =>
      left.startedAt.localeCompare(right.startedAt) ||
      left.endedAt.localeCompare(right.endedAt)
    )
    .map(
      (segment) =>
        ({
          id: segment.id,
          kind: segment.kind,
          origin: "recorded",
          startedAt: segment.startedAt,
          endedAt: segment.endedAt,
          durationSeconds: durationSeconds(segment.startedAt, segment.endedAt),
          payload: segment.payload,
          displacementMeters: null,
          placeLabel:
            segment.kind === "stay"
              ? segment.startBoundary?.placeLabel ?? segment.endBoundary?.placeLabel ?? null
              : segment.endBoundary?.placeLabel ?? segment.startBoundary?.placeLabel ?? null,
          suppressedShortJump: false,
          startBoundary: segment.startBoundary,
          endBoundary: segment.endBoundary
        }) satisfies MovementNormalizedGapSegment<T["payload"]>
    );

  const classifyGap = (
    previous: MovementNormalizedGapSegment<T["payload"]>,
    next: MovementNormalizedGapSegment<T["payload"]>
  ) => {
    const gapSeconds = durationSeconds(previous.endedAt, next.startedAt);
    if (gapSeconds <= 0) {
      return null;
    }
    if (gapSeconds > MISSING_MOVEMENT_DATA_THRESHOLD_SECONDS) {
      return buildDerivedMovementGapSegment({
        id: `missing_${previous.endedAt}_${next.startedAt}`,
        kind: "missing",
        origin: "missing",
        startedAt: previous.endedAt,
        endedAt: next.startedAt
      });
    }
    if (movementBoundariesShareAnchor(previous.endBoundary, next.startBoundary)) {
      return buildDerivedMovementGapSegment({
        id: `continued_stay_${previous.id}_${next.id}`,
        kind: "stay",
        origin: "repaired_gap",
        startedAt: previous.endedAt,
        endedAt: next.startedAt,
        displacementMeters:
          movementBoundaryDistanceMeters(previous.endBoundary, next.startBoundary) ?? 0,
        placeLabel:
          previous.endBoundary?.placeLabel ?? next.startBoundary?.placeLabel ?? null,
        startBoundary: previous.endBoundary,
        endBoundary: next.startBoundary
      });
    }
    const displacementMeters = movementBoundaryDistanceMeters(
      previous.endBoundary,
      next.startBoundary
    );
    if (gapSeconds < 5 * 60) {
      return buildDerivedMovementGapSegment({
        id: `repaired_stay_short_jump_${previous.id}_${next.id}`,
        kind: "stay",
        origin: "repaired_gap",
        startedAt: previous.endedAt,
        endedAt: next.startedAt,
        displacementMeters,
        placeLabel:
          previous.endBoundary?.placeLabel ?? next.startBoundary?.placeLabel ?? null,
        suppressedShortJump: true,
        startBoundary: previous.endBoundary,
        endBoundary: next.startBoundary
      });
    }
    if (displacementMeters === null || displacementMeters <= 100) {
      return buildDerivedMovementGapSegment({
        id: `repaired_stay_short_distance_${previous.id}_${next.id}`,
        kind: "stay",
        origin: "repaired_gap",
        startedAt: previous.endedAt,
        endedAt: next.startedAt,
        displacementMeters: displacementMeters ?? null,
        placeLabel:
          previous.endBoundary?.placeLabel ?? next.startBoundary?.placeLabel ?? null,
        startBoundary: previous.endBoundary,
        endBoundary: next.startBoundary
      });
    }
    return buildDerivedMovementGapSegment({
      id: `repaired_trip_${previous.id}_${next.id}`,
      kind: "trip",
      origin: "repaired_gap",
      startedAt: previous.endedAt,
      endedAt: next.startedAt,
      displacementMeters,
      placeLabel:
        next.startBoundary?.placeLabel ?? previous.endBoundary?.placeLabel ?? null,
      startBoundary: previous.endBoundary,
      endBoundary: next.startBoundary
    });
  };

  const coverage: MovementNormalizedGapSegment<T["payload"]>[] = [];
  if (sorted.length === 0 && options.rangeStart && options.rangeEnd) {
    const uncoveredSeconds = durationSeconds(options.rangeStart, options.rangeEnd);
    return [
      uncoveredSeconds > MISSING_MOVEMENT_DATA_THRESHOLD_SECONDS
        ? buildDerivedMovementGapSegment({
            id: `missing_${options.rangeStart}_${options.rangeEnd}`,
            kind: "missing",
            origin: "missing",
            startedAt: options.rangeStart,
            endedAt: options.rangeEnd
          })
        : buildDerivedMovementGapSegment({
            id: `empty_stay_${options.rangeStart}_${options.rangeEnd}`,
            kind: "stay",
            origin: "repaired_gap",
            startedAt: options.rangeStart,
            endedAt: options.rangeEnd
          })
    ];
  }

  if (options.rangeStart && sorted[0]) {
    const first = sorted[0];
    const leadingGapSeconds = durationSeconds(options.rangeStart, first.startedAt);
    if (leadingGapSeconds > 0) {
      coverage.push(
        leadingGapSeconds > MISSING_MOVEMENT_DATA_THRESHOLD_SECONDS
          ? buildDerivedMovementGapSegment({
              id: `missing_${options.rangeStart}_${first.startedAt}`,
              kind: "missing",
              origin: "missing",
              startedAt: options.rangeStart,
              endedAt: first.startedAt,
              placeLabel: first.startBoundary?.placeLabel ?? null,
              endBoundary: first.startBoundary
            })
          : buildDerivedMovementGapSegment({
              id: `leading_stay_${options.rangeStart}_${first.id}`,
              kind: "stay",
              origin: "repaired_gap",
              startedAt: options.rangeStart,
              endedAt: first.startedAt,
              placeLabel: first.startBoundary?.placeLabel ?? null,
              endBoundary: first.startBoundary
            })
      );
    }
  }

  for (const [index, segment] of sorted.entries()) {
    if (index > 0) {
      const derivedGap = classifyGap(sorted[index - 1]!, segment);
      if (derivedGap) {
        coverage.push(derivedGap);
      }
    }
    coverage.push(segment);
  }

  if (options.rangeEnd && sorted.length > 0) {
    const last = sorted[sorted.length - 1]!;
    const trailingGapSeconds = durationSeconds(last.endedAt, options.rangeEnd);
    if (trailingGapSeconds > 0) {
      if (trailingGapSeconds <= MISSING_MOVEMENT_DATA_THRESHOLD_SECONDS) {
        coverage.push(
          buildDerivedMovementGapSegment({
            id: `continued_stay_${last.id}_${options.rangeEnd}`,
            kind: "stay",
            origin: last.kind === "stay" ? "continued_stay" : "repaired_gap",
            startedAt: last.endedAt,
            endedAt: options.rangeEnd,
            displacementMeters: 0,
            placeLabel: last.endBoundary?.placeLabel ?? null,
            startBoundary: last.endBoundary,
            endBoundary: last.endBoundary
          })
        );
      } else {
        coverage.push(
          buildDerivedMovementGapSegment({
            id: `missing_${last.endedAt}_${options.rangeEnd}`,
            kind: "missing",
            origin: "missing",
            startedAt: last.endedAt,
            endedAt: options.rangeEnd,
            placeLabel: last.endBoundary?.placeLabel ?? null,
            startBoundary: last.endBoundary
          })
        );
      }
    }
  }

  return options.allowStayCoalescing === false
    ? coverage
    : coalesceMovementStayCoverageSegments(coverage);
}

type MovementProjectedBox = ReturnType<typeof mapMovementBoxRow>;

type MovementProjectedBoundary = {
  latitude: number | null;
  longitude: number | null;
  placeLabel: string | null;
  placeExternalUid: string | null;
};

function projectedBoundariesShareAnchor(
  left: MovementProjectedBoundary | null,
  right: MovementProjectedBoundary | null
) {
  if (!left || !right) {
    return false;
  }
  if (
    left.placeExternalUid &&
    right.placeExternalUid &&
    left.placeExternalUid === right.placeExternalUid
  ) {
    return true;
  }
  if (
    left.placeLabel &&
    right.placeLabel &&
    left.placeLabel.trim().length > 0 &&
    left.placeLabel === right.placeLabel
  ) {
    return true;
  }
  if (
    left.latitude == null ||
    left.longitude == null ||
    right.latitude == null ||
    right.longitude == null
  ) {
    return false;
  }
  return (
    haversineDistanceMeters(
      { latitude: left.latitude, longitude: left.longitude },
      { latitude: right.latitude, longitude: right.longitude }
    ) <= 100
  );
}

function projectedBoundaryDistanceMeters(
  left: MovementProjectedBoundary | null,
  right: MovementProjectedBoundary | null
) {
  if (!left || !right) {
    return null;
  }
  if (
    left.latitude == null ||
    left.longitude == null ||
    right.latitude == null ||
    right.longitude == null
  ) {
    return null;
  }
  return haversineDistanceMeters(
    { latitude: left.latitude, longitude: left.longitude },
    { latitude: right.latitude, longitude: right.longitude }
  );
}

function mergeProjectedBoxArrays(left: string[], right: string[]) {
  return uniqStrings([...left, ...right]);
}

function ensureProjectedMovementBoxCoverage(
  segments: MovementProjectedBox[],
  options: {
    rangeStart?: string;
    rangeEnd?: string;
    resolveBoundary: (
      segment: MovementProjectedBox,
      kind: "start" | "end"
    ) => MovementProjectedBoundary | null;
  }
) {
  const sorted = [...segments].sort(
    (left, right) =>
      left.startedAt.localeCompare(right.startedAt) ||
      left.endedAt.localeCompare(right.endedAt) ||
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id)
  );

  const deriveGapSegment = (
    startedAt: string,
    endedAt: string,
    previous: MovementProjectedBox | null,
    next: MovementProjectedBox | null
  ): MovementProjectedBox | null => {
    const gapSeconds = durationSeconds(startedAt, endedAt);
    if (gapSeconds <= 0) {
      return null;
    }
    const previousBoundary = previous
      ? options.resolveBoundary(previous, "end")
      : null;
    const nextBoundary = next ? options.resolveBoundary(next, "start") : null;
    if (gapSeconds > MISSING_MOVEMENT_DATA_THRESHOLD_SECONDS) {
      return {
        id: `projected_missing_${startedAt}_${endedAt}`,
        boxId: `projected_missing_${startedAt}_${endedAt}`,
        kind: "missing",
        sourceKind: "automatic",
        origin: "missing",
        editable: false,
        startedAt,
        endedAt,
        trueStartedAt: startedAt,
        trueEndedAt: endedAt,
        visibleStartedAt: startedAt,
        visibleEndedAt: endedAt,
        durationSeconds: gapSeconds,
        title: "Missing data",
        subtitle: "No trusted movement signal for this period.",
        placeLabel:
          previousBoundary?.placeLabel ?? nextBoundary?.placeLabel ?? null,
        tags: ["missing-data"],
        distanceMeters: null,
        averageSpeedMps: null,
        overrideCount: 0,
        overriddenAutomaticBoxIds: [],
        overriddenUserBoxIds: [],
        isFullyHidden: false,
        rawStayIds: [],
        rawTripIds: [],
        rawPointCount: 0,
        hasLegacyCorrections: false,
        metadata: { syncSource: "automatic" }
      };
    }
    if (projectedBoundariesShareAnchor(previousBoundary, nextBoundary)) {
      return {
        id: `projected_continued_stay_${startedAt}_${endedAt}`,
        boxId: `projected_continued_stay_${startedAt}_${endedAt}`,
        kind: "stay",
        sourceKind: "automatic",
        origin:
          previous?.kind === "stay" || next?.kind === "stay"
            ? "continued_stay"
            : "repaired_gap",
        editable: false,
        startedAt,
        endedAt,
        trueStartedAt: startedAt,
        trueEndedAt: endedAt,
        visibleStartedAt: startedAt,
        visibleEndedAt: endedAt,
        durationSeconds: gapSeconds,
        title:
          previousBoundary?.placeLabel ??
          nextBoundary?.placeLabel ??
          "Continued stay",
        subtitle: "Short stationary gap carried forward into one continuous stay.",
        placeLabel:
          previousBoundary?.placeLabel ?? nextBoundary?.placeLabel ?? null,
        tags: ["continued_stay"],
        distanceMeters: null,
        averageSpeedMps: null,
        overrideCount: 0,
        overriddenAutomaticBoxIds: [],
        overriddenUserBoxIds: [],
        isFullyHidden: false,
        rawStayIds: [],
        rawTripIds: [],
        rawPointCount: 0,
        hasLegacyCorrections: false,
        metadata: { syncSource: "automatic" }
      };
    }
    const displacementMeters = projectedBoundaryDistanceMeters(
      previousBoundary,
      nextBoundary
    );
    if (gapSeconds < 5 * 60 || displacementMeters == null || displacementMeters <= 100) {
      return {
        id: `projected_repaired_stay_${startedAt}_${endedAt}`,
        boxId: `projected_repaired_stay_${startedAt}_${endedAt}`,
        kind: "stay",
        sourceKind: "automatic",
        origin: "repaired_gap",
        editable: false,
        startedAt,
        endedAt,
        trueStartedAt: startedAt,
        trueEndedAt: endedAt,
        visibleStartedAt: startedAt,
        visibleEndedAt: endedAt,
        durationSeconds: gapSeconds,
        title:
          previousBoundary?.placeLabel ??
          nextBoundary?.placeLabel ??
          "Repaired stay",
        subtitle:
          gapSeconds < 5 * 60
            ? "Short jump under five minutes suppressed into stay continuity."
            : "Short gap repaired as a stay between known anchors.",
        placeLabel:
          previousBoundary?.placeLabel ?? nextBoundary?.placeLabel ?? null,
        tags:
          gapSeconds < 5 * 60
            ? ["repaired_gap", "suppressed-short-jump"]
            : ["repaired_gap"],
        distanceMeters: null,
        averageSpeedMps: null,
        overrideCount: 0,
        overriddenAutomaticBoxIds: [],
        overriddenUserBoxIds: [],
        isFullyHidden: false,
        rawStayIds: [],
        rawTripIds: [],
        rawPointCount: 0,
        hasLegacyCorrections: false,
        metadata: { syncSource: "automatic" }
      };
    }
    return {
      id: `projected_repaired_trip_${startedAt}_${endedAt}`,
      boxId: `projected_repaired_trip_${startedAt}_${endedAt}`,
      kind: "trip",
      sourceKind: "automatic",
      origin: "repaired_gap",
      editable: false,
      startedAt,
      endedAt,
      trueStartedAt: startedAt,
      trueEndedAt: endedAt,
      visibleStartedAt: startedAt,
      visibleEndedAt: endedAt,
      durationSeconds: gapSeconds,
      title:
        nextBoundary?.placeLabel ??
        previousBoundary?.placeLabel ??
        "Repaired move",
      subtitle: "Short gap repaired as a move between known anchors.",
      placeLabel:
        nextBoundary?.placeLabel ?? previousBoundary?.placeLabel ?? null,
      tags: ["repaired_gap"],
      distanceMeters: displacementMeters,
      averageSpeedMps: displacementMeters / Math.max(1, gapSeconds),
      overrideCount: 0,
      overriddenAutomaticBoxIds: [],
      overriddenUserBoxIds: [],
      isFullyHidden: false,
      rawStayIds: [],
      rawTripIds: [],
      rawPointCount: 0,
      hasLegacyCorrections: false,
      metadata: { syncSource: "automatic" }
    };
  };

  const withCoverage: MovementProjectedBox[] = [];

  if (options.rangeStart) {
    const first = sorted[0] ?? null;
    const leading = deriveGapSegment(
      options.rangeStart,
      first?.startedAt ?? options.rangeEnd ?? options.rangeStart,
      null,
      first
    );
    if (leading) {
      withCoverage.push(leading);
    }
  }

  for (const [index, segment] of sorted.entries()) {
    if (index > 0) {
      const previous = sorted[index - 1]!;
      const derived = deriveGapSegment(previous.endedAt, segment.startedAt, previous, segment);
      if (derived) {
        withCoverage.push(derived);
      }
    }
    withCoverage.push(segment);
  }

  if (options.rangeEnd) {
    const last = sorted[sorted.length - 1] ?? null;
    const trailing = deriveGapSegment(
      last?.endedAt ?? options.rangeStart ?? options.rangeEnd,
      options.rangeEnd,
      last,
      null
    );
    if (trailing) {
      withCoverage.push(trailing);
    }
  }

  const coalesced: MovementProjectedBox[] = [];
  for (const segment of withCoverage) {
    const previous = coalesced[coalesced.length - 1];
    const shouldMerge =
      previous &&
      previous.kind === "stay" &&
      segment.kind === "stay" &&
      previous.sourceKind === "automatic" &&
      segment.sourceKind === "automatic" &&
      previous.endedAt === segment.startedAt &&
      projectedBoundariesShareAnchor(
        options.resolveBoundary(previous, "end"),
        options.resolveBoundary(segment, "start")
      );
    if (!shouldMerge || !previous) {
      coalesced.push(segment);
      continue;
    }
    coalesced[coalesced.length - 1] = {
      ...previous,
      id: `projected_coalesced_${previous.id}_${segment.id}`,
      boxId: previous.boxId,
      origin:
        previous.origin === "continued_stay" || segment.origin === "continued_stay"
          ? "continued_stay"
          : previous.origin === "repaired_gap" || segment.origin === "repaired_gap"
            ? "repaired_gap"
            : previous.origin,
      endedAt: segment.endedAt,
      visibleEndedAt: segment.endedAt,
      durationSeconds: durationSeconds(previous.startedAt, segment.endedAt),
      title: previous.title || segment.title,
      subtitle:
        previous.origin === "continued_stay" || segment.origin === "continued_stay"
          ? "Short stationary gap carried forward into one continuous stay."
          : previous.subtitle,
      placeLabel: previous.placeLabel ?? segment.placeLabel ?? null,
      tags: mergeProjectedBoxArrays(previous.tags, segment.tags),
      overrideCount: previous.overrideCount + segment.overrideCount,
      overriddenAutomaticBoxIds: mergeProjectedBoxArrays(
        previous.overriddenAutomaticBoxIds,
        segment.overriddenAutomaticBoxIds
      ),
      overriddenUserBoxIds: mergeProjectedBoxArrays(
        previous.overriddenUserBoxIds,
        segment.overriddenUserBoxIds
      ),
      isFullyHidden: false,
      rawStayIds: mergeProjectedBoxArrays(previous.rawStayIds, segment.rawStayIds),
      rawTripIds: mergeProjectedBoxArrays(previous.rawTripIds, segment.rawTripIds),
      rawPointCount: previous.rawPointCount + segment.rawPointCount,
      hasLegacyCorrections:
        previous.hasLegacyCorrections || segment.hasLegacyCorrections,
      metadata: {
        ...previous.metadata,
        coalescedSegmentIds: [
          ...(Array.isArray(previous.metadata.coalescedSegmentIds)
            ? (previous.metadata.coalescedSegmentIds as unknown[])
            : [previous.id]),
          ...(Array.isArray(segment.metadata.coalescedSegmentIds)
            ? (segment.metadata.coalescedSegmentIds as unknown[])
            : [segment.id])
        ]
      }
    };
  }

  return coalesced.sort(
    (left, right) =>
      left.startedAt.localeCompare(right.startedAt) ||
      left.endedAt.localeCompare(right.endedAt) ||
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id)
  );
}

function movementBoxOverlapsRange(
  row: MovementBoxRow,
  startedAt: string,
  endedAt: string
) {
  const rowStartedAt = row.true_started_at ?? row.started_at;
  const rowEndedAt = row.true_ended_at ?? row.ended_at;
  return rowStartedAt < endedAt && rowEndedAt > startedAt;
}

function mergeMovementOverrideRanges(ranges: MovementBoxOverrideRange[]) {
  const sorted = [...ranges]
    .filter((range) => range.startedAt < range.endedAt)
    .sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) ||
        left.endedAt.localeCompare(right.endedAt)
    );
  const merged: MovementBoxOverrideRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.startedAt > previous.endedAt) {
      merged.push({ ...range });
      continue;
    }
    previous.endedAt =
      range.endedAt > previous.endedAt ? range.endedAt : previous.endedAt;
  }
  return merged;
}

function subtractMovementOverrideRanges(
  startedAt: string,
  endedAt: string,
  ranges: MovementBoxOverrideRange[]
) {
  let fragments = [{ startedAt, endedAt }];
  for (const range of mergeMovementOverrideRanges(ranges)) {
    fragments = fragments.flatMap((fragment) => {
      if (range.startedAt >= fragment.endedAt || range.endedAt <= fragment.startedAt) {
        return [fragment];
      }
      const nextFragments: Array<{ startedAt: string; endedAt: string }> = [];
      if (fragment.startedAt < range.startedAt) {
        nextFragments.push({
          startedAt: fragment.startedAt,
          endedAt: range.startedAt
        });
      }
      if (fragment.endedAt > range.endedAt) {
        nextFragments.push({
          startedAt: range.endedAt,
          endedAt: fragment.endedAt
        });
      }
      return nextFragments;
    });
  }
  return fragments.filter((fragment) => fragment.startedAt < fragment.endedAt);
}

function updateMovementBoxOverrideState(
  id: string,
  input: {
    overrideCount: number;
    overriddenAutomaticBoxIds: string[];
    overriddenUserBoxIds: string[];
    trueStartedAt: string;
    trueEndedAt: string;
    overriddenStartedAt: string | null;
    overriddenEndedAt: string | null;
    overriddenByBoxId: string | null;
    overrideRanges: MovementBoxOverrideRange[];
    isOverridden: boolean;
    isFullyHidden: boolean;
  }
) {
  getDatabase()
    .prepare(
      `UPDATE movement_boxes
       SET override_count = ?,
           overridden_automatic_box_ids_json = ?,
           true_started_at = ?,
           true_ended_at = ?,
           overridden_started_at = ?,
           overridden_ended_at = ?,
           overridden_by_box_id = ?,
           overridden_user_box_ids_json = ?,
           override_ranges_json = ?,
           is_overridden = ?,
           is_fully_hidden = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      input.overrideCount,
      JSON.stringify(input.overriddenAutomaticBoxIds),
      input.trueStartedAt,
      input.trueEndedAt,
      input.overriddenStartedAt,
      input.overriddenEndedAt,
      input.overriddenByBoxId,
      JSON.stringify(input.overriddenUserBoxIds),
      JSON.stringify(input.overrideRanges),
      input.isOverridden ? 1 : 0,
      input.isFullyHidden ? 1 : 0,
      nowIso(),
      id
    );
}

function recomputeMovementBoxOverrideState(userId: string) {
  const rows = listMovementBoxRows({ userIds: [userId] });
  const automaticRows = rows.filter((row) => row.source_kind === "automatic");
  const userRows = rows.filter((row) => row.source_kind === "user_defined");
  const orderedUserRows = [...userRows].sort(
    (left, right) =>
      right.updated_at.localeCompare(left.updated_at) ||
      right.created_at.localeCompare(left.created_at) ||
      right.id.localeCompare(left.id)
  );
  const newerRows: MovementBoxRow[] = [];

  for (const row of automaticRows) {
    updateMovementBoxOverrideState(row.id, {
      overrideCount: 0,
      overriddenAutomaticBoxIds: [],
      overriddenUserBoxIds: [],
      trueStartedAt: row.started_at,
      trueEndedAt: row.ended_at,
      overriddenStartedAt: null,
      overriddenEndedAt: null,
      overriddenByBoxId: null,
      overrideRanges: [],
      isOverridden: false,
      isFullyHidden: false
    });
  }

  for (const row of orderedUserRows) {
    const trueStartedAt = row.started_at;
    const trueEndedAt = row.ended_at;
    const overlappingAutomaticBoxIds = automaticRows
      .filter((automatic) => movementBoxOverlapsRange(automatic, trueStartedAt, trueEndedAt))
      .map((automatic) => automatic.id);
    const overridingRows = newerRows.filter((candidate) =>
      movementBoxOverlapsRange(candidate, trueStartedAt, trueEndedAt)
    );
    const overrideRanges = mergeMovementOverrideRanges(
      overridingRows.map((candidate) => ({
        startedAt:
          (candidate.true_started_at ?? candidate.started_at) > trueStartedAt
            ? (candidate.true_started_at ?? candidate.started_at)
            : trueStartedAt,
        endedAt:
          (candidate.true_ended_at ?? candidate.ended_at) < trueEndedAt
            ? (candidate.true_ended_at ?? candidate.ended_at)
            : trueEndedAt
      }))
    );
    const visibleFragments = subtractMovementOverrideRanges(
      trueStartedAt,
      trueEndedAt,
      overrideRanges
    );
    updateMovementBoxOverrideState(row.id, {
      overrideCount:
        overlappingAutomaticBoxIds.length + overridingRows.length,
      overriddenAutomaticBoxIds: overlappingAutomaticBoxIds,
      overriddenUserBoxIds: overridingRows.map((candidate) => candidate.id),
      trueStartedAt,
      trueEndedAt,
      overriddenStartedAt: overrideRanges[0]?.startedAt ?? null,
      overriddenEndedAt:
        overrideRanges.length > 0
          ? overrideRanges[overrideRanges.length - 1]!.endedAt
          : null,
      overriddenByBoxId: overridingRows[0]?.id ?? null,
      overrideRanges,
      isOverridden: overrideRanges.length > 0,
      isFullyHidden: visibleFragments.length === 0
    });
    newerRows.push(row);
  }
}

function assertMovementUserBoxDoesNotOverlap(input: {
  userId: string;
  startedAt: string;
  endedAt: string;
  excludeId?: string;
}) {
  const overlapping = listMovementBoxRows({
    userIds: [input.userId],
    sourceKinds: ["user_defined"]
  }).find((row) => {
    if (input.excludeId && row.id === input.excludeId) {
      return false;
    }
    return movementBoxOverlapsRange(row, input.startedAt, input.endedAt);
  });
  if (overlapping) {
    throw new HttpError(
      409,
      "movement_user_box_overlap",
      "Manual movement boxes cannot overlap each other."
    );
  }
}

function legacyTripHasCorrections(userId: string, tripExternalUid: string) {
  return (
    listMovementTripTombstones(userId).some(
      (row) => row.trip_external_uid === tripExternalUid
    ) ||
    listMovementTripOverrides(userId).some(
      (row) => row.trip_external_uid === tripExternalUid
    ) ||
    listMovementTripPointTombstones(userId, tripExternalUid).length > 0 ||
    listMovementTripPointOverrides(userId, tripExternalUid).length > 0
  );
}

function legacyStayHasCorrections(userId: string, stayExternalUid: string) {
  return (
    listMovementStayTombstones(userId).some(
      (row) => row.stay_external_uid === stayExternalUid
    ) ||
    listMovementStayOverrides(userId).some(
      (row) => row.stay_external_uid === stayExternalUid
    )
  );
}

function migrateLegacyMovementCorrectionsToUserBoxes(userId: string) {
  const placeRows = listMovementPlaceRows([userId]);
  const placesById = new Map(placeRows.map((row) => {
    const mapped = mapMovementPlace(row);
    return [mapped.id, mapped] as const;
  }));
  const stayRows = listMovementStayRows([userId]);
  const tripRows = listMovementTripRows([userId]);
  const tripIds = tripRows.map((row) => row.id);
  const pointsByTrip = new Map<string, MovementTripPointRow[]>();
  listTripPoints(tripIds).forEach((point) => {
    pointsByTrip.set(point.trip_id, [...(pointsByTrip.get(point.trip_id) ?? []), point]);
  });
  const stopsByTrip = new Map<string, MovementTripStopRow[]>();
  listTripStops(tripIds).forEach((stop) => {
    stopsByTrip.set(stop.trip_id, [...(stopsByTrip.get(stop.trip_id) ?? []), stop]);
  });
  const stayByExternalUid = new Map(stayRows.map((row) => [row.external_uid, row] as const));
  const tripByExternalUid = new Map(tripRows.map((row) => [row.external_uid, row] as const));

  for (const row of listMovementStayTombstones(userId)) {
    const stayRow = stayByExternalUid.get(row.stay_external_uid);
    if (!stayRow) {
      continue;
    }
    const stay = mapMovementStay(stayRow, placesById);
    insertMovementBox({
      userId,
      kind: "missing",
      sourceKind: "user_defined",
      origin: "user_invalidated",
      startedAt: stay.startedAt,
      endedAt: stay.endedAt,
      title: "User invalidated stay",
      subtitle: `Replaces ${stay.place?.label ?? stay.label ?? "the automatic stay"} with missing data.`,
      editable: true,
      tags: ["user-invalidated", "legacy-migration"],
      legacyOriginKey: `stay-tombstone:${row.stay_external_uid}`,
      metadata: {
        migratedFrom: "movement_stay_tombstones",
        stayExternalUid: row.stay_external_uid
      }
    });
  }

  for (const row of listMovementTripTombstones(userId)) {
    const tripRow = tripByExternalUid.get(row.trip_external_uid);
    if (!tripRow) {
      continue;
    }
    const trip = mapMovementTrip(
      tripRow,
      placesById,
      pointsByTrip.get(tripRow.id) ?? [],
      stopsByTrip.get(tripRow.id) ?? []
    );
    insertMovementBox({
      userId,
      kind: "missing",
      sourceKind: "user_defined",
      origin: "user_invalidated",
      startedAt: trip.startedAt,
      endedAt: trip.endedAt,
      title: "User invalidated move",
      subtitle: `Replaces ${trip.label || "the automatic move"} with missing data.`,
      editable: true,
      tags: ["user-invalidated", "legacy-migration"],
      legacyOriginKey: `trip-tombstone:${row.trip_external_uid}`,
      metadata: {
        migratedFrom: "movement_trip_tombstones",
        tripExternalUid: row.trip_external_uid
      }
    });
  }

  for (const row of listMovementStayOverrides(userId)) {
    const stayRow = stayByExternalUid.get(row.stay_external_uid);
    if (!stayRow) {
      continue;
    }
    const stay = mapMovementStay(stayRow, placesById);
    const patch = safeJsonParse<Partial<z.infer<typeof movementStayPatchSchema>>>(row.stay_json, {});
    insertMovementBox({
      userId,
      kind: "stay",
      sourceKind: "user_defined",
      origin: "user_defined",
      startedAt: patch.startedAt ?? stay.startedAt,
      endedAt: patch.endedAt ?? stay.endedAt,
      title: patch.placeLabel ?? patch.label ?? stay.place?.label ?? stay.label ?? "Manual stay",
      subtitle: "Migrated user-defined stay correction.",
      placeLabel: patch.placeLabel ?? stay.place?.label ?? stay.label ?? null,
      anchorExternalUid: patch.placeExternalUid ?? stay.place?.externalUid ?? null,
      tags: patch.tags ?? stay.tags,
      editable: true,
      legacyOriginKey: `stay-override:${row.stay_external_uid}`,
      metadata: {
        migratedFrom: "movement_stay_overrides",
        stayExternalUid: row.stay_external_uid
      }
    });
  }

  for (const row of listMovementTripOverrides(userId)) {
    const tripRow = tripByExternalUid.get(row.trip_external_uid);
    if (!tripRow) {
      continue;
    }
    const trip = mapMovementTrip(
      tripRow,
      placesById,
      pointsByTrip.get(tripRow.id) ?? [],
      stopsByTrip.get(tripRow.id) ?? []
    );
    const patch = safeJsonParse<Partial<z.infer<typeof movementTripPatchSchema>>>(row.trip_json, {});
    insertMovementBox({
      userId,
      kind: "trip",
      sourceKind: "user_defined",
      origin: "user_defined",
      startedAt: patch.startedAt ?? trip.startedAt,
      endedAt: patch.endedAt ?? trip.endedAt,
      title:
        patch.label ??
        trip.label ??
        `${trip.startPlace?.label ?? "Unknown"} → ${trip.endPlace?.label ?? "Unknown"}`,
      subtitle: "Migrated user-defined move correction.",
      placeLabel: trip.endPlace?.label ?? trip.startPlace?.label ?? null,
      tags: patch.tags ?? trip.tags,
      distanceMeters: patch.distanceMeters ?? trip.distanceMeters,
      averageSpeedMps: patch.averageSpeedMps ?? trip.averageSpeedMps ?? null,
      editable: true,
      legacyOriginKey: `trip-override:${row.trip_external_uid}`,
      metadata: {
        migratedFrom: "movement_trip_overrides",
        tripExternalUid: row.trip_external_uid
      }
    });
  }
}

function rebuildAutomaticMovementBoxes(userId: string) {
  migrateLegacyMovementCorrectionsToUserBoxes(userId);
  reconcileMovementOverlapValidation(userId);
  const placeRows = listMovementPlaceRows([userId]);
  const placesById = new Map(placeRows.map((row) => {
    const mapped = mapMovementPlace(row);
    return [mapped.id, mapped] as const;
  }));
  const stayRows = listMovementStayRows([userId]);
  const tripRows = listMovementTripRows([userId]);
  const tripIds = tripRows.map((row) => row.id);
  const pointsByTrip = new Map<string, MovementTripPointRow[]>();
  listTripPoints(tripIds).forEach((point) => {
    pointsByTrip.set(point.trip_id, [...(pointsByTrip.get(point.trip_id) ?? []), point]);
  });
  const stopsByTrip = new Map<string, MovementTripStopRow[]>();
  listTripStops(tripIds).forEach((stop) => {
    stopsByTrip.set(stop.trip_id, [...(stopsByTrip.get(stop.trip_id) ?? []), stop]);
  });

  const rawSegments = [
    ...stayRows.map((row) => {
      const stay = mapMovementStay(row, placesById);
      return {
        id: row.id,
        kind: "stay" as const,
        startedAt: stay.startedAt,
        endedAt: stay.endedAt,
        payload: stay,
        startBoundary: {
          latitude: stay.centerLatitude,
          longitude: stay.centerLongitude,
          placeLabel: stay.place?.label ?? stay.label ?? null,
          placeExternalUid: stay.place?.externalUid ?? null
        },
        endBoundary: {
          latitude: stay.centerLatitude,
          longitude: stay.centerLongitude,
          placeLabel: stay.place?.label ?? stay.label ?? null,
          placeExternalUid: stay.place?.externalUid ?? null
        }
      };
    }),
    ...tripRows.map((row) => {
      const trip = mapMovementTrip(
        row,
        placesById,
        pointsByTrip.get(row.id) ?? [],
        stopsByTrip.get(row.id) ?? []
      );
      return {
        id: row.id,
        kind: "trip" as const,
        startedAt: trip.startedAt,
        endedAt: trip.endedAt,
        payload: trip,
        startBoundary:
          trip.points[0] || trip.startPlace
            ? {
                latitude: trip.points[0]?.latitude ?? trip.startPlace?.latitude ?? 0,
                longitude: trip.points[0]?.longitude ?? trip.startPlace?.longitude ?? 0,
                placeLabel: trip.startPlace?.label ?? null,
                placeExternalUid: trip.startPlace?.externalUid ?? null
              }
            : null,
        endBoundary:
          trip.points[trip.points.length - 1] || trip.endPlace
            ? {
                latitude:
                  trip.points[trip.points.length - 1]?.latitude ??
                  trip.endPlace?.latitude ??
                  0,
                longitude:
                  trip.points[trip.points.length - 1]?.longitude ??
                  trip.endPlace?.longitude ??
                  0,
                placeLabel: trip.endPlace?.label ?? null,
                placeExternalUid: trip.endPlace?.externalUid ?? null
              }
            : null
      };
    })
  ]
    .filter((segment) =>
      segment.kind === "stay"
        ? !hasInvalidMovementRecord(segment.payload.metadata)
        : !hasInvalidMovementRecord(segment.payload.metadata)
    )
    .sort((left, right) =>
      left.startedAt.localeCompare(right.startedAt) ||
      left.endedAt.localeCompare(right.endedAt)
    );

  const automaticSegments = normalizeMovementCoverageSegments(rawSegments, {
    rangeEnd: nowIso()
  });

  getDatabase()
    .prepare(
      `DELETE FROM movement_boxes
       WHERE user_id = ?
         AND source_kind = 'automatic'`
    )
    .run(userId);

  for (const segment of automaticSegments) {
    if (segment.durationSeconds <= 0) {
      continue;
    }
    if (segment.kind === "stay" && segment.payload) {
      const stay = segment.payload;
      const rawStayId = stay.id;
      insertMovementBox({
        id: `mba_${rawStayId}`,
        userId,
        kind: "stay",
        sourceKind: "automatic",
        origin: segment.origin,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        title: stay.place?.label ?? stay.label ?? "Stay",
        subtitle:
          stay.place?.categoryTags.join(" · ") ||
          (stay.classification === "stationary" ? "Stationary" : stay.classification),
        placeLabel: stay.place?.label ?? stay.label ?? null,
        anchorExternalUid: stay.place?.externalUid ?? null,
        tags: uniqStrings([
          ...(stay.place?.categoryTags ?? []),
          ...(Array.isArray((stay.metrics as Record<string, unknown>).tags)
            ? (((stay.metrics as Record<string, unknown>).tags as string[]) ?? [])
            : [])
        ]),
        editable: false,
        rawStayIds: [rawStayId],
        hasLegacyCorrections: legacyStayHasCorrections(userId, stay.externalUid),
        metadata: {
          syncSource: stay.pairingSessionId ? "companion" : "forge"
        }
      });
      continue;
    }
    if (segment.kind === "trip" && segment.payload) {
      const trip = segment.payload;
      insertMovementBox({
        id: `mba_${trip.id}`,
        userId,
        kind: "trip",
        sourceKind: "automatic",
        origin: segment.origin,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        title:
          trip.label ||
          `${trip.startPlace?.label ?? "Unknown"} → ${trip.endPlace?.label ?? "Unknown"}`,
        subtitle: `${round(trip.distanceMeters / 1000, 1)} km · ${trip.activityType || trip.travelMode}`,
        placeLabel: trip.endPlace?.label ?? trip.startPlace?.label ?? null,
        tags: uniqStrings([
          ...trip.tags,
          ...(trip.startPlace?.categoryTags ?? []),
          ...(trip.endPlace?.categoryTags ?? [])
        ]),
        distanceMeters: trip.distanceMeters,
        averageSpeedMps: trip.averageSpeedMps ?? null,
        editable: false,
        rawTripIds: [trip.id],
        rawPointCount: trip.points.length,
        hasLegacyCorrections: legacyTripHasCorrections(userId, trip.externalUid),
        metadata: {
          syncSource: trip.pairingSessionId ? "companion" : "forge"
        }
      });
      continue;
    }
    insertMovementBox({
      id: `mba_${segment.id}`,
      userId,
      kind: segment.kind,
      sourceKind: "automatic",
      origin: segment.origin,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      title:
        segment.kind === "missing"
          ? "Missing data"
          : segment.origin === "continued_stay"
            ? segment.placeLabel ?? "Continued stay"
            : segment.kind === "stay"
              ? segment.placeLabel ?? "Repaired stay"
              : segment.placeLabel ?? "Repaired move",
      subtitle:
        segment.kind === "missing"
          ? "No trusted movement signal for this period."
          : segment.kind === "stay"
            ? segment.origin === "continued_stay"
              ? "Short stationary gap carried forward into one continuous stay."
              : segment.suppressedShortJump
                ? "Short jump under five minutes suppressed into stay continuity."
                : "Short gap repaired as a stay between known anchors."
            : "Short gap repaired as a move between known anchors.",
      placeLabel: segment.placeLabel ?? null,
      anchorExternalUid:
        segment.startBoundary?.placeExternalUid ??
        segment.endBoundary?.placeExternalUid ??
        null,
      tags: uniqStrings([
        segment.origin,
        ...(segment.suppressedShortJump ? ["suppressed-short-jump"] : []),
        ...(segment.kind === "missing" ? ["missing-data"] : [])
      ]),
      distanceMeters: segment.kind === "trip" ? segment.displacementMeters ?? null : null,
      averageSpeedMps:
        segment.kind === "trip" && segment.displacementMeters != null
          ? segment.displacementMeters / Math.max(1, segment.durationSeconds)
          : null,
      editable: false,
      metadata: {
        syncSource: "automatic"
      }
    });
  }
  recomputeMovementBoxOverrideState(userId);
}

function ensureAutomaticMovementBoxes(userIds: string[]) {
  for (const userId of userIds) {
    migrateLegacyMovementCorrectionsToUserBoxes(userId);
    const hasAutomatic = listMovementBoxRows({
      userIds: [userId],
      sourceKinds: ["automatic"]
    }).length > 0;
    if (!hasAutomatic) {
      rebuildAutomaticMovementBoxes(userId);
    }
  }
}

function projectMovementBoxes(input: {
  userIds: string[];
  rangeStart?: string;
  rangeEnd?: string;
}) {
  ensureAutomaticMovementBoxes(input.userIds);
  input.userIds.forEach(recomputeMovementBoxOverrideState);
  const placeRows = listMovementPlaceRows(input.userIds);
  const placesById = new Map(
    placeRows
      .map((row) => mapMovementPlace(row))
      .map((place) => [place.id, place] as const)
  );
  const placesByExternalUid = new Map(
    placeRows
      .map((row) => mapMovementPlace(row))
      .map((place) => [place.externalUid, place] as const)
  );
  const stayRows = listMovementStayRows(input.userIds);
  const rawStayById = new Map(
    stayRows.map((row) => [row.id, row] as const)
  );
  const tripRows = listMovementTripRows(input.userIds);
  const tripIds = tripRows.map((row) => row.id);
  const pointsByTrip = new Map<string, MovementTripPointRow[]>();
  listTripPoints(tripIds).forEach((point) => {
    pointsByTrip.set(point.trip_id, [...(pointsByTrip.get(point.trip_id) ?? []), point]);
  });
  const rawTripById = new Map(
    tripRows.map((row) => [row.id, row] as const)
  );
  const allRows = listMovementBoxRows({ userIds: input.userIds });
  const inRange = allRows.filter((row) => {
    const rowStartedAt = row.true_started_at ?? row.started_at;
    const rowEndedAt = row.true_ended_at ?? row.ended_at;
    if (input.rangeStart && rowEndedAt <= input.rangeStart) {
      return false;
    }
    if (input.rangeEnd && rowStartedAt >= input.rangeEnd) {
      return false;
    }
    return true;
  });
  const automaticRows = inRange.filter((row) => row.source_kind === "automatic");
  const userRows = inRange.filter((row) => row.source_kind === "user_defined");
  const projectedAutomatic: MovementProjectedBox[] = [];
  const userProjected = userRows.flatMap((row) => {
    const base = mapMovementBoxRow(row);
    const trueStartedAt = base.trueStartedAt;
    const trueEndedAt = base.trueEndedAt;
    const fragments = subtractMovementOverrideRanges(
      trueStartedAt,
      trueEndedAt,
      movementBoxOverrideRanges(row)
    );
    return fragments.map((fragment, index) => ({
      ...base,
      id:
        fragments.length === 1
          ? row.id
          : `${row.id}::fragment:${index}`,
      startedAt: fragment.startedAt,
      endedAt: fragment.endedAt,
      visibleStartedAt: fragment.startedAt,
      visibleEndedAt: fragment.endedAt,
      durationSeconds: durationSeconds(fragment.startedAt, fragment.endedAt),
      metadata: {
        ...base.metadata,
        projectedFromBoxId: row.id,
        projectedFragmentIndex: index
      }
    }));
  });

  for (const automatic of automaticRows) {
    let fragments = [
      {
        startedAt: automatic.true_started_at ?? automatic.started_at,
        endedAt: automatic.true_ended_at ?? automatic.ended_at
      }
    ];
    const overlappingUsers = userRows.filter((user) =>
      movementBoxOverlapsRange(
        user,
        automatic.true_started_at ?? automatic.started_at,
        automatic.true_ended_at ?? automatic.ended_at
      )
    );
    for (const user of overlappingUsers) {
      const userStartedAt = user.true_started_at ?? user.started_at;
      const userEndedAt = user.true_ended_at ?? user.ended_at;
      fragments = fragments.flatMap((fragment) => {
        if (userStartedAt >= fragment.endedAt || userEndedAt <= fragment.startedAt) {
          return [fragment];
        }
        const nextFragments: typeof fragments = [];
        if (fragment.startedAt < userStartedAt) {
          nextFragments.push({
            startedAt: fragment.startedAt,
            endedAt: userStartedAt
          });
        }
        if (fragment.endedAt > userEndedAt) {
          nextFragments.push({
            startedAt: userEndedAt,
            endedAt: fragment.endedAt
          });
        }
        return nextFragments;
      });
    }
    for (const [index, fragment] of fragments.entries()) {
      if (durationSeconds(fragment.startedAt, fragment.endedAt) <= 0) {
        continue;
      }
      projectedAutomatic.push({
        ...mapMovementBoxRow(automatic),
        id:
          fragment.startedAt === (automatic.true_started_at ?? automatic.started_at) &&
          fragment.endedAt === (automatic.true_ended_at ?? automatic.ended_at)
            ? automatic.id
            : `${automatic.id}::fragment:${index}`,
        startedAt: fragment.startedAt,
        endedAt: fragment.endedAt,
        visibleStartedAt: fragment.startedAt,
        visibleEndedAt: fragment.endedAt,
        durationSeconds: durationSeconds(fragment.startedAt, fragment.endedAt)
      });
    }
  }

  const projected = [...projectedAutomatic, ...userProjected]
    .map((segment) => {
      const startedAt =
        input.rangeStart && segment.startedAt < input.rangeStart
          ? input.rangeStart
          : segment.startedAt;
      const endedAt =
        input.rangeEnd && segment.endedAt > input.rangeEnd
          ? input.rangeEnd
          : segment.endedAt;
      return {
        ...segment,
        startedAt,
        endedAt,
        visibleStartedAt: startedAt,
        visibleEndedAt: endedAt,
        durationSeconds: durationSeconds(startedAt, endedAt)
      };
    })
    .filter((segment) => segment.durationSeconds > 0)
    .sort((left, right) =>
      left.startedAt.localeCompare(right.startedAt) ||
      left.endedAt.localeCompare(right.endedAt) ||
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id)
    );

  return ensureProjectedMovementBoxCoverage(projected, {
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    resolveBoundary: (segment, kind) => {
      const rawStayId = segment.rawStayIds[0] ?? null;
      if (rawStayId) {
        const rawStay = rawStayById.get(rawStayId);
        if (rawStay) {
          const mappedPlace =
            rawStay.place_id != null ? placesById.get(rawStay.place_id) ?? null : null;
          return {
            latitude: rawStay.center_latitude,
            longitude: rawStay.center_longitude,
            placeLabel: mappedPlace?.label ?? segment.placeLabel ?? null,
            placeExternalUid: mappedPlace?.externalUid ?? segment.anchorExternalUid ?? null
          };
        }
      }
      const rawTripId = segment.rawTripIds[0] ?? null;
      if (rawTripId) {
        const rawTrip = rawTripById.get(rawTripId);
        if (rawTrip) {
          const points = pointsByTrip.get(rawTripId) ?? [];
          const point = kind === "start" ? points[0] ?? null : points[points.length - 1] ?? null;
          const placeId = kind === "start" ? rawTrip.start_place_id : rawTrip.end_place_id;
          const placeRow = placeId
            ? placeRows.find((row) => row.id === placeId) ?? null
            : null;
          const mappedPlace = placeRow ? mapMovementPlace(placeRow) : null;
          return {
            latitude: point?.latitude ?? mappedPlace?.latitude ?? null,
            longitude: point?.longitude ?? mappedPlace?.longitude ?? null,
            placeLabel: mappedPlace?.label ?? segment.placeLabel ?? null,
            placeExternalUid: mappedPlace?.externalUid ?? null
          };
        }
      }
      const mappedPlace = segment.anchorExternalUid
        ? placesByExternalUid.get(segment.anchorExternalUid) ?? null
        : null;
      return {
        latitude: mappedPlace?.latitude ?? null,
        longitude: mappedPlace?.longitude ?? null,
        placeLabel: mappedPlace?.label ?? segment.placeLabel ?? null,
        placeExternalUid: mappedPlace?.externalUid ?? segment.anchorExternalUid ?? null
      };
    }
  });
}

export function createMovementUserBox(
  input: z.input<typeof movementUserBoxCreateSchema> & { userId: string },
  context: ActivityContext
) {
  const parsed = movementUserBoxCreateSchema.parse(input);
  const row = insertMovementBox({
    userId: input.userId,
    kind: parsed.kind,
    sourceKind: "user_defined",
    origin: parsed.kind === "missing" ? "user_invalidated" : "user_defined",
    startedAt: parsed.startedAt,
    endedAt: parsed.endedAt,
    title:
      parsed.title ||
      (parsed.kind === "missing"
        ? "User-defined missing data"
        : parsed.kind === "stay"
          ? parsed.placeLabel ?? "Manual stay"
          : "Manual move"),
    subtitle:
      parsed.subtitle ||
      (parsed.kind === "missing"
        ? "User invalidated automatic movement here."
        : "User-defined movement box."),
    placeLabel: parsed.placeLabel,
    anchorExternalUid: parsed.anchorExternalUid,
    tags: parsed.tags,
    distanceMeters: parsed.distanceMeters,
    averageSpeedMps: parsed.averageSpeedMps,
    editable: true,
    metadata: parsed.metadata
  });
  recordActivityEvent({
    entityType: "system",
    entityId: row.id,
    eventType: "movement_user_box_created",
    title: "Movement box created",
    description: `Created a ${row.kind} movement box.`,
    actor: context.actor ?? null,
    source: context.source,
    metadata: {
      sourceKind: row.source_kind,
      origin: row.origin
    }
  });
  rebuildAutomaticMovementBoxes(input.userId);
  return mapMovementBoxRow(row);
}

export function updateMovementUserBox(
  boxId: string,
  patch: z.input<typeof movementUserBoxPatchSchema>,
  context: ActivityContext,
  options: { userId?: string } = {}
) {
  const existing = getMovementBoxRow(boxId);
  if (!existing || existing.source_kind !== "user_defined" || existing.deleted_at) {
    return undefined;
  }
  if (options.userId && existing.user_id !== options.userId) {
    return undefined;
  }
  const parsed = movementUserBoxPatchSchema.parse(patch);
  const nextStartedAt = parsed.startedAt ?? existing.started_at;
  const nextEndedAt = parsed.endedAt ?? existing.ended_at;
  const row = insertMovementBox({
    id: existing.id,
    userId: existing.user_id,
    kind: parsed.kind ?? existing.kind,
    sourceKind: "user_defined",
    origin:
      (parsed.kind ?? existing.kind) === "missing"
        ? "user_invalidated"
        : "user_defined",
    startedAt: nextStartedAt,
    endedAt: nextEndedAt,
    title: parsed.title ?? existing.title,
    subtitle: parsed.subtitle ?? existing.subtitle,
    placeLabel:
      parsed.placeLabel === undefined ? existing.place_label : parsed.placeLabel,
    anchorExternalUid:
      parsed.anchorExternalUid === undefined
        ? existing.anchor_external_uid
        : parsed.anchorExternalUid,
    tags: parsed.tags ?? movementBoxTags(existing),
    distanceMeters:
      parsed.distanceMeters === undefined
        ? existing.distance_meters
        : parsed.distanceMeters,
    averageSpeedMps:
      parsed.averageSpeedMps === undefined
        ? existing.average_speed_mps
        : parsed.averageSpeedMps,
    editable: true,
    overrideCount: existing.override_count,
    overriddenAutomaticBoxIds: movementBoxOverriddenAutomaticBoxIds(existing),
    rawStayIds: movementBoxRawStayIds(existing),
    rawTripIds: movementBoxRawTripIds(existing),
    rawPointCount: existing.raw_point_count,
    hasLegacyCorrections: existing.has_legacy_corrections === 1,
    legacyOriginKey: existing.legacy_origin_key,
    metadata: {
      ...movementBoxMetadata(existing),
      ...(parsed.metadata ?? {})
    },
    deletedAt: existing.deleted_at,
    createdAt: existing.created_at,
    updatedAt: nowIso()
  });
  recordActivityEvent({
    entityType: "system",
    entityId: row.id,
    eventType: "movement_user_box_updated",
    title: "Movement box updated",
    description: `Updated a user-defined ${row.kind} box.`,
    actor: context.actor ?? null,
    source: context.source,
    metadata: {
      sourceKind: row.source_kind,
      origin: row.origin
    }
  });
  rebuildAutomaticMovementBoxes(existing.user_id);
  return mapMovementBoxRow(row);
}

export function deleteMovementUserBox(
  boxId: string,
  context: ActivityContext,
  options: { userId?: string } = {}
) {
  const existing = getMovementBoxRow(boxId);
  if (!existing || existing.source_kind !== "user_defined" || existing.deleted_at) {
    return undefined;
  }
  if (options.userId && existing.user_id !== options.userId) {
    return undefined;
  }
  softDeleteMovementBox(boxId);
  recordActivityEvent({
    entityType: "system",
    entityId: boxId,
    eventType: "movement_user_box_deleted",
    title: "Movement box deleted",
    description: `Deleted a user-defined ${existing.kind} box.`,
    actor: context.actor ?? null,
    source: context.source,
    metadata: {
      sourceKind: existing.source_kind,
      origin: existing.origin
    }
  });
  rebuildAutomaticMovementBoxes(existing.user_id);
  return {
    deletedBoxId: boxId
  };
}

export function invalidateAutomaticMovementBox(
  boxId: string,
  input: z.input<typeof movementAutomaticBoxInvalidateSchema>,
  context: ActivityContext,
  options: { userId?: string } = {}
) {
  const automatic = getMovementBoxRow(boxId);
  if (!automatic || automatic.source_kind !== "automatic" || automatic.deleted_at) {
    return undefined;
  }
  if (options.userId && automatic.user_id !== options.userId) {
    return undefined;
  }
  const parsed = movementAutomaticBoxInvalidateSchema.parse(input);
  const startedAt = parsed.startedAt ?? automatic.started_at;
  const endedAt = parsed.endedAt ?? automatic.ended_at;
  assertMovementUserBoxDoesNotOverlap({
    userId: automatic.user_id,
    startedAt,
    endedAt
  });
  const created = createMovementUserBox(
    {
      userId: automatic.user_id,
      kind: "missing",
      startedAt,
      endedAt,
      title: parsed.title ?? "User invalidated automatic movement",
      subtitle:
        parsed.subtitle ?? `Overrides ${automatic.title || automatic.kind} with missing data.`,
      placeLabel: automatic.place_label,
      anchorExternalUid: automatic.anchor_external_uid,
      tags: uniqStrings(["user-invalidated", ...movementBoxTags(automatic)]),
      metadata: {
        ...parsed.metadata,
        invalidatedAutomaticBoxId: automatic.id
      }
    },
    context
  );
  rebuildAutomaticMovementBoxes(automatic.user_id);
  return {
    box: created
  };
}

export function getMovementTimeline(input: z.input<typeof movementTimelineQuerySchema>) {
  const parsed = movementTimelineQuerySchema.parse(input);
  const userIds =
    parsed.userIds.length > 0 ? parsed.userIds : [getDefaultUser().id];
  const places = listMovementPlaceRows(userIds).map(mapMovementPlace);
  const placesById = new Map(places.map((place) => [place.id, place] as const));
  const stayRows = listMovementStayRows(userIds);
  const tripRows = listMovementTripRows(userIds);
  const tripIds = tripRows.map((row) => row.id);
  const pointsByTrip = new Map<string, MovementTripPointRow[]>();
  listTripPoints(tripIds).forEach((point) => {
    pointsByTrip.set(point.trip_id, [...(pointsByTrip.get(point.trip_id) ?? []), point]);
  });
  const stopsByTrip = new Map<string, MovementTripStopRow[]>();
  listTripStops(tripIds).forEach((stop) => {
    stopsByTrip.set(stop.trip_id, [...(stopsByTrip.get(stop.trip_id) ?? []), stop]);
  });
  const stayPayloadById = new Map(
    stayRows.map((row) => {
      const stay = mapMovementStay(row, placesById);
      return [stay.id, stay] as const;
    })
  );
  const tripPayloadById = new Map(
    tripRows.map((row) => {
      const trip = mapMovementTrip(
        row,
        placesById,
        pointsByTrip.get(row.id) ?? [],
        stopsByTrip.get(row.id) ?? []
      );
      return [trip.id, trip] as const;
    })
  );
  const projected = projectMovementBoxes({ userIds });

  let nextStayLane: MovementTimelineLaneSide = "left";
  const stayLaneById = new Map<string, MovementTimelineLaneSide>();
  for (const box of projected) {
    if (box.kind === "stay") {
      stayLaneById.set(box.id, nextStayLane);
      nextStayLane = nextStayLane === "left" ? "right" : "left";
    }
  }

  const decorated = projected.map((segment, index) => {
    const previousStayId = [...projected.slice(0, index)]
      .reverse()
      .find((candidate) => candidate.kind === "stay")?.id;
    const previousStayLane = previousStayId
      ? stayLaneById.get(previousStayId)
      : undefined;
    const nextStayLaneId = projected
      .slice(index + 1)
      .find((candidate) => candidate.kind === "stay")?.id;
    const nextStayLane =
      nextStayLaneId ? stayLaneById.get(nextStayLaneId) : undefined;
    const cursor = {
      id: segment.id,
      kind: segment.kind,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt
    } satisfies MovementTimelineCursor;
    const rawStay =
      segment.rawStayIds.length > 0 ? stayPayloadById.get(segment.rawStayIds[0]!) ?? null : null;
    const rawTrip =
      segment.rawTripIds.length > 0 ? tripPayloadById.get(segment.rawTripIds[0]!) ?? null : null;
    const syncSource = String(segment.metadata.syncSource ?? segment.sourceKind);
    if (segment.kind === "missing") {
      const laneSide = previousStayLane ?? nextStayLane ?? "left";
      return {
        id: segment.id,
        kind: "missing" as const,
        sourceKind: segment.sourceKind,
        origin: segment.origin,
        editable: segment.editable,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        durationSeconds: segment.durationSeconds,
        laneSide,
        connectorFromLane: previousStayLane ?? laneSide,
        connectorToLane: nextStayLane ?? laneSide,
        title: segment.title,
        subtitle: segment.subtitle,
        placeLabel: segment.placeLabel,
        tags: segment.tags,
        isInvalid: false,
        syncSource,
        cursor: encodeMovementTimelineCursor(cursor),
        overrideCount: segment.overrideCount,
        overriddenAutomaticBoxIds: segment.overriddenAutomaticBoxIds,
        rawStayIds: segment.rawStayIds,
        rawTripIds: segment.rawTripIds,
        rawPointCount: segment.rawPointCount,
        hasLegacyCorrections: segment.hasLegacyCorrections,
        stay: null,
        trip: null
      };
    }
    if (segment.kind === "stay" && rawStay && segment.sourceKind === "automatic" && segment.origin === "recorded") {
      const invalid = hasInvalidMovementRecord(rawStay.metadata);
      const laneSide = stayLaneById.get(segment.id) ?? "left";
      return {
        id: segment.id,
        kind: "stay" as const,
        sourceKind: segment.sourceKind,
        origin: segment.origin,
        editable: segment.editable,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        durationSeconds: segment.durationSeconds,
        laneSide,
        connectorFromLane: laneSide,
        connectorToLane: laneSide,
        title: segment.title,
        subtitle: segment.subtitle,
        placeLabel: segment.placeLabel,
        tags: segment.tags,
        isInvalid: invalid,
        syncSource,
        cursor: encodeMovementTimelineCursor(cursor),
        overrideCount: segment.overrideCount,
        overriddenAutomaticBoxIds: segment.overriddenAutomaticBoxIds,
        rawStayIds: segment.rawStayIds,
        rawTripIds: segment.rawTripIds,
        rawPointCount: segment.rawPointCount,
        hasLegacyCorrections: segment.hasLegacyCorrections,
        stay: rawStay,
        trip: null
      };
    }
    if (segment.kind === "stay") {
      const laneSide = previousStayLane ?? nextStayLane ?? "left";
      return {
        id: segment.id,
        kind: "stay" as const,
        sourceKind: segment.sourceKind,
        origin: segment.origin,
        editable: segment.editable,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        durationSeconds: segment.durationSeconds,
        laneSide,
        connectorFromLane: previousStayLane ?? laneSide,
        connectorToLane: nextStayLane ?? laneSide,
        title: segment.title,
        subtitle: segment.subtitle,
        placeLabel: segment.placeLabel,
        tags: segment.tags,
        isInvalid: false,
        syncSource,
        cursor: encodeMovementTimelineCursor(cursor),
        overrideCount: segment.overrideCount,
        overriddenAutomaticBoxIds: segment.overriddenAutomaticBoxIds,
        rawStayIds: segment.rawStayIds,
        rawTripIds: segment.rawTripIds,
        rawPointCount: segment.rawPointCount,
        hasLegacyCorrections: segment.hasLegacyCorrections,
        stay: null,
        trip: null
      };
    }
    if (!rawTrip || segment.sourceKind !== "automatic" || segment.origin !== "recorded") {
      const laneSide = nextStayLane ?? previousStayLane ?? "left";
      return {
        id: segment.id,
        kind: "trip" as const,
        sourceKind: segment.sourceKind,
        origin: segment.origin,
        editable: segment.editable,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        durationSeconds: segment.durationSeconds,
        laneSide,
        connectorFromLane: previousStayLane ?? laneSide,
        connectorToLane: nextStayLane ?? laneSide,
        title: segment.title,
        subtitle: segment.subtitle,
        placeLabel: segment.placeLabel,
        tags: segment.tags,
        isInvalid: false,
        syncSource,
        cursor: encodeMovementTimelineCursor(cursor),
        overrideCount: segment.overrideCount,
        overriddenAutomaticBoxIds: segment.overriddenAutomaticBoxIds,
        rawStayIds: segment.rawStayIds,
        rawTripIds: segment.rawTripIds,
        rawPointCount: segment.rawPointCount,
        hasLegacyCorrections: segment.hasLegacyCorrections,
        stay: null,
        trip: null
      };
    }
    const invalid = hasInvalidMovementRecord(rawTrip.metadata);
    const laneSide = nextStayLane ?? previousStayLane ?? "left";
    return {
      id: segment.id,
      kind: "trip" as const,
      sourceKind: segment.sourceKind,
      origin: segment.origin,
      editable: segment.editable,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      durationSeconds: segment.durationSeconds,
      laneSide,
      connectorFromLane: previousStayLane ?? laneSide,
      connectorToLane: nextStayLane ?? laneSide,
      title: segment.title,
      subtitle: segment.subtitle,
      placeLabel: segment.placeLabel,
      tags: segment.tags,
      isInvalid: invalid,
      syncSource,
      cursor: encodeMovementTimelineCursor(cursor),
      overrideCount: segment.overrideCount,
      overriddenAutomaticBoxIds: segment.overriddenAutomaticBoxIds,
      rawStayIds: segment.rawStayIds,
      rawTripIds: segment.rawTripIds,
      rawPointCount: segment.rawPointCount,
      hasLegacyCorrections: segment.hasLegacyCorrections,
      stay: null,
      trip: rawTrip
    };
  });

  const descending = [...decorated].sort((left, right) =>
    compareMovementTimelineDescending(
      {
        id: left.id,
        kind: left.kind,
        startedAt: left.startedAt,
        endedAt: left.endedAt
      },
      {
        id: right.id,
        kind: right.kind,
        startedAt: right.startedAt,
        endedAt: right.endedAt
      }
    )
  );
  const beforeCursor = decodeMovementTimelineCursor(parsed.before);
  const filtered = beforeCursor
    ? descending.filter((segment) =>
        compareMovementTimelineDescending(
          {
            id: segment.id,
            kind: segment.kind,
            startedAt: segment.startedAt,
            endedAt: segment.endedAt
          },
          beforeCursor
        ) > 0
      )
    : descending;
  const segments = filtered.slice(0, parsed.limit);
  const nextCursor =
    filtered.length > segments.length && segments.length > 0
      ? segments[segments.length - 1]!.cursor
      : null;
  return {
    segments,
    nextCursor,
    hasMore: nextCursor !== null,
    invalidSegmentCount: 0
  };
}

export function updateMovementStay(
  stayId: string,
  patch: z.input<typeof movementStayPatchSchema>,
  context: ActivityContext,
  options: { userId?: string } = {}
) {
  const existing = getDatabase()
    .prepare(
      `SELECT *
       FROM movement_stays
       WHERE id = ?`
    )
    .get(stayId) as MovementStayRow | undefined;
  if (!existing) {
    return undefined;
  }
  if (options.userId && existing.user_id !== options.userId) {
    return undefined;
  }
  const parsed = movementStayPatchSchema.parse(patch);
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO movement_stay_overrides (
         id, user_id, stay_external_uid, stay_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, stay_external_uid) DO UPDATE SET
         stay_json = excluded.stay_json,
         updated_at = excluded.updated_at`
    )
    .run(
      `msto_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      existing.user_id,
      existing.external_uid,
      JSON.stringify(parsed),
      now,
      now
    );
  getDatabase()
    .prepare(
      `DELETE FROM movement_stay_tombstones
       WHERE user_id = ?
         AND stay_external_uid = ?`
    )
    .run(existing.user_id, existing.external_uid);
  const startedAt = parsed.startedAt ?? existing.started_at;
  const endedAt = parsed.endedAt ?? existing.ended_at;
  if (Date.parse(endedAt) < Date.parse(startedAt)) {
    throw new HttpError(
      400,
      "invalid_movement_stay_range",
      "Movement stay end time must be after the start time."
    );
  }
  const resolvedPlace =
    resolvePlaceForPatch({
      userId: existing.user_id,
      explicitPlaceId: hasOwn(parsed, "placeId") ? parsed.placeId : undefined,
      explicitPlaceExternalUid:
        hasOwn(parsed, "placeExternalUid") ? parsed.placeExternalUid : undefined,
      fallbackCoordinates: {
        latitude: parsed.centerLatitude ?? existing.center_latitude,
        longitude: parsed.centerLongitude ?? existing.center_longitude
      }
    }) ?? (hasOwn(parsed, "placeId") || hasOwn(parsed, "placeExternalUid")
      ? null
      : resolvePlaceRowById(existing.user_id, existing.place_id));
  const tags =
    parsed.tags !== undefined
      ? uniqStrings(parsed.tags)
      : Array.isArray(
            (safeJsonParse<Record<string, unknown>>(existing.metrics_json, {}).tags)
          )
        ? uniqStrings(
            ((safeJsonParse<Record<string, unknown>>(existing.metrics_json, {}).tags as string[]) ??
              [])
          )
        : [];
  const metrics = {
    ...safeJsonParse<Record<string, unknown>>(existing.metrics_json, {}),
    tags
  };
  const metadata = {
    ...safeJsonParse<Record<string, unknown>>(existing.metadata_json, {}),
    ...(parsed.metadata ?? {})
  };
  getDatabase()
    .prepare(
      `UPDATE movement_stays
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
       WHERE id = ?`
    )
    .run(
      resolvedPlace?.id ?? null,
      parsed.label ?? parsed.placeLabel ?? existing.label,
      parsed.status ?? existing.status,
      parsed.classification ?? existing.classification,
      startedAt,
      endedAt,
      parsed.centerLatitude ?? existing.center_latitude,
      parsed.centerLongitude ?? existing.center_longitude,
      parsed.radiusMeters ?? existing.radius_meters,
      parsed.sampleCount ?? existing.sample_count,
      JSON.stringify(metrics),
      JSON.stringify(metadata),
      nowIso(),
      stayId
    );
  reconcileMovementOverlapValidation(existing.user_id);
  const places = listMovementPlaceRows([existing.user_id]).map(mapMovementPlace);
  const placesById = new Map(places.map((place) => [place.id, place] as const));
  const updated = mapMovementStay(
    getDatabase()
      .prepare(
        `SELECT *
         FROM movement_stays
         WHERE id = ?`
      )
      .get(stayId) as MovementStayRow,
    placesById
  );
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

export function updateMovementTrip(
  tripId: string,
  patch: z.input<typeof movementTripPatchSchema>,
  context: ActivityContext,
  options: { userId?: string } = {}
) {
  const existing = getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trips
       WHERE id = ?`
    )
    .get(tripId) as MovementTripRow | undefined;
  if (!existing) {
    return undefined;
  }
  if (options.userId && existing.user_id !== options.userId) {
    return undefined;
  }
  const parsed = movementTripPatchSchema.parse(patch);
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO movement_trip_overrides (
         id, user_id, trip_external_uid, trip_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, trip_external_uid) DO UPDATE SET
         trip_json = excluded.trip_json,
         updated_at = excluded.updated_at`
    )
    .run(
      `mtro_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      existing.user_id,
      existing.external_uid,
      JSON.stringify(parsed),
      now,
      now
    );
  getDatabase()
    .prepare(
      `DELETE FROM movement_trip_tombstones
       WHERE user_id = ?
         AND trip_external_uid = ?`
    )
    .run(existing.user_id, existing.external_uid);
  const startedAt = parsed.startedAt ?? existing.started_at;
  const endedAt = parsed.endedAt ?? existing.ended_at;
  if (Date.parse(endedAt) < Date.parse(startedAt)) {
    throw new HttpError(
      400,
      "invalid_movement_trip_range",
      "Movement trip end time must be after the start time."
    );
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
        latitude: tripPoints[tripPoints.length - 1]!.latitude,
        longitude: tripPoints[tripPoints.length - 1]!.longitude
      }
    : fallbackStartPoint;
  const startPlace =
    resolvePlaceForPatch({
      userId: existing.user_id,
      explicitPlaceId: hasOwn(parsed, "startPlaceId") ? parsed.startPlaceId : undefined,
      explicitPlaceExternalUid:
        hasOwn(parsed, "startPlaceExternalUid")
          ? parsed.startPlaceExternalUid
          : undefined,
      fallbackCoordinates: fallbackStartPoint
    }) ?? (hasOwn(parsed, "startPlaceId") || hasOwn(parsed, "startPlaceExternalUid")
      ? null
      : resolvePlaceRowById(existing.user_id, existing.start_place_id));
  const endPlace =
    resolvePlaceForPatch({
      userId: existing.user_id,
      explicitPlaceId: hasOwn(parsed, "endPlaceId") ? parsed.endPlaceId : undefined,
      explicitPlaceExternalUid:
        hasOwn(parsed, "endPlaceExternalUid") ? parsed.endPlaceExternalUid : undefined,
      fallbackCoordinates: fallbackEndPoint
    }) ?? (hasOwn(parsed, "endPlaceId") || hasOwn(parsed, "endPlaceExternalUid")
      ? null
      : resolvePlaceRowById(existing.user_id, existing.end_place_id));
  const metadata = {
    ...safeJsonParse<Record<string, unknown>>(existing.metadata_json, {}),
    ...(parsed.metadata ?? {})
  };
  getDatabase()
    .prepare(
      `UPDATE movement_trips
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
       WHERE id = ?`
    )
    .run(
      startPlace?.id ?? null,
      endPlace?.id ?? null,
      parsed.label ?? existing.label,
      parsed.status ?? existing.status,
      parsed.travelMode ?? existing.travel_mode,
      parsed.activityType ?? existing.activity_type,
      startedAt,
      endedAt,
      parsed.distanceMeters ?? existing.distance_meters,
      parsed.movingSeconds ?? existing.moving_seconds,
      parsed.idleSeconds ?? existing.idle_seconds,
      parsed.averageSpeedMps === undefined
        ? existing.average_speed_mps
        : parsed.averageSpeedMps,
      parsed.maxSpeedMps === undefined ? existing.max_speed_mps : parsed.maxSpeedMps,
      parsed.caloriesKcal === undefined ? existing.calories_kcal : parsed.caloriesKcal,
      parsed.expectedMet === undefined ? existing.expected_met : parsed.expectedMet,
      JSON.stringify(parsed.tags !== undefined ? uniqStrings(parsed.tags) : safeJsonParse<string[]>(existing.tags_json, [])),
      JSON.stringify(metadata),
      nowIso(),
      tripId
    );
  reconcileMovementOverlapValidation(existing.user_id);
  const places = listMovementPlaceRows([existing.user_id]).map(mapMovementPlace);
  const placesById = new Map(places.map((place) => [place.id, place] as const));
  const updated = mapMovementTrip(
    getDatabase()
      .prepare(
        `SELECT *
         FROM movement_trips
         WHERE id = ?`
      )
      .get(tripId) as MovementTripRow,
    placesById,
    tripPoints,
    listTripStops([tripId])
  );
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

export function deleteMovementStay(
  stayId: string,
  context: ActivityContext,
  options: { userId?: string } = {}
) {
  const existing = getDatabase()
    .prepare(
      `SELECT *
       FROM movement_stays
       WHERE id = ?`
    )
    .get(stayId) as MovementStayRow | undefined;
  if (!existing) {
    return undefined;
  }
  if (options.userId && existing.user_id !== options.userId) {
    return undefined;
  }
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO movement_stay_tombstones (
         id, user_id, stay_external_uid, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, stay_external_uid) DO UPDATE SET
         updated_at = excluded.updated_at`
    )
    .run(
      `mstt_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      existing.user_id,
      existing.external_uid,
      now,
      now
    );
  getDatabase()
    .prepare(
      `DELETE FROM movement_stay_overrides
       WHERE user_id = ?
         AND stay_external_uid = ?`
    )
    .run(existing.user_id, existing.external_uid);
  getDatabase()
    .prepare(
      `DELETE FROM movement_stays
       WHERE id = ?`
    )
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

export function deleteMovementTrip(
  tripId: string,
  context: ActivityContext,
  options: { userId?: string } = {}
) {
  const existing = getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trips
       WHERE id = ?`
    )
    .get(tripId) as MovementTripRow | undefined;
  if (!existing) {
    return undefined;
  }
  if (options.userId && existing.user_id !== options.userId) {
    return undefined;
  }
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO movement_trip_tombstones (
         id, user_id, trip_external_uid, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, trip_external_uid) DO UPDATE SET
         updated_at = excluded.updated_at`
    )
    .run(
      `mtrt_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      existing.user_id,
      existing.external_uid,
      now,
      now
    );
  getDatabase()
    .prepare(
      `DELETE FROM movement_trip_overrides
       WHERE user_id = ?
         AND trip_external_uid = ?`
    )
    .run(existing.user_id, existing.external_uid);
  getDatabase()
    .prepare(
      `DELETE FROM movement_trip_point_tombstones
       WHERE user_id = ?
         AND trip_external_uid = ?`
    )
    .run(existing.user_id, existing.external_uid);
  getDatabase()
    .prepare(
      `DELETE FROM movement_trip_point_overrides
       WHERE user_id = ?
         AND trip_external_uid = ?`
    )
    .run(existing.user_id, existing.external_uid);
  getDatabase()
    .prepare(
      `DELETE FROM movement_trips
       WHERE id = ?`
    )
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

export function updateMovementTripPoint(
  tripId: string,
  pointId: string,
  patch: z.input<typeof movementTripPointPatchSchema>,
  context: ActivityContext,
  options: { userId?: string } = {}
) {
  const trip = getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trips
       WHERE id = ?`
    )
    .get(tripId) as MovementTripRow | undefined;
  if (!trip) {
    return undefined;
  }
  if (options.userId && trip.user_id !== options.userId) {
    return undefined;
  }
  const point = getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trip_points
       WHERE id = ?
         AND trip_id = ?`
    )
    .get(pointId, tripId) as MovementTripPointRow | undefined;
  if (!point) {
    return undefined;
  }
  const parsed = movementTripPointPatchSchema.parse(patch);
  const nextPoint = movementTripPointInputSchema.parse({
    externalUid: point.external_uid,
    recordedAt: parsed.recordedAt ?? point.recorded_at,
    latitude: parsed.latitude ?? point.latitude,
    longitude: parsed.longitude ?? point.longitude,
    accuracyMeters:
      parsed.accuracyMeters === undefined
        ? point.accuracy_meters
        : parsed.accuracyMeters,
    altitudeMeters:
      parsed.altitudeMeters === undefined
        ? point.altitude_meters
        : parsed.altitudeMeters,
    speedMps:
      parsed.speedMps === undefined ? point.speed_mps : parsed.speedMps,
    isStopAnchor:
      parsed.isStopAnchor === undefined
        ? point.is_stop_anchor === 1
        : parsed.isStopAnchor
  });
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO movement_trip_point_overrides (
         id, user_id, trip_external_uid, point_external_uid, point_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, trip_external_uid, point_external_uid) DO UPDATE SET
         point_json = excluded.point_json,
         updated_at = excluded.updated_at`
    )
    .run(
      `mtpo_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      trip.user_id,
      trip.external_uid,
      point.external_uid,
      JSON.stringify(nextPoint),
      now,
      now
    );
  getDatabase()
    .prepare(
      `DELETE FROM movement_trip_point_tombstones
       WHERE user_id = ?
         AND trip_external_uid = ?
         AND point_external_uid = ?`
    )
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
    .map((current) =>
      current.externalUid === point.external_uid ? nextPoint : current
    )
    .sort(
      (left, right) =>
        Date.parse(left.recordedAt) - Date.parse(right.recordedAt) ||
        left.externalUid.localeCompare(right.externalUid)
    );
  replaceTripPoints(tripId, trip.external_uid, nextPoints);
  const refreshedTrip = refreshTripDerivedFields(tripId);
  if (!refreshedTrip) {
    return undefined;
  }
  const refreshedPoints = listTripPoints([tripId]);
  const updatedPoint = refreshedPoints.find(
    (row) => row.external_uid === point.external_uid
  );
  if (!updatedPoint) {
    return undefined;
  }
  const places = listMovementPlaceRows([trip.user_id]).map(mapMovementPlace);
  const placesById = new Map(places.map((place) => [place.id, place] as const));
  const mappedTrip = mapMovementTrip(
    refreshedTrip,
    placesById,
    refreshedPoints,
    listTripStops([tripId])
  );
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

export function deleteMovementTripPoint(
  tripId: string,
  pointId: string,
  context: ActivityContext,
  options: { userId?: string } = {}
) {
  const trip = getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trips
       WHERE id = ?`
    )
    .get(tripId) as MovementTripRow | undefined;
  if (!trip) {
    return undefined;
  }
  if (options.userId && trip.user_id !== options.userId) {
    return undefined;
  }
  const point = getDatabase()
    .prepare(
      `SELECT *
       FROM movement_trip_points
       WHERE id = ?
         AND trip_id = ?`
    )
    .get(pointId, tripId) as MovementTripPointRow | undefined;
  if (!point) {
    return undefined;
  }
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO movement_trip_point_tombstones (
         id, user_id, trip_external_uid, point_external_uid, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, trip_external_uid, point_external_uid) DO UPDATE SET
         updated_at = excluded.updated_at`
    )
    .run(
      `mtpt_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      trip.user_id,
      trip.external_uid,
      point.external_uid,
      now,
      now
    );
  getDatabase()
    .prepare(
      `DELETE FROM movement_trip_point_overrides
       WHERE user_id = ?
         AND trip_external_uid = ?
         AND point_external_uid = ?`
    )
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
    .sort(
      (left, right) =>
        Date.parse(left.recordedAt) - Date.parse(right.recordedAt) ||
        left.externalUid.localeCompare(right.externalUid)
    );
  replaceTripPoints(tripId, trip.external_uid, remainingPoints);
  const refreshedTrip = refreshTripDerivedFields(tripId);
  if (!refreshedTrip) {
    return undefined;
  }
  const places = listMovementPlaceRows([trip.user_id]).map(mapMovementPlace);
  const placesById = new Map(places.map((place) => [place.id, place] as const));
  const mappedTrip = mapMovementTrip(
    refreshedTrip,
    placesById,
    listTripPoints([tripId]),
    listTripStops([tripId])
  );
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
  const screenTime = getScreenTimeOverlapSummary({
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    userIds: input.userIds
  });
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
    tags,
    estimatedScreenTimeSeconds: screenTime.estimatedScreenTimeSeconds,
    pickupCount: screenTime.pickupCount,
    notificationCount: screenTime.notificationCount,
    topApps: screenTime.topApps,
    topCategories: screenTime.topCategories
  };
}

export function getMovementDayDetail(input: {
  date?: string;
  userIds?: string[];
}) {
  const targetDate = input.date ?? dayKey(nowIso());
  const userIds = input.userIds && input.userIds.length > 0 ? input.userIds : [getDefaultUser().id];
  const placeRows = listMovementPlaceRows(input.userIds);
  const places = placeRows.map(mapMovementPlace);
  const placesById = new Map(places.map((place) => [place.id, place]));
  const stays = listMovementStayRows(input.userIds, targetDate)
    .map((row) => mapMovementStay(row, placesById))
    .map((stay) => enrichMovementSegmentWithScreenTime(stay, input.userIds));
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
  const trips = tripRows
    .map((row) =>
      mapMovementTrip(
        row,
        placesById,
        pointsByTrip.get(row.id) ?? [],
        stopsByTrip.get(row.id) ?? []
      )
    )
    .map((trip) => enrichMovementSegmentWithScreenTime(trip, input.userIds));
  const dayStart = `${targetDate}T00:00:00.000Z`;
  const dayEnd = `${targetDate}T23:59:59.999Z`;
  const projectedBoxes = projectMovementBoxes({
    userIds,
    rangeStart: dayStart,
    rangeEnd: dayEnd
  });
  const stayById = new Map(stays.map((stay) => [stay.id, stay] as const));
  const tripById = new Map(trips.map((trip) => [trip.id, trip] as const));
  const allSegments = projectedBoxes.map((segment) => {
    const rawStay =
      segment.rawStayIds.length > 0 ? stayById.get(segment.rawStayIds[0]!) ?? null : null;
    const rawTrip =
      segment.rawTripIds.length > 0 ? tripById.get(segment.rawTripIds[0]!) ?? null : null;
    const estimatedScreenTimeSeconds =
      rawStay?.estimatedScreenTimeSeconds ?? rawTrip?.estimatedScreenTimeSeconds ?? 0;
    const pickupCount = rawStay?.pickupCount ?? rawTrip?.pickupCount ?? 0;
    const noteCount = rawStay?.note ? 1 : rawTrip?.note ? 1 : 0;
    return {
      id: segment.id,
      kind: segment.kind,
      sourceKind: segment.sourceKind,
      origin: segment.origin,
      editable: segment.editable,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      durationSeconds: segment.durationSeconds,
      label: segment.title,
      subtitle: segment.subtitle,
      distanceMeters: segment.distanceMeters,
      averageSpeedMps: segment.averageSpeedMps,
      estimatedScreenTimeSeconds,
      pickupCount,
      colorTone:
        segment.kind === "missing"
          ? "from-slate-400/18 to-slate-600/10"
          : segment.sourceKind === "user_defined"
            ? "from-rose-300/20 to-fuchsia-300/10"
            : segment.kind === "trip"
              ? "from-emerald-300/26 to-cyan-400/12"
              : segment.origin === "continued_stay"
                ? "from-sky-400/22 to-indigo-400/10"
                : "from-white/16 to-white/4",
      noteCount,
      overrideCount: segment.overrideCount,
      rawStayIds: segment.rawStayIds,
      rawTripIds: segment.rawTripIds,
      rawPointCount: segment.rawPointCount,
      hasLegacyCorrections: segment.hasLegacyCorrections
    };
  });
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
      totalDistanceMeters: round(
        allSegments.reduce(
          (sum, segment) => sum + (segment.kind === "trip" ? segment.distanceMeters : 0),
          0
        )
      ),
      totalMovingSeconds: allSegments.reduce(
        (sum, segment) => sum + (segment.kind === "trip" ? segment.durationSeconds : 0),
        0
      ),
      totalIdleSeconds: allSegments.reduce(
        (sum, segment) => sum + (segment.kind === "stay" ? segment.durationSeconds : 0),
        0
      ),
      tripCount: allSegments.filter((segment) => segment.kind === "trip").length,
      stayCount: allSegments.filter((segment) => segment.kind === "stay").length,
      missingCount: allSegments.filter((segment) => segment.kind === "missing").length,
      missingDurationSeconds: allSegments
        .filter((segment) => segment.kind === "missing")
        .reduce(
        (sum, segment) => sum + segment.durationSeconds,
        0
      ),
      repairedGapCount: allSegments.filter((segment) => segment.origin === "repaired_gap").length,
      repairedGapDurationSeconds: allSegments
        .filter((segment) => segment.origin === "repaired_gap")
        .reduce((sum, segment) => sum + segment.durationSeconds, 0),
      continuedStayCount: allSegments.filter((segment) => segment.origin === "continued_stay").length,
      continuedStayDurationSeconds: allSegments
        .filter((segment) => segment.origin === "continued_stay")
        .reduce((sum, segment) => sum + segment.durationSeconds, 0),
      knownPlaceCount: places.length,
      caloriesKcal: round(
        trips.reduce((sum, trip) => sum + (trip.caloriesKcal ?? 0), 0)
      ),
      estimatedScreenTimeSeconds: selectionAggregate.estimatedScreenTimeSeconds,
      pickupCount: selectionAggregate.pickupCount,
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
  const trip = enrichMovementSegmentWithScreenTime(
    mapMovementTrip(tripRow, placesById, points, stops),
    [tripRow.user_id]
  );
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
  const canonicalTripExternalUids = new Set<string>();
  const canonicalStayExternalUids = new Set<string>();
  (
    getDatabase()
      .prepare(
        `SELECT DISTINCT trip_external_uid
         FROM movement_trip_point_tombstones
         WHERE user_id = ?
         UNION
         SELECT DISTINCT trip_external_uid
         FROM movement_trip_point_overrides
         WHERE user_id = ?`
      )
      .all(pairing.user_id, pairing.user_id) as Array<{ trip_external_uid: string }>
  ).forEach((row) => {
    if (row.trip_external_uid.trim().length > 0) {
      canonicalTripExternalUids.add(row.trip_external_uid);
    }
  });
  (
    getDatabase()
      .prepare(
        `SELECT DISTINCT stay_external_uid
         FROM movement_stay_tombstones
         WHERE user_id = ?
         UNION
         SELECT DISTINCT stay_external_uid
         FROM movement_stay_overrides
         WHERE user_id = ?`
      )
      .all(pairing.user_id, pairing.user_id) as Array<{ stay_external_uid: string }>
  ).forEach((row) => {
    if (row.stay_external_uid.trim().length > 0) {
      canonicalStayExternalUids.add(row.stay_external_uid);
    }
  });
  const tripRows =
    canonicalTripExternalUids.size > 0
      ? (getDatabase()
          .prepare(
            `SELECT *
             FROM movement_trips
             WHERE user_id = ?
               AND external_uid IN (${[...canonicalTripExternalUids]
                 .map(() => "?")
                 .join(",")})`
          )
          .all(pairing.user_id, ...canonicalTripExternalUids) as MovementTripRow[])
      : [];
  const stayRows =
    canonicalStayExternalUids.size > 0
      ? (getDatabase()
          .prepare(
            `SELECT *
             FROM movement_stays
             WHERE user_id = ?
               AND external_uid IN (${[...canonicalStayExternalUids]
                 .map(() => "?")
                 .join(",")})`
          )
          .all(pairing.user_id, ...canonicalStayExternalUids) as MovementStayRow[])
      : [];
  const placeRows = listMovementPlaceRows([pairing.user_id]);
  const places = placeRows.map(mapMovementPlace);
  const placesById = new Map(places.map((place) => [place.id, place] as const));
  const pointsByTrip = new Map<string, MovementTripPointRow[]>();
  listTripPoints(tripRows.map((row) => row.id)).forEach((point) => {
    pointsByTrip.set(point.trip_id, [...(pointsByTrip.get(point.trip_id) ?? []), point]);
  });
  const stopsByTrip = new Map<string, MovementTripStopRow[]>();
  listTripStops(tripRows.map((row) => row.id)).forEach((stop) => {
    stopsByTrip.set(stop.trip_id, [...(stopsByTrip.get(stop.trip_id) ?? []), stop]);
  });
  return {
    settings: getMovementSettings([pairing.user_id]),
    places,
    stayOverrides: stayRows.map((stay) => mapMovementStay(stay, placesById)),
    tripOverrides: tripRows.map((trip) =>
      mapMovementTrip(
        trip,
        placesById,
        pointsByTrip.get(trip.id) ?? [],
        stopsByTrip.get(trip.id) ?? []
      )
    ),
    deletedStayExternalUids: listMovementStayTombstones(pairing.user_id).map(
      (row) => row.stay_external_uid
    ),
    deletedTripExternalUids: listMovementTripTombstones(pairing.user_id).map(
      (row) => row.trip_external_uid
    ),
    projectedBoxes: getMovementTimeline({
      userIds: [pairing.user_id],
      limit: 80
    }).segments
  };
}
