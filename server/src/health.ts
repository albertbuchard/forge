import { createHash, randomUUID } from "node:crypto";
import { inflateRawSync, inflateSync } from "node:zlib";
import { z } from "zod";
import { getDatabase, runInTransaction } from "./db.js";
import { HttpError } from "./errors.js";
import {
  buildWorkoutSessionPersistenceSeed,
  buildWorkoutSessionPresentation,
  workoutActivityDescriptorSchema,
  workoutDetailsSchema
} from "./health-workout-adapters.js";
import {
  WORKOUT_ZONE_ORDER,
  getHealthZoneProfile,
  getStoredWorkoutAnalytics,
  getWorkoutRawEvidence,
  healthZoneProfilePatchSchema,
  recomputeAndStoreWorkoutAnalytics,
  upsertWorkoutRoutePoints,
  upsertWorkoutTimeSeries,
  workoutCaptureQualitySchema,
  workoutRoutePointSchema,
  workoutTimeSeriesSampleSchema,
  patchHealthZoneProfile
} from "./health-workout-analytics.js";
import {
  getMovementMobileBootstrap,
  ingestMovementSync,
  movementSyncPayloadSchema
} from "./movement.js";
import {
  ingestScreenTimeSync,
  screenTimeSyncPayloadSchema
} from "./screen-time.js";
import { recordActivityEvent } from "./repositories/activity-events.js";
import { recordHabitGeneratedWorkoutReward } from "./repositories/rewards.js";
import { resolveUserForMutation } from "./repositories/users.js";

const healthLinkSchema = z.object({
  entityType: z.string().trim().min(1),
  entityId: z.string().trim().min(1),
  relationshipType: z.string().trim().min(1).default("context")
});

const healthStageSchema = z.object({
  stage: z.string().trim().min(1),
  seconds: z.number().int().nonnegative()
});

const sleepRecoveryMetricSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()])
);

const sleepSourceMetricSchema = sleepRecoveryMetricSchema;

const sleepAnnotationSchema = z.object({
  qualitySummary: z.string().trim().default(""),
  notes: z.string().trim().default(""),
  tags: z.array(z.string().trim()).default([]),
  links: z.array(healthLinkSchema).default([])
});

const workoutAnnotationSchema = z.object({
  subjectiveEffort: z.number().int().min(1).max(10).nullable().default(null),
  moodBefore: z.string().trim().default(""),
  moodAfter: z.string().trim().default(""),
  meaningText: z.string().trim().default(""),
  plannedContext: z.string().trim().default(""),
  socialContext: z.string().trim().default(""),
  tags: z.array(z.string().trim()).default([]),
  links: z.array(healthLinkSchema).default([])
});

const generatedHealthEventTemplateSchema = z.object({
  enabled: z.boolean().default(false),
  workoutType: z.string().trim().min(1).default("workout"),
  title: z.string().trim().default(""),
  durationMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60)
    .default(45),
  xpReward: z.number().int().min(0).max(500).default(0),
  tags: z.array(z.string().trim()).default([]),
  links: z.array(healthLinkSchema).default([]),
  notesTemplate: z.string().trim().default("")
});

const vitalMetricSummarySchema = z.object({
  metric: z.string().trim().min(1),
  label: z.string().trim().min(1),
  category: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  displayUnit: z.string().trim().min(1).default(""),
  aggregation: z.enum(["discrete", "cumulative"]).default("discrete"),
  average: z.number().nullable().optional(),
  minimum: z.number().nullable().optional(),
  maximum: z.number().nullable().optional(),
  latest: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
  sampleCount: z.number().int().nonnegative().default(0),
  latestSampleAt: z.string().datetime().nullable().optional()
});

const vitalDaySummarySchema = z.object({
  dateKey: z.string().trim().min(1),
  sourceTimezone: z.string().trim().min(1).default("UTC"),
  metrics: z.array(vitalMetricSummarySchema).default([])
});

const vitalsSyncPayloadSchema = z.object({
  daySummaries: z.array(vitalDaySummarySchema).default([])
});

const pairingStatusSchema = z.enum([
  "pending",
  "paired",
  "healthy",
  "stale",
  "permission_denied",
  "error",
  "revoked"
]);

export const companionSourceKeySchema = z.enum([
  "health",
  "movement",
  "screenTime"
]);

const companionSourceAuthorizationStatusSchema = z.enum([
  "not_determined",
  "pending",
  "approved",
  "denied",
  "restricted",
  "unavailable",
  "partial",
  "disabled"
]);

const companionSourceStateSchema = z.object({
  desiredEnabled: z.boolean().default(true),
  appliedEnabled: z.boolean().default(false),
  authorizationStatus:
    companionSourceAuthorizationStatusSchema.default("not_determined"),
  syncEligible: z.boolean().default(false),
  lastObservedAt: z.string().datetime().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({})
});

const companionSourceStatesSchema = z.object({
  health: companionSourceStateSchema.default({}),
  movement: companionSourceStateSchema.default({}),
  screenTime: companionSourceStateSchema.default({})
});

export const createCompanionPairingSessionSchema = z.object({
  label: z.string().trim().default("Forge Companion"),
  userId: z.string().trim().nullable().optional(),
  expiresInMinutes: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(30),
  transportMode: z
    .enum(["iroh", "manual-http"])
    .default("iroh")
    .transform((mode) => mode),
  capabilities: z
    .array(
      z.enum([
        "healthkit.sleep",
        "healthkit.fitness",
        "background-sync",
        "location-ready",
        "watch-ready"
      ])
    )
    .default([
      "healthkit.sleep",
      "healthkit.fitness",
      "background-sync",
      "location-ready",
      "watch-ready"
    ])
});

const COMPANION_VERIFIED_PAIRING_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function nextVerifiedCompanionPairingExpiry(now: Date) {
  return new Date(
    now.getTime() + COMPANION_VERIFIED_PAIRING_TTL_MS
  ).toISOString();
}

export const revokeAllCompanionPairingSessionsSchema = z.object({
  userIds: z.array(z.string().trim().min(1)).default([]),
  includeRevoked: z.boolean().default(false)
});

export const patchCompanionPairingSourceStateSchema = z.object({
  desiredEnabled: z.boolean()
});

export const updateMobileCompanionSourceStateSchema = z.object({
  sessionId: z.string().trim().min(1),
  pairingToken: z.string().trim().min(1),
  source: companionSourceKeySchema,
  desiredEnabled: z.boolean(),
  appliedEnabled: z.boolean(),
  authorizationStatus: companionSourceAuthorizationStatusSchema,
  syncEligible: z.boolean().default(false),
  lastObservedAt: z.string().datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const mobileHealthSyncSchema = z.object({
  sessionId: z.string().trim().min(1),
  pairingToken: z.string().trim().min(1),
  device: z.object({
    name: z.string().trim().default("iPhone"),
    platform: z.string().trim().default("ios"),
    appVersion: z.string().trim().default(""),
    sourceDevice: z.string().trim().default("iPhone")
  }),
  permissions: z.object({
    healthKitAuthorized: z.boolean().default(false),
    backgroundRefreshEnabled: z.boolean().default(false),
    motionReady: z.boolean().default(false),
    locationReady: z.boolean().default(false),
    screenTimeReady: z.boolean().default(false)
  }),
  sleepSessions: z
    .array(
      z.object({
        externalUid: z.string().trim().min(1),
        startedAt: z.string().datetime(),
        endedAt: z.string().datetime(),
        timeInBedSeconds: z.number().int().nonnegative().default(0),
        asleepSeconds: z.number().int().nonnegative().default(0),
        awakeSeconds: z.number().int().nonnegative().default(0),
        stageBreakdown: z.array(healthStageSchema).default([]),
        recoveryMetrics: sleepRecoveryMetricSchema.default({}),
        links: z.array(healthLinkSchema).default([]),
        annotations: sleepAnnotationSchema.partial().default({})
      })
    )
    .default([]),
  sleepNights: z
    .array(
      z.object({
        externalUid: z.string().trim().min(1),
        startedAt: z.string().datetime(),
        endedAt: z.string().datetime(),
        sourceTimezone: z.string().trim().min(1).default("UTC"),
        localDateKey: z.string().trim().min(1),
        timeInBedSeconds: z.number().int().nonnegative().default(0),
        asleepSeconds: z.number().int().nonnegative().default(0),
        awakeSeconds: z.number().int().nonnegative().default(0),
        rawSegmentCount: z.number().int().nonnegative().default(0),
        stageBreakdown: z.array(healthStageSchema).default([]),
        recoveryMetrics: sleepRecoveryMetricSchema.default({}),
        sourceMetrics: sleepSourceMetricSchema.default({}),
        links: z.array(healthLinkSchema).default([]),
        annotations: sleepAnnotationSchema.partial().default({})
      })
    )
    .default([]),
  sleepSegments: z
    .array(
      z.object({
        externalUid: z.string().trim().min(1),
        startedAt: z.string().datetime(),
        endedAt: z.string().datetime(),
        sourceTimezone: z.string().trim().min(1).default("UTC"),
        localDateKey: z.string().trim().min(1),
        stage: z.string().trim().min(1),
        bucket: z.enum(["in_bed", "asleep", "awake"]),
        sourceValue: z.number().int().nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).default({})
      })
    )
    .default([]),
  sleepRawRecords: z
    .array(
      z.object({
        externalUid: z.string().trim().min(1),
        startedAt: z.string().datetime(),
        endedAt: z.string().datetime(),
        sourceTimezone: z.string().trim().min(1).default("UTC"),
        localDateKey: z.string().trim().min(1),
        providerRecordType: z
          .string()
          .trim()
          .min(1)
          .default("healthkit_sleep_sample"),
        rawStage: z.string().trim().min(1),
        rawValue: z.number().int().nullable().optional(),
        payload: z.record(z.string(), z.unknown()).default({}),
        metadata: z.record(z.string(), z.unknown()).default({})
      })
    )
    .default([]),
  workouts: z
    .array(
      z.object({
        externalUid: z.string().trim().min(1),
        workoutType: z.string().trim().min(1),
        startedAt: z.string().datetime(),
        endedAt: z.string().datetime(),
        activeEnergyKcal: z.number().nonnegative().nullable().optional(),
        totalEnergyKcal: z.number().nonnegative().nullable().optional(),
        distanceMeters: z.number().nonnegative().nullable().optional(),
        stepCount: z.number().int().nonnegative().nullable().optional(),
        exerciseMinutes: z.number().nonnegative().nullable().optional(),
        averageHeartRate: z.number().nonnegative().nullable().optional(),
        maxHeartRate: z.number().nonnegative().nullable().optional(),
        sourceDevice: z.string().trim().default("Apple Health"),
        sourceSystem: z.string().trim().min(1).default("apple_health"),
        sourceBundleIdentifier: z.string().trim().optional(),
        sourceProductType: z.string().trim().optional(),
        activity: workoutActivityDescriptorSchema.optional(),
        details: workoutDetailsSchema.optional(),
        timeSeriesSamples: z.array(workoutTimeSeriesSampleSchema).default([]),
        routePoints: z.array(workoutRoutePointSchema).default([]),
        captureQuality: workoutCaptureQualitySchema.optional(),
        syncCursor: z.record(z.string(), z.unknown()).default({}),
        links: z.array(healthLinkSchema).default([]),
        annotations: workoutAnnotationSchema.partial().default({})
      })
    )
    .default([]),
  vitals: vitalsSyncPayloadSchema.default({}),
  sourceStates: companionSourceStatesSchema.default({}),
  movement: movementSyncPayloadSchema.default({}),
  screenTime: screenTimeSyncPayloadSchema.default({})
});

const HEALTH_MOBILE_SYNC_SCHEMA_VERSION = "healthkit-sync-v2";
const HEALTH_MOBILE_SYNC_CHUNK_TARGET_BYTES = 12_000_000;
const HEALTH_MOBILE_SYNC_CHUNK_MAX_BYTES = 24_000_000;
const HEALTH_MOBILE_SYNC_CHUNK_PAYLOAD_ENCODING = "payload_json_base64";
const HEALTH_MOBILE_SYNC_COMPRESSED_CHUNK_PAYLOAD_ENCODING =
  "payload_json_deflate_base64";
const HEALTH_MOBILE_SYNC_ACCEPTED_CHUNK_PAYLOAD_ENCODINGS = [
  HEALTH_MOBILE_SYNC_CHUNK_PAYLOAD_ENCODING,
  HEALTH_MOBILE_SYNC_COMPRESSED_CHUNK_PAYLOAD_ENCODING,
  "legacy_payload_object"
] as const;
const HEALTH_MOBILE_SYNC_SESSION_TTL_MS = 1000 * 60 * 60 * 24;

const mobileHealthSyncFamilySchema = z.enum([
  "sleep_nights",
  "sleep_segments",
  "sleep_raw_records",
  "workout_summaries",
  "workout_archive",
  "workout_time_series",
  "workout_routes",
  "workout_tombstones",
  "vitals",
  "movement",
  "screen_time"
]);

const defaultMobileHealthSyncFamilies = mobileHealthSyncFamilySchema.options;

export const mobileHealthSyncSessionStartSchema = mobileHealthSyncSchema
  .pick({
    sessionId: true,
    pairingToken: true,
    device: true,
    permissions: true,
    sourceStates: true
  })
  .extend({
    schemaVersion: z.string().trim().default(HEALTH_MOBILE_SYNC_SCHEMA_VERSION),
    requestedFamilies: z
      .array(mobileHealthSyncFamilySchema)
      .default(defaultMobileHealthSyncFamilies),
    expectedCounts: z
      .record(z.string(), z.number().int().nonnegative())
      .default({}),
    metadata: z.record(z.string(), z.unknown()).default({})
  });

const workoutTimeSeriesChunkPayloadSchema = z.object({
  workouts: z
    .array(
      z.object({
        externalUid: z.string().trim().min(1),
        samples: z.array(workoutTimeSeriesSampleSchema).default([])
      })
    )
    .default([])
});

const workoutRouteChunkPayloadSchema = z.object({
  workouts: z
    .array(
      z.object({
        externalUid: z.string().trim().min(1),
        routePoints: z.array(workoutRoutePointSchema).default([])
      })
    )
    .default([])
});

const workoutTombstoneChunkPayloadSchema = z.object({
  workouts: z
    .array(
      z.object({
        externalUid: z.string().trim().min(1),
        deletedAt: z.string().datetime().nullable().optional(),
        reason: z.string().trim().default("healthkit_deleted")
      })
    )
    .default([])
});

const mobileHealthSyncChunkPayloadSchema = z.object({
  sleepNights: mobileHealthSyncSchema.shape.sleepNights.optional(),
  sleepSegments: mobileHealthSyncSchema.shape.sleepSegments.optional(),
  sleepRawRecords: mobileHealthSyncSchema.shape.sleepRawRecords.optional(),
  workouts: mobileHealthSyncSchema.shape.workouts.optional(),
  workoutTimeSeries:
    workoutTimeSeriesChunkPayloadSchema.shape.workouts.optional(),
  workoutRoutes: workoutRouteChunkPayloadSchema.shape.workouts.optional(),
  workoutTombstones:
    workoutTombstoneChunkPayloadSchema.shape.workouts.optional(),
  vitals: vitalsSyncPayloadSchema.optional(),
  movement: movementSyncPayloadSchema.optional(),
  screenTime: screenTimeSyncPayloadSchema.optional()
});

export const mobileHealthSyncChunkSchema = z.object({
  chunkId: z.string().trim().min(1),
  sequence: z.number().int().nonnegative(),
  family: mobileHealthSyncFamilySchema,
  recordCount: z.number().int().nonnegative().default(0),
  byteCount: z.number().int().nonnegative().default(0),
  compressedByteCount: z.number().int().nonnegative().optional(),
  checksumSha256: z.string().trim().min(1),
  payloadJsonDeflateBase64: z.string().trim().min(1).optional(),
  payloadJsonBase64: z.string().trim().min(1).optional(),
  payload: mobileHealthSyncChunkPayloadSchema.default({})
});

export const mobileHealthSyncSessionCompleteSchema = z.object({
  finalCursor: z.record(z.string(), z.unknown()).default({}),
  expectedCounts: z
    .record(z.string(), z.number().int().nonnegative())
    .default({})
});

type MobileHealthSyncFamily = z.infer<typeof mobileHealthSyncFamilySchema>;

export const verifyCompanionPairingSchema = z.object({
  sessionId: z.string().trim().min(1),
  pairingToken: z.string().trim().min(1),
  device: z.object({
    name: z.string().trim().default("iPhone"),
    platform: z.string().trim().default("ios"),
    appVersion: z.string().trim().default(""),
    sourceDevice: z.string().trim().default("iPhone")
  })
});

export const heartbeatCompanionPairingSchema = z.object({
  sessionId: z.string().trim().min(1),
  pairingToken: z.string().trim().min(1),
  device: z.object({
    name: z.string().trim().default("iPhone"),
    platform: z.string().trim().default("ios"),
    appVersion: z.string().trim().default(""),
    sourceDevice: z.string().trim().default("iPhone")
  })
});

export const updateWorkoutMetadataSchema = z.object({
  subjectiveEffort: z.number().int().min(1).max(10).nullable().optional(),
  moodBefore: z.string().trim().optional(),
  moodAfter: z.string().trim().optional(),
  meaningText: z.string().trim().optional(),
  plannedContext: z.string().trim().optional(),
  socialContext: z.string().trim().optional(),
  tags: z.array(z.string().trim()).optional(),
  links: z.array(healthLinkSchema).optional()
});

export const updateSleepMetadataSchema = z.object({
  qualitySummary: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  tags: z.array(z.string().trim()).optional(),
  links: z.array(healthLinkSchema).optional()
});

const manualHealthProvenanceSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()])
);

export const createSleepSessionSchema = z.object({
  userId: z.string().trim().min(1).nullable().optional(),
  externalUid: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).default("manual"),
  sourceType: z.string().trim().min(1).default("manual"),
  sourceDevice: z.string().trim().min(1).default("Forge"),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  sourceTimezone: z.string().trim().min(1).default("UTC"),
  localDateKey: z.string().trim().min(1).optional(),
  timeInBedSeconds: z.number().int().nonnegative().optional(),
  asleepSeconds: z.number().int().nonnegative().optional(),
  awakeSeconds: z.number().int().nonnegative().optional(),
  rawSegmentCount: z.number().int().nonnegative().default(0),
  stageBreakdown: z.array(healthStageSchema).default([]),
  recoveryMetrics: sleepRecoveryMetricSchema.default({}),
  sourceMetrics: sleepSourceMetricSchema.default({}),
  qualitySummary: z.string().trim().default(""),
  notes: z.string().trim().default(""),
  tags: z.array(z.string().trim()).default([]),
  links: z.array(healthLinkSchema).default([]),
  provenance: manualHealthProvenanceSchema.default({})
});

export const updateSleepSessionSchema = createSleepSessionSchema
  .omit({ userId: true })
  .partial();

export const createWorkoutSessionSchema = z.object({
  userId: z.string().trim().min(1).nullable().optional(),
  externalUid: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).default("manual"),
  sourceType: z.string().trim().min(1).default("manual"),
  sourceDevice: z.string().trim().min(1).default("Forge"),
  workoutType: z.string().trim().min(1),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  activeEnergyKcal: z.number().nonnegative().nullable().optional(),
  totalEnergyKcal: z.number().nonnegative().nullable().optional(),
  distanceMeters: z.number().nonnegative().nullable().optional(),
  stepCount: z.number().int().nonnegative().nullable().optional(),
  exerciseMinutes: z.number().nonnegative().nullable().optional(),
  averageHeartRate: z.number().nonnegative().nullable().optional(),
  maxHeartRate: z.number().nonnegative().nullable().optional(),
  subjectiveEffort: z.number().int().min(1).max(10).nullable().optional(),
  moodBefore: z.string().trim().default(""),
  moodAfter: z.string().trim().default(""),
  meaningText: z.string().trim().default(""),
  plannedContext: z.string().trim().default(""),
  socialContext: z.string().trim().default(""),
  tags: z.array(z.string().trim()).default([]),
  links: z.array(healthLinkSchema).default([]),
  provenance: manualHealthProvenanceSchema.default({})
});

export const updateWorkoutSessionSchema = createWorkoutSessionSchema
  .omit({ userId: true })
  .partial();

type ActivitySource = "ui" | "openclaw" | "agent" | "system";

type ActivityContext = {
  source: ActivitySource;
  actor?: string | null;
};

type PairingSessionRow = {
  id: string;
  user_id: string;
  label: string;
  pairing_token: string;
  status: z.infer<typeof pairingStatusSchema>;
  capability_flags_json: string;
  device_name: string | null;
  platform: string | null;
  app_version: string | null;
  api_base_url: string;
  last_seen_at: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  paired_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

type PairingSourceStateRow = {
  id: string;
  pairing_session_id: string;
  user_id: string;
  source_key: z.infer<typeof companionSourceKeySchema>;
  desired_enabled: number;
  applied_enabled: number;
  authorization_status: z.infer<
    typeof companionSourceAuthorizationStatusSchema
  >;
  sync_eligible: number;
  last_observed_at: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type MobileSyncSessionRow = {
  id: string;
  pairing_session_id: string;
  user_id: string;
  status: "running" | "completed" | "failed" | "aborted" | "expired";
  schema_version: string;
  requested_families_json: string;
  source_metadata_json: string;
  expected_counts_json: string;
  received_counts_json: string;
  byte_totals_json: string;
  affected_workout_ids_json: string;
  error_json: string;
  started_at: string;
  completed_at: string | null;
  failed_at: string | null;
  aborted_at: string | null;
  expired_at: string | null;
  created_at: string;
  updated_at: string;
};

type MobileSyncChunkRow = {
  id: string;
  sync_session_id: string;
  chunk_id: string;
  sequence: number;
  family: MobileHealthSyncFamily;
  checksum_sha256: string;
  record_count: number;
  byte_count: number;
  payload_json: string;
  payload_summary_json: string;
  received_at: string;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
};

type SleepSessionRow = {
  id: string;
  external_uid: string;
  pairing_session_id: string | null;
  user_id: string;
  source: string;
  source_type: string;
  source_device: string;
  source_timezone: string;
  local_date_key: string;
  started_at: string;
  ended_at: string;
  time_in_bed_seconds: number;
  asleep_seconds: number;
  awake_seconds: number;
  raw_segment_count: number;
  sleep_score: number | null;
  regularity_score: number | null;
  bedtime_consistency_minutes: number | null;
  wake_consistency_minutes: number | null;
  stage_breakdown_json: string;
  recovery_metrics_json: string;
  source_metrics_json: string;
  links_json: string;
  annotations_json: string;
  provenance_json: string;
  derived_json: string;
  created_at: string;
  updated_at: string;
};

type SleepSegmentRow = {
  id: string;
  external_uid: string;
  import_run_id: string | null;
  pairing_session_id: string | null;
  sleep_session_id: string | null;
  user_id: string;
  source: string;
  source_type: string;
  source_device: string;
  source_timezone: string;
  local_date_key: string;
  started_at: string;
  ended_at: string;
  stage: string;
  bucket: string;
  source_value: number | null;
  quality_kind: string;
  source_record_ids_json: string;
  metadata_json: string;
  provenance_json: string;
  created_at: string;
  updated_at: string;
};

type SleepSourceRecordRow = {
  id: string;
  import_run_id: string | null;
  pairing_session_id: string | null;
  sleep_session_id: string | null;
  user_id: string;
  provider: string;
  provider_record_type: string;
  provider_record_uid: string;
  source_device: string;
  source_timezone: string;
  local_date_key: string;
  started_at: string;
  ended_at: string;
  raw_stage: string;
  raw_value: number | null;
  quality_kind: string;
  payload_json: string;
  metadata_json: string;
  ingested_at: string;
};

type SleepRawLogRow = {
  id: string;
  import_run_id: string | null;
  pairing_session_id: string | null;
  sleep_session_id: string | null;
  user_id: string;
  source: string;
  log_type: string;
  external_uid: string | null;
  source_timezone: string;
  local_date_key: string;
  started_at: string | null;
  ended_at: string | null;
  payload_json: string;
  metadata_json: string;
  created_at: string;
};

type WorkoutSessionRow = {
  id: string;
  external_uid: string;
  pairing_session_id: string | null;
  user_id: string;
  source: string;
  source_type: string;
  workout_type: string;
  source_device: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  active_energy_kcal: number | null;
  total_energy_kcal: number | null;
  distance_meters: number | null;
  step_count: number | null;
  exercise_minutes: number | null;
  average_heart_rate: number | null;
  max_heart_rate: number | null;
  subjective_effort: number | null;
  mood_before: string;
  mood_after: string;
  meaning_text: string;
  planned_context: string;
  social_context: string;
  links_json: string;
  tags_json: string;
  annotations_json: string;
  provenance_json: string;
  derived_json: string;
  generated_from_habit_id: string | null;
  generated_from_check_in_id: string | null;
  reconciliation_status: string;
  created_at: string;
  updated_at: string;
};

type DailySummaryRow = {
  id: string;
  user_id: string;
  date_key: string;
  summary_type: string;
  metrics_json: string;
  derived_json: string;
  source: string;
  created_at: string;
  updated_at: string;
};

type StoredVitalMetricSummary = z.infer<typeof vitalMetricSummarySchema>;

type StoredVitalMetricDays = Array<{
  dateKey: string;
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  latest: number | null;
  total: number | null;
  sampleCount: number;
  latestSampleAt: string | null;
}>;

type HealthImportRunRow = {
  id: string;
  pairing_session_id: string | null;
  user_id: string;
  source: string;
  source_device: string;
  status: string;
  payload_summary_json: string;
  imported_count: number;
  created_count: number;
  updated_count: number;
  merged_count: number;
  error_message: string | null;
  imported_at: string;
  created_at: string;
  updated_at: string;
};

let legacyAppleSleepRepairDatabase: ReturnType<typeof getDatabase> | null =
  null;

function nowIso() {
  return new Date().toISOString();
}

function durationSecondsBetween(startedAt: string, endedAt: string) {
  return Math.max(
    0,
    Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)
  );
}

function resolveHealthUserId(userId?: string | null) {
  return resolveUserForMutation(userId ?? null).id;
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

function listPairingSourceStateRows(pairingSessionId: string) {
  return getDatabase()
    .prepare(
      `SELECT *
       FROM companion_pairing_source_states
       WHERE pairing_session_id = ?
       ORDER BY source_key ASC`
    )
    .all(pairingSessionId) as PairingSourceStateRow[];
}

function defaultCompanionSourceState(
  source: z.infer<typeof companionSourceKeySchema>,
  pairing: Pick<
    PairingSessionRow,
    "id" | "user_id" | "paired_at" | "updated_at"
  >
) {
  const defaultAuthorizationStatus =
    source === "screenTime" ? "not_determined" : "pending";
  return {
    id: `pairsrc_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    pairing_session_id: pairing.id,
    user_id: pairing.user_id,
    source_key: source,
    desired_enabled: 1,
    applied_enabled: pairing.paired_at ? 1 : 0,
    authorization_status: defaultAuthorizationStatus,
    sync_eligible: 0,
    last_observed_at: pairing.paired_at ?? null,
    metadata_json: "{}",
    created_at: pairing.updated_at,
    updated_at: pairing.updated_at
  } satisfies PairingSourceStateRow;
}

function ensurePairingSourceStates(pairing: PairingSessionRow) {
  const existing = listPairingSourceStateRows(pairing.id);
  const bySource = new Map(existing.map((row) => [row.source_key, row]));
  const missing = companionSourceKeySchema.options.filter(
    (source) => bySource.has(source) === false
  );
  if (missing.length > 0) {
    const insert = getDatabase().prepare(
      `INSERT INTO companion_pairing_source_states (
         id, pairing_session_id, user_id, source_key, desired_enabled, applied_enabled,
         authorization_status, sync_eligible, last_observed_at, metadata_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const source of missing) {
      const row = defaultCompanionSourceState(source, pairing);
      insert.run(
        row.id,
        row.pairing_session_id,
        row.user_id,
        row.source_key,
        row.desired_enabled,
        row.applied_enabled,
        row.authorization_status,
        row.sync_eligible,
        row.last_observed_at,
        row.metadata_json,
        row.created_at,
        row.updated_at
      );
    }
  }
  const refreshed = listPairingSourceStateRows(pairing.id);
  return companionSourceStatesSchema.parse(
    refreshed.reduce<Record<string, unknown>>((accumulator, row) => {
      accumulator[row.source_key] = {
        desiredEnabled: row.desired_enabled === 1,
        appliedEnabled: row.applied_enabled === 1,
        authorizationStatus: row.authorization_status,
        syncEligible: row.sync_eligible === 1,
        lastObservedAt: row.last_observed_at,
        metadata: safeJsonParse<Record<string, unknown>>(row.metadata_json, {})
      };
      return accumulator;
    }, {})
  );
}

function upsertPairingSourceState(
  pairing: PairingSessionRow,
  source: z.infer<typeof companionSourceKeySchema>,
  patch: Partial<
    z.infer<typeof companionSourceStateSchema> & {
      metadata: Record<string, unknown>;
    }
  >
) {
  ensurePairingSourceStates(pairing);
  const current = listPairingSourceStateRows(pairing.id).find(
    (row) => row.source_key === source
  );
  if (!current) {
    throw new Error(`Missing companion pairing source state for ${source}`);
  }
  const nextMetadata =
    patch.metadata != null
      ? {
          ...safeJsonParse<Record<string, unknown>>(current.metadata_json, {}),
          ...patch.metadata
        }
      : safeJsonParse<Record<string, unknown>>(current.metadata_json, {});
  const nextDesiredEnabled =
    patch.desiredEnabled ?? current.desired_enabled === 1;
  const nextAppliedEnabled =
    patch.appliedEnabled ?? current.applied_enabled === 1;
  const nextSyncEligible = patch.syncEligible ?? current.sync_eligible === 1;
  const nextUpdatedAt = nowIso();
  getDatabase()
    .prepare(
      `UPDATE companion_pairing_source_states
       SET desired_enabled = ?, applied_enabled = ?, authorization_status = ?,
           sync_eligible = ?, last_observed_at = ?, metadata_json = ?, updated_at = ?
       WHERE pairing_session_id = ? AND source_key = ?`
    )
    .run(
      nextDesiredEnabled ? 1 : 0,
      nextAppliedEnabled ? 1 : 0,
      patch.authorizationStatus ?? current.authorization_status,
      nextSyncEligible ? 1 : 0,
      patch.lastObservedAt ?? current.last_observed_at,
      JSON.stringify(nextMetadata),
      nextUpdatedAt,
      pairing.id,
      source
    );
  const refreshedPairing = getDatabase()
    .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
    .get(pairing.id) as PairingSessionRow;
  return mapPairingSession(refreshedPairing);
}

function dayKey(value: string) {
  return value.slice(0, 10);
}

function diffMinutes(left: string, right: string) {
  return Math.round(Math.abs(Date.parse(left) - Date.parse(right)) / 60_000);
}

function average(values: number[]) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function round(value: number, digits = 0) {
  return Number(value.toFixed(digits));
}

function unionDurationSeconds(
  intervals: Array<{ startedAt: string; endedAt: string }>
) {
  if (intervals.length === 0) {
    return 0;
  }
  const sorted = [...intervals].sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt)
  );
  const merged: Array<{ startedAt: string; endedAt: string }> = [sorted[0]!];
  for (const interval of sorted.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (Date.parse(interval.startedAt) <= Date.parse(last.endedAt)) {
      last.endedAt =
        Date.parse(interval.endedAt) > Date.parse(last.endedAt)
          ? interval.endedAt
          : last.endedAt;
      continue;
    }
    merged.push({ ...interval });
  }
  return merged.reduce(
    (total, interval) =>
      total + durationSecondsBetween(interval.startedAt, interval.endedAt),
    0
  );
}

function resolveTimeZone(timeZone: string | null | undefined) {
  const candidate = timeZone?.trim();
  if (!candidate) {
    return "UTC";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(
      new Date()
    );
    return candidate;
  } catch {
    return "UTC";
  }
}

function getTimeZoneParts(value: string, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: Number(read("hour")),
    minute: Number(read("minute"))
  };
}

function localDateKeyForTimezone(value: string, timeZone: string) {
  const parts = getTimeZoneParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function mergeStringLists(...groups: Array<string[] | null | undefined>) {
  return [
    ...new Set(
      groups
        .flatMap((group) => group ?? [])
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ];
}

function mergeHealthLinks(
  ...groups: Array<Array<z.infer<typeof healthLinkSchema>> | null | undefined>
) {
  const deduped = new Map<string, z.infer<typeof healthLinkSchema>>();
  for (const group of groups) {
    for (const link of group ?? []) {
      const parsed = healthLinkSchema.safeParse(link);
      if (!parsed.success) {
        continue;
      }
      const value = parsed.data;
      deduped.set(
        `${value.entityType}:${value.entityId}:${value.relationshipType}`,
        value
      );
    }
  }
  return [...deduped.values()];
}

function mergeSleepAnnotationPayloads(
  annotations: Array<Record<string, unknown> | null | undefined>,
  links: Array<Array<z.infer<typeof healthLinkSchema>> | null | undefined>
) {
  const qualitySummary = Array.from(
    new Set(
      annotations
        .map((entry) =>
          typeof entry?.qualitySummary === "string"
            ? entry.qualitySummary.trim()
            : ""
        )
        .filter(Boolean)
    )
  ).join("\n\n");
  const notes = Array.from(
    new Set(
      annotations
        .map((entry) =>
          typeof entry?.notes === "string" ? entry.notes.trim() : ""
        )
        .filter(Boolean)
    )
  ).join("\n\n");
  const tags = mergeStringLists(
    ...annotations.map((entry) =>
      Array.isArray(entry?.tags) ? (entry?.tags as string[]) : []
    )
  );
  const mergedLinks = mergeHealthLinks(
    ...links,
    ...annotations.map((entry) =>
      Array.isArray(entry?.links)
        ? (entry?.links as Array<z.infer<typeof healthLinkSchema>>)
        : []
    )
  );
  return {
    qualitySummary,
    notes,
    tags,
    links: mergedLinks
  };
}

function sleepMinutesOfDay(
  value: string,
  mode: "bedtime" | "wake",
  timeZone = "UTC"
) {
  const parts = getTimeZoneParts(value, resolveTimeZone(timeZone));
  const minutes = parts.hour * 60 + parts.minute;
  if (mode === "bedtime" && minutes < 12 * 60) {
    return minutes + 24 * 60;
  }
  return minutes;
}

function computeSleepDerivedMetrics(input: {
  asleepSeconds: number;
  timeInBedSeconds: number;
  awakeSeconds: number;
  sleepScore: number;
  stageBreakdown: Array<{ stage: string; seconds: number }>;
}) {
  const efficiency =
    input.timeInBedSeconds > 0
      ? input.asleepSeconds / input.timeInBedSeconds
      : 0;
  const restorativeSeconds = input.stageBreakdown
    .filter((stage) => {
      const label = stage.stage.toLowerCase();
      return label.includes("deep") || label.includes("rem");
    })
    .reduce((total, stage) => total + stage.seconds, 0);
  const restorativeShare =
    input.asleepSeconds > 0 ? restorativeSeconds / input.asleepSeconds : 0;
  const sleepDebtHours =
    input.asleepSeconds > 0 ? Math.max(0, 8 - input.asleepSeconds / 3600) : 8;

  return {
    durationHours: round(input.asleepSeconds / 3600, 2),
    efficiency: round(efficiency, 3),
    restorativeShare: round(restorativeShare, 3),
    awakeRatio:
      input.asleepSeconds > 0
        ? round(input.awakeSeconds / input.asleepSeconds, 3)
        : 0,
    sleepDebtHours: round(sleepDebtHours, 2),
    recoveryState:
      input.sleepScore >= 82
        ? "recovered"
        : input.sleepScore >= 68
          ? "stable"
          : input.sleepScore >= 52
            ? "strained"
            : "depleted"
  };
}

function computeSleepTimingMetrics(input: {
  userId: string;
  startedAt: string;
  endedAt: string;
  sourceTimezone?: string;
  excludeSleepId?: string;
}) {
  const sourceTimezone = resolveTimeZone(input.sourceTimezone);
  const params: string[] = [input.userId];
  const excludeSql = input.excludeSleepId ? "AND id != ?" : "";
  if (input.excludeSleepId) {
    params.push(input.excludeSleepId);
  }
  const rows = getDatabase()
    .prepare(
      `SELECT id, started_at, ended_at
       FROM health_sleep_sessions
       WHERE user_id = ?
         ${excludeSql}
       ORDER BY started_at DESC
       LIMIT 14`
    )
    .all(...params) as Array<{
    id: string;
    started_at: string;
    ended_at: string;
  }>;

  if (rows.length === 0) {
    return {
      bedtimeConsistencyMinutes: null,
      wakeConsistencyMinutes: null,
      regularityScore: computeRegularityScore(input.startedAt, sourceTimezone)
    };
  }

  const bedtimeReference = average(
    rows.map((row) =>
      sleepMinutesOfDay(row.started_at, "bedtime", sourceTimezone)
    )
  );
  const wakeReference = average(
    rows.map((row) => sleepMinutesOfDay(row.ended_at, "wake", sourceTimezone))
  );
  const bedtimeConsistencyMinutes = Math.round(
    Math.abs(
      sleepMinutesOfDay(input.startedAt, "bedtime", sourceTimezone) -
        bedtimeReference
    )
  );
  const wakeConsistencyMinutes = Math.round(
    Math.abs(
      sleepMinutesOfDay(input.endedAt, "wake", sourceTimezone) - wakeReference
    )
  );
  const regularityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 - average([bedtimeConsistencyMinutes, wakeConsistencyMinutes]) / 1.8
      )
    )
  );

  return {
    bedtimeConsistencyMinutes,
    wakeConsistencyMinutes,
    regularityScore
  };
}

