import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Beef,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Gauge,
  Utensils,
  Waves
} from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { WeightLossActionPanel } from "@/components/weight-loss/weight-loss-action-panel";
import { WeightLossActiveCaloriesMiniCard } from "@/components/weight-loss/weight-loss-active-calories-panel";
import { WeightLossInsightMetric } from "@/components/weight-loss/weight-loss-cards";
import { WeightLossLedgerPanel } from "@/components/weight-loss/weight-loss-food-panels";
import {
  WeightLossDataQualityPanel,
  WeightLossExperimentsPanel,
  WeightLossHypothesesPanel
} from "@/components/weight-loss/weight-loss-insights";
import { WeightLossNutritionTargetsPanel } from "@/components/weight-loss/weight-loss-nutrition-targets-panel";
import {
  buildCheckinPayloads,
  buildFoodDraftFromInput,
  buildFoodDraftFromLog,
  buildFoodLogInput,
  buildFoodLogPatchInput,
  buildInitialCustomFoodDraft,
  buildInitialCheckinDraft,
  buildInitialFoodDraft,
  buildInitialPlanDraft,
  buildTargetPatchFromPlan,
  isWeightLossPlanConfigured,
  validateWeightLossPlanDraft,
  WeightLossCheckinDialog,
  WeightLossFoodLogDialog,
  WeightLossHistoryDialog,
  WeightLossPlanDialog,
  type WeightLossCheckinDraft,
  type WeightLossFoodDraft,
  type WeightLossFoodLogIntent,
  type WeightLossPlanDraft
} from "@/components/weight-loss/weight-loss-dialogs";
import {
  formatNumber,
  formatSigned,
  insightArray,
  scoreLabel
} from "@/components/weight-loss/weight-loss-format";
import { formatLocalDateKey, getRuntimeTimeZone } from "@/lib/date-keys";
import {
  createNutritionAppearanceCheckin,
  createNutritionBodyCheckin,
  createNutritionFoodLog,
  createNutritionGutCheckin,
  createNutritionSubjectiveCheckin,
  deleteNutritionFoodLog,
  getWeightLossView,
  patchNutritionFoodLog,
  parseNutritionFoodLogWithChatGpt,
  searchNutritionFoods,
  updateNutritionDailyActiveCalories,
  updateNutritionTarget
} from "@/lib/api";
import type {
  NutritionFoodLog,
  WeightLossViewData
} from "@/lib/weight-loss-types";

function sourceConfidenceLabel(source: string) {
  switch (source) {
    case "healthkit_daily_active_energy":
      return "HealthKit daily active energy";
    case "workout_movement_fallback":
      return "workout + movement fallback";
    case "target_inference_only":
      return "plan target inference";
    default:
      return source || "unknown source";
  }
}

function sourceAvailabilityText(view: WeightLossViewData) {
  const energy = view.energyModel;
  const availability = energy.sourceAvailability;
  const sources = [
    availability.healthKitDailyEnergy ? "HealthKit active energy" : null,
    energy.formulaRestingKcal != null ? "formula resting baseline" : null,
    energy.wearableRestingKcal != null
      ? "complete-day HealthKit resting evidence"
      : null,
    availability.workoutEnergy ? "workout energy" : null,
    availability.movementTripCalories ? "movement-trip calories" : null
  ].filter(Boolean);
  return sources.length > 0
    ? sources.join(", ")
    : "no measured expenditure streams";
}

function energyGapDetail(view: WeightLossViewData) {
  const energy = view.energyModel;
  const intakeWindow =
    energy.recentFoodLogDayCount > 0
      ? `${energy.recentFoodLogCount} recent food log${energy.recentFoodLogCount === 1 ? "" : "s"} across ${energy.recentFoodLogDayCount} logged day${energy.recentFoodLogDayCount === 1 ? "" : "s"}`
      : "no recent logged food days";
  if (energy.estimatedTdeeKcal == null) {
    return `No TDEE estimate yet. Average logged intake is ${formatNumber(energy.averageCalorieIntake)} kcal/day from ${intakeWindow}.`;
  }
  const formula = `Recent average balance: intake ${formatNumber(energy.averageCalorieIntake)} - TDEE ${formatNumber(energy.estimatedTdeeKcal)} = ${formatSigned(energy.estimatedDailyEnergyBalanceKcal)} kcal/day.`;
  const tdeeSource =
    energy.restingEnergyCalories != null && energy.activeBurnKcal != null
      ? `TDEE = formula resting baseline ${formatNumber(energy.restingEnergyCalories)} + active burn ${formatNumber(energy.activeBurnKcal)}.`
      : `TDEE is falling back to the configured plan estimate ${formatNumber(energy.inferredTdee)}.`;
  const activeBurnBreakdown =
    energy.energySourceConfidence === "healthkit_daily_active_energy"
      ? `Active burn uses HealthKit daily active energy ${formatNumber(energy.activeBurnKcal)}; workout and movement are evidence only.`
      : energy.energySourceConfidence === "workout_movement_fallback"
        ? `Active burn fallback = workout ${formatNumber(energy.workoutEnergyKcal)} + movement ${formatNumber(energy.movementCaloriesKcal)} = ${formatNumber(energy.activeBurnKcal)}, so movement is not added again.`
        : "Active burn is not measured yet.";
  return `${formula} ${tdeeSource} ${activeBurnBreakdown} Food window: ${intakeWindow}. Negative means estimated deficit; this is not today's remaining calories.`;
}

