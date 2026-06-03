import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Beef, Dumbbell, Gauge, Utensils, Waves } from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { WeightLossActionPanel } from "@/components/weight-loss/weight-loss-action-panel";
import { WeightLossActiveCaloriesMiniCard } from "@/components/weight-loss/weight-loss-active-calories-panel";
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
  buildFoodDraftFromInput,
  buildFoodDraftFromLog,
  buildFoodLogInput,
  buildFoodLogPatchInput,
  buildInitialCustomFoodDraft,
  buildInitialCheckinDraft,
  buildInitialFoodDraft,
  buildInitialPlanDraft,
  buildTargetPatchFromPlan,
  isWeightLossPlanConfigured,
  validateWeightLossPlanDraft,
  WeightLossCheckinDialog,
  WeightLossFoodLogDialog,
  WeightLossHistoryDialog,
  WeightLossPlanDialog,
  type WeightLossCheckinDraft,
  type WeightLossFoodDraft,
  type WeightLossFoodLogIntent,
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
  deleteNutritionFoodLog,
  getWeightLossView,
  patchNutritionFoodLog,
  parseNutritionFoodLogWithChatGpt,
  searchNutritionFoods,
  updateNutritionDailyActiveCalories,
  updateNutritionTarget
} from "@/lib/api";
import type {
  NutritionFoodLog,
  WeightLossViewData
} from "@/lib/weight-loss-types";

function energyGapDetail(view: WeightLossViewData) {
  const energy = view.energyModel;
  const hasEnergyEvidence =
    energy.activeBurnKcal != null ||
    energy.activeEnergyCalories != null ||
    energy.movementCaloriesKcal != null ||
    energy.workoutEnergyKcal != null;
  if (!hasEnergyEvidence) {
    return "No recent HealthKit active energy, workout energy, or movement-trip calories for this user yet.";
  }
  return `TDEE estimate ${formatNumber(energy.estimatedTdeeKcal)} kcal, movement ${formatNumber(energy.movementCaloriesKcal)} kcal, active burn ${formatNumber(energy.activeBurnKcal)} kcal.`;
}

function activeCaloriesSourceLabel(source: string) {
  switch (source) {
    case "today_workout_energy":
      return "today's workout energy";
    case "today_healthkit_active_energy":
      return "today's HealthKit active energy";
    case "today_workout_movement_energy":
      return "today's workout and movement energy";
    case "today_workout_movement_step_energy":
      return "today's workout, movement, and step energy";
    case "today_workout_step_energy":
      return "today's workout and step energy";
    case "today_movement_step_energy":
      return "today's movement and step energy";
    case "today_movement_trip_calories":
      return "today's movement trip calories";
    case "today_step_estimate":
      return "today's estimated step calories";
    case "user_override":
      return "your manual active-calorie override";
    default:
      return "the default daily active calories";
  }
}

