import { InfoTooltip } from "@/components/ui/info-tooltip";
import { formatNumber, formatSigned } from "./weight-loss-format";

export type WeightLossFormulaValues = {
  sex?: "male" | "female";
  ageYears?: number | null;
  currentWeightKg?: number | null;
  heightCm?: number | null;
  bmrKcal?: number | null;
  restingKcal?: number | null;
  restingSource?: string | null;
  activeKcal?: number | null;
  maintenanceKcal?: number | null;
  weeklyRateKg?: number | null;
  dailyAdjustmentKcal?: number | null;
  calorieTarget?: number | null;
  calorieFloor?: number | null;
  proteinReferenceWeightKg?: number | null;
  proteinFactor?: number | null;
  proteinGrams?: number | null;
  fatGrams?: number | null;
  carbohydrateGrams?: number | null;
  fiberGrams?: number | null;
  fiberEnergyAdjustedGrams?: number | null;
  fiberDriGrams?: number | null;
};

function formulaLine(label: string, formula: string, value?: string) {
  return (
    <li className="grid gap-0.5">
      <span className="font-medium text-[var(--ui-ink)]">{label}</span>
      <code className="rounded-[6px] bg-[var(--ui-surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ui-ink-soft)]">
        {formula}
      </code>
      {value ? (
        <span className="text-xs text-[var(--ui-ink-faint)]">{value}</span>
      ) : null}
    </li>
  );
}

export function WeightLossFormulaTooltip({
  values,
  label = "Show calorie and macro formulas"
}: {
  values?: WeightLossFormulaValues;
  label?: string;
}) {
  const sex = values?.sex ?? "male";
  const sexConstant = sex === "male" ? "+ 5" : "- 161";
  const proteinFactor =
    values?.proteinFactor != null
      ? `${values.proteinFactor.toFixed(1)}g/kg`
      : "1.6-2.0g/kg";

  return (
    <InfoTooltip
      label={label}
      title="Weight Loss Formulas"
      maxWidthPx={520}
      panelClassName="text-xs leading-5"
      content={
        <div className="grid gap-3">
          <p>
            Forge keeps activity independent from the goal. The goal only adds a
            deficit, surplus, or zero adjustment to resting plus active
            calories.
          </p>
          <ol className="grid gap-2">
            {formulaLine(
              "Mifflin-St Jeor BMR",
              `10 x weight kg + 6.25 x height cm - 5 x age ${sexConstant}`,
              `Current formula value: ${formatNumber(values?.bmrKcal)} kcal/day.`
            )}
            {formulaLine(
              "Resting calories",
              "HealthKit basal/resting kcal when present, otherwise BMR",
              `Using: ${formatNumber(values?.restingKcal)} kcal/day${values?.restingSource ? ` (${values.restingSource})` : ""}.`
            )}
            {formulaLine(
              "Maintenance calories",
              "resting calories + active calories",
              `${formatNumber(values?.restingKcal)} + ${formatNumber(values?.activeKcal)} = ${formatNumber(values?.maintenanceKcal)} kcal/day.`
            )}
            {formulaLine(
              "Objective adjustment",
              "weekly change kg x 7700 kcal/kg / 7",
              `Weekly rate ${formatSigned(values?.weeklyRateKg, 2)} kg/week gives ${formatSigned(values?.dailyAdjustmentKcal)} kcal/day.`
            )}
            {formulaLine(
              "Daily calorie target",
              "max(sex floor, maintenance + objective adjustment)",
              `Floor ${formatNumber(values?.calorieFloor)} kcal; target ${formatNumber(values?.calorieTarget)} kcal/day.`
            )}
            {formulaLine(
              "Protein target",
              `min(reference weight x ${proteinFactor}, 45% of kcal / 4)`,
              `Reference ${formatNumber(values?.proteinReferenceWeightKg, 1)} kg; target ${formatNumber(values?.proteinGrams)} g/day.`
            )}
            {formulaLine(
              "Fat target",
              "saved plan fat when present; otherwise min(remaining kcal after protein, 35% kcal / 9, max(0.6g/kg reference, 25% kcal / 9))",
              `Target ${formatNumber(values?.fatGrams)} g/day.`
            )}
            {formulaLine(
              "Carbohydrate target",
              "(calorie target - protein g x 4 - fat g x 9) / 4",
              `Target ${formatNumber(values?.carbohydrateGrams)} g/day. The 130g DRI is shown as reference, not forced if it breaks calories.`
            )}
            {formulaLine(
              "Fiber target",
              "14g per 1000 kcal; adult sex/age AI shown as reference",
              `Target ${formatNumber(values?.fiberGrams)} g/day; energy-adjusted ${formatNumber(values?.fiberEnergyAdjustedGrams)} g/day; adult AI reference ${formatNumber(values?.fiberDriGrams)} g/day.`
            )}
            {formulaLine(
              "Sport-loss estimate",
              "training hours ~= active kcal / 500; sweat ~= 0.4-0.8 L/h; sodium ~= 500-1000 mg/L",
              "Shown as expected loss ranges, not rigid supplement instructions."
            )}
          </ol>
        </div>
      }
    />
  );
}
