import { useMemo } from "react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SurfaceStat } from "@/components/ui/surface";
import { Textarea } from "@/components/ui/textarea";
import type {
  NutritionTargetPatchInput,
  WeightLossViewData
} from "@/lib/weight-loss-types";
import {
  HALL_NIDDK_LINEAR_WEIGHT_MODEL,
  hallNiddkWeeklyRateKgToDailyEnergyAdjustment,
  staticKgRateToDailyEnergyAdjustment
} from "@/lib/weight-loss-energy-model";
import { formatNumber, numeric } from "./weight-loss-format";
import { WeightLossFormulaTooltip } from "./weight-loss-formula-tooltip";
import { buildNutritionTargetGroupsFromValues } from "./weight-loss-nutrition-targets";

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

function fiberDri(sex: Sex, ageYears: number) {
  return sex === "male" ? (ageYears >= 51 ? 30 : 38) : ageYears >= 51 ? 21 : 25;
}

function mifflinStJeorRestingKcal(input: {
  sex: Sex;
  ageYears: number | null;
  heightCm: number | null;
  weightKg: number | null;
}) {
  if (
    input.ageYears == null ||
    input.ageYears <= 0 ||
    input.heightCm == null ||
    input.heightCm <= 0 ||
    input.weightKg == null ||
    input.weightKg <= 0
  ) {
    return null;
  }
  const sexAdjustment = input.sex === "male" ? 5 : -161;
  return (
    10 * input.weightKg +
    6.25 * input.heightCm -
    5 * input.ageYears +
    sexAdjustment
  );
}

function weightAtBmi(heightCm: number, bmi: number) {
  const heightM = heightCm / 100;
  return heightM > 0 ? bmi * heightM * heightM : null;
}

function proteinReferenceWeightKg(input: {
  currentWeightKg: number;
  goalWeightKg: number | null;
  heightCm: number;
  goalMode: GoalMode;
}) {
  const objectiveReference =
    input.goalMode === "lose" && input.goalWeightKg != null
      ? Math.min(input.currentWeightKg, input.goalWeightKg)
      : input.currentWeightKg;
  const bmi30Weight = weightAtBmi(input.heightCm, 30);
  const bmi25Weight = weightAtBmi(input.heightCm, 25);
  if (
    bmi30Weight != null &&
    bmi25Weight != null &&
    input.currentWeightKg > bmi30Weight
  ) {
    const adjustedWeight =
      bmi25Weight + (input.currentWeightKg - bmi25Weight) * 0.25;
    return Math.min(objectiveReference, adjustedWeight);
  }
  return objectiveReference;
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

export function buildInitialPlanDraft(
  view: WeightLossViewData
): WeightLossPlanDraft {
  const latestWeight = numeric(view.weightTrend.latestWeightKg);
  const target = view.target;
  const savedSex = parsePlanNote(target.notes, "sex");
  const savedAge = parsePlanNote(target.notes, "age_years");
  const savedHeight = parsePlanNote(target.notes, "height_cm");
  const inferredActive =
    numeric(view.energyModel.activeBurnKcal) ??
    numeric(view.energyModel.activeEnergyCalories) ??
    numeric(view.energyModel.movementCaloriesKcal) ??
    positiveNumber(parsePlanNote(target.notes, "activity_kcal")) ??
    0;
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
    ageYears: positiveNumber(savedAge) ? String(savedAge) : "",
    heightCm: positiveNumber(savedHeight) ? String(savedHeight) : "",
    currentWeightKg: latestWeight ? latestWeight.toFixed(1) : "",
    goalWeightKg: targetWeight
      ? String(targetWeight)
      : formatKg(defaultGoalWeightKg(currentWeight, goalMode)),
    weeklyRateKg:
      target.weeklyRateGoalKg !== null && target.weeklyRateGoalKg !== undefined
        ? String(Math.abs(target.weeklyRateGoalKg))
        : defaultWeeklyRateKg(currentWeight, goalMode).toFixed(2),
    activeCaloriesKcal: inferredActive.toFixed(0),
    restingCaloriesKcal:
      numeric(view.energyModel.formulaRestingKcal) != null
        ? String(numeric(view.energyModel.formulaRestingKcal))
        : "",
    dietStyle: target.dietStyle ?? ""
  };
}

