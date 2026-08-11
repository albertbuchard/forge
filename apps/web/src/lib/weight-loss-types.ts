export type NutritionMealItemInput = {
  foodId?: string | null;
  name: string;
  brand?: string | null;
  quantity: number;
  unit?: string | null;
  grams?: number | null;
  calories?: number | null;
  proteinGrams?: number | null;
  carbohydrateGrams?: number | null;
  fatGrams?: number | null;
  fiberGrams?: number | null;
  sugarGrams?: number | null;
  sodiumMg?: number | null;
  potassiumMg?: number | null;
  caffeineMg?: number | null;
  alcoholGrams?: number | null;
  glycemicIndex?: number | null;
  novaGroup?: number | null;
  fermented?: boolean | null;
  probiotic?: boolean | null;
  fodmapLevel?: "low" | "medium" | "high" | null;
  tags?: string[];
  confidence?: number | null;
};

export type NutritionMealItem = NutritionMealItemInput & {
  id: string;
  foodId: string | null;
  sortOrder: number;
};

export type NutritionFoodLogInput = {
  userId?: string;
  loggedAt?: string;
  timeZone?: string;
  mealLabel?: string | null;
  source?: "manual" | "search" | "barcode" | "chatgpt" | "photo" | "saved_meal";
  confirmationState?: "candidate" | "confirmed" | "needs_review" | "discarded";
  placeId?: string | null;
  stayId?: string | null;
  workoutId?: string | null;
  sleepId?: string | null;
  dayKey?: string | null;
  imageRefs?: string[];
  parserProvenance?: Record<string, unknown>;
  satietyScore?: number | null;
  hungerBefore?: number | null;
  hungerAfter?: number | null;
  cravingScore?: number | null;
  enjoymentScore?: number | null;
  socialContext?: string | null;
  locationContext?: string | null;
  notes?: string;
  items: NutritionMealItemInput[];
};

export type NutritionFoodLogPatchInput = Partial<
  Omit<NutritionFoodLogInput, "items">
> & {
  items?: NutritionMealItemInput[];
};

export type NutritionFoodLog = {
  id: string;
  userId: string;
  loggedAt: string;
  mealLabel: string | null;
  source: string;
  confirmationState: string;
  placeId: string | null;
  stayId: string | null;
  workoutId: string | null;
  sleepId: string | null;
  dayKey: string;
  imageRefs: string[];
  parserProvenance: Record<string, unknown>;
  satietyScore: number | null;
  hungerBefore: number | null;
  hungerAfter: number | null;
  cravingScore: number | null;
  enjoymentScore: number | null;
  socialContext: string | null;
  locationContext: string | null;
  notes: string | null;
  totals: {
    calories: number;
    proteinGrams: number;
    carbohydrateGrams: number;
    fatGrams: number;
    fiberGrams: number;
    sugarGrams: number;
    sodiumMg: number;
    potassiumMg: number;
    caffeineMg: number;
    alcoholGrams: number;
  };
  items: NutritionMealItem[];
};

export type NutritionTarget = {
  id?: string | null;
  userId?: string;
  calorieTarget: number;
  proteinGramsTarget: number;
  fiberGramsTarget: number;
  carbohydrateGramsTarget: number | null;
  fatGramsTarget: number | null;
  weeklyRateGoalKg: number | null;
  goalBodyWeightKg?: number | null;
  weightGoalKg?: number | null;
  dietStyle: string | null;
  trainingGoal?: string | null;
  bodyGoal?: string | null;
  notes: string | null;
  createdAt?: string | null;
  updatedAt: string | null;
};

export type NutritionTargetPatchInput = Partial<
  Omit<NutritionTarget, "updatedAt">
>;

