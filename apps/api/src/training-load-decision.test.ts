import assert from "node:assert/strict";
import test from "node:test";
import { buildTrainingLoadDecision } from "./health.js";

function summary(
  overrides: Partial<Parameters<typeof buildTrainingLoadDecision>[0]> = {}
): Parameters<typeof buildTrainingLoadDecision>[0] {
  return {
    acuteLoad7d: 300,
    chronicWeeklyLoad28d: 300,
    acuteChronicRatio: 1,
    monotony7d: 1,
    strain7d: 300,
    highIntensityMinutes7d: 20,
    thresholdMinutes7d: 40,
    easyMinutes7d: 180,
    hardDayCount7d: 1,
    averageHeartRateCoverage: 0.92,
    readiness: "productive",
    ...overrides
  };
}

test("training-load decision preserves strict strain and ratio recovery boundaries", () => {
  assert.equal(
    buildTrainingLoadDecision(summary({ strain7d: 450 })).status,
    "sharpen"
  );
  assert.deepEqual(
    buildTrainingLoadDecision(summary({ strain7d: 450.04 })).activeTriggers,
    [
      {
        key: "strain_high",
        metricLabel: "7-day strain",
        value: 450.04,
        comparison: "gt",
        threshold: 450,
        unit: "load"
      }
    ]
  );
  assert.equal(
    buildTrainingLoadDecision(summary({ acuteChronicRatio: 1.35 })).status,
    "sharpen"
  );
  const ratioRecovery = buildTrainingLoadDecision(
    summary({ acuteChronicRatio: 1.36 })
  );
  assert.equal(ratioRecovery.status, "recover");
  assert.equal(ratioRecovery.primaryTrigger?.key, "acute_chronic_ratio_high");
  assert.equal(ratioRecovery.primaryTrigger?.value, 1.36);
});

test("training-load decision reports every active recovery rule", () => {
  const decision = buildTrainingLoadDecision(
    summary({
      acuteChronicRatio: 1.5,
      strain7d: 520,
      readiness: "overload_watch"
    })
  );

  assert.equal(decision.status, "recover");
  assert.equal(decision.primaryTrigger?.key, "strain_high");
  assert.deepEqual(
    decision.activeTriggers.map((trigger) => trigger.key),
    ["strain_high", "acute_chronic_ratio_high"]
  );
  assert.equal(decision.strainFormula, "acute_load_x_monotony");
});

test("training-load decision preserves build, maintain, and sharpen outcomes", () => {
  const build = buildTrainingLoadDecision(summary({ acuteChronicRatio: 0.79 }));
  assert.equal(build.status, "build");
  assert.equal(build.primaryTrigger?.comparison, "lt");
  assert.equal(build.primaryTrigger?.threshold, 0.8);

  const maintain = buildTrainingLoadDecision(
    summary({ highIntensityMinutes7d: 45 })
  );
  assert.equal(maintain.status, "maintain");
  assert.equal(maintain.primaryTrigger?.comparison, "gte");
  assert.equal(maintain.primaryTrigger?.threshold, 45);

  const sharpen = buildTrainingLoadDecision(summary());
  assert.equal(sharpen.status, "sharpen");
  assert.equal(sharpen.primaryTrigger, null);
  assert.deepEqual(sharpen.activeTriggers, []);
});
