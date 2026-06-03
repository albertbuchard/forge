import {
  History,
  Plus,
  Ruler,
  Search,
  Settings2,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { WeightLossViewData } from "@/lib/weight-loss-types";

export function WeightLossActionPanel({
  view,
  onOpenPlan,
  onOpenFoodSearch,
  onOpenCustomFood,
  onOpenChatGptFood,
  onOpenCheckin,
  onOpenHistory
}: {
  view: WeightLossViewData;
  onOpenPlan: () => void;
  onOpenFoodSearch: () => void;
  onOpenCustomFood: () => void;
  onOpenChatGptFood: () => void;
  onOpenCheckin: () => void;
  onOpenHistory: () => void;
}) {
  return (
    <Card className="grid gap-4 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
          Control center
        </div>
        <h2 className="mt-1 text-xl font-semibold text-[var(--ui-ink-strong)]">
          {view.target.bodyGoal
            ? `Goal: ${view.target.bodyGoal}`
            : "Set the body objective"}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
          Current target: {view.target.calorieTarget.toFixed(0)} kcal,{" "}
          {view.target.proteinGramsTarget.toFixed(0)}g protein,{" "}
          {view.target.fiberGramsTarget.toFixed(0)}g fiber. Adjust the plan, add
          food with exact quantities, or record body signals from guided flows.
        </p>
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <Button type="button" onClick={onOpenCustomFood}>
          <Plus className="size-4" />
          Custom food
        </Button>
        <Button type="button" variant="secondary" onClick={onOpenChatGptFood}>
          <Sparkles className="size-4" />
          Ask ChatGPT
        </Button>
        <Button type="button" variant="secondary" onClick={onOpenFoodSearch}>
          <Search className="size-4" />
          Search food
        </Button>
        <Button type="button" variant="secondary" onClick={onOpenPlan}>
          <Settings2 className="size-4" />
          Plan settings
        </Button>
        <Button type="button" variant="secondary" onClick={onOpenCheckin}>
          <Ruler className="size-4" />
          Add measure
        </Button>
        <Button type="button" variant="secondary" onClick={onOpenHistory}>
          <History className="size-4" />
          Food history
        </Button>
      </div>
    </Card>
  );
}
