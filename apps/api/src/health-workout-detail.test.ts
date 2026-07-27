import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase, runInTransaction } from "./db.js";
import { createWorkoutSession, getWorkoutSessionDetailById } from "./health.js";

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

test("adaptive workout detail bounds dense evidence while preserving route and timeline endpoints", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-workout-detail-scale-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const workout = createWorkoutSession({
      userId: "user_operator",
      workoutType: "walking",
      startedAt: "2026-06-01T08:00:00.000Z",
      endedAt: "2026-06-01T12:00:00.000Z",
      source: "apple_health",
      sourceType: "healthkit_sync",
      sourceDevice: "Apple Watch",
      moodBefore: "",
      moodAfter: "",
      meaningText: "",
      plannedContext: "",
      socialContext: "",
      tags: [],
      links: [],
      provenance: {}
    });
    const db = getDatabase();
    const insertSample = db.prepare(
      `INSERT INTO health_workout_time_series (
         id, workout_id, user_id, source_sample_uid, series_index, metric_key,
         label, category, unit, value, started_at, ended_at, source_device,
         capture_method, quality_flags_json, metadata_json, provenance_json,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'heart_rate', 'Heart rate', 'heart', 'bpm', ?, ?, ?,
                 'Apple Watch', 'associated_workout', '[]', '{}', '{}', ?, ?)`
    );
    const insertRoutePoint = db.prepare(
      `INSERT INTO health_workout_routes (
         id, workout_id, user_id, source_route_uid, point_index, recorded_at,
         latitude, longitude, metadata_json, provenance_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'route-scale', ?, ?, ?, ?, '{}', '{}', ?, ?)`
    );
    const now = "2026-06-01T12:01:00.000Z";
    const evidenceCount = 5_001;
    runInTransaction(() => {
      for (let index = 0; index < evidenceCount; index += 1) {
        const recordedAt = new Date(
          Date.parse("2026-06-01T08:00:00.000Z") + index * 2_000
        ).toISOString();
        insertSample.run(
          `sample-${index}`,
          workout.id,
          "user_operator",
          `sample-uid-${index}`,
          index,
          110 + (index % 70),
          recordedAt,
          recordedAt,
          now,
          now
        );
        insertRoutePoint.run(
          `route-${index}`,
          workout.id,
          "user_operator",
          index,
          recordedAt,
          46.45 + index / 1_000_000,
          6.09 + index / 1_000_000,
          now,
          now
        );
      }
    });

    const adaptive = getWorkoutSessionDetailById(workout.id, "adaptive");
    assert.ok(adaptive);
    assert.equal(adaptive.evidence.timeSeries.length, 1_500);
    assert.equal(adaptive.evidence.routePoints.length, 1_200);
    assert.equal(adaptive.evidence.timeSeries[0]?.seriesIndex, 0);
    assert.equal(adaptive.evidence.timeSeries.at(-1)?.seriesIndex, 5_000);
    assert.equal(adaptive.evidence.routePoints[0]?.pointIndex, 0);
    assert.equal(adaptive.evidence.routePoints.at(-1)?.pointIndex, 5_000);
    assert.deepEqual(adaptive.evidence.summary, {
      resolution: "adaptive",
      timeSeries: {
        totalCount: evidenceCount,
        returnedCount: 1_500,
        truncated: true,
        metricCounts: { heart_rate: evidenceCount }
      },
      routePoints: {
        totalCount: evidenceCount,
        returnedCount: 1_200,
        truncated: true
      }
    });

    const raw = getWorkoutSessionDetailById(workout.id, "raw");
    assert.ok(raw);
    assert.equal(raw.evidence.timeSeries.length, evidenceCount);
    assert.equal(raw.evidence.routePoints.length, evidenceCount);
    assert.equal(raw.evidence.summary.timeSeries.truncated, false);
    assert.equal(raw.evidence.summary.routePoints.truncated, false);
    assert.equal(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM health_workout_time_series WHERE workout_id = ?`
          )
          .get(workout.id) as { count: number }
      ).count,
      evidenceCount
    );
    assert.equal(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM health_workout_routes WHERE workout_id = ?`
          )
          .get(workout.id) as { count: number }
      ).count,
      evidenceCount
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("sports list and workout detail reads enforce managed-token user scope", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-workout-detail-scope-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const operatorWorkout = createWorkoutSession({
      userId: "user_operator",
      workoutType: "running",
      startedAt: "2026-06-02T08:00:00.000Z",
      endedAt: "2026-06-02T08:30:00.000Z",
      source: "manual",
      sourceType: "manual",
      sourceDevice: "Forge",
      moodBefore: "",
      moodAfter: "",
      meaningText: "",
      plannedContext: "",
      socialContext: "",
      tags: [],
      links: [],
      provenance: {}
    });
    const botWorkout = createWorkoutSession({
      userId: "user_forge_bot",
      workoutType: "cycling",
      startedAt: "2026-06-03T08:00:00.000Z",
      endedAt: "2026-06-03T08:30:00.000Z",
      source: "manual",
      sourceType: "manual",
      sourceDevice: "Forge",
      moodBefore: "",
      moodAfter: "",
      meaningText: "",
      plannedContext: "",
      socialContext: "",
      tags: [],
      links: [],
      provenance: {}
    });
    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: { cookie: operatorCookie },
      payload: {
        label: "Workout detail scope",
        scopes: ["read"],
        scopePolicy: {
          userIds: ["user_forge_bot"],
          projectIds: [],
          tagIds: []
        }
      }
    });
    assert.equal(tokenResponse.statusCode, 201);
    const token = (tokenResponse.json() as { token: { token: string } }).token
      .token;
    const authorization = { authorization: `Bearer ${token}` };

    const fitnessResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/fitness?sessionDetail=summary&analysisDetail=compact",
      headers: authorization
    });
    assert.equal(fitnessResponse.statusCode, 200);
    const scopedSessions = (
      fitnessResponse.json() as {
        fitness: { sessions: Array<{ id: string; userId: string }> };
      }
    ).fitness.sessions;
    assert.ok(scopedSessions.some((session) => session.id === botWorkout.id));
    assert.ok(
      scopedSessions.every((session) => session.userId === "user_forge_bot")
    );

    const forbiddenDetail = await app.inject({
      method: "GET",
      url: `/api/v1/health/workouts/${operatorWorkout.id}/detail`,
      headers: authorization
    });
    assert.equal(forbiddenDetail.statusCode, 404);

    const allowedDetail = await app.inject({
      method: "GET",
      url: `/api/v1/health/workouts/${botWorkout.id}/detail`,
      headers: authorization
    });
    assert.equal(allowedDetail.statusCode, 200);
    assert.equal(allowedDetail.json().workout.id, botWorkout.id);

    const widenedDetail = await app.inject({
      method: "GET",
      url: `/api/v1/health/workouts/${botWorkout.id}/detail?userIds=user_operator`,
      headers: authorization
    });
    assert.equal(widenedDetail.statusCode, 403);
    assert.equal(widenedDetail.json().code, "user_scope_forbidden");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
