import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuestionFlowDialog } from "@/components/flows/question-flow-dialog";
import { SurfacePanel } from "@/components/ui/surface";
import type { NutritionFoodLog } from "@/lib/weight-loss-types";

function mealDisplayTitle(meal: NutritionFoodLog) {
  const primaryItem = meal.items[0] ?? null;
  const extraItemCount = Math.max(0, meal.items.length - 1);
  return primaryItem
    ? `${primaryItem.name}${extraItemCount > 0 ? ` + ${extraItemCount} more` : ""}`
    : (meal.mealLabel ?? "Meal");
}

function mealDoseSummary(meal: NutritionFoodLog) {
  return meal.items
    .slice(0, 3)
    .map((item) => {
      const quantity =
        Number.isFinite(item.quantity) && item.quantity > 0
          ? Number.isInteger(item.quantity)
            ? String(item.quantity)
            : item.quantity.toFixed(2).replace(/\.?0+$/, "")
          : null;
      const unit = item.unit ?? "serving";
      const grams = item.grams != null ? `${item.grams.toFixed(0)}g` : null;
      return [quantity, unit, grams ? `(${grams})` : null]
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean)
    .join(" · ");
}

export function WeightLossHistoryDialog({
  open,
  onOpenChange,
  meals,
  onLogAgain,
  onEdit,
  onDelete,
  pending
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meals: NutritionFoodLog[];
  onLogAgain: (meal: NutritionFoodLog) => void;
  onEdit: (meal: NutritionFoodLog) => void;
  onDelete: (meal: NutritionFoodLog) => void;
  pending: boolean;
}) {
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="History"
      title="Food history"
      description="Review recent foods and quickly log a previous meal again."
      value={{}}
      onChange={() => undefined}
      steps={[
        {
          id: "history",
          title: "Recent meal history",
          render: () => (
            <div className="grid gap-3">
              {meals.map((meal) => (
                <SurfacePanel key={meal.id} className="grid gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
                        {mealDisplayTitle(meal)}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">
                        {meal.loggedAt.slice(0, 10)} ·{" "}
                        {mealDoseSummary(meal) ||
                          meal.mealLabel ||
                          "No quantity recorded"}
                      </div>
                    </div>
                    <Badge tone="meta">
                      {meal.totals.calories.toFixed(0)} kcal
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => onEdit(meal)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      pending={pending}
                      onClick={() => onDelete(meal)}
                    >
                      Delete
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      pending={pending}
                      onClick={() => onLogAgain(meal)}
                    >
                      Log again
                    </Button>
                  </div>
                </SurfacePanel>
              ))}
            </div>
          )
        }
      ]}
      onSubmit={async () => onOpenChange(false)}
      submitLabel="Done"
    />
  );
}
