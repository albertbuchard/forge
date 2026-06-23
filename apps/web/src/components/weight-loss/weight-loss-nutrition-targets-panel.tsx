import type { ReactNode } from "react";
import { Droplets, Dumbbell, Pill, Wheat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SurfacePanel, SurfaceStat } from "@/components/ui/surface";
import type { WeightLossViewData } from "@/lib/weight-loss-types";
import {
  HALL_NIDDK_LINEAR_WEIGHT_MODEL,
  hallNiddkWeeklyRateKgToDailyEnergyAdjustment
} from "@/lib/weight-loss-energy-model";
import { WeightLossFormulaTooltip } from "./weight-loss-formula-tooltip";
import {
  buildNutritionTargetGroups,
  type NutritionTargetRow
} from "./weight-loss-nutrition-targets";

function TargetTable({
  rows,
  compact = false
}: {
  rows: NutritionTargetRow[];
  compact?: boolean;
}) {
  return (
    <>
      <div className="grid gap-2 md:hidden">
        {rows.map((target) => (
          <div
            key={target.id}
            className="grid min-w-0 max-w-full gap-2 overflow-hidden rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3"
          >
            <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <div className="min-w-0 text-wrap text-sm font-semibold text-[var(--ui-ink)] [overflow-wrap:anywhere]">
                {target.label}
              </div>
              <div className="min-w-0 text-left text-sm font-semibold text-[var(--ui-ink)] sm:text-right">
                {target.target}
                <div className="text-xs font-normal text-[var(--ui-ink-faint)]">
                  {target.unit}
                </div>
              </div>
            </div>
            <p className="min-w-0 text-wrap text-xs leading-5 text-[var(--ui-ink-muted)] [overflow-wrap:anywhere]">
              {target.note}
            </p>
            {!compact ? (
              <Badge tone="meta" wrap className="justify-self-start">
                {target.source}
              </Badge>
            ) : null}
          </div>
        ))}
      </div>
      <div className="hidden min-w-0 max-w-full overflow-hidden rounded-[20px] border border-[var(--ui-border-subtle)] md:block">
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full min-w-[560px] table-fixed border-collapse text-left text-sm lg:min-w-0">
            <colgroup>
              <col className="w-[24%]" />
              <col className="w-[18%]" />
              <col className={compact ? "w-[58%]" : "w-[40%]"} />
              {!compact ? <col className="w-[18%]" /> : null}
            </colgroup>
            <thead className="sticky top-0 bg-[var(--ui-surface-2)] text-xs uppercase text-[var(--ui-ink-faint)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Target</th>
                <th className="px-4 py-3 font-semibold">Amount</th>
                <th className="px-4 py-3 font-semibold">Rationale</th>
                {!compact ? (
                  <th className="px-4 py-3 font-semibold">Source</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ui-border-subtle)]">
              {rows.map((target) => (
                <tr key={target.id} className="bg-[var(--ui-surface-1)]">
                  <td className="min-w-0 px-4 py-3 font-medium text-[var(--ui-ink)] [overflow-wrap:anywhere]">
                    {target.label}
                  </td>
                  <td className="min-w-0 px-4 py-3 text-[var(--ui-ink)] [overflow-wrap:anywhere]">
                    <span className="font-semibold">{target.target}</span>{" "}
                    <span className="text-[var(--ui-ink-faint)]">
                      {target.unit}
                    </span>
                  </td>
                  <td className="min-w-0 px-4 py-3 text-[var(--ui-ink-muted)] [overflow-wrap:anywhere]">
                    {target.note}
                  </td>
                  {!compact ? (
                    <td className="min-w-0 px-4 py-3">
                      <Badge tone="meta" wrap>
                        {target.source}
                      </Badge>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function TargetSection({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <SurfacePanel className="min-w-0 max-w-full overflow-hidden">
      <div className="mb-4 min-w-0">
        <h3 className="text-wrap text-sm font-semibold text-[var(--ui-ink)] [overflow-wrap:anywhere]">
          {title}
        </h3>
        <p className="mt-1 text-wrap text-sm text-[var(--ui-ink-muted)] [overflow-wrap:anywhere]">
          {description}
        </p>
      </div>
      {children}
    </SurfacePanel>
  );
}

export function WeightLossNutritionTargetsPanel({
  view
}: {
  view: WeightLossViewData;
}) {
  const targets = buildNutritionTargetGroups(view);
  const weeklyRate = view.target.weeklyRateGoalKg ?? null;
  const dailyAdjustment =
    weeklyRate != null && Number.isFinite(weeklyRate)
      ? hallNiddkWeeklyRateKgToDailyEnergyAdjustment(weeklyRate)
      : null;
  const restingKcal = targets.profile.restingEnergyKcal;
  const activeKcal = targets.profile.activeBurnKcal;
  const maintenanceKcal =
    restingKcal != null && activeKcal != null ? restingKcal + activeKcal : null;
  const goalMode = view.target.bodyGoal ?? "maintain";
  const proteinFactor = goalMode.includes("lose")
    ? 2
    : goalMode.includes("gain")
      ? 1.8
      : 1.6;
  const macroTargetValue = (id: string) => {
    const target = targets.macros.find((row) => row.id === id)?.target;
    const parsed = Number(target);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const fiberDriGrams =
    targets.profile.sex === "male"
      ? targets.profile.ageYears >= 51
        ? 30
        : 38
      : targets.profile.ageYears >= 51
        ? 21
        : 25;
  const fiberEnergyAdjustedGrams = Math.round(
    (targets.profile.calorieTarget / 1000) * 14
  );
  const sportEquivalent =
    targets.sportSummary.grossSportWeightEquivalentKgPerWeek != null
      ? `${targets.sportSummary.grossSportWeightEquivalentKgPerWeek.toFixed(2)} kg/week`
      : "n/a";

  return (
    <section className="grid gap-4">
      <Card className="min-w-0 overflow-hidden p-4 sm:p-5">
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-[var(--ui-ink)]">
              <Wheat className="size-4 shrink-0 text-[var(--ui-accent)]" />
              <span className="min-w-0 text-wrap [overflow-wrap:anywhere]">
                Macro And Micronutrient Targets
              </span>
              <WeightLossFormulaTooltip
                values={{
                  sex: targets.profile.sex,
                  ageYears: targets.profile.ageYears,
                  currentWeightKg: targets.profile.currentWeightKg,
                  bmrKcal: null,
                  restingKcal,
                  restingSource:
                    restingKcal != null
                      ? "formula baseline; HealthKit complete-day evidence is calibration"
                      : null,
                  activeKcal,
                  maintenanceKcal,
                  weeklyRateKg: weeklyRate,
                  dailyAdjustmentKcal: dailyAdjustment,
                  rateModel: HALL_NIDDK_LINEAR_WEIGHT_MODEL.label,
                  rateModelHorizonDays:
                    HALL_NIDDK_LINEAR_WEIGHT_MODEL.defaultPlanningHorizonDays,
                  calorieTarget: targets.profile.calorieTarget,
                  calorieFloor: targets.profile.sex === "male" ? 1500 : 1200,
                  proteinReferenceWeightKg: null,
                  proteinFactor,
                  proteinGrams: macroTargetValue("protein"),
                  fatGrams: macroTargetValue("fat"),
                  carbohydrateGrams: macroTargetValue("carbohydrate"),
                  fiberGrams: macroTargetValue("fiber"),
                  fiberEnergyAdjustedGrams,
                  fiberDriGrams
                }}
              />
            </div>
            <p className="mt-1 max-w-3xl text-wrap text-sm text-[var(--ui-ink-muted)] [overflow-wrap:anywhere]">
              Daily targets use Forge plan values first, then adult DRI/Dietary
              Guidelines defaults for nutrients the food log can score as
              catalog detail improves.
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2 lg:justify-end">
            <Badge tone="signal">
              {targets.profile.calorieTarget.toFixed(0)} kcal
            </Badge>
            <Badge tone="meta" wrap>
              {targets.profile.sex}, {targets.profile.ageYears.toFixed(0)}y
            </Badge>
          </div>
        </div>

        <div className="mt-5 grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.58fr)]">
          <div className="grid min-w-0 gap-4">
            <TargetSection
              title="All macro targets"
              description="Calories, protein, carbs, fat, fiber, sugar ceiling, saturated fat ceiling, essential fats, and water."
            >
              <TargetTable rows={targets.macros} compact />
            </TargetSection>

            <TargetSection
              title="Vitamins"
              description="Adult daily vitamin targets from DRI values, adjusted for sex and age where the reference differs."
            >
              <TargetTable rows={targets.vitamins} />
            </TargetSection>
          </div>

          <div className="grid min-w-0 content-start gap-4">
            <TargetSection
              title="Expected sport losses"
              description="Planning range from active burn. Calibrate with pre/post workout weight when possible."
            >
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <SurfaceStat
                  label="Active burn"
                  value={
                    targets.profile.activeBurnKcal != null
                      ? `${targets.profile.activeBurnKcal.toFixed(0)} kcal`
                      : "n/a"
                  }
                />
                <SurfaceStat label="Sport equivalent" value={sportEquivalent} />
                <SurfaceStat
                  label="Sweat fluid"
                  value={`${targets.sportSummary.fluidLossLiters} L`}
                />
                <SurfaceStat
                  label="Sodium loss"
                  value={`${targets.sportSummary.sodiumLossMg} mg`}
                />
              </div>
              <div className="mt-4 flex min-w-0 items-start gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm text-[var(--ui-ink-muted)]">
                <Dumbbell className="mt-0.5 size-4 shrink-0 text-[var(--ui-accent)]" />
                <span className="min-w-0 text-wrap [overflow-wrap:anywhere]">
                  Sport burn is shown as gross energy equivalent, not a promise
                  of scale loss. The calorie plan may already include active
                  burn, and replacement depends on appetite, heat, sodium loss,
                  and actual intake.
                </span>
              </div>
            </TargetSection>

            <TargetSection
              title="Minerals & oligoelements"
              description="Daily mineral and trace-element targets including sodium ceiling and potassium AI."
            >
              <TargetTable rows={targets.minerals} compact />
            </TargetSection>

            <TargetSection
              title="Sport electrolyte model"
              description="Use these as expected losses, not rigid supplement prescriptions."
            >
              <div className="grid gap-3">
                {targets.sportLosses.map((target) => (
                  <div
                    key={target.id}
                    className="grid min-w-0 gap-2 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--ui-ink)]">
                        {target.id === "sweat_fluid" ? (
                          <Droplets className="size-4 shrink-0 text-[var(--ui-accent)]" />
                        ) : (
                          <Pill className="size-4 shrink-0 text-[var(--ui-accent)]" />
                        )}
                        <span className="min-w-0 text-wrap [overflow-wrap:anywhere]">
                          {target.label}
                        </span>
                      </div>
                      <p className="mt-1 text-wrap text-xs text-[var(--ui-ink-faint)] [overflow-wrap:anywhere]">
                        {target.note}
                      </p>
                    </div>
                    <div className="min-w-0 text-left text-sm font-semibold text-[var(--ui-ink)] sm:text-right">
                      {target.target}
                      <div className="text-xs font-normal text-[var(--ui-ink-faint)]">
                        {target.unit}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </TargetSection>
          </div>
        </div>
      </Card>
    </section>
  );
}
