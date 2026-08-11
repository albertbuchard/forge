import {
  Activity,
  Calculator,
  Dumbbell,
  Footprints,
  RotateCcw,
  Save
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Input } from "@/components/ui/input";
import { formatNumber } from "./weight-loss-format";
import type { WeightLossViewData } from "@/lib/weight-loss-types";
import { cn } from "@/lib/utils";

function sourceLabel(source: string) {
  switch (source) {
    case "user_override":
      return "Manual override for today";
    case "today_healthkit_active_energy":
      return "HealthKit active energy today";
    case "today_workout_movement_energy":
      return "Workout + movement today";
    case "today_workout_movement_step_energy":
      return "Workout + movement + steps today";
    case "today_workout_step_energy":
      return "Workout + steps today";
    case "today_movement_step_energy":
      return "Movement + steps today";
    case "today_workout_energy":
      return "Workout energy today";
    case "today_movement_trip_calories":
      return "Movement trips today";
    case "today_step_estimate":
      return "Step estimate today";
    default:
      return "Past-week active baseline";
  }
}

function sourceDescription(
  source: string,
  energy: WeightLossViewData["energyModel"]
) {
  switch (source) {
    case "user_override":
      return "Your override is controlling today's food budget.";
    case "today_healthkit_active_energy":
      return "Forge is using same-day HealthKit active energy, which normally includes steps and workouts.";
    case "today_workout_movement_energy":
      return "Forge found same-day workout or movement calories and is using them instead of the baseline.";
    case "today_workout_movement_step_energy":
      return "Forge found same-day workout calories, movement-trip calories, and estimated step calories, so those replace the baseline active calories today.";
    case "today_workout_step_energy":
      return "Forge found same-day workout calories and estimated step calories, so those replace the baseline active calories today.";
    case "today_movement_step_energy":
      return "Forge found same-day movement-trip calories and estimated step calories, so those replace the baseline active calories today.";
    case "today_workout_energy":
      return "Forge found workout calories today and is using them instead of the baseline.";
    case "today_movement_trip_calories":
      return "Forge found movement-trip calories today and is using them instead of the baseline.";
    case "today_step_estimate":
      return "Forge found enough same-day steps to beat the baseline active allowance, so it estimates step calories from latest known body weight and uses that today.";
    default:
      return `No meaningful same-day active evidence is available yet, so Forge is using the active baseline described below. ${baselineEvidenceDetail(energy)}`;
  }
}

function sourceDecisionLabel(source: string) {
  switch (source) {
    case "user_override":
      return "Using your manual value for today.";
    case "today_healthkit_active_energy":
      return "Using same-day HealthKit active energy instead of the baseline.";
    case "today_workout_movement_energy":
      return "Using today's workout and movement calories instead of the baseline.";
    case "today_workout_movement_step_energy":
      return "Using today's workouts, movement, and steps instead of the baseline.";
    case "today_workout_step_energy":
      return "Using today's workouts and steps instead of the baseline.";
    case "today_movement_step_energy":
      return "Using today's movement and steps instead of the baseline.";
    case "today_workout_energy":
      return "Using today's workout calories instead of the baseline.";
    case "today_movement_trip_calories":
      return "Using today's movement calories instead of the baseline.";
    case "today_step_estimate":
      return "Using today's step estimate because it is above the baseline.";
    default:
      return "No meaningful same-day active evidence yet, so the past-week active baseline is used.";
  }
}

function activeEvidenceSummary(energy: WeightLossViewData["energyModel"]) {
  const evidence = [
    energy.todayHealthKitActiveCaloriesKcal != null
      ? `HealthKit active ${energy.todayHealthKitActiveCaloriesKcal.toFixed(0)} kcal`
      : null,
    energy.todayWorkoutEnergyKcal != null
      ? `workouts ${energy.todayWorkoutEnergyKcal.toFixed(0)} kcal`
      : null,
    energy.todayMovementCaloriesKcal != null
      ? `movement ${energy.todayMovementCaloriesKcal.toFixed(0)} kcal`
      : null,
    energy.todayStepEstimatedCaloriesKcal != null
      ? `step estimate ${energy.todayStepEstimatedCaloriesKcal.toFixed(0)} kcal`
      : null,
    energy.todayStepCount != null
      ? `${energy.todayStepCount.toFixed(0)} steps`
      : null
  ].filter(Boolean);
  return evidence.length > 0
    ? evidence.join(" · ")
    : "No same-day HealthKit active energy, workout calories, movement calories, or steps synced yet.";
}