function computeSleepScore(input: {
  asleepSeconds: number;
  timeInBedSeconds: number;
  awakeSeconds: number;
  stageBreakdown: Array<{ stage: string; seconds: number }>;
}) {
  if (input.asleepSeconds <= 0) {
    return 0;
  }
  const efficiency =
    input.timeInBedSeconds > 0
      ? input.asleepSeconds / input.timeInBedSeconds
      : 1;
  const deepSeconds = input.stageBreakdown
    .filter((stage) => stage.stage.toLowerCase().includes("deep"))
    .reduce((total, stage) => total + stage.seconds, 0);
  const remSeconds = input.stageBreakdown
    .filter((stage) => stage.stage.toLowerCase().includes("rem"))
    .reduce((total, stage) => total + stage.seconds, 0);
  const restorativeRatio = (deepSeconds + remSeconds) / input.asleepSeconds;
  const wakePenalty =
    input.asleepSeconds > 0 ? input.awakeSeconds / input.asleepSeconds : 0;
  const durationHours = input.asleepSeconds / 3600;
  const durationScore = Math.max(0, 1 - Math.abs(durationHours - 8) / 4);
  return Math.round(
    Math.max(
      0,
      Math.min(
        100,
        45 * efficiency +
          25 * durationScore +
          20 * Math.min(1, restorativeRatio * 1.5) +
          10 * Math.max(0, 1 - wakePenalty)
      )
    )
  );
}

function computeRegularityScore(startedAt: string, timeZone = "UTC") {
  const parts = getTimeZoneParts(startedAt, resolveTimeZone(timeZone));
  const bedtimeMinutes = parts.hour * 60 + parts.minute;
  const distanceFromTarget = Math.min(
    Math.abs(bedtimeMinutes - 22 * 60 - 30),
    Math.abs(bedtimeMinutes - (24 * 60 + 22 * 60 + 30))
  );
  return Math.round(Math.max(0, 100 - distanceFromTarget / 3));
}

