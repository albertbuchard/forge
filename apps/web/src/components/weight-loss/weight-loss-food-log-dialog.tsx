import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Info,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2
} from "lucide-react";
import {
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { SurfacePanel, SurfaceStat } from "@/components/ui/surface";
import { Textarea } from "@/components/ui/textarea";
import type {
  NutritionFoodLog,
  NutritionFoodLogInput,
  NutritionFoodLogPatchInput,
  NutritionMealItemInput,
  NutritionMealItem,
  NutritionFoodSearchResult
} from "@/lib/weight-loss-types";
import { formatMeasurement, formatNumber } from "./weight-loss-format";

type FoodUnit = "serving" | "grams" | "unit" | "tsp" | "tbsp" | "cup";
export type WeightLossFoodLogIntent = "search" | "custom" | "chatgpt";

const HOUSEHOLD_GRAM_EQUIVALENTS: Record<"tsp" | "tbsp" | "cup", number> = {
  tsp: 5,
  tbsp: 15,
  cup: 240
};

export type WeightLossSelectedFood = {
  localId: string;
  food: NutritionFoodSearchResult;
  amount: string;
  unit: FoodUnit;
};

export type WeightLossFoodDraft = {
  mealLabel: string;
  notes: string;
  loggedAt?: string;
  dayKey?: string | null;
  timeZone?: string;
  source?: NutritionFoodLogInput["source"];
  selectedItems: WeightLossSelectedFood[];
};

export type WeightLossFoodParseSummary = {
  itemCount: number;
  completeNutritionItemCount: number;
  catalogResolvedItemCount: number;
  chatGptEstimatedItemCount: number;
  chatGptValidatedItemCount: number;
  elapsedMs: number;
  llmCallCount: number;
};

export type WeightLossFoodParseFeedback = {
  status: "idle" | "parsing" | "success" | "error";
  summary?: WeightLossFoodParseSummary;
  message?: string;
};

function foodCandidateKey(food: NutritionFoodSearchResult) {
  if (food.barcode?.trim()) {
    return `barcode:${food.barcode.trim()}`;
  }
  if (food.sourceId?.trim()) {
    return `source:${food.source}:${food.sourceId.trim()}`;
  }
  return [
    food.name.trim().toLocaleLowerCase(),
    food.brand?.trim().toLocaleLowerCase() ?? "",
    food.servingGrams ?? "",
    food.servingLabel?.trim().toLocaleLowerCase() ?? ""
  ].join("|");
}

function foodCandidateCompleteness(food: NutritionFoodSearchResult) {
  return [
    food.calories,
    food.proteinGrams,
    food.carbohydrateGrams,
    food.fatGrams,
    food.fiberGrams,
    food.sodiumMg
  ].filter((value) => value != null && Number.isFinite(value)).length;
}

export function deduplicateFoodResults(results: NutritionFoodSearchResult[]) {
  const byKey = new Map<string, NutritionFoodSearchResult>();
  for (const food of results) {
    const key = foodCandidateKey(food);
    const current = byKey.get(key);
    if (
      !current ||
      foodCandidateCompleteness(food) > foodCandidateCompleteness(current) ||
      (foodCandidateCompleteness(food) === foodCandidateCompleteness(current) &&
        (food.confidence ?? 0) > (current.confidence ?? 0))
    ) {
      byKey.set(key, food);
    }
  }
  return [...byKey.values()];
}

export function buildInitialFoodDraft(): WeightLossFoodDraft {
  return {
    mealLabel: "",
    notes: "",
    source: "search",
    selectedItems: []
  };
}

function perQuantityValue(
  value: number | null | undefined,
  quantity: number,
  unit: string | null | undefined
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (normalizeFoodUnit(unit) === "grams") {
    return value;
  }
  return quantity > 0 ? Math.round((value / quantity) * 10) / 10 : value;
}

function foodResultFromMealItem(
  item: NutritionMealItem
): NutritionFoodSearchResult {
  const quantity =
    Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
  const unit = item.unit ?? "serving";
  const servingGrams =
    unit === "grams"
      ? (item.grams ?? quantity)
      : item.grams != null && quantity > 0
        ? item.grams / quantity
        : item.grams;
  return {
    id: item.foodId ?? item.id,
    source: "saved_meal",
    sourceId: item.foodId ?? item.id,
    name: item.name,
    brand: item.brand ?? null,
    barcode: null,
    servingLabel: unit,
    servingGrams: servingGrams ?? null,
    calories: perQuantityValue(item.calories, quantity, unit),
    proteinGrams: perQuantityValue(item.proteinGrams, quantity, unit),
    carbohydrateGrams: perQuantityValue(item.carbohydrateGrams, quantity, unit),
    fatGrams: perQuantityValue(item.fatGrams, quantity, unit),
    fiberGrams: perQuantityValue(item.fiberGrams, quantity, unit),
    sugarGrams: perQuantityValue(item.sugarGrams, quantity, unit),
    sodiumMg: perQuantityValue(item.sodiumMg, quantity, unit),
    potassiumMg: perQuantityValue(item.potassiumMg, quantity, unit),
    caffeineMg: perQuantityValue(item.caffeineMg, quantity, unit),
    alcoholGrams: perQuantityValue(item.alcoholGrams, quantity, unit),
    glycemicIndex: item.glycemicIndex ?? null,
    novaGroup: item.novaGroup ?? null,
    tags: item.tags ?? [],
    confidence: item.confidence ?? null
  };
}

function foodResultFromMealItemInput(
  item: NutritionMealItemInput,
  fallbackIndex: number,
  source: string
): NutritionFoodSearchResult {
  const quantity =
    Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
  const unit = item.unit ?? "serving";
  const servingGrams =
    unit === "grams" || unit === "g"
      ? (item.grams ?? quantity)
      : item.grams != null && quantity > 0
        ? item.grams / quantity
        : item.grams;
  return {
    id: item.foodId ?? `${source}_${fallbackIndex}_${Date.now()}`,
    source,
    sourceId: item.foodId ?? null,
    name: item.name,
    brand: item.brand ?? null,
    barcode: null,
    servingLabel: unit,
    servingGrams: servingGrams ?? null,
    calories: perQuantityValue(item.calories, quantity, unit),
    proteinGrams: perQuantityValue(item.proteinGrams, quantity, unit),
    carbohydrateGrams: perQuantityValue(item.carbohydrateGrams, quantity, unit),
    fatGrams: perQuantityValue(item.fatGrams, quantity, unit),
    fiberGrams: perQuantityValue(item.fiberGrams, quantity, unit),
    sugarGrams: perQuantityValue(item.sugarGrams, quantity, unit),
    sodiumMg: perQuantityValue(item.sodiumMg, quantity, unit),
    potassiumMg: perQuantityValue(item.potassiumMg, quantity, unit),
    caffeineMg: perQuantityValue(item.caffeineMg, quantity, unit),
    alcoholGrams: perQuantityValue(item.alcoholGrams, quantity, unit),
    glycemicIndex: item.glycemicIndex ?? null,
    novaGroup: item.novaGroup ?? null,
    tags: item.tags ?? [],
    confidence: item.confidence ?? null
  };
}

function parseGramQuantity(label: string | null | undefined) {
  if (!label) return null;
  const normalized = label.toLowerCase().replace(",", ".");
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(kg|g|gram|grams|ml|l)\b/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2];
  if (unit === "kg" || unit === "l") return value * 1000;
  return value;
}