export function isWeightLossPlanConfigured(view: WeightLossViewData) {
  const hasAge =
    positiveNumber(parsePlanNote(view.target.notes, "age_years")) != null;
  const hasHeight =
    positiveNumber(parsePlanNote(view.target.notes, "height_cm")) != null;
  const hasWeight = numeric(view.weightTrend.latestWeightKg) != null;
  const hasGoal =
    typeof view.target.bodyGoal === "string" &&
    view.target.bodyGoal.trim().length > 0 &&
    view.target.calorieTarget > 0 &&
    view.target.proteinGramsTarget > 0;
  return hasAge && hasHeight && hasWeight && hasGoal;
}

function activeBurnEvidenceHint(view: WeightLossViewData) {
  const energy = view.energyModel;
  const source =
    energy.energySourceConfidence === "healthkit_daily_active_energy"
      ? "HealthKit daily active energy is the active-burn source; workout and movement values are only visible evidence and are not added again."
      : energy.energySourceConfidence === "workout_movement_fallback"
        ? "HealthKit daily active energy is missing, so active burn already equals workout average plus movement-trip average."
        : "No measured active-burn stream is available, so Forge is using the plan/default estimate.";
  return `This is the default active allowance used when today has no same-day workout, movement, step, or active-energy evidence. ${source} Current evidence: active burn ${formatNumber(energy.activeBurnKcal)} kcal/day, workout average ${formatNumber(energy.workoutEnergyKcal)} kcal/day, movement average ${formatNumber(energy.movementCaloriesKcal)} kcal/day, today's workout ${formatNumber(energy.todayWorkoutEnergyKcal)} kcal, today's movement ${formatNumber(energy.todayMovementCaloriesKcal)} kcal.`;
}

