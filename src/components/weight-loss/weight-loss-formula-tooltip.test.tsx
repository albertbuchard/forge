import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WeightLossFormulaTooltip } from "./weight-loss-formula-tooltip";

describe("WeightLossFormulaTooltip", () => {
  it("shows the calorie and macro formulas in a help tooltip", () => {
    render(
      <WeightLossFormulaTooltip
        values={{
          sex: "male",
          bmrKcal: 1700,
          restingKcal: 1700,
          activeKcal: 500,
          maintenanceKcal: 2200,
          weeklyRateKg: -0.4,
          dailyAdjustmentKcal: -440,
          calorieTarget: 1760,
          calorieFloor: 1500,
          proteinReferenceWeightKg: 76,
          proteinFactor: 2,
          proteinGrams: 152,
          fatGrams: 59,
          carbohydrateGrams: 147,
          fiberGrams: 25,
          fiberEnergyAdjustedGrams: 25,
          fiberDriGrams: 38
        }}
      />
    );

    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "Show calorie and macro formulas" })
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Mifflin-St Jeor BMR"
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "maintenance + objective adjustment"
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Carbohydrate target"
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "adult AI reference 38"
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Sport-loss estimate"
    );
  });
});
