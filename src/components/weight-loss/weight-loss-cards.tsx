import type { ComponentType, ReactNode, SVGProps } from "react";
import { Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { SurfacePanel } from "@/components/ui/surface";
import type { NutritionFoodLog } from "@/lib/weight-loss-types";
import { cn } from "@/lib/utils";

type WeightLossIcon = ComponentType<SVGProps<SVGSVGElement>>;

const toneClasses = {
  default:
    "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-[var(--primary)]",
  green:
    "bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_78%,var(--ui-ink-strong)_22%)]",
  amber:
    "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_76%,var(--ui-ink-strong)_24%)]",
  rose: "bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]",
  cyan: "bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_78%,var(--ui-ink-strong)_22%)]"
} as const;

export type WeightLossTone = keyof typeof toneClasses;

export function WeightLossInsightMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
  help,
  helpMaxWidthPx
}: {
  label: string;
  value: string;
  detail: string;
  icon: WeightLossIcon;
  tone?: WeightLossTone;
  help?: ReactNode;
  helpMaxWidthPx?: number;
}) {
  return (
    <Card className="grid gap-4 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className={cn("rounded-2xl p-2.5", toneClasses[tone])}>
          <Icon className="size-5" />
        </div>
        <div className="flex items-center justify-end gap-1 text-right text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
          <span>{label}</span>
          {help ? (
            <InfoTooltip
              content={help}
              label={`Explain ${label}`}
              maxWidthPx={helpMaxWidthPx}
            />
          ) : null}
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
  onEdit,
  onDelete,
  pending = false
}: {
  meal: NutritionFoodLog;
  onLogAgain?: (meal: NutritionFoodLog) => void;
  onEdit?: (meal: NutritionFoodLog) => void;
  onDelete?: (meal: NutritionFoodLog) => void;
  pending?: boolean;
}) {
  const primaryItem = meal.items[0] ?? null;
  const extraItemCount = Math.max(0, meal.items.length - 1);
  const title = primaryItem
    ? `${primaryItem.name}${extraItemCount > 0 ? ` + ${extraItemCount} more` : ""}`
    : (meal.mealLabel ?? "Meal");
  const doseSummary = meal.items
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
  return (
    <SurfacePanel className="grid min-w-0 gap-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words text-base font-semibold leading-6 text-[var(--ui-ink-strong)]">
            {title}
          </div>
          <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-faint)]">
            {doseSummary || meal.notes || "No quantity recorded"}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {meal.mealLabel ? <Badge tone="meta">{meal.mealLabel}</Badge> : null}
          <Badge tone="meta">{meal.totals.calories.toFixed(0)} kcal</Badge>
        </div>
      </div>
      <div className="grid gap-2 text-xs text-[var(--ui-ink-soft)] sm:grid-cols-3 xl:grid-cols-6">
        <span>{meal.totals.proteinGrams.toFixed(0)}g protein</span>
        <span>{meal.totals.carbohydrateGrams.toFixed(0)}g carbs</span>
        <span>{meal.totals.fatGrams.toFixed(0)}g fat</span>
        <span>{meal.totals.fiberGrams.toFixed(0)}g fiber</span>
        <span>{meal.totals.sodiumMg.toFixed(0)}mg sodium</span>
        <span>{meal.confirmationState}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {onEdit ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onEdit(meal)}
          >
            <Pencil className="size-4" />
            Edit
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            pending={pending}
            onClick={() => onDelete(meal)}
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
        ) : null}
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
      </div>
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