function energyGapHelp(view: WeightLossViewData) {
  const energy = view.energyModel;
  const hasMeasuredTdee =
    energy.restingEnergyCalories != null && energy.activeBurnKcal != null;
  const selectedDate = view.todayLedger.dateKey;
  const foodWindow =
    energy.recentFoodLogDayCount > 0
      ? `${energy.recentFoodLogCount} recent food log${energy.recentFoodLogCount === 1 ? "" : "s"} across ${energy.recentFoodLogDayCount} distinct logged day${energy.recentFoodLogDayCount === 1 ? "" : "s"}`
      : "no recent logged food days";
  const activeBurnFormula =
    energy.energySourceConfidence === "healthkit_daily_active_energy"
      ? `active burn = HealthKit daily active energy average = ${formatNumber(energy.activeBurnKcal)} kcal/day`
      : energy.energySourceConfidence === "workout_movement_fallback"
        ? `active burn = workout average ${formatNumber(energy.workoutEnergyKcal)} + movement-trip average ${formatNumber(energy.movementCaloriesKcal)} = ${formatNumber(energy.activeBurnKcal)} kcal/day`
        : `active burn is not measured; Forge falls back to plan inference`;
  const tdeeFormula =
    energy.restingEnergyCalories != null && energy.activeBurnKcal != null
      ? `TDEE = formula resting baseline ${formatNumber(energy.restingEnergyCalories)} + active burn average ${formatNumber(energy.activeBurnKcal)} = ${formatNumber(energy.estimatedTdeeKcal)} kcal/day.`
      : `TDEE = ${formatNumber(energy.estimatedTdeeKcal)} kcal/day from the configured plan because complete resting + active energy is not available.`;
  const gapFormula =
    energy.estimatedTdeeKcal != null
      ? `Energy gap = average logged intake - TDEE = ${formatNumber(energy.averageCalorieIntake)} - ${formatNumber(energy.estimatedTdeeKcal)} = ${formatSigned(energy.estimatedDailyEnergyBalanceKcal)} kcal/day.`
      : `Energy gap cannot be computed until Forge has either measured expenditure or an inferred TDEE.`;
  const activeBranchFormula =
    energy.energySourceConfidence === "healthkit_daily_active_energy"
      ? `selected active burn = HealthKit daily active energy average = ${formatNumber(energy.activeBurnKcal)} kcal/day. Workout and movement are visible as evidence but are not added.`
      : energy.energySourceConfidence === "workout_movement_fallback"
        ? `selected active burn = workout average ${formatNumber(energy.workoutEnergyKcal)} + movement-trip average ${formatNumber(energy.movementCaloriesKcal)} = ${formatNumber(energy.activeBurnKcal)} kcal/day. This is why movement can appear next to active burn: it is a component of active burn here, not a separate add-on.`
        : `selected active burn is unavailable, so TDEE falls back to the configured plan estimate.`;
  const arithmeticFormula =
    energy.restingEnergyCalories != null &&
    energy.activeBurnKcal != null &&
    energy.estimatedTdeeKcal != null
      ? energy.energySourceConfidence === "healthkit_daily_active_energy"
        ? `Arithmetic shown here: active burn ${formatNumber(energy.activeBurnKcal)} = HealthKit daily active energy average; TDEE ${formatNumber(energy.estimatedTdeeKcal)} = formula resting baseline ${formatNumber(energy.restingEnergyCalories)} + active burn ${formatNumber(energy.activeBurnKcal)}; energy gap ${formatSigned(energy.estimatedDailyEnergyBalanceKcal)} = intake ${formatNumber(energy.averageCalorieIntake)} - TDEE ${formatNumber(energy.estimatedTdeeKcal)}.`
        : energy.energySourceConfidence === "workout_movement_fallback"
          ? `Arithmetic shown here: active burn ${formatNumber(energy.activeBurnKcal)} = workout ${formatNumber(energy.workoutEnergyKcal)} + movement ${formatNumber(energy.movementCaloriesKcal)}; TDEE ${formatNumber(energy.estimatedTdeeKcal)} = formula resting baseline ${formatNumber(energy.restingEnergyCalories)} + active burn ${formatNumber(energy.activeBurnKcal)}; energy gap ${formatSigned(energy.estimatedDailyEnergyBalanceKcal)} = intake ${formatNumber(energy.averageCalorieIntake)} - TDEE ${formatNumber(energy.estimatedTdeeKcal)}.`
          : `Arithmetic shown here: TDEE ${formatNumber(energy.estimatedTdeeKcal)} = formula resting baseline ${formatNumber(energy.restingEnergyCalories)} + active burn ${formatNumber(energy.activeBurnKcal)}; energy gap ${formatSigned(energy.estimatedDailyEnergyBalanceKcal)} = intake ${formatNumber(energy.averageCalorieIntake)} - TDEE ${formatNumber(energy.estimatedTdeeKcal)}.`
      : `Arithmetic shown here uses the available expenditure branch; some terms are unavailable because Forge does not yet have both resting and active energy evidence.`;
  const intakeFormula =
    energy.recentFoodLogDayCount > 0
      ? `Average intake = total calories in the latest ${energy.recentFoodLogCount} non-discarded food log${energy.recentFoodLogCount === 1 ? "" : "s"} / ${energy.recentFoodLogDayCount} logged day${energy.recentFoodLogDayCount === 1 ? "" : "s"}. It does not divide by silent calendar days.`
      : "Average logged intake is 0 because there are no recent food logs in the current window.";
  const sourcePriority =
    energy.energySourceConfidence === "healthkit_daily_active_energy"
      ? "Active burn is using HealthKit daily active energy first. Workout and movement values remain visible as evidence, but movement is not added again on top of HealthKit active energy."
      : energy.energySourceConfidence === "workout_movement_fallback"
        ? "HealthKit daily active energy is missing, so active burn falls back to workout energy plus movement-trip calories."
        : "No measured active-burn stream is available, so this is driven by the plan target and should be treated as low-confidence.";
  const todayTargetFormula = `Today is separate: today's target = baseline plan target plus the day-specific active adjustment. Today active evidence currently uses ${activeCaloriesSourceLabel(energy.todayActiveCaloriesSource)}: ${formatNumber(energy.todayActiveCaloriesKcal)} kcal. Default active calories: ${formatNumber(energy.baselineActiveCaloriesKcal)} kcal. Eat-back fraction ${formatNumber(energy.activityEatBackFraction * 100, 0)}%; target adjustment ${formatSigned(energy.todayTargetAdjustmentKcal)} kcal. Automatic low or early same-day activity cannot reduce the target; a manual override can raise or lower it for this date.`;
  const dataLineage =
    energy.energySourceConfidence === "healthkit_daily_active_energy"
      ? "Data path: recent food logs provide intake; HealthKit daily active-energy rows provide active burn; Mifflin-St Jeor provides the stable resting baseline. Complete HealthKit basal rows are shown as calibration evidence."
      : energy.energySourceConfidence === "workout_movement_fallback"
        ? "Data path: recent food logs provide intake; Mifflin-St Jeor provides the stable resting baseline; workout-session energy plus movement-trip calories provide fallback active burn."
        : "Data path: recent food logs provide intake; expenditure is using the configured plan inference because measured expenditure streams are incomplete.";
  return (
    <span className="grid gap-2">
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">
          What this card means:
        </span>{" "}
        this is a historical energy-balance estimate, not the remaining food
        budget for today. Negative means estimated deficit; positive means
        estimated surplus.
      </span>
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">
          Formula:
        </span>{" "}
        {gapFormula}
      </span>
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">TDEE:</span>{" "}
        TDEE means total daily energy expenditure: the estimated calories burned
        per day. Forge uses{" "}
        {hasMeasuredTdee
          ? "the formula resting baseline plus the selected active-burn branch"
          : "the configured/inferred plan estimate because formula resting plus active expenditure is incomplete"}
        . Objective deficit or surplus is not subtracted here; that belongs to
        the intake target.
      </span>
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">
          Selected branch:
        </span>{" "}
        {energy.energySourceConfidence === "healthkit_daily_active_energy"
          ? "HealthKit daily active energy exists, so active burn uses that value. Workout, movement, and step values are shown only as evidence."
          : energy.energySourceConfidence === "workout_movement_fallback"
            ? "HealthKit daily active energy is missing, so active burn uses workout calories plus movement-trip calories."
            : "Measured expenditure is incomplete, so TDEE falls back to the configured plan estimate."}
      </span>
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">
          Active-burn branch:
        </span>{" "}
        {activeBranchFormula}
      </span>
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">
          Arithmetic:
        </span>{" "}
        {arithmeticFormula}
      </span>
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">
          Why these numbers:
        </span>{" "}
        The displayed movement value is therefore{" "}
        {energy.energySourceConfidence === "workout_movement_fallback"
          ? "part of the active-burn calculation"
          : "supporting evidence only"}
        , and it is not the same thing as today's editable active-calorie
        budget.
      </span>
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">
          Current data:
        </span>{" "}
        intake {formatNumber(energy.averageCalorieIntake)} kcal/day; TDEE{" "}
        {formatNumber(energy.estimatedTdeeKcal)} kcal/day; formula resting{" "}
        {formatNumber(energy.restingEnergyCalories)} kcal/day; active burn{" "}
        {formatNumber(energy.activeBurnKcal)} kcal/day; workout{" "}
        {formatNumber(energy.workoutEnergyKcal)} kcal/day; movement{" "}
        {formatNumber(energy.movementCaloriesKcal)} kcal/day.{" "}
        {energy.energySourceConfidence === "workout_movement_fallback"
          ? "On this branch, active burn already equals workout plus movement, so movement is not an extra add-on after active burn."
          : "On this branch, movement is shown as evidence and is not added on top of active burn."}
      </span>
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">
          Data lineage:
        </span>{" "}
        {dataLineage}
      </span>
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">
          Food window:
        </span>{" "}
        {intakeFormula} Current denominator: {foodWindow}.
      </span>
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">
          Expenditure:
        </span>{" "}
        {tdeeFormula} {activeBurnFormula}. TDEE means total daily energy
        expenditure, the estimated calories burned per day before applying the
        weight-loss or weight-gain objective.
      </span>
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">
          TDEE source:
        </span>{" "}
        {hasMeasuredTdee
          ? "formula resting baseline plus selected active-burn branch"
          : "plan-inference branch because Forge does not yet have both resting and active expenditure streams"}
        . TDEE is an expenditure estimate; the goal deficit or surplus is
        applied when planning intake targets, not when calculating historical
        TDEE.
      </span>
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">
          Calculation path:
        </span>{" "}
        Forge first tries HealthKit daily active energy for active burn. If that
        is missing, it uses workout energy plus movement-trip calories. TDEE is
        resting energy plus whichever active-burn branch was selected. The
        objective deficit or surplus is not part of this historical TDEE.
      </span>
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">
          Source:
        </span>{" "}
        {sourceConfidenceLabel(energy.energySourceConfidence)} across{" "}
        {energy.evidenceDays} expenditure evidence day
        {energy.evidenceDays === 1 ? "" : "s"} ending the selected day (
        {selectedDate}). Available streams: {sourceAvailabilityText(view)}.{" "}
        {sourcePriority}
      </span>
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">
          Movement:
        </span>{" "}
        movement kcal is a component of fallback active burn. If HealthKit daily
        active energy exists, Forge shows movement as supporting evidence but
        does not add it again. If HealthKit active energy is missing, fallback
        active burn is workout average + movement average; the displayed active
        burn number already includes that movement component.
      </span>
      <span>
        <span className="font-semibold text-[var(--ui-ink-strong)]">
          Today:
        </span>{" "}
        {todayTargetFormula}
      </span>
    </span>
  );
}

