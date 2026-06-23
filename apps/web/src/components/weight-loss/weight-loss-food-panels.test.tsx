import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  NutritionFoodLog,
  WeightLossViewData
} from "@/lib/weight-loss-types";
import { WeightLossLedgerPanel } from "./weight-loss-food-panels";

afterEach(() => cleanup());

function buildMeal(
  id: string,
  mealLabel: string | null,
  calories: number
): NutritionFoodLog {
  return {
    id,
    userId: "user_operator",
    loggedAt: "2026-06-08T12:00:00.000Z",
    mealLabel,
    source: "manual",
    confirmationState: "confirmed",
    placeId: null,
    stayId: null,
    workoutId: null,
    sleepId: null,
    dayKey: "2026-06-08",
    imageRefs: [],
    parserProvenance: {},
    satietyScore: null,
    hungerBefore: null,
    hungerAfter: null,
    cravingScore: null,
    enjoymentScore: null,
    socialContext: null,
    locationContext: null,
    notes: null,
    totals: {
      calories,
      proteinGrams: 10,
      carbohydrateGrams: 20,
      fatGrams: 5,
      fiberGrams: 2,
      sugarGrams: 0,
      sodiumMg: 0,
      potassiumMg: 0,
      caffeineMg: 0,
      alcoholGrams: 0
    },
    items: []
  };
}

function renderPanel(
  remainingCalories: number,
  meals: NutritionFoodLog[] = []
) {
  const ledger = {
    dateKey: "2026-06-08",
    meals,
    totals: {
      calories: remainingCalories >= 0 ? 1457 : 2110,
      proteinGrams: 66,
      carbohydrateGrams: 193,
      fatGrams: 50,
      fiberGrams: 20,
      sodiumMg: 0,
      caffeineMg: 80,
      alcoholGrams: 0
    },
    plannedTargetCalories: 1800,
    targetCalories: 1800,
    activeAdjustmentCalories: 0,
    activeCaloriesSource: "user_override",
    calorieDelta: -remainingCalories,
    remainingCalories,
    proteinCoverage: 0.47,
    fiberCoverage: 0.8,
    unconfirmedCount: 0
  } satisfies WeightLossViewData["todayLedger"];

  render(
    <WeightLossLedgerPanel
      ledger={ledger}
      remainingCalories={remainingCalories}
      intakePercent={80}
      logSavedPending={false}
      onLogAgain={vi.fn()}
      onEditMeal={vi.fn()}
      onDeleteMeal={vi.fn()}
    />
  );
}

describe("WeightLossLedgerPanel", () => {
  it("shows eaten, target, and kcal left as first-class day budget numbers", () => {
    renderPanel(343);

    expect(screen.getByText("Eaten")).toBeInTheDocument();
    expect(screen.getByText("1457 kcal")).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("1800 kcal")).toBeInTheDocument();
    expect(screen.getByText("Kcal left")).toBeInTheDocument();
    expect(screen.getByText("343 kcal")).toBeInTheDocument();
  });

  it("labels calories over target clearly", () => {
    renderPanel(-310);

    expect(screen.getByText("Over target")).toBeInTheDocument();
    expect(screen.getByText("310 kcal")).toBeInTheDocument();
  });

  it("groups logs by optional meal marker", () => {
    renderPanel(343, [
      buildMeal("meal_lunch", "Lunch", 500),
      buildMeal("meal_unmarked", "", 180),
      buildMeal("meal_lunch_2", "Lunch", 120)
    ]);

    expect(screen.getAllByText("Lunch").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("2 logs · 620 kcal")).toBeInTheDocument();
    expect(screen.getByText("No meal marker")).toBeInTheDocument();
    expect(screen.getByText("1 log · 180 kcal")).toBeInTheDocument();
  });
});
