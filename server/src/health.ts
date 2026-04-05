import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase, runInTransaction } from "./db.js";
import { HttpError } from "./errors.js";
import { recordActivityEvent } from "./repositories/activity-events.js";
import { recordHabitGeneratedWorkoutReward } from "./repositories/rewards.js";

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
  durationMinutes: z.number().int().positive().max(24 * 60).default(45),
  xpReward: z.number().int().min(0).max(500).default(0),
  tags: z.array(z.string().trim()).default([]),
  links: z.array(healthLinkSchema).default([]),
  notesTemplate: z.string().trim().default("")
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

export const createCompanionPairingSessionSchema = z.object({
  label: z.string().trim().default("Forge Companion"),
  userId: z.string().trim().nullable().optional(),
  expiresInMinutes: z.coerce.number().int().min(5).max(24 * 60).default(30),
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
    locationReady: z.boolean().default(false)
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
        links: z.array(healthLinkSchema).default([]),
        annotations: workoutAnnotationSchema.partial().default({})
      })
    )
    .default([])
});

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

type SleepSessionRow = {
  id: string;
  external_uid: string;
  pairing_session_id: string | null;
  user_id: string;
  source: string;
  source_type: string;
  source_device: string;
  started_at: string;
  ended_at: string;
  time_in_bed_seconds: number;
  asleep_seconds: number;
  awake_seconds: number;
  sleep_score: number | null;
  regularity_score: number | null;
  bedtime_consistency_minutes: number | null;
  wake_consistency_minutes: number | null;
  stage_breakdown_json: string;
  recovery_metrics_json: string;
  links_json: string;
  annotations_json: string;
  provenance_json: string;
  derived_json: string;
  created_at: string;
  updated_at: string;
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

function sleepMinutesOfDay(value: string, mode: "bedtime" | "wake") {
  const date = new Date(value);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
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
    input.asleepSeconds > 0
      ? Math.max(0, 8 - input.asleepSeconds / 3600)
      : 8;

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
  excludeSleepId?: string;
}) {
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
      regularityScore: computeRegularityScore(input.startedAt)
    };
  }

  const bedtimeReference = average(
    rows.map((row) => sleepMinutesOfDay(row.started_at, "bedtime"))
  );
  const wakeReference = average(
    rows.map((row) => sleepMinutesOfDay(row.ended_at, "wake"))
  );
  const bedtimeConsistencyMinutes = Math.round(
    Math.abs(sleepMinutesOfDay(input.startedAt, "bedtime") - bedtimeReference)
  );
  const wakeConsistencyMinutes = Math.round(
    Math.abs(sleepMinutesOfDay(input.endedAt, "wake") - wakeReference)
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

function computeRegularityScore(startedAt: string) {
  const date = new Date(startedAt);
  const bedtimeMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
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
    startedAt: row.started_at,
    endedAt: row.ended_at,
    timeInBedSeconds: row.time_in_bed_seconds,
    asleepSeconds: row.asleep_seconds,
    awakeSeconds: row.awake_seconds,
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

function mapWorkoutSession(row: WorkoutSessionRow) {
  return {
    id: row.id,
    externalUid: row.external_uid,
    pairingSessionId: row.pairing_session_id,
    userId: row.user_id,
    source: row.source,
    sourceType: row.source_type,
    workoutType: row.workout_type,
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
    provenance: safeJsonParse(row.provenance_json, {}),
    derived: safeJsonParse(row.derived_json, {}),
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
  const now = nowIso();
  getDatabase()
    .prepare(
      `UPDATE companion_pairing_sessions
       SET status = 'revoked', last_sync_error = ?, updated_at = ?
       WHERE id = ?`
    )
    .run("Revoked by operator", now, pairingSessionId);
  recordActivityEvent({
    entityType: "system",
    entityId: pairingSessionId,
    eventType: "companion_pairing_revoked",
    title: "Companion pairing revoked",
    description:
      "An operator revoked a Forge Companion pairing session and blocked further syncs for that device.",
    actor: activity?.actor ?? null,
    source: activity?.source ?? "ui",
    metadata: {
      label: current.label,
      deviceName: current.device_name,
      platform: current.platform
    }
  });
  return mapPairingSession(
    getDatabase()
      .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
      .get(pairingSessionId) as PairingSessionRow
  );
}

export function createCompanionPairingSession(
  baseApiUrl: string,
  input: z.infer<typeof createCompanionPairingSessionSchema>
) {
  const parsed = createCompanionPairingSessionSchema.parse(input);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + parsed.expiresInMinutes * 60_000
  ).toISOString();
  const id = `pair_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const pairingToken = randomUUID().replaceAll("-", "");
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
      parsed.userId ?? "user_operator",
      parsed.label,
      pairingToken,
      JSON.stringify(parsed.capabilities),
      baseApiUrl,
      expiresAt,
      now.toISOString(),
      now.toISOString()
    );

  const qrPayload = {
    kind: "forge-companion-pairing",
    apiBaseUrl: baseApiUrl,
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
           last_seen_at = ?, paired_at = COALESCE(paired_at, ?), updated_at = ?
       WHERE id = ?`
    )
    .run(
      nextStatus,
      parsed.device.name,
      parsed.device.platform,
      parsed.device.appVersion,
      now,
      now,
      now,
      pairing.id
    );

  return {
    pairingSession: mapPairingSession(
      getDatabase()
        .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ?`)
        .get(pairing.id) as PairingSessionRow
    )
  };
}

function requireValidPairing(sessionId: string, pairingToken: string) {
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

function summarizeUserHealthDay(userId: string, dateKeyValue: string) {
  const sleeps = listSleepRows([userId]).filter(
    (row) => dayKey(row.ended_at) === dateKeyValue || dayKey(row.started_at) === dateKeyValue
  );
  const workouts = listWorkoutRows([userId]).filter(
    (row) => dayKey(row.started_at) === dateKeyValue
  );
  const totalSleepSeconds = sleeps.reduce((sum, row) => sum + row.asleep_seconds, 0);
  const totalWorkoutSeconds = workouts.reduce((sum, row) => sum + row.duration_seconds, 0);
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
  input: z.infer<typeof mobileHealthSyncSchema>["sleepSessions"][number]
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
         SET pairing_session_id = ?, source_device = ?, started_at = ?, ended_at = ?, time_in_bed_seconds = ?,
             asleep_seconds = ?, awake_seconds = ?, sleep_score = ?, regularity_score = ?,
             bedtime_consistency_minutes = ?, wake_consistency_minutes = ?, stage_breakdown_json = ?, recovery_metrics_json = ?, links_json = ?, annotations_json = ?,
             provenance_json = ?, derived_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        pairing.id,
        pairing.device_name ?? "",
        input.startedAt,
        input.endedAt,
        input.timeInBedSeconds,
        input.asleepSeconds,
        input.awakeSeconds,
        sleepScore,
        timingMetrics.regularityScore,
        timingMetrics.bedtimeConsistencyMinutes,
        timingMetrics.wakeConsistencyMinutes,
        JSON.stringify(stageBreakdown),
        JSON.stringify(input.recoveryMetrics),
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
         started_at, ended_at, time_in_bed_seconds, asleep_seconds, awake_seconds,
         sleep_score, regularity_score, bedtime_consistency_minutes, wake_consistency_minutes,
         stage_breakdown_json, recovery_metrics_json, links_json, annotations_json,
         provenance_json, derived_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, 'apple_health', 'healthkit', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.externalUid,
      pairing.id,
      pairing.user_id,
      pairing.device_name ?? "",
      input.startedAt,
      input.endedAt,
      input.timeInBedSeconds,
      input.asleepSeconds,
      input.awakeSeconds,
      sleepScore,
      timingMetrics.regularityScore,
      timingMetrics.bedtimeConsistencyMinutes,
      timingMetrics.wakeConsistencyMinutes,
      JSON.stringify(stageBreakdown),
      JSON.stringify(input.recoveryMetrics),
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
  const matchedGenerated =
    existing ??
    findMatchingGeneratedWorkout({
      userId: pairing.user_id,
      workoutType: input.workoutType,
      startedAt: input.startedAt,
      endedAt: input.endedAt
    });

  if (matchedGenerated) {
    const existingLinks = safeJsonParse<Array<z.infer<typeof healthLinkSchema>>>(
      matchedGenerated.links_json,
      []
    );
    const existingTags = safeJsonParse<string[]>(matchedGenerated.tags_json, []);
    const existingAnnotations = safeJsonParse<Record<string, unknown>>(
      matchedGenerated.annotations_json,
      {}
    );
    const mergedLinks = mergeHealthLinks(
      existingLinks,
      input.links,
      annotations.links
    );
    const mergedTags = mergeStringLists(existingTags, annotations.tags);
    const nextSubjectiveEffort =
      matchedGenerated.subjective_effort ?? annotations.subjectiveEffort ?? null;
    const nextMoodBefore = matchedGenerated.mood_before || annotations.moodBefore;
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
        Math.max(0, Math.round((Date.parse(input.endedAt) - Date.parse(input.startedAt)) / 1000)),
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
          importedVia: "ios_companion",
          pairingSessionId: pairing.id,
          mergedWithGenerated:
            matchedGenerated.generated_from_habit_id !== null,
          priorSource: matchedGenerated.source,
          updatedAt: now
        }),
        JSON.stringify({
          paceMetersPerMinute:
            input.distanceMeters && input.exerciseMinutes
              ? Number((input.distanceMeters / input.exerciseMinutes).toFixed(2))
              : null
        }),
        matchedGenerated.generated_from_habit_id ? "merged" : "standalone",
        now,
        matchedGenerated.id
      );
    return {
      mode:
        matchedGenerated.generated_from_habit_id || matchedGenerated.source !== "apple_health"
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
      input.workoutType,
      input.sourceDevice,
      input.startedAt,
      input.endedAt,
      Math.max(0, Math.round((Date.parse(input.endedAt) - Date.parse(input.startedAt)) / 1000)),
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
        createdAt: now
      }),
      JSON.stringify({
        paceMetersPerMinute:
          input.distanceMeters && input.exerciseMinutes
            ? Number((input.distanceMeters / input.exerciseMinutes).toFixed(2))
            : null
      }),
      now,
      now
    );
  return { mode: "created" as const, id };
}

export function ingestMobileHealthSync(
  payload: z.infer<typeof mobileHealthSyncSchema>
) {
  const parsed = mobileHealthSyncSchema.parse(payload);
  const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
  return runInTransaction(() => {
    const now = nowIso();
    const runId = `hir_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    let createdCount = 0;
    let updatedCount = 0;
    let mergedCount = 0;

    for (const sleep of parsed.sleepSessions) {
      const result = insertOrUpdateSleepSession(pairing, sleep);
      if (result.mode === "created") {
        createdCount += 1;
      } else {
        updatedCount += 1;
      }
      summarizeUserHealthDay(pairing.user_id, dayKey(sleep.endedAt));
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
        `INSERT INTO health_import_runs (
           id, pairing_session_id, user_id, source, source_device, status, payload_summary_json,
           imported_count, created_count, updated_count, merged_count, imported_at, created_at, updated_at
         )
         VALUES (?, ?, ?, 'ios_companion', ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        runId,
        pairing.id,
        pairing.user_id,
        parsed.device.sourceDevice,
        JSON.stringify({
          permissions: parsed.permissions,
          sleepSessions: parsed.sleepSessions.length,
          workouts: parsed.workouts.length
        }),
        parsed.sleepSessions.length + parsed.workouts.length,
        createdCount,
        updatedCount,
        mergedCount,
        now,
        now,
        now
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
        workouts: parsed.workouts.length,
        createdCount,
        updatedCount,
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
        workouts: parsed.workouts.length,
        createdCount,
        updatedCount,
        mergedCount
      }
    };
  });
}

export function getCompanionOverview(userIds?: string[]) {
  const pairings = listPairingSessions(userIds);
  const importRuns = listHealthImportRunRows(userIds).map(mapHealthImportRun);
  const sleepSessions = listSleepRows(userIds).map(mapSleepSession);
  const workouts = listWorkoutRows(userIds).map(mapWorkoutSession);
  const activePairings = pairings.filter((pairing) => pairing.status !== "revoked");
  const recentPermissionStates = importRuns
    .map((run) => safeJsonParse<Record<string, unknown>>(JSON.stringify(run.payloadSummary), {}))
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
      workouts: workouts.length,
      reflectiveSleepSessions: sleepSessions.filter((session) => {
        const annotations = session.annotations as Record<string, unknown>;
        const tags = Array.isArray(annotations.tags) ? annotations.tags : [];
        return (
          session.links.length > 0 ||
          (typeof annotations.qualitySummary === "string" &&
            annotations.qualitySummary.length > 0) ||
          (typeof annotations.notes === "string" && annotations.notes.length > 0) ||
          tags.length > 0
        );
      }).length,
      linkedWorkouts: workouts.filter((session) => session.links.length > 0).length,
      habitGeneratedWorkouts: workouts.filter(
        (session) => session.sourceType === "habit_generated"
      ).length,
      reconciledWorkouts: workouts.filter(
        (session) => session.reconciliationStatus === "merged"
      ).length
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
      )
    }
  };
}

export function getSleepViewData(userIds?: string[]) {
  const sessions = listSleepRows(userIds).map(mapSleepSession);
  const recent = sessions.slice(0, 30);
  const weekly = recent.slice(0, 7);
  const monthly = recent.slice(0, 30);
  const stageTotals = new Map<string, number>();
  const linkTotals = new Map<string, number>();

  for (const session of monthly) {
    for (const stage of session.stageBreakdown) {
      stageTotals.set(stage.stage, (stageTotals.get(stage.stage) ?? 0) + stage.seconds);
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
        average(
          weekly.map((session) =>
            typeof (session.derived as Record<string, unknown>)
              .restorativeShare === "number"
              ? ((session.derived as Record<string, unknown>)
                  .restorativeShare as number)
              : 0
          )
        ),
        2
      ),
      reflectiveNightCount: weekly.filter((session) => {
        const annotations = session.annotations as Record<string, unknown>;
        const tags = Array.isArray(annotations.tags) ? annotations.tags : [];
        return (
          session.links.length > 0 ||
          (typeof annotations.qualitySummary === "string" &&
            annotations.qualitySummary.length > 0) ||
          (typeof annotations.notes === "string" && annotations.notes.length > 0) ||
          tags.length > 0
        );
      }).length,
      linkedNightCount: weekly.filter((session) => session.links.length > 0).length,
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
      latestBedtime: recent[0]?.startedAt ?? null,
      latestWakeTime: recent[0]?.endedAt ?? null
    },
    weeklyTrend: weekly
      .map((session) => ({
        id: session.id,
        dateKey: dayKey(session.endedAt),
        sleepHours: Number((session.asleepSeconds / 3600).toFixed(2)),
        score: session.sleepScore ?? 0,
        regularity: session.regularityScore ?? 0
      }))
      .reverse(),
    monthlyPattern: monthly
      .map((session) => ({
        id: session.id,
        dateKey: dayKey(session.endedAt),
        onsetHour: new Date(session.startedAt).getHours(),
        wakeHour: new Date(session.endedAt).getHours(),
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
    sessions: recent
  };
}

export function getFitnessViewData(userIds?: string[]) {
  const workouts = listWorkoutRows(userIds).map(mapWorkoutSession);
  const recent = workouts.slice(0, 40);
  const weekly = recent.filter(
    (session) =>
      Date.now() - Date.parse(session.startedAt) <= 7 * 24 * 60 * 60 * 1000
  );
  const weeklyVolumeSeconds = weekly.reduce(
    (sum, session) => sum + session.durationSeconds,
    0
  );
  const exerciseMinutes = weekly.reduce(
    (sum, session) => sum + (session.exerciseMinutes ?? session.durationSeconds / 60),
    0
  );
  const energyBurned = weekly.reduce(
    (sum, session) => sum + (session.totalEnergyKcal ?? session.activeEnergyKcal ?? 0),
    0
  );
  const distanceMeters = weekly.reduce(
    (sum, session) => sum + (session.distanceMeters ?? 0),
    0
  );
  const workoutTypes = Array.from(new Set(recent.map((session) => session.workoutType)));
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
      linkedSessionCount: recent.filter((session) => session.links.length > 0).length,
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
      streakDays: Array.from(
        new Set(weekly.map((session) => dayKey(session.startedAt)))
      ).length
    },
    weeklyTrend: weekly
      .map((session) => ({
        id: session.id,
        dateKey: dayKey(session.startedAt),
        workoutType: session.workoutType,
        durationMinutes: Math.round(session.durationSeconds / 60),
        energyKcal: Math.round(
          session.totalEnergyKcal ?? session.activeEnergyKcal ?? 0
        )
      }))
      .reverse(),
    typeBreakdown: orderedWorkoutTypes.map(([workoutType, metrics]) => ({
      workoutType,
      sessionCount: metrics.sessionCount,
      totalMinutes: metrics.totalMinutes,
      energyKcal: metrics.energyKcal
    })),
    sessions: recent
  };
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
    ...(parsed.moodBefore !== undefined ? { moodBefore: parsed.moodBefore } : {}),
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
    .run(JSON.stringify(nextLinks), JSON.stringify(nextAnnotations), now, sleepId);
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
      template.workoutType,
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
        checkInId: args.checkInId
      }),
      JSON.stringify({
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
