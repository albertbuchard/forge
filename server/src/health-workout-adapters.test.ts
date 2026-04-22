import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkoutSessionPersistenceSeed,
  buildWorkoutSessionPresentation
} from "./health-workout-adapters.js";

test("workout adapter normalizes legacy apple health activity codes into structured labels", () => {
  const presentation = buildWorkoutSessionPresentation({
    source: "apple_health",
    sourceType: "healthkit_sync",
    workoutType: "activity_52"
  });

  assert.equal(presentation.sourceSystem, "apple_health");
  assert.equal(presentation.workoutType, "walking");
  assert.equal(presentation.workoutTypeLabel, "Walking");
  assert.equal(presentation.activityFamily, "cardio");
  assert.equal(presentation.activityFamilyLabel, "Cardio");
  assert.equal(presentation.activity.providerActivityType, "hk_workout_activity_type");
  assert.equal(presentation.activity.providerRawValue, 52);
  assert.equal(presentation.activity.isFallback, false);
});

test("workout adapter preserves provider details and sorts structured workout payloads", () => {
  const persistence = buildWorkoutSessionPersistenceSeed({
    source: "apple_health",
    sourceType: "healthkit_sync",
    workoutType: "activity_52",
    sourceSystem: "apple_health",
    sourceBundleIdentifier: "com.apple.health",
    sourceProductType: "Watch7,5",
    details: {
      sourceSystem: "apple_health",
      metrics: [
        {
          key: "vo2_max",
          label: "VO2 max",
          category: "recovery",
          unit: "ml/kg/min",
          statistic: "latest",
          value: 47.2
        },
        {
          key: "average_speed",
          label: "Average speed",
          category: "cardio",
          unit: "km/h",
          statistic: "average",
          value: 5.4
        }
      ],
      events: [
        {
          type: "resume",
          label: "Resume",
          startedAt: "2026-04-07T07:22:00.000Z",
          endedAt: "2026-04-07T07:22:30.000Z",
          durationSeconds: 30,
          metadata: {}
        },
        {
          type: "pause",
          label: "Pause",
          startedAt: "2026-04-07T07:18:00.000Z",
          endedAt: "2026-04-07T07:19:00.000Z",
          durationSeconds: 60,
          metadata: {}
        }
      ],
      components: [
        {
          externalUid: "segment_b",
          startedAt: "2026-04-07T07:30:00.000Z",
          endedAt: "2026-04-07T07:40:00.000Z",
          durationSeconds: 600,
          activity: {
            sourceSystem: "apple_health",
            providerActivityType: "hk_workout_activity_type",
            providerRawValue: 80,
            canonicalKey: "cooldown",
            canonicalLabel: "Cooldown",
            familyKey: "mobility",
            familyLabel: "Mobility",
            isFallback: false
          },
          metrics: [],
          metadata: {}
        },
        {
          externalUid: "segment_a",
          startedAt: "2026-04-07T07:05:00.000Z",
          endedAt: "2026-04-07T07:15:00.000Z",
          durationSeconds: 600,
          activity: {
            sourceSystem: "apple_health",
            providerActivityType: "hk_workout_activity_type",
            providerRawValue: 52,
            canonicalKey: "walking",
            canonicalLabel: "Walking",
            familyKey: "cardio",
            familyLabel: "Cardio",
            isFallback: false
          },
          metrics: [],
          metadata: {}
        }
      ],
      metadata: {
        indoorWorkout: true
      }
    }
  });

  assert.equal(persistence.sourceBundleIdentifier, "com.apple.health");
  assert.equal(persistence.sourceProductType, "Watch7,5");
  assert.equal(persistence.activity.canonicalKey, "walking");
  assert.deepEqual(
    persistence.details.metrics.map((metric) => metric.key),
    ["average_speed", "vo2_max"]
  );
  assert.deepEqual(
    persistence.details.events.map((event) => event.type),
    ["pause", "resume"]
  );
  assert.deepEqual(
    persistence.details.components.map((component) => component.externalUid),
    ["segment_a", "segment_b"]
  );
});