export function calculatePlan(draft: WeightLossPlanDraft) {
  const weight = Number(draft.currentWeightKg) || 80;
  const height = Number(draft.heightCm) || 178;
  const age = Number(draft.ageYears) || 35;
  const goalWeight = positiveNumber(draft.goalWeightKg);
  const activeCalories = Math.max(0, Number(draft.activeCaloriesKcal) || 0);
  const bmr =
    mifflinStJeorRestingKcal({
      sex: draft.sex,
      ageYears: age,
      heightCm: height,
      weightKg: weight
    }) ?? 10 * weight + 6.25 * height - 5 * age + 5;
  const restingCalories = bmr;
  const maintenanceCalories = restingCalories + activeCalories;
  const weeklyMagnitude = Math.abs(Number(draft.weeklyRateKg) || 0);
  const weeklyRateGoalKg =
    draft.goalMode === "lose"
      ? -weeklyMagnitude
      : draft.goalMode === "gain"
        ? weeklyMagnitude
        : 0;
  const dailyEnergyAdjustment =
    hallNiddkWeeklyRateKgToDailyEnergyAdjustment(weeklyRateGoalKg) ?? 0;
  const staticDailyEnergyAdjustment =
    staticKgRateToDailyEnergyAdjustment(weeklyRateGoalKg) ?? 0;
  const minimumCalorieFloor = draft.sex === "male" ? 1500 : 1200;
  const plannedCalorieTarget = Math.round(
    maintenanceCalories + dailyEnergyAdjustment
  );
  const calorieTarget = Math.max(minimumCalorieFloor, plannedCalorieTarget);
  const proteinReferenceWeight = proteinReferenceWeightKg({
    currentWeightKg: weight,
    goalWeightKg: goalWeight,
    heightCm: height,
    goalMode: draft.goalMode
  });
  const proteinFactor =
    draft.goalMode === "lose" ? 2 : draft.goalMode === "gain" ? 1.8 : 1.6;
  const idealProteinGrams = Math.round(proteinReferenceWeight * proteinFactor);
  const maxProteinGrams = Math.floor((calorieTarget * 0.45) / 4);
  const proteinGramsTarget = Math.max(
    1,
    Math.min(idealProteinGrams, maxProteinGrams)
  );
  const fatFloorGrams = proteinReferenceWeight * 0.6;
  const amdrFatTargetGrams = (calorieTarget * 0.25) / 9;
  const maxFatForTarget = Math.max(
    0,
    (calorieTarget - proteinGramsTarget * 4) / 9
  );
  const fatGramsTarget = Math.max(
    0,
    Math.floor(
      Math.min(
        maxFatForTarget,
        (calorieTarget * 0.35) / 9,
        Math.max(fatFloorGrams, amdrFatTargetGrams)
      )
    )
  );
  const carbohydrateGramsTarget = Math.max(
    0,
    Math.floor(
      (calorieTarget - proteinGramsTarget * 4 - fatGramsTarget * 9) / 4
    )
  );
  const fiberEnergyAdjustedGrams = Math.round((calorieTarget / 1000) * 14);
  const fiberDriGrams = fiberDri(draft.sex, age);
  const fiberGramsTarget = fiberEnergyAdjustedGrams;
  const saturatedFatLimitGrams = Math.round((calorieTarget * 0.1) / 9);
  const addedSugarLimitGrams = Math.round((calorieTarget * 0.1) / 4);
  return {
    bmr: Math.round(bmr),
    restingCalories: Math.round(restingCalories),
    restingSource: "Mifflin-St Jeor baseline",
    activeCalories: Math.round(activeCalories),
    maintenanceCalories: Math.round(maintenanceCalories),
    plannedCalorieTarget,
    minimumCalorieFloor,
    weeklyRateGoalKg,
    dailyEnergyAdjustment: Math.round(dailyEnergyAdjustment),
    staticDailyEnergyAdjustment: Math.round(staticDailyEnergyAdjustment),
    rateModel: HALL_NIDDK_LINEAR_WEIGHT_MODEL.id,
    rateModelLabel: HALL_NIDDK_LINEAR_WEIGHT_MODEL.label,
    rateModelPlanningHorizonDays:
      HALL_NIDDK_LINEAR_WEIGHT_MODEL.defaultPlanningHorizonDays,
    calorieTarget,
    proteinReferenceWeight: Math.round(proteinReferenceWeight * 10) / 10,
    proteinGramsTarget,
    carbohydrateGramsTarget,
    fatGramsTarget,
    fiberGramsTarget,
    fiberEnergyAdjustedGrams,
    fiberDriGrams,
    saturatedFatLimitGrams,
    addedSugarLimitGrams
  };
}