function baselineEvidenceDetail(energy: WeightLossViewData["energyModel"]) {
  const coverage = `${energy.activeBaselineSelectedEvidenceDays}/${energy.activeBaselineWindowDays} selected-source days`;
  if (energy.activeBaselineDecision === "configured_default_sparse_evidence") {
    return `${coverage} · sparse. The measured ${energy.activeBaselineObservedCaloriesKcal?.toFixed(0) ?? "n/a"} kcal average remains visible, but Forge retains the saved baseline until ${energy.activeBaselineMinimumEvidenceDays} days are available.`;
  }
  if (energy.activeBaselineDecision === "sparse_measured_only") {
    return `${coverage} · sparse. No saved baseline exists, so Forge uses the measured average with low confidence.`;
  }
  if (energy.activeBaselineDecision === "measured_baseline") {
    return `${coverage} · ${energy.activeBaselineReliability}. Missing days are ignored, never counted as zero.`;
  }
  if (
    energy.activeBaselineDecision === "configured_default_no_measured_evidence"
  ) {
    return `${coverage}. No measured prior-day activity is available, so Forge uses the saved baseline.`;
  }
  return `${coverage}. No saved or measured activity baseline is available.`;
}

function formatSignedKcal(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(0)} kcal`;
}

function normalizeKcalDraft(value: string) {
  return value.trim() === "" ? "0" : value;
}

function EvidenceTile({
  label,
  value,
  detail,
  active = false
}: {
  label: string;
  value: string;
  detail: string;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[8px] border p-3",
        active
          ? "border-[color-mix(in_srgb,var(--primary)_42%,var(--ui-border-subtle)_58%)] bg-[color-mix(in_srgb,var(--primary)_12%,var(--ui-surface-1)_88%)]"
          : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]"
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
        {label}
      </div>
      <div className="mt-2 break-words text-xl font-semibold text-[var(--ui-ink-strong)]">
        {value}
      </div>
      <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
        {detail}
      </div>
    </div>
  );
}

export function WeightLossActiveCaloriesPanel({
  view,
  draftValue,
  baselineDraftValue,
  pending,
  baselinePending,
  error,
  baselineError,
  onDraftChange,
  onBaselineDraftChange,
  onSave,
  onSaveBaseline,
  onReset
}: {
  view: WeightLossViewData;
  draftValue: string;
  baselineDraftValue: string;
  pending: boolean;
  baselinePending: boolean;
  error: string | null;
  baselineError: string | null;
  onDraftChange: (value: string) => void;
  onBaselineDraftChange: (value: string) => void;
  onSave: () => void;
  onSaveBaseline: () => void;
  onReset: () => void;
}) {
  const energy = view.energyModel;
  const override = energy.todayActiveOverride;
  const source = energy.todayActiveCaloriesSource;
  const plannedTarget = view.todayLedger.plannedTargetCalories;
  const target = view.todayLedger.targetCalories;
  const sourceIsObserved =
    source === "today_healthkit_active_energy" ||
    source === "today_workout_movement_energy" ||
    source === "today_workout_movement_step_energy" ||
    source === "today_workout_step_energy" ||
    source === "today_movement_step_energy" ||
    source === "today_workout_energy" ||
    source === "today_movement_trip_calories" ||
    source === "today_step_estimate";
  const sourceIsDefault = source === "default_active_calories";
  const sourceText = sourceLabel(source);
  const formula = `${plannedTarget.toFixed(0)} ${formatSignedKcal(energy.todayTargetAdjustmentKcal)} = ${target.toFixed(0)} kcal`;
  const evidenceSummary = activeEvidenceSummary(energy);
  const sourceDecision = sourceDecisionLabel(source);
  const automaticPositiveOnly =
    "Automatic same-day evidence can only add above the baseline because early or partial syncs are unreliable. A manual override is deliberate, so it can raise or lower today's target for this date.";

  return (
    <Card className="grid gap-5 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-5">
      <div className="grid gap-5">
        <div className="min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.42fr)] xl:items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-[8px] bg-[var(--ui-info-soft)] p-2 text-[color-mix(in_srgb,var(--info)_78%,var(--ui-ink-strong)_22%)]">
                  <Activity className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                    Today active-calorie source
                    <InfoTooltip
                      label="Explain active calorie target"
                      content={`This is the active-energy allowance applied to today's food budget. Forge uses a manual override first, then same-day HealthKit active energy because it normally includes steps and workouts, then workout and movement calories, then a step estimate only when it is above the baseline active allowance, then the prior-week measured baseline from the plan. ${automaticPositiveOnly}`}
                    />
                  </div>
                  <h2 className="mt-1 text-3xl font-semibold leading-tight text-[var(--ui-ink-strong)]">
                    {energy.todayActiveCaloriesKcal.toFixed(0)} active kcal
                    applied today
                  </h2>
                  <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                    {sourceDecision}
                  </div>
                  <div className="mt-3 rounded-[8px] border border-[color-mix(in_srgb,var(--primary)_38%,var(--ui-border-subtle)_62%)] bg-[color-mix(in_srgb,var(--primary)_10%,var(--ui-surface-2)_90%)] px-3 py-2 text-sm leading-6 text-[var(--ui-ink-medium)]">
                    <span className="font-semibold text-[var(--ui-ink-strong)]">
                      Rule:
                    </span>{" "}
                    baseline active calories stay inside the baseline target.
                    Same-day workouts, movement calories, HealthKit active
                    energy, or enough step calories create only a positive
                    activity buffer above that baseline. Tiny or early partial
                    syncs stay visible but never lower the food budget. A manual
                    edit overrides today only and can lower or raise the day
                    target relative to the baseline active calories.
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ui-ink-soft)]">
                    <span className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-1">
                      Applied {energy.todayActiveCaloriesKcal.toFixed(0)} kcal
                    </span>
                    <span className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-1">
                      Past-week baseline{" "}
                      {energy.baselineActiveCaloriesKcal.toFixed(0)} kcal
                    </span>
                    <span className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-1">
                      Observed today{" "}
                      {energy.todayObservedActiveCaloriesKcal != null
                        ? `${energy.todayObservedActiveCaloriesKcal.toFixed(0)} kcal`
                        : "n/a"}
                    </span>
                  </div>
                  <h3 className="sr-only">
                    Active calories: {energy.todayActiveCaloriesKcal.toFixed(0)}{" "}
                    kcal
                  </h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <div className="inline-flex max-w-full items-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-1 text-xs font-medium text-[var(--ui-ink-medium)]">
                      <span className="min-w-0 truncate">{sourceText}</span>
                    </div>
                    <div className="inline-flex max-w-full items-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-1 text-xs font-medium text-[var(--ui-ink-medium)]">
                      <span className="min-w-0 truncate">
                        Baseline {energy.baselineActiveCaloriesKcal.toFixed(0)}{" "}
                        kcal
                      </span>
                    </div>
                    <div className="inline-flex max-w-full items-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-1 text-xs font-medium text-[var(--ui-ink-medium)]">
                      <span className="min-w-0 truncate">
                        Observed today{" "}
                        {energy.todayObservedActiveCaloriesKcal != null
                          ? `${energy.todayObservedActiveCaloriesKcal.toFixed(0)} kcal`
                          : "n/a"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                        Applied today
                      </div>
                      <div className="mt-1 text-2xl font-semibold text-[var(--ui-ink-strong)]">
                        {energy.todayActiveCaloriesKcal.toFixed(0)} kcal
                      </div>
                    </div>
                    <div className="min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                        Past-week baseline
                      </div>
                      <div className="mt-1 text-2xl font-semibold text-[var(--ui-ink-strong)]">
                        {energy.baselineActiveCaloriesKcal.toFixed(0)} kcal
                      </div>
                    </div>
                    <div className="min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                        Budget change
                      </div>
                      <div className="mt-1 text-2xl font-semibold text-[var(--ui-ink-strong)]">
                        {formatSignedKcal(energy.todayTargetAdjustmentKcal)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                    <span className="font-semibold text-[var(--ui-ink-strong)]">
                      Budget equation:
                    </span>{" "}
                    {formula}. Forge uses {energy.activityEatBackFraction * 100}
                    % of the active difference versus the baseline day for a
                    manual override. Automatic same-day evidence still cannot
                    reduce the target.
                  </div>
                </div>
              </div>
            </div>

            <div className="grid min-w-0 gap-3 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Edit active baseline
                <InfoTooltip
                  label="Explain active baseline"
                  content={`This is the baseline active-calorie value saved in the plan. Forge refreshes it from measured active-energy days in the prior ${energy.activeBaselineWindowDays} days only after ${energy.activeBaselineMinimumEvidenceDays} selected-source days are available. Sparse observations remain visible but do not replace a saved baseline. Missing sync days are ignored rather than counted as zero. Changing the saved value recalculates the plan target, macros, and maintenance calories; it does not change today's workout or movement evidence.`}
                />
              </div>
              <label className="grid gap-2">
                <span className="text-sm font-medium text-[var(--ui-ink-medium)]">
                  Baseline active calories/day
                </span>
                <div className="grid max-w-[calc(100%-6.5rem)] min-w-0 gap-2 sm:max-w-none sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Input
                    inputMode="decimal"
                    value={baselineDraftValue}
                    onChange={(event) =>
                      onBaselineDraftChange(
                        normalizeKcalDraft(event.target.value)
                      )
                    }
                    aria-label="Baseline active calories per day"
                  />
                  <span className="flex items-center justify-start rounded-[8px] bg-[var(--ui-surface-1)] px-3 py-2 text-sm font-semibold text-[var(--ui-ink-medium)] sm:justify-center">
                    kcal
                  </span>
                </div>
              </label>
              <Button
                type="button"
                variant="secondary"
                onClick={onSaveBaseline}
                pending={baselinePending}
                pendingLabel="Saving baseline"
              >
                <Save className="size-4" />
                Save baseline
              </Button>

              <div className="mt-1 border-t border-[var(--ui-border-subtle)] pt-3">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                  Edit today
                  <InfoTooltip
                    label="Explain manual active calorie override"
                    content="Use this when the wearable is missing, delayed, or obviously wrong. Saving creates a manual override for this date only. Reset removes the override and returns to same-day HealthKit, workout plus movement, or the default plan value."
                  />
                </div>
              </div>
              <label className="grid gap-2">
                <span className="text-sm font-medium text-[var(--ui-ink-medium)]">
                  Active calories to apply today
                </span>
                <div className="grid max-w-[calc(100%-6.5rem)] min-w-0 gap-2 sm:max-w-none sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Input
                    inputMode="decimal"
                    value={draftValue}
                    onChange={(event) =>
                      onDraftChange(normalizeKcalDraft(event.target.value))
                    }
                    aria-label="Today active calories"
                  />
                  <span className="flex items-center justify-start rounded-[8px] bg-[var(--ui-surface-1)] px-3 py-2 text-sm font-semibold text-[var(--ui-ink-medium)] sm:justify-center">
                    kcal
                  </span>
                </div>
              </label>
              <div className="grid max-w-[calc(100%-6.5rem)] gap-2 sm:max-w-none sm:grid-cols-2">
                <Button
                  type="button"
                  onClick={onSave}
                  pending={pending}
                  pendingLabel="Applying"
                >
                  <Save className="size-4" />
                  Apply today
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onReset}
                  disabled={!override || pending}
                >
                  <RotateCcw className="size-4" />
                  Use evidence
                </Button>
              </div>
            </div>
          </div>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--ui-ink-soft)]">
            {sourceDescription(source, energy)} Today&apos;s food budget is{" "}
            <span className="font-semibold text-[var(--ui-ink-strong)]">
              {target.toFixed(0)} kcal
            </span>
            , after a{" "}
            <span className="font-semibold text-[var(--ui-ink-strong)]">
              {formatSignedKcal(energy.todayTargetAdjustmentKcal)}
            </span>{" "}
            active adjustment versus the baseline target.
          </p>
          <div className="mt-3 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
            <span className="font-semibold text-[var(--ui-ink-strong)]">
              Today evidence:
            </span>{" "}
            {evidenceSummary}
          </div>
          <div className="mt-4 grid gap-2 text-xs leading-5 text-[var(--ui-ink-soft)] sm:grid-cols-3">
            <div className="min-w-0 rounded-[8px] bg-[var(--ui-surface-2)] px-3 py-2">
              <span className="block text-[var(--ui-ink-faint)]">
                Baseline food budget
              </span>
              <span className="font-semibold text-[var(--ui-ink-strong)]">
                {plannedTarget.toFixed(0)} kcal
              </span>
            </div>
            <div className="min-w-0 rounded-[8px] bg-[var(--ui-surface-2)] px-3 py-2">
              <span className="block text-[var(--ui-ink-faint)]">
                Activity buffer
              </span>
              <span className="font-semibold text-[var(--ui-ink-strong)]">
                {formatSignedKcal(energy.todayTargetAdjustmentKcal)}
              </span>
            </div>
            <div className="min-w-0 rounded-[8px] bg-[var(--ui-surface-2)] px-3 py-2">
              <span className="block text-[var(--ui-ink-faint)]">
                Today food budget
              </span>
              <span className="font-semibold text-[var(--ui-ink-strong)]">
                {target.toFixed(0)} kcal
              </span>
            </div>
          </div>
        </div>
      </div>

      {baselineError ? (
        <div className="rounded-[8px] border border-[var(--danger)]/20 bg-[var(--ui-danger-soft)] px-3 py-2 text-sm text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]">
          {baselineError}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-[8px] border border-[var(--danger)]/20 bg-[var(--ui-danger-soft)] px-3 py-2 text-sm text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <EvidenceTile
          label="Past-week baseline"
          value={`${energy.baselineActiveCaloriesKcal.toFixed(0)} kcal`}
          detail={baselineEvidenceDetail(energy)}
          active={sourceIsDefault}
        />
        <EvidenceTile
          label="Observed today"
          value={
            energy.todayObservedActiveCaloriesKcal != null
              ? `${energy.todayObservedActiveCaloriesKcal.toFixed(0)} kcal`
              : "n/a"
          }
          detail="HealthKit active energy, workout/movement calories, or step estimate."
          active={sourceIsObserved}
        />
        <EvidenceTile
          label="Food budget effect"
          value={formatSignedKcal(energy.todayTargetAdjustmentKcal)}
          detail="Signed manual override adjustment, or positive-only automatic buffer."
        />
        <EvidenceTile
          label="Override"
          value={
            override ? `${override.activeCaloriesKcal.toFixed(0)} kcal` : "Off"
          }
          detail={
            override
              ? "Manual value is controlling today."
              : "Measured/baseline source is controlling today."
          }
          active={source === "user_override"}
        />
      </div>

      <div className="grid gap-3 text-sm md:grid-cols-4">
        <div className="flex min-w-0 items-center gap-2 rounded-[8px] bg-[var(--ui-surface-1)] px-3 py-2 text-[var(--ui-ink-soft)]">
          <Activity className="size-4 shrink-0" />
          <span className="min-w-0 break-words">
            HealthKit active:{" "}
            {formatNumber(energy.todayHealthKitActiveCaloriesKcal)} kcal
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 rounded-[8px] bg-[var(--ui-surface-1)] px-3 py-2 text-[var(--ui-ink-soft)]">
          <Dumbbell className="size-4 shrink-0" />
          <span className="min-w-0 break-words">
            Workouts: {formatNumber(energy.todayWorkoutEnergyKcal)} kcal
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 rounded-[8px] bg-[var(--ui-surface-1)] px-3 py-2 text-[var(--ui-ink-soft)]">
          <Footprints className="size-4 shrink-0" />
          <span className="min-w-0 break-words">
            Steps: {formatNumber(energy.todayStepCount, 0)}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 rounded-[8px] bg-[var(--ui-surface-1)] px-3 py-2 text-[var(--ui-ink-soft)]">
          <Activity className="size-4 shrink-0" />
          <span className="min-w-0 break-words">
            Movement: {formatNumber(energy.todayMovementCaloriesKcal)} kcal
          </span>
        </div>
      </div>
      <div className="rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
        <div className="flex min-w-0 items-start gap-2">
          <Calculator className="mt-1 size-4 shrink-0 text-[var(--ui-ink-faint)]" />
          <span className="min-w-0 break-words">
            Priority: manual override, then same-day HealthKit active energy. If
            HealthKit active energy is missing, Forge adds same-day workout
            calories, movement-trip calories, and estimated step calories from
            latest known body weight. Automatic evidence only adds a positive
            surplus above the past-week measured baseline. A manual override
            applies a signed day adjustment.
          </span>
        </div>
      </div>
    </Card>
  );
}