function getFoodBaseGrams(food: NutritionFoodSearchResult) {
  if (
    typeof food.servingGrams === "number" &&
    Number.isFinite(food.servingGrams) &&
    food.servingGrams > 0
  ) {
    return food.servingGrams;
  }
  return parseGramQuantity(food.servingLabel);
}

function formatBaseAmount(food: NutritionFoodSearchResult) {
  const baseGrams = getFoodBaseGrams(food);
  if (baseGrams != null) return `${formatNumber(baseGrams)} g`;
  return food.servingLabel ?? "serving";
}

function getEatenGramEquivalent(item: WeightLossSelectedFood) {
  const amount = Number(item.amount) || 0;
  if (amount <= 0) return null;
  const baseGrams = getFoodBaseGrams(item.food);
  if (item.unit === "grams") return amount;
  if (item.unit === "tsp" || item.unit === "tbsp" || item.unit === "cup") {
    return amount * HOUSEHOLD_GRAM_EQUIVALENTS[item.unit];
  }
  return baseGrams != null ? amount * baseGrams : null;
}

function getUnitConversionWarning(item: WeightLossSelectedFood) {
  const needsGramBase =
    item.unit === "grams" ||
    item.unit === "tsp" ||
    item.unit === "tbsp" ||
    item.unit === "cup";
  if (!needsGramBase || getFoodBaseGrams(item.food) != null) return null;
  return "Add base grams before using grams or household measures. Without a denominator, Forge will not guess a ratio.";
}

function normalizeFoodUnit(unit: string | null | undefined): FoodUnit {
  const normalized = unit?.trim().toLowerCase();
  if (normalized === "g" || normalized === "gram" || normalized === "grams") {
    return "grams";
  }
  if (normalized === "tsp" || normalized === "teaspoon") {
    return "tsp";
  }
  if (normalized === "tbsp" || normalized === "tablespoon") {
    return "tbsp";
  }
  if (normalized === "cup") {
    return "cup";
  }
  if (normalized === "serving" || normalized === "servings") {
    return "serving";
  }
  return "unit";
}

function normalizeFoodSource(
  source: string | null | undefined
): NutritionFoodLogInput["source"] {
  switch (source) {
    case "manual":
    case "search":
    case "barcode":
    case "chatgpt":
    case "photo":
    case "saved_meal":
      return source;
    default:
      return "manual";
  }
}

