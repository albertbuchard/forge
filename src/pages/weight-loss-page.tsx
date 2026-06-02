import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Beef,
  Brain,
  Dumbbell,
  FlaskConical,
  Gauge,
  RotateCcw,
  ScanBarcode,
  Sparkles,
  Utensils,
  Waves
} from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import {
  createNutritionAppearanceCheckin,
  createNutritionBodyCheckin,
  createNutritionFoodLog,
  createNutritionGutCheckin,
  createNutritionSubjectiveCheckin,
  getWeightLossView,
  lookupNutritionBarcode,
  parseNutritionFoodLogWithChatGpt,
  searchNutritionFoods
} from "@/lib/api";
import type {
  NutritionFoodLog,
  NutritionFoodSearchResult,
  WeightLossViewData
} from "@/lib/weight-loss-types";
import { cn } from "@/lib/utils";

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function formatNumber(value: unknown, digits = 0) {
  const number = numeric(value);
  return number === null ? "n/a" : number.toFixed(digits);
}

function formatSigned(value: unknown, digits = 0) {
  const number = numeric(value);
  if (number === null) {
    return "n/a";
  }
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}`;
}

function scoreLabel(value: unknown) {
  const number = numeric(value);
  return number === null ? "n/a" : `${number.toFixed(1)}/10`;
}

function insightArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      )
    : [];
}

function InsightMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default"
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone?: "default" | "green" | "amber" | "rose";
}) {
  const toneClass =
    tone === "green"
      ? "bg-emerald-300/10 text-emerald-100"
      : tone === "amber"
        ? "bg-amber-300/10 text-amber-100"
        : tone === "rose"
          ? "bg-rose-300/10 text-rose-100"
          : "bg-indigo-300/10 text-indigo-100";
  return (
    <Card className="grid gap-4 border-white/8 bg-white/[0.045] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className={cn("rounded-2xl p-2.5", toneClass)}>
          <Icon className="size-5" />
        </div>
        <div className="text-right text-[11px] uppercase tracking-[0.16em] text-white/38">
          {label}
        </div>
      </div>
      <div>
        <div className="text-3xl font-semibold text-white">{value}</div>
        <p className="mt-2 text-sm leading-6 text-white/58">{detail}</p>
      </div>
    </Card>
  );
}

function RecentMeal({
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
    <div className="grid gap-2 rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-white">
            {meal.mealLabel ?? "Meal"}
          </div>
          <div className="truncate text-xs text-white/42">{firstItems || meal.notes || "No items"}</div>
        </div>
        <Badge className="bg-white/[0.08] text-white/70">
          {meal.totals.calories.toFixed(0)} kcal
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs text-white/56">
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
    </div>
  );
}

function FoodResult({
  food,
  onLog,
  pending
}: {
  food: NutritionFoodSearchResult;
  onLog: (food: NutritionFoodSearchResult) => void;
  pending: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-[22px] border border-white/8 bg-white/[0.04] p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-white">{food.name}</div>
        <div className="mt-1 truncate text-xs text-white/44">
          {[food.brand, food.servingLabel, food.source].filter(Boolean).join(" · ")}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/56">
          <span>{formatNumber(food.calories)} kcal</span>
          <span>{formatNumber(food.proteinGrams)}g protein</span>
          <span>{formatNumber(food.fiberGrams)}g fiber</span>
          {food.novaGroup ? <span>NOVA {food.novaGroup}</span> : null}
        </div>
      </div>
      <Button type="button" size="sm" variant="secondary" pending={pending} onClick={() => onLog(food)}>
        <Utensils className="size-4" />
        Log
      </Button>
    </div>
  );
}

export function WeightLossPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const selectedUserIds = shell.selectedUserIds;
  const queryKey = useMemo(
    () => ["forge-weight-loss-view", ...selectedUserIds],
    [selectedUserIds]
  );

  const [mealText, setMealText] = useState("");
  const [manualCalories, setManualCalories] = useState("");
  const [manualProtein, setManualProtein] = useState("");
  const [foodQuery, setFoodQuery] = useState("");
  const [barcode, setBarcode] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [energyScore, setEnergyScore] = useState("");
  const [gutScore, setGutScore] = useState("");
  const [aestheticScore, setAestheticScore] = useState("");

  const viewQuery = useQuery({
    queryKey,
    queryFn: async () => (await getWeightLossView(selectedUserIds)).weightLoss
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const manualLogMutation = useMutation({
    mutationFn: async () =>
      createNutritionFoodLog(
        {
          mealLabel: "Quick log",
          source: "manual",
          confirmationState: "confirmed",
          notes: mealText.trim() || null,
          items: [
            {
              name: mealText.trim() || "Manual food entry",
              quantity: 1,
              unit: "entry",
              calories: Number(manualCalories) || null,
              proteinGrams: Number(manualProtein) || null,
              confidence: 0.55,
              tags: ["quick-log"]
            }
          ]
        },
        selectedUserIds
      ),
    onSuccess: () => {
      setMealText("");
      setManualCalories("");
      setManualProtein("");
      void refresh();
    }
  });

  const parseMutation = useMutation({
    mutationFn: async () =>
      parseNutritionFoodLogWithChatGpt({
        text: mealText,
        mealLabel: "ChatGPT parsed meal",
        userIds: selectedUserIds
      }),
    onSuccess: () => {
      setMealText("");
      setManualCalories("");
      setManualProtein("");
      void refresh();
    }
  });

  const foodSearchMutation = useMutation({
    mutationFn: async () =>
      (await searchNutritionFoods({ query: foodQuery, userIds: selectedUserIds })).foods
  });

  const barcodeMutation = useMutation({
    mutationFn: async () =>
      (await lookupNutritionBarcode({ barcode, userIds: selectedUserIds })).food
  });

  const logFoodMutation = useMutation({
    mutationFn: async (food: NutritionFoodSearchResult) =>
      createNutritionFoodLog(
        {
          mealLabel: "Catalog food",
          source: food.barcode ? "barcode" : "manual",
          confirmationState: "confirmed",
          items: [
            {
              name: food.name,
              brand: food.brand,
              quantity: 1,
              unit: food.servingLabel ?? "serving",
              calories: food.calories,
              proteinGrams: food.proteinGrams,
              carbohydrateGrams: food.carbohydrateGrams,
              fatGrams: food.fatGrams,
              fiberGrams: food.fiberGrams,
              sugarGrams: food.sugarGrams,
              sodiumMg: food.sodiumMg,
              potassiumMg: food.potassiumMg,
              caffeineMg: food.caffeineMg,
              alcoholGrams: food.alcoholGrams,
              glycemicIndex: food.glycemicIndex,
              novaGroup: food.novaGroup,
              tags: food.tags,
              confidence: 0.82
            }
          ]
        },
        selectedUserIds
      ),
    onSuccess: () => {
      void refresh();
    }
  });

  const logSavedMealMutation = useMutation({
    mutationFn: async (meal: NutritionFoodLog) =>
      createNutritionFoodLog(
        {
          mealLabel: meal.mealLabel ?? "Saved meal",
          source: "saved_meal",
          confirmationState: "confirmed",
          notes: meal.notes,
          items: meal.items.map((item) => ({
            name: item.name,
            brand: item.brand,
            quantity: item.quantity,
            unit: item.unit,
            calories: item.calories,
            proteinGrams: item.proteinGrams,
            carbohydrateGrams: item.carbohydrateGrams,
            fatGrams: item.fatGrams,
            fiberGrams: item.fiberGrams,
            sugarGrams: item.sugarGrams,
            sodiumMg: item.sodiumMg,
            potassiumMg: item.potassiumMg,
            caffeineMg: item.caffeineMg,
            alcoholGrams: item.alcoholGrams,
            glycemicIndex: item.glycemicIndex,
            novaGroup: item.novaGroup,
            fermented: item.fermented,
            probiotic: item.probiotic,
            fodmapLevel: item.fodmapLevel,
            tags: item.tags,
            confidence: item.confidence ?? 0.85
          }))
        },
        selectedUserIds
      ),
    onSuccess: () => {
      void refresh();
    }
  });

  const checkinMutation = useMutation({
    mutationFn: async () => {
      await Promise.all([
        weightKg.trim()
          ? createNutritionBodyCheckin({ weightKg: Number(weightKg) }, selectedUserIds)
          : Promise.resolve(),
        energyScore.trim()
          ? createNutritionSubjectiveCheckin(
              { energy: Number(energyScore), timeRelation: "current" },
              selectedUserIds
            )
          : Promise.resolve(),
        gutScore.trim()
          ? createNutritionGutCheckin({ bloating: Number(gutScore) }, selectedUserIds)
          : Promise.resolve(),
        aestheticScore.trim()
          ? createNutritionAppearanceCheckin(
              { aestheticScore: Number(aestheticScore) },
              selectedUserIds
            )
          : Promise.resolve()
      ]);
    },
    onSuccess: () => {
      setWeightKg("");
      setEnergyScore("");
      setGutScore("");
      setAestheticScore("");
      void refresh();
    }
  });

  if (viewQuery.isLoading) {
    return (
      <LoadingState
        title="Loading weight-loss signals"
        description="Combining food logs, HealthKit, movement, workouts, body check-ins, subjective state, and gut signals."
      />
    );
  }

  if (viewQuery.isError || !viewQuery.data) {
    return (
      <ErrorState
        error={viewQuery.error ?? new Error("Weight-loss view unavailable")}
        onRetry={() => void viewQuery.refetch()}
      />
    );
  }

  const view: WeightLossViewData = viewQuery.data;
  const ledger = view.todayLedger;
  const ledgerTotals = ledger.totals;
  const intakeCalories = ledgerTotals.calories;
  const remainingCalories = ledger.targetCalories - intakeCalories;
  const intakePercent =
    ledger.targetCalories > 0
      ? Math.min(140, Math.max(0, (intakeCalories / ledger.targetCalories) * 100))
      : 0;
  const energy = view.energyModel;
  const trend = view.weightTrend;
  const foodQuality = view.foodQuality;
  const trainingFuel = view.trainingFuel;
  const subjective = view.subjective;
  const gut = view.gut;
  const hypotheses = insightArray(view.hypotheses);
  const foodResults = foodSearchMutation.data ?? [];
  const barcodeFood = barcodeMutation.data ?? null;

  return (
    <div className="mx-auto grid w-full max-w-[1500px] gap-5">
      <PageHero
        title="Weight Loss"
        description="A Forge-native body composition lab: calories and protein, but also sport fuel, visual look, energy, gut comfort, cravings, and testable food hypotheses."
        badge={`${view.summary.loggedMealCount} food logs`}
      />

      <section className="grid gap-4 xl:grid-cols-4">
        <InsightMetric
          label="Today"
          value={`${intakeCalories.toFixed(0)} kcal`}
          detail={`${remainingCalories.toFixed(0)} kcal remaining against a ${ledger.targetCalories.toFixed(0)} kcal target.`}
          icon={Utensils}
          tone={remainingCalories >= 0 ? "green" : "rose"}
        />
        <InsightMetric
          label="Protein"
          value={`${ledgerTotals.proteinGrams.toFixed(0)}g`}
          detail={`${view.target.proteinGramsTarget.toFixed(0)}g target. Forge treats protein as the anchor for dieting without looking flat or under-recovered.`}
          icon={Beef}
        />
        <InsightMetric
          label="Energy gap"
          value={formatSigned(energy.estimatedDailyEnergyBalanceKcal)}
          detail={`TDEE estimate ${formatNumber(energy.estimatedTdeeKcal)} kcal, movement ${formatNumber(energy.movementCaloriesKcal)} kcal, active burn ${formatNumber(energy.activeBurnKcal)} kcal.`}
          icon={Gauge}
          tone="amber"
        />
        <InsightMetric
          label="Weight trend"
          value={formatSigned(trend.sevenDayRateKg, 2)}
          detail={`Latest ${formatNumber(trend.latestWeightKg, 1)} kg. Trend uses check-ins, not noisy single weigh-ins.`}
          icon={Activity}
          tone="green"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
        <Card className="grid gap-5 border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(52,211,153,0.14),transparent_34%),linear-gradient(180deg,rgba(14,21,34,0.98),rgba(8,12,24,0.98))] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                Quick capture
              </div>
              <h2 className="mt-1 text-2xl font-semibold text-white">Food, photo description, or rough meal</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/58">
                Use natural language for ChatGPT parsing through the `openai-codex` subscription connection, or log manually when you only know rough calories.
              </p>
            </div>
            <Badge className="bg-emerald-300/10 text-emerald-50">
              subscription parser
            </Badge>
          </div>

          <Textarea
            value={mealText}
            onChange={(event) => setMealText(event.target.value)}
            placeholder="Example: 3 eggs, two slices of sourdough, Greek yogurt with honey, espresso. Felt sharp for training but a bit bloated later."
          />
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              inputMode="decimal"
              value={manualCalories}
              onChange={(event) => setManualCalories(event.target.value)}
              placeholder="Manual kcal"
            />
            <Input
              inputMode="decimal"
              value={manualProtein}
              onChange={(event) => setManualProtein(event.target.value)}
              placeholder="Manual protein g"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              pending={parseMutation.isPending}
              disabled={!mealText.trim()}
              onClick={() => parseMutation.mutate()}
            >
              <Sparkles className="size-4" />
              Parse with ChatGPT
            </Button>
            <Button
              type="button"
              variant="secondary"
              pending={manualLogMutation.isPending}
              disabled={!mealText.trim() && !manualCalories.trim()}
              onClick={() => manualLogMutation.mutate()}
            >
              <Utensils className="size-4" />
              Manual log
            </Button>
          </div>
          {view.recentMeals.length > 0 ? (
            <div className="grid gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                Saved and recent meals
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {view.recentMeals.slice(0, 4).map((meal) => (
                  <RecentMeal
                    key={`saved-${meal.id}`}
                    meal={meal}
                    pending={logSavedMealMutation.isPending}
                    onLogAgain={(entry) => logSavedMealMutation.mutate(entry)}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </Card>

        <Card className="grid gap-4 border-white/8 bg-white/[0.045] p-5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
              Body state
            </div>
            <h2 className="mt-1 text-xl font-semibold text-white">Check-in loop</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input value={weightKg} inputMode="decimal" onChange={(event) => setWeightKg(event.target.value)} placeholder="Weight kg" />
            <Input value={energyScore} inputMode="decimal" onChange={(event) => setEnergyScore(event.target.value)} placeholder="Energy 0-10" />
            <Input value={gutScore} inputMode="decimal" onChange={(event) => setGutScore(event.target.value)} placeholder="Bloating 0-10" />
            <Input value={aestheticScore} inputMode="decimal" onChange={(event) => setAestheticScore(event.target.value)} placeholder="Look 0-10" />
          </div>
          <Button
            type="button"
            variant="secondary"
            pending={checkinMutation.isPending}
            disabled={!weightKg.trim() && !energyScore.trim() && !gutScore.trim() && !aestheticScore.trim()}
            onClick={() => checkinMutation.mutate()}
          >
            <Brain className="size-4" />
            Save check-in
          </Button>
          <div className="grid grid-cols-2 gap-3 text-sm text-white/58">
            <div className="rounded-[18px] border border-white/8 bg-white/[0.04] p-3">
              Energy avg <span className="text-white">{scoreLabel(subjective.averageEnergy)}</span>
            </div>
            <div className="rounded-[18px] border border-white/8 bg-white/[0.04] p-3">
              Gut comfort <span className="text-white">{scoreLabel(gut.gutComfortScore)}</span>
            </div>
            <div className="rounded-[18px] border border-white/8 bg-white/[0.04] p-3">
              Look avg <span className="text-white">{scoreLabel(view.appearanceCheckins[0]?.aestheticScore)}</span>
            </div>
            <div className="rounded-[18px] border border-white/8 bg-white/[0.04] p-3">
              Cravings <span className="text-white">{scoreLabel(subjective.averageCravings)}</span>
            </div>
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
        <Card className="grid gap-4 border-white/8 bg-white/[0.045] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                Catalog
              </div>
              <h2 className="mt-1 text-xl font-semibold text-white">Food search and barcode</h2>
            </div>
            <ScanBarcode className="size-5 text-white/42" />
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <Input value={foodQuery} onChange={(event) => setFoodQuery(event.target.value)} placeholder="Search food database" />
            <Button type="button" variant="secondary" pending={foodSearchMutation.isPending} disabled={!foodQuery.trim()} onClick={() => foodSearchMutation.mutate()}>
              Search
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <Input value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Barcode" />
            <Button type="button" variant="secondary" pending={barcodeMutation.isPending} disabled={!barcode.trim()} onClick={() => barcodeMutation.mutate()}>
              Lookup
            </Button>
          </div>
          {barcodeFood ? (
            <FoodResult food={barcodeFood} pending={logFoodMutation.isPending} onLog={(food) => logFoodMutation.mutate(food)} />
          ) : null}
          <div className="grid gap-3">
            {foodResults.slice(0, 6).map((food) => (
              <FoodResult key={food.id} food={food} pending={logFoodMutation.isPending} onLog={(entry) => logFoodMutation.mutate(entry)} />
            ))}
          </div>
        </Card>

        <Card className="grid gap-5 border-white/8 bg-white/[0.045] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                Today ledger
              </div>
              <h2 className="mt-1 text-xl font-semibold text-white">Calories, macros, and meal evidence</h2>
            </div>
            <Badge className="bg-white/[0.08] text-white/70">
              {ledger.meals.length} meals
            </Badge>
          </div>
          <div>
            <div className="h-3 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className={cn(
                  "h-full rounded-full",
                  remainingCalories >= 0 ? "bg-emerald-300" : "bg-rose-300"
                )}
                style={{ width: `${Math.min(100, intakePercent)}%` }}
              />
            </div>
            <div className="mt-3 grid gap-2 text-sm text-white/58 sm:grid-cols-4">
              <span>{ledgerTotals.carbohydrateGrams.toFixed(0)}g carbs</span>
              <span>{ledgerTotals.fatGrams.toFixed(0)}g fat</span>
              <span>{ledgerTotals.fiberGrams.toFixed(0)}g fiber</span>
              <span>{ledger.unconfirmedCount} unconfirmed</span>
            </div>
          </div>
          <div className="grid gap-3">
            {ledger.meals.length > 0 ? (
              ledger.meals.map((meal) => (
                <RecentMeal
                  key={meal.id}
                  meal={meal}
                  pending={logSavedMealMutation.isPending}
                  onLogAgain={(entry) => logSavedMealMutation.mutate(entry)}
                />
              ))
            ) : (
              <div className="rounded-[22px] border border-dashed border-white/12 p-5 text-sm text-white/50">
                No meals logged today yet.
              </div>
            )}
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <InsightMetric
          label="Food quality"
          value={scoreLabel(foodQuality.qualityScore)}
          detail={`Fiber density ${formatNumber(foodQuality.fiberPer1000Kcal, 1)}g/1000 kcal, protein density ${formatNumber(foodQuality.proteinPer1000Kcal, 1)}g/1000 kcal, ultra-processed share ${formatNumber(foodQuality.ultraProcessedShare, 0)}%.`}
          icon={Utensils}
          tone="green"
        />
        <InsightMetric
          label="Training fuel"
          value={scoreLabel(trainingFuel.fuelingScore)}
          detail={`Recent workout load ${formatNumber(trainingFuel.recentTrainingLoad)} with ${formatNumber(trainingFuel.carbsPerTrainingLoad, 1)}g carbs per load unit.`}
          icon={Dumbbell}
          tone="amber"
        />
        <InsightMetric
          label="Subjective"
          value={scoreLabel(subjective.averageFocus)}
          detail={`Focus, energy, hunger, cravings, and performance are tracked as food-effect evidence, not diary fluff.`}
          icon={Brain}
        />
        <InsightMetric
          label="Gut"
          value={scoreLabel(gut.averageBloating)}
          detail={`Bloating, reflux, stool type, and suspected triggers help Forge connect food choices to comfort and look.`}
          icon={Waves}
          tone="rose"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        <Card className="grid gap-4 border-white/8 bg-white/[0.045] p-5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
              Hypotheses
            </div>
            <h2 className="mt-1 text-xl font-semibold text-white">Food and body pattern candidates</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {hypotheses.length > 0 ? (
              hypotheses.slice(0, 6).map((hypothesis, index) => (
                <div key={String(hypothesis.key ?? index)} className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <Badge className="bg-indigo-300/10 text-indigo-50">
                      {text(hypothesis.metric) ?? "pattern"}
                    </Badge>
                    <span className="text-xs text-white/40">
                      {formatNumber(hypothesis.confidence, 2)}
                    </span>
                  </div>
                  <div className="mt-3 text-sm font-medium text-white">
                    {text(hypothesis.label) ?? "Candidate pattern"}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-white/56">
                    {text(hypothesis.description) ?? "Forge needs more paired meals and check-ins to harden this signal."}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-[22px] border border-dashed border-white/12 p-5 text-sm text-white/50 md:col-span-2">
                Log meals plus energy, gut, and look check-ins for a few days to generate pattern candidates.
              </div>
            )}
          </div>
        </Card>

        <Card className="grid content-start gap-4 border-white/8 bg-white/[0.045] p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-cyan-300/10 p-2.5 text-cyan-100">
              <FlaskConical className="size-5" />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
                Experiments
              </div>
              <h2 className="text-xl font-semibold text-white">N-of-1 lab</h2>
            </div>
          </div>
          <div className="grid gap-3">
            {view.experiments.slice(0, 4).map((experiment, index) => (
              <div key={String(experiment.id ?? index)} className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
                <div className="text-sm font-medium text-white">
                  {text(experiment.title) ?? "Nutrition experiment"}
                </div>
                <p className="mt-2 text-sm leading-6 text-white/56">
                  {text(experiment.hypothesis) ?? text(experiment.intervention) ?? "No hypothesis recorded."}
                </p>
              </div>
            ))}
            {view.experiments.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-white/12 p-5 text-sm text-white/50">
                Start experiments from OpenClaw or the API: caffeine timing, fiber ramp, low-FODMAP trial, carb timing, sodium/puffiness, or pre-training fueling.
              </div>
            ) : null}
          </div>
        </Card>
      </section>
    </div>
  );
}