export function WeightLossActiveCaloriesMiniCard({
  view,
  draftValue,
  pending,
  error,
  onDraftChange,
  onSave,
  onReset
}: {
  view: WeightLossViewData;
  draftValue: string;
  pending: boolean;
  error: string | null;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const energy = view.energyModel;
  const ledger = view.todayLedger;
  const override = energy.todayActiveOverride;
  const source = energy.todayActiveCaloriesSource;
  const formula = `${ledger.plannedTargetCalories.toFixed(0)} ${formatSignedKcal(energy.todayTargetAdjustmentKcal)} = ${ledger.targetCalories.toFixed(0)} kcal`;

  return (
    <Card className="grid min-w-0 gap-3 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
            Active kcal
            <InfoTooltip
              label="Explain active calories"
              content={`Selected-day target = baseline food target plus the day-specific active adjustment. ${formula}. Automatic same-day activity can only add ${Math.round(energy.activityEatBackFraction * 100)}% of the positive surplus above the baseline day. A manual edit overrides this date only and can raise or lower the target.`}
            />
          </div>
          <div className="mt-1 text-2xl font-semibold leading-tight text-[var(--ui-ink-strong)]">
            {energy.todayActiveCaloriesKcal.toFixed(0)} kcal
          </div>
        </div>
        <div className="rounded-[8px] bg-[var(--ui-info-soft)] p-2 text-[color-mix(in_srgb,var(--info)_78%,var(--ui-ink-strong)_22%)]">
          <Activity className="size-4" />
        </div>
      </div>

      <div className="grid gap-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
        <div className="break-words font-medium text-[var(--ui-ink-medium)]">
          {sourceDecisionLabel(source)}
        </div>
        <div>
          Baseline {energy.baselineActiveCaloriesKcal.toFixed(0)} kcal
          {" · "}
          observed{" "}
          {energy.todayObservedActiveCaloriesKcal != null
            ? `${energy.todayObservedActiveCaloriesKcal.toFixed(0)} kcal`
            : "n/a"}
        </div>
        <div className="break-words">Source: {sourceLabel(source)}</div>
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Input
          inputMode="decimal"
          value={draftValue}
          onChange={(event) =>
            onDraftChange(normalizeKcalDraft(event.target.value))
          }
          aria-label="Selected day active calories"
          className="py-2.5"
        />
        <Button
          type="button"
          onClick={onSave}
          pending={pending}
          pendingLabel="Applying"
        >
          <Save className="size-4" />
          Apply
        </Button>
      </div>

      <Button
        type="button"
        variant="secondary"
        onClick={onReset}
        disabled={!override || pending}
      >
        <RotateCcw className="size-4" />
        Use evidence
      </Button>

      {error ? (
        <div className="rounded-[8px] border border-[var(--danger)]/20 bg-[var(--ui-danger-soft)] px-3 py-2 text-xs leading-5 text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]">
          {error}
        </div>
      ) : null}
    </Card>
  );
}
