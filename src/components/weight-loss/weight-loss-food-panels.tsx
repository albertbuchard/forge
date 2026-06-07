import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import type {
  NutritionFoodLog,
  WeightLossViewData
} from "@/lib/weight-loss-types";
import { cn } from "@/lib/utils";
import {
  WeightLossEmptyState,
  WeightLossRecentMeal
} from "./weight-loss-cards";

function formatKcal(value: number) {
  return `${value.toFixed(0)} kcal`;
}

function remainingLabel(value: number) {
  return value >= 0 ? "Kcal left" : "Over target";
}

function remainingValue(value: number) {
  return value >= 0 ? formatKcal(value) : formatKcal(Math.abs(value));
}

export function WeightLossLedgerPanel({
  ledger,
  remainingCalories,
  intakePercent,
  logSavedPending,
  onLogAgain,
  onEditMeal,
  onDeleteMeal
}: {
  ledger: WeightLossViewData["todayLedger"];
  remainingCalories: number;
  intakePercent: number;
  logSavedPending: boolean;
  onLogAgain: (meal: NutritionFoodLog) => void;
  onEditMeal: (meal: NutritionFoodLog) => void;
  onDeleteMeal: (meal: NutritionFoodLog) => void;
}) {
  const totals = ledger.totals;
  return (
    <Card className="grid gap-5 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Food log
          </div>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold text-[var(--ui-ink-strong)]">
            <span>Calories, macros, and meal evidence</span>
            <InfoTooltip
              label="Explain food log"
              content="The food log is today's editable record of what was eaten. Edit a meal to change quantities, remove items, correct food parameters, or delete the meal entirely."
            />
          </h2>
        </div>
        <Badge tone="meta">{ledger.meals.length} meals</Badge>
      </div>
      <div>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
              Eaten today
            </div>
            <div className="mt-1 text-2xl font-semibold text-[var(--ui-ink-strong)]">
              {formatKcal(totals.calories)}
            </div>
          </div>
          <div className="min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
              Target today
            </div>
            <div className="mt-1 text-2xl font-semibold text-[var(--ui-ink-strong)]">
              {formatKcal(ledger.targetCalories)}
            </div>
          </div>
          <div
            className={cn(
              "min-w-0 rounded-[8px] border p-3",
              remainingCalories >= 0
                ? "border-[color-mix(in_srgb,var(--success)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-success-soft)]"
                : "border-[color-mix(in_srgb,var(--danger)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-danger-soft)]"
            )}
          >
            <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
              {remainingLabel(remainingCalories)}
            </div>
            <div className="mt-1 text-2xl font-semibold text-[var(--ui-ink-strong)]">
              {remainingValue(remainingCalories)}
            </div>
          </div>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-[var(--ui-surface-2)]">
          <div
            className={cn(
              "h-full rounded-full",
              remainingCalories >= 0
                ? "bg-[color-mix(in_srgb,var(--success)_82%,var(--secondary)_18%)]"
                : "bg-[color-mix(in_srgb,var(--danger)_82%,var(--tertiary)_18%)]"
            )}
            style={{ width: `${Math.min(100, intakePercent)}%` }}
          />
        </div>
        <div className="mt-3 grid gap-2 text-sm text-[var(--ui-ink-soft)] sm:grid-cols-4">
          <span>{totals.carbohydrateGrams.toFixed(0)}g carbs</span>
          <span>{totals.fatGrams.toFixed(0)}g fat</span>
          <span>{totals.fiberGrams.toFixed(0)}g fiber</span>
          <span>{ledger.unconfirmedCount} unconfirmed</span>
        </div>
      </div>
      <div className="grid gap-3">
        {ledger.meals.length > 0 ? (
          ledger.meals.map((meal) => (
            <WeightLossRecentMeal
              key={meal.id}
              meal={meal}
              pending={logSavedPending}
              onLogAgain={onLogAgain}
              onEdit={onEditMeal}
              onDelete={onDeleteMeal}
            />
          ))
        ) : (
          <WeightLossEmptyState>
            No meals logged today yet.
          </WeightLossEmptyState>
        )}
      </div>
    </Card>
  );
}
