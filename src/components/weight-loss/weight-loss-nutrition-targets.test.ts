import { describe, expect, it } from "vitest";
import type { WeightLossViewData } from "@/lib/weight-loss-types";
import { buildNutritionTargetGroups } from "./weight-loss-nutrition-targets";

function macroNumber(
  groups: ReturnType<typeof buildNutritionTargetGroups>,
  id: string
) {
  const value = Number(groups.macros.find((row) => row.id === id)?.target);
  if (!Number.isFinite(value)) {
    throw new Error(`Missing numeric macro target ${id}`);
  }
  return value;
}

describe("buildNutritionTargetGroups", () => {
  it("keeps displayed macro calories within the calorie target when fat is generated", () => {
    const groups = buildNutritionTargetGroups({
      target: {
        calorieTarget: 1500,
        proteinGramsTarget: 152,
        carbohydrateGramsTarget: 120,
        fatGramsTarget: null,
        fiberGramsTarget: 38,
        notes: "sex=male; age_years=35"
      },
      weightTrend: {
        latestWeightKg: 84
      },
      energyModel: {}
    } as unknown as WeightLossViewData);
    const protein = macroNumber(groups, "protein");
    const carbs = macroNumber(groups, "carbohydrate");
    const fat = macroNumber(groups, "fat");
    const calories = protein * 4 + carbs * 4 + fat * 9;

    expect(carbs).toBeLessThan(120);
    expect(calories).toBeLessThanOrEqual(1506);
    expect(groups.macros.find((row) => row.id === "fiber")?.note).toContain(
      "sex/age adult AI remains a reference"
    );
  });

  it("uses the energy-adjusted fiber target when no saved plan target exists", () => {
    const groups = buildNutritionTargetGroups({
      target: {
        calorieTarget: 1500,
        proteinGramsTarget: 152,
        carbohydrateGramsTarget: null,
        fatGramsTarget: null,
        fiberGramsTarget: null,
        notes: "sex=male; age_years=35"
      },
      weightTrend: {
        latestWeightKg: 80
      },
      energyModel: {}
    } as unknown as WeightLossViewData);

    expect(macroNumber(groups, "fiber")).toBe(21);
  });
});
