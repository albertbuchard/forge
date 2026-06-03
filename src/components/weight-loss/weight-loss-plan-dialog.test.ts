import { describe, expect, it } from "vitest";
import {
  buildInitialPlanDraft,
  calculatePlan,
  validateWeightLossPlanDraft,
  type WeightLossPlanDraft
} from "./weight-loss-plan-dialog";
import type { WeightLossViewData } from "@/lib/weight-loss-types";

const baseDraft: WeightLossPlanDraft = {
  goalMode: "lose",
  sex: "male",
  ageYears: "35",
  heightCm: "178",
  currentWeightKg: "80",
  goalWeightKg: "76",
  weeklyRateKg: "0.4",
  activeCaloriesKcal: "500",
  restingCaloriesKcal: "1700",
  dietStyle: ""
};

describe("calculatePlan", () => {
  it("keeps active calories independent from the weight objective", () => {
    const loss = calculatePlan(baseDraft);
    const gain = calculatePlan({ ...baseDraft, goalMode: "gain" });
    const maintain = calculatePlan({ ...baseDraft, goalMode: "maintain" });

    expect(loss.activeCalories).toBe(500);
    expect(gain.activeCalories).toBe(500);
    expect(maintain.activeCalories).toBe(500);
    expect(loss.maintenanceCalories).toBe(2200);
    expect(gain.maintenanceCalories).toBe(2200);
    expect(maintain.maintenanceCalories).toBe(2200);
    expect(loss.dailyEnergyAdjustment).toBeLessThan(0);
    expect(gain.dailyEnergyAdjustment).toBeGreaterThan(0);
    expect(maintain.dailyEnergyAdjustment).toBe(0);
  });

  it("does not force a carbohydrate floor that breaks the calorie target", () => {
    const plan = calculatePlan({
      ...baseDraft,
      sex: "female",
      currentWeightKg: "95",
      activeCaloriesKcal: "100",
      restingCaloriesKcal: "1450",
      weeklyRateKg: "0.9"
    });
    const macroCalories =
      plan.proteinGramsTarget * 4 +
      plan.carbohydrateGramsTarget * 4 +
      plan.fatGramsTarget * 9;

    expect(plan.minimumCalorieFloor).toBe(1200);
    expect(plan.carbohydrateGramsTarget).toBeLessThan(130);
    expect(macroCalories).toBeLessThanOrEqual(plan.calorieTarget);
  });

  it("keeps macro calories possible for a high body-weight cut", () => {
    const plan = calculatePlan({
      ...baseDraft,
      sex: "female",
      currentWeightKg: "180",
      goalWeightKg: "150",
      heightCm: "165",
      activeCaloriesKcal: "100",
      restingCaloriesKcal: "1800",
      weeklyRateKg: "1.0"
    });
    const macroCalories =
      plan.proteinGramsTarget * 4 +
      plan.carbohydrateGramsTarget * 4 +
      plan.fatGramsTarget * 9;

    expect(plan.proteinReferenceWeight).toBeLessThan(100);
    expect(plan.proteinGramsTarget * 4).toBeLessThanOrEqual(
      plan.calorieTarget * 0.45
    );
    expect(macroCalories).toBeLessThanOrEqual(plan.calorieTarget);
  });

  it("keeps low-calorie fiber targets energy-adjusted while exposing the adult AI reference", () => {
    const plan = calculatePlan({
      ...baseDraft,
      activeCaloriesKcal: "0",
      weeklyRateKg: "0.5"
    });

    expect(plan.calorieTarget).toBe(1500);
    expect(plan.fiberEnergyAdjustedGrams).toBe(21);
    expect(plan.fiberDriGrams).toBe(38);
    expect(plan.fiberGramsTarget).toBe(21);
  });

  it("computes maintenance from resting plus active before applying the objective", () => {
    const plan = calculatePlan({
      ...baseDraft,
      goalMode: "lose",
      restingCaloriesKcal: "1650",
      activeCaloriesKcal: "650",
      weeklyRateKg: "0.7"
    });

    expect(plan.maintenanceCalories).toBe(2300);
    expect(plan.dailyEnergyAdjustment).toBe(-770);
    expect(plan.plannedCalorieTarget).toBe(1530);
    expect(plan.calorieTarget).toBe(1530);
  });

  it("keeps unknown profile fields blank instead of pretending defaults are known", () => {
    const view = {
      target: {
        notes: null,
        bodyGoal: "lose",
        weightGoalKg: null,
        goalBodyWeightKg: null,
        weeklyRateGoalKg: null,
        dietStyle: null
      },
      weightTrend: {
        latestWeightKg: null
      },
      energyModel: {}
    } as WeightLossViewData;

    const draft = buildInitialPlanDraft(view);

    expect(draft.ageYears).toBe("");
    expect(draft.heightCm).toBe("");
    expect(draft.currentWeightKg).toBe("");
    expect(draft.goalWeightKg).toBe("76.0");
  });

  it("requires real setup fields before saving the plan", () => {
    const error = validateWeightLossPlanDraft({
      ...baseDraft,
      ageYears: "",
      heightCm: "",
      currentWeightKg: "",
      activeCaloriesKcal: ""
    });

    expect(error).toContain("real age");
    expect(error).toContain("height in cm");
    expect(error).toContain("current weight");
    expect(error).toContain("active calories");
  });
});
