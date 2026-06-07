import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WeightLossViewData } from "@/lib/weight-loss-types";
import { WeightLossLedgerPanel } from "./weight-loss-food-panels";

function renderPanel(remainingCalories: number) {
  const ledger = {
    dateKey: "2026-06-08",
    meals: [],
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

    expect(screen.getByText("Eaten today")).toBeInTheDocument();
    expect(screen.getByText("1457 kcal")).toBeInTheDocument();
    expect(screen.getByText("Target today")).toBeInTheDocument();
    expect(screen.getByText("1800 kcal")).toBeInTheDocument();
    expect(screen.getByText("Kcal left")).toBeInTheDocument();
    expect(screen.getByText("343 kcal")).toBeInTheDocument();
  });

  it("labels calories over target clearly", () => {
    renderPanel(-310);

    expect(screen.getByText("Over target")).toBeInTheDocument();
    expect(screen.getByText("310 kcal")).toBeInTheDocument();
  });
});