function mapPairingSession(row: PairingSessionRow) {
  const stale =
    row.last_sync_at &&
    Date.now() - Date.parse(row.last_sync_at) > 1000 * 60 * 60 * 24;
  const effectiveStatus =
    row.status === "healthy" && stale ? "stale" : row.status;
  const sourceStates = ensurePairingSourceStates(row);
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    status: pairingStatusSchema.parse(effectiveStatus),
    capabilities: safeJsonParse<string[]>(row.capability_flags_json, []),
    deviceName: row.device_name,
    platform: row.platform,
    appVersion: row.app_version,
    apiBaseUrl: row.api_base_url,
    lastSeenAt: row.last_seen_at,
    lastSyncAt: row.last_sync_at,
    lastSyncError: row.last_sync_error,
    pairedAt: row.paired_at,
    sourceStates,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSleepSession(row: SleepSessionRow) {
  return {
    id: row.id,
    externalUid: row.external_uid,
    pairingSessionId: row.pairing_session_id,
    userId: row.user_id,
    source: row.source,
    sourceType: row.source_type,
    sourceDevice: row.source_device,
    sourceTimezone: row.source_timezone,
    localDateKey: row.local_date_key || dayKey(row.ended_at),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    timeInBedSeconds: row.time_in_bed_seconds,
    asleepSeconds: row.asleep_seconds,
    awakeSeconds: row.awake_seconds,
    rawSegmentCount: row.raw_segment_count,
    sleepScore: row.sleep_score,
    regularityScore: row.regularity_score,
    bedtimeConsistencyMinutes: row.bedtime_consistency_minutes,
    wakeConsistencyMinutes: row.wake_consistency_minutes,
    stageBreakdown: safeJsonParse<Array<{ stage: string; seconds: number }>>(
      row.stage_breakdown_json,
      []
    ),
    recoveryMetrics: safeJsonParse<Record<string, unknown>>(
      row.recovery_metrics_json,
      {}
    ),
    sourceMetrics: safeJsonParse<Record<string, unknown>>(
      row.source_metrics_json,
      {}
    ),
    links: safeJsonParse<Array<z.infer<typeof healthLinkSchema>>>(
      row.links_json,
      []
    ),
    annotations: safeJsonParse(row.annotations_json, {}),
    provenance: safeJsonParse(row.provenance_json, {}),
    derived: safeJsonParse(row.derived_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSleepSegment(row: SleepSegmentRow) {
  return {
    id: row.id,
    externalUid: row.external_uid,
    importRunId: row.import_run_id,
    pairingSessionId: row.pairing_session_id,
    sleepSessionId: row.sleep_session_id,
    userId: row.user_id,
    source: row.source,
    sourceType: row.source_type,
    sourceDevice: row.source_device,
    sourceTimezone: row.source_timezone,
    localDateKey: row.local_date_key,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    stage: row.stage,
    bucket: row.bucket,
    sourceValue: row.source_value,
    qualityKind: row.quality_kind as
      | "provider_native"
      | "historical_import"
      | "reconstructed",
    sourceRecordIds: safeJsonParse<string[]>(row.source_record_ids_json, []),
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
    provenance: safeJsonParse<Record<string, unknown>>(row.provenance_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSleepSourceRecord(row: SleepSourceRecordRow) {
  return {
    id: row.id,
    importRunId: row.import_run_id,
    pairingSessionId: row.pairing_session_id,
    sleepSessionId: row.sleep_session_id,
    userId: row.user_id,
    provider: row.provider,
    providerRecordType: row.provider_record_type,
    providerRecordUid: row.provider_record_uid,
    sourceDevice: row.source_device,
    sourceTimezone: row.source_timezone,
    localDateKey: row.local_date_key,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    rawStage: row.raw_stage,
    rawValue: row.raw_value,
    qualityKind: row.quality_kind as
      | "provider_native"
      | "historical_import"
      | "reconstructed",
    payload: safeJsonParse<Record<string, unknown>>(row.payload_json, {}),
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
    ingestedAt: row.ingested_at
  };
}

function mapSleepRawLog(row: SleepRawLogRow) {
  return {
    id: row.id,
    importRunId: row.import_run_id,
    pairingSessionId: row.pairing_session_id,
    sleepSessionId: row.sleep_session_id,
    userId: row.user_id,
    source: row.source,
    logType: row.log_type,
    externalUid: row.external_uid,
    sourceTimezone: row.source_timezone,
    localDateKey: row.local_date_key,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    payload: safeJsonParse<Record<string, unknown>>(row.payload_json, {}),
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at
  };
}

type MappedSleepSession = ReturnType<typeof mapSleepSession>;
type MappedSleepSegment = ReturnType<typeof mapSleepSegment>;
type MappedSleepSourceRecord = ReturnType<typeof mapSleepSourceRecord>;

function mapWorkoutSession(
  row: WorkoutSessionRow,
  options: { includeAnalytics?: boolean } = {}
) {
  const provenance = safeJsonParse<Record<string, unknown>>(
    row.provenance_json,
    {}
  );
  const derived = safeJsonParse<Record<string, unknown>>(row.derived_json, {});
  const includeAnalytics = options.includeAnalytics ?? true;
  const analytics = includeAnalytics
    ? getStoredWorkoutAnalytics(row)
    : undefined;
  const presentation = buildWorkoutSessionPresentation({
    source: row.source,
    sourceType: row.source_type,
    workoutType: row.workout_type,
    provenance,
    derived
  });
  return {
    id: row.id,
    externalUid: row.external_uid,
    pairingSessionId: row.pairing_session_id,
    userId: row.user_id,
    source: row.source,
    sourceType: row.source_type,
    sourceSystem: presentation.sourceSystem,
    sourceBundleIdentifier: presentation.sourceBundleIdentifier,
    sourceProductType: presentation.sourceProductType,
    workoutType: presentation.workoutType,
    workoutTypeLabel: presentation.workoutTypeLabel,
    activityFamily: presentation.activityFamily,
    activityFamilyLabel: presentation.activityFamilyLabel,
    activity: presentation.activity,
    details: presentation.details,
    sourceDevice: row.source_device,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    activeEnergyKcal: row.active_energy_kcal,
    totalEnergyKcal: row.total_energy_kcal,
    distanceMeters: row.distance_meters,
    stepCount: row.step_count,
    exerciseMinutes: row.exercise_minutes,
    averageHeartRate: row.average_heart_rate,
    maxHeartRate: row.max_heart_rate,
    subjectiveEffort: row.subjective_effort,
    moodBefore: row.mood_before,
    moodAfter: row.mood_after,
    meaningText: row.meaning_text,
    plannedContext: row.planned_context,
    socialContext: row.social_context,
    links: safeJsonParse<Array<z.infer<typeof healthLinkSchema>>>(
      row.links_json,
      []
    ),
    tags: safeJsonParse<string[]>(row.tags_json, []),
    annotations: safeJsonParse(row.annotations_json, {}),
    provenance,
    derived,
    ...(analytics ? { analytics } : {}),
    generatedFromHabitId: row.generated_from_habit_id,
    generatedFromCheckInId: row.generated_from_check_in_id,
    reconciliationStatus: row.reconciliation_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapHealthImportRun(row: HealthImportRunRow) {
  return {
    id: row.id,
    pairingSessionId: row.pairing_session_id,
    userId: row.user_id,
    source: row.source,
    sourceDevice: row.source_device,
    status: row.status,
    payloadSummary: safeJsonParse<Record<string, unknown>>(
      row.payload_summary_json,
      {}
    ),
    importedCount: row.imported_count,
    createdCount: row.created_count,
    updatedCount: row.updated_count,
    mergedCount: row.merged_count,
    errorMessage: row.error_message,
    importedAt: row.imported_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listSleepRows(userIds?: string[]) {
  ensureLegacyAppleSleepHistoryRepaired();
  const params: Array<string> = [];
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
       FROM health_sleep_sessions
       ${where}
       ORDER BY started_at DESC`
    )
    .all(...params) as SleepSessionRow[];
}

export function getSleepTimelineOverlaysForRange(input: {
  startedAt: string;
  endedAt: string;
  userIds?: string[];
}) {
  const rangeStartMs = Date.parse(input.startedAt);
  const rangeEndMs = Date.parse(input.endedAt);
  if (
    Number.isNaN(rangeStartMs) ||
    Number.isNaN(rangeEndMs) ||
    rangeEndMs <= rangeStartMs
  ) {
    return [];
  }
  return listSleepRows(input.userIds)
    .map((row) => mapSleepSession(row))
    .filter((session) => {
      const sessionStartMs = Date.parse(session.startedAt);
      const sessionEndMs = Date.parse(session.endedAt);
      if (Number.isNaN(sessionStartMs) || Number.isNaN(sessionEndMs)) {
        return false;
      }
      return sessionStartMs < rangeEndMs && sessionEndMs > rangeStartMs;
    })
    .sort((left, right) => {
      const startedDelta =
        Date.parse(left.startedAt) - Date.parse(right.startedAt);
      if (startedDelta !== 0) {
        return startedDelta;
      }
      const endedDelta = Date.parse(left.endedAt) - Date.parse(right.endedAt);
      if (endedDelta !== 0) {
        return endedDelta;
      }
      return left.id.localeCompare(right.id);
    })
    .map((session) => {
      const derived = session.derived as Record<string, unknown> | undefined;
      return {
        id: session.id,
        externalUid: session.externalUid,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        localDateKey: session.localDateKey,
        sourceTimezone: session.sourceTimezone,
        asleepSeconds: session.asleepSeconds,
        timeInBedSeconds: session.timeInBedSeconds,
        sleepScore: session.sleepScore,
        regularityScore: session.regularityScore,
        efficiency:
          typeof derived?.efficiency === "number" ? derived.efficiency : null,
        recoveryState:
          typeof derived?.recoveryState === "string"
            ? derived.recoveryState
            : null
      };
    });
}

function listWorkoutRows(userIds?: string[]) {
  const params: Array<string> = [];
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
       FROM health_workout_sessions
       ${where}
       ORDER BY started_at DESC`
    )
    .all(...params) as WorkoutSessionRow[];
}

function listDailySummaryRows(summaryType: string, userIds?: string[]) {
  const params: Array<string> = [summaryType];
  const where =
    userIds && userIds.length > 0
      ? `AND user_id IN (${userIds.map(() => "?").join(",")})`
      : "";
  if (userIds) {
    params.push(...userIds);
  }
  return getDatabase()
    .prepare(
      `SELECT *
       FROM health_daily_summaries
       WHERE summary_type = ?
       ${where}
       ORDER BY date_key DESC, updated_at DESC`
    )
    .all(...params) as DailySummaryRow[];
}

function listSleepSegmentRowsBySleepId(sleepId: string) {
  return getDatabase()
    .prepare(
      `SELECT *
       FROM health_sleep_segments
       WHERE sleep_session_id = ?
       ORDER BY started_at ASC, ended_at ASC`
    )
    .all(sleepId) as SleepSegmentRow[];
}

function listSleepSourceRecordRowsBySleepId(sleepId: string) {
  return getDatabase()
    .prepare(
      `SELECT *
       FROM health_sleep_source_records
       WHERE sleep_session_id = ?
       ORDER BY started_at ASC, ended_at ASC, ingested_at ASC`
    )
    .all(sleepId) as SleepSourceRecordRow[];
}

function listSleepRawLogRowsBySleepId(sleepId: string) {
  return getDatabase()
    .prepare(
      `SELECT *
       FROM health_sleep_raw_logs
       WHERE sleep_session_id = ?
       ORDER BY created_at DESC`
    )
    .all(sleepId) as SleepRawLogRow[];
}

function sleepSessionDateKey(
  row: Pick<SleepSessionRow, "local_date_key" | "ended_at">
) {
  return row.local_date_key || dayKey(row.ended_at);
}

function defaultSleepTimeZone() {
  const runtimeTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return resolveTimeZone(runtimeTimeZone || "UTC");
}

function inferHistoricalSleepTimeZone(
  values: Array<string | null | undefined>
) {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized && normalized.length > 0 && normalized !== "UTC") {
      return resolveTimeZone(normalized);
    }
  }
  return defaultSleepTimeZone();
}

function inferHistoricalRawStage(payload: Record<string, unknown>) {
  const breakdown = Array.isArray(payload.stageBreakdown)
    ? (payload.stageBreakdown as Array<Record<string, unknown>>)
    : [];
  const positiveStages = breakdown.filter(
    (stage) =>
      typeof stage.stage === "string" &&
      typeof stage.seconds === "number" &&
      stage.seconds > 0
  );
  if (positiveStages.length === 1) {
    return (positiveStages[0]?.stage as string) || "asleep_unspecified";
  }
  return "asleep_unspecified";
}

function inferHistoricalSleepBucket(stage: string) {
  const normalized = stage
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (normalized.includes("bed")) {
    return "in_bed" as const;
  }
  if (normalized.includes("awake")) {
    return "awake" as const;
  }
  return "asleep" as const;
}

function sleepRawDataStatus(records: MappedSleepSourceRecord[]) {
  if (records.some((record) => record.qualityKind === "provider_native")) {
    return "provider_raw" as const;
  }
  if (records.length > 0) {
    return "historical_raw" as const;
  }
  return "raw_unavailable" as const;
}

export function listSleepSessions(userIds?: string[]) {
  return listSleepRows(userIds).map(mapSleepSession);
}

export function listWorkoutSessions(userIds?: string[]) {
  return listWorkoutRows(userIds).map((row) => mapWorkoutSession(row));
}

export function getSleepSessionById(sleepId: string) {
  ensureLegacyAppleSleepHistoryRepaired();
  const row = getDatabase()
    .prepare(`SELECT * FROM health_sleep_sessions WHERE id = ?`)
    .get(sleepId) as SleepSessionRow | undefined;
  return row ? mapSleepSession(row) : undefined;
}

function sleepHasReflection(session: MappedSleepSession) {
  const annotations = session.annotations as Record<string, unknown>;
  const tags = Array.isArray(annotations.tags) ? annotations.tags : [];
  return (
    session.links.length > 0 ||
    (typeof annotations.qualitySummary === "string" &&
      annotations.qualitySummary.trim().length > 0) ||
    (typeof annotations.notes === "string" &&
      annotations.notes.trim().length > 0) ||
    tags.length > 0
  );
}

function sleepEfficiency(session: MappedSleepSession) {
  return typeof (session.derived as Record<string, unknown>).efficiency ===
    "number"
    ? ((session.derived as Record<string, unknown>).efficiency as number)
    : session.timeInBedSeconds > 0
      ? session.asleepSeconds / session.timeInBedSeconds
      : 0;
}

function sleepRestorativeShare(session: MappedSleepSession) {
  return typeof (session.derived as Record<string, unknown>)
    .restorativeShare === "number"
    ? ((session.derived as Record<string, unknown>).restorativeShare as number)
    : 0;
}

function sleepRecoveryState(session: MappedSleepSession) {
  return typeof (session.derived as Record<string, unknown>).recoveryState ===
    "string"
    ? ((session.derived as Record<string, unknown>).recoveryState as string) ||
        null
    : null;
}

function sleepQualitativeState(session: MappedSleepSession) {
  const recoveryState = sleepRecoveryState(session);
  if (recoveryState === "recovered") {
    return "Recovered";
  }
  if (recoveryState === "stable") {
    return "Stable";
  }
  if (recoveryState === "strained") {
    return "Strained";
  }
  if (recoveryState === "recharged") {
    return "Recharged";
  }
  if (recoveryState === "steady") {
    return "Steady";
  }
  if (recoveryState === "fragile") {
    return "Fragile";
  }
  if (recoveryState === "depleted") {
    return "Depleted";
  }
  if ((session.sleepScore ?? 0) >= 82) {
    return "Strong";
  }
  if ((session.sleepScore ?? 0) >= 68) {
    return "Stable";
  }
  if ((session.sleepScore ?? 0) >= 52) {
    return "Uneven";
  }
  return "Short";
}

function sleepStageShare(session: MappedSleepSession) {
  return session.stageBreakdown.map((stage) => ({
    stage: stage.stage,
    seconds: stage.seconds,
    percentage:
      session.asleepSeconds > 0
        ? round(stage.seconds / session.asleepSeconds, 3)
        : 0
  }));
}

function buildSleepSurfaceNight(
  session: MappedSleepSession,
  baselineAverageSleepSeconds: number
) {
  return {
    sleepId: session.id,
    dateKey: session.localDateKey,
    sourceTimezone: session.sourceTimezone,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    asleepSeconds: session.asleepSeconds,
    timeInBedSeconds: session.timeInBedSeconds,
    awakeSeconds: session.awakeSeconds,
    rawSegmentCount: session.rawSegmentCount,
    score: session.sleepScore,
    regularity: session.regularityScore,
    efficiency: round(sleepEfficiency(session), 3),
    restorativeShare: round(sleepRestorativeShare(session), 3),
    weeklyAverageSleepSeconds: baselineAverageSleepSeconds,
    deltaFromWeeklyAverageSeconds:
      session.asleepSeconds - baselineAverageSleepSeconds,
    bedtimeDriftMinutes: session.bedtimeConsistencyMinutes,
    wakeDriftMinutes: session.wakeConsistencyMinutes,
    recoveryState: sleepRecoveryState(session),
    qualitativeState: sleepQualitativeState(session),
    hasReflection: sleepHasReflection(session),
    hasRawSegments: session.rawSegmentCount > 0,
    qualitySummary:
      typeof (session.annotations as Record<string, unknown>).qualitySummary ===
      "string"
        ? ((session.annotations as Record<string, unknown>)
            .qualitySummary as string) || null
        : null,
    stageBreakdown: sleepStageShare(session)
  };
}

function buildSleepCalendarDay(session: MappedSleepSession) {
  return {
    dateKey: session.localDateKey,
    sleepId: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    sourceTimezone: session.sourceTimezone,
    sleepHours: Number((session.asleepSeconds / 3600).toFixed(2)),
    score: session.sleepScore,
    regularity: session.regularityScore,
    efficiency: round(sleepEfficiency(session), 3),
    recoveryState: sleepRecoveryState(session),
    hasReflection: sleepHasReflection(session),
    hasRawSegments: session.rawSegmentCount > 0
  };
}

function pickDisplaySleepSessions(sessions: MappedSleepSession[]) {
  const byDateKey = new Map<string, MappedSleepSession>();
  for (const session of sessions) {
    const key = session.localDateKey || dayKey(session.endedAt);
    const current = byDateKey.get(key);
    if (!current) {
      byDateKey.set(key, session);
      continue;
    }
    const currentHasRawSegments = current.rawSegmentCount > 0 ? 1 : 0;
    const nextHasRawSegments = session.rawSegmentCount > 0 ? 1 : 0;
    const currentIsProviderBacked =
      current.sourceType !== "healthkit_repaired" ? 1 : 0;
    const nextIsProviderBacked =
      session.sourceType !== "healthkit_repaired" ? 1 : 0;
    const shouldReplace =
      nextIsProviderBacked > currentIsProviderBacked ||
      (nextIsProviderBacked === currentIsProviderBacked &&
        session.asleepSeconds > current.asleepSeconds) ||
      (session.asleepSeconds === current.asleepSeconds &&
        nextHasRawSegments > currentHasRawSegments) ||
      (session.asleepSeconds === current.asleepSeconds &&
        nextHasRawSegments === currentHasRawSegments &&
        Date.parse(session.endedAt) > Date.parse(current.endedAt));
    if (shouldReplace) {
      byDateKey.set(key, session);
    }
  }
  return [...byDateKey.values()].sort(
    (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt)
  );
}

function normalizeTimelineStage(
  stage: string,
  bucket: MappedSleepSegment["bucket"]
): "awake" | "core" | "deep" | "rem" | "in_bed" | "asleep_unspecified" {
  const normalized = stage
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (bucket === "in_bed" || normalized.includes("bed")) {
    return "in_bed";
  }
  if (bucket === "awake" || normalized.includes("awake")) {
    return "awake";
  }
  if (normalized.includes("rem")) {
    return "rem";
  }
  if (normalized.includes("deep")) {
    return "deep";
  }
  if (normalized.includes("core") || normalized.includes("light")) {
    return "core";
  }
  return "asleep_unspecified";
}

function timelineStagePriority(
  stage: ReturnType<typeof normalizeTimelineStage>
) {
  switch (stage) {
    case "awake":
      return 5;
    case "rem":
      return 4;
    case "deep":
      return 3;
    case "core":
      return 2;
    case "asleep_unspecified":
      return 1;
    default:
      return 0;
  }
}

function timelineStageLabel(stage: ReturnType<typeof normalizeTimelineStage>) {
  switch (stage) {
    case "awake":
      return "Awake";
    case "core":
      return "Core";
    case "deep":
      return "Deep";
    case "rem":
      return "REM";
    case "in_bed":
      return "In bed";
    default:
      return "Asleep";
  }
}

function buildSleepPhaseTimeline(
  sleep: MappedSleepSession,
  rawSegments: MappedSleepSegment[]
) {
  const sessionStartMs = Date.parse(sleep.startedAt);
  const sessionEndMs = Date.parse(sleep.endedAt);
  const totalSeconds = Math.max(
    1,
    durationSecondsBetween(sleep.startedAt, sleep.endedAt)
  );
  const segments = rawSegments
    .map((segment) => {
      const startedMs = Math.max(sessionStartMs, Date.parse(segment.startedAt));
      const endedMs = Math.min(sessionEndMs, Date.parse(segment.endedAt));
      return {
        ...segment,
        startedMs,
        endedMs,
        normalizedStage: normalizeTimelineStage(segment.stage, segment.bucket)
      };
    })
    .filter((segment) => Number.isFinite(segment.startedMs))
    .filter((segment) => Number.isFinite(segment.endedMs))
    .filter((segment) => segment.endedMs > segment.startedMs);
  if (segments.length === 0) {
    return {
      startedAt: sleep.startedAt,
      endedAt: sleep.endedAt,
      totalSeconds,
      hasRawSegments: false,
      hasSleepStageData: false,
      blocks: [] as Array<{
        id: string;
        stage: string;
        label: string;
        lane: "sleep" | "in_bed";
        startedAt: string;
        endedAt: string;
        durationSeconds: number;
        offsetRatio: number;
        widthRatio: number;
      }>
    };
  }

  const boundaries = new Set<number>([sessionStartMs, sessionEndMs]);
  for (const segment of segments) {
    boundaries.add(segment.startedMs);
    boundaries.add(segment.endedMs);
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  const blocks: Array<{
    id: string;
    stage: string;
    label: string;
    lane: "sleep" | "in_bed";
    startedAt: string;
    endedAt: string;
    durationSeconds: number;
    offsetRatio: number;
    widthRatio: number;
  }> = [];
  const lastIndexByLane = new Map<"sleep" | "in_bed", number>();

  const pushBlock = (
    lane: "sleep" | "in_bed",
    stage: ReturnType<typeof normalizeTimelineStage>,
    startedMs: number,
    endedMs: number
  ) => {
    const startedAt = new Date(startedMs).toISOString();
    const endedAt = new Date(endedMs).toISOString();
    const lastIndex = lastIndexByLane.get(lane);
    if (lastIndex !== undefined) {
      const previous = blocks[lastIndex];
      if (
        previous &&
        previous.stage === stage &&
        previous.endedAt === startedAt
      ) {
        previous.endedAt = endedAt;
        previous.durationSeconds += Math.max(
          0,
          Math.round((endedMs - startedMs) / 1000)
        );
        previous.widthRatio = round(
          Math.max(0.002, previous.durationSeconds / totalSeconds),
          6
        );
        return;
      }
    }
    const durationSeconds = Math.max(
      0,
      Math.round((endedMs - startedMs) / 1000)
    );
    blocks.push({
      id: `${lane}_${blocks.length + 1}`,
      stage,
      label: timelineStageLabel(stage),
      lane,
      startedAt,
      endedAt,
      durationSeconds,
      offsetRatio: round(
        (startedMs - sessionStartMs) / (totalSeconds * 1000),
        6
      ),
      widthRatio: round(Math.max(0.002, durationSeconds / totalSeconds), 6)
    });
    lastIndexByLane.set(lane, blocks.length - 1);
  };

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const startedMs = ordered[index]!;
    const endedMs = ordered[index + 1]!;
    if (endedMs <= startedMs) {
      continue;
    }
    const covering = segments.filter(
      (segment) => segment.startedMs <= startedMs && segment.endedMs >= endedMs
    );
    if (covering.length === 0) {
      continue;
    }
    const hasInBedCoverage = covering.some(
      (segment) => segment.normalizedStage === "in_bed"
    );
    const sleepStage = covering
      .map((segment) => segment.normalizedStage)
      .filter(
        (
          stage
        ): stage is Exclude<
          ReturnType<typeof normalizeTimelineStage>,
          "in_bed"
        > => stage !== "in_bed"
      )
      .sort(
        (left, right) =>
          timelineStagePriority(right) - timelineStagePriority(left)
      )[0];
    if (hasInBedCoverage) {
      pushBlock("in_bed", "in_bed", startedMs, endedMs);
    }
    if (sleepStage) {
      pushBlock("sleep", sleepStage, startedMs, endedMs);
    }
  }

  return {
    startedAt: sleep.startedAt,
    endedAt: sleep.endedAt,
    totalSeconds,
    hasRawSegments: true,
    hasSleepStageData: blocks.some((block) => block.lane === "sleep"),
    blocks
  };
}

export function getSleepSessionDetailById(sleepId: string) {
  const sleep = getSleepSessionById(sleepId);
  if (!sleep) {
    return undefined;
  }
  const segments = listSleepSegmentRowsBySleepId(sleepId).map(mapSleepSegment);
  const sourceRecords =
    listSleepSourceRecordRowsBySleepId(sleepId).map(mapSleepSourceRecord);
  return {
    sleep,
    phaseTimeline: buildSleepPhaseTimeline(sleep, segments),
    segments,
    sourceRecords,
    rawDataStatus: sleepRawDataStatus(sourceRecords),
    auditLogs: listSleepRawLogRowsBySleepId(sleepId).map(mapSleepRawLog)
  };
}

export function getWorkoutSessionById(workoutId: string) {
  const row = getDatabase()
    .prepare(`SELECT * FROM health_workout_sessions WHERE id = ?`)
    .get(workoutId) as WorkoutSessionRow | undefined;
  return row ? mapWorkoutSession(row) : undefined;
}

export function getWorkoutSessionDetailById(
  workoutId: string,
  resolution: "adaptive" | "raw" = "adaptive"
) {
  const row = getDatabase()
    .prepare(`SELECT * FROM health_workout_sessions WHERE id = ?`)
    .get(workoutId) as WorkoutSessionRow | undefined;
  if (!row) {
    return undefined;
  }
  const workout = mapWorkoutSession(row);
  return {
    workout,
    analytics: getStoredWorkoutAnalytics(row),
    evidence: getWorkoutRawEvidence(row, resolution),
    zoneProfile: getHealthZoneProfile(row.user_id)
  };
}

export { healthZoneProfilePatchSchema };

export function getHealthZoneProfileForUser(userId: string) {
  return getHealthZoneProfile(userId);
}

export function patchHealthZoneProfileForUser(
  userId: string,
  patch: z.infer<typeof healthZoneProfilePatchSchema>
) {
  return patchHealthZoneProfile(userId, patch);
}

function listPairingRows(userIds?: string[]) {
  const params: Array<string> = [];
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
       FROM companion_pairing_sessions
       ${where}
       ORDER BY updated_at DESC, created_at DESC`
    )
    .all(...params) as PairingSessionRow[];
}

function revokePairingRows(
  rows: PairingSessionRow[],
  activity?: ActivityContext & { reason?: string }
) {
  if (rows.length === 0) {
    return [] as Array<ReturnType<typeof mapPairingSession>>;
  }
  const now = nowIso();
  const reason = activity?.reason ?? "Revoked by operator";
  const revokeStatement = getDatabase().prepare(
    `UPDATE companion_pairing_sessions
     SET status = 'revoked', last_sync_error = ?, updated_at = ?
     WHERE id = ?`
  );
  const refetchStatement = getDatabase().prepare(
    `SELECT * FROM companion_pairing_sessions WHERE id = ?`
  );

  for (const row of rows) {
    revokeStatement.run(reason, now, row.id);
    recordActivityEvent({
      entityType: "system",
      entityId: row.id,
      eventType: "companion_pairing_revoked",
      title: "Companion pairing revoked",
      description:
        "An operator revoked a Forge Companion pairing session and blocked further syncs for that device.",
      actor: activity?.actor ?? null,
      source: activity?.source ?? "ui",
      metadata: {
        label: row.label,
        deviceName: row.device_name,
        platform: row.platform
      }
    });
  }

  return rows.map((row) =>
    mapPairingSession(refetchStatement.get(row.id) as PairingSessionRow)
  );
}

function listHealthImportRunRows(userIds?: string[], limit = 12) {
  const params: Array<string | number> = [];
  const where =
    userIds && userIds.length > 0
      ? `WHERE user_id IN (${userIds.map(() => "?").join(",")})`
      : "";
  if (userIds) {
    params.push(...userIds);
  }
  params.push(limit);
  return getDatabase()
    .prepare(
      `SELECT *
       FROM health_import_runs
       ${where}
       ORDER BY imported_at DESC, created_at DESC
       LIMIT ?`
    )
    .all(...params) as HealthImportRunRow[];
}

export function listPairingSessions(userIds?: string[]) {
  return listPairingRows(userIds).map(mapPairingSession);
}

export function getCompanionPairingSessionById(pairingSessionId: string) {
  const row = getDatabase()
    .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
    .get(pairingSessionId) as PairingSessionRow | undefined;
  return row ? mapPairingSession(row) : undefined;
}

export function revokeCompanionPairingSession(
  pairingSessionId: string,
  activity?: ActivityContext
) {
  const current = getDatabase()
    .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
    .get(pairingSessionId) as PairingSessionRow | undefined;
  if (!current) {
    return undefined;
  }
  return revokePairingRows([current], activity)[0];
}

export function revokeAllCompanionPairingSessions(
  input?: z.infer<typeof revokeAllCompanionPairingSessionsSchema>,
  activity?: ActivityContext
) {
  const parsed = revokeAllCompanionPairingSessionsSchema.parse(input ?? {});
  const rows = listPairingRows(
    parsed.userIds.length > 0 ? parsed.userIds : undefined
  ).filter((row) => parsed.includeRevoked || row.status !== "revoked");
  const sessions = revokePairingRows(rows, {
    actor: activity?.actor ?? null,
    source: activity?.source ?? "ui",
    reason: "Revoked by operator (bulk)"
  });
  return {
    revokedCount: sessions.length,
    sessions
  };
}

export function patchCompanionPairingSourceState(
  pairingSessionId: string,
  source: z.infer<typeof companionSourceKeySchema>,
  patch: z.infer<typeof patchCompanionPairingSourceStateSchema>
) {
  const pairing = getDatabase()
    .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
    .get(pairingSessionId) as PairingSessionRow | undefined;
  if (!pairing) {
    return undefined;
  }
  return upsertPairingSourceState(pairing, source, {
    desiredEnabled: patch.desiredEnabled,
    metadata: {
      desiredEnabledUpdatedAt: nowIso(),
      desiredEnabledUpdatedBy: "forge_web"
    }
  });
}

export function updateMobileCompanionSourceState(
  payload: z.infer<typeof updateMobileCompanionSourceStateSchema>
) {
  const parsed = updateMobileCompanionSourceStateSchema.parse(payload);
  const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
  return upsertPairingSourceState(pairing, parsed.source, {
    desiredEnabled: parsed.desiredEnabled,
    appliedEnabled: parsed.appliedEnabled,
    authorizationStatus: parsed.authorizationStatus,
    syncEligible: parsed.syncEligible,
    lastObservedAt: parsed.lastObservedAt ?? nowIso(),
    metadata: {
      ...parsed.metadata,
      source: "companion"
    }
  });
}

export function createCompanionPairingSession(
  pairingTransport:
    | string
    | {
        apiBaseUrl: string;
        uiBaseUrl?: string | null;
        transportMode?: "iroh" | "manual-http";
        transport?: Record<string, unknown>;
      },
  input: z.infer<typeof createCompanionPairingSessionSchema>
) {
  const parsed = createCompanionPairingSessionSchema.parse(input);
  const resolvedTransport =
    typeof pairingTransport === "string"
      ? {
          apiBaseUrl: pairingTransport,
          uiBaseUrl: null,
          transportMode: "manual-http" as const,
          transport: undefined
        }
      : pairingTransport;
  const baseApiUrl = resolvedTransport.apiBaseUrl;
  const now = new Date();
  const userId = parsed.userId ?? "user_operator";
  const serializedCapabilities = JSON.stringify(parsed.capabilities);
  const expiresAt = new Date(
    now.getTime() + parsed.expiresInMinutes * 60_000
  ).toISOString();
  const id = `pair_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const pairingToken = randomUUID().replaceAll("-", "");
  const stalePendingRows = getDatabase()
    .prepare(
      `SELECT *
       FROM companion_pairing_sessions
       WHERE user_id = ?
         AND label = ?
         AND capability_flags_json = ?
         AND status = 'pending'`
    )
    .all(userId, parsed.label, serializedCapabilities) as PairingSessionRow[];
  if (stalePendingRows.length > 0) {
    revokePairingRows(stalePendingRows, {
      actor: null,
      source: "system",
      reason: "Superseded by a newer pairing QR"
    });
  }
  runInTransaction(() => {
    getDatabase()
      .prepare(
        `INSERT INTO companion_pairing_sessions (
           id, user_id, label, pairing_token, status, capability_flags_json, api_base_url,
           expires_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        userId,
        parsed.label,
        pairingToken,
        serializedCapabilities,
        baseApiUrl,
        expiresAt,
        now.toISOString(),
        now.toISOString()
      );
    ensurePairingSourceStates(
      getDatabase()
        .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
        .get(id) as PairingSessionRow
    );
  });

  const qrPayload = {
    kind: "forge-companion-pairing",
    apiBaseUrl: baseApiUrl,
    uiBaseUrl: resolvedTransport.uiBaseUrl ?? undefined,
    transportMode: resolvedTransport.transportMode ?? parsed.transportMode,
    transport: resolvedTransport.transport,
    sessionId: id,
    pairingToken,
    expiresAt,
    capabilities: parsed.capabilities
  };

  return {
    session: mapPairingSession(
      getDatabase()
        .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
        .get(id) as PairingSessionRow
    ),
    qrPayload
  };
}

export function verifyCompanionPairing(
  payload: z.infer<typeof verifyCompanionPairingSchema>
) {
  const parsed = verifyCompanionPairingSchema.parse(payload);
  const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
  const now = nowIso();
  const renewedExpiry = nextVerifiedCompanionPairingExpiry(new Date());
  const nextStatus =
    pairing.status === "healthy" ||
    pairing.status === "stale" ||
    pairing.status === "permission_denied"
      ? pairing.status
      : "paired";

  getDatabase()
    .prepare(
      `UPDATE companion_pairing_sessions
       SET status = ?, device_name = ?, platform = ?, app_version = ?,
           last_seen_at = ?, paired_at = COALESCE(paired_at, ?), expires_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      nextStatus,
      parsed.device.name,
      parsed.device.platform,
      parsed.device.appVersion,
      now,
      now,
      renewedExpiry,
      now,
      pairing.id
    );

  if (parsed.device.name.trim().length > 0) {
    const duplicateRows = getDatabase()
      .prepare(
        `SELECT *
         FROM companion_pairing_sessions
         WHERE user_id = ?
           AND id != ?
           AND status != 'revoked'
           AND COALESCE(device_name, '') = ?
           AND COALESCE(platform, '') = ?`
      )
      .all(
        pairing.user_id,
        pairing.id,
        parsed.device.name,
        parsed.device.platform
      ) as PairingSessionRow[];
    if (duplicateRows.length > 0) {
      revokePairingRows(duplicateRows, {
        actor: null,
        source: "system",
        reason: "Superseded by a newer verified device pairing"
      });
    }
  }

  ensurePairingSourceStates(
    getDatabase()
      .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
      .get(pairing.id) as PairingSessionRow
  );

  return {
    pairingSession: mapPairingSession(
      getDatabase()
        .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
        .get(pairing.id) as PairingSessionRow
    )
  };
}

export function heartbeatCompanionPairing(
  payload: z.infer<typeof heartbeatCompanionPairingSchema>
) {
  const parsed = heartbeatCompanionPairingSchema.parse(payload);
  const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
  const now = nowIso();
  const renewedExpiry = nextVerifiedCompanionPairingExpiry(new Date());
  const nextStatus =
    pairing.status === "revoked"
      ? pairing.status
      : pairing.status === "permission_denied"
        ? pairing.status
        : pairing.status === "stale"
          ? "paired"
          : pairing.status === "pending"
            ? "paired"
            : pairing.status;

  getDatabase()
    .prepare(
      `UPDATE companion_pairing_sessions
       SET status = ?, device_name = ?, platform = ?, app_version = ?,
           last_seen_at = ?, paired_at = COALESCE(paired_at, ?),
           expires_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      nextStatus,
      parsed.device.name,
      parsed.device.platform,
      parsed.device.appVersion,
      now,
      now,
      renewedExpiry,
      now,
      pairing.id
    );

  ensurePairingSourceStates(
    getDatabase()
      .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
      .get(pairing.id) as PairingSessionRow
  );

  return {
    pairingSession: mapPairingSession(
      getDatabase()
        .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
        .get(pairing.id) as PairingSessionRow
    )
  };
}

export function requireValidPairing(sessionId: string, pairingToken: string) {
  const row = getDatabase()
    .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
    .get(sessionId) as PairingSessionRow | undefined;
  if (!row || row.pairing_token !== pairingToken) {
    throw new HttpError(
      401,
      "invalid_pairing_token",
      "The pairing session or pairing token is invalid."
    );
  }
  if (Date.parse(row.expires_at) < Date.now()) {
    throw new HttpError(
      410,
      "pairing_expired",
      "The pairing session expired. Generate a new QR code in Forge."
    );
  }
  if (row.status === "revoked") {
    throw new HttpError(
      403,
      "pairing_revoked",
      "This companion pairing was revoked."
    );
  }
  return row;
}

function normalizeHealthAuthorizationStatus(
  healthAccessAuthorized: boolean,
  sleepCount: number,
  workoutCount: number,
  vitalDayCount: number
): z.infer<typeof companionSourceAuthorizationStatusSchema> {
  if (healthAccessAuthorized) {
    return "approved";
  }
  if (sleepCount > 0 || workoutCount > 0 || vitalDayCount > 0) {
    return "partial";
  }
  return "not_determined";
}

function normalizeSleepNightInput(
  input:
    | z.infer<typeof mobileHealthSyncSchema>["sleepNights"][number]
    | z.infer<typeof mobileHealthSyncSchema>["sleepSessions"][number]
) {
  const sourceTimezone = resolveTimeZone(
    "sourceTimezone" in input ? input.sourceTimezone : "UTC"
  );
  const localDateKey =
    "localDateKey" in input && typeof input.localDateKey === "string"
      ? input.localDateKey
      : localDateKeyForTimezone(input.endedAt, sourceTimezone);
  return {
    externalUid: input.externalUid,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    sourceTimezone,
    localDateKey,
    timeInBedSeconds: input.timeInBedSeconds,
    asleepSeconds: input.asleepSeconds,
    awakeSeconds: input.awakeSeconds,
    rawSegmentCount:
      "rawSegmentCount" in input && typeof input.rawSegmentCount === "number"
        ? input.rawSegmentCount
        : 0,
    stageBreakdown: input.stageBreakdown,
    recoveryMetrics: input.recoveryMetrics ?? {},
    sourceMetrics:
      "sourceMetrics" in input && input.sourceMetrics
        ? input.sourceMetrics
        : {
            legacyPayloadAlias: true
          },
    links: input.links,
    annotations: input.annotations
  };
}

function normalizeSleepSegmentInput(
  input: z.infer<typeof mobileHealthSyncSchema>["sleepSegments"][number]
) {
  const sourceTimezone = resolveTimeZone(input.sourceTimezone);
  return {
    ...input,
    sourceTimezone,
    localDateKey:
      input.localDateKey ||
      localDateKeyForTimezone(input.endedAt, sourceTimezone)
  };
}

function normalizeSleepRawRecordInput(
  input: z.infer<typeof mobileHealthSyncSchema>["sleepRawRecords"][number]
) {
  const sourceTimezone = resolveTimeZone(input.sourceTimezone);
  return {
    ...input,
    sourceTimezone,
    localDateKey:
      input.localDateKey ||
      localDateKeyForTimezone(input.endedAt, sourceTimezone)
  };
}

function listNormalizedSleepNights(
  payload: z.infer<typeof mobileHealthSyncSchema>
) {
  if (payload.sleepNights.length > 0) {
    return payload.sleepNights.map(normalizeSleepNightInput);
  }
  return payload.sleepSessions.map(normalizeSleepNightInput);
}

function listNormalizedSleepSegments(
  payload: z.infer<typeof mobileHealthSyncSchema>
) {
  return payload.sleepSegments.map(normalizeSleepSegmentInput);
}

function listNormalizedSleepRawRecords(
  payload: z.infer<typeof mobileHealthSyncSchema>
) {
  return payload.sleepRawRecords.map(normalizeSleepRawRecordInput);
}

function refreshSleepSessionRawSegmentCount(sleepSessionId: string) {
  const count = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM health_sleep_segments
       WHERE sleep_session_id = ?`
    )
    .get(sleepSessionId) as { count: number };
  getDatabase()
    .prepare(
      `UPDATE health_sleep_sessions
       SET raw_segment_count = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(count.count, nowIso(), sleepSessionId);
}

function upsertSleepSourceRecord(input: {
  pairing: PairingSessionRow;
  importRunId: string;
  sleepSessionId: string | null;
  rawRecord: ReturnType<typeof normalizeSleepRawRecordInput>;
  qualityKind: "provider_native" | "historical_import" | "reconstructed";
}) {
  const existing = getDatabase()
    .prepare(
      `SELECT *
       FROM health_sleep_source_records
       WHERE user_id = ? AND provider = 'apple_health' AND provider_record_uid = ?`
    )
    .get(input.pairing.user_id, input.rawRecord.externalUid) as
    | SleepSourceRecordRow
    | undefined;
  const now = nowIso();
  if (existing) {
    getDatabase()
      .prepare(
        `UPDATE health_sleep_source_records
         SET import_run_id = ?, pairing_session_id = ?, sleep_session_id = ?, source_device = ?, source_timezone = ?,
             local_date_key = ?, started_at = ?, ended_at = ?, provider_record_type = ?, raw_stage = ?, raw_value = ?,
             quality_kind = ?, payload_json = ?, metadata_json = ?, ingested_at = ?
         WHERE id = ?`
      )
      .run(
        input.importRunId,
        input.pairing.id,
        input.sleepSessionId,
        input.pairing.device_name ?? "",
        input.rawRecord.sourceTimezone,
        input.rawRecord.localDateKey,
        input.rawRecord.startedAt,
        input.rawRecord.endedAt,
        input.rawRecord.providerRecordType,
        input.rawRecord.rawStage,
        input.rawRecord.rawValue ?? null,
        input.qualityKind,
        JSON.stringify(input.rawRecord.payload ?? {}),
        JSON.stringify(input.rawRecord.metadata ?? {}),
        now,
        existing.id
      );
    return { mode: "updated" as const, id: existing.id };
  }

  const id = `sraw_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  getDatabase()
    .prepare(
      `INSERT INTO health_sleep_source_records (
         id, import_run_id, pairing_session_id, sleep_session_id, user_id, provider, provider_record_type, provider_record_uid,
         source_device, source_timezone, local_date_key, started_at, ended_at, raw_stage, raw_value, quality_kind,
         payload_json, metadata_json, ingested_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.importRunId,
      input.pairing.id,
      input.sleepSessionId,
      input.pairing.user_id,
      "apple_health",
      input.rawRecord.providerRecordType,
      input.rawRecord.externalUid,
      input.pairing.device_name ?? "",
      input.rawRecord.sourceTimezone,
      input.rawRecord.localDateKey,
      input.rawRecord.startedAt,
      input.rawRecord.endedAt,
      input.rawRecord.rawStage,
      input.rawRecord.rawValue ?? null,
      input.qualityKind,
      JSON.stringify(input.rawRecord.payload ?? {}),
      JSON.stringify(input.rawRecord.metadata ?? {}),
      now
    );
  return { mode: "created" as const, id };
}

function upsertSleepSegment(input: {
  pairing: PairingSessionRow;
  importRunId: string;
  sleepSessionId: string | null;
  segment: ReturnType<typeof normalizeSleepSegmentInput>;
  sourceRecordIds?: string[];
  qualityKind?: "provider_native" | "historical_import" | "reconstructed";
}) {
  const existing = getDatabase()
    .prepare(
      `SELECT *
       FROM health_sleep_segments
       WHERE user_id = ? AND source = 'apple_health' AND external_uid = ?`
    )
    .get(input.pairing.user_id, input.segment.externalUid) as
    | SleepSegmentRow
    | undefined;
  const now = nowIso();
  if (existing) {
    getDatabase()
      .prepare(
        `UPDATE health_sleep_segments
         SET import_run_id = ?, pairing_session_id = ?, sleep_session_id = ?, source_type = ?, source_device = ?,
             source_timezone = ?, local_date_key = ?, started_at = ?, ended_at = ?, stage = ?, bucket = ?,
             source_value = ?, quality_kind = ?, source_record_ids_json = ?, metadata_json = ?, provenance_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.importRunId,
        input.pairing.id,
        input.sleepSessionId,
        "healthkit_segment",
        input.pairing.device_name ?? "",
        input.segment.sourceTimezone,
        input.segment.localDateKey,
        input.segment.startedAt,
        input.segment.endedAt,
        input.segment.stage,
        input.segment.bucket,
        input.segment.sourceValue ?? null,
        input.qualityKind ?? "provider_native",
        JSON.stringify(input.sourceRecordIds ?? []),
        JSON.stringify(input.segment.metadata ?? {}),
        JSON.stringify({
          importedVia: "ios_companion",
          importRunId: input.importRunId,
          updatedAt: now
        }),
        now,
        existing.id
      );
    return { mode: "updated" as const, id: existing.id };
  }

  const id = `sleepseg_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  getDatabase()
    .prepare(
      `INSERT INTO health_sleep_segments (
         id, external_uid, import_run_id, pairing_session_id, sleep_session_id, user_id, source, source_type,
         source_device, source_timezone, local_date_key, started_at, ended_at, stage, bucket, source_value,
         quality_kind, source_record_ids_json, metadata_json, provenance_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.segment.externalUid,
      input.importRunId,
      input.pairing.id,
      input.sleepSessionId,
      input.pairing.user_id,
      "apple_health",
      "healthkit_segment",
      input.pairing.device_name ?? "",
      input.segment.sourceTimezone,
      input.segment.localDateKey,
      input.segment.startedAt,
      input.segment.endedAt,
      input.segment.stage,
      input.segment.bucket,
      input.segment.sourceValue ?? null,
      input.qualityKind ?? "provider_native",
      JSON.stringify(input.sourceRecordIds ?? []),
      JSON.stringify(input.segment.metadata ?? {}),
      JSON.stringify({
        importedVia: "ios_companion",
        importRunId: input.importRunId,
        createdAt: now
      }),
      now,
      now
    );
  return { mode: "created" as const, id };
}

function createSleepRawLog(input: {
  sleepSessionId: string | null;
  importRunId: string | null;
  pairingSessionId: string | null;
  userId: string;
  source: string;
  logType: string;
  externalUid?: string | null;
  sourceTimezone?: string;
  localDateKey?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  const now = nowIso();
  const id = `slraw_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  getDatabase()
    .prepare(
      `INSERT INTO health_sleep_raw_logs (
         id, import_run_id, pairing_session_id, sleep_session_id, user_id, source, log_type, external_uid,
         source_timezone, local_date_key, started_at, ended_at, payload_json, metadata_json, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.importRunId,
      input.pairingSessionId,
      input.sleepSessionId,
      input.userId,
      input.source,
      input.logType,
      input.externalUid ?? null,
      resolveTimeZone(input.sourceTimezone),
      input.localDateKey ?? "",
      input.startedAt ?? null,
      input.endedAt ?? null,
      JSON.stringify(input.payload),
      JSON.stringify(input.metadata ?? {}),
      now
    );
}

function syncPairingSourceStatesFromPayload(
  pairing: PairingSessionRow,
  payload: z.infer<typeof mobileHealthSyncSchema>
) {
  upsertPairingSourceState(pairing, "health", {
    desiredEnabled: payload.sourceStates.health.desiredEnabled,
    appliedEnabled: payload.sourceStates.health.appliedEnabled,
    authorizationStatus: normalizeHealthAuthorizationStatus(
      payload.permissions.healthKitAuthorized,
      Math.max(payload.sleepNights.length, payload.sleepSessions.length),
      payload.workouts.length,
      payload.vitals.daySummaries.length
    ),
    syncEligible: payload.sourceStates.health.syncEligible,
    lastObservedAt: payload.sourceStates.health.lastObservedAt ?? nowIso(),
    metadata: payload.sourceStates.health.metadata
  });
  upsertPairingSourceState(pairing, "movement", {
    desiredEnabled: payload.sourceStates.movement.desiredEnabled,
    appliedEnabled: payload.sourceStates.movement.appliedEnabled,
    authorizationStatus:
      payload.movement.settings.locationPermissionStatus === "always" ||
      payload.movement.settings.locationPermissionStatus === "when_in_use"
        ? "approved"
        : payload.movement.settings.locationPermissionStatus === "restricted"
          ? "restricted"
          : payload.movement.settings.locationPermissionStatus === "denied"
            ? "denied"
            : "not_determined",
    syncEligible: payload.sourceStates.movement.syncEligible,
    lastObservedAt: payload.sourceStates.movement.lastObservedAt ?? nowIso(),
    metadata: {
      ...payload.sourceStates.movement.metadata,
      motionPermissionStatus: payload.movement.settings.motionPermissionStatus,
      backgroundTrackingReady: payload.movement.settings.backgroundTrackingReady
    }
  });
  upsertPairingSourceState(pairing, "screenTime", {
    desiredEnabled: payload.sourceStates.screenTime.desiredEnabled,
    appliedEnabled: payload.sourceStates.screenTime.appliedEnabled,
    authorizationStatus:
      payload.screenTime.settings.authorizationStatus === "approved"
        ? "approved"
        : payload.screenTime.settings.authorizationStatus === "denied"
          ? "denied"
          : payload.screenTime.settings.authorizationStatus === "unavailable"
            ? "unavailable"
            : "not_determined",
    syncEligible: payload.sourceStates.screenTime.syncEligible,
    lastObservedAt: payload.sourceStates.screenTime.lastObservedAt ?? nowIso(),
    metadata: {
      ...payload.sourceStates.screenTime.metadata,
      captureState: payload.screenTime.settings.captureState
    }
  });
}

function findMatchingGeneratedWorkout(input: {
  userId: string;
  workoutType: string;
  startedAt: string;
  endedAt: string;
}) {
  const rows = getDatabase()
    .prepare(
      `SELECT *
       FROM health_workout_sessions
       WHERE user_id = ?
         AND generated_from_habit_id IS NOT NULL
         AND workout_type = ?
         AND ABS(strftime('%s', started_at) - strftime('%s', ?)) <= 5400
         AND ABS(strftime('%s', ended_at) - strftime('%s', ?)) <= 5400
       ORDER BY (
         ABS(strftime('%s', started_at) - strftime('%s', ?)) +
         ABS(strftime('%s', ended_at) - strftime('%s', ?))
       ) ASC
       LIMIT 1`
    )
    .all(
      input.userId,
      input.workoutType,
      input.startedAt,
      input.endedAt,
      input.startedAt,
      input.endedAt
    ) as WorkoutSessionRow[];
  return rows[0] ?? null;
}

function upsertDailySummary(
  userId: string,
  dateKey: string,
  summaryType: string,
  metrics: Record<string, unknown>,
  derived: Record<string, unknown> = {}
) {
  const existing = getDatabase()
    .prepare(
      `SELECT id, user_id, date_key, summary_type, metrics_json, derived_json, source, created_at, updated_at
       FROM health_daily_summaries
       WHERE user_id = ? AND date_key = ? AND summary_type = ?`
    )
    .get(userId, dateKey, summaryType) as DailySummaryRow | undefined;
  const now = nowIso();
  if (existing) {
    getDatabase()
      .prepare(
        `UPDATE health_daily_summaries
         SET metrics_json = ?, derived_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(JSON.stringify(metrics), JSON.stringify(derived), now, existing.id);
    return;
  }
  getDatabase()
    .prepare(
      `INSERT INTO health_daily_summaries (
         id, user_id, date_key, summary_type, metrics_json, derived_json, source, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, 'derived', ?, ?)`
    )
    .run(
      `hds_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      userId,
      dateKey,
      summaryType,
      JSON.stringify(metrics),
      JSON.stringify(derived),
      now,
      now
    );
}

function normalizeVitalMetricSummary(
  input: z.infer<typeof vitalMetricSummarySchema>
): StoredVitalMetricSummary {
  return {
    metric: input.metric,
    label: input.label,
    category: input.category,
    unit: input.unit,
    displayUnit: input.displayUnit || input.unit,
    aggregation: input.aggregation,
    average: input.average ?? null,
    minimum: input.minimum ?? null,
    maximum: input.maximum ?? null,
    latest: input.latest ?? null,
    total: input.total ?? null,
    sampleCount: input.sampleCount,
    latestSampleAt: input.latestSampleAt ?? null
  };
}

function upsertVitalDaySummary(
  userId: string,
  input: z.infer<typeof vitalDaySummarySchema>
) {
  const metrics = input.metrics.reduce<
    Record<string, StoredVitalMetricSummary>
  >((accumulator, metric) => {
    accumulator[metric.metric] = normalizeVitalMetricSummary(metric);
    return accumulator;
  }, {});
  upsertDailySummary(userId, input.dateKey, "vitals", metrics, {
    sourceTimezone: resolveTimeZone(input.sourceTimezone),
    metricCount: input.metrics.length
  });
}

function summarizeUserHealthDay(userId: string, dateKeyValue: string) {
  const sleeps = listSleepRows([userId]).filter(
    (row) =>
      sleepSessionDateKey(row) === dateKeyValue ||
      localDateKeyForTimezone(
        row.started_at,
        resolveTimeZone(row.source_timezone)
      ) === dateKeyValue
  );
  const workouts = listWorkoutRows([userId]).filter(
    (row) => dayKey(row.started_at) === dateKeyValue
  );
  const totalSleepSeconds = sleeps.reduce(
    (sum, row) => sum + row.asleep_seconds,
    0
  );
  const totalWorkoutSeconds = workouts.reduce(
    (sum, row) => sum + row.duration_seconds,
    0
  );
  const totalExerciseMinutes = workouts.reduce(
    (sum, row) => sum + (row.exercise_minutes ?? row.duration_seconds / 60),
    0
  );
  const totalEnergyKcal = workouts.reduce(
    (sum, row) => sum + (row.total_energy_kcal ?? row.active_energy_kcal ?? 0),
    0
  );
  upsertDailySummary(
    userId,
    dateKeyValue,
    "health",
    {
      totalSleepSeconds,
      totalWorkoutSeconds,
      totalExerciseMinutes,
      totalEnergyKcal,
      workoutCount: workouts.length,
      sleepSessionCount: sleeps.length
    },
    {
      recoveryState:
        totalSleepSeconds >= 7 * 3600
          ? "recovered"
          : totalSleepSeconds >= 6 * 3600
            ? "borderline"
            : "strained"
    }
  );
}

function insertOrUpdateSleepSession(
  pairing: PairingSessionRow,
  input: ReturnType<typeof normalizeSleepNightInput>
) {
  const existing = getDatabase()
    .prepare(
      `SELECT *
       FROM health_sleep_sessions
       WHERE user_id = ? AND source = 'apple_health' AND external_uid = ?`
    )
    .get(pairing.user_id, input.externalUid) as SleepSessionRow | undefined;
  const stageBreakdown = input.stageBreakdown;
  const sleepScore = computeSleepScore({
    asleepSeconds: input.asleepSeconds,
    timeInBedSeconds: input.timeInBedSeconds,
    awakeSeconds: input.awakeSeconds,
    stageBreakdown
  });
  const timingMetrics = computeSleepTimingMetrics({
    userId: pairing.user_id,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    sourceTimezone: input.sourceTimezone,
    excludeSleepId: existing?.id
  });
  const annotations = sleepAnnotationSchema.parse(input.annotations ?? {});
  const derivedMetrics = computeSleepDerivedMetrics({
    asleepSeconds: input.asleepSeconds,
    timeInBedSeconds: input.timeInBedSeconds,
    awakeSeconds: input.awakeSeconds,
    sleepScore,
    stageBreakdown
  });
  const now = nowIso();
  if (existing) {
    getDatabase()
      .prepare(
        `UPDATE health_sleep_sessions
         SET pairing_session_id = ?, source_device = ?, source_timezone = ?, local_date_key = ?, started_at = ?, ended_at = ?, time_in_bed_seconds = ?,
             asleep_seconds = ?, awake_seconds = ?, sleep_score = ?, regularity_score = ?,
             bedtime_consistency_minutes = ?, wake_consistency_minutes = ?, raw_segment_count = ?, stage_breakdown_json = ?, recovery_metrics_json = ?, source_metrics_json = ?, links_json = ?, annotations_json = ?,
             provenance_json = ?, derived_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        pairing.id,
        pairing.device_name ?? "",
        input.sourceTimezone,
        input.localDateKey,
        input.startedAt,
        input.endedAt,
        input.timeInBedSeconds,
        input.asleepSeconds,
        input.awakeSeconds,
        sleepScore,
        timingMetrics.regularityScore,
        timingMetrics.bedtimeConsistencyMinutes,
        timingMetrics.wakeConsistencyMinutes,
        input.rawSegmentCount,
        JSON.stringify(stageBreakdown),
        JSON.stringify(input.recoveryMetrics),
        JSON.stringify(input.sourceMetrics),
        JSON.stringify(
          mergeHealthLinks(
            safeJsonParse(existing.links_json, []),
            input.links,
            annotations.links
          )
        ),
        JSON.stringify(annotations),
        JSON.stringify({
          importedVia: "ios_companion",
          pairingSessionId: pairing.id,
          updatedAt: now
        }),
        JSON.stringify(derivedMetrics),
        now,
        existing.id
      );
    return { mode: "updated" as const, id: existing.id };
  }
  const id = `sleep_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  getDatabase()
    .prepare(
      `INSERT INTO health_sleep_sessions (
         id, external_uid, pairing_session_id, user_id, source, source_type, source_device,
         source_timezone, local_date_key, started_at, ended_at, time_in_bed_seconds, asleep_seconds, awake_seconds,
         sleep_score, regularity_score, bedtime_consistency_minutes, wake_consistency_minutes,
         raw_segment_count, stage_breakdown_json, recovery_metrics_json, source_metrics_json, links_json, annotations_json,
         provenance_json, derived_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.externalUid,
      pairing.id,
      pairing.user_id,
      "apple_health",
      "healthkit",
      pairing.device_name ?? "",
      input.sourceTimezone,
      input.localDateKey,
      input.startedAt,
      input.endedAt,
      input.timeInBedSeconds,
      input.asleepSeconds,
      input.awakeSeconds,
      sleepScore,
      timingMetrics.regularityScore,
      timingMetrics.bedtimeConsistencyMinutes,
      timingMetrics.wakeConsistencyMinutes,
      input.rawSegmentCount,
      JSON.stringify(stageBreakdown),
      JSON.stringify(input.recoveryMetrics),
      JSON.stringify(input.sourceMetrics),
      JSON.stringify(mergeHealthLinks(input.links, annotations.links)),
      JSON.stringify(annotations),
      JSON.stringify({
        importedVia: "ios_companion",
        pairingSessionId: pairing.id,
        createdAt: now
      }),
      JSON.stringify(derivedMetrics),
      now,
      now
    );
  return { mode: "created" as const, id };
}

function insertOrUpdateWorkoutSession(
  pairing: PairingSessionRow,
  input: z.infer<typeof mobileHealthSyncSchema>["workouts"][number]
) {
  const existing = getDatabase()
    .prepare(
      `SELECT *
       FROM health_workout_sessions
       WHERE user_id = ? AND source = 'apple_health' AND external_uid = ?`
    )
    .get(pairing.user_id, input.externalUid) as WorkoutSessionRow | undefined;
  const annotations = workoutAnnotationSchema.parse(input.annotations ?? {});
  const now = nowIso();
  const basePersistenceSeed = buildWorkoutSessionPersistenceSeed({
    source: "apple_health",
    sourceType: "healthkit",
    workoutType: input.workoutType,
    sourceSystem: input.sourceSystem,
    sourceBundleIdentifier: input.sourceBundleIdentifier,
    sourceProductType: input.sourceProductType,
    activity: input.activity,
    details: input.details
  });
  const matchedGenerated =
    existing ??
    findMatchingGeneratedWorkout({
      userId: pairing.user_id,
      workoutType: basePersistenceSeed.activity.canonicalKey,
      startedAt: input.startedAt,
      endedAt: input.endedAt
    });

  if (matchedGenerated) {
    const existingLinks = safeJsonParse<
      Array<z.infer<typeof healthLinkSchema>>
    >(matchedGenerated.links_json, []);
    const existingTags = safeJsonParse<string[]>(
      matchedGenerated.tags_json,
      []
    );
    const existingAnnotations = safeJsonParse<Record<string, unknown>>(
      matchedGenerated.annotations_json,
      {}
    );
    const existingProvenance = safeJsonParse<Record<string, unknown>>(
      matchedGenerated.provenance_json,
      {}
    );
    const existingDerived = safeJsonParse<Record<string, unknown>>(
      matchedGenerated.derived_json,
      {}
    );
    const persistenceSeed = buildWorkoutSessionPersistenceSeed({
      source: "apple_health",
      sourceType: matchedGenerated.generated_from_habit_id
        ? "reconciled"
        : "healthkit",
      workoutType: input.workoutType,
      sourceSystem: input.sourceSystem,
      sourceBundleIdentifier:
        input.sourceBundleIdentifier ??
        (typeof existingProvenance.sourceBundleIdentifier === "string"
          ? existingProvenance.sourceBundleIdentifier
          : null),
      sourceProductType:
        input.sourceProductType ??
        (typeof existingProvenance.sourceProductType === "string"
          ? existingProvenance.sourceProductType
          : null),
      activity:
        input.activity ??
        existingDerived.activity ??
        existingProvenance.activity,
      details:
        input.details ?? existingDerived.details ?? existingProvenance.details
    });
    const mergedLinks = mergeHealthLinks(
      existingLinks,
      input.links,
      annotations.links
    );
    const mergedTags = mergeStringLists(existingTags, annotations.tags);
    const nextSubjectiveEffort =
      matchedGenerated.subjective_effort ??
      annotations.subjectiveEffort ??
      null;
    const nextMoodBefore =
      matchedGenerated.mood_before || annotations.moodBefore;
    const nextMoodAfter = matchedGenerated.mood_after || annotations.moodAfter;
    const nextMeaningText =
      matchedGenerated.meaning_text || annotations.meaningText;
    const nextPlannedContext =
      matchedGenerated.planned_context || annotations.plannedContext;
    const nextSocialContext =
      matchedGenerated.social_context || annotations.socialContext;
    const nextAnnotations = {
      ...existingAnnotations,
      subjectiveEffort: nextSubjectiveEffort,
      moodBefore: nextMoodBefore,
      moodAfter: nextMoodAfter,
      meaningText: nextMeaningText,
      plannedContext: nextPlannedContext,
      socialContext: nextSocialContext,
      tags: mergedTags,
      links: mergedLinks
    };
    getDatabase()
      .prepare(
        `UPDATE health_workout_sessions
         SET external_uid = ?, pairing_session_id = ?, source = 'apple_health', source_type = ?,
             source_device = ?, started_at = ?, ended_at = ?, duration_seconds = ?, active_energy_kcal = ?,
             total_energy_kcal = ?, distance_meters = ?, step_count = ?, exercise_minutes = ?, average_heart_rate = ?,
             max_heart_rate = ?, subjective_effort = ?, mood_before = ?, mood_after = ?, meaning_text = ?,
             planned_context = ?, social_context = ?,
             links_json = ?, tags_json = ?, annotations_json = ?, provenance_json = ?, derived_json = ?,
             reconciliation_status = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.externalUid,
        pairing.id,
        matchedGenerated.generated_from_habit_id ? "reconciled" : "healthkit",
        input.sourceDevice,
        input.startedAt,
        input.endedAt,
        Math.max(
          0,
          Math.round(
            (Date.parse(input.endedAt) - Date.parse(input.startedAt)) / 1000
          )
        ),
        input.activeEnergyKcal ?? null,
        input.totalEnergyKcal ?? null,
        input.distanceMeters ?? null,
        input.stepCount ?? null,
        input.exerciseMinutes ?? null,
        input.averageHeartRate ?? null,
        input.maxHeartRate ?? null,
        nextSubjectiveEffort,
        nextMoodBefore,
        nextMoodAfter,
        nextMeaningText,
        nextPlannedContext,
        nextSocialContext,
        JSON.stringify(mergedLinks),
        JSON.stringify(mergedTags),
        JSON.stringify(nextAnnotations),
        JSON.stringify({
          ...existingProvenance,
          importedVia: "ios_companion",
          pairingSessionId: pairing.id,
          sourceSystem: persistenceSeed.sourceSystem,
          sourceBundleIdentifier: persistenceSeed.sourceBundleIdentifier,
          sourceProductType: persistenceSeed.sourceProductType,
          activity: persistenceSeed.activity,
          details: persistenceSeed.details,
          mergedWithGenerated:
            matchedGenerated.generated_from_habit_id !== null,
          priorSource: matchedGenerated.source,
          updatedAt: now
        }),
        JSON.stringify({
          ...existingDerived,
          activity: persistenceSeed.activity,
          details: persistenceSeed.details,
          paceMetersPerMinute:
            input.distanceMeters && input.exerciseMinutes
              ? Number(
                  (input.distanceMeters / input.exerciseMinutes).toFixed(2)
                )
              : null
        }),
        matchedGenerated.generated_from_habit_id ? "merged" : "standalone",
        now,
        matchedGenerated.id
      );
    persistWorkoutEvidenceForInput(matchedGenerated.id, pairing.user_id, input);
    return {
      mode:
        matchedGenerated.generated_from_habit_id ||
        matchedGenerated.source !== "apple_health"
          ? ("merged" as const)
          : ("updated" as const),
      id: matchedGenerated.id
    };
  }

  const id = `workout_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  getDatabase()
    .prepare(
      `INSERT INTO health_workout_sessions (
         id, external_uid, pairing_session_id, user_id, source, source_type, workout_type, source_device,
         started_at, ended_at, duration_seconds, active_energy_kcal, total_energy_kcal, distance_meters,
         step_count, exercise_minutes, average_heart_rate, max_heart_rate, subjective_effort, mood_before,
         mood_after, meaning_text, planned_context, social_context, links_json, tags_json, annotations_json,
         provenance_json, derived_json, reconciliation_status, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, 'apple_health', 'healthkit', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'standalone', ?, ?)`
    )
    .run(
      id,
      input.externalUid,
      pairing.id,
      pairing.user_id,
      basePersistenceSeed.activity.canonicalKey,
      input.sourceDevice,
      input.startedAt,
      input.endedAt,
      Math.max(
        0,
        Math.round(
          (Date.parse(input.endedAt) - Date.parse(input.startedAt)) / 1000
        )
      ),
      input.activeEnergyKcal ?? null,
      input.totalEnergyKcal ?? null,
      input.distanceMeters ?? null,
      input.stepCount ?? null,
      input.exerciseMinutes ?? null,
      input.averageHeartRate ?? null,
      input.maxHeartRate ?? null,
      annotations.subjectiveEffort,
      annotations.moodBefore,
      annotations.moodAfter,
      annotations.meaningText,
      annotations.plannedContext,
      annotations.socialContext,
      JSON.stringify(input.links),
      JSON.stringify(annotations.tags),
      JSON.stringify(annotations),
      JSON.stringify({
        importedVia: "ios_companion",
        pairingSessionId: pairing.id,
        sourceSystem: basePersistenceSeed.sourceSystem,
        sourceBundleIdentifier: basePersistenceSeed.sourceBundleIdentifier,
        sourceProductType: basePersistenceSeed.sourceProductType,
        activity: basePersistenceSeed.activity,
        details: basePersistenceSeed.details,
        createdAt: now
      }),
      JSON.stringify({
        activity: basePersistenceSeed.activity,
        details: basePersistenceSeed.details,
        paceMetersPerMinute:
          input.distanceMeters && input.exerciseMinutes
            ? Number((input.distanceMeters / input.exerciseMinutes).toFixed(2))
            : null
      }),
      now,
      now
    );
  persistWorkoutEvidenceForInput(id, pairing.user_id, input);
  return { mode: "created" as const, id };
}

function persistWorkoutEvidenceForInput(
  workoutId: string,
  userId: string,
  input: z.infer<typeof mobileHealthSyncSchema>["workouts"][number]
) {
  if (input.timeSeriesSamples.length > 0) {
    upsertWorkoutTimeSeries({
      workoutId,
      userId,
      samples: input.timeSeriesSamples
    });
  }
  if (input.routePoints.length > 0) {
    upsertWorkoutRoutePoints({
      workoutId,
      userId,
      points: input.routePoints
    });
  }
  const row = getDatabase()
    .prepare(`SELECT * FROM health_workout_sessions WHERE id = ?`)
    .get(workoutId) as WorkoutSessionRow | undefined;
  if (row) {
    recomputeAndStoreWorkoutAnalytics(row);
    if (input.captureQuality) {
      const derived = safeJsonParse<Record<string, unknown>>(
        row.derived_json,
        {}
      );
      getDatabase()
        .prepare(
          `UPDATE health_workout_sessions
           SET derived_json = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          JSON.stringify({
            ...derived,
            captureQuality: input.captureQuality,
            syncCursor: input.syncCursor
          }),
          nowIso(),
          workoutId
        );
    }
  }
}

function clusterSleepRowsByGap<
  T extends { started_at: string; ended_at: string }
>(rows: T[]) {
  const clusters: T[][] = [];
  let currentCluster: T[] = [];
  let currentEnd = rows[0]?.ended_at ?? null;
  for (const row of rows) {
    if (
      currentEnd &&
      Date.parse(row.started_at) - Date.parse(currentEnd) > 4 * 60 * 60 * 1000
    ) {
      if (currentCluster.length > 0) {
        clusters.push(currentCluster);
      }
      currentCluster = [row];
      currentEnd = row.ended_at;
      continue;
    }
    currentCluster.push(row);
    if (!currentEnd || Date.parse(row.ended_at) > Date.parse(currentEnd)) {
      currentEnd = row.ended_at;
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }
  return clusters;
}

function selectAuthoritativeSleepRows<
  T extends { id: string; started_at: string; ended_at: string }
>(rows: T[]) {
  const authoritativeRows = rows.filter((candidate) => {
    const containsOther = rows.some((other) => {
      if (other.id === candidate.id) {
        return false;
      }
      return (
        Date.parse(candidate.started_at) <= Date.parse(other.started_at) &&
        Date.parse(candidate.ended_at) >= Date.parse(other.ended_at)
      );
    });
    return !containsOther;
  });
  return authoritativeRows.length > 0 ? authoritativeRows : rows;
}

function backfillHistoricalSleepEvidence() {
  const repairedSessions = getDatabase()
    .prepare(
      `SELECT *
       FROM health_sleep_sessions
       WHERE source = 'apple_health'
         AND source_type = 'healthkit_repaired'
       ORDER BY started_at ASC`
    )
    .all() as SleepSessionRow[];
  if (repairedSessions.length === 0) {
    return;
  }

  const updateSessionTimezoneStatement = getDatabase().prepare(
    `UPDATE health_sleep_sessions
     SET source_timezone = ?, local_date_key = ?, updated_at = ?
     WHERE id = ?`
  );
  const detachSourceRecordsStatement = getDatabase().prepare(
    `UPDATE health_sleep_source_records
     SET sleep_session_id = NULL, metadata_json = ?
     WHERE sleep_session_id = ?`
  );
  const detachSegmentsStatement = getDatabase().prepare(
    `UPDATE health_sleep_segments
     SET sleep_session_id = NULL, provenance_json = ?, updated_at = ?
     WHERE sleep_session_id = ?`
  );
  const detachRawLogsStatement = getDatabase().prepare(
    `UPDATE health_sleep_raw_logs
     SET sleep_session_id = NULL, metadata_json = ?
     WHERE sleep_session_id = ?`
  );
  const deleteSessionStatement = getDatabase().prepare(
    `DELETE FROM health_sleep_sessions WHERE id = ?`
  );

  for (const session of repairedSessions) {
    const rawLogs = listSleepRawLogRowsBySleepId(session.id);
    const sourceTimezone = inferHistoricalSleepTimeZone([
      session.source_timezone,
      ...rawLogs.map((row) => row.source_timezone)
    ]);
    const localDateKey = localDateKeyForTimezone(
      session.ended_at,
      sourceTimezone
    );
    if (
      session.source_timezone !== sourceTimezone ||
      sleepSessionDateKey(session) !== localDateKey
    ) {
      updateSessionTimezoneStatement.run(
        sourceTimezone,
        localDateKey,
        nowIso(),
        session.id
      );
    }

    const existingSourceRecordCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM health_sleep_source_records
         WHERE sleep_session_id = ?`
      )
      .get(session.id) as { count: number };
    const existingSegmentCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM health_sleep_segments
         WHERE sleep_session_id = ?`
      )
      .get(session.id) as { count: number };

    if (existingSourceRecordCount.count === 0) {
      for (const rawLog of rawLogs) {
        const payload = safeJsonParse<Record<string, unknown>>(
          rawLog.payload_json,
          {}
        );
        const sourceRecordId = `sraw_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
        getDatabase()
          .prepare(
            `INSERT INTO health_sleep_source_records (
               id, import_run_id, pairing_session_id, sleep_session_id, user_id, provider, provider_record_type, provider_record_uid,
               source_device, source_timezone, local_date_key, started_at, ended_at, raw_stage, raw_value, quality_kind,
               payload_json, metadata_json, ingested_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            sourceRecordId,
            rawLog.import_run_id,
            rawLog.pairing_session_id,
            session.id,
            rawLog.user_id,
            "apple_health",
            "historical_import_interval",
            rawLog.external_uid ?? rawLog.id,
            session.source_device,
            sourceTimezone,
            localDateKey,
            rawLog.started_at ?? session.started_at,
            rawLog.ended_at ?? session.ended_at,
            inferHistoricalRawStage(payload),
            null,
            "historical_import",
            JSON.stringify(payload),
            JSON.stringify({
              ...safeJsonParse<Record<string, unknown>>(
                rawLog.metadata_json,
                {}
              ),
              migratedFromRawLogId: rawLog.id
            }),
            rawLog.created_at
          );
      }
    }

    if (existingSegmentCount.count === 0 && rawLogs.length > 0) {
      const authoritativeLogs = selectAuthoritativeSleepRows(
        rawLogs.filter(
          (
            row
          ): row is SleepRawLogRow & { started_at: string; ended_at: string } =>
            typeof row.started_at === "string" &&
            typeof row.ended_at === "string"
        )
      );
      for (const rawLog of authoritativeLogs) {
        const payload = safeJsonParse<Record<string, unknown>>(
          rawLog.payload_json,
          {}
        );
        const inferredStage = inferHistoricalRawStage(payload);
        const sourceRecord = getDatabase()
          .prepare(
            `SELECT *
             FROM health_sleep_source_records
             WHERE sleep_session_id = ? AND provider_record_uid = ?
             LIMIT 1`
          )
          .get(session.id, rawLog.external_uid ?? rawLog.id) as
          | SleepSourceRecordRow
          | undefined;
        getDatabase()
          .prepare(
            `INSERT INTO health_sleep_segments (
               id, external_uid, import_run_id, pairing_session_id, sleep_session_id, user_id, source, source_type,
               source_device, source_timezone, local_date_key, started_at, ended_at, stage, bucket, source_value,
               quality_kind, source_record_ids_json, metadata_json, provenance_json, created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            `sleepseg_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
            rawLog.external_uid ?? rawLog.id,
            rawLog.import_run_id,
            rawLog.pairing_session_id,
            session.id,
            rawLog.user_id,
            "apple_health",
            "historical_import_segment",
            session.source_device,
            sourceTimezone,
            localDateKey,
            rawLog.started_at,
            rawLog.ended_at,
            inferredStage,
            inferHistoricalSleepBucket(inferredStage),
            null,
            "historical_import",
            JSON.stringify(sourceRecord ? [sourceRecord.id] : []),
            JSON.stringify({
              historicalImport: true
            }),
            JSON.stringify({
              backfilledFrom: "health_sleep_raw_logs",
              rawLogId: rawLog.id
            }),
            rawLog.created_at,
            nowIso()
          );
      }
      refreshSleepSessionRawSegmentCount(session.id);
    }

    const providerBackedSourceRecordCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM health_sleep_source_records
         WHERE sleep_session_id = ? AND quality_kind = 'provider_native'`
      )
      .get(session.id) as { count: number };
    if (providerBackedSourceRecordCount.count > 0) {
      const competingHistoricalSessions = getDatabase()
        .prepare(
          `SELECT *
           FROM health_sleep_sessions
           WHERE user_id = ?
             AND source = 'apple_health'
             AND local_date_key = ?
             AND source_type = 'healthkit_repaired'
             AND id != ?`
        )
        .all(session.user_id, localDateKey, session.id) as SleepSessionRow[];
      for (const historical of competingHistoricalSessions) {
        const mergedAnnotations = mergeSleepAnnotationPayloads(
          [
            safeJsonParse<Record<string, unknown>>(
              session.annotations_json,
              {}
            ),
            safeJsonParse<Record<string, unknown>>(
              historical.annotations_json,
              {}
            )
          ],
          [
            safeJsonParse<Array<z.infer<typeof healthLinkSchema>>>(
              session.links_json,
              []
            ),
            safeJsonParse<Array<z.infer<typeof healthLinkSchema>>>(
              historical.links_json,
              []
            )
          ]
        );
        getDatabase()
          .prepare(
            `UPDATE health_sleep_sessions
             SET links_json = ?, annotations_json = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(
            JSON.stringify(mergedAnnotations.links),
            JSON.stringify(mergedAnnotations),
            nowIso(),
            session.id
          );
        detachSourceRecordsStatement.run(
          JSON.stringify({
            replacedBySleepSessionId: session.id,
            replacedAt: nowIso()
          }),
          historical.id
        );
        detachSegmentsStatement.run(
          JSON.stringify({
            replacedBySleepSessionId: session.id,
            replacedAt: nowIso()
          }),
          nowIso(),
          historical.id
        );
        detachRawLogsStatement.run(
          JSON.stringify({
            replacedBySleepSessionId: session.id,
            replacedAt: nowIso()
          }),
          historical.id
        );
        deleteSessionStatement.run(historical.id);
      }
    }
  }
}

function ensureLegacyAppleSleepHistoryRepaired() {
  const database = getDatabase();
  if (legacyAppleSleepRepairDatabase === database) {
    return;
  }
  legacyAppleSleepRepairDatabase = database;

  const legacyRows = database
    .prepare(
      `SELECT *
       FROM health_sleep_sessions
       WHERE source = 'apple_health'
         AND raw_segment_count = 0
        AND (time_in_bed_seconds = 0 OR local_date_key = '')
       ORDER BY started_at ASC, ended_at ASC`
    )
    .all() as SleepSessionRow[];

  runInTransaction(() => {
    if (legacyRows.length > 0) {
      for (const row of legacyRows) {
        const rawLogExists = getDatabase()
          .prepare(
            `SELECT id
             FROM health_sleep_raw_logs
             WHERE source = 'apple_health'
               AND log_type = 'legacy_sleep_session_row'
               AND user_id = ?
               AND external_uid = ?
             LIMIT 1`
          )
          .get(row.user_id, row.external_uid) as { id: string } | undefined;
        if (!rawLogExists) {
          createSleepRawLog({
            sleepSessionId: null,
            importRunId: null,
            pairingSessionId: row.pairing_session_id,
            userId: row.user_id,
            source: row.source,
            logType: "legacy_sleep_session_row",
            externalUid: row.external_uid,
            sourceTimezone: row.source_timezone || defaultSleepTimeZone(),
            localDateKey: row.local_date_key || dayKey(row.ended_at),
            startedAt: row.started_at,
            endedAt: row.ended_at,
            payload: mapSleepSession(row),
            metadata: {
              legacyRowId: row.id,
              repairedVia: "canonical_sleep_backfill_v1"
            }
          });
        }
      }

      const byUser = new Map<string, SleepSessionRow[]>();
      for (const row of legacyRows) {
        const current = byUser.get(row.user_id) ?? [];
        current.push(row);
        byUser.set(row.user_id, current);
      }

      for (const [userId, rows] of byUser.entries()) {
        const clusters = clusterSleepRowsByGap(rows);
        for (const cluster of clusters) {
          const rowsForNight = selectAuthoritativeSleepRows(cluster);
          const startedAt = rowsForNight[0]!.started_at;
          const endedAt = rowsForNight.reduce(
            (latest, row) =>
              Date.parse(row.ended_at) > Date.parse(latest)
                ? row.ended_at
                : latest,
            rowsForNight[0]!.ended_at
          );
          const sourceTimezone = inferHistoricalSleepTimeZone(
            cluster.map((row) => row.source_timezone)
          );
          const localDateKey = localDateKeyForTimezone(endedAt, sourceTimezone);
          const asleepSeconds = unionDurationSeconds(
            rowsForNight.map((row) => ({
              startedAt: row.started_at,
              endedAt: row.ended_at
            }))
          );
          const timeInBedSeconds = Math.max(
            durationSecondsBetween(startedAt, endedAt),
            asleepSeconds
          );
          const awakeSeconds = Math.max(0, timeInBedSeconds - asleepSeconds);
          const stageTotals = new Map<string, number>();
          for (const row of rowsForNight) {
            for (const stage of safeJsonParse<
              Array<{ stage: string; seconds: number }>
            >(row.stage_breakdown_json, [])) {
              if (stage.seconds <= 0) {
                continue;
              }
              stageTotals.set(
                stage.stage,
                (stageTotals.get(stage.stage) ?? 0) + stage.seconds
              );
            }
          }
          const stageBreakdown = [...stageTotals.entries()].map(
            ([stage, seconds]) => ({
              stage,
              seconds
            })
          );
          const sleepScore = computeSleepScore({
            asleepSeconds,
            timeInBedSeconds,
            awakeSeconds,
            stageBreakdown
          });
          const timingMetrics = computeSleepTimingMetrics({
            userId,
            startedAt,
            endedAt,
            sourceTimezone
          });
          const derived = computeSleepDerivedMetrics({
            asleepSeconds,
            timeInBedSeconds,
            awakeSeconds,
            sleepScore,
            stageBreakdown
          });
          const annotations = mergeSleepAnnotationPayloads(
            cluster.map((row) =>
              safeJsonParse<Record<string, unknown>>(row.annotations_json, {})
            ),
            cluster.map((row) =>
              safeJsonParse<Array<z.infer<typeof healthLinkSchema>>>(
                row.links_json,
                []
              )
            )
          );
          const recoveryMetrics = cluster.reduce<Record<string, unknown>>(
            (acc, row) => {
              Object.assign(
                acc,
                safeJsonParse<Record<string, unknown>>(
                  row.recovery_metrics_json,
                  {}
                )
              );
              return acc;
            },
            {}
          );
          const sourceMetrics = {
            repairedFromLegacy: true,
            legacyClusterSize: cluster.length,
            authoritativeRowCount: rowsForNight.length
          };
          const id = `sleep_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
          getDatabase()
            .prepare(
              `INSERT INTO health_sleep_sessions (
                 id, external_uid, pairing_session_id, user_id, source, source_type, source_device,
                 source_timezone, local_date_key, started_at, ended_at, time_in_bed_seconds, asleep_seconds, awake_seconds,
                 sleep_score, regularity_score, bedtime_consistency_minutes, wake_consistency_minutes,
                 raw_segment_count, stage_breakdown_json, recovery_metrics_json, source_metrics_json, links_json, annotations_json,
                 provenance_json, derived_json, created_at, updated_at
               )
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              id,
              `legacy-repair-${startedAt}-${endedAt}`,
              cluster[0]?.pairing_session_id ?? null,
              userId,
              "apple_health",
              "healthkit_repaired",
              cluster[0]?.source_device ?? "",
              sourceTimezone,
              localDateKey,
              startedAt,
              endedAt,
              timeInBedSeconds,
              asleepSeconds,
              awakeSeconds,
              sleepScore,
              timingMetrics.regularityScore,
              timingMetrics.bedtimeConsistencyMinutes,
              timingMetrics.wakeConsistencyMinutes,
              rowsForNight.length,
              JSON.stringify(stageBreakdown),
              JSON.stringify(recoveryMetrics),
              JSON.stringify(sourceMetrics),
              JSON.stringify(annotations.links),
              JSON.stringify(annotations),
              JSON.stringify({
                repairedFromLegacy: true,
                legacyRowIds: cluster.map((row) => row.id)
              }),
              JSON.stringify(derived),
              nowIso(),
              nowIso()
            );

          const legacyExternalUids = cluster
            .map((row) => row.external_uid)
            .filter((value): value is string => value.trim().length > 0);
          if (legacyExternalUids.length > 0) {
            getDatabase()
              .prepare(
                `UPDATE health_sleep_raw_logs
                 SET sleep_session_id = ?
                 WHERE source = 'apple_health'
                   AND log_type = 'legacy_sleep_session_row'
                   AND user_id = ?
                   AND external_uid IN (${legacyExternalUids.map(() => "?").join(",")})`
              )
              .run(id, userId, ...legacyExternalUids);
          }
        }
      }

      const deleteStatement = getDatabase().prepare(
        `DELETE FROM health_sleep_sessions
         WHERE id = ?`
      );
      for (const row of legacyRows) {
        deleteStatement.run(row.id);
      }
    }

    backfillHistoricalSleepEvidence();
  });
}

function replaceHistoricalSleepSessionsForDate(
  userId: string,
  localDateKey: string,
  providerBackedSleepSessionId: string
) {
  const providerRecordCount = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM health_sleep_source_records
       WHERE sleep_session_id = ? AND quality_kind = 'provider_native'`
    )
    .get(providerBackedSleepSessionId) as { count: number };
  if (providerRecordCount.count === 0) {
    return;
  }

  const providerSession = getDatabase()
    .prepare(`SELECT * FROM health_sleep_sessions WHERE id = ?`)
    .get(providerBackedSleepSessionId) as SleepSessionRow | undefined;
  if (!providerSession) {
    return;
  }

  const historicalSessions = getDatabase()
    .prepare(
      `SELECT *
       FROM health_sleep_sessions
       WHERE user_id = ?
         AND source = 'apple_health'
         AND local_date_key = ?
         AND source_type = 'healthkit_repaired'
         AND id != ?`
    )
    .all(
      userId,
      localDateKey,
      providerBackedSleepSessionId
    ) as SleepSessionRow[];
  if (historicalSessions.length === 0) {
    return;
  }

  for (const historical of historicalSessions) {
    const currentProviderSession = getDatabase()
      .prepare(`SELECT * FROM health_sleep_sessions WHERE id = ?`)
      .get(providerBackedSleepSessionId) as SleepSessionRow;
    const mergedAnnotations = mergeSleepAnnotationPayloads(
      [
        safeJsonParse<Record<string, unknown>>(
          currentProviderSession.annotations_json,
          {}
        ),
        safeJsonParse<Record<string, unknown>>(historical.annotations_json, {})
      ],
      [
        safeJsonParse<Array<z.infer<typeof healthLinkSchema>>>(
          currentProviderSession.links_json,
          []
        ),
        safeJsonParse<Array<z.infer<typeof healthLinkSchema>>>(
          historical.links_json,
          []
        )
      ]
    );
    getDatabase()
      .prepare(
        `UPDATE health_sleep_sessions
         SET links_json = ?, annotations_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        JSON.stringify(mergedAnnotations.links),
        JSON.stringify(mergedAnnotations),
        nowIso(),
        providerBackedSleepSessionId
      );
    getDatabase()
      .prepare(
        `UPDATE health_sleep_source_records
         SET sleep_session_id = NULL, metadata_json = ?
         WHERE sleep_session_id = ?`
      )
      .run(
        JSON.stringify({
          replacedBySleepSessionId: providerBackedSleepSessionId,
          replacedAt: nowIso()
        }),
        historical.id
      );
    getDatabase()
      .prepare(
        `UPDATE health_sleep_segments
         SET sleep_session_id = NULL, provenance_json = ?, updated_at = ?
         WHERE sleep_session_id = ?`
      )
      .run(
        JSON.stringify({
          replacedBySleepSessionId: providerBackedSleepSessionId,
          replacedAt: nowIso()
        }),
        nowIso(),
        historical.id
      );
    getDatabase()
      .prepare(
        `UPDATE health_sleep_raw_logs
         SET sleep_session_id = NULL, metadata_json = ?
         WHERE sleep_session_id = ?`
      )
      .run(
        JSON.stringify({
          replacedBySleepSessionId: providerBackedSleepSessionId,
          replacedAt: nowIso()
        }),
        historical.id
      );
    getDatabase()
      .prepare(`DELETE FROM health_sleep_sessions WHERE id = ?`)
      .run(historical.id);
  }
}

function mobileSyncSessionId() {
  return `hms_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function mobileSyncChunkRecordId() {
  return `hmsc_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function expireStaleMobileSyncSessions() {
  const cutoff = new Date(
    Date.now() - HEALTH_MOBILE_SYNC_SESSION_TTL_MS
  ).toISOString();
  const now = nowIso();
  getDatabase()
    .prepare(
      `UPDATE health_mobile_sync_sessions
       SET status = 'expired', expired_at = ?, updated_at = ?
       WHERE status = 'running' AND started_at < ?`
    )
    .run(now, now, cutoff);
}

function readMobileSyncSession(syncSessionId: string) {
  return getDatabase()
    .prepare(`SELECT * FROM health_mobile_sync_sessions WHERE id = ?`)
    .get(syncSessionId) as MobileSyncSessionRow | undefined;
}

function mobileSyncSessionProgress(syncSessionId: string) {
  const chunks = getDatabase()
    .prepare(
      `SELECT family, record_count, byte_count
       FROM health_mobile_sync_chunks
       WHERE sync_session_id = ?`
    )
    .all(syncSessionId) as Array<{
    family: MobileHealthSyncFamily;
    record_count: number;
    byte_count: number;
  }>;
  const receivedCounts: Record<string, number> = {};
  const byteTotals: Record<string, number> = {};
  for (const chunk of chunks) {
    receivedCounts[chunk.family] =
      (receivedCounts[chunk.family] ?? 0) + chunk.record_count;
    byteTotals[chunk.family] =
      (byteTotals[chunk.family] ?? 0) + chunk.byte_count;
  }
  return {
    receivedCounts,
    byteTotals,
    chunkCount: chunks.length,
    receivedBytes: chunks.reduce((sum, chunk) => sum + chunk.byte_count, 0)
  };
}

function finiteNumberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const CURRENT_WORKOUT_RAW_EVIDENCE_VERSION = "healthkit-workout-raw-bulk-v4";

function expectedWorkoutEvidenceCounts(derived: Record<string, unknown>) {
  const syncCursor = nestedRecord(derived.syncCursor);
  const captureQuality = nestedRecord(derived.captureQuality);
  const captureQualityFlags = Array.isArray(captureQuality.flags)
    ? captureQuality.flags.filter((flag): flag is string => typeof flag === "string")
    : [];
  const summaryOnlyExport =
    captureQuality.status === "summary_exported" ||
    captureQualityFlags.includes("server_side_evidence_derivation");
  const syncTimeSeriesCount = finiteNumberFromUnknown(
    syncCursor.timeSeriesSampleCount
  );
  const captureHeartRateCount = summaryOnlyExport
    ? null
    : finiteNumberFromUnknown(captureQuality.heartRateSamples);
  const syncRoutePointCount = finiteNumberFromUnknown(
    syncCursor.routePointCount
  );
  const captureRoutePointCount = summaryOnlyExport
    ? null
    : finiteNumberFromUnknown(captureQuality.routePoints);
  const expectedTimeSeriesSamples = Math.max(
    0,
    Math.ceil(Math.max(syncTimeSeriesCount ?? 0, captureHeartRateCount ?? 0))
  );
  const expectedHeartRateSamples = Math.max(
    0,
    Math.ceil(captureHeartRateCount ?? 0)
  );
  const expectedRoutePoints = Math.max(
    0,
    Math.ceil(Math.max(syncRoutePointCount ?? 0, captureRoutePointCount ?? 0))
  );
  const rawEvidenceVersion =
    typeof syncCursor.rawEvidenceVersion === "string"
      ? syncCursor.rawEvidenceVersion
      : "";
  return {
    expectedTimeSeriesSamples,
    expectedHeartRateSamples,
    expectedRoutePoints,
    hasCurrentRawEvidenceVersion:
      rawEvidenceVersion === CURRENT_WORKOUT_RAW_EVIDENCE_VERSION,
    hasEvidenceMetadata:
      syncTimeSeriesCount !== null ||
      captureHeartRateCount !== null ||
      syncRoutePointCount !== null ||
      captureRoutePointCount !== null
  };
}

function mobileHealthWorkoutImportState(userId: string) {
  const rows = getDatabase()
    .prepare(
      `WITH time_series_counts AS (
         SELECT workout_id, COUNT(*) AS time_series_count
         FROM health_workout_time_series
         GROUP BY workout_id
       ),
       heart_rate_counts AS (
         SELECT workout_id, COUNT(*) AS heart_rate_count
         FROM health_workout_time_series
         WHERE metric_key = 'heart_rate'
         GROUP BY workout_id
       ),
       route_counts AS (
         SELECT workout_id, COUNT(*) AS route_point_count
         FROM health_workout_routes
         GROUP BY workout_id
       )
       SELECT
         w.external_uid,
         w.derived_json,
         COALESCE(time_series_counts.time_series_count, 0) AS time_series_count,
         COALESCE(heart_rate_counts.heart_rate_count, 0) AS heart_rate_count,
         COALESCE(route_counts.route_point_count, 0) AS route_point_count
       FROM health_workout_sessions w
       LEFT JOIN time_series_counts ON time_series_counts.workout_id = w.id
       LEFT JOIN heart_rate_counts ON heart_rate_counts.workout_id = w.id
       LEFT JOIN route_counts ON route_counts.workout_id = w.id
       WHERE w.user_id = ?
         AND w.source = 'apple_health'
         AND w.external_uid IS NOT NULL
         AND w.external_uid <> ''
       ORDER BY w.started_at DESC`
    )
    .all(userId) as Array<{
    external_uid: string;
    derived_json: string;
    time_series_count: number;
    heart_rate_count: number;
    route_point_count: number;
  }>;

  const alreadyUploadedWorkoutExternalUids: string[] = [];
  let incompleteWorkoutCount = 0;
  let timeSeriesSampleCount = 0;
  let heartRateSampleCount = 0;
  let routePointCount = 0;

  for (const row of rows) {
    const derived = safeJsonParse<Record<string, unknown>>(
      row.derived_json,
      {}
    );
    const evidenceCounts = expectedWorkoutEvidenceCounts(derived);
    const actualTimeSeriesCount = Math.max(0, row.time_series_count ?? 0);
    const actualHeartRateCount = Math.max(0, row.heart_rate_count ?? 0);
    const actualRoutePointCount = Math.max(0, row.route_point_count ?? 0);
    const evidenceComplete = evidenceCounts.hasEvidenceMetadata
      ? evidenceCounts.hasCurrentRawEvidenceVersion &&
        actualTimeSeriesCount >= evidenceCounts.expectedTimeSeriesSamples &&
        actualHeartRateCount >= evidenceCounts.expectedHeartRateSamples &&
        actualRoutePointCount >= evidenceCounts.expectedRoutePoints
      : false;

    if (evidenceComplete) {
      alreadyUploadedWorkoutExternalUids.push(row.external_uid.toLowerCase());
      timeSeriesSampleCount += actualTimeSeriesCount;
      heartRateSampleCount += actualHeartRateCount;
      routePointCount += actualRoutePointCount;
    } else {
      incompleteWorkoutCount += 1;
    }
  }

  return {
    alreadyUploadedWorkoutExternalUids,
    alreadyUploadedWorkoutCount: alreadyUploadedWorkoutExternalUids.length,
    existingWorkoutCount: rows.length,
    incompleteWorkoutCount,
    timeSeriesSampleCount,
    heartRateSampleCount,
    routePointCount,
    capturedAt: nowIso()
  };
}

function mobileSyncSessionUploadPayload(
  session: MobileSyncSessionRow,
  receivedChunkIds: string[]
) {
  return {
    syncSessionId: session.id,
    schemaVersion: HEALTH_MOBILE_SYNC_SCHEMA_VERSION,
    status: session.status,
    chunkTargetBytes: HEALTH_MOBILE_SYNC_CHUNK_TARGET_BYTES,
    chunkMaxBytes: HEALTH_MOBILE_SYNC_CHUNK_MAX_BYTES,
    chunkPayloadEncoding: HEALTH_MOBILE_SYNC_CHUNK_PAYLOAD_ENCODING,
    acceptedPayloadEncodings:
      HEALTH_MOBILE_SYNC_ACCEPTED_CHUNK_PAYLOAD_ENCODINGS,
    supportsCompression: true,
    acceptedFamilies: safeJsonParse<MobileHealthSyncFamily[]>(
      session.requested_families_json,
      []
    ),
    receivedChunkIds,
    workoutImportState: mobileHealthWorkoutImportState(session.user_id),
    progress: mobileSyncSessionProgress(session.id)
  };
}

export function getMobileHealthSyncSessionStatus(
  syncSessionId: string,
  payload: { sessionId: string; pairingToken: string }
) {
  const pairing = requireValidPairing(payload.sessionId, payload.pairingToken);
  const session = readMobileSyncSession(syncSessionId);
  if (!session || session.pairing_session_id !== pairing.id) {
    throw new HttpError(
      404,
      "sync_session_not_found",
      "The HealthKit sync session does not exist."
    );
  }
  const receivedChunkIds = getDatabase()
    .prepare(
      `SELECT chunk_id
       FROM health_mobile_sync_chunks
       WHERE sync_session_id = ?
       ORDER BY sequence ASC`
    )
    .all(syncSessionId)
    .map((row) => (row as { chunk_id: string }).chunk_id);
  return mobileSyncSessionUploadPayload(session, receivedChunkIds);
}

function ensureRunningMobileSyncSession(syncSessionId: string) {
  expireStaleMobileSyncSessions();
  const session = readMobileSyncSession(syncSessionId);
  if (!session) {
    throw new HttpError(
      404,
      "sync_session_not_found",
      "The HealthKit sync session does not exist."
    );
  }
  if (session.status !== "running") {
    throw new HttpError(
      409,
      "sync_session_closed",
      "The HealthKit sync session is no longer accepting chunks.",
      { status: session.status }
    );
  }
  return session;
}

function chunkPayloadJson(
  payload: z.infer<typeof mobileHealthSyncChunkSchema>["payload"]
) {
  return JSON.stringify(payload);
}

function chunkPayloadChecksum(payloadJson: string) {
  return createHash("sha256").update(payloadJson).digest("hex");
}

function normalizedChunkChecksum(checksum: string) {
  const normalized = checksum.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new HttpError(
      400,
      "invalid_chunk_checksum",
      "The HealthKit sync chunk checksum is invalid."
    );
  }
  return normalized;
}

function parseBase64ChunkPayload(
  payloadJsonBase64: string,
  context: {
    syncSessionId: string;
    chunkId: string;
    family: MobileHealthSyncFamily;
  }
) {
  const compactBase64 = payloadJsonBase64.replace(/\s/g, "");
  if (
    compactBase64.length === 0 ||
    compactBase64.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(compactBase64)
  ) {
    throw new HttpError(
      400,
      "invalid_chunk_payload",
      "The HealthKit sync chunk payload encoding is invalid.",
      { mode: "payload_json_base64" }
    );
  }
  const decoded = Buffer.from(compactBase64, "base64");
  const recoded = decoded.toString("base64").replace(/=+$/g, "");
  if (recoded !== compactBase64.replace(/=+$/g, "")) {
    throw new HttpError(
      400,
      "invalid_chunk_payload",
      "The HealthKit sync chunk payload encoding is invalid.",
      { mode: "payload_json_base64" }
    );
  }
  const payloadJson = decoded.toString("utf8");
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(payloadJson);
  } catch (error) {
    console.warn("[healthkit-sync] invalid chunk JSON payload", {
      syncSessionId: context.syncSessionId,
      chunkId: context.chunkId,
      family: context.family,
      mode: "payload_json_base64",
      bytes: decoded.length,
      error: error instanceof Error ? error.message : String(error)
    });
    throw new HttpError(
      400,
      "invalid_chunk_payload",
      "The HealthKit sync chunk payload is not valid JSON.",
      { mode: "payload_json_base64" }
    );
  }
  const parsedPayload = mobileHealthSyncChunkPayloadSchema.parse(rawPayload);
  return {
    payload: parsedPayload,
    payloadJson,
    byteCount: decoded.length,
    compressedByteCount: undefined,
    mode: "payload_json_base64" as const
  };
}

function parseDeflateBase64ChunkPayload(
  payloadJsonDeflateBase64: string,
  context: {
    syncSessionId: string;
    chunkId: string;
    family: MobileHealthSyncFamily;
  }
) {
  const compactBase64 = payloadJsonDeflateBase64.replace(/\s/g, "");
  if (
    compactBase64.length === 0 ||
    compactBase64.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(compactBase64)
  ) {
    throw new HttpError(
      400,
      "invalid_chunk_payload",
      "The HealthKit sync compressed payload encoding is invalid.",
      { mode: HEALTH_MOBILE_SYNC_COMPRESSED_CHUNK_PAYLOAD_ENCODING }
    );
  }
  const compressed = Buffer.from(compactBase64, "base64");
  const recoded = compressed.toString("base64").replace(/=+$/g, "");
  if (recoded !== compactBase64.replace(/=+$/g, "")) {
    throw new HttpError(
      400,
      "invalid_chunk_payload",
      "The HealthKit sync compressed payload encoding is invalid.",
      { mode: HEALTH_MOBILE_SYNC_COMPRESSED_CHUNK_PAYLOAD_ENCODING }
    );
  }

  let decoded: Buffer;
  try {
    decoded = inflateHealthSyncChunkPayload(compressed);
  } catch (error) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (errorCode === "ERR_BUFFER_TOO_LARGE") {
      throw new HttpError(
        413,
        "chunk_too_large",
        "The HealthKit sync compressed chunk expands beyond the maximum decoded size.",
        {
          maxBytes: HEALTH_MOBILE_SYNC_CHUNK_MAX_BYTES,
          compressedBytes: compressed.length,
          mode: HEALTH_MOBILE_SYNC_COMPRESSED_CHUNK_PAYLOAD_ENCODING
        }
      );
    }
    console.warn("[healthkit-sync] invalid compressed chunk payload", {
      syncSessionId: context.syncSessionId,
      chunkId: context.chunkId,
      family: context.family,
      mode: HEALTH_MOBILE_SYNC_COMPRESSED_CHUNK_PAYLOAD_ENCODING,
      compressedBytes: compressed.length,
      error: error instanceof Error ? error.message : String(error)
    });
    throw new HttpError(
      400,
      "invalid_chunk_payload",
      "The HealthKit sync compressed payload cannot be decompressed.",
      { mode: HEALTH_MOBILE_SYNC_COMPRESSED_CHUNK_PAYLOAD_ENCODING }
    );
  }

  const payloadJson = decoded.toString("utf8");
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(payloadJson);
  } catch (error) {
    console.warn("[healthkit-sync] invalid compressed chunk JSON payload", {
      syncSessionId: context.syncSessionId,
      chunkId: context.chunkId,
      family: context.family,
      mode: HEALTH_MOBILE_SYNC_COMPRESSED_CHUNK_PAYLOAD_ENCODING,
      bytes: decoded.length,
      compressedBytes: compressed.length,
      error: error instanceof Error ? error.message : String(error)
    });
    throw new HttpError(
      400,
      "invalid_chunk_payload",
      "The HealthKit sync compressed payload is not valid JSON.",
      { mode: HEALTH_MOBILE_SYNC_COMPRESSED_CHUNK_PAYLOAD_ENCODING }
    );
  }
  const parsedPayload = mobileHealthSyncChunkPayloadSchema.parse(rawPayload);
  return {
    payload: parsedPayload,
    payloadJson,
    byteCount: decoded.length,
    compressedByteCount: compressed.length,
    mode: HEALTH_MOBILE_SYNC_COMPRESSED_CHUNK_PAYLOAD_ENCODING
  };
}

function inflateHealthSyncChunkPayload(compressed: Buffer): Buffer {
  const options = { maxOutputLength: HEALTH_MOBILE_SYNC_CHUNK_MAX_BYTES + 1 };
  try {
    return inflateSync(compressed, options);
  } catch (error) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (errorCode === "ERR_BUFFER_TOO_LARGE") {
      throw error;
    }
    return inflateRawSync(compressed, options);
  }
}

function resolveChunkWirePayload(
  parsed: z.infer<typeof mobileHealthSyncChunkSchema>,
  syncSessionId: string,
  rawPayloadJson?: string
) {
  if (parsed.payloadJsonDeflateBase64) {
    return parseDeflateBase64ChunkPayload(parsed.payloadJsonDeflateBase64, {
      syncSessionId,
      chunkId: parsed.chunkId,
      family: parsed.family
    });
  }
  if (parsed.payloadJsonBase64) {
    return parseBase64ChunkPayload(parsed.payloadJsonBase64, {
      syncSessionId,
      chunkId: parsed.chunkId,
      family: parsed.family
    });
  }
  const payloadJson = rawPayloadJson ?? chunkPayloadJson(parsed.payload);
  return {
    payload: parsed.payload,
    payloadJson,
    byteCount: Buffer.byteLength(payloadJson, "utf8"),
    compressedByteCount: undefined,
    mode: "legacy_payload_object" as const
  };
}

function summarizeChunkPayload(
  family: MobileHealthSyncFamily,
  payload: z.infer<typeof mobileHealthSyncChunkSchema>["payload"]
) {
  switch (family) {
    case "sleep_nights":
      return { sleepNights: payload.sleepNights?.length ?? 0 };
    case "sleep_segments":
      return { sleepSegments: payload.sleepSegments?.length ?? 0 };
    case "sleep_raw_records":
      return { sleepRawRecords: payload.sleepRawRecords?.length ?? 0 };
    case "workout_summaries":
      return { workouts: payload.workouts?.length ?? 0 };
    case "workout_archive":
      return {
        workouts: payload.workouts?.length ?? 0,
        samples:
          payload.workouts?.reduce(
            (sum, workout) => sum + workout.timeSeriesSamples.length,
            0
          ) ?? 0,
        routePoints:
          payload.workouts?.reduce(
            (sum, workout) => sum + workout.routePoints.length,
            0
          ) ?? 0
      };
    case "workout_time_series":
      return {
        workouts: payload.workoutTimeSeries?.length ?? 0,
        samples:
          payload.workoutTimeSeries?.reduce(
            (sum, entry) => sum + entry.samples.length,
            0
          ) ?? 0
      };
    case "workout_routes":
      return {
        workouts: payload.workoutRoutes?.length ?? 0,
        routePoints:
          payload.workoutRoutes?.reduce(
            (sum, entry) => sum + entry.routePoints.length,
            0
          ) ?? 0
      };
    case "workout_tombstones":
      return { workouts: payload.workoutTombstones?.length ?? 0 };
    case "vitals":
      return { daySummaries: payload.vitals?.daySummaries.length ?? 0 };
    case "movement":
      return {
        knownPlaces: payload.movement?.knownPlaces.length ?? 0,
        stays: payload.movement?.stays.length ?? 0,
        trips: payload.movement?.trips.length ?? 0
      };
    case "screen_time":
      return {
        daySummaries: payload.screenTime?.daySummaries.length ?? 0,
        hourlySegments: payload.screenTime?.hourlySegments.length ?? 0
      };
  }
}

function mobileSyncSessionPairing(session: MobileSyncSessionRow) {
  const pairing = getDatabase()
    .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
    .get(session.pairing_session_id) as PairingSessionRow | undefined;
  if (!pairing) {
    throw new HttpError(
      404,
      "pairing_invalid",
      "The sync pairing no longer exists."
    );
  }
  return pairing;
}

function mobileSyncSessionMetadata(session: MobileSyncSessionRow) {
  return safeJsonParse<{
    sessionId?: string;
    device?: z.infer<typeof mobileHealthSyncSchema>["device"];
    permissions?: z.infer<typeof mobileHealthSyncSchema>["permissions"];
    sourceStates?: z.infer<typeof mobileHealthSyncSchema>["sourceStates"];
  }>(session.source_metadata_json, {});
}

function applyWorkoutChunkImmediately(
  session: MobileSyncSessionRow,
  family: "workout_summaries" | "workout_archive",
  workouts: z.infer<typeof mobileHealthSyncSchema>["workouts"]
) {
  if (workouts.length === 0) {
    return;
  }
  const pairing = mobileSyncSessionPairing(session);
  const metadata = mobileSyncSessionMetadata(session);
  const device = metadata.device ?? {
    name: pairing.device_name ?? "iPhone",
    platform: pairing.platform ?? "ios",
    appVersion: pairing.app_version ?? "",
    sourceDevice: pairing.device_name ?? "iPhone"
  };
  runInTransaction(() => {
    const now = nowIso();
    const runId = `hir_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    let createdCount = 0;
    let updatedCount = 0;
    let mergedCount = 0;
    getDatabase()
      .prepare(
        `INSERT INTO health_import_runs (
           id, pairing_session_id, user_id, source, source_device, status, payload_summary_json,
           imported_count, created_count, updated_count, merged_count, imported_at, created_at, updated_at
         )
         VALUES (?, ?, ?, 'ios_companion', ?, 'running', '{}', 0, 0, 0, 0, ?, ?, ?)`
      )
      .run(
        runId,
        pairing.id,
        pairing.user_id,
        device.sourceDevice,
        now,
        now,
        now
      );

    for (const workout of workouts) {
      const result = insertOrUpdateWorkoutSession(pairing, workout);
      if (result.mode === "created") {
        createdCount += 1;
      } else if (result.mode === "merged") {
        mergedCount += 1;
      } else {
        updatedCount += 1;
      }
      summarizeUserHealthDay(pairing.user_id, dayKey(workout.startedAt));
    }

    getDatabase()
      .prepare(
        `UPDATE companion_pairing_sessions
         SET status = 'healthy', device_name = ?, platform = ?, app_version = ?,
             last_seen_at = ?, last_sync_at = ?, last_sync_error = NULL,
             paired_at = COALESCE(paired_at, ?), updated_at = ?
         WHERE id = ?`
      )
      .run(
        device.name,
        device.platform,
        device.appVersion,
        now,
        now,
        now,
        now,
        pairing.id
      );

    getDatabase()
      .prepare(
        `UPDATE health_import_runs
         SET source_device = ?, status = 'completed', payload_summary_json = ?,
             imported_count = ?, created_count = ?, updated_count = ?, merged_count = ?,
             imported_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        device.sourceDevice,
        JSON.stringify({
          progressiveChunk: true,
          syncSessionId: session.id,
          family,
          workouts: workouts.length
        }),
        workouts.length,
        createdCount,
        updatedCount,
        mergedCount,
        now,
        now,
        runId
      );
  });
}

