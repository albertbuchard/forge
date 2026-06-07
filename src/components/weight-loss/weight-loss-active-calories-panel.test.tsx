import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WeightLossViewData } from "@/lib/weight-loss-types";
import { WeightLossActiveCaloriesMiniCard } from "./weight-loss-active-calories-panel";

function buildView(): WeightLossViewData {
  return {
    todayLedger: {
      dateKey: "2026-06-08",
      meals: [],
      totals: {
        calories: 1200,
        proteinGrams: 80,
        carbohydrateGrams: 120,
        fatGrams: 40,
        fiberGrams: 20,
        sodiumMg: 0,
        caffeineMg: 0,
        alcoholGrams: 0
      },
      plannedTargetCalories: 1800,
      targetCalories: 1800,
      activeAdjustmentCalories: 0,
      activeCaloriesSource: "user_override",
      calorieDelta: -600,
      remainingCalories: 600,
      proteinCoverage: null,
      fiberCoverage: null,
      unconfirmedCount: 0
    },
    energyModel: {
      restingEnergyCalories: 1700,
      activeEnergyCalories: 600,
      movementCaloriesKcal: 0,
      workoutEnergyKcal: 0,
      inferredTdee: 2300,
      estimatedTdeeKcal: 2300,
      activeBurnKcal: 600,
      formulaRestingKcal: 1700,
      wearableRestingKcal: null,
      wearableRestingSource: null,
      wearableRestingDayCount: 0,
      wearableRestingCoverageQualifiedDayCount: 0,
      chosenRestingKcal: 1700,
      chosenRestingSource: "formula",
      restingConfidence: "formula",
      restingExclusionReasons: [],
      wearableConfidence: "measured_directional",
      activeBaselineWindowDays: 7,
      activeBaselineEvidenceDays: 7,
      baselineActiveCaloriesKcal: 600,
      todayHealthKitActiveCaloriesKcal: null,
      todayWorkoutEnergyKcal: null,
      todayMovementCaloriesKcal: null,
      todayStepEstimatedCaloriesKcal: null,
      todayStepCount: null,
      todayObservedActiveCaloriesKcal: null,
      todayActiveCaloriesSource: "user_override",
      todayActiveCaloriesKcal: 300,
      todayTargetAdjustmentKcal: -300,
      todayActiveDeltaKcal: -300,
      todayActiveSurplusKcal: 0,
      todayActivityBufferKcal: 0,
      activityEatBackFraction: 1,
      todayActiveOverride: {
        id: "daily_energy_test",
        userId: "user-test",
        dayKey: "2026-06-08",
        activeCaloriesKcal: 300,
        notes: "",
        createdAt: "2026-06-08T08:00:00.000Z",
        updatedAt: "2026-06-08T08:00:00.000Z"
      },
      sourceAvailability: {
        healthKitDailyEnergy: true,
        workoutEnergy: false,
        movementTripCalories: false
      },
      recentFoodLogCount: 3,
      recentFoodLogDayCount: 1,
      averageCalorieIntake: 1200,
      currentDeficitEstimate: null,
      estimatedDailyEnergyBalanceKcal: -1100
    }
  } as unknown as WeightLossViewData;
}

describe("WeightLossActiveCaloriesMiniCard", () => {
  it("normalizes an emptied manual kcal field to zero", () => {
    const onDraftChange = vi.fn();
    render(
      <WeightLossActiveCaloriesMiniCard
        view={buildView()}
        draftValue="300"
        pending={false}
        error={null}
        onDraftChange={onDraftChange}
        onSave={vi.fn()}
        onReset={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Today active calories"), {
      target: { value: "" }
    });

    expect(onDraftChange).toHaveBeenCalledWith("0");
  });
});
