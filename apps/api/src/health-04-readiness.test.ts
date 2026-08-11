import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { createWorkoutSession, getTrainingLoadViewData } from "./health.js";

function shiftedIso(days: number, hour: number) {
  const date = new Date();
  date.setUTCHours(hour, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

test("HEALTH-04 excludes stale buckets from mixed-sport training baselines", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-health-04-"));
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const sessions = [
      {
        workoutType: "rowing",
        startedAt: shiftedIso(-120, 7),
        endedAt: shiftedIso(-120, 8),
        load: 100,
        zones: { zone_2: 3_600 }
      },
      {
        workoutType: "cycling",
        startedAt: shiftedIso(-1, 6),
        endedAt: shiftedIso(-1, 7),
        load: 60,
        zones: { zone_2: 3_600 }
      },
      {
        workoutType: "kickboxing",
        startedAt: shiftedIso(-1, 8),
        endedAt: shiftedIso(-1, 9),
        load: 40,
        zones: { zone_4: 1_800, zone_1: 1_800 }
      }
    ].map((fixture) => ({
      ...fixture,
      workout: createWorkoutSession({
        userId: "user_operator",
        workoutType: fixture.workoutType,
        startedAt: fixture.startedAt,
        endedAt: fixture.endedAt,
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
      })
    }));

    const now = new Date().toISOString();
    const insertAnalytics = getDatabase().prepare(
      `UPDATE health_workout_analytics
       SET confidence = 'high', data_quality_json = ?, zone_durations_json = ?,
           load_json = ?, computed_at = ?, updated_at = ?
       WHERE workout_id = ? AND model_version = 'forge-hrr-v1'`
    );
    sessions.forEach((fixture) => {
      const zoneDurations = Object.entries(fixture.zones).map(
        ([key, seconds]) => ({
          key,
          label: key.replaceAll("_", " "),
          seconds,
          percentage: seconds / 3_600
        })
      );
      insertAnalytics.run(
        JSON.stringify({
          heartRateSampleCount: 720,
          sampleCoverage: 1
        }),
        JSON.stringify(zoneDurations),
        JSON.stringify({ trimp: fixture.load, intensity: fixture.load / 60 }),
        now,
        now,
        fixture.workout.id
      );
    });

    const trainingLoad = getTrainingLoadViewData(["user_operator"]);
    const latestDaily = trainingLoad.zoneTimeSeries.daily.at(-1);
    const latestWeekly = trainingLoad.zoneTimeSeries.weekly.at(-1);
    const latestMonthly = trainingLoad.zoneTimeSeries.monthly.at(-1);

    assert.ok(latestDaily);
    assert.equal(latestDaily.sessionCount, 2);
    assert.equal(latestDaily.trainingLoad, 100);
    assert.equal(latestDaily.baselineLoadRatio, null);
    assert.equal(latestDaily.baselineIntensityRatio, null);
    assert.equal(latestWeekly?.baselineLoadRatio, null);
    assert.equal(latestWeekly?.baselineIntensityRatio, null);
    assert.equal(latestMonthly?.baselineLoadRatio, null);
    assert.equal(latestMonthly?.baselineIntensityRatio, null);

    assert.deepEqual(
      trainingLoad.activityBreakdown.map((entry) => entry.workoutType).sort(),
      ["cycling", "kickboxing", "rowing"]
    );
    assert.deepEqual(
      Object.fromEntries(
        trainingLoad.activityBreakdown.map((entry) => [
          entry.workoutType,
          entry.trainingLoad
        ])
      ),
      { cycling: 60, kickboxing: 40, rowing: 100 }
    );
    assert.equal(
      trainingLoad.trainingIntelligence.modes[0]?.loadBalance
        .latestWeekBaselineLoadRatio,
      null
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