function applyWorkoutEvidenceChunkImmediately(
  session: MobileSyncSessionRow,
  payload: z.infer<typeof mobileHealthSyncChunkPayloadSchema>
) {
  const timeSeries = payload.workoutTimeSeries ?? [];
  const routes = payload.workoutRoutes ?? [];
  if (timeSeries.length === 0 && routes.length === 0) {
    return;
  }
  const pairing = mobileSyncSessionPairing(session);
  runInTransaction(() => {
    const rowsToRecompute = new Map<string, WorkoutSessionRow>();
    for (const entry of timeSeries) {
      const row = getDatabase()
        .prepare(
          `SELECT *
           FROM health_workout_sessions
           WHERE user_id = ? AND source = 'apple_health' AND external_uid = ?`
        )
        .get(pairing.user_id, entry.externalUid) as
        | WorkoutSessionRow
        | undefined;
      if (!row || entry.samples.length === 0) {
        continue;
      }
      upsertWorkoutTimeSeries({
        workoutId: row.id,
        userId: pairing.user_id,
        samples: entry.samples
      });
      rowsToRecompute.set(row.id, row);
    }
    for (const entry of routes) {
      const row = getDatabase()
        .prepare(
          `SELECT *
           FROM health_workout_sessions
           WHERE user_id = ? AND source = 'apple_health' AND external_uid = ?`
        )
        .get(pairing.user_id, entry.externalUid) as
        | WorkoutSessionRow
        | undefined;
      if (!row || entry.routePoints.length === 0) {
        continue;
      }
      upsertWorkoutRoutePoints({
        workoutId: row.id,
        userId: pairing.user_id,
        points: entry.routePoints
      });
      rowsToRecompute.set(row.id, row);
    }
    for (const row of rowsToRecompute.values()) {
      recomputeAndStoreWorkoutAnalytics(row);
      summarizeUserHealthDay(pairing.user_id, dayKey(row.started_at));
    }
  });
}

