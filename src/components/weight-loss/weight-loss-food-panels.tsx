import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { NutritionFoodLog, WeightLossViewData } from "@/lib/weight-loss-types";
import { cn } from "@/lib/utils";
import { WeightLossEmptyState, WeightLossRecentMeal } from "./weight-loss-cards";

export function WeightLossLedgerPanel({
  ledger,
  remainingCalories,
  intakePercent,
  logSavedPending,
  onLogAgain
}: {
  ledger: WeightLossViewData["todayLedger"];
  remainingCalories: number;
  intakePercent: number;
  logSavedPending: boolean;
  onLogAgain: (meal: NutritionFoodLog) => void;
}) {
  const totals = ledger.totals;
  return (
    <Card className="grid gap-5 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Today ledger
          </div>
          <h2 className="mt-1 text-xl font-semibold text-[var(--ui-ink-strong)]">
            Calories, macros, and meal evidence
          </h2>
        </div>
        <Badge tone="meta">{ledger.meals.length} meals</Badge>
      </div>
      <div>
        <div className="h-3 overflow-hidden rounded-full bg-[var(--ui-surface-2)]">
          <div
            className={cn(
              "h-full rounded-full",
              remainingCalories >= 0
                ? "bg-[color-mix(in_srgb,#10b981_82%,var(--secondary)_18%)]"
                : "bg-[color-mix(in_srgb,#f43f5e_82%,var(--tertiary)_18%)]"
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
            />
          ))
        ) : (
          <WeightLossEmptyState>No meals logged today yet.</WeightLossEmptyState>
        )}
      </div>
    </Card>
  );
}
