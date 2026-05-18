import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase } from "./db.js";

export const WORKOUT_ZONE_ORDER = [
  "below_z1",
  "zone_1",
  "zone_2",
  "zone_3",
  "zone_4",
  "zone_5"
] as const;

export type WorkoutZoneKey = (typeof WORKOUT_ZONE_ORDER)[number];

const zoneLabels: Record<WorkoutZoneKey, string> = {
  below_z1: "Below Z1",
  zone_1: "Zone 1",
  zone_2: "Zone 2",
  zone_3: "Zone 3",
  zone_4: "Zone 4",
  zone_5: "Zone 5"
};

const zoneHrrBounds: Record<WorkoutZoneKey, [number, number]> = {
  below_z1: [0, 0.5],
  zone_1: [0.5, 0.6],
  zone_2: [0.6, 0.7],
  zone_3: [0.7, 0.8],
  zone_4: [0.8, 0.9],
  zone_5: [0.9, 1.2]
};

const scalarJsonSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()])
);

const customZoneSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  lowerBpm: z.number().nonnegative(),
  upperBpm: z.number().nonnegative().nullable()
});

export const healthZoneProfilePatchSchema = z.object({
  birthYear: z.number().int().min(1900).max(new Date().getFullYear()).nullable().optional(),
  sexAtBirth: z.string().trim().max(40).nullable().optional(),
  knownMaxHr: z.number().min(80).max(240).nullable().optional(),
  thresholdHr: z.number().min(80).max(240).nullable().optional(),
  restingHrOverride: z.number().min(30).max(120).nullable().optional(),
  customZones: z.array(customZoneSchema).optional(),
  metadata: scalarJsonSchema.optional()
});