export function WeightLossPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const selectedUserIds = shell.selectedUserIds;
  const queryKey = useMemo(
    () => ["forge-weight-loss-view", ...selectedUserIds],
    [selectedUserIds]
  );

  const [planOpen, setPlanOpen] = useState(false);
  const [autoPlanPrompted, setAutoPlanPrompted] = useState(false);
  const [foodOpen, setFoodOpen] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [activeCaloriesError, setActiveCaloriesError] = useState<string | null>(
    null
  );
  const [activeCaloriesDraft, setActiveCaloriesDraft] = useState("");
  const [planDraft, setPlanDraft] = useState<WeightLossPlanDraft | null>(null);
  const [editingFoodLogId, setEditingFoodLogId] = useState<string | null>(null);
  const [foodDialogIntent, setFoodDialogIntent] =
    useState<WeightLossFoodLogIntent>("search");
  const [foodInitialStepId, setFoodInitialStepId] = useState<
    string | undefined
  >(undefined);
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
  const loadedView = viewQuery.data;

  useEffect(() => {
    if (
      !loadedView ||
      autoPlanPrompted ||
      planOpen ||
      isWeightLossPlanConfigured(loadedView)
    ) {
      return;
    }
    setAutoPlanPrompted(true);
    setPlanDraft(buildInitialPlanDraft(loadedView));
    setPlanError(
      "Forge needs the missing profile fields before the calorie and macro plan can be trusted.\n\n- Confirm age, height, current weight, objective, weekly rate, and active calories.\n- Known HealthKit and movement values are prefilled when available."
    );
    setPlanOpen(true);
  }, [autoPlanPrompted, loadedView, planOpen]);

  useEffect(() => {
    if (!loadedView) {
      return;
    }
    setActiveCaloriesDraft(
      String(Math.round(loadedView.energyModel.todayActiveCaloriesKcal ?? 0))
    );
    setActiveCaloriesError(null);
  }, [
    loadedView?.generatedAt,
    loadedView?.energyModel.todayActiveCaloriesKcal
  ]);

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const foodSearchMutation = useMutation({
    mutationFn: async (query: string) =>
      (await searchNutritionFoods({ query, userIds: selectedUserIds })).foods
  });

  const chatGptFoodParseMutation = useMutation({
    mutationFn: async (text: string) =>
      parseNutritionFoodLogWithChatGpt({
        text,
        userIds: selectedUserIds,
        commitCandidate: false
      }),
    onSuccess: ({ candidate }) => {
      setFoodDraft(buildFoodDraftFromInput(candidate, "chatgpt"));
    }
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

  const patchFoodLogMutation = useMutation({
    mutationFn: async ({
      foodLogId,
      draft
    }: {
      foodLogId: string;
      draft: WeightLossFoodDraft;
    }) =>
      patchNutritionFoodLog(
        foodLogId,
        buildFoodLogPatchInput(draft),
        selectedUserIds
      ),
    onSuccess: () => {
      setFoodDraft(buildInitialFoodDraft());
      setEditingFoodLogId(null);
      setFoodOpen(false);
      void refresh();
    }
  });

  const deleteFoodLogMutation = useMutation({
    mutationFn: async (meal: NutritionFoodLog) =>
      deleteNutritionFoodLog(meal.id, selectedUserIds),
    onSuccess: () => {
      void refresh();
    }
  });

  const dailyActiveCaloriesMutation = useMutation({
    mutationFn: async (activeCaloriesKcal: number | null) =>
      updateNutritionDailyActiveCalories(
        {
          dayKey: loadedView?.todayLedger.dateKey,
          activeCaloriesKcal,
          notes:
            activeCaloriesKcal == null
              ? ""
              : "Manual active-calorie override from the weight-loss view"
        },
        selectedUserIds
      ),
    onSuccess: () => {
      setActiveCaloriesError(null);
      void refresh();
    },
    onError: (error) => {
      setActiveCaloriesError(
        error instanceof Error
          ? error.message
          : "Could not save active calories"
      );
    }
  });

  const targetMutation = useMutation({
    mutationFn: async (draft: WeightLossPlanDraft) => {
      const currentWeight = Number(draft.currentWeightKg);
      await updateNutritionTarget(
        buildTargetPatchFromPlan(draft),
        selectedUserIds
      );
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
          ? createNutritionSubjectiveCheckin(
              payloads.subjective,
              selectedUserIds
            )
          : Promise.resolve(),
        payloads.gut.bloating !== null
          ? createNutritionGutCheckin(payloads.gut, selectedUserIds)
          : Promise.resolve(),
        payloads.appearance.facePuffiness !== null ||
        payloads.appearance.leanness !== null
          ? createNutritionAppearanceCheckin(
              payloads.appearance,
              selectedUserIds
            )
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
          notes: meal.notes ?? "",
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
  const plannedTargetCalories =
    ledger.plannedTargetCalories ?? ledger.targetCalories;
  const todayActiveCalories =
    view.energyModel.todayActiveCaloriesKcal ??
    view.energyModel.activeBurnKcal ??
    view.energyModel.activeEnergyCalories ??
    view.energyModel.movementCaloriesKcal ??
    0;
  const baselineActiveCalories =
    view.energyModel.baselineActiveCaloriesKcal ?? todayActiveCalories;
  const activeAdjustment = ledger.activeAdjustmentCalories ?? 0;
  const activeAdjustmentText =
    activeAdjustment === 0
      ? "no active-calorie adjustment"
      : `${activeAdjustment > 0 ? "+" : ""}${activeAdjustment.toFixed(0)} kcal from ${activeCaloriesSourceLabel(ledger.activeCaloriesSource)}`;
  const intakePercent =
    ledger.targetCalories > 0
      ? Math.min(
          140,
          Math.max(0, (intakeCalories / ledger.targetCalories) * 100)
        )
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
    setPlanError(null);
    setPlanDraft(buildInitialPlanDraft(view));
    setPlanOpen(true);
  };

  const openNewFoodLog = (intent: WeightLossFoodLogIntent = "search") => {
    setEditingFoodLogId(null);
    setFoodDialogIntent(intent);
    setFoodInitialStepId(intent === "custom" ? "amounts" : "search");
    setFoodDraft(
      intent === "custom"
        ? buildInitialCustomFoodDraft()
        : buildInitialFoodDraft()
    );
    setFoodOpen(true);
  };

  const openEditFoodLog = (meal: NutritionFoodLog) => {
    setEditingFoodLogId(meal.id);
    setFoodDialogIntent("search");
    setFoodInitialStepId("amounts");
    setFoodDraft(buildFoodDraftFromLog(meal));
    setFoodOpen(true);
    setHistoryOpen(false);
  };

  const deleteFoodLog = (meal: NutritionFoodLog) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Delete ${meal.mealLabel ?? "this meal"} from the food log?`
      )
    ) {
      return;
    }
    deleteFoodLogMutation.mutate(meal);
  };

  const saveActiveCalories = () => {
    const parsed = Number(activeCaloriesDraft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setActiveCaloriesError("Enter a valid active-calorie value.");
      return;
    }
    dailyActiveCaloriesMutation.mutate(Math.round(parsed));
  };

  const resetActiveCalories = () => {
    dailyActiveCaloriesMutation.mutate(null);
  };

  return (
    <div className="mx-auto grid w-full max-w-[1500px] gap-5">
      <PageHero
        title="Weight Loss"
        description="A guided Forge body composition lab: editable goals, science-based calorie and macro planning, exact food quantities, body measures, energy, gut comfort, look, and testable food hypotheses."
        badge={`${ledger.targetCalories.toFixed(0)} kcal budget · ${view.summary.loggedMealCount} food logs`}
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <WeightLossLedgerPanel
          ledger={ledger}
          remainingCalories={remainingCalories}
          intakePercent={intakePercent}
          logSavedPending={
            logSavedMealMutation.isPending || deleteFoodLogMutation.isPending
          }
          onLogAgain={(entry) => logSavedMealMutation.mutate(entry)}
          onEditMeal={openEditFoodLog}
          onDeleteMeal={deleteFoodLog}
        />

        <div className="grid min-w-0 gap-4">
          <WeightLossActionPanel
            view={view}
            onOpenPlan={openPlan}
            onOpenFoodSearch={() => openNewFoodLog("search")}
            onOpenCustomFood={() => openNewFoodLog("custom")}
            onOpenChatGptFood={() => openNewFoodLog("chatgpt")}
            onOpenCheckin={() => setCheckinOpen(true)}
            onOpenHistory={() => setHistoryOpen(true)}
          />
          <WeightLossActiveCaloriesMiniCard
            view={view}
            draftValue={activeCaloriesDraft}
            pending={dailyActiveCaloriesMutation.isPending}
            error={activeCaloriesError}
            onDraftChange={setActiveCaloriesDraft}
            onSave={saveActiveCalories}
            onReset={resetActiveCalories}
          />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <WeightLossInsightMetric
          label="Today"
          value={`${intakeCalories.toFixed(0)} kcal`}
          detail={`${remainingCalories.toFixed(0)} kcal remaining against today's ${ledger.targetCalories.toFixed(0)} kcal target; ${activeAdjustmentText}.`}
          icon={Utensils}
          tone={remainingCalories >= 0 ? "green" : "rose"}
          help={`Today's target = baseline plan target + (today active calories - default active calories). Here: ${plannedTargetCalories.toFixed(0)} + (${todayActiveCalories.toFixed(0)} - ${baselineActiveCalories.toFixed(0)}) = ${ledger.targetCalories.toFixed(0)} kcal. If no workout or same-day active evidence exists, Forge uses the default daily active calories so the target stays at baseline.`}
        />
        <WeightLossInsightMetric
          label="Protein"
          value={`${ledgerTotals.proteinGrams.toFixed(0)}g`}
          detail={`${view.target.proteinGramsTarget.toFixed(0)}g target. Protein anchors the plan while cutting or gaining.`}
          icon={Beef}
          help="Protein grams are compared with the plan target, which uses g/kg body-weight logic and caps impossible values inside the calorie target."
        />
        <WeightLossInsightMetric
          label="Energy gap"
          value={formatSigned(energy.estimatedDailyEnergyBalanceKcal)}
          detail={energyGapDetail(view)}
          icon={Gauge}
          tone="amber"
          help="Energy gap estimates intake minus expenditure. Expenditure keeps active calories independent from the objective; the deficit or surplus comes from the selected weekly change rate."
        />
        <WeightLossInsightMetric
          label="Weight trend"
          value={formatSigned(trend.sevenDayRateKg, 2)}
          detail={`Latest ${formatNumber(trend.latestWeightKg, 1)} kg. Trend uses check-ins, not noisy single weigh-ins.`}
          icon={Activity}
          tone="green"
          help="Weight trend uses recent body check-ins to estimate direction. Single weigh-ins can jump from water, sodium, gut content, and training inflammation."
        />
      </section>

      <WeightLossDataQualityPanel view={view} />

      <WeightLossNutritionTargetsPanel view={view} />

      <section className="grid gap-4 xl:grid-cols-4">
        <WeightLossInsightMetric
          label="Food quality"
          value={scoreLabel(foodQuality.qualityScore)}
          detail={`Fiber density ${formatNumber(foodQuality.fiberPer1000Kcal, 1)}g/1000 kcal, protein density ${formatNumber(foodQuality.proteinPer1000Kcal, 1)}g/1000 kcal, ultra-processed share ${formatNumber(foodQuality.ultraProcessedShare, 0)}%.`}
          icon={Utensils}
          tone="green"
          help="Food quality combines density and exposure signals such as fiber per 1000 kcal, protein per 1000 kcal, ultra-processed share, sodium, sugar, and available micronutrient evidence."
        />
        <WeightLossInsightMetric
          label="Training fuel"
          value={scoreLabel(trainingFuel.fuelingScore)}
          detail={`Recent workout load ${formatNumber(trainingFuel.recentTrainingLoad)} with ${formatNumber(trainingFuel.carbsPerTrainingLoad, 1)}g carbs per load unit.`}
          icon={Dumbbell}
          tone="amber"
          help="Training fuel relates carbohydrate and protein timing to recent workout load. It is meant to find performance and recovery patterns, not force a fixed carb rule."
        />
        <WeightLossInsightMetric
          label="Subjective"
          value={scoreLabel(subjective.averageFocus)}
          detail="Focus, energy, hunger, cravings, and performance are tracked as food-effect evidence."
          icon={Activity}
          help="Subjective signals are self-rated energy, focus, hunger, cravings, and performance. Forge uses them to discover food and timing effects."
        />
        <WeightLossInsightMetric
          label="Gut"
          value={scoreLabel(gut.averageBloating)}
          detail="Bloating, reflux, stool type, and suspected triggers connect food choices to comfort and look."
          icon={Waves}
          tone="rose"
          help="Gut signals include bloating, reflux, stool type, and suspected triggers. They help connect foods to comfort, water retention, and appearance hypotheses."
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
        onChange={(nextDraft) => {
          setPlanDraft(nextDraft);
          setPlanError(null);
        }}
        pending={targetMutation.isPending}
        error={
          planError ??
          (targetMutation.error instanceof Error
            ? targetMutation.error.message
            : null)
        }
        onSubmit={async () => {
          const validationError =
            validateWeightLossPlanDraft(resolvedPlanDraft);
          if (validationError) {
            setPlanError(validationError);
            return;
          }
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
        chatGptPending={chatGptFoodParseMutation.isPending}
        chatGptError={
          chatGptFoodParseMutation.error instanceof Error
            ? chatGptFoodParseMutation.error.message
            : null
        }
        logPending={
          createFoodLogMutation.isPending || patchFoodLogMutation.isPending
        }
        intent={foodDialogIntent}
        initialStepId={foodInitialStepId}
        onSearch={(query) => foodSearchMutation.mutate(query)}
        onParseWithChatGpt={(text) =>
          chatGptFoodParseMutation.mutateAsync(text).then(() => undefined)
        }
        mode={editingFoodLogId ? "edit" : "create"}
        onSubmit={async () => {
          if (editingFoodLogId) {
            await patchFoodLogMutation.mutateAsync({
              foodLogId: editingFoodLogId,
              draft: foodDraft
            });
            return;
          }
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
        pending={
          logSavedMealMutation.isPending || deleteFoodLogMutation.isPending
        }
        onLogAgain={(meal) => logSavedMealMutation.mutate(meal)}
        onEdit={openEditFoodLog}
        onDelete={deleteFoodLog}
      />
    </div>
  );
}
