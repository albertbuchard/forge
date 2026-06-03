import { useMemo, useState } from "react";
import { Info, Plus, Search, Trash2 } from "lucide-react";
import {
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SurfacePanel, SurfaceStat } from "@/components/ui/surface";
import { Textarea } from "@/components/ui/textarea";
import type {
  NutritionFoodLogInput,
  NutritionFoodSearchResult
} from "@/lib/weight-loss-types";
import { formatNumber } from "./weight-loss-format";

type FoodUnit = "serving" | "grams" | "unit" | "tsp" | "tbsp" | "cup";

export type WeightLossSelectedFood = {
  localId: string;
  food: NutritionFoodSearchResult;
  amount: string;
  unit: FoodUnit;
};

export type WeightLossFoodDraft = {
  mealLabel: string;
  notes: string;
  selectedItems: WeightLossSelectedFood[];
};

export function buildInitialFoodDraft(): WeightLossFoodDraft {
  return {
    mealLabel: "Meal",
    notes: "",
    selectedItems: []
  };
}

export function WeightLossFoodLogDialog({
  open,
  onOpenChange,
  value,
  onChange,
  foodResults,
  searchPending,
  logPending,
  onSearch,
  onSubmit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: WeightLossFoodDraft;
  onChange: (value: WeightLossFoodDraft) => void;
  foodResults: NutritionFoodSearchResult[];
  searchPending: boolean;
  logPending: boolean;
  onSearch: (query: string) => void;
  onSubmit: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [detailFood, setDetailFood] = useState<NutritionFoodSearchResult | null>(null);
  const totals = useMemo(() => sumSelectedFoods(value.selectedItems), [value.selectedItems]);
  const setDraft = (patch: Partial<WeightLossFoodDraft>) => onChange({ ...value, ...patch });
  const addFood = (food: NutritionFoodSearchResult) => {
    setDraft({
      selectedItems: [
        ...value.selectedItems,
        { localId: `${food.id}-${Date.now()}`, food, amount: "1", unit: "serving" }
      ]
    });
    setDetailFood(null);
  };
  const updateItem = (localId: string, patch: Partial<WeightLossSelectedFood>) => {
    setDraft({
      selectedItems: value.selectedItems.map((item) =>
        item.localId === localId ? { ...item, ...patch } : item
      )
    });
  };
  const removeItem = (localId: string) => {
    setDraft({ selectedItems: value.selectedItems.filter((item) => item.localId !== localId) });
  };
  const submitMeal = async () => {
    if (value.selectedItems.length === 0) return;
    await onSubmit();
  };
  const steps: Array<QuestionFlowStep<WeightLossFoodDraft>> = [
    {
      id: "search",
      eyebrow: "Food",
      title: "Search and inspect foods",
      description: "Click any food for full macro detail, then add one or several foods to the meal.",
      render: () => (
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search eggs, yogurt, sourdough..." />
            <Button type="button" variant="secondary" pending={searchPending} disabled={!query.trim()} onClick={() => onSearch(query)}>
              <Search className="size-4" />
              Search
            </Button>
          </div>
          {detailFood ? <FoodDetail food={detailFood} onAdd={() => addFood(detailFood)} /> : null}
          <div className="grid gap-3">
            {foodResults.map((food) => (
              <SurfacePanel key={food.id} interactive className="p-0">
                <button type="button" className="block w-full rounded-[22px] p-4 text-left" onClick={() => setDetailFood(food)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--ui-ink-strong)]">{food.name}</div>
                      <div className="mt-1 truncate text-xs text-[var(--ui-ink-faint)]">{[food.brand, food.servingLabel, food.source].filter(Boolean).join(" · ")}</div>
                    </div>
                    <Badge tone="meta">{formatNumber(food.calories)} kcal</Badge>
                  </div>
                </button>
              </SurfacePanel>
            ))}
          </div>
        </div>
      )
    },
    {
      id: "amounts",
      eyebrow: "Quantity",
      title: "Set exactly how much you ate",
      description: "Scale by grams, servings, household measures, or units before saving the meal.",
      render: (draft) => (
        <div className="grid gap-4">
          {draft.selectedItems.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-[var(--ui-border-strong)] bg-[var(--ui-surface-1)] p-5 text-sm text-[var(--ui-ink-soft)]">
              Add at least one food from the search step.
            </div>
          ) : null}
          {draft.selectedItems.map((item) => (
            <SurfacePanel key={item.localId} className="grid gap-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">{item.food.name}</div>
                  <div className="text-xs text-[var(--ui-ink-faint)]">Base: {formatNumber(item.food.calories)} kcal per {item.food.servingLabel ?? "serving"}</div>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => removeItem(item.localId)}>
                  <Trash2 className="size-4" />
                  Remove
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Input inputMode="decimal" value={item.amount} onChange={(event) => updateItem(item.localId, { amount: event.target.value })} placeholder="1" />
                <select className="interactive-tap w-full rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-[15px] text-[var(--ui-ink-strong)] outline-none" value={item.unit} onChange={(event) => updateItem(item.localId, { unit: event.target.value as FoodUnit })}>
                  <option value="serving">serving</option>
                  <option value="grams">grams</option>
                  <option value="unit">unit</option>
                  <option value="tsp">teaspoon</option>
                  <option value="tbsp">tablespoon</option>
                  <option value="cup">cup</option>
                </select>
                <Badge tone="signal">{formatNumber(scaleFood(item).calories)} kcal</Badge>
              </div>
            </SurfacePanel>
          ))}
          <div className="grid gap-3 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 md:grid-cols-4">
            <SurfaceStat label="Calories" value={formatNumber(totals.calories)} />
            <SurfaceStat label="Protein" value={`${formatNumber(totals.proteinGrams)}g`} />
            <SurfaceStat label="Carbs" value={`${formatNumber(totals.carbohydrateGrams)}g`} />
            <SurfaceStat label="Fat" value={`${formatNumber(totals.fatGrams)}g`} />
          </div>
        </div>
      )
    },
    {
      id: "context",
      eyebrow: "Context",
      title: "Meal label and notes",
      description: "Add how it felt, where it happened, or anything relevant to future pattern detection.",
      render: (draft, setDraftValue) => (
        <div className="grid gap-4">
          <FlowField label="Meal label">
            <Input value={draft.mealLabel} onChange={(event) => setDraftValue({ mealLabel: event.target.value })} placeholder="Breakfast" />
          </FlowField>
          <FlowField label="Notes">
            <Textarea value={draft.notes} onChange={(event) => setDraftValue({ notes: event.target.value })} placeholder="Energy, cravings, gut comfort, training effect..." />
          </FlowField>
        </div>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Food log"
      title="Add food"
      description="Search, inspect, scale, and save meal items."
      value={value}
      onChange={onChange}
      steps={steps}
      onSubmit={submitMeal}
      submitLabel="Save meal"
      pending={logPending}
      pendingLabel="Saving meal"
      resolveError={(stepId) =>
        stepId !== "search" && value.selectedItems.length === 0
          ? "Select at least one food before saving."
          : null
      }
      draftPersistenceKey="weight-loss-food-log"
    />
  );
}