export const workoutTimeSeriesSampleSchema = z.object({
  sourceSampleUid: z.string().trim().min(1),
  seriesIndex: z.number().int().nonnegative().default(0),
  metricKey: z.string().trim().min(1),
  label: z.string().trim().default(""),
  category: z.string().trim().default(""),
  unit: z.string().trim().default(""),
  value: z.number(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  sourceDevice: z.string().trim().default(""),
  sourceBundleIdentifier: z.string().trim().nullable().optional(),
  sourceProductType: z.string().trim().nullable().optional(),
  captureMethod: z.string().trim().default("associated_workout"),
  qualityFlags: z.array(z.string().trim()).default([]),
  metadata: scalarJsonSchema.default({}),
  provenance: scalarJsonSchema.default({})
});

export const workoutRoutePointSchema = z.object({
  sourceRouteUid: z.string().trim().min(1),
  pointIndex: z.number().int().nonnegative(),
  recordedAt: z.string().datetime(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitudeMeters: z.number().nullable().optional(),
  horizontalAccuracyMeters: z.number().nullable().optional(),
  verticalAccuracyMeters: z.number().nullable().optional(),
  speedMps: z.number().nullable().optional(),
  courseDegrees: z.number().nullable().optional(),
  metadata: scalarJsonSchema.default({}),
  provenance: scalarJsonSchema.default({})
});

export const workoutCaptureQualitySchema = z.object({
  status: z
    .enum([
      "complete",
      "partial",
      "fallback_time_window_used",
      "no_heart_rate",
      "route_unavailable",
      "series_expansion_failed",
      "permission_missing",
      "locked_device_deferred"
    ])
    .default("partial"),
  flags: z.array(z.string().trim()).default([]),
  heartRateSamples: z.number().int().nonnegative().default(0),
  routePoints: z.number().int().nonnegative().default(0),
  associatedSampleQueryUsed: z.boolean().default(false),
  fallbackTimeWindowUsed: z.boolean().default(false),
  condensedSeriesExpanded: z.boolean().default(false)
});

type WorkoutLike = {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  average_heart_rate: number | null;
  max_heart_rate: number | null;
};

type TimeSeriesRow = {
  id: string;
  workout_id: string;
  user_id: string;
  source_sample_uid: string;
  series_index: number;
  metric_key: string;
  label: string;
  category: string;
  unit: string;
  value: number;
  started_at: string;
  ended_at: string;
  source_device: string;
  source_bundle_identifier: string | null;
  source_product_type: string | null;
  capture_method: string;
  quality_flags_json: string;
  metadata_json: string;
  provenance_json: string;
  created_at: string;
  updated_at: string;
};

type RoutePointRow = {
  id: string;
  workout_id: string;
  user_id: string;
  source_route_uid: string;
  point_index: number;
  recorded_at: string;
  latitude: number;
  longitude: number;
  altitude_meters: number | null;
  horizontal_accuracy_meters: number | null;
  vertical_accuracy_meters: number | null;
  speed_mps: number | null;
  course_degrees: number | null;
  metadata_json: string;
  provenance_json: string;
  created_at: string;
  updated_at: string;
};

type ZoneProfileRow = {
  id: string;
  user_id: string;
  model_version: string;
  birth_year: number | null;
  sex_at_birth: string | null;
  known_max_hr: number | null;
  threshold_hr: number | null;
  resting_hr_override: number | null;
  custom_zones_json: string;
  inferred_max_hr: number | null;
  inferred_resting_hr: number | null;
  confidence: string;
  thresholds_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function dayKey(value: string) {
  return value.slice(0, 10);
}

function getLatestVitalMetric(userId: string, metricKey: string, beforeDateKey: string) {
  const rows = getDatabase()
    .prepare(
      `SELECT metrics_json
       FROM health_daily_summaries
       WHERE user_id = ?
         AND summary_type = 'vitals'
         AND date_key <= ?
       ORDER BY date_key DESC`
    )
    .all(userId, beforeDateKey) as Array<{ metrics_json: string }>;
  for (const row of rows) {
    const metrics = parseJson<Record<string, { latest?: number; average?: number }>>(
      row.metrics_json,
      {}
    );
    const metric = metrics[metricKey];
    const value = metric?.latest ?? metric?.average;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function getObservedMaxHr(userId: string) {
  const sampleMax = getDatabase()
    .prepare(
      `SELECT MAX(value) AS value
       FROM health_workout_time_series
       WHERE user_id = ? AND metric_key = 'heart_rate'`
    )
    .get(userId) as { value: number | null } | undefined;
  const workoutMax = getDatabase()
    .prepare(
      `SELECT MAX(max_heart_rate) AS value
       FROM health_workout_sessions
       WHERE user_id = ?`
    )
    .get(userId) as { value: number | null } | undefined;
  return Math.max(sampleMax?.value ?? 0, workoutMax?.value ?? 0) || null;
}

function ageEstimatedMaxHr(profile: ZoneProfileRow | null) {
  if (!profile?.birth_year) {
    return null;
  }
  const age = new Date().getFullYear() - profile.birth_year;
  if (age < 10 || age > 100) {
    return null;
  }
  return 208 - 0.7 * age;
}

function resolveZoneProfile(userId: string, workoutStartedAt: string) {
  const db = getDatabase();
  const now = nowIso();
  let profile = db
    .prepare(
      `SELECT *
       FROM health_zone_profiles
       WHERE user_id = ? AND model_version = 'forge-hrr-v1'`
    )
    .get(userId) as ZoneProfileRow | undefined;
  if (!profile) {
    const profileId = id("hzp");
    db.prepare(
      `INSERT INTO health_zone_profiles (
         id, user_id, model_version, created_at, updated_at
       ) VALUES (?, ?, 'forge-hrr-v1', ?, ?)`
    ).run(profileId, userId, now, now);
    profile = db
      .prepare(`SELECT * FROM health_zone_profiles WHERE id = ?`)
      .get(profileId) as ZoneProfileRow;
  }

  const restingHr =
    profile.resting_hr_override ??
    getLatestVitalMetric(userId, "restingHeartRate", dayKey(workoutStartedAt)) ??
    60;
  const observedMax = getObservedMaxHr(userId);
  const ageMax = ageEstimatedMaxHr(profile);
  const maxHr = profile.known_max_hr ?? observedMax ?? ageMax ?? 190;
  const customZones = parseJson<z.infer<typeof customZoneSchema>[]>(
    profile.custom_zones_json,
    []
  );
  const thresholds =
    customZones.length > 0
      ? customZones.map((zone) => ({
          key: zone.key,
          label: zone.label,
          lowerBpm: zone.lowerBpm,
          upperBpm: zone.upperBpm
        }))
      : WORKOUT_ZONE_ORDER.map((zone) => {
          const [lower, upper] = zoneHrrBounds[zone];
          const reserve = maxHr - restingHr;
          return {
            key: zone,
            label: zoneLabels[zone],
            lowerBpm: Math.round(restingHr + lower * reserve),
            upperBpm:
              zone === "zone_5" ? null : Math.round(restingHr + upper * reserve)
          };
        });
  const confidence =
    profile.known_max_hr && restingHr
      ? "high"
      : observedMax && restingHr
        ? "medium"
        : "low";

  db.prepare(
    `UPDATE health_zone_profiles
     SET inferred_max_hr = ?, inferred_resting_hr = ?, confidence = ?,
         thresholds_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(maxHr, restingHr, confidence, JSON.stringify(thresholds), now, profile.id);

  return {
    ...profile,
    inferred_max_hr: maxHr,
    inferred_resting_hr: restingHr,
    confidence,
    thresholds_json: JSON.stringify(thresholds)
  };
}

function zoneForHr(hr: number, thresholds: Array<{ key: string; lowerBpm: number; upperBpm: number | null }>) {
  const match = thresholds.find((zone) => {
    return hr >= zone.lowerBpm && (zone.upperBpm == null || hr < zone.upperBpm);
  });
  return (match?.key ?? "zone_5") as WorkoutZoneKey;
}

function initializeZoneDurations(thresholds: Array<{ key: string; label: string }>) {
  return thresholds.map((zone) => ({
    key: zone.key,
    label: zone.label,
    seconds: 0,
    percentage: 0
  }));
}

function computeRouteSummary(points: RoutePointRow[]) {
  if (points.length === 0) {
    return {
      hasRoute: false,
      pointCount: 0,
      bounds: null,
      start: null,
      end: null
    };
  }
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  return {
    hasRoute: true,
    pointCount: points.length,
    bounds: {
      minLatitude: Math.min(...latitudes),
      maxLatitude: Math.max(...latitudes),
      minLongitude: Math.min(...longitudes),
      maxLongitude: Math.max(...longitudes)
    },
    start: {
      latitude: points[0]!.latitude,
      longitude: points[0]!.longitude,
      recordedAt: points[0]!.recorded_at
    },
    end: {
      latitude: points[points.length - 1]!.latitude,
      longitude: points[points.length - 1]!.longitude,
      recordedAt: points[points.length - 1]!.recorded_at
    }
  };
}

function computeAnalytics(workout: WorkoutLike, samples: TimeSeriesRow[], routes: RoutePointRow[]) {
  const profile = resolveZoneProfile(workout.user_id, workout.started_at);
  const thresholds = parseJson<Array<{ key: string; label: string; lowerBpm: number; upperBpm: number | null }>>(
    profile.thresholds_json,
    []
  );
  const zoneDurations = initializeZoneDurations(thresholds);
  const hrSamples = samples
    .filter((sample) => sample.metric_key === "heart_rate")
    .sort((left, right) => Date.parse(left.started_at) - Date.parse(right.started_at));
  const workoutStart = Date.parse(workout.started_at);
  const workoutEnd = Date.parse(workout.ended_at);
  const durationSeconds = Math.max(0, (workoutEnd - workoutStart) / 1000);
  let coveredSeconds = 0;
  let weightedHr = 0;
  let minHr = Number.POSITIVE_INFINITY;
  let maxHr = 0;

  if (hrSamples.length > 0 && thresholds.length > 0) {
    for (let index = 0; index < hrSamples.length; index += 1) {
      const sample = hrSamples[index]!;
      const sampleStart = Math.max(Date.parse(sample.started_at), workoutStart);
      const explicitEnd = Math.max(Date.parse(sample.ended_at), sampleStart);
      const nextStart =
        index < hrSamples.length - 1
          ? Date.parse(hrSamples[index + 1]!.started_at)
          : workoutEnd;
      const sampleEnd = Math.min(
        workoutEnd,
        explicitEnd > sampleStart ? explicitEnd : nextStart
      );
      const seconds = Math.max(0, (sampleEnd - sampleStart) / 1000);
      if (seconds <= 0 || sample.value < 30 || sample.value > 240) {
        continue;
      }
      const zoneKey = zoneForHr(sample.value, thresholds);
      const bucket = zoneDurations.find((zone) => zone.key === zoneKey);
      if (bucket) {
        bucket.seconds += seconds;
      }
      coveredSeconds += seconds;
      weightedHr += sample.value * seconds;
      minHr = Math.min(minHr, sample.value);
      maxHr = Math.max(maxHr, sample.value);
    }
  } else if (workout.average_heart_rate && thresholds.length > 0) {
    const zoneKey = zoneForHr(workout.average_heart_rate, thresholds);
    const bucket = zoneDurations.find((zone) => zone.key === zoneKey);
    if (bucket) {
      bucket.seconds = durationSeconds;
    }
    coveredSeconds = durationSeconds;
    weightedHr = workout.average_heart_rate * durationSeconds;
    minHr = workout.average_heart_rate;
    maxHr = workout.max_heart_rate ?? workout.average_heart_rate;
  }

  for (const zone of zoneDurations) {
    zone.seconds = Math.round(zone.seconds);
    zone.percentage = coveredSeconds > 0 ? Number((zone.seconds / coveredSeconds).toFixed(4)) : 0;
  }

  const averageHr = coveredSeconds > 0 ? weightedHr / coveredSeconds : workout.average_heart_rate;
  const restingHr = profile.inferred_resting_hr ?? 60;
  const reserve = Math.max(1, (profile.inferred_max_hr ?? 190) - restingHr);
  const intensity =
    averageHr != null ? Math.max(0, Math.min(1.3, (averageHr - restingHr) / reserve)) : null;
  const trimp =
    intensity != null
      ? Number((durationSeconds / 60 * intensity * 1.67).toFixed(1))
      : null;
  const sampleCoverage =
    durationSeconds > 0 ? Math.min(1, coveredSeconds / durationSeconds) : 0;
  const confidence =
    hrSamples.length >= 5 && sampleCoverage >= 0.6
      ? profile.confidence === "high"
        ? "high"
        : "medium"
      : workout.average_heart_rate
        ? "low"
        : "unavailable";
  const qualityFlags = [
    ...(hrSamples.length === 0 ? ["summary_hr_only"] : []),
    ...(sampleCoverage < 0.6 ? ["low_hr_sample_coverage"] : []),
    ...(routes.length === 0 ? ["no_route_points"] : [])
  ];

  return {
    zoneProfileId: profile.id,
    confidence,
    dataQuality: {
      heartRateSampleCount: hrSamples.length,
      sampleCoverage,
      qualityFlags
    },
    zoneDurations,
    hrSummary: {
      averageHr: averageHr != null ? Number(averageHr.toFixed(1)) : null,
      minHr: Number.isFinite(minHr) ? Number(minHr.toFixed(1)) : null,
      maxHr: maxHr > 0 ? Number(maxHr.toFixed(1)) : workout.max_heart_rate,
      restingHr,
      maxHrForZones: profile.inferred_max_hr,
      thresholds
    },
    load: {
      trimp,
      intensity,
      durationSeconds
    },
    routeSummary: computeRouteSummary(routes)
  };
}

export function upsertWorkoutTimeSeries(input: {
  workoutId: string;
  userId: string;
  samples: Array<z.infer<typeof workoutTimeSeriesSampleSchema>>;
}) {
  const db = getDatabase();
  const now = nowIso();
  const stmt = db.prepare(
    `INSERT INTO health_workout_time_series (
       id, workout_id, user_id, source_sample_uid, series_index, metric_key,
       label, category, unit, value, started_at, ended_at, source_device,
       source_bundle_identifier, source_product_type, capture_method,
       quality_flags_json, metadata_json, provenance_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workout_id, metric_key, source_sample_uid, series_index)
     DO UPDATE SET value = excluded.value, started_at = excluded.started_at,
       ended_at = excluded.ended_at, source_device = excluded.source_device,
       capture_method = excluded.capture_method,
       quality_flags_json = excluded.quality_flags_json,
       metadata_json = excluded.metadata_json,
       provenance_json = excluded.provenance_json,
       updated_at = excluded.updated_at`
  );
  for (const sample of input.samples) {
    stmt.run(
      id("hwts"),
      input.workoutId,
      input.userId,
      sample.sourceSampleUid,
      sample.seriesIndex,
      sample.metricKey,
      sample.label,
      sample.category,
      sample.unit,
      sample.value,
      sample.startedAt,
      sample.endedAt,
      sample.sourceDevice,
      sample.sourceBundleIdentifier ?? null,
      sample.sourceProductType ?? null,
      sample.captureMethod,
      JSON.stringify(sample.qualityFlags),
      JSON.stringify(sample.metadata),
      JSON.stringify(sample.provenance),
      now,
      now
    );
  }
}

export function upsertWorkoutRoutePoints(input: {
  workoutId: string;
  userId: string;
  points: Array<z.infer<typeof workoutRoutePointSchema>>;
}) {
  const db = getDatabase();
  const now = nowIso();
  const stmt = db.prepare(
    `INSERT INTO health_workout_routes (
       id, workout_id, user_id, source_route_uid, point_index, recorded_at,
       latitude, longitude, altitude_meters, horizontal_accuracy_meters,
       vertical_accuracy_meters, speed_mps, course_degrees, metadata_json,
       provenance_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workout_id, source_route_uid, point_index)
     DO UPDATE SET recorded_at = excluded.recorded_at,
       latitude = excluded.latitude, longitude = excluded.longitude,
       altitude_meters = excluded.altitude_meters,
       horizontal_accuracy_meters = excluded.horizontal_accuracy_meters,
       vertical_accuracy_meters = excluded.vertical_accuracy_meters,
       speed_mps = excluded.speed_mps, course_degrees = excluded.course_degrees,
       metadata_json = excluded.metadata_json, provenance_json = excluded.provenance_json,
       updated_at = excluded.updated_at`
  );
  for (const point of input.points) {
    stmt.run(
      id("hwrt"),
      input.workoutId,
      input.userId,
      point.sourceRouteUid,
      point.pointIndex,
      point.recordedAt,
      point.latitude,
      point.longitude,
      point.altitudeMeters ?? null,
      point.horizontalAccuracyMeters ?? null,
      point.verticalAccuracyMeters ?? null,
      point.speedMps ?? null,
      point.courseDegrees ?? null,
      JSON.stringify(point.metadata),
      JSON.stringify(point.provenance),
      now,
      now
    );
  }
}

export function recomputeAndStoreWorkoutAnalytics(workout: WorkoutLike) {
  const db = getDatabase();
  const samples = db
    .prepare(
      `SELECT *
       FROM health_workout_time_series
       WHERE workout_id = ?
       ORDER BY started_at ASC, series_index ASC`
    )
    .all(workout.id) as TimeSeriesRow[];
  const routes = db
    .prepare(
      `SELECT *
       FROM health_workout_routes
       WHERE workout_id = ?
       ORDER BY point_index ASC`
    )
    .all(workout.id) as RoutePointRow[];
  const analytics = computeAnalytics(workout, samples, routes);
  const now = nowIso();
  db.prepare(
    `INSERT INTO health_workout_analytics (
       id, workout_id, user_id, zone_profile_id, model_version, confidence,
       data_quality_json, zone_durations_json, hr_summary_json, load_json,
       route_summary_json, computed_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, 'forge-hrr-v1', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workout_id, model_version)
     DO UPDATE SET zone_profile_id = excluded.zone_profile_id,
       confidence = excluded.confidence, data_quality_json = excluded.data_quality_json,
       zone_durations_json = excluded.zone_durations_json,
       hr_summary_json = excluded.hr_summary_json, load_json = excluded.load_json,
       route_summary_json = excluded.route_summary_json, computed_at = excluded.computed_at,
       updated_at = excluded.updated_at`
  ).run(
    id("hwa"),
    workout.id,
    workout.user_id,
    analytics.zoneProfileId,
    analytics.confidence,
    JSON.stringify(analytics.dataQuality),
    JSON.stringify(analytics.zoneDurations),
    JSON.stringify(analytics.hrSummary),
    JSON.stringify(analytics.load),
    JSON.stringify(analytics.routeSummary),
    now,
    now,
    now
  );
  return analytics;
}

export function getStoredWorkoutAnalytics(workout: WorkoutLike) {
  const existing = getDatabase()
    .prepare(
      `SELECT *
       FROM health_workout_analytics
       WHERE workout_id = ? AND model_version = 'forge-hrr-v1'`
    )
    .get(workout.id) as
    | {
        zone_profile_id: string | null;
        confidence: string;
        data_quality_json: string;
        zone_durations_json: string;
        hr_summary_json: string;
        load_json: string;
        route_summary_json: string;
        computed_at: string;
      }
    | undefined;
  if (!existing) {
    return recomputeAndStoreWorkoutAnalytics(workout);
  }
  return {
    zoneProfileId: existing.zone_profile_id,
    confidence: existing.confidence,
    dataQuality: parseJson(existing.data_quality_json, {}),
    zoneDurations: parseJson(existing.zone_durations_json, []),
    hrSummary: parseJson(existing.hr_summary_json, {}),
    load: parseJson(existing.load_json, {}),
    routeSummary: parseJson(existing.route_summary_json, {}),
    computedAt: existing.computed_at
  };
}

export function getWorkoutRawEvidence(workout: WorkoutLike, resolution: "adaptive" | "raw" = "adaptive") {
  const db = getDatabase();
  const samples = db
    .prepare(
      `SELECT *
       FROM health_workout_time_series
       WHERE workout_id = ?
       ORDER BY started_at ASC, series_index ASC`
    )
    .all(workout.id) as TimeSeriesRow[];
  const routeLimit = resolution === "raw" ? 20000 : 1200;
  const routePoints = db
    .prepare(
      `SELECT *
       FROM health_workout_routes
       WHERE workout_id = ?
       ORDER BY point_index ASC
       LIMIT ?`
    )
    .all(workout.id, routeLimit) as RoutePointRow[];
  return {
    timeSeries: downsampleSamples(samples, resolution === "raw" ? 50000 : 1500).map(mapSample),
    routePoints: downsampleRoute(routePoints, resolution === "raw" ? 20000 : 1200).map(mapRoutePoint)
  };
}

function downsampleSamples(samples: TimeSeriesRow[], limit: number) {
  if (samples.length <= limit) {
    return samples;
  }
  const stride = Math.ceil(samples.length / limit);
  return samples.filter((_, index) => index % stride === 0);
}

function downsampleRoute(points: RoutePointRow[], limit: number) {
  if (points.length <= limit) {
    return points;
  }
  const stride = Math.ceil(points.length / limit);
  return points.filter((_, index) => index % stride === 0);
}

function mapSample(row: TimeSeriesRow) {
  return {
    id: row.id,
    sourceSampleUid: row.source_sample_uid,
    seriesIndex: row.series_index,
    metricKey: row.metric_key,
    label: row.label,
    category: row.category,
    unit: row.unit,
    value: row.value,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    sourceDevice: row.source_device,
    sourceBundleIdentifier: row.source_bundle_identifier,
    sourceProductType: row.source_product_type,
    captureMethod: row.capture_method,
    qualityFlags: parseJson<string[]>(row.quality_flags_json, []),
    metadata: parseJson(row.metadata_json, {}),
    provenance: parseJson(row.provenance_json, {})
  };
}

function mapRoutePoint(row: RoutePointRow) {
  return {
    id: row.id,
    sourceRouteUid: row.source_route_uid,
    pointIndex: row.point_index,
    recordedAt: row.recorded_at,
    latitude: row.latitude,
    longitude: row.longitude,
    altitudeMeters: row.altitude_meters,
    horizontalAccuracyMeters: row.horizontal_accuracy_meters,
    verticalAccuracyMeters: row.vertical_accuracy_meters,
    speedMps: row.speed_mps,
    courseDegrees: row.course_degrees,
    metadata: parseJson(row.metadata_json, {}),
    provenance: parseJson(row.provenance_json, {})
  };
}

export function getHealthZoneProfile(userId: string) {
  const profile = resolveZoneProfile(userId, new Date().toISOString());
  return {
    id: profile.id,
    userId: profile.user_id,
    modelVersion: profile.model_version,
    birthYear: profile.birth_year,
    sexAtBirth: profile.sex_at_birth,
    knownMaxHr: profile.known_max_hr,
    thresholdHr: profile.threshold_hr,
    restingHrOverride: profile.resting_hr_override,
    customZones: parseJson(profile.custom_zones_json, []),
    inferredMaxHr: profile.inferred_max_hr,
    inferredRestingHr: profile.inferred_resting_hr,
    confidence: profile.confidence,
    thresholds: parseJson(profile.thresholds_json, []),
    metadata: parseJson(profile.metadata_json, {}),
    createdAt: profile.created_at,
    updatedAt: profile.updated_at
  };
}

export function patchHealthZoneProfile(
  userId: string,
  patch: z.infer<typeof healthZoneProfilePatchSchema>
) {
  const parsed = healthZoneProfilePatchSchema.parse(patch);
  const current = resolveZoneProfile(userId, new Date().toISOString());
  const now = nowIso();
  getDatabase()
    .prepare(
      `UPDATE health_zone_profiles
       SET birth_year = ?, sex_at_birth = ?, known_max_hr = ?, threshold_hr = ?,
           resting_hr_override = ?, custom_zones_json = ?, metadata_json = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      parsed.birthYear === undefined ? current.birth_year : parsed.birthYear,
      parsed.sexAtBirth === undefined ? current.sex_at_birth : parsed.sexAtBirth,
      parsed.knownMaxHr === undefined ? current.known_max_hr : parsed.knownMaxHr,
      parsed.thresholdHr === undefined ? current.threshold_hr : parsed.thresholdHr,
      parsed.restingHrOverride === undefined
        ? current.resting_hr_override
        : parsed.restingHrOverride,
      JSON.stringify(
        parsed.customZones === undefined
          ? parseJson(current.custom_zones_json, [])
          : parsed.customZones
      ),
      JSON.stringify(
        parsed.metadata === undefined
          ? parseJson(current.metadata_json, {})
          : parsed.metadata
      ),
      now,
      current.id
    );
  const workouts = getDatabase()
    .prepare(`SELECT * FROM health_workout_sessions WHERE user_id = ?`)
    .all(userId) as WorkoutLike[];
  for (const workout of workouts) {
    recomputeAndStoreWorkoutAnalytics(workout);
  }
  return getHealthZoneProfile(userId);
}