function energyGapValue(value: unknown) {
  const formatted = formatSigned(value);
  return formatted === "n/a" ? formatted : `${formatted} kcal/d`;
}

function activeCaloriesSourceLabel(source: string) {
  switch (source) {
    case "today_workout_energy":
      return "today's workout energy";
    case "today_healthkit_active_energy":
      return "today's HealthKit active energy";
    case "today_workout_movement_energy":
      return "today's workout and movement energy";
    case "today_workout_movement_step_energy":
      return "today's workout, movement, and step energy";
    case "today_workout_step_energy":
      return "today's workout and step energy";
    case "today_movement_step_energy":
      return "today's movement and step energy";
    case "today_movement_trip_calories":
      return "today's movement trip calories";
    case "today_step_estimate":
      return "today's estimated step calories";
    case "user_override":
      return "your manual active-calorie override";
    default:
      return "the default daily active calories";
  }
}

function formatSignedKcal(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(0)} kcal`;
}

function remainingCaloriesText(value: number) {
  return value >= 0
    ? `${value.toFixed(0)} kcal left`
    : `${Math.abs(value).toFixed(0)} kcal over`;
}

function normalizeKcalDraft(value: string) {
  return value.trim() === "" ? "0" : value;
}

function applyManualActiveCaloriesToView(
  current: WeightLossViewData,
  activeCaloriesKcal: number,
  override: WeightLossViewData["energyModel"]["todayActiveOverride"]
): WeightLossViewData {
  const baseline =
    current.energyModel.baselineActiveCaloriesKcal ??
    current.energyModel.todayActiveCaloriesKcal ??
    0;
  const activityEatBackFraction =
    current.energyModel.activityEatBackFraction ?? 0;
  const activeDelta = activeCaloriesKcal - baseline;
  const targetAdjustment = Math.round(activeDelta * activityEatBackFraction);
  const previousTargetAdjustment =
    current.energyModel.todayTargetAdjustmentKcal ?? 0;
  const plannedTarget =
    current.todayLedger.plannedTargetCalories ??
    current.todayLedger.targetCalories - previousTargetAdjustment;
  const targetCalories = Math.max(
    0,
    Math.round(plannedTarget + targetAdjustment)
  );
  const calorieDelta = Math.round(
    current.todayLedger.totals.calories - targetCalories
  );
  const remainingCalories = Math.round(
    targetCalories - current.todayLedger.totals.calories
  );
  const activeSurplus = Math.max(0, activeDelta);
  const activityBuffer = Math.round(activeSurplus * activityEatBackFraction);

  return {
    ...current,
    summary: {
      ...current.summary,
      targetCalories,
      todayCalorieDelta: calorieDelta,
      remainingCalories
    },
    todayLedger: {
      ...current.todayLedger,
      plannedTargetCalories: plannedTarget,
      targetCalories,
      activeAdjustmentCalories: targetAdjustment,
      activeCaloriesSource: "user_override",
      calorieDelta,
      remainingCalories
    },
    energyModel: {
      ...current.energyModel,
      todayActiveCaloriesKcal: activeCaloriesKcal,
      todayActiveCaloriesSource: "user_override",
      todayTargetAdjustmentKcal: targetAdjustment,
      todayActiveDeltaKcal: Math.round(activeDelta),
      todayActiveSurplusKcal: Math.round(activeSurplus),
      todayActivityBufferKcal: activityBuffer,
      todayActiveOverride: override
    }
  };
}

function getLocalDayBounds(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 1);
  return {
    dayStartAt: start.toISOString(),
    dayEndAt: end.toISOString()
  };
}

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return formatLocalDateKey(new Date(year, month - 1, day + days));
}

function formatDayHeading(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(new Date(year, month - 1, day, 12));
}

function millisecondsUntilNextLocalDay() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 2, 0);
  return Math.max(1_000, next.getTime() - now.getTime());
}

export function WeightLossPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const selectedUserIds = shell.selectedUserIds;
  const runtimeTimeZone = useMemo(() => getRuntimeTimeZone(), []);
  const todayDateKey = formatLocalDateKey();
  const [currentDateKey, setCurrentDateKey] = useState(() =>
    formatLocalDateKey()
  );
  const currentDayBounds = useMemo(
    () => getLocalDayBounds(currentDateKey),
    [currentDateKey]
  );
  const queryKey = useMemo(
    () => [
      "forge-weight-loss-view",
      currentDateKey,
      runtimeTimeZone,
      ...selectedUserIds
    ],
    [currentDateKey, runtimeTimeZone, selectedUserIds]
  );
  const isSelectedToday = currentDateKey === todayDateKey;

  const [planOpen, setPlanOpen] = useState(false);
  const [autoPlanPrompted, setAutoPlanPrompted] = useState(false);
  const [foodOpen, setFoodOpen] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [activeCaloriesError, setActiveCaloriesError] = useState<string | null>(
    null
  );
  const [activeCaloriesDraft, setActiveCaloriesDraft] = useState("");
  const [planDraft, setPlanDraft] = useState<WeightLossPlanDraft | null>(null);
  const [editingFoodLogId, setEditingFoodLogId] = useState<string | null>(null);
  const [foodDialogIntent, setFoodDialogIntent] =
    useState<WeightLossFoodLogIntent>("search");
  const [foodInitialStepId, setFoodInitialStepId] = useState<
    string | undefined
  >(undefined);
  const [foodDraft, setFoodDraft] = useState<WeightLossFoodDraft>(() =>
    buildInitialFoodDraft()
  );
  const [checkinDraft, setCheckinDraft] = useState<WeightLossCheckinDraft>(() =>
    buildInitialCheckinDraft()
  );

  const viewQuery = useQuery({
    queryKey,
    queryFn: async () =>
      (
        await getWeightLossView(selectedUserIds, {
          dateKey: currentDateKey,
          ...currentDayBounds,
          timeZone: runtimeTimeZone
        })
      ).weightLoss
  });
  const loadedView = viewQuery.data;

  useEffect(() => {
    const syncDateKey = () => {
      if (!isSelectedToday) {
        return;
      }
      setCurrentDateKey((previous) => {
        const next = formatLocalDateKey();
        return next === previous ? previous : next;
      });
    };
    const timer = window.setTimeout(
      syncDateKey,
      millisecondsUntilNextLocalDay()
    );
    window.addEventListener("focus", syncDateKey);
    document.addEventListener("visibilitychange", syncDateKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", syncDateKey);
      document.removeEventListener("visibilitychange", syncDateKey);
    };
  }, [currentDateKey, isSelectedToday]);

  useEffect(() => {
    if (
      !loadedView ||
      autoPlanPrompted ||
      planOpen ||
      isWeightLossPlanConfigured(loadedView)
    ) {
      return;
    }
    setAutoPlanPrompted(true);
    setPlanDraft(buildInitialPlanDraft(loadedView));
    setPlanError(
      "Forge needs the missing profile fields before the calorie and macro plan can be trusted.\n\n- Confirm age, height, current weight, objective, weekly rate, and active calories.\n- Known HealthKit and movement values are prefilled when available."
    );
    setPlanOpen(true);
  }, [autoPlanPrompted, loadedView, planOpen]);

  useEffect(() => {
    if (!loadedView) {
      return;
    }
    setActiveCaloriesDraft(
      String(Math.round(loadedView.energyModel.todayActiveCaloriesKcal ?? 0))
    );
    setActiveCaloriesError(null);
  }, [
    loadedView?.generatedAt,
    loadedView?.energyModel.todayActiveCaloriesKcal
  ]);

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const updateActiveCaloriesDraft = (value: string) => {
    setActiveCaloriesDraft(normalizeKcalDraft(value));
  };

  const foodSearchMutation = useMutation({
    mutationFn: async (query: string) =>
      (await searchNutritionFoods({ query, userIds: selectedUserIds })).foods
  });

  const chatGptFoodParseMutation = useMutation({
    mutationFn: async (text: string) =>
      parseNutritionFoodLogWithChatGpt({
        text,
        userIds: selectedUserIds,
        commitCandidate: false
      }),
    onSuccess: ({ candidate }) => {
      setFoodDraft({
        ...buildFoodDraftFromInput(candidate, "chatgpt"),
        dayKey: currentDateKey,
        timeZone: runtimeTimeZone
      });
    }
  });

  const createFoodLogMutation = useMutation({
    mutationFn: async (draft: WeightLossFoodDraft) =>
      createNutritionFoodLog(
        buildFoodLogInput(draft, {
          dateKey: currentDateKey,
          timeZone: runtimeTimeZone
        }),
        selectedUserIds
      ),
    onSuccess: () => {
      setFoodDraft(buildInitialFoodDraft());
      setFoodOpen(false);
      void refresh();
    }
  });

  const patchFoodLogMutation = useMutation({
    mutationFn: async ({
      foodLogId,
      draft
    }: {
      foodLogId: string;
      draft: WeightLossFoodDraft;
    }) =>
      patchNutritionFoodLog(
        foodLogId,
        buildFoodLogPatchInput(draft, {
          dateKey: currentDateKey,
          timeZone: runtimeTimeZone
        }),
        selectedUserIds
      ),
    onSuccess: () => {
      setFoodDraft(buildInitialFoodDraft());
      setEditingFoodLogId(null);
      setFoodOpen(false);
      void refresh();
    }
  });

  const deleteFoodLogMutation = useMutation({
    mutationFn: async (meal: NutritionFoodLog) =>
      deleteNutritionFoodLog(meal.id, selectedUserIds),
    onSuccess: () => {
      void refresh();
    }
  });

  const dailyActiveCaloriesMutation = useMutation({
    mutationFn: async (activeCaloriesKcal: number | null) =>
      updateNutritionDailyActiveCalories(
        {
          dayKey: loadedView?.todayLedger.dateKey,
          timeZone: runtimeTimeZone,
          activeCaloriesKcal,
          notes:
            activeCaloriesKcal == null
              ? ""
              : "Manual active-calorie override from the weight-loss view"
        },
        selectedUserIds
      ),
    onMutate: (activeCaloriesKcal) => {
      if (activeCaloriesKcal == null) {
        return null;
      }
      const previous = queryClient.getQueryData<WeightLossViewData>(queryKey);
      queryClient.setQueryData<WeightLossViewData | undefined>(
        queryKey,
        (current) => {
          if (!current) {
            return current;
          }
          const now = new Date().toISOString();
          return applyManualActiveCaloriesToView(current, activeCaloriesKcal, {
            id: current.energyModel.todayActiveOverride?.id ?? "optimistic",
            userId: current.userId,
            dayKey: current.todayLedger.dateKey,
            activeCaloriesKcal,
            notes: "Manual active-calorie override from the weight-loss view",
            createdAt:
              current.energyModel.todayActiveOverride?.createdAt ?? now,
            updatedAt: now
          });
        }
      );
      return previous ? { previous } : null;
    },
    onSuccess: (result, activeCaloriesKcal) => {
      setActiveCaloriesError(null);
      if (activeCaloriesKcal != null) {
        queryClient.setQueryData<WeightLossViewData | undefined>(
          queryKey,
          (current) =>
            current
              ? applyManualActiveCaloriesToView(
                  current,
                  activeCaloriesKcal,
                  result.override
                )
              : current
        );
      }
      void refresh();
    },
    onError: (error, _activeCaloriesKcal, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      setActiveCaloriesError(
        error instanceof Error
          ? error.message
          : "Could not save active calories"
      );
    }
  });

  const targetMutation = useMutation({
    mutationFn: async (draft: WeightLossPlanDraft) => {
      const currentWeight = Number(draft.currentWeightKg);
      await updateNutritionTarget(
        buildTargetPatchFromPlan(draft),
        selectedUserIds
      );
      if (Number.isFinite(currentWeight)) {
        await createNutritionBodyCheckin(
          {
            weightKg: currentWeight,
            notes: "Updated from weight-plan setup."
          },
          selectedUserIds
        );
      }
    },
    onSuccess: () => {
      setPlanOpen(false);
      void refresh();
    }
  });

  const checkinMutation = useMutation({
    mutationFn: async (draft: WeightLossCheckinDraft) => {
      const payloads = buildCheckinPayloads(draft);
      await Promise.all([
        payloads.body.weightKg !== null ||
        payloads.body.waistCm !== null ||
        payloads.body.bodyFatPercent !== null
          ? createNutritionBodyCheckin(payloads.body, selectedUserIds)
          : Promise.resolve(),
        payloads.subjective.energy !== null ||
        payloads.subjective.hunger !== null ||
        payloads.subjective.cravings !== null
          ? createNutritionSubjectiveCheckin(
              payloads.subjective,
              selectedUserIds
            )
          : Promise.resolve(),
        payloads.gut.bloating !== null
          ? createNutritionGutCheckin(payloads.gut, selectedUserIds)
          : Promise.resolve(),
        payloads.appearance.facePuffiness !== null ||
        payloads.appearance.leanness !== null
          ? createNutritionAppearanceCheckin(
              payloads.appearance,
              selectedUserIds
            )
          : Promise.resolve()
      ]);
    },
    onSuccess: () => {
      setCheckinDraft(buildInitialCheckinDraft());
      setCheckinOpen(false);
      void refresh();
    }
  });

  const logSavedMealMutation = useMutation({
    mutationFn: async (meal: NutritionFoodLog) =>
      createNutritionFoodLog(
        {
          dayKey: currentDateKey,
          timeZone: runtimeTimeZone,
          mealLabel: meal.mealLabel ?? "",
          source: "saved_meal",
          confirmationState: "confirmed",
          notes: meal.notes ?? "",
          items: meal.items.map((item) => ({
            foodId: item.foodId,
            name: item.name,
            brand: item.brand,
            quantity: item.quantity,
            unit: item.unit,
            grams: item.grams,
            calories: item.calories,
            proteinGrams: item.proteinGrams,
            carbohydrateGrams: item.carbohydrateGrams,
            fatGrams: item.fatGrams,
            fiberGrams: item.fiberGrams,
            sugarGrams: item.sugarGrams,
            sodiumMg: item.sodiumMg,
            potassiumMg: item.potassiumMg,
            caffeineMg: item.caffeineMg,
            alcoholGrams: item.alcoholGrams,
            glycemicIndex: item.glycemicIndex,
            novaGroup: item.novaGroup,
            fermented: item.fermented,
            probiotic: item.probiotic,
            fodmapLevel: item.fodmapLevel,
            tags: item.tags,
            confidence: item.confidence ?? 0.85
          }))
        },
        selectedUserIds
      ),
    onSuccess: () => {
      void refresh();
    }
  });

  if (viewQuery.isLoading) {
    return (
      <LoadingState
        title="Loading weight-loss signals"
        description="Combining food logs, HealthKit, movement, workouts, body check-ins, subjective state, and gut signals."
      />
    );
  }

  if (viewQuery.isError || !viewQuery.data) {
    return (
      <ErrorState
        error={viewQuery.error ?? new Error("Weight-loss view unavailable")}
        onRetry={() => void viewQuery.refetch()}
      />
    );
  }

  const view: WeightLossViewData = viewQuery.data;
  const ledger = view.todayLedger;
  const ledgerTotals = ledger.totals;
  const intakeCalories = ledgerTotals.calories;
  const remainingCalories = Number.isFinite(ledger.remainingCalories)
    ? ledger.remainingCalories
    : ledger.targetCalories - intakeCalories;
  const plannedTargetCalories =
    ledger.plannedTargetCalories ?? ledger.targetCalories;
  const todayActiveCalories =
    view.energyModel.todayActiveCaloriesKcal ??
    view.energyModel.activeBurnKcal ??
    view.energyModel.activeEnergyCalories ??
    view.energyModel.movementCaloriesKcal ??
    0;
  const baselineActiveCalories =
    view.energyModel.baselineActiveCaloriesKcal ?? todayActiveCalories;
  const activeAdjustment = ledger.activeAdjustmentCalories ?? 0;
  const activeAdjustmentText =
    activeAdjustment === 0
      ? "no day-specific active adjustment"
      : `${formatSignedKcal(activeAdjustment)} active adjustment from ${activeCaloriesSourceLabel(ledger.activeCaloriesSource)}`;
  const intakePercent =
    ledger.targetCalories > 0
      ? Math.min(
          140,
          Math.max(0, (intakeCalories / ledger.targetCalories) * 100)
        )
      : 0;
  const energy = view.energyModel;
  const trend = view.weightTrend;
  const foodQuality = view.foodQuality;
  const trainingFuel = view.trainingFuel;
  const subjective = view.subjective;
  const gut = view.gut;
  const hypotheses = insightArray(view.hypotheses);
  const resolvedPlanDraft = planDraft ?? buildInitialPlanDraft(view);

  const openPlan = () => {
    setPlanError(null);
    setPlanDraft(buildInitialPlanDraft(view));
    setPlanOpen(true);
  };

  const openNewFoodLog = (intent: WeightLossFoodLogIntent = "search") => {
    setEditingFoodLogId(null);
    setFoodDialogIntent(intent);
    setFoodInitialStepId(intent === "custom" ? "amounts" : "search");
    const nextDraft =
      intent === "custom"
        ? buildInitialCustomFoodDraft()
        : buildInitialFoodDraft();
    setFoodDraft({
      ...nextDraft,
      dayKey: currentDateKey,
      timeZone: runtimeTimeZone
    });
    setFoodOpen(true);
  };

  const openEditFoodLog = (meal: NutritionFoodLog) => {
    setEditingFoodLogId(meal.id);
    setFoodDialogIntent("search");
    setFoodInitialStepId("amounts");
    setFoodDraft({
      ...buildFoodDraftFromLog(meal),
      timeZone: runtimeTimeZone
    });
    setFoodOpen(true);
    setHistoryOpen(false);
  };

  const deleteFoodLog = (meal: NutritionFoodLog) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Delete ${meal.mealLabel ?? "this meal"} from the food log?`
      )
    ) {
      return;
    }
    deleteFoodLogMutation.mutate(meal);
  };

  const saveActiveCalories = () => {
    const normalizedDraft = normalizeKcalDraft(activeCaloriesDraft);
    setActiveCaloriesDraft(normalizedDraft);
    const parsed = Number(normalizedDraft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setActiveCaloriesError("Enter a valid active-calorie value.");
      return;
    }
    dailyActiveCaloriesMutation.mutate(Math.round(parsed));
  };

  const resetActiveCalories = () => {
    dailyActiveCaloriesMutation.mutate(null);
  };

  return (
    <div className="mx-auto grid w-full max-w-[1500px] gap-5">
      <PageHero
        title="Weight Loss"
        description="A guided Forge body composition lab: editable goals, science-based calorie and macro planning, exact food quantities, body measures, energy, gut comfort, look, and testable food hypotheses."
        badge={`${ledger.targetCalories.toFixed(0)} kcal budget · ${view.summary.loggedMealCount} food logs`}
      />

      <Card className="grid gap-4 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
            <CalendarDays className="size-4" />
            Food day
          </div>
          <div className="mt-1 text-2xl font-semibold text-[var(--ui-ink-strong)]">
            {isSelectedToday ? "Today" : formatDayHeading(currentDateKey)}
          </div>
          <div className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
            Local day {currentDateKey} in {runtimeTimeZone}. Food logs, manual
            active calories, target, and kcal left are scoped to this day.
          </div>
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-[auto_minmax(0,11rem)_auto_auto]">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setCurrentDateKey(addDaysToDateKey(currentDateKey, -1))
            }
            aria-label="Previous day"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <input
            type="date"
            value={currentDateKey}
            onChange={(event) => {
              if (event.target.value) {
                setCurrentDateKey(event.target.value);
              }
            }}
            aria-label="Selected food day"
            className="interactive-tap min-h-10 min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm font-medium text-[var(--ui-ink-strong)] outline-none"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={isSelectedToday}
            onClick={() => setCurrentDateKey(todayDateKey)}
          >
            Today
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setCurrentDateKey(addDaysToDateKey(currentDateKey, 1))
            }
            aria-label="Next day"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <WeightLossLedgerPanel
          ledger={ledger}
          remainingCalories={remainingCalories}
          intakePercent={intakePercent}
          logSavedPending={
            logSavedMealMutation.isPending || deleteFoodLogMutation.isPending
          }
          onLogAgain={(entry) => logSavedMealMutation.mutate(entry)}
          onEditMeal={openEditFoodLog}
          onDeleteMeal={deleteFoodLog}
        />

        <div className="grid min-w-0 gap-4">
          <WeightLossActionPanel
            view={view}
            onOpenPlan={openPlan}
            onOpenFoodSearch={() => openNewFoodLog("search")}
            onOpenCustomFood={() => openNewFoodLog("custom")}
            onOpenChatGptFood={() => openNewFoodLog("chatgpt")}
            onOpenCheckin={() => setCheckinOpen(true)}
            onOpenHistory={() => setHistoryOpen(true)}
          />
          <WeightLossActiveCaloriesMiniCard
            view={view}
            draftValue={activeCaloriesDraft}
            pending={dailyActiveCaloriesMutation.isPending}
            error={activeCaloriesError}
            onDraftChange={updateActiveCaloriesDraft}
            onSave={saveActiveCalories}
            onReset={resetActiveCalories}
          />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <WeightLossInsightMetric
          label={isSelectedToday ? "Today" : "Selected day"}
          value={`${intakeCalories.toFixed(0)} / ${ledger.targetCalories.toFixed(0)} kcal`}
          detail={`${remainingCaloriesText(remainingCalories)}. Target uses ${todayActiveCalories.toFixed(0)} active kcal for this day; ${activeAdjustmentText}.`}
          icon={Utensils}
          tone={remainingCalories >= 0 ? "green" : "rose"}
          help={`Today's target = baseline plan target plus the day-specific active adjustment. Here: ${plannedTargetCalories.toFixed(0)} ${formatSignedKcal(view.energyModel.todayTargetAdjustmentKcal)} = ${ledger.targetCalories.toFixed(0)} kcal. Same-day evidence is ${todayActiveCalories.toFixed(0)} kcal versus default ${baselineActiveCalories.toFixed(0)} kcal. Automatic partial evidence can only add above the baseline; a manual override can raise or lower today's target for this date.`}
        />
        <WeightLossInsightMetric
          label="Protein"
          value={`${ledgerTotals.proteinGrams.toFixed(0)}g`}
          detail={`${view.target.proteinGramsTarget.toFixed(0)}g target. Protein anchors the plan while cutting or gaining.`}
          icon={Beef}
          help="Protein grams are compared with the plan target, which uses g/kg body-weight logic and caps impossible values inside the calorie target."
        />
        <WeightLossInsightMetric
          label="Energy gap"
          value={energyGapValue(energy.estimatedDailyEnergyBalanceKcal)}
          detail={energyGapDetail(view)}
          icon={Gauge}
          tone="amber"
          help={energyGapHelp(view)}
          helpMaxWidthPx={560}
        />
        <WeightLossInsightMetric
          label="Weight trend"
          value={formatSigned(trend.sevenDayRateKg, 2)}
          detail={`Latest ${formatNumber(trend.latestWeightKg, 1)} kg. Trend uses check-ins, not noisy single weigh-ins.`}
          icon={Activity}
          tone="green"
          help="Weight trend uses recent body check-ins to estimate direction. Single weigh-ins can jump from water, sodium, gut content, and training inflammation."
        />
      </section>

      <WeightLossDataQualityPanel view={view} />

      <WeightLossNutritionTargetsPanel view={view} />

      <section className="grid gap-4 xl:grid-cols-4">
        <WeightLossInsightMetric
          label="Food quality"
          value={scoreLabel(foodQuality.qualityScore)}
          detail={`Fiber density ${formatNumber(foodQuality.fiberPer1000Kcal, 1)}g/1000 kcal, protein density ${formatNumber(foodQuality.proteinPer1000Kcal, 1)}g/1000 kcal, ultra-processed share ${formatNumber(foodQuality.ultraProcessedShare, 0)}%.`}
          icon={Utensils}
          tone="green"
          help="Food quality combines density and exposure signals such as fiber per 1000 kcal, protein per 1000 kcal, ultra-processed share, sodium, sugar, and available micronutrient evidence."
        />
        <WeightLossInsightMetric
          label="Training fuel"
          value={scoreLabel(trainingFuel.fuelingScore)}
          detail={`Recent workout load ${formatNumber(trainingFuel.recentTrainingLoad)} with ${formatNumber(trainingFuel.carbsPerTrainingLoad, 1)}g carbs per load unit.`}
          icon={Dumbbell}
          tone="amber"
          help="Training fuel relates carbohydrate and protein timing to recent workout load. It is meant to find performance and recovery patterns, not force a fixed carb rule."
        />
        <WeightLossInsightMetric
          label="Subjective"
          value={scoreLabel(subjective.averageFocus)}
          detail="Focus, energy, hunger, cravings, and performance are tracked as food-effect evidence."
          icon={Activity}
          help="Subjective signals are self-rated energy, focus, hunger, cravings, and performance. Forge uses them to discover food and timing effects."
        />
        <WeightLossInsightMetric
          label="Gut"
          value={scoreLabel(gut.averageBloating)}
          detail="Bloating, reflux, stool type, and suspected triggers connect food choices to comfort and look."
          icon={Waves}
          tone="rose"
          help="Gut signals include bloating, reflux, stool type, and suspected triggers. They help connect foods to comfort, water retention, and appearance hypotheses."
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        <WeightLossHypothesesPanel hypotheses={hypotheses} />
        <WeightLossExperimentsPanel experiments={view.experiments} />
      </section>

      <WeightLossPlanDialog
        open={planOpen}
        onOpenChange={setPlanOpen}
        view={view}
        value={resolvedPlanDraft}
        onChange={(nextDraft) => {
          setPlanDraft(nextDraft);
          setPlanError(null);
        }}
        pending={targetMutation.isPending}
        error={
          planError ??
          (targetMutation.error instanceof Error
            ? targetMutation.error.message
            : null)
        }
        onSubmit={async () => {
          const validationError =
            validateWeightLossPlanDraft(resolvedPlanDraft);
          if (validationError) {
            setPlanError(validationError);
            return;
          }
          await targetMutation.mutateAsync(resolvedPlanDraft);
        }}
      />
      <WeightLossFoodLogDialog
        open={foodOpen}
        onOpenChange={setFoodOpen}
        value={foodDraft}
        onChange={setFoodDraft}
        foodResults={foodSearchMutation.data ?? []}
        searchPending={foodSearchMutation.isPending}
        chatGptPending={chatGptFoodParseMutation.isPending}
        chatGptError={
          chatGptFoodParseMutation.error instanceof Error
            ? chatGptFoodParseMutation.error.message
            : null
        }
        logPending={
          createFoodLogMutation.isPending || patchFoodLogMutation.isPending
        }
        intent={foodDialogIntent}
        initialStepId={foodInitialStepId}
        onSearch={(query) => foodSearchMutation.mutate(query)}
        onParseWithChatGpt={(text) =>
          chatGptFoodParseMutation.mutateAsync(text).then(() => undefined)
        }
        mode={editingFoodLogId ? "edit" : "create"}
        onSubmit={async () => {
          if (editingFoodLogId) {
            await patchFoodLogMutation.mutateAsync({
              foodLogId: editingFoodLogId,
              draft: foodDraft
            });
            return;
          }
          await createFoodLogMutation.mutateAsync(foodDraft);
        }}
      />
      <WeightLossCheckinDialog
        open={checkinOpen}
        onOpenChange={setCheckinOpen}
        value={checkinDraft}
        onChange={setCheckinDraft}
        pending={checkinMutation.isPending}
        onSubmit={async () => {
          await checkinMutation.mutateAsync(checkinDraft);
        }}
      />
      <WeightLossHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        meals={view.recentMeals}
        pending={
          logSavedMealMutation.isPending || deleteFoodLogMutation.isPending
        }
        onLogAgain={(meal) => logSavedMealMutation.mutate(meal)}
        onEdit={openEditFoodLog}
        onDelete={deleteFoodLog}
      />
    </div>
  );
}
