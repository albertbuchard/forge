import { describe, expect, it } from "vitest";
import {
  HALL_NIDDK_LINEAR_WEIGHT_MODEL,
  hallNiddkDailyEnergyAdjustmentToAverageWeeklyRateKg,
  hallNiddkWeeklyRateKgToDailyEnergyAdjustment,
  staticKgRateToDailyEnergyAdjustment
} from "./weight-loss-energy-model";

describe("Hall/NIDDK linearized weight model", () => {
  it("converts target weekly change to daily calories over the 12-week planning horizon", () => {
    expect(HALL_NIDDK_LINEAR_WEIGHT_MODEL.defaultPlanningHorizonDays).toBe(84);
    expect(
      Math.round(hallNiddkWeeklyRateKgToDailyEnergyAdjustment(-0.35) ?? 0)
    ).toBe(-450);
    expect(
      Math.round(hallNiddkWeeklyRateKgToDailyEnergyAdjustment(0.35) ?? 0)
    ).toBe(450);
  });

  it("round-trips daily calories back to average grams per week", () => {
    const dailyAdjustment =
      hallNiddkWeeklyRateKgToDailyEnergyAdjustment(-0.35) ?? 0;
    const weeklyRate =
      hallNiddkDailyEnergyAdjustmentToAverageWeeklyRateKg(dailyAdjustment);

    expect(weeklyRate).not.toBeNull();
    expect(Math.round((weeklyRate ?? 0) * 1000)).toBe(-350);
  });

  it("keeps the static 7700 kcal/kg rule available only as a comparison", () => {
    expect(Math.round(staticKgRateToDailyEnergyAdjustment(-0.35) ?? 0)).toBe(
      -385
    );
    expect(
      Math.round(hallNiddkWeeklyRateKgToDailyEnergyAdjustment(-0.35) ?? 0)
    ).not.toBe(Math.round(staticKgRateToDailyEnergyAdjustment(-0.35) ?? 0));
  });
});