export function validateWeightLossPlanDraft(draft: WeightLossPlanDraft) {
  const errors: string[] = [];
  const age = Number(draft.ageYears);
  const height = Number(draft.heightCm);
  const currentWeight = Number(draft.currentWeightKg);
  const goalWeight = Number(draft.goalWeightKg);
  const weeklyRate = Number(draft.weeklyRateKg);
  const activeCalories = draft.activeCaloriesKcal.trim()
    ? Number(draft.activeCaloriesKcal)
    : Number.NaN;
  const restingCalories = draft.restingCaloriesKcal.trim()
    ? Number(draft.restingCaloriesKcal)
    : null;

  if (!Number.isFinite(age) || age < 13 || age > 100) {
    errors.push(
      "- Enter the user's real age. Forge uses it in Mifflin-St Jeor resting metabolism."
    );
  }
  if (!Number.isFinite(height) || height < 120 || height > 230) {
    errors.push(
      "- Enter height in cm. Height changes BMR and protein reference weight."
    );
  }
  if (
    !Number.isFinite(currentWeight) ||
    currentWeight < 30 ||
    currentWeight > 300
  ) {
    errors.push(
      "- Enter current weight in kg. Use the latest known body measure as the starting state."
    );
  }
  if (
    draft.goalMode !== "maintain" &&
    (!Number.isFinite(goalWeight) || goalWeight < 30 || goalWeight > 300)
  ) {
    errors.push(
      "- Enter a target weight for the selected loss or gain objective."
    );
  }
  if (!Number.isFinite(weeklyRate) || weeklyRate < 0) {
    errors.push("- Enter a non-negative weekly change rate in kg/week.");
  }
  if (
    Number.isFinite(weeklyRate) &&
    weeklyRate > Math.max(1.5, currentWeight * 0.02)
  ) {
    errors.push(
      "- The weekly rate is very aggressive. Choose a slower default unless this is a supervised plan."
    );
  }
  if (
    !Number.isFinite(activeCalories) ||
    activeCalories < 0 ||
    activeCalories > 3000
  ) {
    errors.push(
      "- Enter average active calories per day. Zero is valid only when Forge has no activity evidence."
    );
  }
  if (
    restingCalories != null &&
    (!Number.isFinite(restingCalories) ||
      restingCalories < 900 ||
      restingCalories > 3500)
  ) {
    errors.push(
      "- Formula resting baseline should stay in a plausible daily range."
    );
  }

  return errors.length > 0 ? errors.join("\n") : null;
}

