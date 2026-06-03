import type { ComponentType, SVGProps } from "react";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SurfacePanel } from "@/components/ui/surface";
import type { NutritionFoodLog } from "@/lib/weight-loss-types";
import { cn } from "@/lib/utils";

type WeightLossIcon = ComponentType<SVGProps<SVGSVGElement>>;

const toneClasses = {
  default:
    "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-[var(--primary)]",
  green:
    "bg-[color-mix(in_srgb,#10b981_16%,transparent)] text-[color-mix(in_srgb,#10b981_78%,var(--ui-ink-strong)_22%)]",
  amber:
    "bg-[color-mix(in_srgb,#f59e0b_17%,transparent)] text-[color-mix(in_srgb,#f59e0b_76%,var(--ui-ink-strong)_24%)]",
  rose:
    "bg-[color-mix(in_srgb,#f43f5e_16%,transparent)] text-[color-mix(in_srgb,#f43f5e_76%,var(--ui-ink-strong)_24%)]",
  cyan:
    "bg-[color-mix(in_srgb,#06b6d4_16%,transparent)] text-[color-mix(in_srgb,#06b6d4_78%,var(--ui-ink-strong)_22%)]"
} as const;

export type WeightLossTone = keyof typeof toneClasses;

export function WeightLossInsightMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default"
}: {
  label: string;
  value: string;
  detail: string;
  icon: WeightLossIcon;
  tone?: WeightLossTone;
}) {
  return (
    <Card className="grid gap-4 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className={cn("rounded-2xl p-2.5", toneClasses[tone])}>
          <Icon className="size-5" />
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
          {label}
        </div>
      </div>
      <div>
        <div className="text-3xl font-semibold text-[var(--ui-ink-strong)]">
          {value}
        </div>
        <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
          {detail}
        </p>
      </div>
    </Card>
  );
}

export function WeightLossRecentMeal({
  meal,
  onLogAgain,
  pending = false
}: {
  meal: NutritionFoodLog;
  onLogAgain?: (meal: NutritionFoodLog) => void;
  pending?: boolean;
}) {
  const firstItems = meal.items.slice(0, 3).map((item) => item.name).join(", ");
  return (
    <SurfacePanel className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--ui-ink-strong)]">
            {meal.mealLabel ?? "Meal"}
          </div>
          <div className="truncate text-xs text-[var(--ui-ink-faint)]">
            {firstItems || meal.notes || "No items"}
          </div>
        </div>
        <Badge tone="meta">{meal.totals.calories.toFixed(0)} kcal</Badge>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs text-[var(--ui-ink-soft)]">
        <span>{meal.totals.proteinGrams.toFixed(0)}g protein</span>
        <span>{meal.totals.fiberGrams.toFixed(0)}g fiber</span>
        <span>{meal.confirmationState}</span>
      </div>
      {onLogAgain ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          pending={pending}
          onClick={() => onLogAgain(meal)}
        >
          <RotateCcw className="size-4" />
          Log again
        </Button>
      ) : null}
    </SurfacePanel>
  );
}

export function WeightLossEmptyState({ children }: { children: string }) {
  return (
    <SurfacePanel className="border-dashed border-[var(--ui-border-strong)] p-5 text-sm text-[var(--ui-ink-soft)]">
      {children}
    </SurfacePanel>
  );
}