export function buildFoodLogInput(draft: WeightLossFoodDraft): NutritionFoodLogInput {
  return {
    mealLabel: draft.mealLabel || "Meal",
    source: "search",
    confirmationState: "confirmed",
    notes: draft.notes || null,
    items: draft.selectedItems.map((item) => {
      const scaled = scaleFood(item);
      return {
        foodId: item.food.id,
        name: item.food.name,
        brand: item.food.brand,
        quantity: Number(item.amount) || 1,
        unit: item.unit,
        grams: scaled.grams,
        calories: scaled.calories,
        proteinGrams: scaled.proteinGrams,
        carbohydrateGrams: scaled.carbohydrateGrams,
        fatGrams: scaled.fatGrams,
        fiberGrams: scaled.fiberGrams,
        sugarGrams: scaled.sugarGrams,
        sodiumMg: scaled.sodiumMg,
        potassiumMg: scaled.potassiumMg,
        caffeineMg: scaled.caffeineMg,
        alcoholGrams: scaled.alcoholGrams,
        novaGroup: item.food.novaGroup,
        tags: item.food.tags,
        confidence: 0.9
      };
    })
  };
}

function FoodDetail({ food, onAdd }: { food: NutritionFoodSearchResult; onAdd: () => void }) {
  return (
    <Card className="grid gap-4 border-[var(--primary)]/20 bg-[var(--ui-accent-soft)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-[var(--ui-ink-strong)]">{food.name}</div>
          <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">{[food.brand, food.servingLabel, food.source].filter(Boolean).join(" · ")}</div>
        </div>
        <Button type="button" onClick={onAdd}>
          <Plus className="size-4" />
          Add
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <SurfaceStat label="Calories" value={formatNumber(food.calories)} />
        <SurfaceStat label="Protein" value={`${formatNumber(food.proteinGrams)}g`} />
        <SurfaceStat label="Carbs" value={`${formatNumber(food.carbohydrateGrams)}g`} />
        <SurfaceStat label="Fat" value={`${formatNumber(food.fatGrams)}g`} />
        <SurfaceStat label="Fiber" value={`${formatNumber(food.fiberGrams)}g`} />
        <SurfaceStat label="Sugar" value={`${formatNumber(food.sugarGrams)}g`} />
        <SurfaceStat label="Sodium" value={`${formatNumber(food.sodiumMg)}mg`} />
        <SurfaceStat label="NOVA" value={food.novaGroup ? String(food.novaGroup) : "n/a"} />
      </div>
      <div className="flex items-center gap-2 text-xs text-[var(--ui-ink-soft)]">
        <Info className="size-4" />
        Serving grams: {formatNumber(food.servingGrams)}. Adjust exact intake in the next step.
      </div>
    </Card>
  );
}