export type NutritionFoodSearchResult = {
  id: string;
  source: string;
  sourceId: string | null;
  name: string;
  brand: string | null;
  barcode: string | null;
  servingLabel: string | null;
  servingGrams: number | null;
  calories: number | null;
  proteinGrams: number | null;
  carbohydrateGrams: number | null;
  fatGrams: number | null;
  fiberGrams: number | null;
  sugarGrams: number | null;
  sodiumMg: number | null;
  potassiumMg: number | null;
  caffeineMg: number | null;
  alcoholGrams: number | null;
  glycemicIndex: number | null;
  novaGroup: number | null;
  nutriScore?: string | null;
  tags: string[];
  nutrients?: Record<string, unknown>;
  confidence?: number | null;
};

export type NutritionCheckinInput = {
  checkedAt?: string;
  weightKg?: number | null;
  waistCm?: number | null;
  hipCm?: number | null;
  neckCm?: number | null;
  bodyFatPercent?: number | null;
  photoAssetId?: string | null;
  notes?: string | null;
};

export type NutritionAppearanceInput = {
  checkedAt?: string;
  muscleFullness?: number | null;
  leanness?: number | null;
  vascularity?: number | null;
  facePuffiness?: number | null;
  abdomenBloatLook?: number | null;
  postureConfidence?: number | null;
  outfitFit?: number | null;
  aestheticScore?: number | null;
  notes?: string | null;
};

export type NutritionSubjectiveInput = {
  checkedAt?: string;
  energy?: number | null;
  mood?: number | null;
  focus?: number | null;
  libido?: number | null;
  sleepiness?: number | null;
  soreness?: number | null;
  stress?: number | null;
  hunger?: number | null;
  cravings?: number | null;
  workoutPerformance?: number | null;
  timeRelation?: string | null;
  linkedFoodLogId?: string | null;
  notes?: string | null;
};

export type NutritionGutInput = {
  checkedAt?: string;
  bloating?: number | null;
  abdominalPain?: number | null;
  gas?: number | null;
  reflux?: number | null;
  nausea?: number | null;
  stoolType?: number | null;
  stoolFrequency?: number | null;
  suspectedTrigger?: string | null;
  linkedFoodLogId?: string | null;
  notes?: string | null;
};

export type NutritionExperimentInput = {
  title: string;
  hypothesis: string;
  metricKey: string;
  intervention: string;
  baselineStart?: string | null;
  baselineEnd?: string | null;
  experimentStart?: string | null;
  experimentEnd?: string | null;
  status?: "planned" | "running" | "paused" | "completed" | "abandoned";
  successCriteria?: string | null;
  confounders?: string[];
};

export type NutritionExperimentPatchInput =
  Partial<NutritionExperimentInput> & {
    conclusion?: string | null;
  };

