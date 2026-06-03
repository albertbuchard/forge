import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Beef, Dumbbell, Gauge, Utensils, Waves } from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { WeightLossActionPanel } from "@/components/weight-loss/weight-loss-action-panel";
import { WeightLossInsightMetric } from "@/components/weight-loss/weight-loss-cards";
import { WeightLossLedgerPanel } from "@/components/weight-loss/weight-loss-food-panels";
import {
  WeightLossDataQualityPanel,
  WeightLossExperimentsPanel,
  WeightLossHypothesesPanel
} from "@/components/weight-loss/weight-loss-insights";
import { WeightLossNutritionTargetsPanel } from "@/components/weight-loss/weight-loss-nutrition-targets-panel";
import {
  buildCheckinPayloads,
  buildFoodLogInput,
  buildInitialCheckinDraft,
  buildInitialFoodDraft,
  buildInitialPlanDraft,
  buildTargetPatchFromPlan,
  WeightLossCheckinDialog,
  WeightLossFoodLogDialog,
  WeightLossHistoryDialog,
  WeightLossPlanDialog,
  type WeightLossCheckinDraft,
  type WeightLossFoodDraft,
  type WeightLossPlanDraft
} from "@/components/weight-loss/weight-loss-dialogs";
import {
  formatNumber,
  formatSigned,
  insightArray,
  scoreLabel
} from "@/components/weight-loss/weight-loss-format";
import {
  createNutritionAppearanceCheckin,
  createNutritionBodyCheckin,
  createNutritionFoodLog,
  createNutritionGutCheckin,
  createNutritionSubjectiveCheckin,
  getWeightLossView,
  searchNutritionFoods,
  updateNutritionTarget
} from "@/lib/api";
import type { NutritionFoodLog, WeightLossViewData } from "@/lib/weight-loss-types";