function scaleFood(item: WeightLossSelectedFood) {
  const amount = Number(item.amount) || 0;
  const baseGrams = item.food.servingGrams ?? null;
  const grams =
    item.unit === "grams"
      ? amount
      : item.unit === "tsp"
        ? amount * 5
        : item.unit === "tbsp"
          ? amount * 15
          : item.unit === "cup"
            ? amount * 240
            : baseGrams
              ? amount * baseGrams
              : null;
  const scale =
    item.unit === "grams" && baseGrams
      ? amount / baseGrams
      : ["tsp", "tbsp", "cup"].includes(item.unit) && baseGrams && grams
        ? grams / baseGrams
        : amount;
  const scaledNumber = (foodValue: number | null | undefined) =>
    typeof foodValue === "number" && Number.isFinite(foodValue)
      ? Math.round(foodValue * scale * 10) / 10
      : null;
  return {
    grams,
    calories: scaledNumber(item.food.calories),
    proteinGrams: scaledNumber(item.food.proteinGrams),
    carbohydrateGrams: scaledNumber(item.food.carbohydrateGrams),
    fatGrams: scaledNumber(item.food.fatGrams),
    fiberGrams: scaledNumber(item.food.fiberGrams),
    sugarGrams: scaledNumber(item.food.sugarGrams),
    sodiumMg: scaledNumber(item.food.sodiumMg),
    potassiumMg: scaledNumber(item.food.potassiumMg),
    caffeineMg: scaledNumber(item.food.caffeineMg),
    alcoholGrams: scaledNumber(item.food.alcoholGrams)
  };
}

function sumSelectedFoods(items: WeightLossSelectedFood[]) {
  return items.reduce(
    (sum, item) => {
      const scaled = scaleFood(item);
      return {
        calories: sum.calories + (scaled.calories ?? 0),
        proteinGrams: sum.proteinGrams + (scaled.proteinGrams ?? 0),
        carbohydrateGrams: sum.carbohydrateGrams + (scaled.carbohydrateGrams ?? 0),
        fatGrams: sum.fatGrams + (scaled.fatGrams ?? 0)
      };
    },
    { calories: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 }
  );
}