export function buildTargetPatchFromPlan(
  draft: WeightLossPlanDraft
): NutritionTargetPatchInput {
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
      "eat_back_fraction=0.5",
      `maintenance_kcal=${plan.maintenanceCalories}`,
      `rate_model=${plan.rateModel}`,
      `rate_model_horizon_days=${plan.rateModelPlanningHorizonDays}`,
      `static_7700_adjustment_kcal=${plan.staticDailyEnergyAdjustment}`
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
  pending,
  error
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: WeightLossViewData;
  value: WeightLossPlanDraft;
  onChange: (value: WeightLossPlanDraft) => void;
  onSubmit: () => Promise<void>;
  pending: boolean;
  error?: string | null;
}) {
  const plan = useMemo(() => calculatePlan(value), [value]);
  const hasFormulaProfile =
    positiveNumber(value.ageYears) != null &&
    positiveNumber(value.heightCm) != null &&
    positiveNumber(value.currentWeightKg) != null;
  const formulaRestingValue = hasFormulaProfile ? String(plan.bmr) : "";
  const formulaRestingHint = hasFormulaProfile
    ? `Forge uses Mifflin-St Jeor as the stable target baseline. Complete HealthKit basal energy stays evidence/calibration, not the silent default. Current formula value: ${plan.bmr} kcal.`
    : "Forge will calculate this from real age, height, sex, and current weight. Complete HealthKit basal energy stays evidence/calibration, not the silent default.";
  const nutritionPreview = useMemo(
    () =>
      buildNutritionTargetGroupsFromValues({
        sex: value.sex,
        ageYears: Number(value.ageYears) || 35,
        currentWeightKg: Number(value.currentWeightKg) || 80,
        calorieTarget: plan.calorieTarget,
        proteinGramsTarget: plan.proteinGramsTarget,
        carbohydrateGramsTarget: plan.carbohydrateGramsTarget,
        fatGramsTarget: plan.fatGramsTarget,
        fiberGramsTarget: plan.fiberGramsTarget,
        activeBurnKcal: plan.activeCalories,
        movementCaloriesKcal: numeric(view.energyModel.movementCaloriesKcal),
        restingEnergyKcal: plan.restingCalories
      }),
    [plan, value, view.energyModel.movementCaloriesKcal]
  );
  const steps: Array<QuestionFlowStep<WeightLossPlanDraft>> = [
    {
      id: "profile",
      eyebrow: "Current state",
      title: "Confirm the body data Forge knows",
      description:
        "These fields drive resting metabolism. Saved values are reused when Forge has them.",
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
            <Input
              inputMode="numeric"
              value={draft.ageYears}
              onChange={(event) => setDraft({ ageYears: event.target.value })}
              placeholder="35"
            />
          </FlowField>
          <FlowField label="Height cm">
            <Input
              inputMode="decimal"
              value={draft.heightCm}
              onChange={(event) => setDraft({ heightCm: event.target.value })}
              placeholder="178"
            />
          </FlowField>
          <FlowField label="Current weight kg">
            <Input
              inputMode="decimal"
              value={draft.currentWeightKg}
              onChange={(event) =>
                setDraft({ currentWeightKg: event.target.value })
              }
              placeholder="80.0"
            />
          </FlowField>
        </div>
      )
    },
    {
      id: "objective",
      eyebrow: "Goal",
      title: "Choose what should happen next",
      description:
        "Forge proposes a default target and weekly rate from current weight; you can change both.",
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
                {
                  value: "lose",
                  label: "Lose fat",
                  description: "Default: about 0.5% body weight per week."
                },
                {
                  value: "gain",
                  label: "Gain mass",
                  description: "Default: small surplus around 0.25% per week."
                },
                {
                  value: "maintain",
                  label: "Maintain",
                  description: "Hold weight while optimizing signals."
                }
              ]}
            />
          </div>
          <FlowField
            label="Target weight kg"
            hint="Filled from the objective; change it anytime."
          >
            <Input
              inputMode="decimal"
              value={draft.goalWeightKg}
              onChange={(event) =>
                setDraft({ goalWeightKg: event.target.value })
              }
              placeholder="75.0"
            />
          </FlowField>
          <FlowField
            label="Weekly change kg"
            hint="Loss/gain rate is converted to kcal/day with the Hall/NIDDK adult dynamic model over Forge's 12-week planning horizon."
          >
            <Input
              inputMode="decimal"
              value={draft.weeklyRateKg}
              onChange={(event) =>
                setDraft({ weeklyRateKg: event.target.value })
              }
              placeholder="0.35"
            />
          </FlowField>
        </div>
      )
    },
    {
      id: "activity",
      eyebrow: "Activity",
      title: "Add active burn to resting burn",
      description:
        "Active calories are independent evidence from HealthKit, workouts, and movement. The objective only changes the deficit or surplus.",
      render: (draft, setDraft) => (
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField
              label="Formula resting baseline/day"
              hint={formulaRestingHint}
            >
              <Input
                inputMode="decimal"
                value={formulaRestingValue}
                readOnly
                placeholder="Calculated from profile"
              />
            </FlowField>
            <FlowField
              label="Average active calories/day"
              hint={activeBurnEvidenceHint(view)}
            >
              <Input
                inputMode="decimal"
                value={draft.activeCaloriesKcal}
                onChange={(event) =>
                  setDraft({ activeCaloriesKcal: event.target.value })
                }
                placeholder="350"
              />
            </FlowField>
          </div>
          <div className="grid gap-3 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 md:grid-cols-3">
            <SurfaceStat
              label={plan.restingSource}
              value={`${plan.restingCalories} kcal`}
            />
            <SurfaceStat
              label="Maintenance"
              value={`${plan.maintenanceCalories} kcal`}
            />
            <SurfaceStat
              label="Daily adjustment"
              value={`${plan.dailyEnergyAdjustment > 0 ? "+" : ""}${plan.dailyEnergyAdjustment} kcal`}
            />
          </div>
        </div>
      )
    },
    {
      id: "macros",
      eyebrow: "Macros",
      title: "Validate calories, macros, and limits",
      description:
        "Target intake equals resting burn plus active burn plus the objective adjustment. Macros are generated from protein-per-kg, a practical fat floor, remaining carbohydrates, fiber density, and dietary limits.",
      render: (draft, setDraft) => (
        <div className="grid gap-4">
          <div className="flex items-start justify-between gap-3 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3">
            <div className="min-w-0 text-sm leading-6 text-[var(--ui-ink-muted)]">
              Inspect the exact math behind the current calories, macro targets,
              and sport-loss preview.
            </div>
            <WeightLossFormulaTooltip
              values={{
                sex: draft.sex,
                ageYears: Number(draft.ageYears) || null,
                currentWeightKg: Number(draft.currentWeightKg) || null,
                heightCm: Number(draft.heightCm) || null,
                bmrKcal: plan.bmr,
                restingKcal: plan.restingCalories,
                restingSource: plan.restingSource,
                activeKcal: plan.activeCalories,
                maintenanceKcal: plan.maintenanceCalories,
                weeklyRateKg: plan.weeklyRateGoalKg,
                dailyAdjustmentKcal: plan.dailyEnergyAdjustment,
                rateModel: plan.rateModelLabel,
                rateModelHorizonDays: plan.rateModelPlanningHorizonDays,
                calorieTarget: plan.calorieTarget,
                calorieFloor: plan.minimumCalorieFloor,
                proteinReferenceWeightKg: plan.proteinReferenceWeight,
                proteinFactor:
                  draft.goalMode === "lose"
                    ? 2
                    : draft.goalMode === "gain"
                      ? 1.8
                      : 1.6,
                proteinGrams: plan.proteinGramsTarget,
                fatGrams: plan.fatGramsTarget,
                carbohydrateGrams: plan.carbohydrateGramsTarget,
                fiberGrams: plan.fiberGramsTarget,
                fiberEnergyAdjustedGrams: plan.fiberEnergyAdjustedGrams,
                fiberDriGrams: plan.fiberDriGrams
              }}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
            <SurfaceStat label="Calories" value={`${plan.calorieTarget}`} />
            <SurfaceStat
              label="Protein"
              value={`${plan.proteinGramsTarget}g`}
            />
            <SurfaceStat
              label="Carbs"
              value={`${plan.carbohydrateGramsTarget}g`}
            />
            <SurfaceStat label="Fat" value={`${plan.fatGramsTarget}g`} />
            <SurfaceStat label="Fiber" value={`${plan.fiberGramsTarget}g`} />
            <SurfaceStat
              label="Sat fat max"
              value={`${plan.saturatedFatLimitGrams}g`}
            />
            <SurfaceStat
              label="Added sugar max"
              value={`${plan.addedSugarLimitGrams}g`}
            />
          </div>
          <div className="grid gap-4 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--ui-ink)]">
                  Micronutrient and sport-loss preview
                </div>
                <div className="mt-1 text-sm leading-6 text-[var(--ui-ink-muted)]">
                  The dashboard will track vitamin, mineral, trace-element,
                  water, sodium-ceiling, essential-fat, and sport-loss targets
                  from this plan.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="meta">
                  {nutritionPreview.vitamins.length} vitamins
                </Badge>
                <Badge tone="meta">
                  {nutritionPreview.minerals.length} minerals
                </Badge>
                <Badge tone="signal">
                  {nutritionPreview.sportSummary.fluidLossLiters} L sweat
                </Badge>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <SurfaceStat
                label="Sport sodium loss"
                value={`${nutritionPreview.sportSummary.sodiumLossMg} mg`}
              />
              <SurfaceStat
                label="Sport potassium loss"
                value={`${nutritionPreview.sportSummary.potassiumLossMg} mg`}
              />
              <SurfaceStat
                label="Water baseline"
                value={value.sex === "male" ? "3.7 L" : "2.7 L"}
              />
              <SurfaceStat
                label="Essential fats"
                value={
                  value.sex === "male"
                    ? "17g LA / 1.6g ALA"
                    : "12g LA / 1.1g ALA"
                }
              />
            </div>
          </div>
          <FlowField label="Diet style or constraints">
            <Textarea
              value={draft.dietStyle}
              onChange={(event) => setDraft({ dietStyle: event.target.value })}
              placeholder="Mediterranean, high protein, no lactose, low FODMAP trial..."
            />
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
      error={error}
      draftPersistenceKey="weight-loss-plan"
    />
  );
}