export function WeightLossPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const selectedUserIds = shell.selectedUserIds;
  const queryKey = useMemo(
    () => ["forge-weight-loss-view", ...selectedUserIds],
    [selectedUserIds]
  );

  const [planOpen, setPlanOpen] = useState(false);
  const [foodOpen, setFoodOpen] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [planDraft, setPlanDraft] = useState<WeightLossPlanDraft | null>(null);
  const [foodDraft, setFoodDraft] = useState<WeightLossFoodDraft>(() =>
    buildInitialFoodDraft()
  );
  const [checkinDraft, setCheckinDraft] = useState<WeightLossCheckinDraft>(() =>
    buildInitialCheckinDraft()
  );

  const viewQuery = useQuery({
    queryKey,
    queryFn: async () => (await getWeightLossView(selectedUserIds)).weightLoss
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const foodSearchMutation = useMutation({
    mutationFn: async (query: string) =>
      (await searchNutritionFoods({ query, userIds: selectedUserIds })).foods
  });

  const createFoodLogMutation = useMutation({
    mutationFn: async (draft: WeightLossFoodDraft) =>
      createNutritionFoodLog(buildFoodLogInput(draft), selectedUserIds),
    onSuccess: () => {
      setFoodDraft(buildInitialFoodDraft());
      setFoodOpen(false);
      void refresh();
    }
  });

  const targetMutation = useMutation({
    mutationFn: async (draft: WeightLossPlanDraft) => {
      const currentWeight = Number(draft.currentWeightKg);
      await updateNutritionTarget(buildTargetPatchFromPlan(draft), selectedUserIds);
      if (Number.isFinite(currentWeight)) {
        await createNutritionBodyCheckin(
          {
            weightKg: currentWeight,
            notes: "Updated from weight-plan setup."
          },
          selectedUserIds
        );
      }
    },
    onSuccess: () => {
      setPlanOpen(false);
      void refresh();
    }
  });

  const checkinMutation = useMutation({
    mutationFn: async (draft: WeightLossCheckinDraft) => {
      const payloads = buildCheckinPayloads(draft);
      await Promise.all([
        payloads.body.weightKg !== null ||
        payloads.body.waistCm !== null ||
        payloads.body.bodyFatPercent !== null
          ? createNutritionBodyCheckin(payloads.body, selectedUserIds)
          : Promise.resolve(),
        payloads.subjective.energy !== null ||
        payloads.subjective.hunger !== null ||
        payloads.subjective.cravings !== null
          ? createNutritionSubjectiveCheckin(payloads.subjective, selectedUserIds)
          : Promise.resolve(),
        payloads.gut.bloating !== null
          ? createNutritionGutCheckin(payloads.gut, selectedUserIds)
          : Promise.resolve(),
        payloads.appearance.facePuffiness !== null ||
        payloads.appearance.leanness !== null
          ? createNutritionAppearanceCheckin(payloads.appearance, selectedUserIds)
          : Promise.resolve()
      ]);
    },
    onSuccess: () => {
      setCheckinDraft(buildInitialCheckinDraft());
      setCheckinOpen(false);
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
            foodId: item.foodId,
            name: item.name,
            brand: item.brand,
            quantity: item.quantity,
            unit: item.unit,
            grams: item.grams,
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
  const resolvedPlanDraft = planDraft ?? buildInitialPlanDraft(view);

  const openPlan = () => {
    setPlanDraft(buildInitialPlanDraft(view));
    setPlanOpen(true);
  };

  return (
    <div className="mx-auto grid w-full max-w-[1500px] gap-5">
      <PageHero
        title="Weight Loss"
        description="A guided Forge body composition lab: editable goals, science-based calorie and macro planning, exact food quantities, body measures, energy, gut comfort, look, and testable food hypotheses."
        badge={`${view.summary.loggedMealCount} food logs`}
      />

      <WeightLossActionPanel
        view={view}
        onOpenPlan={openPlan}
        onOpenFood={() => setFoodOpen(true)}
        onOpenCheckin={() => setCheckinOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      <section className="grid gap-4 xl:grid-cols-4">
        <WeightLossInsightMetric
          label="Today"
          value={`${intakeCalories.toFixed(0)} kcal`}
          detail={`${remainingCalories.toFixed(0)} kcal remaining against a ${ledger.targetCalories.toFixed(0)} kcal target.`}
          icon={Utensils}
          tone={remainingCalories >= 0 ? "green" : "rose"}
        />
        <WeightLossInsightMetric
          label="Protein"
          value={`${ledgerTotals.proteinGrams.toFixed(0)}g`}
          detail={`${view.target.proteinGramsTarget.toFixed(0)}g target. Protein anchors the plan while cutting or gaining.`}
          icon={Beef}
        />
        <WeightLossInsightMetric
          label="Energy gap"
          value={formatSigned(energy.estimatedDailyEnergyBalanceKcal)}
          detail={`TDEE estimate ${formatNumber(energy.estimatedTdeeKcal)} kcal, movement ${formatNumber(energy.movementCaloriesKcal)} kcal, active burn ${formatNumber(energy.activeBurnKcal)} kcal.`}
          icon={Gauge}
          tone="amber"
        />
        <WeightLossInsightMetric
          label="Weight trend"
          value={formatSigned(trend.sevenDayRateKg, 2)}
          detail={`Latest ${formatNumber(trend.latestWeightKg, 1)} kg. Trend uses check-ins, not noisy single weigh-ins.`}
          icon={Activity}
          tone="green"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.78fr)]">
        <WeightLossLedgerPanel
          ledger={ledger}
          remainingCalories={remainingCalories}
          intakePercent={intakePercent}
          logSavedPending={logSavedMealMutation.isPending}
          onLogAgain={(entry) => logSavedMealMutation.mutate(entry)}
        />

        <WeightLossDataQualityPanel view={view} />
      </section>

      <WeightLossNutritionTargetsPanel view={view} />

      <section className="grid gap-4 xl:grid-cols-4">
        <WeightLossInsightMetric
          label="Food quality"
          value={scoreLabel(foodQuality.qualityScore)}
          detail={`Fiber density ${formatNumber(foodQuality.fiberPer1000Kcal, 1)}g/1000 kcal, protein density ${formatNumber(foodQuality.proteinPer1000Kcal, 1)}g/1000 kcal, ultra-processed share ${formatNumber(foodQuality.ultraProcessedShare, 0)}%.`}
          icon={Utensils}
          tone="green"
        />
        <WeightLossInsightMetric
          label="Training fuel"
          value={scoreLabel(trainingFuel.fuelingScore)}
          detail={`Recent workout load ${formatNumber(trainingFuel.recentTrainingLoad)} with ${formatNumber(trainingFuel.carbsPerTrainingLoad, 1)}g carbs per load unit.`}
          icon={Dumbbell}
          tone="amber"
        />
        <WeightLossInsightMetric
          label="Subjective"
          value={scoreLabel(subjective.averageFocus)}
          detail="Focus, energy, hunger, cravings, and performance are tracked as food-effect evidence."
          icon={Activity}
        />
        <WeightLossInsightMetric
          label="Gut"
          value={scoreLabel(gut.averageBloating)}
          detail="Bloating, reflux, stool type, and suspected triggers connect food choices to comfort and look."
          icon={Waves}
          tone="rose"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        <WeightLossHypothesesPanel hypotheses={hypotheses} />
        <WeightLossExperimentsPanel experiments={view.experiments} />
      </section>

      <WeightLossPlanDialog
        open={planOpen}
        onOpenChange={setPlanOpen}
        view={view}
        value={resolvedPlanDraft}
        onChange={setPlanDraft}
        pending={targetMutation.isPending}
        onSubmit={async () => {
          await targetMutation.mutateAsync(resolvedPlanDraft);
        }}
      />
      <WeightLossFoodLogDialog
        open={foodOpen}
        onOpenChange={setFoodOpen}
        value={foodDraft}
        onChange={setFoodDraft}
        foodResults={foodSearchMutation.data ?? []}
        searchPending={foodSearchMutation.isPending}
        logPending={createFoodLogMutation.isPending}
        onSearch={(query) => foodSearchMutation.mutate(query)}
        onSubmit={async () => {
          await createFoodLogMutation.mutateAsync(foodDraft);
        }}
      />
      <WeightLossCheckinDialog
        open={checkinOpen}
        onOpenChange={setCheckinOpen}
        value={checkinDraft}
        onChange={setCheckinDraft}
        pending={checkinMutation.isPending}
        onSubmit={async () => {
          await checkinMutation.mutateAsync(checkinDraft);
        }}
      />
      <WeightLossHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        meals={view.recentMeals}
        pending={logSavedMealMutation.isPending}
        onLogAgain={(meal) => logSavedMealMutation.mutate(meal)}
      />
    </div>
  );
}
