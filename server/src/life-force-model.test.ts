import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTaskActionPointSummary,
  buildTaskSplitSuggestion,
  computeActionCostModifier,
  computeCurveArea,
  computeCurveHandleMaxRate,
  normalizeCurveToBudget
} from "./services/life-force-model.js";

test("life force curve normalization preserves the requested budget", () => {
  const normalized = normalizeCurveToBudget(
    [
      { minuteOfDay: 0, rateApPerHour: 0 },
      { minuteOfDay: 8 * 60, rateApPerHour: 8 },
      { minuteOfDay: 12 * 60, rateApPerHour: 12 },
      { minuteOfDay: 18 * 60, rateApPerHour: 8 },
      { minuteOfDay: 24 * 60, rateApPerHour: 0 }
    ],
    200
  );

  assert.equal(Number(computeCurveArea(normalized).toFixed(2)), 200);
});

test("life force handle ceiling prevents the edited segment from overshooting the budget", () => {
  const points = normalizeCurveToBudget(
    [
      { minuteOfDay: 0, rateApPerHour: 0 },
      { minuteOfDay: 8 * 60, rateApPerHour: 9 },
      { minuteOfDay: 12 * 60, rateApPerHour: 12 },
      { minuteOfDay: 18 * 60, rateApPerHour: 7 },
      { minuteOfDay: 24 * 60, rateApPerHour: 0 }
    ],
    200
  );
  const handleMax = computeCurveHandleMaxRate(points, 2, 200);
  const edited = points.map((point, index) =>
    index === 2 ? { ...point, rateApPerHour: handleMax } : point
  );

  assert.ok(computeCurveArea(edited) <= 200.0001);
});

test("task AP summary charges one hour on the default task shape as 4.17 AP", () => {
  const summary = buildTaskActionPointSummary({
    plannedDurationSeconds: 24 * 60 * 60,
    totalCostAp: 100,
    spentTodayAp: (100 / 24 / 60) * 60,
    spentTotalAp: (100 / 24 / 60) * 60
  });

  assert.equal(Number(summary.spentTodayAp.toFixed(2)), 4.17);
  assert.equal(Number(summary.sustainRateApPerHour.toFixed(2)), 4.17);
});

test("task split suggestion triggers from actual or projected work crossing twice the expected duration", () => {
  const actual = buildTaskSplitSuggestion({
    plannedDurationSeconds: 24 * 60 * 60,
    totalTrackedSeconds: 48 * 60 * 60
  });
  assert.equal(actual.shouldSplit, true);

  const projected = buildTaskSplitSuggestion({
    plannedDurationSeconds: 24 * 60 * 60,
    totalTrackedSeconds: 30 * 60 * 60,
    projectedTotalSeconds: 50 * 60 * 60
  });
  assert.equal(projected.shouldSplit, true);
  assert.match(projected.reason ?? "", /current live plan/i);
});

test("stat modifiers reduce action cost without breaking the AP economy", () => {
  const modifier = computeActionCostModifier(
    {
      activation: 0.2,
      focus: 0.5,
      vigor: 0.05,
      composure: 0.05,
      flow: 0.2
    },
    {
      life_force: 4,
      activation: 2,
      focus: 6,
      vigor: 1,
      composure: 1,
      flow: 3
    }
  );

  assert.equal(Number(modifier.toFixed(2)), 0.94);
  assert.ok(modifier >= 0.55);
  assert.ok(modifier <= 1.25);
});