function markMobileHealthSyncChunkApplied(input: {
  syncSessionId: string;
  chunkId: string;
  payloadSummary: Record<string, unknown>;
  mode: string;
}) {
  const now = nowIso();
  getDatabase()
    .prepare(
      `UPDATE health_mobile_sync_chunks
       SET applied_at = ?, payload_summary_json = ?, updated_at = ?
       WHERE sync_session_id = ? AND chunk_id = ?`
    )
    .run(
      now,
      JSON.stringify({
        ...input.payloadSummary,
        immediateApplied: true,
        immediateAppliedAt: now,
        immediateAppliedMode: input.mode
      }),
      now,
      input.syncSessionId,
      input.chunkId
    );
}

function mobileHealthSyncChunkWasImmediatelyApplied(chunk: MobileSyncChunkRow) {
  const summary = safeJsonParse<Record<string, unknown>>(
    chunk.payload_summary_json,
    {}
  );
  return summary.immediateApplied === true;
}

function applyMovementChunkImmediately(
  session: MobileSyncSessionRow,
  payload: z.infer<typeof mobileHealthSyncChunkPayloadSchema>
) {
  if (!payload.movement) {
    return false;
  }
  const pairing = mobileSyncSessionPairing(session);
  ingestMovementSync(pairing, payload.movement);
  return true;
}

function applyScreenTimeChunkImmediately(
  session: MobileSyncSessionRow,
  payload: z.infer<typeof mobileHealthSyncChunkPayloadSchema>
) {
  if (!payload.screenTime) {
    return false;
  }
  const pairing = mobileSyncSessionPairing(session);
  const metadata = mobileSyncSessionMetadata(session);
  ingestScreenTimeSync(
    pairing,
    payload.screenTime,
    metadata.device?.sourceDevice ?? pairing.device_name ?? "iPhone"
  );
  return true;
}

function applyVitalsChunkImmediately(
  session: MobileSyncSessionRow,
  payload: z.infer<typeof mobileHealthSyncChunkPayloadSchema>
) {
  if (!payload.vitals) {
    return false;
  }
  const pairing = mobileSyncSessionPairing(session);
  for (const daySummary of payload.vitals.daySummaries) {
    upsertVitalDaySummary(pairing.user_id, daySummary);
  }
  return true;
}

function applyMobileHealthSyncChunkImmediately(
  session: MobileSyncSessionRow,
  family: MobileHealthSyncFamily,
  payload: z.infer<typeof mobileHealthSyncChunkPayloadSchema>
) {
  switch (family) {
    case "workout_summaries":
    case "workout_archive":
      applyWorkoutChunkImmediately(session, family, payload.workouts ?? []);
      return "workout_progressive_apply";
    case "workout_time_series":
    case "workout_routes":
      applyWorkoutEvidenceChunkImmediately(session, payload);
      return "workout_evidence_progressive_apply";
    case "movement":
      return applyMovementChunkImmediately(session, payload)
        ? "movement_progressive_apply"
        : null;
    case "screen_time":
      return applyScreenTimeChunkImmediately(session, payload)
        ? "screen_time_progressive_apply"
        : null;
    case "vitals":
      return applyVitalsChunkImmediately(session, payload)
        ? "vitals_progressive_apply"
        : null;
    default:
      return null;
  }
}

function updateMobileSyncSessionProgress(syncSessionId: string) {
  const progress = mobileSyncSessionProgress(syncSessionId);
  getDatabase()
    .prepare(
      `UPDATE health_mobile_sync_sessions
       SET received_counts_json = ?, byte_totals_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      JSON.stringify(progress.receivedCounts),
      JSON.stringify(progress.byteTotals),
      nowIso(),
      syncSessionId
    );
  return progress;
}

export function startMobileHealthSyncSession(
  payload: z.infer<typeof mobileHealthSyncSessionStartSchema>
) {
  const parsed = mobileHealthSyncSessionStartSchema.parse(payload);
  if (parsed.schemaVersion !== HEALTH_MOBILE_SYNC_SCHEMA_VERSION) {
    throw new HttpError(
      409,
      "schema_version_unsupported",
      "The companion HealthKit sync protocol is not supported by this Forge runtime.",
      {
        schemaVersion: HEALTH_MOBILE_SYNC_SCHEMA_VERSION,
        requestedSchemaVersion: parsed.schemaVersion
      }
    );
  }
  expireStaleMobileSyncSessions();
  const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
  const resumeSyncSessionId =
    typeof parsed.metadata.resumeSyncSessionId === "string"
      ? parsed.metadata.resumeSyncSessionId.trim()
      : "";
  if (resumeSyncSessionId.length > 0) {
    const existing = readMobileSyncSession(resumeSyncSessionId);
    if (
      existing &&
      existing.pairing_session_id === pairing.id &&
      existing.status === "running"
    ) {
      const existingFamilies = safeJsonParse<MobileHealthSyncFamily[]>(
        existing.requested_families_json,
        []
      );
      const canResume =
        existing.schema_version === HEALTH_MOBILE_SYNC_SCHEMA_VERSION &&
        parsed.requestedFamilies.every((family) =>
          existingFamilies.includes(family)
        );
      if (canResume) {
        const receivedChunkIds = getDatabase()
          .prepare(
            `SELECT chunk_id
             FROM health_mobile_sync_chunks
             WHERE sync_session_id = ?
             ORDER BY sequence ASC`
          )
          .all(resumeSyncSessionId)
          .map((row) => (row as { chunk_id: string }).chunk_id);
        return mobileSyncSessionUploadPayload(existing, receivedChunkIds);
      }
      getDatabase()
        .prepare(
          `UPDATE health_mobile_sync_sessions
           SET status = 'aborted', aborted_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(nowIso(), nowIso(), existing.id);
    }
  }
  const now = nowIso();
  const syncSessionId = mobileSyncSessionId();
  getDatabase()
    .prepare(
      `INSERT INTO health_mobile_sync_sessions (
         id, pairing_session_id, user_id, status, schema_version,
         requested_families_json, source_metadata_json, expected_counts_json,
         received_counts_json, byte_totals_json, started_at, created_at, updated_at
       )
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?, '{}', '{}', ?, ?, ?)`
    )
    .run(
      syncSessionId,
      pairing.id,
      pairing.user_id,
      HEALTH_MOBILE_SYNC_SCHEMA_VERSION,
      JSON.stringify(parsed.requestedFamilies),
      JSON.stringify({
        sessionId: parsed.sessionId,
        device: parsed.device,
        permissions: parsed.permissions,
        sourceStates: parsed.sourceStates,
        metadata: parsed.metadata
      }),
      JSON.stringify(parsed.expectedCounts),
      now,
      now,
      now
    );
  const session = readMobileSyncSession(syncSessionId);
  if (!session) {
    throw new HttpError(
      500,
      "sync_session_not_found",
      "The HealthKit sync session could not be created."
    );
  }
  return mobileSyncSessionUploadPayload(session, []);
}