export function buildFoodDraftFromLog(
  meal: NutritionFoodLog
): WeightLossFoodDraft {
  return {
    mealLabel: meal.mealLabel ?? "",
    notes: meal.notes ?? "",
    loggedAt: meal.loggedAt,
    dayKey: meal.dayKey,
    source: normalizeFoodSource(meal.source),
    selectedItems: meal.items.map((item) => ({
      localId: item.id,
      food: foodResultFromMealItem(item),
      amount: String(item.quantity || 1),
      unit: (item.unit as FoodUnit | null) ?? "serving"
    }))
  };
}

export function buildFoodDraftFromInput(
  input: NutritionFoodLogInput,
  source = input.source ?? "manual"
): WeightLossFoodDraft {
  return {
    mealLabel: input.mealLabel ?? "",
    notes: input.notes ?? "",
    loggedAt: input.loggedAt,
    dayKey: input.dayKey,
    timeZone: input.timeZone,
    source: input.source ?? "manual",
    selectedItems: input.items.map((item, index) => ({
      localId: `${source}-${index}-${Date.now()}`,
      food: foodResultFromMealItemInput(item, index, source),
      amount: String(item.quantity || 1),
      unit: normalizeFoodUnit(item.unit)
    }))
  };
}

function buildCustomFoodResult(): NutritionFoodSearchResult {
  const id = `custom_food_${Date.now()}`;
  return {
    id,
    source: "manual",
    sourceId: null,
    name: "Custom food",
    brand: null,
    barcode: null,
    servingLabel: "100 g",
    servingGrams: 100,
    calories: null,
    proteinGrams: null,
    carbohydrateGrams: null,
    fatGrams: null,
    fiberGrams: null,
    sugarGrams: null,
    sodiumMg: null,
    potassiumMg: null,
    caffeineMg: null,
    alcoholGrams: null,
    glycemicIndex: null,
    novaGroup: null,
    tags: ["custom"],
    confidence: 1
  };
}

export function buildInitialCustomFoodDraft(): WeightLossFoodDraft {
  return {
    mealLabel: "",
    notes: "",
    source: "manual",
    selectedItems: [
      {
        localId: `custom-${Date.now()}`,
        food: buildCustomFoodResult(),
        amount: "100",
        unit: "grams"
      }
    ]
  };
}

const chatGptStages = [
  "Reading the meal text",
  "Searching nutrition catalogs",
  "Checking calories and macros",
  "Preparing the review draft"
] as const;

function formatElapsedSeconds(elapsedMs: number | undefined) {
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs)) {
    return null;
  }
  return `${Math.max(0.1, elapsedMs / 1000).toFixed(1)}s`;
}

function ChatGptParseStatusCard({
  feedback,
  pending,
  stageIndex
}: {
  feedback: WeightLossFoodParseFeedback | null | undefined;
  pending: boolean;
  stageIndex: number;
}) {
  if (!pending && feedback?.status !== "success") {
    return null;
  }

  if (pending) {
    const activeStage = chatGptStages[stageIndex] ?? chatGptStages[0];
    return (
      <div className="overflow-hidden rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ui-ink-strong)]">
          <LoaderCircle className="size-4 animate-spin text-[var(--primary)]" />
          {activeStage}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {chatGptStages.map((stage, index) => (
            <div
              key={stage}
              className={`h-1.5 rounded-full transition-colors duration-300 ${
                index <= stageIndex
                  ? "bg-[linear-gradient(90deg,var(--primary),var(--secondary))]"
                  : "bg-[var(--ui-surface-3)]"
              }`}
            />
          ))}
        </div>
        <div className="mt-2 text-xs leading-5 text-[var(--ui-ink-soft)]">
          Forge is parsing the text, matching foods, and refusing incomplete
          nutrition before it adds anything to the draft.
        </div>
      </div>
    );
  }

  const summary = feedback?.summary;
  if (!summary) {
    return null;
  }
  const elapsed = formatElapsedSeconds(summary.elapsedMs);
  return (
    <div className="rounded-[20px] border border-[color-mix(in_srgb,var(--success)_26%,var(--ui-border-subtle)_74%)] bg-[color-mix(in_srgb,var(--success)_10%,var(--ui-surface-1)_90%)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ui-ink-strong)]">
          <CheckCircle2 className="size-4 text-[var(--success)]" />
          {summary.itemCount} food{summary.itemCount === 1 ? "" : "s"} added to
          the draft
        </div>
        <Badge tone="signal">
          {summary.completeNutritionItemCount}/{summary.itemCount} complete
        </Badge>
      </div>
      <div className="mt-2 grid gap-2 text-xs leading-5 text-[var(--ui-ink-soft)] sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-3.5 text-[var(--secondary)]" />
          {summary.catalogResolvedItemCount} catalog match
          {summary.catalogResolvedItemCount === 1 ? "" : "es"} ·{" "}
          {summary.chatGptValidatedItemCount} model validation
          {summary.chatGptValidatedItemCount === 1 ? "" : "s"}
        </div>
        <div>
          {summary.llmCallCount} model call
          {summary.llmCallCount === 1 ? "" : "s"}
          {elapsed ? ` · ${elapsed}` : ""}
        </div>
      </div>
      <div className="mt-2 text-xs leading-5 text-[var(--ui-ink-soft)]">
        You can add more food here, or continue to review exact quantities and
        nutrients before saving.
      </div>
    </div>
  );
}

