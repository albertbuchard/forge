import { useMemo } from "react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { SurfaceStat } from "@/components/ui/surface";
import { Textarea } from "@/components/ui/textarea";
import type {
  NutritionTargetPatchInput,
  WeightLossViewData
} from "@/lib/weight-loss-types";
import { formatNumber, numeric } from "./weight-loss-format";

type GoalMode = "lose" | "gain" | "maintain";
type Sex = "male" | "female";

export type WeightLossPlanDraft = {
  goalMode: GoalMode;
  sex: Sex;
  ageYears: string;
  heightCm: string;
  currentWeightKg: string;
  goalWeightKg: string;
  weeklyRateKg: string;
  activeCaloriesKcal: string;
  restingCaloriesKcal: string;
  dietStyle: string;
};

function parsePlanNote(notes: string | null | undefined, key: string) {
  if (!notes) {
    return null;
  }
  const match = notes.match(new RegExp(`${key}=([^;]+)`));
  return match?.[1]?.trim() ?? null;
}

function positiveNumber(value: string | number | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function defaultWeeklyRateKg(weightKg: number, goalMode: GoalMode) {
  if (goalMode === "maintain") {
    return 0;
  }
  const percent = goalMode === "gain" ? 0.0025 : 0.005;
  const min = goalMode === "gain" ? 0.1 : 0.2;
  const max = goalMode === "gain" ? 0.35 : Math.max(0.5, weightKg * 0.01);
  return Math.min(max, Math.max(min, weightKg * percent));
}

function defaultGoalWeightKg(weightKg: number, goalMode: GoalMode) {
  if (goalMode === "gain") {
    return weightKg * 1.03;
  }
  if (goalMode === "maintain") {
    return weightKg;
  }
  return weightKg * 0.95;
}

function formatKg(value: number) {
  return value.toFixed(1);
}

function applyObjectiveDefaults(
  draft: WeightLossPlanDraft,
  goalMode: GoalMode
): WeightLossPlanDraft {
  const weight = positiveNumber(draft.currentWeightKg) ?? 80;
  return {
    ...draft,
    goalMode,
    goalWeightKg: formatKg(defaultGoalWeightKg(weight, goalMode)),
    weeklyRateKg: defaultWeeklyRateKg(weight, goalMode).toFixed(2)
  };
}

export function buildInitialPlanDraft(view: WeightLossViewData): WeightLossPlanDraft {
  const latestWeight = numeric(view.weightTrend.latestWeightKg);
  const target = view.target;
  const savedSex = parsePlanNote(target.notes, "sex");
  const savedAge = parsePlanNote(target.notes, "age_years");
  const savedHeight = parsePlanNote(target.notes, "height_cm");
  const inferredActive =
    numeric(view.energyModel.activeBurnKcal) ??
    numeric(view.energyModel.activeEnergyCalories) ??
    numeric(view.energyModel.movementCaloriesKcal) ??
    numeric(parsePlanNote(target.notes, "activity_kcal")) ??
    0;
  const inferredResting =
    numeric(view.energyModel.restingEnergyCalories) ??
    numeric(parsePlanNote(target.notes, "resting_kcal")) ??
    null;
  const bodyGoal = target.bodyGoal ?? "";
  const goalMode: GoalMode = bodyGoal.includes("gain")
    ? "gain"
    : bodyGoal.includes("maintain")
      ? "maintain"
      : "lose";
  const targetWeight = target.weightGoalKg ?? target.goalBodyWeightKg ?? null;
  const currentWeight = latestWeight ?? 80;
  return {
    goalMode,
    sex: savedSex === "female" ? "female" : "male",
    ageYears: positiveNumber(savedAge) ? String(savedAge) : "35",
    heightCm: positiveNumber(savedHeight) ? String(savedHeight) : "",
    currentWeightKg: latestWeight ? latestWeight.toFixed(1) : "",
    goalWeightKg: targetWeight ? String(targetWeight) : formatKg(defaultGoalWeightKg(currentWeight, goalMode)),
    weeklyRateKg:
      target.weeklyRateGoalKg !== null && target.weeklyRateGoalKg !== undefined
        ? String(Math.abs(target.weeklyRateGoalKg))
        : defaultWeeklyRateKg(currentWeight, goalMode).toFixed(2),
    activeCaloriesKcal: inferredActive.toFixed(0),
    restingCaloriesKcal: inferredResting != null ? inferredResting.toFixed(0) : "",
    dietStyle: target.dietStyle ?? ""
  };
}

export function calculatePlan(draft: WeightLossPlanDraft) {
  const weight = Number(draft.currentWeightKg) || 80;
  const height = Number(draft.heightCm) || 178;
  const age = Number(draft.ageYears) || 35;
  const activeCalories = Math.max(0, Number(draft.activeCaloriesKcal) || 0);
  const measuredRestingCalories = positiveNumber(draft.restingCaloriesKcal);
  const sexAdjustment = draft.sex === "male" ? 5 : -161;
  const bmr = 10 * weight + 6.25 * height - 5 * age + sexAdjustment;
  const restingCalories = measuredRestingCalories ?? bmr;
  const maintenanceCalories = restingCalories + activeCalories;
  const weeklyMagnitude = Math.abs(Number(draft.weeklyRateKg) || 0);
  const weeklyRateGoalKg =
    draft.goalMode === "lose"
      ? -weeklyMagnitude
      : draft.goalMode === "gain"
        ? weeklyMagnitude
        : 0;
  const dailyEnergyAdjustment = (weeklyRateGoalKg * 7700) / 7;
  const calorieTarget = Math.max(1200, Math.round(maintenanceCalories + dailyEnergyAdjustment));
  const proteinFactor =
    draft.goalMode === "lose" ? 2 : draft.goalMode === "gain" ? 1.8 : 1.6;
  const proteinGramsTarget = Math.round(weight * proteinFactor);
  const fatGramsTarget = Math.round(
    Math.max(weight * 0.6, Math.min((calorieTarget * 0.3) / 9, (calorieTarget * 0.35) / 9))
  );
  const carbohydrateGramsTarget = Math.max(
    130,
    Math.round((calorieTarget - proteinGramsTarget * 4 - fatGramsTarget * 9) / 4)
  );
  const fiberGramsTarget = Math.round(Math.max(25, (calorieTarget / 1000) * 14));
  const saturatedFatLimitGrams = Math.round((calorieTarget * 0.1) / 9);
  const addedSugarLimitGrams = Math.round((calorieTarget * 0.1) / 4);
  return {
    bmr: Math.round(bmr),
    restingCalories: Math.round(restingCalories),
    restingSource: measuredRestingCalories != null ? "HealthKit basal/resting" : "Mifflin-St Jeor",
    activeCalories: Math.round(activeCalories),
    maintenanceCalories: Math.round(maintenanceCalories),
    weeklyRateGoalKg,
    dailyEnergyAdjustment: Math.round(dailyEnergyAdjustment),
    calorieTarget,
    proteinGramsTarget,
    carbohydrateGramsTarget,
    fatGramsTarget,
    fiberGramsTarget,
    saturatedFatLimitGrams,
    addedSugarLimitGrams
  };
}

export function buildTargetPatchFromPlan(draft: WeightLossPlanDraft): NutritionTargetPatchInput {
  const plan = calculatePlan(draft);
  const goalWeight = Number(draft.goalWeightKg);
  return {
    calorieTarget: plan.calorieTarget,
    proteinGramsTarget: plan.proteinGramsTarget,
    fiberGramsTarget: plan.fiberGramsTarget,
    carbohydrateGramsTarget: plan.carbohydrateGramsTarget,
    fatGramsTarget: plan.fatGramsTarget,
    weightGoalKg: Number.isFinite(goalWeight) ? goalWeight : null,
    weeklyRateGoalKg: plan.weeklyRateGoalKg,
    dietStyle: draft.dietStyle,
    bodyGoal: draft.goalMode,
    notes: [
      "Forge science plan",
      `height_cm=${Number(draft.heightCm) || "unknown"}`,
      `age_years=${Number(draft.ageYears) || "unknown"}`,
      `sex=${draft.sex}`,
      "bmr_formula=Mifflin-St Jeor",
      `resting_kcal=${plan.restingCalories}`,
      `activity_kcal=${plan.activeCalories}`,
      `maintenance_kcal=${plan.maintenanceCalories}`,
      "rate_model=7700 kcal/kg"
    ].join("; ")
  };
}

export function WeightLossPlanDialog({
  open,
  onOpenChange,
  view,
  value,
  onChange,
  onSubmit,
  pending
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: WeightLossViewData;
  value: WeightLossPlanDraft;
  onChange: (value: WeightLossPlanDraft) => void;
  onSubmit: () => Promise<void>;
  pending: boolean;
}) {
  const plan = useMemo(() => calculatePlan(value), [value]);
  const steps: Array<QuestionFlowStep<WeightLossPlanDraft>> = [
    {
      id: "profile",
      eyebrow: "Current state",
      title: "Confirm the body data Forge knows",
      description: "These fields drive resting metabolism. Saved values are reused when Forge has them.",
      render: (draft, setDraft) => (
        <div className="grid gap-4 md:grid-cols-2">
          <FlowField label="Sex">
            <FlowChoiceGrid
              value={draft.sex}
              onChange={(sex) => setDraft({ sex: sex as Sex })}
              options={[
                { value: "male", label: "Male" },
                { value: "female", label: "Female" }
              ]}
            />
          </FlowField>
          <FlowField label="Age">
            <Input inputMode="numeric" value={draft.ageYears} onChange={(event) => setDraft({ ageYears: event.target.value })} placeholder="35" />
          </FlowField>
          <FlowField label="Height cm">
            <Input inputMode="decimal" value={draft.heightCm} onChange={(event) => setDraft({ heightCm: event.target.value })} placeholder="178" />
          </FlowField>
          <FlowField label="Current weight kg">
            <Input inputMode="decimal" value={draft.currentWeightKg} onChange={(event) => setDraft({ currentWeightKg: event.target.value })} placeholder="80.0" />
          </FlowField>
        </div>
      )
    },
    {
      id: "objective",
      eyebrow: "Goal",
      title: "Choose what should happen next",
      description: "Forge proposes a default target and weekly rate from current weight; you can change both.",
      render: (draft, setDraft) => (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <FlowChoiceGrid
              columns={3}
              value={draft.goalMode}
              onChange={(goalMode) =>
                setDraft(applyObjectiveDefaults(draft, goalMode as GoalMode))
              }
              options={[
                { value: "lose", label: "Lose fat", description: "Default: about 0.5% body weight per week." },
                { value: "gain", label: "Gain mass", description: "Default: small surplus around 0.25% per week." },
                { value: "maintain", label: "Maintain", description: "Hold weight while optimizing signals." }
              ]}
            />
          </div>
          <FlowField label="Target weight kg" hint="Auto-filled from the objective; change it anytime.">
            <Input inputMode="decimal" value={draft.goalWeightKg} onChange={(event) => setDraft({ goalWeightKg: event.target.value })} placeholder="75.0" />
          </FlowField>
          <FlowField label="Weekly change kg" hint="Loss/gain rate is converted to kcal/day with the 7700 kcal/kg planning model.">
            <Input inputMode="decimal" value={draft.weeklyRateKg} onChange={(event) => setDraft({ weeklyRateKg: event.target.value })} placeholder="0.35" />
          </FlowField>
        </div>
      )
    },
    {
      id: "activity",
      eyebrow: "Activity",
      title: "Add active burn to resting burn",
      description: "Active calories are independent evidence from HealthKit, workouts, and movement. The objective only changes the deficit or surplus.",
      render: (draft, setDraft) => (
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Resting calories/day" hint={`Forge uses HealthKit basal energy when present, otherwise Mifflin-St Jeor BMR. Current formula value: ${plan.bmr} kcal.`}>
              <Input inputMode="decimal" value={draft.restingCaloriesKcal} onChange={(event) => setDraft({ restingCaloriesKcal: event.target.value })} placeholder={String(plan.bmr)} />
            </FlowField>
            <FlowField label="Average active calories/day" hint={`Forge currently sees ${formatNumber(view.energyModel.movementCaloriesKcal)} movement kcal and ${formatNumber(view.energyModel.activeBurnKcal)} active burn kcal.`}>
              <Input inputMode="decimal" value={draft.activeCaloriesKcal} onChange={(event) => setDraft({ activeCaloriesKcal: event.target.value })} placeholder="350" />
            </FlowField>
          </div>
          <div className="grid gap-3 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 md:grid-cols-3">
            <SurfaceStat label={plan.restingSource} value={`${plan.restingCalories} kcal`} />
            <SurfaceStat label="Maintenance" value={`${plan.maintenanceCalories} kcal`} />
            <SurfaceStat label="Daily adjustment" value={`${plan.dailyEnergyAdjustment > 0 ? "+" : ""}${plan.dailyEnergyAdjustment} kcal`} />
          </div>
        </div>
      )
    },
    {
      id: "macros",
      eyebrow: "Macros",
      title: "Validate calories, macros, and limits",
      description: "Target intake equals resting burn plus active burn plus the objective adjustment. Macros are generated from protein-per-kg, fat floor, carb floor, fiber density, and dietary limits.",
      render: (draft, setDraft) => (
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
            <SurfaceStat label="Calories" value={`${plan.calorieTarget}`} />
            <SurfaceStat label="Protein" value={`${plan.proteinGramsTarget}g`} />
            <SurfaceStat label="Carbs" value={`${plan.carbohydrateGramsTarget}g`} />
            <SurfaceStat label="Fat" value={`${plan.fatGramsTarget}g`} />
            <SurfaceStat label="Fiber" value={`${plan.fiberGramsTarget}g`} />
            <SurfaceStat label="Sat fat max" value={`${plan.saturatedFatLimitGrams}g`} />
            <SurfaceStat label="Added sugar max" value={`${plan.addedSugarLimitGrams}g`} />
          </div>
          <FlowField label="Diet style or constraints">
            <Textarea value={draft.dietStyle} onChange={(event) => setDraft({ dietStyle: event.target.value })} placeholder="Mediterranean, high protein, no lactose, low FODMAP trial..." />
          </FlowField>
        </div>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Weight plan"
      title="Set weight objective"
      description="Build an editable calorie and macro plan."
      value={value}
      onChange={onChange}
      steps={steps}
      onSubmit={onSubmit}
      submitLabel="Save plan"
      pending={pending}
      pendingLabel="Saving plan"
      draftPersistenceKey="weight-loss-plan"
    />
  );
}
