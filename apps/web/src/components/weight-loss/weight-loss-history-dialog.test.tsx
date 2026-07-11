import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { NutritionFoodLog } from "@/lib/weight-loss-types";
import {
  filterFoodHistory,
  WeightLossDeleteFoodLogDialog,
  WeightLossHistoryDialog
} from "./weight-loss-history-dialog";

afterEach(cleanup);

function buildMeal(index: number): NutritionFoodLog {
  return {
    id: `meal_${index}`,
    userId: "user_operator",
    loggedAt: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
    mealLabel: index % 2 === 0 ? "Lunch" : "Dinner",
    source: "manual",
    confirmationState: "confirmed",
    placeId: null,
    stayId: null,
    workoutId: null,
    sleepId: null,
    dayKey: "2026-07-01",
    imageRefs: [],
    parserProvenance: {},
    satietyScore: null,
    hungerBefore: null,
    hungerAfter: null,
    cravingScore: null,
    enjoymentScore: null,
    socialContext: null,
    locationContext: null,
    notes: index === 42 ? "post workout" : null,
    totals: {
      calories: 500,
      proteinGrams: 30,
      carbohydrateGrams: 50,
      fatGrams: 20,
      fiberGrams: 8,
      sugarGrams: 5,
      sodiumMg: 400,
      potassiumMg: 300,
      caffeineMg: 0,
      alcoholGrams: 0
    },
    items: [
      {
        id: `item_${index}`,
        foodId: null,
        sortOrder: 0,
        name: `Food ${index}`,
        brand: index === 42 ? "Recovery Kitchen" : null,
        quantity: 1,
        unit: "serving",
        calories: 500
      }
    ]
  };
}

describe("WeightLossHistoryDialog", () => {
  const meals = Array.from({ length: 55 }, (_, index) => buildMeal(index));

  it("searches notes and food identity across the full history", () => {
    expect(filterFoodHistory(meals, "Recovery Kitchen")).toHaveLength(1);
    expect(filterFoodHistory(meals, "post workout")[0]?.id).toBe("meal_42");
  });

  it("mounts food history in bounded batches", () => {
    render(
      <WeightLossHistoryDialog
        open
        onOpenChange={() => undefined}
        meals={meals}
        onLogAgain={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
        pending={false}
      />
    );

    expect(screen.getByText("Food 19")).toBeInTheDocument();
    expect(screen.queryByText("Food 20")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show next meals" }));
    expect(screen.getByText("Food 39")).toBeInTheDocument();
    expect(screen.queryByText("Food 40")).not.toBeInTheDocument();
  });

  it("uses a guided confirmation with the exact meal impact", () => {
    render(
      <WeightLossDeleteFoodLogDialog
        meal={meals[0]!}
        open
        onOpenChange={() => undefined}
        onConfirm={async () => undefined}
        pending={false}
      />
    );

    expect(screen.getByText("Delete Food 0?")).toBeInTheDocument();
    expect(screen.getByText(/2026-07-01 · 500 kcal/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete food log" })
    ).toBeInTheDocument();
  });
});
