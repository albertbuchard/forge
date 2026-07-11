import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuestionFlowDialog } from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { SurfacePanel } from "@/components/ui/surface";
import type { NutritionFoodLog } from "@/lib/weight-loss-types";

const FOOD_HISTORY_BATCH_SIZE = 20;

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

export function filterFoodHistory(meals: NutritionFoodLog[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return meals;
  }
  return meals.filter((meal) =>
    [
      meal.mealLabel,
      meal.notes,
      meal.loggedAt.slice(0, 10),
      ...meal.items.flatMap((item) => [item.name, item.brand])
    ].some((value) => value?.toLocaleLowerCase().includes(normalized))
  );
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
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(FOOD_HISTORY_BATCH_SIZE);
  useEffect(() => {
    if (open) {
      setQuery("");
      setVisibleCount(FOOD_HISTORY_BATCH_SIZE);
    }
  }, [open]);
  const filteredMeals = useMemo(
    () => filterFoodHistory(meals, query),
    [meals, query]
  );
  const visibleMeals = filteredMeals.slice(0, visibleCount);
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
              <div className="grid gap-2">
                <Input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setVisibleCount(FOOD_HISTORY_BATCH_SIZE);
                  }}
                  placeholder="Search foods, meal labels, notes, or dates"
                  aria-label="Search food history"
                />
                <div className="text-xs text-[var(--ui-ink-faint)]">
                  Showing {visibleMeals.length} of {filteredMeals.length}{" "}
                  matching meals
                </div>
              </div>
              {visibleMeals.map((meal) => (
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
              {visibleMeals.length === 0 ? (
                <SurfacePanel className="text-sm text-[var(--ui-ink-soft)]">
                  No meal history matches this search.
                </SurfacePanel>
              ) : null}
              {visibleCount < filteredMeals.length ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setVisibleCount((current) =>
                      Math.min(
                        filteredMeals.length,
                        current + FOOD_HISTORY_BATCH_SIZE
                      )
                    )
                  }
                >
                  Show next meals
                </Button>
              ) : null}
            </div>
          )
        }
      ]}
      onSubmit={async () => onOpenChange(false)}
      submitLabel="Done"
    />
  );
}

export function WeightLossDeleteFoodLogDialog({
  meal,
  open,
  onOpenChange,
  onConfirm,
  pending,
  error
}: {
  meal: NutritionFoodLog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  pending: boolean;
  error?: string | null;
}) {
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Food history"
      title="Delete food log"
      description="Review the exact entry before removing it from the nutrition ledger."
      value={{ mealId: meal?.id ?? "" }}
      onChange={() => undefined}
      steps={[
        {
          id: "confirm",
          eyebrow: "Confirmation",
          title: meal
            ? `Delete ${mealDisplayTitle(meal)}?`
            : "Select a food log",
          description:
            "This removes the stored meal and changes the calories, nutrients, and evidence for that day.",
          render: () =>
            meal ? (
              <SurfacePanel className="grid gap-2">
                <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
                  {mealDisplayTitle(meal)}
                </div>
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  {meal.loggedAt.slice(0, 10)} ·{" "}
                  {meal.totals.calories.toFixed(0)} kcal
                </div>
                <div className="text-xs text-[var(--ui-ink-faint)]">
                  {mealDoseSummary(meal) || "No quantity recorded"}
                </div>
              </SurfacePanel>
            ) : null
        }
      ]}
      onSubmit={onConfirm}
      submitLabel="Delete food log"
      pending={pending}
      pendingLabel="Deleting food log"
      error={error}
    />
  );
}
