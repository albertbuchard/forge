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
import { InfoTooltip } from "@/components/ui/info-tooltip";
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
  const planStats = [
    {
      label: "Plan target",
      value: `${view.target.calorieTarget.toFixed(0)} kcal`
    },
    {
      label: "Protein",
      value: `${view.target.proteinGramsTarget.toFixed(0)}g`
    },
    {
      label: "Fiber",
      value: `${view.target.fiberGramsTarget.toFixed(0)}g`
    }
  ];

  return (
    <Card className="grid gap-4 border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] p-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
          <span>Control center</span>
          <InfoTooltip
            label="Explain weight-loss controls"
            content="Use these actions to change the nutrition plan, log food, or record body signals. The day budget cards above use today's active-calorie source; the plan target here is the baseline target before today's active adjustment."
          />
        </div>
        <h2 className="mt-1 text-xl font-semibold leading-tight text-[var(--ui-ink-strong)]">
          {view.target.bodyGoal
            ? `Goal: ${view.target.bodyGoal}`
            : "Set the body objective"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
          Adjust the baseline plan, log food with exact quantities, or record
          body signals from guided flows.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1 min-[1360px]:grid-cols-3">
        {planStats.map((stat) => (
          <div
            key={stat.label}
            className="min-w-0 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2"
          >
            <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
              {stat.label}
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-[var(--ui-ink-strong)]">
              {stat.value}
            </div>
          </div>
        ))}
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2">
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
