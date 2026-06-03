import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuestionFlowDialog } from "@/components/flows/question-flow-dialog";
import { SurfacePanel } from "@/components/ui/surface";
import type { NutritionFoodLog } from "@/lib/weight-loss-types";

export function WeightLossHistoryDialog({
  open,
  onOpenChange,
  meals,
  onLogAgain,
  pending
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meals: NutritionFoodLog[];
  onLogAgain: (meal: NutritionFoodLog) => void;
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
                      <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">{meal.mealLabel ?? "Meal"}</div>
                      <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">{meal.loggedAt.slice(0, 10)} · {meal.items.map((item) => item.name).slice(0, 3).join(", ")}</div>
                    </div>
                    <Badge tone="meta">{meal.totals.calories.toFixed(0)} kcal</Badge>
                  </div>
                  <Button type="button" size="sm" variant="secondary" pending={pending} onClick={() => onLogAgain(meal)}>
                    Log again
                  </Button>
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