export type NutritionExperiment = {
  id: string;
  userId: string;
  hypothesisId: string | null;
  title: string;
  status: "planned" | "running" | "paused" | "completed" | "abandoned";
  hypothesis: string | null;
  metricKey: string | null;
  intervention: string | null;
  baselineStart: string | null;
  baselineEnd: string | null;
  experimentStart: string | null;
  experimentEnd: string | null;
  interventionStart: string | null;
  interventionEnd: string | null;
  successCriteria: string | null;
  confounders: string[];
  trackedOutcomes: string[];
  protocol: Record<string, unknown>;
  adherence: Record<string, unknown>;
  resultSummary: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WeightLossViewData = {
  userId: string;
  generatedAt: string;
  target: NutritionTarget;
  summary: {
    loggedMealCount: number;
    trackedDays: number;
    todayCalories: number;
    targetCalories: number;
    todayCalorieDelta: number;
    remainingCalories: number;
    averageCalories: number | null;
    inferredTdee: number | null;
    proteinCoverage: number | null;
    fiberCoverage: number | null;
    unconfirmedCount: number;
    hypothesisCount: number;
    dataQualityScore: number;
  };
  todayLedger: {
    dateKey: string;
    meals: NutritionFoodLog[];
    totals: {
      calories: number;
      proteinGrams: number;
      carbohydrateGrams: number;
      fatGrams: number;
      fiberGrams: number;
      sodiumMg: number;
      caffeineMg: number;
      alcoholGrams: number;
    };
    plannedTargetCalories: number;
    targetCalories: number;
    activeAdjustmentCalories: number;
    activeCaloriesSource: string;
    calorieDelta: number;
    remainingCalories: number;
    proteinCoverage: number | null;
    fiberCoverage: number | null;
    unconfirmedCount: number;
  };
  recentMeals: NutritionFoodLog[];
  bodyCheckins: Array<Record<string, unknown>>;
  appearanceCheckins: Array<Record<string, unknown>>;
  energyModel: {
    activeEnergyCalories: number | null;
    restingEnergyCalories: number | null;
    formulaRestingKcal: number | null;
    wearableRestingKcal: number | null;
    wearableRestingSource: string | null;
    wearableRestingDayCount: number;
    wearableRestingCoverageQualifiedDayCount: number;
    chosenRestingKcal: number | null;
    chosenRestingSource: string | null;
    restingConfidence: string;
    restingExclusionReasons: string[];
    wearableConfidence: string;
    inferredTdee: number | null;
    estimatedTdeeKcal: number | null;
    activeBurnKcal: number | null;
    activeBaselineWindowDays: number;
    activeBaselineMinimumEvidenceDays: number;
    activeBaselineEvidenceDays: number;
    activeBaselineSelectedEvidenceDays: number;
    activeBaselineCoverage: number;
    activeBaselineReliability: "none" | "sparse" | "partial" | "complete";
    activeBaselineDecision:
      | "configured_default_sparse_evidence"
      | "configured_default_no_measured_evidence"
      | "sparse_measured_only"
      | "measured_baseline"
      | "no_baseline";
    activeBaselineSource:
      | "healthkit_daily_active_energy"
      | "workout_movement_fallback"
      | null;
    activeBaselineObservedCaloriesKcal: number | null;
    baselineActiveCaloriesKcal: number;
    canonicalUnits: {
      energy: "kcal";
      bodyMass: "kg";
      macronutrients: "g";
    };
    todayActiveCaloriesKcal: number;
    todayObservedActiveCaloriesKcal: number | null;
    todayActiveCaloriesSource: string;
    todayTargetAdjustmentKcal: number;
    todayActiveDeltaKcal: number;
    todayActiveSurplusKcal: number;
    todayActivityBufferKcal: number;
    activityEatBackFraction: number;
    todayWorkoutEnergyKcal: number | null;
    todayMovementCaloriesKcal: number | null;
    todayHealthKitActiveCaloriesKcal: number | null;
    todayStepCount: number | null;
    todayStepEstimatedCaloriesKcal: number | null;
    todayActiveOverride: {
      id: string;
      userId: string;
      dayKey: string;
      activeCaloriesKcal: number;
      notes: string;
      createdAt: string;
      updatedAt: string;
    } | null;
    movementCaloriesKcal: number | null;
    workoutEnergyKcal: number | null;
    averageCalorieIntake: number;
    recentFoodLogCount: number;
    recentFoodLogDayCount: number;
    currentDeficitEstimate: number | null;
    estimatedDailyEnergyBalanceKcal: number | null;
    energySourceConfidence: string;
    evidenceDays: number;
    exerciseMinutesAverage: number | null;
    stepCountAverage: number | null;
    sourceAvailability: {
      healthKitDailyEnergy: boolean;
      movementTripCalories: boolean;
      workoutEnergy: boolean;
    };
  };
  weightTrend: {
    latestWeightKg: number | null;
    latestCheckedAt: string | null;
    latestWeightSource: string | null;
    deltaFromPreviousKg: number | null;
    deltaFromFirstKg: number | null;
    trendWeightKg: number | null;
    weeklyRateKg: number | null;
    sevenDayRateKg: number | null;
    waistToHeightRatio: number | null;
  };
  foodQuality: Record<string, unknown>;
  trainingFuel: Record<string, unknown>;
  subjective: Record<string, unknown>;
  gut: Record<string, unknown>;
  hypotheses: Array<Record<string, unknown>>;
  experiments: NutritionExperiment[];
  dataQuality: {
    sourceConfidence: string;
    missingHighValueCheckins: string[];
    notes: string;
  };
};