export function ingestMobileHealthSyncChunk(
  syncSessionId: string,
  payload: z.infer<typeof mobileHealthSyncChunkSchema>,
  rawPayloadJson?: string
) {
  const parsed = mobileHealthSyncChunkSchema.parse(payload);
  const clientChecksum = normalizedChunkChecksum(parsed.checksumSha256);
  const session = ensureRunningMobileSyncSession(syncSessionId);
  const requestedFamilies = safeJsonParse<MobileHealthSyncFamily[]>(
    session.requested_families_json,
    []
  );
  if (
    requestedFamilies.length > 0 &&
    !requestedFamilies.includes(parsed.family)
  ) {
    throw new HttpError(
      400,
      "unsupported_family",
      "This sync session did not request that HealthKit family.",
      { family: parsed.family }
    );
  }
  const existing = getDatabase()
    .prepare(
      `SELECT * FROM health_mobile_sync_chunks
       WHERE sync_session_id = ? AND chunk_id = ?`
    )
    .get(syncSessionId, parsed.chunkId) as MobileSyncChunkRow | undefined;
  if (existing) {
    if (existing.checksum_sha256 !== clientChecksum) {
      throw new HttpError(
        409,
        "chunk_checksum_mismatch",
        "A chunk with the same id was already accepted with different content."
      );
    }
    const progress = updateMobileSyncSessionProgress(syncSessionId);
    return {
      accepted: true,
      duplicate: true,
      receivedCount: progress.chunkCount,
      receivedBytes: progress.receivedBytes,
      progress
    };
  }
  const wirePayload = resolveChunkWirePayload(
    parsed,
    syncSessionId,
    rawPayloadJson
  );
  const payloadJson = wirePayload.payloadJson;
  const actualByteCount = wirePayload.byteCount;
  if (actualByteCount > HEALTH_MOBILE_SYNC_CHUNK_MAX_BYTES) {
    throw new HttpError(
      413,
      "chunk_too_large",
      "The HealthKit sync chunk is too large.",
      {
        maxBytes: HEALTH_MOBILE_SYNC_CHUNK_MAX_BYTES,
        actualBytes: actualByteCount
      }
    );
  }
  if (
    wirePayload.mode !== "legacy_payload_object" &&
    parsed.byteCount !== actualByteCount
  ) {
    console.warn("[healthkit-sync] chunk byte count mismatch", {
      syncSessionId,
      chunkId: parsed.chunkId,
      family: parsed.family,
      mode: wirePayload.mode,
      clientByteCount: parsed.byteCount,
      actualByteCount
    });
    throw new HttpError(
      409,
      "chunk_byte_count_mismatch",
      "The HealthKit sync chunk byte count does not match its decoded payload.",
      {
        syncSessionId,
        chunkId: parsed.chunkId,
        family: parsed.family,
        actualBytes: actualByteCount,
        clientBytes: parsed.byteCount,
        mode: wirePayload.mode
      }
    );
  }
  if (
    wirePayload.compressedByteCount !== undefined &&
    parsed.compressedByteCount !== undefined &&
    parsed.compressedByteCount !== wirePayload.compressedByteCount
  ) {
    console.warn("[healthkit-sync] chunk compressed byte count mismatch", {
      syncSessionId,
      chunkId: parsed.chunkId,
      family: parsed.family,
      mode: wirePayload.mode,
      clientCompressedByteCount: parsed.compressedByteCount,
      actualCompressedByteCount: wirePayload.compressedByteCount
    });
    throw new HttpError(
      409,
      "chunk_compressed_byte_count_mismatch",
      "The HealthKit sync chunk compressed byte count does not match its decoded payload.",
      {
        syncSessionId,
        chunkId: parsed.chunkId,
        family: parsed.family,
        actualCompressedBytes: wirePayload.compressedByteCount,
        clientCompressedBytes: parsed.compressedByteCount,
        mode: wirePayload.mode
      }
    );
  }
  const serverChecksum = chunkPayloadChecksum(payloadJson);
  if (clientChecksum !== serverChecksum) {
    console.warn("[healthkit-sync] chunk checksum mismatch", {
      syncSessionId,
      chunkId: parsed.chunkId,
      family: parsed.family,
      mode: wirePayload.mode,
      clientChecksum: clientChecksum.slice(0, 12),
      serverChecksum: serverChecksum.slice(0, 12),
      clientByteCount: parsed.byteCount,
      actualByteCount
    });
    throw new HttpError(
      409,
      "chunk_checksum_mismatch",
      "The HealthKit sync chunk checksum does not match its payload.",
      {
        syncSessionId,
        chunkId: parsed.chunkId,
        family: parsed.family,
        actualBytes: actualByteCount,
        clientBytes: parsed.byteCount,
        clientChecksumPrefix: clientChecksum.slice(0, 12),
        serverChecksumPrefix: serverChecksum.slice(0, 12),
        mode: wirePayload.mode
      }
    );
  }
  return runInTransaction(() => {
    const now = nowIso();
    const payloadSummary = {
      ...summarizeChunkPayload(parsed.family, wirePayload.payload),
      clientByteCount: parsed.byteCount,
      actualByteCount,
      compressedByteCount: wirePayload.compressedByteCount ?? null,
      serverChecksum,
      mode: wirePayload.mode
    };
    getDatabase()
      .prepare(
        `INSERT INTO health_mobile_sync_chunks (
           id, sync_session_id, chunk_id, sequence, family, checksum_sha256,
           record_count, byte_count, payload_json, payload_summary_json,
           received_at, applied_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        mobileSyncChunkRecordId(),
        syncSessionId,
        parsed.chunkId,
        parsed.sequence,
        parsed.family,
        serverChecksum,
        parsed.recordCount,
        actualByteCount,
        payloadJson,
        JSON.stringify(payloadSummary),
        now,
        now,
        now
      );
    const appliedMode = applyMobileHealthSyncChunkImmediately(
      session,
      parsed.family,
      wirePayload.payload
    );
    if (appliedMode) {
      markMobileHealthSyncChunkApplied({
        syncSessionId,
        chunkId: parsed.chunkId,
        payloadSummary,
        mode: appliedMode
      });
    }
    const progress = updateMobileSyncSessionProgress(syncSessionId);
    return {
      accepted: true,
      duplicate: false,
      receivedCount: progress.chunkCount,
      receivedBytes: progress.receivedBytes,
      progress
    };
  });
}

function mergeMobileHealthSyncChunks(
  session: MobileSyncSessionRow,
  chunks: MobileSyncChunkRow[],
  options: { skipImmediatelyApplied?: boolean } = {}
) {
  const pairing = getDatabase()
    .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
    .get(session.pairing_session_id) as PairingSessionRow | undefined;
  if (!pairing) {
    throw new HttpError(
      404,
      "pairing_invalid",
      "The sync pairing no longer exists."
    );
  }
  const metadata = safeJsonParse<{
    sessionId?: string;
    device?: z.infer<typeof mobileHealthSyncSchema>["device"];
    permissions?: z.infer<typeof mobileHealthSyncSchema>["permissions"];
    sourceStates?: z.infer<typeof mobileHealthSyncSchema>["sourceStates"];
  }>(session.source_metadata_json, {});
  const assembled = mobileHealthSyncSchema.parse({
    sessionId: metadata.sessionId ?? pairing.id,
    pairingToken: pairing.pairing_token,
    device:
      metadata.device ??
      ({
        name: pairing.device_name ?? "iPhone",
        platform: pairing.platform ?? "ios",
        appVersion: pairing.app_version ?? "",
        sourceDevice: pairing.device_name ?? "iPhone"
      } satisfies z.infer<typeof mobileHealthSyncSchema>["device"]),
    permissions:
      metadata.permissions ??
      ({
        healthKitAuthorized: false,
        backgroundRefreshEnabled: false,
        motionReady: false,
        locationReady: false,
        screenTimeReady: false
      } satisfies z.infer<typeof mobileHealthSyncSchema>["permissions"]),
    sourceStates: metadata.sourceStates,
    sleepSessions: [],
    sleepNights: [],
    sleepSegments: [],
    sleepRawRecords: [],
    workouts: [],
    vitals: { daySummaries: [] },
    movement: {},
    screenTime: {}
  });
  const workoutsByExternalUid = new Map<
    string,
    z.infer<typeof mobileHealthSyncSchema>["workouts"][number]
  >();
  const tombstones: z.infer<
    typeof workoutTombstoneChunkPayloadSchema
  >["workouts"] = [];

  for (const chunk of chunks.sort(
    (left, right) => left.sequence - right.sequence
  )) {
    const payload = mobileHealthSyncChunkPayloadSchema.parse(
      safeJsonParse<Record<string, unknown>>(chunk.payload_json, {})
    );
    const skipRecords =
      options.skipImmediatelyApplied === true &&
      mobileHealthSyncChunkWasImmediatelyApplied(chunk);
    if (skipRecords) {
      if (payload.movement?.settings) {
        assembled.movement.settings = payload.movement.settings;
      }
      if (payload.screenTime?.settings) {
        assembled.screenTime.settings = payload.screenTime.settings;
      }
      continue;
    }
    if (payload.sleepNights) {
      assembled.sleepNights.push(...payload.sleepNights);
    }
    if (payload.sleepSegments) {
      assembled.sleepSegments.push(...payload.sleepSegments);
    }
    if (payload.sleepRawRecords) {
      assembled.sleepRawRecords.push(...payload.sleepRawRecords);
    }
    if (payload.workouts) {
      for (const workout of payload.workouts) {
        const previous = workoutsByExternalUid.get(workout.externalUid);
        workoutsByExternalUid.set(workout.externalUid, {
          ...(previous ?? workout),
          ...workout,
          timeSeriesSamples: [
            ...(previous?.timeSeriesSamples ?? []),
            ...workout.timeSeriesSamples
          ],
          routePoints: [
            ...(previous?.routePoints ?? []),
            ...workout.routePoints
          ]
        });
      }
    }
    if (payload.workoutTimeSeries) {
      for (const entry of payload.workoutTimeSeries) {
        const workout = workoutsByExternalUid.get(entry.externalUid);
        if (!workout) {
          throw new HttpError(
            409,
            "missing_required_chunks",
            "A workout time-series chunk arrived without a matching workout summary.",
            { workoutExternalUid: entry.externalUid }
          );
        }
        workout.timeSeriesSamples.push(...entry.samples);
      }
    }
    if (payload.workoutRoutes) {
      for (const entry of payload.workoutRoutes) {
        const workout = workoutsByExternalUid.get(entry.externalUid);
        if (!workout) {
          throw new HttpError(
            409,
            "missing_required_chunks",
            "A workout route chunk arrived without a matching workout summary.",
            { workoutExternalUid: entry.externalUid }
          );
        }
        workout.routePoints.push(...entry.routePoints);
      }
    }
    if (payload.workoutTombstones) {
      tombstones.push(...payload.workoutTombstones);
    }
    if (payload.vitals) {
      assembled.vitals.daySummaries.push(...payload.vitals.daySummaries);
    }
    if (payload.movement) {
      assembled.movement.settings = payload.movement.settings;
      assembled.movement.knownPlaces.push(...payload.movement.knownPlaces);
      assembled.movement.stays.push(...payload.movement.stays);
      assembled.movement.trips.push(...payload.movement.trips);
    }
    if (payload.screenTime) {
      assembled.screenTime.settings = payload.screenTime.settings;
      assembled.screenTime.daySummaries.push(
        ...payload.screenTime.daySummaries
      );
      assembled.screenTime.hourlySegments.push(
        ...payload.screenTime.hourlySegments
      );
    }
  }

  assembled.workouts = [...workoutsByExternalUid.values()].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt)
  );
  return { assembled, tombstones };
}

function applyWorkoutTombstones(
  pairing: PairingSessionRow,
  tombstones: z.infer<typeof workoutTombstoneChunkPayloadSchema>["workouts"]
) {
  if (tombstones.length === 0) {
    return 0;
  }
  const deleteStmt = getDatabase().prepare(
    `DELETE FROM health_workout_sessions
     WHERE user_id = ? AND source = 'apple_health' AND external_uid = ?`
  );
  let deleted = 0;
  for (const tombstone of tombstones) {
    const result = deleteStmt.run(pairing.user_id, tombstone.externalUid);
    deleted += Number(result.changes ?? 0);
  }
  return deleted;
}

function upsertMobileSyncFamilyCursors(
  pairing: PairingSessionRow,
  finalCursor: Record<string, unknown>
) {
  const now = nowIso();
  const stmt = getDatabase().prepare(
    `INSERT INTO health_mobile_sync_family_cursors (
       id, pairing_session_id, user_id, family, cursor_json, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(pairing_session_id, family)
     DO UPDATE SET cursor_json = excluded.cursor_json, updated_at = excluded.updated_at`
  );
  for (const [family, cursor] of Object.entries(finalCursor)) {
    stmt.run(
      `hmscur_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      pairing.id,
      pairing.user_id,
      family,
      JSON.stringify(cursor),
      now
    );
  }
}

function validateMobileSyncExpectedCounts(
  syncSessionId: string,
  expectedCounts: Record<string, number>
) {
  const expectedEntries = Object.entries(expectedCounts).filter(
    ([, expected]) => Number.isFinite(expected) && expected > 0
  );
  if (expectedEntries.length === 0) {
    return;
  }
  const progress = updateMobileSyncSessionProgress(syncSessionId);
  const missingFamilies = expectedEntries
    .map(([family, expected]) => ({
      family,
      expected,
      received: progress.receivedCounts[family] ?? 0
    }))
    .filter((entry) => entry.received < entry.expected);
  if (missingFamilies.length > 0) {
    throw new HttpError(
      409,
      "missing_required_chunks",
      "The HealthKit sync session is missing required chunks.",
      { families: missingFamilies }
    );
  }
}

function aggregateMobileSyncChunkCounts(chunks: MobileSyncChunkRow[]) {
  const counts = {
    sleepNights: 0,
    sleepSegments: 0,
    sleepRawRecords: 0,
    workouts: 0,
    vitalsDaySummaries: 0,
    movementKnownPlaces: 0,
    movementStays: 0,
    movementTrips: 0,
    screenTimeDaySummaries: 0,
    screenTimeHourlySegments: 0
  };
  for (const chunk of chunks) {
    const summary = safeJsonParse<Record<string, unknown>>(
      chunk.payload_summary_json,
      {}
    );
    const numberValue = (key: string) =>
      typeof summary[key] === "number" && Number.isFinite(summary[key])
        ? summary[key]
        : 0;
    switch (chunk.family) {
      case "sleep_nights":
        counts.sleepNights += numberValue("sleepNights");
        break;
      case "sleep_segments":
        counts.sleepSegments += numberValue("sleepSegments");
        break;
      case "sleep_raw_records":
        counts.sleepRawRecords += numberValue("sleepRawRecords");
        break;
      case "workout_summaries":
      case "workout_archive":
        counts.workouts += numberValue("workouts");
        break;
      case "vitals":
        counts.vitalsDaySummaries += numberValue("daySummaries");
        break;
      case "movement":
        counts.movementKnownPlaces += numberValue("knownPlaces");
        counts.movementStays += numberValue("stays");
        counts.movementTrips += numberValue("trips");
        break;
      case "screen_time":
        counts.screenTimeDaySummaries += numberValue("daySummaries");
        counts.screenTimeHourlySegments += numberValue("hourlySegments");
        break;
    }
  }
  return counts;
}

function syncReceiptWithChunkCounts<
  T extends ReturnType<typeof ingestMobileHealthSync>
>(sync: T, chunks: MobileSyncChunkRow[]): T {
  const counts = aggregateMobileSyncChunkCounts(chunks);
  return {
    ...sync,
    imported: {
      ...sync.imported,
      sleepNights: Math.max(sync.imported.sleepNights ?? 0, counts.sleepNights),
      sleepSegments: Math.max(
        sync.imported.sleepSegments ?? 0,
        counts.sleepSegments
      ),
      sleepRawRecords: Math.max(
        sync.imported.sleepRawRecords ?? 0,
        counts.sleepRawRecords
      ),
      workouts: Math.max(sync.imported.workouts, counts.workouts),
      vitalsDaySummaries: Math.max(
        sync.imported.vitalsDaySummaries ?? 0,
        counts.vitalsDaySummaries
      ),
      movementKnownPlaces: Math.max(
        sync.imported.movementKnownPlaces ?? 0,
        counts.movementKnownPlaces
      ),
      movementStays: Math.max(
        sync.imported.movementStays ?? 0,
        counts.movementStays
      ),
      movementTrips: Math.max(
        sync.imported.movementTrips ?? 0,
        counts.movementTrips
      ),
      screenTimeDaySummaries: Math.max(
        sync.imported.screenTimeDaySummaries ?? 0,
        counts.screenTimeDaySummaries
      ),
      screenTimeHourlySegments: Math.max(
        sync.imported.screenTimeHourlySegments ?? 0,
        counts.screenTimeHourlySegments
      )
    }
  };
}

function markMobileSyncSessionFailed(
  session: MobileSyncSessionRow,
  error: unknown
) {
  const now = nowIso();
  const errorMessage = error instanceof Error ? error.message : String(error);
  getDatabase()
    .prepare(
      `UPDATE health_mobile_sync_sessions
       SET status = 'failed', failed_at = ?, error_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      now,
      JSON.stringify({
        message: errorMessage
      }),
      now,
      session.id
    );
  getDatabase()
    .prepare(
      `UPDATE companion_pairing_sessions
       SET last_sync_error = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(errorMessage, now, session.pairing_session_id);
}

export function completeMobileHealthSyncSession(
  syncSessionId: string,
  payload: z.infer<typeof mobileHealthSyncSessionCompleteSchema>
) {
  const parsed = mobileHealthSyncSessionCompleteSchema.parse(payload);
  const session = ensureRunningMobileSyncSession(syncSessionId);
  const chunks = getDatabase()
    .prepare(
      `SELECT * FROM health_mobile_sync_chunks
       WHERE sync_session_id = ?
       ORDER BY sequence ASC`
    )
    .all(syncSessionId) as MobileSyncChunkRow[];
  if (chunks.length === 0) {
    throw new HttpError(
      409,
      "missing_required_chunks",
      "The HealthKit sync session has no accepted chunks."
    );
  }
  const pairing = getDatabase()
    .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
    .get(session.pairing_session_id) as PairingSessionRow;
  try {
    return runInTransaction(() => {
      validateMobileSyncExpectedCounts(syncSessionId, parsed.expectedCounts);
      const { assembled, tombstones } = mergeMobileHealthSyncChunks(
        session,
        chunks,
        { skipImmediatelyApplied: true }
      );
      const sync = ingestMobileHealthSync(assembled);
      const deletedWorkoutCount = applyWorkoutTombstones(pairing, tombstones);
      upsertMobileSyncFamilyCursors(pairing, parsed.finalCursor);
      const now = nowIso();
      getDatabase()
        .prepare(
          `UPDATE health_mobile_sync_sessions
           SET status = 'completed', expected_counts_json = ?, completed_at = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(JSON.stringify(parsed.expectedCounts), now, now, syncSessionId);
      return {
        ...syncReceiptWithChunkCounts(sync, chunks),
        upload: {
          syncSessionId,
          chunks: chunks.length,
          deletedWorkoutCount
        }
      };
    });
  } catch (error) {
    markMobileSyncSessionFailed(session, error);
    throw error;
  }
}

export function abortMobileHealthSyncSession(syncSessionId: string) {
  const session = ensureRunningMobileSyncSession(syncSessionId);
  const now = nowIso();
  getDatabase()
    .prepare(
      `UPDATE health_mobile_sync_sessions
       SET status = 'aborted', aborted_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(now, now, session.id);
  return { syncSessionId, status: "aborted" as const };
}

export function ingestMobileHealthSync(
  payload: z.infer<typeof mobileHealthSyncSchema>
) {
  const parsed = mobileHealthSyncSchema.parse(payload);
  ensureLegacyAppleSleepHistoryRepaired();
  const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
  return runInTransaction(() => {
    const now = nowIso();
    const runId = `hir_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const normalizedSleepNights = listNormalizedSleepNights(parsed);
    const normalizedSleepSegments = listNormalizedSleepSegments(parsed);
    const normalizedSleepRawRecords = listNormalizedSleepRawRecords(parsed);
    const vitalMetricEntries = parsed.vitals.daySummaries.reduce(
      (sum, day) => sum + day.metrics.length,
      0
    );
    let createdCount = 0;
    let updatedCount = 0;
    let mergedCount = 0;
    getDatabase()
      .prepare(
        `INSERT INTO health_import_runs (
           id, pairing_session_id, user_id, source, source_device, status, payload_summary_json,
           imported_count, created_count, updated_count, merged_count, imported_at, created_at, updated_at
         )
         VALUES (?, ?, ?, 'ios_companion', ?, 'running', '{}', 0, 0, 0, 0, ?, ?, ?)`
      )
      .run(
        runId,
        pairing.id,
        pairing.user_id,
        parsed.device.sourceDevice,
        now,
        now,
        now
      );
    syncPairingSourceStatesFromPayload(pairing, parsed);
    const movementSync = ingestMovementSync(pairing, parsed.movement);
    const screenTimeSync = ingestScreenTimeSync(
      pairing,
      parsed.screenTime,
      parsed.device.sourceDevice
    );

    const sleepSessionsByLocalDate = new Map<
      string,
      Array<{ id: string; startedAt: string; endedAt: string }>
    >();
    const sourceRecordIdsByExternalUid = new Map<string, string>();

    for (const sleep of normalizedSleepNights) {
      const result = insertOrUpdateSleepSession(pairing, sleep);
      if (result.mode === "created") {
        createdCount += 1;
      } else {
        updatedCount += 1;
      }
      const group = sleepSessionsByLocalDate.get(sleep.localDateKey) ?? [];
      group.push({
        id: result.id,
        startedAt: sleep.startedAt,
        endedAt: sleep.endedAt
      });
      sleepSessionsByLocalDate.set(sleep.localDateKey, group);
      summarizeUserHealthDay(pairing.user_id, sleep.localDateKey);
    }

    for (const rawRecord of normalizedSleepRawRecords) {
      const candidateSessions =
        sleepSessionsByLocalDate.get(rawRecord.localDateKey) ?? [];
      const sleepSessionId =
        candidateSessions.find(
          (session) =>
            Date.parse(rawRecord.endedAt) > Date.parse(session.startedAt) &&
            Date.parse(rawRecord.startedAt) < Date.parse(session.endedAt)
        )?.id ?? null;
      const result = upsertSleepSourceRecord({
        pairing,
        importRunId: runId,
        sleepSessionId,
        rawRecord,
        qualityKind: "provider_native"
      });
      sourceRecordIdsByExternalUid.set(rawRecord.externalUid, result.id);
      if (result.mode === "created") {
        createdCount += 1;
      } else {
        updatedCount += 1;
      }
    }

    for (const segment of normalizedSleepSegments) {
      const candidateSessions =
        sleepSessionsByLocalDate.get(segment.localDateKey) ?? [];
      const sleepSessionId =
        candidateSessions.find(
          (session) =>
            Date.parse(segment.endedAt) > Date.parse(session.startedAt) &&
            Date.parse(segment.startedAt) < Date.parse(session.endedAt)
        )?.id ?? null;
      const result = upsertSleepSegment({
        pairing,
        importRunId: runId,
        sleepSessionId,
        segment,
        sourceRecordIds: sourceRecordIdsByExternalUid.has(segment.externalUid)
          ? [sourceRecordIdsByExternalUid.get(segment.externalUid)!]
          : [],
        qualityKind: sourceRecordIdsByExternalUid.has(segment.externalUid)
          ? "provider_native"
          : "reconstructed"
      });
      if (result.mode === "created") {
        createdCount += 1;
      } else {
        updatedCount += 1;
      }
      if (sleepSessionId) {
        refreshSleepSessionRawSegmentCount(sleepSessionId);
      }
    }

    for (const sleep of normalizedSleepNights) {
      const targetSessionId =
        sleepSessionsByLocalDate
          .get(sleep.localDateKey)
          ?.find(
            (session) =>
              session.startedAt === sleep.startedAt &&
              session.endedAt === sleep.endedAt
          )?.id ?? null;
      if (targetSessionId) {
        replaceHistoricalSleepSessionsForDate(
          pairing.user_id,
          sleep.localDateKey,
          targetSessionId
        );
      }
    }

    for (const workout of parsed.workouts) {
      const result = insertOrUpdateWorkoutSession(pairing, workout);
      if (result.mode === "created") {
        createdCount += 1;
      } else if (result.mode === "merged") {
        mergedCount += 1;
      } else {
        updatedCount += 1;
      }
      summarizeUserHealthDay(pairing.user_id, dayKey(workout.startedAt));
    }

    for (const daySummary of parsed.vitals.daySummaries) {
      upsertVitalDaySummary(pairing.user_id, daySummary);
    }

    const permissionStatus =
      parsed.permissions.healthKitAuthorized === false
        ? "permission_denied"
        : "healthy";
    getDatabase()
      .prepare(
        `UPDATE companion_pairing_sessions
         SET status = ?, device_name = ?, platform = ?, app_version = ?, last_seen_at = ?,
             last_sync_at = ?, last_sync_error = NULL, paired_at = COALESCE(paired_at, ?), updated_at = ?
         WHERE id = ?`
      )
      .run(
        permissionStatus,
        parsed.device.name,
        parsed.device.platform,
        parsed.device.appVersion,
        now,
        now,
        now,
        now,
        pairing.id
      );

    getDatabase()
      .prepare(
        `UPDATE health_import_runs
         SET source_device = ?, status = 'completed', payload_summary_json = ?,
             imported_count = ?, created_count = ?, updated_count = ?, merged_count = ?,
             imported_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        parsed.device.sourceDevice,
        JSON.stringify({
          permissions: parsed.permissions,
          sleepSessions: parsed.sleepSessions.length,
          sleepNights: normalizedSleepNights.length,
          sleepSegments: normalizedSleepSegments.length,
          sleepRawRecords: normalizedSleepRawRecords.length,
          workouts: parsed.workouts.length,
          vitals: {
            daySummaries: parsed.vitals.daySummaries.length,
            metricEntries: vitalMetricEntries
          },
          movement: {
            knownPlaces: parsed.movement.knownPlaces.length,
            stays: parsed.movement.stays.length,
            trips: parsed.movement.trips.length
          },
          screenTime: {
            daySummaries: parsed.screenTime.daySummaries.length,
            hourlySegments: parsed.screenTime.hourlySegments.length,
            authorizationStatus: parsed.screenTime.settings.authorizationStatus,
            captureState: parsed.screenTime.settings.captureState
          }
        }),
        normalizedSleepNights.length +
          normalizedSleepSegments.length +
          normalizedSleepRawRecords.length +
          parsed.workouts.length +
          parsed.vitals.daySummaries.length +
          parsed.movement.stays.length +
          parsed.movement.trips.length +
          parsed.screenTime.daySummaries.length +
          parsed.screenTime.hourlySegments.length,
        createdCount + movementSync.createdCount + screenTimeSync.createdCount,
        updatedCount + movementSync.updatedCount + screenTimeSync.updatedCount,
        mergedCount,
        now,
        now,
        runId
      );

    recordActivityEvent({
      entityType: "system",
      entityId: pairing.id,
      eventType: "companion_sync_completed",
      title: `Forge Companion sync: ${parsed.device.name}`,
      description:
        "The iOS companion imported Apple Health sleep and workout records into Forge.",
      actor: "Forge Companion",
      source: "system",
      metadata: {
        sleepSessions: parsed.sleepSessions.length,
        sleepNights: normalizedSleepNights.length,
        sleepSegments: normalizedSleepSegments.length,
        sleepRawRecords: normalizedSleepRawRecords.length,
        workouts: parsed.workouts.length,
        vitalsDaySummaries: parsed.vitals.daySummaries.length,
        vitalsMetricEntries: vitalMetricEntries,
        movementStays: parsed.movement.stays.length,
        movementTrips: parsed.movement.trips.length,
        screenTimeDaySummaries: parsed.screenTime.daySummaries.length,
        screenTimeHourlySegments: parsed.screenTime.hourlySegments.length,
        createdCount: createdCount + movementSync.createdCount,
        updatedCount:
          updatedCount +
          movementSync.updatedCount +
          screenTimeSync.updatedCount,
        mergedCount
      }
    });

    return {
      pairingSession: mapPairingSession(
        getDatabase()
          .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
          .get(pairing.id) as PairingSessionRow
      ),
      imported: {
        sleepSessions: parsed.sleepSessions.length,
        sleepNights: normalizedSleepNights.length,
        sleepSegments: normalizedSleepSegments.length,
        sleepRawRecords: normalizedSleepRawRecords.length,
        workouts: parsed.workouts.length,
        vitalsDaySummaries: parsed.vitals.daySummaries.length,
        vitalsMetricEntries: vitalMetricEntries,
        createdCount:
          createdCount +
          movementSync.createdCount +
          screenTimeSync.createdCount,
        updatedCount:
          updatedCount +
          movementSync.updatedCount +
          screenTimeSync.updatedCount,
        mergedCount,
        movementStays: parsed.movement.stays.length,
        movementTrips: parsed.movement.trips.length,
        movementKnownPlaces: parsed.movement.knownPlaces.length,
        screenTimeDaySummaries: parsed.screenTime.daySummaries.length,
        screenTimeHourlySegments: parsed.screenTime.hourlySegments.length
      },
      movement: getMovementMobileBootstrap(pairing)
    };
  });
}

export function getCompanionOverview(userIds?: string[]) {
  const pairings = listPairingSessions(userIds);
  const importRuns = listHealthImportRunRows(userIds).map(mapHealthImportRun);
  const sleepSessions = listSleepRows(userIds).map(mapSleepSession);
  const sleepSegments = getDatabase()
    .prepare(
      userIds && userIds.length > 0
        ? `SELECT COUNT(*) AS count
           FROM health_sleep_segments
           WHERE user_id IN (${userIds.map(() => "?").join(",")})`
        : `SELECT COUNT(*) AS count FROM health_sleep_segments`
    )
    .get(...(userIds ?? [])) as { count: number };
  const sleepRawRecords = getDatabase()
    .prepare(
      userIds && userIds.length > 0
        ? `SELECT COUNT(*) AS count
           FROM health_sleep_source_records
           WHERE user_id IN (${userIds.map(() => "?").join(",")})`
        : `SELECT COUNT(*) AS count FROM health_sleep_source_records`
    )
    .get(...(userIds ?? [])) as { count: number };
  const sleepRawLogs = getDatabase()
    .prepare(
      userIds && userIds.length > 0
        ? `SELECT COUNT(*) AS count
           FROM health_sleep_raw_logs
           WHERE user_id IN (${userIds.map(() => "?").join(",")})`
        : `SELECT COUNT(*) AS count FROM health_sleep_raw_logs`
    )
    .get(...(userIds ?? [])) as { count: number };
  const workouts = listWorkoutRows(userIds).map((row) =>
    mapWorkoutSession(row)
  );
  const vitalsRows = listDailySummaryRows("vitals", userIds);
  const vitalsMetricEntries = vitalsRows.reduce((sum, row) => {
    const metrics = safeJsonParse<Record<string, unknown>>(
      row.metrics_json,
      {}
    );
    return sum + Object.keys(metrics).length;
  }, 0);
  const movementSummary = importRuns.reduce(
    (totals, run) => {
      const movement =
        safeJsonParse<Record<string, number>>(
          JSON.stringify(
            (run.payloadSummary as Record<string, unknown>).movement ?? {}
          ),
          {}
        ) ?? {};
      return {
        knownPlaces: totals.knownPlaces + (movement.knownPlaces ?? 0),
        stays: totals.stays + (movement.stays ?? 0),
        trips: totals.trips + (movement.trips ?? 0),
        screenTimeDays:
          totals.screenTimeDays +
          ((
            (run.payloadSummary as Record<string, unknown>).screenTime as
              | Record<string, number>
              | undefined
          )?.daySummaries ?? 0),
        screenTimeHourlySegments:
          totals.screenTimeHourlySegments +
          ((
            (run.payloadSummary as Record<string, unknown>).screenTime as
              | Record<string, number>
              | undefined
          )?.hourlySegments ?? 0)
      };
    },
    {
      knownPlaces: 0,
      stays: 0,
      trips: 0,
      screenTimeDays: 0,
      screenTimeHourlySegments: 0
    }
  );
  const activePairings = pairings.filter(
    (pairing) => pairing.status !== "revoked"
  );
  const recentPermissionStates = importRuns
    .map((run) =>
      safeJsonParse<Record<string, unknown>>(
        JSON.stringify(run.payloadSummary),
        {}
      )
    )
    .map((payloadSummary) =>
      safeJsonParse<Record<string, boolean>>(
        JSON.stringify(payloadSummary.permissions ?? {}),
        {}
      )
    );
  const lastSyncAt =
    pairings
      .map((pairing) => pairing.lastSyncAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  return {
    pairings,
    importRuns,
    healthState:
      activePairings.length === 0
        ? "disconnected"
        : activePairings.some(
              (pairing) => pairing.status === "permission_denied"
            )
          ? "partially_connected"
          : activePairings.some((pairing) => pairing.status === "stale")
            ? "stale_sync"
            : activePairings.some((pairing) => pairing.status === "healthy")
              ? "healthy_sync"
              : "connected",
    lastSyncAt,
    counts: {
      sleepSessions: sleepSessions.length,
      sleepSegments: sleepSegments.count,
      sleepRawRecords: sleepRawRecords.count,
      sleepRawLogs: sleepRawLogs.count,
      workouts: workouts.length,
      reflectiveSleepSessions: sleepSessions.filter((session) => {
        const annotations = session.annotations as Record<string, unknown>;
        const tags = Array.isArray(annotations.tags) ? annotations.tags : [];
        return (
          session.links.length > 0 ||
          (typeof annotations.qualitySummary === "string" &&
            annotations.qualitySummary.length > 0) ||
          (typeof annotations.notes === "string" &&
            annotations.notes.length > 0) ||
          tags.length > 0
        );
      }).length,
      linkedWorkouts: workouts.filter((session) => session.links.length > 0)
        .length,
      habitGeneratedWorkouts: workouts.filter(
        (session) => session.sourceType === "habit_generated"
      ).length,
      reconciledWorkouts: workouts.filter(
        (session) => session.reconciliationStatus === "merged"
      ).length,
      vitalsDaySummaries: vitalsRows.length,
      vitalsMetricEntries,
      movementKnownPlaces: movementSummary.knownPlaces,
      movementStays: movementSummary.stays,
      movementTrips: movementSummary.trips,
      screenTimeDaySummaries: movementSummary.screenTimeDays,
      screenTimeHourlySegments: movementSummary.screenTimeHourlySegments
    },
    permissions: {
      healthKitAuthorized: recentPermissionStates.some(
        (state) => state.healthKitAuthorized === true
      ),
      backgroundRefreshEnabled: recentPermissionStates.some(
        (state) => state.backgroundRefreshEnabled === true
      ),
      locationReady: recentPermissionStates.some(
        (state) => state.locationReady === true
      ),
      motionReady: recentPermissionStates.some(
        (state) => state.motionReady === true
      ),
      screenTimeReady: recentPermissionStates.some(
        (state) => state.screenTimeReady === true
      )
    }
  };
}

export function getSleepViewData(userIds?: string[]) {
  const sessions = listSleepRows(userIds).map(mapSleepSession);
  const displaySessions = pickDisplaySleepSessions(sessions);
  const recentDisplay = displaySessions.slice(0, 30);
  const weekly = recentDisplay.slice(0, 7);
  const monthly = recentDisplay.slice(0, 30);
  const calendarWindow = displaySessions.slice(0, 84);
  const latestNight = recentDisplay[0] ?? null;
  const weeklyBaseline =
    weekly.length > 1
      ? Math.round(
          average(weekly.slice(1).map((session) => session.asleepSeconds))
        )
      : Math.round(average(weekly.map((session) => session.asleepSeconds)));
  const stageTotals = new Map<string, number>();
  const linkTotals = new Map<string, number>();

  for (const session of monthly) {
    for (const stage of session.stageBreakdown) {
      stageTotals.set(
        stage.stage,
        (stageTotals.get(stage.stage) ?? 0) + stage.seconds
      );
    }
    for (const link of session.links) {
      linkTotals.set(
        link.entityType,
        (linkTotals.get(link.entityType) ?? 0) + 1
      );
    }
  }

  return {
    summary: {
      totalSleepSeconds: weekly.reduce(
        (sum, session) => sum + session.asleepSeconds,
        0
      ),
      averageSleepSeconds: Math.round(
        average(weekly.map((session) => session.asleepSeconds))
      ),
      averageTimeInBedSeconds: Math.round(
        average(weekly.map((session) => session.timeInBedSeconds))
      ),
      averageSleepScore: Math.round(
        average(
          weekly
            .map((session) => session.sleepScore)
            .filter((value): value is number => value !== null)
        )
      ),
      averageRegularityScore: Math.round(
        average(
          weekly
            .map((session) => session.regularityScore)
            .filter((value): value is number => value !== null)
        )
      ),
      averageEfficiency: round(
        average(
          weekly.map((session) =>
            typeof (session.derived as Record<string, unknown>).efficiency ===
            "number"
              ? ((session.derived as Record<string, unknown>)
                  .efficiency as number)
              : session.timeInBedSeconds > 0
                ? session.asleepSeconds / session.timeInBedSeconds
                : 0
          )
        ),
        2
      ),
      averageRestorativeShare: round(
        average(weekly.map((session) => sleepRestorativeShare(session))),
        2
      ),
      reflectiveNightCount: weekly.filter((session) =>
        sleepHasReflection(session)
      ).length,
      linkedNightCount: weekly.filter((session) => session.links.length > 0)
        .length,
      averageBedtimeConsistencyMinutes: Math.round(
        average(
          weekly
            .map((session) => session.bedtimeConsistencyMinutes)
            .filter((value): value is number => value !== null)
        )
      ),
      averageWakeConsistencyMinutes: Math.round(
        average(
          weekly
            .map((session) => session.wakeConsistencyMinutes)
            .filter((value): value is number => value !== null)
        )
      ),
      latestBedtime: latestNight?.startedAt ?? null,
      latestWakeTime: latestNight?.endedAt ?? null
    },
    latestNight: latestNight
      ? buildSleepSurfaceNight(latestNight, weeklyBaseline)
      : null,
    calendarDays: calendarWindow
      .map((session) => buildSleepCalendarDay(session))
      .reverse(),
    weeklyTrend: weekly
      .map((session) => ({
        id: session.id,
        dateKey: session.localDateKey,
        sleepHours: Number((session.asleepSeconds / 3600).toFixed(2)),
        score: session.sleepScore ?? 0,
        regularity: session.regularityScore ?? 0
      }))
      .reverse(),
    monthlyPattern: monthly
      .map((session) => ({
        id: session.id,
        dateKey: session.localDateKey,
        onsetHour: getTimeZoneParts(session.startedAt, session.sourceTimezone)
          .hour,
        wakeHour: getTimeZoneParts(session.endedAt, session.sourceTimezone)
          .hour,
        sleepHours: Number((session.asleepSeconds / 3600).toFixed(2))
      }))
      .reverse(),
    stageAverages: [...stageTotals.entries()]
      .map(([stage, totalSeconds]) => ({
        stage,
        averageSeconds: Math.round(totalSeconds / Math.max(1, monthly.length))
      }))
      .sort((left, right) => right.averageSeconds - left.averageSeconds),
    linkBreakdown: [...linkTotals.entries()]
      .map(([entityType, count]) => ({ entityType, count }))
      .sort((left, right) => right.count - left.count),
    sessions: recentDisplay
  };
}

function pickVitalMetricValue(
  metrics: Record<string, StoredVitalMetricSummary>,
  candidates: string[]
) {
  for (const key of candidates) {
    const metric = metrics[key];
    if (!metric) {
      continue;
    }
    const value = vitalMetricPrimaryValue({
      aggregation: metric.aggregation,
      latest: metric.latest ?? null,
      average: metric.average ?? null,
      total: metric.total ?? null,
      maximum: metric.maximum ?? null
    });
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function buildFitnessVitalsTrend(rows: DailySummaryRow[]) {
  const byDate = new Map<
    string,
    { restingHeartRate: number[]; vo2Max: number[] }
  >();
  for (const row of rows) {
    const metrics = safeJsonParse<Record<string, StoredVitalMetricSummary>>(
      row.metrics_json,
      {}
    );
    const bucket = byDate.get(row.date_key) ?? {
      restingHeartRate: [],
      vo2Max: []
    };
    const restingHeartRate = pickVitalMetricValue(metrics, [
      "restingHeartRate",
      "resting_heart_rate"
    ]);
    const vo2Max = pickVitalMetricValue(metrics, [
      "vo2Max",
      "vo2max",
      "vo2_max"
    ]);
    if (restingHeartRate != null) {
      bucket.restingHeartRate.push(restingHeartRate);
    }
    if (vo2Max != null) {
      bucket.vo2Max.push(vo2Max);
    }
    byDate.set(row.date_key, bucket);
  }

  return [...byDate.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .slice(-90)
    .map(([dateKey, values]) => ({
      dateKey,
      restingHeartRate:
        values.restingHeartRate.length > 0
          ? round(average(values.restingHeartRate), 1)
          : null,
      vo2Max: values.vo2Max.length > 0 ? round(average(values.vo2Max), 2) : null
    }));
}

function isoWeekKey(value: string) {
  const date = new Date(value);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateKeyFromDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function standardDeviation(values: number[]) {
  if (values.length <= 1) {
    return 0;
  }
  const mean = average(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function zoneSeconds(
  session: ReturnType<typeof mapWorkoutSession>,
  keys: readonly string[]
) {
  const zones =
    (session.analytics as { zoneDurations?: Array<{ key: string; seconds: number }> } | undefined)
      ?.zoneDurations ?? [];
  return zones
    .filter((zone) => keys.includes(zone.key))
    .reduce((sum, zone) => sum + zone.seconds, 0);
}

const TRAINING_DOMAIN_KEYS = ["low", "moderate", "high"] as const;

type TrainingDomainKey = (typeof TRAINING_DOMAIN_KEYS)[number];
type TrainingModeKey = "combat_readiness" | "aerobic_base" | "endurance_pro";
type TrainingLoadSession = ReturnType<typeof mapWorkoutSession>;
type ZoneSecondsRecord = Record<(typeof WORKOUT_ZONE_ORDER)[number], number>;
type DomainSecondsRecord = Record<TrainingDomainKey, number>;

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createZoneRecord(): ZoneSecondsRecord {
  return Object.fromEntries(
    WORKOUT_ZONE_ORDER.map((key) => [key, 0])
  ) as ZoneSecondsRecord;
}

function createDomainRecord(): DomainSecondsRecord {
  return { low: 0, moderate: 0, high: 0 };
}

function addSessionZones(target: ZoneSecondsRecord, session: TrainingLoadSession) {
  const zones =
    (session.analytics as { zoneDurations?: Array<{ key: string; seconds: number }> } | undefined)
      ?.zoneDurations ?? [];
  for (const zone of zones) {
    if (WORKOUT_ZONE_ORDER.includes(zone.key as (typeof WORKOUT_ZONE_ORDER)[number])) {
      target[zone.key as (typeof WORKOUT_ZONE_ORDER)[number]] += zone.seconds;
    }
  }
}

function zoneRecordTotal(record: ZoneSecondsRecord) {
  return WORKOUT_ZONE_ORDER.reduce((sum, key) => sum + record[key], 0);
}

function domainSecondsFromZones(zones: ZoneSecondsRecord): DomainSecondsRecord {
  return {
    low: zones.below_z1 + zones.zone_1,
    moderate: zones.zone_2 + zones.zone_3,
    high: zones.zone_4 + zones.zone_5
  };
}

function percentageRecord<T extends string>(record: Record<T, number>, total: number) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      total > 0 ? round((value as number) / total, 4) : 0
    ])
  ) as Record<T, number>;
}

function minuteRecord<T extends string>(record: Record<T, number>) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, round((value as number) / 60, 1)])
  ) as Record<T, number>;
}

function bucketConfidence(input: {
  sessionCount: number;
  averageHrCoverage: number;
  heartRateSampleCount: number;
}) {
  if (input.sessionCount <= 0 || input.heartRateSampleCount <= 0) {
    return "unavailable";
  }
  if (
    input.averageHrCoverage >= 0.8 &&
    input.heartRateSampleCount >= input.sessionCount * 100
  ) {
    return "high";
  }
  if (input.averageHrCoverage >= 0.45) {
    return "medium";
  }
  return "low";
}

function monthKey(value: string) {
  return value.slice(0, 7);
}

function monthEndDateKey(key: string) {
  const [year, month] = key.split("-").map((part) => Number(part));
  return dateKeyFromDate(new Date(Date.UTC(year, month, 0)));
}

function bucketDates(
  interval: "daily" | "weekly" | "monthly",
  session: TrainingLoadSession
) {
  if (interval === "daily") {
    const key = dayKey(session.startedAt);
    return { bucketKey: key, startDate: key, endDate: key };
  }
  if (interval === "weekly") {
    const weekKey = isoWeekKey(session.startedAt);
    const date = new Date(session.startedAt);
    const day = date.getUTCDay() || 7;
    const start = addDays(date, 1 - day);
    const end = addDays(start, 6);
    return {
      bucketKey: weekKey,
      startDate: dateKeyFromDate(start),
      endDate: dateKeyFromDate(end)
    };
  }
  const key = monthKey(session.startedAt);
  return {
    bucketKey: key,
    startDate: `${key}-01`,
    endDate: monthEndDateKey(key)
  };
}

function buildZoneTimeBuckets(
  sessions: TrainingLoadSession[],
  interval: "daily" | "weekly" | "monthly",
  limit: number
) {
  const buckets = new Map<
    string,
    {
      bucketKey: string;
      startDate: string;
      endDate: string;
      sessionCount: number;
      durationSeconds: number;
      trainingLoad: number;
      zoneSeconds: ZoneSecondsRecord;
      dayHighSeconds: Map<string, number>;
      heartRateCoverageValues: number[];
      heartRateSampleCount: number;
    }
  >();

  for (const session of sessions) {
    const dates = bucketDates(interval, session);
    const current = buckets.get(dates.bucketKey) ?? {
      ...dates,
      sessionCount: 0,
      durationSeconds: 0,
      trainingLoad: 0,
      zoneSeconds: createZoneRecord(),
      dayHighSeconds: new Map<string, number>(),
      heartRateCoverageValues: [],
      heartRateSampleCount: 0
    };
    current.sessionCount += 1;
    current.durationSeconds += session.durationSeconds;
    current.trainingLoad += workoutLoad(session);
    addSessionZones(current.zoneSeconds, session);
    const sessionDayKey = dayKey(session.startedAt);
    current.dayHighSeconds.set(
      sessionDayKey,
      (current.dayHighSeconds.get(sessionDayKey) ?? 0) +
        zoneSeconds(session, ["zone_4", "zone_5"])
    );
    current.heartRateCoverageValues.push(workoutHrCoverage(session));
    current.heartRateSampleCount += workoutHrSampleCount(session);
    buckets.set(dates.bucketKey, current);
  }

  const rows = [...buckets.values()]
    .sort((left, right) => left.bucketKey.localeCompare(right.bucketKey))
    .slice(-limit)
    .map((bucket) => {
      const hrCoveredSeconds = zoneRecordTotal(bucket.zoneSeconds);
      const domains = domainSecondsFromZones(bucket.zoneSeconds);
      const durationMinutes = bucket.durationSeconds / 60;
      const loadPerMinute =
        durationMinutes > 0 ? round(bucket.trainingLoad / durationMinutes, 2) : 0;
      const loadPerHour =
        bucket.durationSeconds > 0
          ? round(bucket.trainingLoad / (bucket.durationSeconds / 3600), 1)
          : 0;
      const averageHrCoverage = round(average(bucket.heartRateCoverageValues), 3);
      return {
        bucketKey: bucket.bucketKey,
        startDate: bucket.startDate,
        endDate: bucket.endDate,
        sessionCount: bucket.sessionCount,
        durationSeconds: Math.round(bucket.durationSeconds),
        durationMinutes: round(bucket.durationSeconds / 60, 1),
        hrCoveredSeconds: Math.round(hrCoveredSeconds),
        trainingLoad: round(bucket.trainingLoad, 1),
        loadPerHour,
        loadPerMinute,
        baselineLoadRatio: null as number | null,
        baselineIntensityRatio: null as number | null,
        zoneSeconds: Object.fromEntries(
          WORKOUT_ZONE_ORDER.map((key) => [key, Math.round(bucket.zoneSeconds[key])])
        ) as ZoneSecondsRecord,
        zoneMinutes: minuteRecord(bucket.zoneSeconds),
        zonePercentages: percentageRecord(bucket.zoneSeconds, hrCoveredSeconds),
        domainSeconds: Object.fromEntries(
          TRAINING_DOMAIN_KEYS.map((key) => [key, Math.round(domains[key])])
        ) as DomainSecondsRecord,
        domainMinutes: minuteRecord(domains),
        domainPercentages: percentageRecord(domains, hrCoveredSeconds),
        hardDayCount: [...bucket.dayHighSeconds.values()].filter(
          (seconds) => seconds >= 10 * 60
        ).length,
        averageHrCoverage,
        heartRateSampleCount: bucket.heartRateSampleCount,
        confidence: bucketConfidence({
          sessionCount: bucket.sessionCount,
          averageHrCoverage,
          heartRateSampleCount: bucket.heartRateSampleCount
        })
      };
    });

  return rows.map((row, index) => {
    const baselineWindow =
      interval === "daily"
        ? rows.slice(Math.max(0, index - 28), index)
        : interval === "weekly"
          ? rows.slice(Math.max(0, index - 4), index)
          : rows.slice(Math.max(0, index - 3), index);
    const baselineLoad = average(
      baselineWindow.map((bucket) => bucket.trainingLoad).filter((value) => value > 0)
    );
    const baselineIntensity = average(
      baselineWindow.map((bucket) => bucket.loadPerMinute).filter((value) => value > 0)
    );
    return {
      ...row,
      baselineLoadRatio:
        baselineLoad > 0 ? round(row.trainingLoad / baselineLoad, 2) : null,
      baselineIntensityRatio:
        baselineIntensity > 0 ? round(row.loadPerMinute / baselineIntensity, 2) : null
    };
  });
}

function buildZoneTimeSeries(sessions: TrainingLoadSession[]) {
  return {
    daily: buildZoneTimeBuckets(sessions, "daily", 90),
    weekly: buildZoneTimeBuckets(sessions, "weekly", 26),
    monthly: buildZoneTimeBuckets(sessions, "monthly", 12)
  };
}

function workoutLoad(session: ReturnType<typeof mapWorkoutSession>) {
  return (
    (session.analytics as { load?: { trimp?: number | null } } | undefined)?.load
      ?.trimp ?? 0
  );
}

function workoutIntensity(session: ReturnType<typeof mapWorkoutSession>) {
  return (
    (session.analytics as { load?: { intensity?: number | null } } | undefined)
      ?.load?.intensity ?? null
  );
}

function workoutHrCoverage(session: ReturnType<typeof mapWorkoutSession>) {
  return (
    (
      session.analytics as
        | { dataQuality?: { sampleCoverage?: number; heartRateSampleCount?: number } }
        | undefined
    )?.dataQuality?.sampleCoverage ?? 0
  );
}

function workoutHrSampleCount(session: ReturnType<typeof mapWorkoutSession>) {
  return (
    (
      session.analytics as
        | { dataQuality?: { sampleCoverage?: number; heartRateSampleCount?: number } }
        | undefined
    )?.dataQuality?.heartRateSampleCount ?? 0
  );
}

function workoutAverageHr(session: ReturnType<typeof mapWorkoutSession>) {
  return (
    (session.analytics as { hrSummary?: { averageHr?: number | null } } | undefined)
      ?.hrSummary?.averageHr ?? session.averageHeartRate
  );
}

function workoutMaxHr(session: ReturnType<typeof mapWorkoutSession>) {
  return (
    (session.analytics as { hrSummary?: { maxHr?: number | null } } | undefined)
      ?.hrSummary?.maxHr ?? session.maxHeartRate
  );
}

function summarizeZoneDistribution(sessions: Array<ReturnType<typeof mapWorkoutSession>>) {
  const totals = new Map<string, { label: string; seconds: number }>();
  let totalSeconds = 0;
  for (const session of sessions) {
    const zones =
      (session.analytics as
        | { zoneDurations?: Array<{ key: string; label: string; seconds: number }> }
        | undefined)?.zoneDurations ?? [];
    for (const zone of zones) {
      const current = totals.get(zone.key) ?? { label: zone.label, seconds: 0 };
      current.seconds += zone.seconds;
      totalSeconds += zone.seconds;
      totals.set(zone.key, current);
    }
  }
  return WORKOUT_ZONE_ORDER.map((key) => {
    const value = totals.get(key) ?? { label: key.replaceAll("_", " "), seconds: 0 };
    return {
      key,
      label: value.label,
      seconds: Math.round(value.seconds),
      percentage:
        totalSeconds > 0 ? Number((value.seconds / totalSeconds).toFixed(4)) : 0
    };
  });
}

function summarizeIntensityDistribution(
  sessions: Array<ReturnType<typeof mapWorkoutSession>>
) {
  const lowSeconds = sessions.reduce(
    (sum, session) => sum + zoneSeconds(session, ["below_z1", "zone_1"]),
    0
  );
  const moderateSeconds = sessions.reduce(
    (sum, session) => sum + zoneSeconds(session, ["zone_2", "zone_3"]),
    0
  );
  const highSeconds = sessions.reduce(
    (sum, session) => sum + zoneSeconds(session, ["zone_4", "zone_5"]),
    0
  );
  const totalSeconds = lowSeconds + moderateSeconds + highSeconds;
  return [
    {
      key: "low",
      label: "Low / base",
      seconds: Math.round(lowSeconds),
      percentage:
        totalSeconds > 0 ? Number((lowSeconds / totalSeconds).toFixed(4)) : 0,
      targetRange: [0.7, 0.85]
    },
    {
      key: "moderate",
      label: "Tempo / threshold",
      seconds: Math.round(moderateSeconds),
      percentage:
        totalSeconds > 0
          ? Number((moderateSeconds / totalSeconds).toFixed(4))
          : 0,
      targetRange: [0.05, 0.2]
    },
    {
      key: "high",
      label: "Severe / HIIT",
      seconds: Math.round(highSeconds),
      percentage:
        totalSeconds > 0 ? Number((highSeconds / totalSeconds).toFixed(4)) : 0,
      targetRange: [0.08, 0.18]
    }
  ];
}

function latestVitalValue(
  vitalsTrend: ReturnType<typeof buildFitnessVitalsTrend>,
  key: "restingHeartRate" | "vo2Max"
) {
  return [...vitalsTrend].reverse().find((entry) => entry[key] != null)?.[key] ?? null;
}

type TrainingLoadSummary = {
  acuteLoad7d: number;
  chronicWeeklyLoad28d: number;
  acuteChronicRatio: number | null;
  monotony7d: number | null;
  strain7d: number | null;
  highIntensityMinutes7d: number;
  thresholdMinutes7d: number;
  easyMinutes7d: number;
  hardDayCount7d: number;
  averageHeartRateCoverage: number;
  readiness: string;
};

const MODE_DOMAIN_TARGETS: Record<
  TrainingModeKey,
  {
    label: string;
    statusLabel: string;
    low: [number, number];
    moderate: [number, number];
    high: [number, number];
    maxHardSessions: number;
  }
> = {
  combat_readiness: {
    label: "Combat readiness",
    statusLabel: "fight-ready balance",
    low: [0.62, 0.78],
    moderate: [0.1, 0.22],
    high: [0.06, 0.16],
    maxHardSessions: 2
  },
  aerobic_base: {
    label: "Aerobic base",
    statusLabel: "base-building balance",
    low: [0.72, 0.9],
    moderate: [0.05, 0.18],
    high: [0.02, 0.1],
    maxHardSessions: 1
  },
  endurance_pro: {
    label: "Endurance pro",
    statusLabel: "pyramidal/polarized balance",
    low: [0.7, 0.88],
    moderate: [0.04, 0.2],
    high: [0.06, 0.18],
    maxHardSessions: 2
  }
};

function targetMidpoint(range: [number, number]) {
  return (range[0] + range[1]) / 2;
}

function rangeScore(value: number, range: [number, number]) {
  if (value >= range[0] && value <= range[1]) {
    return 100;
  }
  const distance = value < range[0] ? range[0] - value : value - range[1];
  return clampNumber(100 - distance * 350, 0, 100);
}

function loadBalanceStatus(summary: TrainingLoadSummary) {
  if (
    summary.readiness === "overload_watch" ||
    (summary.acuteChronicRatio ?? 0) > 1.35 ||
    (summary.strain7d ?? 0) > 450
  ) {
    return "recover";
  }
  if ((summary.acuteChronicRatio ?? 1) < 0.8) {
    return "build";
  }
  if (summary.highIntensityMinutes7d >= 45) {
    return "maintain";
  }
  return "sharpen";
}

function scoreStatus(score: number, balance: string) {
  if (balance === "recover") {
    return "recovery_priority";
  }
  if (score >= 82) {
    return "on_target";
  }
  if (score >= 65) {
    return "watch";
  }
  return "needs_adjustment";
}

function scoreConfidence(
  summary: TrainingLoadSummary,
  latestBucket: ReturnType<typeof buildZoneTimeBuckets>[number] | undefined
) {
  const coverage = latestBucket?.averageHrCoverage ?? summary.averageHeartRateCoverage;
  if (coverage >= 0.85 && (latestBucket?.heartRateSampleCount ?? 0) >= 300) {
    return "high";
  }
  if (coverage >= 0.5) {
    return "medium";
  }
  if (coverage > 0) {
    return "low";
  }
  return "unavailable";
}

function targetMinutes(totalMinutes: number, range: [number, number]) {
  return [Math.round(totalMinutes * range[0]), Math.round(totalMinutes * range[1])] as [
    number,
    number
  ];
}

function buildZoneMinuteTargets(
  totalMinutes: number,
  target: (typeof MODE_DOMAIN_TARGETS)[TrainingModeKey]
) {
  const low = totalMinutes * targetMidpoint(target.low);
  const moderate = totalMinutes * targetMidpoint(target.moderate);
  const high = totalMinutes * targetMidpoint(target.high);
  return {
    below_z1: Math.round(low * 0.35),
    zone_1: Math.round(low * 0.65),
    zone_2: Math.round(moderate * 0.65),
    zone_3: Math.round(moderate * 0.35),
    zone_4: Math.round(high * 0.75),
    zone_5: Math.round(high * 0.25)
  };
}

function buildTrainingIntelligence(input: {
  summary: TrainingLoadSummary;
  recentIntensityDistribution: ReturnType<typeof summarizeIntensityDistribution>;
  zoneTimeSeries: ReturnType<typeof buildZoneTimeSeries>;
}) {
  const latestWeek = input.zoneTimeSeries.weekly.at(-1);
  const priorWeeks = input.zoneTimeSeries.weekly.slice(-5, -1);
  const baselineMinutes =
    average(priorWeeks.map((week) => week.durationMinutes).filter((value) => value > 0)) ||
    latestWeek?.durationMinutes ||
    180;
  const balance = loadBalanceStatus(input.summary);
  const lowPct =
    input.recentIntensityDistribution.find((entry) => entry.key === "low")
      ?.percentage ?? 0;
  const moderatePct =
    input.recentIntensityDistribution.find((entry) => entry.key === "moderate")
      ?.percentage ?? 0;
  const highPct =
    input.recentIntensityDistribution.find((entry) => entry.key === "high")
      ?.percentage ?? 0;
  const currentLoadRatio = input.summary.acuteChronicRatio ?? 1;
  const loadBalance = {
    status: balance,
    acuteLoad7d: input.summary.acuteLoad7d,
    chronicWeeklyLoad28d: input.summary.chronicWeeklyLoad28d,
    acuteChronicRatio: input.summary.acuteChronicRatio,
    monotony7d: input.summary.monotony7d,
    strain7d: input.summary.strain7d,
    latestWeekLoad: latestWeek?.trainingLoad ?? 0,
    latestWeekLoadPerMinute: latestWeek?.loadPerMinute ?? 0,
    latestWeekBaselineLoadRatio: latestWeek?.baselineLoadRatio ?? null,
    latestWeekBaselineIntensityRatio: latestWeek?.baselineIntensityRatio ?? null
  };

  return {
    defaultMode: "combat_readiness" as const,
    modes: (Object.keys(MODE_DOMAIN_TARGETS) as TrainingModeKey[]).map((mode) => {
      const target = MODE_DOMAIN_TARGETS[mode];
      const lowScore = rangeScore(lowPct, target.low);
      const moderateScore = rangeScore(moderatePct, target.moderate);
      const highScore = rangeScore(highPct, target.high);
      const loadScore =
        balance === "recover"
          ? 45
          : clampNumber(100 - Math.abs(currentLoadRatio - 1) * 90, 0, 100);
      const hardDayScore = clampNumber(
        100 - Math.max(0, input.summary.hardDayCount7d - target.maxHardSessions) * 28,
        0,
        100
      );
      const qualityScore = clampNumber(input.summary.averageHeartRateCoverage * 100, 0, 100);
      const score = Math.round(
        lowScore * 0.22 +
          moderateScore * 0.14 +
          highScore * 0.2 +
          loadScore * 0.24 +
          hardDayScore * 0.12 +
          qualityScore * 0.08
      );
      const nextWeekScale =
        balance === "recover" ? 0.75 : balance === "build" ? 1.12 : 1;
      const nextWeekMinutes = Math.round(baselineMinutes * nextWeekScale);
      const shouldAllowFourByFour =
        balance !== "recover" &&
        highPct <= target.high[1] &&
        input.summary.hardDayCount7d < target.maxHardSessions &&
        scoreConfidence(input.summary, latestWeek) !== "low" &&
        scoreConfidence(input.summary, latestWeek) !== "unavailable";

      const drivers = [
        lowPct >= target.low[0]
          ? `Low/base work is ${Math.round(lowPct * 100)}% of recent HR-zone time.`
          : null,
        highPct <= target.high[1]
          ? `High-domain exposure is controlled at ${Math.round(highPct * 100)}%.`
          : null,
        currentLoadRatio >= 0.8 && currentLoadRatio <= 1.25
          ? `Acute load is close to chronic base at ${round(currentLoadRatio, 2)}x.`
          : null,
        latestWeek?.baselineLoadRatio != null
          ? `Latest week is ${latestWeek.baselineLoadRatio}x your recent weekly load baseline.`
          : null
      ].filter((entry): entry is string => Boolean(entry));

      const limitingFactors = [
        lowPct < target.low[0]
          ? `Low/base work is below the ${Math.round(target.low[0] * 100)}-${Math.round(
              target.low[1] * 100
            )}% target band.`
          : null,
        highPct > target.high[1]
          ? `High-domain work is above the ${Math.round(target.high[1] * 100)}% ceiling for this mode.`
          : null,
        balance === "recover"
          ? "Recent load balance points to recovery before another hard stimulus."
          : null,
        input.summary.hardDayCount7d > target.maxHardSessions
          ? `${input.summary.hardDayCount7d} hard days in 7 days exceeds this mode's target.`
          : null,
        input.summary.averageHeartRateCoverage < 0.5
          ? "Heart-rate evidence is thin, so zone decisions need caution."
          : null
      ].filter((entry): entry is string => Boolean(entry));

      return {
        key: mode,
        label: target.label,
        score,
        status: scoreStatus(score, balance),
        confidence: scoreConfidence(input.summary, latestWeek),
        summary:
          balance === "recover"
            ? `${target.label}: recover first, then rebuild the next hard stimulus.`
            : `${target.label}: ${target.statusLabel} is ${score >= 75 ? "mostly aligned" : "not yet aligned"}.`,
        drivers,
        limitingFactors,
        loadBalance,
        nextWeekTargets: {
          totalMinutesRange:
            balance === "recover"
              ? targetMinutes(baselineMinutes, [0.65, 0.85])
              : targetMinutes(nextWeekMinutes, [0.95, 1.08]),
          zoneMinuteTargets: buildZoneMinuteTargets(nextWeekMinutes, target),
          domainMinuteTargets: {
            low: targetMinutes(nextWeekMinutes, target.low),
            moderate: targetMinutes(nextWeekMinutes, target.moderate),
            high: targetMinutes(nextWeekMinutes, target.high)
          },
          maxHardSessions:
            balance === "recover" ? Math.max(0, target.maxHardSessions - 1) : target.maxHardSessions,
          minimumEasyMinutes: Math.round(nextWeekMinutes * target.low[0]),
          warning:
            balance === "recover"
              ? "Keep next week below baseline and avoid stacking hard sessions until load balance normalizes."
              : highPct > target.high[1]
                ? "Do not add another high-intensity session until the high-domain share drops."
                : null
        },
        nextWorkout: {
          recommendedType:
            balance === "recover"
              ? "recovery"
              : lowPct < target.low[0]
                ? "zone_2_base"
                : shouldAllowFourByFour
                  ? "vo2max_4x4"
                  : mode === "combat_readiness"
                    ? "technical_kickboxing"
                    : "easy_aerobic",
          intensityCeiling:
            balance === "recover"
              ? "Z1"
              : shouldAllowFourByFour
                ? "Z5 intervals with full recovery"
                : highPct > target.high[1]
                  ? "Z2"
                  : "Z3",
          durationMinutesRange:
            balance === "recover"
              ? [20, 40]
              : lowPct < target.low[0]
                ? [45, 75]
                : shouldAllowFourByFour
                  ? [32, 48]
                  : [35, 60],
          fourByFourAppropriate: shouldAllowFourByFour,
          reason: shouldAllowFourByFour
            ? "Load balance, hard-day count, high-domain share, and HR confidence can support one controlled VO2max stimulus."
            : balance === "recover"
              ? "Current load balance makes recovery more useful than another hard interval day."
              : highPct > target.high[1]
                ? "Recent high-domain exposure is already above this mode's target."
                : "A base or technical session fits the current distribution better than 4x4 work."
        },
        methodologyNotes: [
          "Scores are deterministic summaries of Forge HRR zones, TRIMP load, hard-day spacing, and evidence quality.",
          "ACWR, monotony, and strain are monitoring flags, not injury predictions.",
          "4x4 guidance is gated by freshness, recent high-intensity share, hard-day count, and HR confidence."
        ]
      };
    })
  };
}

export function getTrainingLoadViewData(userIds?: string[]) {
  const workoutRows = listWorkoutRows(userIds);
  const sessions = workoutRows
    .slice(0, 2000)
    .map((row) => mapWorkoutSession(row, { includeAnalytics: true }))
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  const now = new Date();
  const start7 = addDays(now, -6);
  const start28 = addDays(now, -27);
  const recent7 = sessions.filter((session) => Date.parse(session.startedAt) >= start7.getTime());
  const recent28 = sessions.filter((session) => Date.parse(session.startedAt) >= start28.getTime());
  const vitalsTrend = buildFitnessVitalsTrend(
    listDailySummaryRows("vitals", userIds)
  );
  const dailyMap = new Map<
    string,
    {
      dateKey: string;
      sessionCount: number;
      durationSeconds: number;
      trainingLoad: number;
      highIntensitySeconds: number;
      moderateIntensitySeconds: number;
      lowIntensitySeconds: number;
    }
  >();
  for (const session of sessions) {
    const key = dayKey(session.startedAt);
    const current = dailyMap.get(key) ?? {
      dateKey: key,
      sessionCount: 0,
      durationSeconds: 0,
      trainingLoad: 0,
      highIntensitySeconds: 0,
      moderateIntensitySeconds: 0,
      lowIntensitySeconds: 0
    };
    current.sessionCount += 1;
    current.durationSeconds += session.durationSeconds;
    current.trainingLoad += workoutLoad(session);
    current.highIntensitySeconds += zoneSeconds(session, ["zone_4", "zone_5"]);
    current.moderateIntensitySeconds += zoneSeconds(session, ["zone_2", "zone_3"]);
    current.lowIntensitySeconds += zoneSeconds(session, ["below_z1", "zone_1"]);
    dailyMap.set(key, current);
  }
  const dailyLoad = [...dailyMap.values()]
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey))
    .map((day) => ({
      ...day,
      durationMinutes: Math.round(day.durationSeconds / 60),
      trainingLoad: round(day.trainingLoad, 1),
      highIntensityMinutes: round(day.highIntensitySeconds / 60, 1),
      moderateIntensityMinutes: round(day.moderateIntensitySeconds / 60, 1),
      lowIntensityMinutes: round(day.lowIntensitySeconds / 60, 1)
    }));
  const weekMap = new Map<
    string,
    {
      weekKey: string;
      startDate: string;
      endDate: string;
      sessionCount: number;
      durationSeconds: number;
      trainingLoad: number;
      highIntensitySeconds: number;
      moderateIntensitySeconds: number;
      lowIntensitySeconds: number;
    }
  >();
  for (const session of sessions) {
    const weekKey = isoWeekKey(session.startedAt);
    const date = new Date(session.startedAt);
    const day = date.getUTCDay() || 7;
    const start = addDays(date, 1 - day);
    const end = addDays(start, 6);
    const current = weekMap.get(weekKey) ?? {
      weekKey,
      startDate: dateKeyFromDate(start),
      endDate: dateKeyFromDate(end),
      sessionCount: 0,
      durationSeconds: 0,
      trainingLoad: 0,
      highIntensitySeconds: 0,
      moderateIntensitySeconds: 0,
      lowIntensitySeconds: 0
    };
    current.sessionCount += 1;
    current.durationSeconds += session.durationSeconds;
    current.trainingLoad += workoutLoad(session);
    current.highIntensitySeconds += zoneSeconds(session, ["zone_4", "zone_5"]);
    current.moderateIntensitySeconds += zoneSeconds(session, ["zone_2", "zone_3"]);
    current.lowIntensitySeconds += zoneSeconds(session, ["below_z1", "zone_1"]);
    weekMap.set(weekKey, current);
  }
  const weeklyLoad = [...weekMap.values()]
    .sort((left, right) => left.weekKey.localeCompare(right.weekKey))
    .slice(-26)
    .map((week) => {
      const totalZoneSeconds =
        week.lowIntensitySeconds +
        week.moderateIntensitySeconds +
        week.highIntensitySeconds;
      const hours = week.durationSeconds / 3600;
      return {
        ...week,
        durationHours: round(hours, 2),
        trainingLoad: round(week.trainingLoad, 1),
        loadPerHour: hours > 0 ? round(week.trainingLoad / hours, 1) : 0,
        lowPercentage:
          totalZoneSeconds > 0 ? round(week.lowIntensitySeconds / totalZoneSeconds, 3) : 0,
        moderatePercentage:
          totalZoneSeconds > 0
            ? round(week.moderateIntensitySeconds / totalZoneSeconds, 3)
            : 0,
        highPercentage:
          totalZoneSeconds > 0 ? round(week.highIntensitySeconds / totalZoneSeconds, 3) : 0,
        highIntensityMinutes: round(week.highIntensitySeconds / 60, 1)
      };
    });
  const activityBreakdown = [...new Set(sessions.map((session) => session.workoutType))]
    .map((workoutType) => {
      const group = sessions.filter((session) => session.workoutType === workoutType);
      const durationSeconds = group.reduce((sum, session) => sum + session.durationSeconds, 0);
      const trainingLoad = group.reduce((sum, session) => sum + workoutLoad(session), 0);
      const highSeconds = group.reduce(
        (sum, session) => sum + zoneSeconds(session, ["zone_4", "zone_5"]),
        0
      );
      const totalZoneSeconds = group.reduce(
        (sum, session) =>
          sum +
          zoneSeconds(session, [
            "below_z1",
            "zone_1",
            "zone_2",
            "zone_3",
            "zone_4",
            "zone_5"
          ]),
        0
      );
      return {
        workoutType,
        workoutTypeLabel: group.at(-1)?.workoutTypeLabel ?? workoutType,
        activityFamily: group.at(-1)?.activityFamily ?? "other",
        activityFamilyLabel: group.at(-1)?.activityFamilyLabel ?? "Other",
        sessionCount: group.length,
        durationHours: round(durationSeconds / 3600, 2),
        trainingLoad: round(trainingLoad, 1),
        loadPerHour:
          durationSeconds > 0 ? round(trainingLoad / (durationSeconds / 3600), 1) : 0,
        highPercentage:
          totalZoneSeconds > 0 ? round(highSeconds / totalZoneSeconds, 3) : 0,
        averageHrCoverage: round(
          average(group.map((session) => workoutHrCoverage(session))),
          3
        )
      };
    })
    .sort((left, right) => right.trainingLoad - left.trainingLoad);
  const last7Keys = Array.from({ length: 7 }, (_, index) =>
    dateKeyFromDate(addDays(start7, index))
  );
  const last7Loads = last7Keys.map(
    (key) => dailyMap.get(key)?.trainingLoad ?? 0
  );
  const acuteLoad7d = recent7.reduce((sum, session) => sum + workoutLoad(session), 0);
  const chronicWeeklyLoad28d =
    recent28.reduce((sum, session) => sum + workoutLoad(session), 0) / 4;
  const loadSd7d = standardDeviation(last7Loads);
  const monotony7d =
    loadSd7d > 0 ? average(last7Loads) / loadSd7d : recent7.length > 0 ? null : 0;
  const strain7d = monotony7d != null ? acuteLoad7d * monotony7d : null;
  const highSeconds7d = recent7.reduce(
    (sum, session) => sum + zoneSeconds(session, ["zone_4", "zone_5"]),
    0
  );
  const moderateSeconds7d = recent7.reduce(
    (sum, session) => sum + zoneSeconds(session, ["zone_2", "zone_3"]),
    0
  );
  const lowSeconds7d = recent7.reduce(
    (sum, session) => sum + zoneSeconds(session, ["below_z1", "zone_1"]),
    0
  );
  const reliableSessions = sessions.filter(
    (session) => workoutHrSampleCount(session) >= 100 && workoutHrCoverage(session) >= 0.8
  );
  const vo2Points = vitalsTrend.filter((entry) => entry.vo2Max != null);
  const vo2MaxLatest = latestVitalValue(vitalsTrend, "vo2Max");
  const vo2MaxDelta =
    vo2Points.length >= 2
      ? round((vo2Points.at(-1)?.vo2Max ?? 0) - (vo2Points[0]?.vo2Max ?? 0), 2)
      : null;
  const acwr =
    chronicWeeklyLoad28d > 0 ? round(acuteLoad7d / chronicWeeklyLoad28d, 2) : null;
  const readiness =
    acwr == null
      ? "insufficient_data"
      : acwr > 1.5 || (strain7d ?? 0) > 450
        ? "overload_watch"
        : acwr < 0.75
          ? "underloaded"
          : "productive";
  const summary = {
    sessionCount: sessions.length,
    reliableSessionCount: reliableSessions.length,
    totalHours: round(
      sessions.reduce((sum, session) => sum + session.durationSeconds, 0) / 3600,
      1
    ),
    totalTrainingLoad: round(
      sessions.reduce((sum, session) => sum + workoutLoad(session), 0),
      1
    ),
    acuteLoad7d: round(acuteLoad7d, 1),
    chronicWeeklyLoad28d: round(chronicWeeklyLoad28d, 1),
    acuteChronicRatio: acwr,
    monotony7d: monotony7d != null ? round(monotony7d, 2) : null,
    strain7d: strain7d != null ? round(strain7d, 1) : null,
    highIntensityMinutes7d: round(highSeconds7d / 60, 1),
    thresholdMinutes7d: round(moderateSeconds7d / 60, 1),
    easyMinutes7d: round(lowSeconds7d / 60, 1),
    hardDayCount7d: last7Keys.filter(
      (key) => (dailyMap.get(key)?.highIntensitySeconds ?? 0) >= 10 * 60
    ).length,
    averageHeartRateCoverage: round(
      average(sessions.map((session) => workoutHrCoverage(session))),
      3
    ),
    vo2MaxLatest,
    vo2MaxDelta,
    latestRestingHeartRate: latestVitalValue(vitalsTrend, "restingHeartRate"),
    readiness
  };
  const recentIntensityDistribution = summarizeIntensityDistribution(recent28);
  const zoneTimeSeries = buildZoneTimeSeries(sessions);
  return {
    summary,
    zoneTotals: summarizeZoneDistribution(sessions),
    recentZoneTotals: summarizeZoneDistribution(recent28),
    intensityDistribution: summarizeIntensityDistribution(sessions),
    recentIntensityDistribution,
    dailyLoad: dailyLoad.slice(-90),
    weeklyLoad,
    zoneTimeSeries,
    trainingIntelligence: buildTrainingIntelligence({
      summary,
      recentIntensityDistribution,
      zoneTimeSeries
    }),
    activityBreakdown,
    vitalsTrend,
    sessionSignals: sessions
      .slice(-200)
      .reverse()
      .map((session) => {
        const highSeconds = zoneSeconds(session, ["zone_4", "zone_5"]);
        const totalZoneSeconds = zoneSeconds(session, WORKOUT_ZONE_ORDER);
        return {
          id: session.id,
          dateKey: dayKey(session.startedAt),
          startedAt: session.startedAt,
          workoutType: session.workoutType,
          workoutTypeLabel: session.workoutTypeLabel ?? session.workoutType,
          durationMinutes: round(session.durationSeconds / 60, 1),
          trainingLoad: round(workoutLoad(session), 1),
          intensity: workoutIntensity(session),
          averageHr: workoutAverageHr(session),
          maxHr: workoutMaxHr(session),
          highIntensityPercentage:
            totalZoneSeconds > 0 ? round(highSeconds / totalZoneSeconds, 3) : 0,
          highIntensityMinutes: round(highSeconds / 60, 1),
          heartRateCoverage: workoutHrCoverage(session),
          heartRateSampleCount: workoutHrSampleCount(session),
          confidence:
            (session.analytics as { confidence?: string } | undefined)?.confidence ??
            "unavailable",
          detailRoute: `/api/v1/health/workouts/${session.id}/detail`
        };
      }),
    targetModel: {
      model: "forge-training-load-v1",
      lowIntensityTarget: "70-85% of total endurance time",
      moderateIntensityTarget: "5-20% depending on phase and sport specificity",
      highIntensityTarget: "8-18% unless in a short peaking block",
      monitoringNotes: [
        "Use Forge TRIMP as an internal-load trend, not a medical diagnosis.",
        "Treat kickboxing and sparring as high-intensity days when Z4+Z5 is material.",
        "Prefer added easy aerobic volume when high-intensity minutes are already high.",
        "Chest-strap HR is recommended for combat sports when exact zone decisions matter."
      ]
    }
  };
}

export function getFitnessViewData(userIds?: string[]) {
  const workoutRows = listWorkoutRows(userIds);
  const recent = workoutRows
    .slice(0, 40)
    .map((row) => mapWorkoutSession(row, { includeAnalytics: true }));
  const browserSessions = workoutRows
    .slice(0, 2000)
    .map((row, index) =>
      mapWorkoutSession(row, { includeAnalytics: index < 40 })
    );
  const analysisSessions = workoutRows
    .slice(0, 500)
    .map((row) => mapWorkoutSession(row, { includeAnalytics: true }));
  const vitalsTrend = buildFitnessVitalsTrend(
    listDailySummaryRows("vitals", userIds)
  );
  const weekly = recent.filter(
    (session) =>
      Date.now() - Date.parse(session.startedAt) <= 7 * 24 * 60 * 60 * 1000
  );
  const weeklyVolumeSeconds = weekly.reduce(
    (sum, session) => sum + session.durationSeconds,
    0
  );
  const exerciseMinutes = weekly.reduce(
    (sum, session) =>
      sum + (session.exerciseMinutes ?? session.durationSeconds / 60),
    0
  );
  const energyBurned = weekly.reduce(
    (sum, session) =>
      sum + (session.totalEnergyKcal ?? session.activeEnergyKcal ?? 0),
    0
  );
  const distanceMeters = weekly.reduce(
    (sum, session) => sum + (session.distanceMeters ?? 0),
    0
  );
  const workoutTypes = Array.from(
    new Set(recent.map((session) => session.workoutType))
  );
  const workoutTypeBreakdown = new Map<
    string,
    { sessionCount: number; totalMinutes: number; energyKcal: number }
  >();
  for (const session of recent) {
    const current = workoutTypeBreakdown.get(session.workoutType) ?? {
      sessionCount: 0,
      totalMinutes: 0,
      energyKcal: 0
    };
    current.sessionCount += 1;
    current.totalMinutes += Math.round(session.durationSeconds / 60);
    current.energyKcal += Math.round(
      session.totalEnergyKcal ?? session.activeEnergyKcal ?? 0
    );
    workoutTypeBreakdown.set(session.workoutType, current);
  }
  const orderedWorkoutTypes = [...workoutTypeBreakdown.entries()].sort(
    (left, right) => right[1].totalMinutes - left[1].totalMinutes
  );
  const zoneTotals = new Map<string, { label: string; seconds: number }>();
  let totalZoneSeconds = 0;
  let heartRateCoverageSum = 0;
  let heartRateCoverageCount = 0;
  let totalTrainingLoad = 0;
  let routeWorkoutCount = 0;
  for (const session of recent) {
    const analytics = session.analytics as
      | {
          zoneDurations?: Array<{
            key: string;
            label: string;
            seconds: number;
          }>;
          dataQuality?: { sampleCoverage?: number };
          load?: { trimp?: number | null };
          routeSummary?: { hasRoute?: boolean };
        }
      | undefined;
    for (const zone of analytics?.zoneDurations ?? []) {
      const current = zoneTotals.get(zone.key) ?? {
        label: zone.label,
        seconds: 0
      };
      current.seconds += zone.seconds;
      totalZoneSeconds += zone.seconds;
      zoneTotals.set(zone.key, current);
    }
    if (typeof analytics?.dataQuality?.sampleCoverage === "number") {
      heartRateCoverageSum += analytics.dataQuality.sampleCoverage;
      heartRateCoverageCount += 1;
    }
    if (typeof analytics?.load?.trimp === "number") {
      totalTrainingLoad += analytics.load.trimp;
    }
    if (analytics?.routeSummary?.hasRoute) {
      routeWorkoutCount += 1;
    }
  }
  const zoneMix = [...zoneTotals.entries()].map(([key, value]) => ({
    key,
    label: value.label,
    seconds: Math.round(value.seconds),
    percentage:
      totalZoneSeconds > 0
        ? Number((value.seconds / totalZoneSeconds).toFixed(4))
        : 0
  }));
  return {
    summary: {
      workoutCount: weekly.length,
      weeklyVolumeSeconds,
      exerciseMinutes: Math.round(exerciseMinutes),
      energyBurnedKcal: Math.round(energyBurned),
      distanceMeters: Math.round(distanceMeters),
      workoutTypes,
      averageSessionMinutes: Math.round(
        average(recent.map((session) => session.durationSeconds / 60))
      ),
      averageEffort: round(
        average(
          recent
            .map((session) => session.subjectiveEffort)
            .filter((value): value is number => value !== null)
        ),
        1
      ),
      linkedSessionCount: recent.filter((session) => session.links.length > 0)
        .length,
      plannedSessionCount: recent.filter(
        (session) => session.plannedContext.trim().length > 0
      ).length,
      importedSessionCount: recent.filter(
        (session) => session.source === "apple_health"
      ).length,
      habitGeneratedSessionCount: recent.filter(
        (session) => session.sourceType === "habit_generated"
      ).length,
      reconciledSessionCount: recent.filter(
        (session) => session.reconciliationStatus === "merged"
      ).length,
      topWorkoutType: orderedWorkoutTypes[0]?.[0] ?? null,
      topWorkoutTypeLabel:
        recent.find(
          (session) => session.workoutType === orderedWorkoutTypes[0]?.[0]
        )?.workoutTypeLabel ?? null,
      streakDays: Array.from(
        new Set(weekly.map((session) => dayKey(session.startedAt)))
      ).length,
      averageHeartRateCoverage:
        heartRateCoverageCount > 0
          ? Number((heartRateCoverageSum / heartRateCoverageCount).toFixed(3))
          : 0,
      totalTrainingLoad: Number(totalTrainingLoad.toFixed(1)),
      routeWorkoutCount,
      zoneMix
    },
    weeklyTrend: weekly
      .map((session) => ({
        id: session.id,
        dateKey: dayKey(session.startedAt),
        workoutType: session.workoutType,
        workoutTypeLabel: session.workoutTypeLabel,
        activityFamily: session.activityFamily,
        activityFamilyLabel: session.activityFamilyLabel,
        durationMinutes: Math.round(session.durationSeconds / 60),
        energyKcal: Math.round(
          session.totalEnergyKcal ?? session.activeEnergyKcal ?? 0
        ),
        zoneDurations:
          (session.analytics as { zoneDurations?: unknown[] } | undefined)
            ?.zoneDurations ?? [],
        trainingLoad:
          (
            session.analytics as
              | { load?: { trimp?: number | null } }
              | undefined
          )?.load?.trimp ?? null,
        heartRateCoverage:
          (
            session.analytics as
              | { dataQuality?: { sampleCoverage?: number } }
              | undefined
          )?.dataQuality?.sampleCoverage ?? 0
      }))
      .reverse(),
    typeBreakdown: orderedWorkoutTypes.map(([workoutType, metrics]) => ({
      workoutType,
      workoutTypeLabel:
        recent.find((session) => session.workoutType === workoutType)
          ?.workoutTypeLabel ?? workoutType,
      activityFamily:
        recent.find((session) => session.workoutType === workoutType)
          ?.activityFamily ?? "other",
      activityFamilyLabel:
        recent.find((session) => session.workoutType === workoutType)
          ?.activityFamilyLabel ?? "Other",
      sessionCount: metrics.sessionCount,
      totalMinutes: metrics.totalMinutes,
      energyKcal: metrics.energyKcal
    })),
    vitalsTrend,
    analysisSessions,
    sessions: browserSessions
  };
}

function averageNullable(values: Array<number | null | undefined>) {
  const present = values.filter((value): value is number => value != null);
  return present.length > 0 ? average(present) : null;
}

function sumNullable(values: Array<number | null | undefined>) {
  const present = values.filter((value): value is number => value != null);
  return present.length > 0
    ? present.reduce((sum, value) => sum + value, 0)
    : null;
}

function maxNullable(values: Array<number | null | undefined>) {
  const present = values.filter((value): value is number => value != null);
  return present.length > 0 ? Math.max(...present) : null;
}

function minNullable(values: Array<number | null | undefined>) {
  const present = values.filter((value): value is number => value != null);
  return present.length > 0 ? Math.min(...present) : null;
}

function vitalMetricPrimaryValue(metric: {
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

export function getVitalsViewData(userIds?: string[]) {
  const rows = listDailySummaryRows("vitals", userIds);
  const dayCount = new Set(rows.map((row) => row.date_key)).size;
  const metricBuckets = new Map<
    string,
    {
      label: string;
      category: string;
      unit: string;
      displayUnit: string;
      aggregation: "discrete" | "cumulative";
      days: Map<string, StoredVitalMetricSummary[]>;
    }
  >();

  for (const row of rows) {
    const metrics = safeJsonParse<Record<string, StoredVitalMetricSummary>>(
      row.metrics_json,
      {}
    );
    for (const [metricKey, metric] of Object.entries(metrics)) {
      const bucket = metricBuckets.get(metricKey) ?? {
        label: metric.label,
        category: metric.category,
        unit: metric.unit,
        displayUnit: metric.displayUnit || metric.unit,
        aggregation: metric.aggregation,
        days: new Map<string, StoredVitalMetricSummary[]>()
      };
      const entries = bucket.days.get(row.date_key) ?? [];
      entries.push(metric);
      bucket.days.set(row.date_key, entries);
      metricBuckets.set(metricKey, bucket);
    }
  }

  const metrics = [...metricBuckets.entries()]
    .map(([metric, bucket]) => {
      const days = [...bucket.days.entries()]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([dateKey, entries]) => {
          const aggregated = {
            dateKey,
            average: averageNullable(entries.map((entry) => entry.average)),
            minimum: minNullable(entries.map((entry) => entry.minimum)),
            maximum: maxNullable(entries.map((entry) => entry.maximum)),
            latest: averageNullable(entries.map((entry) => entry.latest)),
            total:
              bucket.aggregation === "cumulative"
                ? sumNullable(
                    entries.map((entry) => entry.total ?? entry.latest)
                  )
                : sumNullable(entries.map((entry) => entry.total)),
            sampleCount: entries.reduce(
              (sum, entry) => sum + entry.sampleCount,
              0
            ),
            latestSampleAt:
              entries
                .map((entry) => entry.latestSampleAt)
                .filter((value): value is string => Boolean(value))
                .sort()
                .at(-1) ?? null
          };
          return aggregated;
        });
      const latestDay =
        [...days].reverse().find(
          (day) =>
            vitalMetricPrimaryValue({
              aggregation: bucket.aggregation,
              latest: day.latest,
              average: day.average,
              total: day.total,
              maximum: day.maximum
            }) !== null
        ) ?? null;
      const recentValues = days
        .map((day) =>
          vitalMetricPrimaryValue({
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
        baselineValues.length > 0
          ? average(baselineValues)
          : (recentValues.at(-2) ?? null);
      const latestValue = latestDay
        ? vitalMetricPrimaryValue({
            aggregation: bucket.aggregation,
            latest: latestDay.latest,
            average: latestDay.average,
            total: latestDay.total,
            maximum: latestDay.maximum
          })
        : null;
      return {
        metric,
        label: bucket.label,
        category: bucket.category,
        unit: bucket.displayUnit,
        aggregation: bucket.aggregation,
        latestValue:
          latestValue == null
            ? null
            : round(latestValue, bucket.aggregation === "cumulative" ? 0 : 1),
        latestDateKey: latestDay?.dateKey ?? null,
        baselineValue:
          baselineValue == null
            ? null
            : round(baselineValue, bucket.aggregation === "cumulative" ? 0 : 1),
        deltaValue:
          latestValue != null && baselineValue != null
            ? round(
                latestValue - baselineValue,
                bucket.aggregation === "cumulative" ? 0 : 1
              )
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

  return {
    summary: {
      trackedDays: dayCount,
      metricCount: metrics.length,
      latestDateKey: rows[0]?.date_key ?? null,
      latestMetricCount: metrics.filter(
        (metric) => metric.latestDateKey === (rows[0]?.date_key ?? null)
      ).length,
      categoryBreakdown
    },
    metrics
  };
}

export function createSleepSession(
  input: z.infer<typeof createSleepSessionSchema>,
  activity?: ActivityContext
) {
  const parsed = createSleepSessionSchema.parse(input);
  const userId = resolveHealthUserId(parsed.userId);
  const sourceTimezone = resolveTimeZone(parsed.sourceTimezone);
  const now = nowIso();
  const id = `sleep_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const externalUid =
    parsed.externalUid ??
    `manual_sleep_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const timeInBedSeconds =
    parsed.timeInBedSeconds ??
    durationSecondsBetween(parsed.startedAt, parsed.endedAt);
  const asleepSeconds = parsed.asleepSeconds ?? timeInBedSeconds;
  const awakeSeconds =
    parsed.awakeSeconds ?? Math.max(0, timeInBedSeconds - asleepSeconds);
  const sleepScore = computeSleepScore({
    asleepSeconds,
    timeInBedSeconds,
    awakeSeconds,
    stageBreakdown: parsed.stageBreakdown
  });
  const timingMetrics = computeSleepTimingMetrics({
    userId,
    startedAt: parsed.startedAt,
    endedAt: parsed.endedAt,
    sourceTimezone
  });
  const annotations = {
    qualitySummary: parsed.qualitySummary,
    notes: parsed.notes,
    tags: parsed.tags,
    links: parsed.links
  };
  const derived = computeSleepDerivedMetrics({
    asleepSeconds,
    timeInBedSeconds,
    awakeSeconds,
    sleepScore,
    stageBreakdown: parsed.stageBreakdown
  });

  getDatabase()
    .prepare(
      `INSERT INTO health_sleep_sessions (
         id, external_uid, pairing_session_id, user_id, source, source_type, source_device,
         source_timezone, local_date_key, started_at, ended_at, time_in_bed_seconds, asleep_seconds, awake_seconds,
         sleep_score, regularity_score, bedtime_consistency_minutes, wake_consistency_minutes,
         raw_segment_count, stage_breakdown_json, recovery_metrics_json, source_metrics_json, links_json, annotations_json,
         provenance_json, derived_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      externalUid,
      null,
      userId,
      parsed.source,
      parsed.sourceType,
      parsed.sourceDevice,
      sourceTimezone,
      parsed.localDateKey ??
        localDateKeyForTimezone(parsed.endedAt, sourceTimezone),
      parsed.startedAt,
      parsed.endedAt,
      timeInBedSeconds,
      asleepSeconds,
      awakeSeconds,
      sleepScore,
      timingMetrics.regularityScore,
      timingMetrics.bedtimeConsistencyMinutes,
      timingMetrics.wakeConsistencyMinutes,
      parsed.rawSegmentCount,
      JSON.stringify(parsed.stageBreakdown),
      JSON.stringify(parsed.recoveryMetrics),
      JSON.stringify(parsed.sourceMetrics),
      JSON.stringify(parsed.links),
      JSON.stringify(annotations),
      JSON.stringify({
        manualEntry: true,
        entryMode: "local",
        source: parsed.source,
        sourceType: parsed.sourceType,
        sourceDevice: parsed.sourceDevice,
        actor: activity?.actor ?? null,
        createdAt: now,
        ...parsed.provenance
      }),
      JSON.stringify(derived),
      now,
      now
    );

  summarizeUserHealthDay(
    userId,
    parsed.localDateKey ??
      localDateKeyForTimezone(parsed.endedAt, sourceTimezone)
  );
  recordActivityEvent({
    entityType: "sleep_session",
    entityId: id,
    eventType: "sleep_session_created",
    title: "Sleep session created",
    description: "A manual sleep session was created in Forge.",
    actor: activity?.actor ?? null,
    source: activity?.source ?? "ui",
    metadata: {
      userId,
      startedAt: parsed.startedAt,
      endedAt: parsed.endedAt
    }
  });

  return getSleepSessionById(id)!;
}

export function updateSleepSession(
  sleepId: string,
  patch: z.infer<typeof updateSleepSessionSchema>,
  activity?: ActivityContext
) {
  const parsed = updateSleepSessionSchema.parse(patch);
  const current = getDatabase()
    .prepare(`SELECT * FROM health_sleep_sessions WHERE id = ?`)
    .get(sleepId) as SleepSessionRow | undefined;
  if (!current) {
    return undefined;
  }
  const now = nowIso();
  const sourceTimezone = resolveTimeZone(
    parsed.sourceTimezone ?? current.source_timezone
  );
  const startedAt = parsed.startedAt ?? current.started_at;
  const endedAt = parsed.endedAt ?? current.ended_at;
  const timeInBedSeconds =
    parsed.timeInBedSeconds ??
    (parsed.startedAt !== undefined || parsed.endedAt !== undefined
      ? durationSecondsBetween(startedAt, endedAt)
      : current.time_in_bed_seconds);
  const asleepSeconds = parsed.asleepSeconds ?? current.asleep_seconds;
  const awakeSeconds =
    parsed.awakeSeconds ?? Math.max(0, timeInBedSeconds - asleepSeconds);
  const stageBreakdown =
    parsed.stageBreakdown ?? safeJsonParse(current.stage_breakdown_json, []);
  const recoveryMetrics =
    parsed.recoveryMetrics ?? safeJsonParse(current.recovery_metrics_json, {});
  const sourceMetrics =
    parsed.sourceMetrics ?? safeJsonParse(current.source_metrics_json, {});
  const currentAnnotations = safeJsonParse<Record<string, unknown>>(
    current.annotations_json,
    {}
  );
  const links = parsed.links ?? safeJsonParse(current.links_json, []);
  const annotations = {
    qualitySummary:
      parsed.qualitySummary ??
      (typeof currentAnnotations.qualitySummary === "string"
        ? currentAnnotations.qualitySummary
        : ""),
    notes:
      parsed.notes ??
      (typeof currentAnnotations.notes === "string"
        ? currentAnnotations.notes
        : ""),
    tags:
      parsed.tags ??
      (Array.isArray(currentAnnotations.tags)
        ? (currentAnnotations.tags as string[])
        : []),
    links
  };
  const sleepScore = computeSleepScore({
    asleepSeconds,
    timeInBedSeconds,
    awakeSeconds,
    stageBreakdown
  });
  const timingMetrics = computeSleepTimingMetrics({
    userId: current.user_id,
    startedAt,
    endedAt,
    sourceTimezone,
    excludeSleepId: current.id
  });
  const derived = computeSleepDerivedMetrics({
    asleepSeconds,
    timeInBedSeconds,
    awakeSeconds,
    sleepScore,
    stageBreakdown
  });
  const currentProvenance = safeJsonParse<Record<string, unknown>>(
    current.provenance_json,
    {}
  );

  getDatabase()
    .prepare(
      `UPDATE health_sleep_sessions
       SET external_uid = ?, source = ?, source_type = ?, source_device = ?, source_timezone = ?, local_date_key = ?,
           started_at = ?, ended_at = ?, time_in_bed_seconds = ?, asleep_seconds = ?, awake_seconds = ?,
           sleep_score = ?, regularity_score = ?, bedtime_consistency_minutes = ?, wake_consistency_minutes = ?,
           raw_segment_count = ?, stage_breakdown_json = ?, recovery_metrics_json = ?, source_metrics_json = ?, links_json = ?, annotations_json = ?,
           provenance_json = ?, derived_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      parsed.externalUid ?? current.external_uid,
      parsed.source ?? current.source,
      parsed.sourceType ?? current.source_type,
      parsed.sourceDevice ?? current.source_device,
      sourceTimezone,
      (parsed.localDateKey ?? current.local_date_key) ||
        localDateKeyForTimezone(endedAt, sourceTimezone),
      startedAt,
      endedAt,
      timeInBedSeconds,
      asleepSeconds,
      awakeSeconds,
      sleepScore,
      timingMetrics.regularityScore,
      timingMetrics.bedtimeConsistencyMinutes,
      timingMetrics.wakeConsistencyMinutes,
      parsed.rawSegmentCount ?? current.raw_segment_count,
      JSON.stringify(stageBreakdown),
      JSON.stringify(recoveryMetrics),
      JSON.stringify(sourceMetrics),
      JSON.stringify(links),
      JSON.stringify(annotations),
      JSON.stringify({
        ...currentProvenance,
        ...(parsed.provenance ?? {}),
        updatedAt: now,
        updatedByActor: activity?.actor ?? null
      }),
      JSON.stringify(derived),
      now,
      sleepId
    );

  summarizeUserHealthDay(current.user_id, sleepSessionDateKey(current));
  summarizeUserHealthDay(
    current.user_id,
    (parsed.localDateKey ?? current.local_date_key) ||
      localDateKeyForTimezone(endedAt, sourceTimezone)
  );
  recordActivityEvent({
    entityType: "sleep_session",
    entityId: sleepId,
    eventType: "sleep_session_updated",
    title: "Sleep session updated",
    description: "A sleep session was updated through Forge CRUD.",
    actor: activity?.actor ?? null,
    source: activity?.source ?? "ui",
    metadata: {
      startedAt,
      endedAt
    }
  });

  return getSleepSessionById(sleepId)!;
}

export function deleteSleepSession(
  sleepId: string,
  activity?: ActivityContext
) {
  const current = getDatabase()
    .prepare(`SELECT * FROM health_sleep_sessions WHERE id = ?`)
    .get(sleepId) as SleepSessionRow | undefined;
  if (!current) {
    return undefined;
  }
  getDatabase()
    .prepare(`DELETE FROM health_sleep_sessions WHERE id = ?`)
    .run(sleepId);
  summarizeUserHealthDay(current.user_id, dayKey(current.ended_at));
  recordActivityEvent({
    entityType: "sleep_session",
    entityId: sleepId,
    eventType: "sleep_session_deleted",
    title: "Sleep session deleted",
    description: "A sleep session was permanently removed from Forge.",
    actor: activity?.actor ?? null,
    source: activity?.source ?? "ui",
    metadata: {
      startedAt: current.started_at,
      endedAt: current.ended_at
    }
  });
  return mapSleepSession(current);
}

export function createWorkoutSession(
  input: z.infer<typeof createWorkoutSessionSchema>,
  activity?: ActivityContext
) {
  const parsed = createWorkoutSessionSchema.parse(input);
  const userId = resolveHealthUserId(parsed.userId);
  const now = nowIso();
  const id = `workout_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const externalUid =
    parsed.externalUid ??
    `manual_workout_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const durationSeconds = durationSecondsBetween(
    parsed.startedAt,
    parsed.endedAt
  );
  const annotations = {
    subjectiveEffort: parsed.subjectiveEffort ?? null,
    moodBefore: parsed.moodBefore,
    moodAfter: parsed.moodAfter,
    meaningText: parsed.meaningText,
    plannedContext: parsed.plannedContext,
    socialContext: parsed.socialContext,
    tags: parsed.tags,
    links: parsed.links
  };
  const persistenceSeed = buildWorkoutSessionPersistenceSeed({
    source: parsed.source,
    sourceType: parsed.sourceType,
    workoutType: parsed.workoutType
  });

  getDatabase()
    .prepare(
      `INSERT INTO health_workout_sessions (
         id, external_uid, pairing_session_id, user_id, source, source_type, workout_type, source_device,
         started_at, ended_at, duration_seconds, active_energy_kcal, total_energy_kcal, distance_meters,
         step_count, exercise_minutes, average_heart_rate, max_heart_rate, subjective_effort, mood_before,
         mood_after, meaning_text, planned_context, social_context, links_json, tags_json, annotations_json,
         provenance_json, derived_json, reconciliation_status, created_at, updated_at
       )
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'standalone', ?, ?)`
    )
    .run(
      id,
      externalUid,
      userId,
      parsed.source,
      parsed.sourceType,
      persistenceSeed.activity.canonicalKey,
      parsed.sourceDevice,
      parsed.startedAt,
      parsed.endedAt,
      durationSeconds,
      parsed.activeEnergyKcal ?? null,
      parsed.totalEnergyKcal ?? null,
      parsed.distanceMeters ?? null,
      parsed.stepCount ?? null,
      parsed.exerciseMinutes ?? null,
      parsed.averageHeartRate ?? null,
      parsed.maxHeartRate ?? null,
      parsed.subjectiveEffort ?? null,
      parsed.moodBefore,
      parsed.moodAfter,
      parsed.meaningText,
      parsed.plannedContext,
      parsed.socialContext,
      JSON.stringify(parsed.links),
      JSON.stringify(parsed.tags),
      JSON.stringify(annotations),
      JSON.stringify({
        manualEntry: true,
        entryMode: "local",
        source: parsed.source,
        sourceType: parsed.sourceType,
        sourceSystem: persistenceSeed.sourceSystem,
        activity: persistenceSeed.activity,
        details: persistenceSeed.details,
        sourceDevice: parsed.sourceDevice,
        actor: activity?.actor ?? null,
        createdAt: now,
        ...parsed.provenance
      }),
      JSON.stringify({
        activity: persistenceSeed.activity,
        details: persistenceSeed.details,
        paceMetersPerMinute:
          parsed.distanceMeters && parsed.exerciseMinutes
            ? Number(
                (parsed.distanceMeters / parsed.exerciseMinutes).toFixed(2)
              )
            : null
      }),
      now,
      now
    );

  summarizeUserHealthDay(userId, dayKey(parsed.startedAt));
  recordActivityEvent({
    entityType: "workout_session",
    entityId: id,
    eventType: "workout_session_created",
    title: "Workout session created",
    description: "A manual workout session was created in Forge.",
    actor: activity?.actor ?? null,
    source: activity?.source ?? "ui",
    metadata: {
      userId,
      workoutType: parsed.workoutType
    }
  });

  return getWorkoutSessionById(id)!;
}

export function updateWorkoutSession(
  workoutId: string,
  patch: z.infer<typeof updateWorkoutSessionSchema>,
  activity?: ActivityContext
) {
  const parsed = updateWorkoutSessionSchema.parse(patch);
  const current = getDatabase()
    .prepare(`SELECT * FROM health_workout_sessions WHERE id = ?`)
    .get(workoutId) as WorkoutSessionRow | undefined;
  if (!current) {
    return undefined;
  }
  const now = nowIso();
  const startedAt = parsed.startedAt ?? current.started_at;
  const endedAt = parsed.endedAt ?? current.ended_at;
  const durationSeconds =
    parsed.startedAt !== undefined || parsed.endedAt !== undefined
      ? durationSecondsBetween(startedAt, endedAt)
      : current.duration_seconds;
  const currentAnnotations = safeJsonParse<Record<string, unknown>>(
    current.annotations_json,
    {}
  );
  const tags =
    parsed.tags ?? safeJsonParse<string[]>(current.tags_json, []) ?? [];
  const links =
    parsed.links ??
    safeJsonParse<Array<z.infer<typeof healthLinkSchema>>>(
      current.links_json,
      []
    );
  const annotations = {
    subjectiveEffort:
      parsed.subjectiveEffort ??
      (typeof currentAnnotations.subjectiveEffort === "number"
        ? currentAnnotations.subjectiveEffort
        : current.subjective_effort),
    moodBefore:
      parsed.moodBefore ??
      (typeof currentAnnotations.moodBefore === "string"
        ? currentAnnotations.moodBefore
        : current.mood_before),
    moodAfter:
      parsed.moodAfter ??
      (typeof currentAnnotations.moodAfter === "string"
        ? currentAnnotations.moodAfter
        : current.mood_after),
    meaningText:
      parsed.meaningText ??
      (typeof currentAnnotations.meaningText === "string"
        ? currentAnnotations.meaningText
        : current.meaning_text),
    plannedContext:
      parsed.plannedContext ??
      (typeof currentAnnotations.plannedContext === "string"
        ? currentAnnotations.plannedContext
        : current.planned_context),
    socialContext:
      parsed.socialContext ??
      (typeof currentAnnotations.socialContext === "string"
        ? currentAnnotations.socialContext
        : current.social_context),
    tags,
    links
  };
  const currentProvenance = safeJsonParse<Record<string, unknown>>(
    current.provenance_json,
    {}
  );
  const currentDerived = safeJsonParse<Record<string, unknown>>(
    current.derived_json,
    {}
  );
  const nextExerciseMinutes =
    parsed.exerciseMinutes ?? current.exercise_minutes;
  const nextDistanceMeters = parsed.distanceMeters ?? current.distance_meters;
  const persistenceSeed = buildWorkoutSessionPersistenceSeed({
    source: parsed.source ?? current.source,
    sourceType: parsed.sourceType ?? current.source_type,
    workoutType: parsed.workoutType ?? current.workout_type,
    sourceSystem:
      typeof currentProvenance.sourceSystem === "string"
        ? currentProvenance.sourceSystem
        : null,
    sourceBundleIdentifier:
      typeof currentProvenance.sourceBundleIdentifier === "string"
        ? currentProvenance.sourceBundleIdentifier
        : null,
    sourceProductType:
      typeof currentProvenance.sourceProductType === "string"
        ? currentProvenance.sourceProductType
        : null,
    activity: currentDerived.activity ?? currentProvenance.activity,
    details: currentDerived.details ?? currentProvenance.details
  });

  getDatabase()
    .prepare(
      `UPDATE health_workout_sessions
       SET external_uid = ?, source = ?, source_type = ?, workout_type = ?, source_device = ?,
           started_at = ?, ended_at = ?, duration_seconds = ?, active_energy_kcal = ?, total_energy_kcal = ?,
           distance_meters = ?, step_count = ?, exercise_minutes = ?, average_heart_rate = ?, max_heart_rate = ?,
           subjective_effort = ?, mood_before = ?, mood_after = ?, meaning_text = ?, planned_context = ?,
           social_context = ?, links_json = ?, tags_json = ?, annotations_json = ?, provenance_json = ?,
           derived_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      parsed.externalUid ?? current.external_uid,
      parsed.source ?? current.source,
      parsed.sourceType ?? current.source_type,
      persistenceSeed.activity.canonicalKey,
      parsed.sourceDevice ?? current.source_device,
      startedAt,
      endedAt,
      durationSeconds,
      parsed.activeEnergyKcal ?? current.active_energy_kcal,
      parsed.totalEnergyKcal ?? current.total_energy_kcal,
      nextDistanceMeters,
      parsed.stepCount ?? current.step_count,
      nextExerciseMinutes,
      parsed.averageHeartRate ?? current.average_heart_rate,
      parsed.maxHeartRate ?? current.max_heart_rate,
      annotations.subjectiveEffort,
      annotations.moodBefore,
      annotations.moodAfter,
      annotations.meaningText,
      annotations.plannedContext,
      annotations.socialContext,
      JSON.stringify(links),
      JSON.stringify(tags),
      JSON.stringify(annotations),
      JSON.stringify({
        ...currentProvenance,
        ...(parsed.provenance ?? {}),
        sourceSystem: persistenceSeed.sourceSystem,
        sourceBundleIdentifier: persistenceSeed.sourceBundleIdentifier,
        sourceProductType: persistenceSeed.sourceProductType,
        activity: persistenceSeed.activity,
        details: persistenceSeed.details,
        updatedAt: now,
        updatedByActor: activity?.actor ?? null
      }),
      JSON.stringify({
        ...currentDerived,
        activity: persistenceSeed.activity,
        details: persistenceSeed.details,
        paceMetersPerMinute:
          nextDistanceMeters && nextExerciseMinutes
            ? Number((nextDistanceMeters / nextExerciseMinutes).toFixed(2))
            : null
      }),
      now,
      workoutId
    );

  summarizeUserHealthDay(current.user_id, dayKey(current.started_at));
  summarizeUserHealthDay(current.user_id, dayKey(startedAt));
  recordActivityEvent({
    entityType: "workout_session",
    entityId: workoutId,
    eventType: "workout_session_updated",
    title: "Workout session updated",
    description: "A workout session was updated through Forge CRUD.",
    actor: activity?.actor ?? null,
    source: activity?.source ?? "ui",
    metadata: {
      workoutType: parsed.workoutType ?? current.workout_type
    }
  });

  return getWorkoutSessionById(workoutId)!;
}

export function deleteWorkoutSession(
  workoutId: string,
  activity?: ActivityContext
) {
  const current = getDatabase()
    .prepare(`SELECT * FROM health_workout_sessions WHERE id = ?`)
    .get(workoutId) as WorkoutSessionRow | undefined;
  if (!current) {
    return undefined;
  }
  const deletedWorkout = mapWorkoutSession(current);
  getDatabase()
    .prepare(`DELETE FROM health_workout_sessions WHERE id = ?`)
    .run(workoutId);
  summarizeUserHealthDay(current.user_id, dayKey(current.started_at));
  recordActivityEvent({
    entityType: "workout_session",
    entityId: workoutId,
    eventType: "workout_session_deleted",
    title: "Workout session deleted",
    description: "A workout session was permanently removed from Forge.",
    actor: activity?.actor ?? null,
    source: activity?.source ?? "ui",
    metadata: {
      workoutType: current.workout_type,
      startedAt: current.started_at
    }
  });
  return deletedWorkout;
}

export function updateWorkoutMetadata(
  workoutId: string,
  patch: z.infer<typeof updateWorkoutMetadataSchema>,
  activity?: ActivityContext
) {
  const parsed = updateWorkoutMetadataSchema.parse(patch);
  const current = getDatabase()
    .prepare(`SELECT * FROM health_workout_sessions WHERE id = ?`)
    .get(workoutId) as WorkoutSessionRow | undefined;
  if (!current) {
    return undefined;
  }
  const nextLinks = parsed.links ?? safeJsonParse(current.links_json, []);
  const nextTags = parsed.tags ?? safeJsonParse(current.tags_json, []);
  const nextAnnotations = {
    ...safeJsonParse<Record<string, unknown>>(current.annotations_json, {}),
    ...(parsed.subjectiveEffort !== undefined
      ? { subjectiveEffort: parsed.subjectiveEffort }
      : {}),
    ...(parsed.moodBefore !== undefined
      ? { moodBefore: parsed.moodBefore }
      : {}),
    ...(parsed.moodAfter !== undefined ? { moodAfter: parsed.moodAfter } : {}),
    ...(parsed.meaningText !== undefined
      ? { meaningText: parsed.meaningText }
      : {}),
    ...(parsed.plannedContext !== undefined
      ? { plannedContext: parsed.plannedContext }
      : {}),
    ...(parsed.socialContext !== undefined
      ? { socialContext: parsed.socialContext }
      : {}),
    ...(parsed.tags !== undefined ? { tags: parsed.tags } : {}),
    ...(parsed.links !== undefined ? { links: parsed.links } : {})
  };
  const now = nowIso();
  getDatabase()
    .prepare(
      `UPDATE health_workout_sessions
       SET subjective_effort = ?, mood_before = ?, mood_after = ?, meaning_text = ?, planned_context = ?,
           social_context = ?, links_json = ?, tags_json = ?, annotations_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      parsed.subjectiveEffort ?? current.subjective_effort,
      parsed.moodBefore ?? current.mood_before,
      parsed.moodAfter ?? current.mood_after,
      parsed.meaningText ?? current.meaning_text,
      parsed.plannedContext ?? current.planned_context,
      parsed.socialContext ?? current.social_context,
      JSON.stringify(nextLinks),
      JSON.stringify(nextTags),
      JSON.stringify(nextAnnotations),
      now,
      workoutId
    );
  recordActivityEvent({
    entityType: "system",
    entityId: workoutId,
    eventType: "workout_metadata_updated",
    title: "Workout metadata updated",
    description:
      "Forge metadata, tags, or linked context was updated for a workout session.",
    actor: activity?.actor ?? null,
    source: activity?.source ?? "ui",
    metadata: {
      hasLinks: nextLinks.length > 0,
      tagCount: nextTags.length
    }
  });
  return mapWorkoutSession(
    getDatabase()
      .prepare(`SELECT * FROM health_workout_sessions WHERE id = ?`)
      .get(workoutId) as WorkoutSessionRow
  );
}

export function updateSleepMetadata(
  sleepId: string,
  patch: z.infer<typeof updateSleepMetadataSchema>,
  activity?: ActivityContext
) {
  const parsed = updateSleepMetadataSchema.parse(patch);
  const current = getDatabase()
    .prepare(`SELECT * FROM health_sleep_sessions WHERE id = ?`)
    .get(sleepId) as SleepSessionRow | undefined;
  if (!current) {
    return undefined;
  }
  const nextAnnotations = {
    ...safeJsonParse<Record<string, unknown>>(current.annotations_json, {}),
    ...(parsed.qualitySummary !== undefined
      ? { qualitySummary: parsed.qualitySummary }
      : {}),
    ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
    ...(parsed.tags !== undefined ? { tags: parsed.tags } : {}),
    ...(parsed.links !== undefined ? { links: parsed.links } : {})
  };
  const nextLinks = parsed.links ?? safeJsonParse(current.links_json, []);
  const now = nowIso();
  getDatabase()
    .prepare(
      `UPDATE health_sleep_sessions
       SET links_json = ?, annotations_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      JSON.stringify(nextLinks),
      JSON.stringify(nextAnnotations),
      now,
      sleepId
    );
  recordActivityEvent({
    entityType: "system",
    entityId: sleepId,
    eventType: "sleep_metadata_updated",
    title: "Sleep reflection updated",
    description:
      "Forge links or reflective notes were updated for a sleep session.",
    actor: activity?.actor ?? null,
    source: activity?.source ?? "ui",
    metadata: {
      hasLinks: nextLinks.length > 0
    }
  });
  return mapSleepSession(
    getDatabase()
      .prepare(`SELECT * FROM health_sleep_sessions WHERE id = ?`)
      .get(sleepId) as SleepSessionRow
  );
}

export function createGeneratedWorkoutFromHabit(args: {
  habitId: string;
  checkInId: string;
  habitTitle: string;
  userId: string;
  dateKey: string;
  template: z.infer<typeof generatedHealthEventTemplateSchema>;
  linkedEntities?: Array<z.infer<typeof healthLinkSchema>>;
}) {
  const template = generatedHealthEventTemplateSchema.parse(args.template);
  if (!template.enabled) {
    return null;
  }
  const startedAt = new Date(`${args.dateKey}T07:00:00.000Z`).toISOString();
  const endedAt = new Date(
    Date.parse(startedAt) + template.durationMinutes * 60_000
  ).toISOString();
  const existing = getDatabase()
    .prepare(
      `SELECT *
       FROM health_workout_sessions
       WHERE generated_from_check_in_id = ?`
    )
    .get(args.checkInId) as WorkoutSessionRow | undefined;
  if (existing) {
    return mapWorkoutSession(existing);
  }
  const now = nowIso();
  const id = `workout_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const persistenceSeed = buildWorkoutSessionPersistenceSeed({
    source: "forge_habit",
    sourceType: "habit_generated",
    workoutType: template.workoutType
  });
  getDatabase()
    .prepare(
      `INSERT INTO health_workout_sessions (
         id, external_uid, pairing_session_id, user_id, source, source_type, workout_type, source_device,
         started_at, ended_at, duration_seconds, links_json, tags_json, annotations_json, provenance_json,
         derived_json, generated_from_habit_id, generated_from_check_in_id, reconciliation_status, created_at, updated_at
       )
       VALUES (?, ?, NULL, ?, 'forge_habit', 'habit_generated', ?, 'Habit automation', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_import_match', ?, ?)`
    )
    .run(
      id,
      `habit_${args.checkInId}`,
      args.userId,
      persistenceSeed.activity.canonicalKey,
      startedAt,
      endedAt,
      template.durationMinutes * 60,
      JSON.stringify([
        ...(template.links ?? []),
        ...(args.linkedEntities ?? [])
      ]),
      JSON.stringify(template.tags),
      JSON.stringify({
        meaningText: template.notesTemplate,
        plannedContext: args.habitTitle
      }),
      JSON.stringify({
        generatedFrom: "habit_completion",
        habitId: args.habitId,
        checkInId: args.checkInId,
        sourceSystem: persistenceSeed.sourceSystem,
        activity: persistenceSeed.activity,
        details: persistenceSeed.details
      }),
      JSON.stringify({
        activity: persistenceSeed.activity,
        details: persistenceSeed.details,
        xpReward: template.xpReward
      }),
      args.habitId,
      args.checkInId,
      now,
      now
    );
  recordActivityEvent({
    entityType: "habit",
    entityId: args.habitId,
    eventType: "habit_generated_workout",
    title: `Habit generated workout: ${args.habitTitle}`,
    description:
      "Completing this habit generated a structured workout record inside Forge.",
    actor: "Forge",
    source: "system",
    metadata: {
      workoutId: id,
      workoutType: template.workoutType,
      xpReward: template.xpReward
    }
  });
  recordHabitGeneratedWorkoutReward(
    {
      habitId: args.habitId,
      habitTitle: args.habitTitle,
      checkInId: args.checkInId,
      workoutId: id,
      workoutType: template.workoutType,
      xpReward: template.xpReward
    },
    {
      actor: "Forge",
      source: "system"
    }
  );
  return mapWorkoutSession(
    getDatabase()
      .prepare(`SELECT * FROM health_workout_sessions WHERE id = ?`)
      .get(id) as WorkoutSessionRow
  );
}

export function parseGeneratedHealthEventTemplate(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return generatedHealthEventTemplateSchema.parse({});
    }
    try {
      return generatedHealthEventTemplateSchema.parse(
        JSON.parse(trimmed) as unknown
      );
    } catch {
      return generatedHealthEventTemplateSchema.parse({});
    }
  }
  return generatedHealthEventTemplateSchema.parse(value ?? {});
}