export function WeightLossFoodLogDialog({
  open,
  onOpenChange,
  value,
  onChange,
  foodResults,
  searchPending,
  chatGptPending = false,
  chatGptError = null,
  chatGptFeedback = null,
  saveError = null,
  logPending,
  onSearch,
  onParseWithChatGpt,
  onSubmit,
  mode = "create",
  intent = "search",
  initialStepId
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: WeightLossFoodDraft;
  onChange: (value: WeightLossFoodDraft) => void;
  foodResults: NutritionFoodSearchResult[];
  searchPending: boolean;
  chatGptPending?: boolean;
  chatGptError?: string | null;
  chatGptFeedback?: WeightLossFoodParseFeedback | null;
  saveError?: string | null;
  logPending: boolean;
  onSearch: (query: string) => void;
  onParseWithChatGpt?: (text: string) => Promise<void>;
  onSubmit: () => Promise<void>;
  mode?: "create" | "edit";
  intent?: WeightLossFoodLogIntent;
  initialStepId?: string;
}) {
  const [query, setQuery] = useState("");
  const [chatGptText, setChatGptText] = useState("");
  const [chatGptStageIndex, setChatGptStageIndex] = useState(0);
  const [detailFood, setDetailFood] =
    useState<NutritionFoodSearchResult | null>(null);
  const totals = useMemo(
    () => sumSelectedFoods(value.selectedItems),
    [value.selectedItems]
  );
  const uniqueFoodResults = useMemo(
    () => deduplicateFoodResults(foodResults),
    [foodResults]
  );
  const setDraft = (patch: Partial<WeightLossFoodDraft>) =>
    onChange({ ...value, ...patch });
  const addFood = (food: NutritionFoodSearchResult) => {
    setDraft({
      selectedItems: [
        ...value.selectedItems,
        {
          localId: `${food.id}-${Date.now()}`,
          food,
          amount: "1",
          unit: "serving"
        }
      ]
    });
    setDetailFood(null);
  };
  const addCustomFood = () => {
    addFood(buildCustomFoodResult());
  };
  const parseWithChatGpt = async () => {
    const trimmed = chatGptText.trim();
    if (!trimmed || !onParseWithChatGpt) return;
    await onParseWithChatGpt(trimmed);
    setChatGptText("");
  };
  const updateItem = (
    localId: string,
    patch: Partial<WeightLossSelectedFood>
  ) => {
    setDraft({
      selectedItems: value.selectedItems.map((item) =>
        item.localId === localId ? { ...item, ...patch } : item
      )
    });
  };
  const updateFood = (
    localId: string,
    patch: Partial<NutritionFoodSearchResult>
  ) => {
    setDraft({
      selectedItems: value.selectedItems.map((item) =>
        item.localId === localId
          ? { ...item, food: { ...item.food, ...patch } }
          : item
      )
    });
  };
  const removeItem = (localId: string) => {
    setDraft({
      selectedItems: value.selectedItems.filter(
        (item) => item.localId !== localId
      )
    });
  };
  const submitMeal = async () => {
    if (value.selectedItems.length === 0) return;
    if (getFoodDraftNutritionError(value)) return;
    await onSubmit();
  };
  useEffect(() => {
    if (!chatGptPending) {
      setChatGptStageIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setChatGptStageIndex((current) => (current + 1) % chatGptStages.length);
    }, 1250);
    return () => window.clearInterval(timer);
  }, [chatGptPending]);

  const nutritionError = getFoodDraftNutritionError(value);
  const chatGptPanel = (
    <SurfacePanel className="grid gap-3">
      <FlowField
        label="Ask ChatGPT"
        labelHelp="Uses the connected OpenAI Codex OAuth / ChatGPT subscription model to create a reviewable candidate meal draft. It does not use the metered OpenAI Platform API."
      >
        <Textarea
          value={chatGptText}
          onChange={(event) => setChatGptText(event.target.value)}
          placeholder="Example: 2 eggs, 150g Greek yogurt, one banana, and a cappuccino..."
        />
      </FlowField>
      {chatGptError ? (
        <div className="rounded-[18px] border border-[var(--ui-danger-soft)] bg-[var(--ui-danger-soft)] px-3 py-2 text-xs leading-5 text-[var(--ui-ink)]">
          {chatGptError}
        </div>
      ) : null}
      <ChatGptParseStatusCard
        feedback={chatGptFeedback}
        pending={chatGptPending}
        stageIndex={chatGptStageIndex}
      />
      <Button
        type="button"
        variant={intent === "chatgpt" ? "primary" : "secondary"}
        pending={chatGptPending}
        pendingLabel="Parsing"
        disabled={!chatGptText.trim() || !onParseWithChatGpt}
        onClick={() => void parseWithChatGpt()}
      >
        <Sparkles className="size-4" />
        Parse with ChatGPT
      </Button>
    </SurfacePanel>
  );

  const customFoodPanel = (
    <SurfacePanel className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
            Create custom food
          </div>
          <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
            Start from a blank food, then define base grams, calories, macros,
            sodium, and exact quantity in the next step.
          </div>
        </div>
        <Button type="button" size="sm" onClick={addCustomFood}>
          <Plus className="size-4" />
          Add custom
        </Button>
      </div>
    </SurfacePanel>
  );

  const assistantPanels =
    intent === "chatgpt"
      ? [chatGptPanel, customFoodPanel]
      : [customFoodPanel, chatGptPanel];

  const steps: Array<QuestionFlowStep<WeightLossFoodDraft>> = [
    {
      id: "search",
      eyebrow: intent === "chatgpt" ? "ChatGPT food parser" : "Food",
      title:
        intent === "chatgpt"
          ? "Describe the meal, then review every item"
          : "Search, create, or ask ChatGPT",
      description:
        intent === "chatgpt"
          ? "ChatGPT creates a candidate meal through the subscription-backed connection; you still review quantities and nutrients before saving."
          : "Search the catalog, create a custom food, or use ChatGPT to turn rough meal text into editable items.",
      render: () => (
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <FlowField
              label="Food search"
              labelHelp="Search returns food candidates with per-serving nutrition. Click a result to inspect macros before adding it to the meal draft."
            >
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search eggs, yogurt, sourdough..."
              />
            </FlowField>
            <Button
              type="button"
              variant="secondary"
              pending={searchPending}
              disabled={!query.trim()}
              onClick={() => onSearch(query)}
            >
              <Search className="size-4" />
              Search
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {assistantPanels.map((panel, index) => (
              <div key={`${intent}-assistant-panel-${index}`}>{panel}</div>
            ))}
          </div>
          {detailFood ? (
            <FoodDetail food={detailFood} onAdd={() => addFood(detailFood)} />
          ) : null}
          <div className="grid gap-3">
            {foodResults.length > uniqueFoodResults.length ? (
              <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2 text-xs leading-5 text-[var(--ui-ink-soft)]">
                {foodResults.length - uniqueFoodResults.length} duplicate
                catalog candidate
                {foodResults.length - uniqueFoodResults.length === 1
                  ? " was"
                  : "s were"}{" "}
                merged before display.
              </div>
            ) : null}
            {uniqueFoodResults.map((food) => (
              <SurfacePanel key={food.id} interactive className="p-0">
                <button
                  type="button"
                  className="block w-full rounded-[22px] p-4 text-left"
                  onClick={() => setDetailFood(food)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--ui-ink-strong)]">
                        {food.name}
                      </div>
                      <div className="mt-1 truncate text-xs text-[var(--ui-ink-faint)]">
                        {[food.brand, food.servingLabel, food.source]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <Badge tone="meta">
                      {formatNumber(food.calories)} kcal
                    </Badge>
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
      eyebrow: intent === "custom" ? "Custom food" : "Quantity",
      title:
        intent === "custom"
          ? "Define the food and exact dose"
          : "Set exactly how much you ate",
      description:
        "Scale by grams, servings, household measures, or units before saving the meal.",
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
                  <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
                    {item.food.name}
                  </div>
                  <div className="text-xs text-[var(--ui-ink-faint)]">
                    Base: {formatNumber(item.food.calories)} kcal per{" "}
                    {formatBaseAmount(item.food)}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removeItem(item.localId)}
                >
                  <Trash2 className="size-4" />
                  Remove
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <FlowField
                  label="Quantity"
                  labelHelp="This is the amount actually eaten. Forge converts the selected unit to an eaten gram equivalent when base grams are known, then scales every nutrient by eaten grams divided by base grams."
                >
                  <Input
                    inputMode="decimal"
                    value={item.amount}
                    onChange={(event) =>
                      updateItem(item.localId, { amount: event.target.value })
                    }
                    placeholder="1"
                  />
                </FlowField>
                <FlowField
                  label="Unit"
                  labelHelp="Servings multiply the base serving. Grams, teaspoons, tablespoons, and cups use a gram conversion table and require base grams."
                >
                  <select
                    className="interactive-tap w-full rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-[15px] text-[var(--ui-ink-strong)] outline-none"
                    value={item.unit}
                    onChange={(event) =>
                      updateItem(item.localId, {
                        unit: event.target.value as FoodUnit
                      })
                    }
                  >
                    <option value="serving">serving</option>
                    <option value="grams">grams</option>
                    <option value="unit">unit</option>
                    <option value="tsp">teaspoon</option>
                    <option value="tbsp">tablespoon</option>
                    <option value="cup">cup</option>
                  </select>
                </FlowField>
                <Badge tone="signal">
                  {formatNumber(scaleFood(item).calories)} kcal
                </Badge>
              </div>
              {getUnitConversionWarning(item) ? (
                <div className="rounded-[18px] border border-[var(--ui-warning-soft)] bg-[var(--ui-warning-soft)] px-3 py-2 text-xs leading-5 text-[var(--ui-ink)]">
                  {getUnitConversionWarning(item)}
                </div>
              ) : (
                <div className="text-xs text-[var(--ui-ink-faint)]">
                  {formatNumber(Number(item.amount) || 0)} {item.unit} ={" "}
                  {formatNumber(getEatenGramEquivalent(item))} g eaten; ratio ={" "}
                  {formatNumber(scaleFood(item).scale)}x the base nutrition.
                </div>
              )}
              <FoodParameterEditor
                item={item}
                onChange={(patch) => updateFood(item.localId, patch)}
              />
            </SurfacePanel>
          ))}
          <div className="grid gap-3 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 md:grid-cols-4">
            <SurfaceStat
              label="Calories"
              value={formatNumber(totals.calories)}
            />
            <SurfaceStat
              label="Protein"
              value={`${formatNumber(totals.proteinGrams)}g`}
            />
            <SurfaceStat
              label="Carbs"
              value={`${formatNumber(totals.carbohydrateGrams)}g`}
            />
            <SurfaceStat
              label="Fat"
              value={`${formatNumber(totals.fatGrams)}g`}
            />
          </div>
          {nutritionError ? (
            <div className="rounded-[20px] border border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm leading-6 text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]">
              {nutritionError}
            </div>
          ) : null}
        </div>
      )
    },
    {
      id: "context",
      eyebrow: "Context",
      title: "Meal label and notes",
      description:
        "Add how it felt, where it happened, or anything relevant to future pattern detection.",
      render: (draft, setDraftValue) => (
        <div className="grid gap-4">
          <FlowField
            label="Meal marker (optional)"
            labelHelp="Use a marker such as breakfast, lunch, snack, or dinner when it helps group the day. Leave it blank when the log should stand alone without a meal label."
          >
            <div className="mb-2 flex flex-wrap gap-2">
              {["Breakfast", "Lunch", "Dinner", "Snack"].map((label) => (
                <Button
                  key={label}
                  type="button"
                  size="sm"
                  variant={draft.mealLabel === label ? "primary" : "secondary"}
                  onClick={() => setDraftValue({ mealLabel: label })}
                >
                  {label}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setDraftValue({ mealLabel: "" })}
              >
                Clear
              </Button>
            </div>
            <Input
              value={draft.mealLabel}
              onChange={(event) =>
                setDraftValue({ mealLabel: event.target.value })
              }
              placeholder="Breakfast, lunch, snack, dinner, or blank"
            />
          </FlowField>
          <FlowField
            label="Notes"
            labelHelp="Use notes for context the numbers do not capture: hunger, cravings, gut comfort, energy, timing, place, or workout relationship."
          >
            <Textarea
              value={draft.notes}
              onChange={(event) => setDraftValue({ notes: event.target.value })}
              placeholder="Energy, cravings, gut comfort, training effect..."
            />
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
      title={mode === "edit" ? "Edit food" : "Add food"}
      description="Search, inspect, scale, edit nutrition parameters, and save meal items."
      value={value}
      onChange={onChange}
      steps={steps}
      initialStepId={initialStepId}
      onSubmit={submitMeal}
      submitLabel={mode === "edit" ? "Update meal" : "Save meal"}
      pending={logPending}
      pendingLabel="Saving meal"
      error={saveError}
      resolveError={(stepId) =>
        stepId !== "search"
          ? value.selectedItems.length === 0
            ? "Select at least one food before saving."
            : (nutritionError ?? undefined)
          : undefined
      }
      resolveContinueNudge={(stepId) =>
        stepId === "search" &&
        chatGptFeedback?.status === "success" &&
        value.selectedItems.length > 0
          ? "Meal draft is ready. Continue to review quantities."
          : null
      }
      draftPersistenceKey={`weight-loss-food-log.${mode}.${intent}`}
    />
  );
}

export function buildFoodLogInput(
  draft: WeightLossFoodDraft,
  options: { dateKey?: string; timeZone?: string } = {}
): NutritionFoodLogInput {
  return {
    loggedAt: draft.loggedAt,
    dayKey: draft.dayKey ?? options.dateKey ?? null,
    timeZone: draft.timeZone ?? options.timeZone,
    mealLabel: asFoodDraftString(draft.mealLabel),
    source: draft.source ?? "search",
    confirmationState: "confirmed",
    notes: asFoodDraftString(draft.notes),
    items: draft.selectedItems.map((item) => {
      const scaled = scaleFood(item);
      return {
        foodId: resolveCatalogFoodId(item),
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

function asFoodDraftString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function resolveCatalogFoodId(item: WeightLossSelectedFood) {
  if (item.food.source === "manual" || item.food.source === "chatgpt") {
    return null;
  }
  if (
    item.food.id.startsWith("custom_food_") ||
    item.food.id.startsWith("chatgpt_")
  ) {
    return null;
  }
  return item.food.id;
}

export function buildFoodLogPatchInput(
  draft: WeightLossFoodDraft,
  options: { dateKey?: string; timeZone?: string } = {}
): NutritionFoodLogPatchInput {
  return buildFoodLogInput(draft, options);
}

function numericFoodPatchValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function FoodParameterEditor({
  item,
  onChange
}: {
  item: WeightLossSelectedFood;
  onChange: (patch: Partial<NutritionFoodSearchResult>) => void;
}) {
  const food = item.food;
  const updateNumber = (
    key: keyof Pick<
      NutritionFoodSearchResult,
      | "calories"
      | "proteinGrams"
      | "carbohydrateGrams"
      | "fatGrams"
      | "fiberGrams"
      | "sugarGrams"
      | "sodiumMg"
      | "servingGrams"
    >,
    value: string
  ) => onChange({ [key]: numericFoodPatchValue(value) });

  return (
    <div className="grid gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ui-ink-strong)]">
        Food parameters
        <InfoTooltip
          label={`Explain editable food parameters for ${food.name}`}
          content="These are the nutrient values for the base serving shown above. Changing them recalculates the eaten quantity and stores the corrected values in Forge."
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <FlowField
          label="Base label"
          labelHelp="Human-readable denominator shown for the nutrition values, such as 100 g, 220 g, one burger, or one scoop."
        >
          <Input
            value={food.servingLabel ?? ""}
            onChange={(event) =>
              onChange({ servingLabel: event.target.value || null })
            }
            placeholder="100 g"
          />
        </FlowField>
        <FlowField
          label="Base grams"
          labelHelp="Gram denominator for the base nutrition values. If kcal is per 220 g, enter 220. If kcal is per 100 g, enter 100."
        >
          <Input
            inputMode="decimal"
            value={food.servingGrams ?? ""}
            onChange={(event) =>
              updateNumber("servingGrams", event.target.value)
            }
            placeholder="100"
          />
        </FlowField>
        <FlowField
          label="Food name"
          labelHelp="Rename the item when the database result is too generic or wrong."
        >
          <Input
            value={food.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </FlowField>
        <FlowField
          label="Brand"
          labelHelp="Optional brand or preparation source, useful when the same food has different nutrition."
        >
          <Input
            value={food.brand ?? ""}
            onChange={(event) =>
              onChange({ brand: event.target.value || null })
            }
          />
        </FlowField>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <FlowField
          label="kcal"
          labelHelp="Kilocalories for the base amount above. Forge multiplies this by eaten grams divided by base grams, so 2 g of a 220 g base is not treated as 2 servings."
        >
          <Input
            inputMode="decimal"
            value={food.calories ?? ""}
            onChange={(event) => updateNumber("calories", event.target.value)}
          />
        </FlowField>
        <FlowField
          label="Protein g"
          labelHelp="Protein grams for the base amount above. This is scaled by the same gram ratio as calories."
        >
          <Input
            inputMode="decimal"
            value={food.proteinGrams ?? ""}
            onChange={(event) =>
              updateNumber("proteinGrams", event.target.value)
            }
          />
        </FlowField>
        <FlowField
          label="Carbs g"
          labelHelp="Carbohydrate grams for the base amount above. Carbs are training fuel after protein and fat are allocated."
        >
          <Input
            inputMode="decimal"
            value={food.carbohydrateGrams ?? ""}
            onChange={(event) =>
              updateNumber("carbohydrateGrams", event.target.value)
            }
          />
        </FlowField>
        <FlowField
          label="Fat g"
          labelHelp="Fat grams for the base amount above. Fat supports the practical floor and AMDR context in the plan."
        >
          <Input
            inputMode="decimal"
            value={food.fatGrams ?? ""}
            onChange={(event) => updateNumber("fatGrams", event.target.value)}
          />
        </FlowField>
        <FlowField
          label="Fiber g"
          labelHelp="Fiber grams for the base amount above. Forge compares this to the 14g per 1000 kcal planning target."
        >
          <Input
            inputMode="decimal"
            value={food.fiberGrams ?? ""}
            onChange={(event) => updateNumber("fiberGrams", event.target.value)}
          />
        </FlowField>
        <FlowField
          label="Sugar g"
          labelHelp="Sugar grams for the base amount above. Added sugar is tracked as a ceiling, not a goal."
        >
          <Input
            inputMode="decimal"
            value={food.sugarGrams ?? ""}
            onChange={(event) => updateNumber("sugarGrams", event.target.value)}
          />
        </FlowField>
        <FlowField
          label="Sodium mg"
          labelHelp="Sodium milligrams for the base amount above. Sodium affects daily ceiling, sport loss replacement, and water retention hypotheses."
        >
          <Input
            inputMode="decimal"
            value={food.sodiumMg ?? ""}
            onChange={(event) => updateNumber("sodiumMg", event.target.value)}
          />
        </FlowField>
      </div>
    </div>
  );
}

function FoodDetail({
  food,
  onAdd
}: {
  food: NutritionFoodSearchResult;
  onAdd: () => void;
}) {
  return (
    <Card className="grid gap-4 border-[var(--primary)]/20 bg-[var(--ui-accent-soft)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-[var(--ui-ink-strong)]">
            {food.name}
          </div>
          <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
            {[food.brand, food.servingLabel, food.source]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <Button type="button" onClick={onAdd}>
          <Plus className="size-4" />
          Add
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <SurfaceStat label="Calories" value={formatNumber(food.calories)} />
        <SurfaceStat
          label="Protein"
          value={formatMeasurement(food.proteinGrams, "g")}
        />
        <SurfaceStat
          label="Carbs"
          value={formatMeasurement(food.carbohydrateGrams, "g")}
        />
        <SurfaceStat
          label="Fat"
          value={formatMeasurement(food.fatGrams, "g")}
        />
        <SurfaceStat
          label="Fiber"
          value={formatMeasurement(food.fiberGrams, "g")}
        />
        <SurfaceStat
          label="Sugar"
          value={formatMeasurement(food.sugarGrams, "g")}
        />
        <SurfaceStat
          label="Sodium"
          value={`${formatNumber(food.sodiumMg)}mg`}
        />
        <SurfaceStat
          label="NOVA"
          value={food.novaGroup ? String(food.novaGroup) : "n/a"}
        />
      </div>
      <div className="flex items-center gap-2 text-xs text-[var(--ui-ink-soft)]">
        <Info className="size-4" />
        Base grams: {formatNumber(getFoodBaseGrams(food))}. Adjust exact intake
        in the next step.
      </div>
    </Card>
  );
}

function scaleFood(item: WeightLossSelectedFood) {
  const amount = Number(item.amount) || 0;
  const baseGrams = getFoodBaseGrams(item.food);
  const grams = getEatenGramEquivalent(item);
  const usesBaseMultiplier = item.unit === "serving" || item.unit === "unit";
  const scale =
    amount <= 0
      ? 0
      : baseGrams != null && grams != null
        ? grams / baseGrams
        : usesBaseMultiplier
          ? amount
          : null;
  const scaledNumber = (foodValue: number | null | undefined) =>
    scale != null && typeof foodValue === "number" && Number.isFinite(foodValue)
      ? Math.round(foodValue * scale * 10) / 10
      : null;
  return {
    grams,
    scale,
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

function hasRequiredNutritionValue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function missingRequiredScaledNutrition(item: WeightLossSelectedFood) {
  const scaled = scaleFood(item);
  const missing: string[] = [];
  if (!hasRequiredNutritionValue(scaled.calories)) missing.push("calories");
  if (!hasRequiredNutritionValue(scaled.proteinGrams)) missing.push("protein");
  if (!hasRequiredNutritionValue(scaled.carbohydrateGrams)) {
    missing.push("carbs");
  }
  if (!hasRequiredNutritionValue(scaled.fatGrams)) missing.push("fat");
  return missing;
}

function getFoodDraftNutritionError(draft: WeightLossFoodDraft) {
  const incomplete = draft.selectedItems
    .map((item) => ({
      name: item.food.name,
      missing: missingRequiredScaledNutrition(item)
    }))
    .filter((item) => item.missing.length > 0);
  if (incomplete.length === 0) {
    return null;
  }
  return `Add complete nutrition before saving: ${incomplete
    .map((item) => `${item.name} is missing ${item.missing.join(", ")}`)
    .join("; ")}.`;
}

function sumSelectedFoods(items: WeightLossSelectedFood[]) {
  return items.reduce(
    (sum, item) => {
      const scaled = scaleFood(item);
      return {
        calories: sum.calories + (scaled.calories ?? 0),
        proteinGrams: sum.proteinGrams + (scaled.proteinGrams ?? 0),
        carbohydrateGrams:
          sum.carbohydrateGrams + (scaled.carbohydrateGrams ?? 0),
        fatGrams: sum.fatGrams + (scaled.fatGrams ?? 0)
      };
    },
    { calories: 0, proteinGrams: 0, carbohydrateGrams: 0, fatGrams: 0 }
  );
}
