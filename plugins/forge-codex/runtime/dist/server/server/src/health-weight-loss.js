import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase, runInTransaction } from "./db.js";
import { getSettings } from "./repositories/settings.js";
import { getDefaultUser, resolveUserForMutation } from "./repositories/users.js";
const optionalNumberSchema = z
    .union([z.coerce.number().finite(), z.null()])
    .optional();
const scoreSchema = z
    .union([z.coerce.number().int().min(0).max(10), z.null()])
    .optional();
const tagsSchema = z.array(z.string().trim().min(1)).default([]);
const linksSchema = z
    .array(z.object({
    entityType: z.string().trim().min(1),
    entityId: z.string().trim().min(1),
    relationshipType: z.string().trim().min(1).default("context")
}))
    .default([]);
const mealItemInputSchema = z.preprocess((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value;
    }
    const record = value;
    return {
        ...record,
        calories: record.calories ?? record.caloriesKcal,
        proteinGrams: record.proteinGrams ?? record.proteinG,
        carbohydrateGrams: record.carbohydrateGrams ?? record.carbsG,
        fatGrams: record.fatGrams ?? record.fatG,
        fiberGrams: record.fiberGrams ?? record.fiberG,
        sugarGrams: record.sugarGrams ?? record.sugarG,
        alcoholGrams: record.alcoholGrams ?? record.alcoholG
    };
}, z.object({
    id: z.string().trim().min(1).optional(),
    foodId: z.string().trim().min(1).nullable().optional(),
    name: z.string().trim().min(1),
    quantity: z.coerce.number().positive().default(1),
    unit: z.string().trim().min(1).default("serving"),
    grams: optionalNumberSchema,
    calories: optionalNumberSchema,
    proteinGrams: optionalNumberSchema,
    carbohydrateGrams: optionalNumberSchema,
    fatGrams: optionalNumberSchema,
    fiberGrams: optionalNumberSchema,
    sugarGrams: optionalNumberSchema,
    sodiumMg: optionalNumberSchema,
    potassiumMg: optionalNumberSchema,
    caffeineMg: optionalNumberSchema,
    alcoholGrams: optionalNumberSchema,
    tags: tagsSchema,
    nutrients: z.record(z.string(), z.unknown()).default({}),
    confidence: z.coerce.number().min(0).max(1).default(0.65)
}));
export const nutritionFoodSearchSchema = z.object({
    query: z.string().trim().min(1),
    limit: z.coerce.number().int().min(1).max(25).default(12)
});
export const nutritionBarcodeLookupSchema = z.object({
    barcode: z.string().trim().min(3),
    limit: z.coerce.number().int().min(1).max(10).default(5)
});
export const nutritionTargetUpdateSchema = z.object({
    userId: z.string().trim().min(1).optional(),
    calorieTarget: optionalNumberSchema,
    proteinGramsTarget: optionalNumberSchema,
    fiberGramsTarget: optionalNumberSchema,
    carbohydrateGramsTarget: optionalNumberSchema,
    fatGramsTarget: optionalNumberSchema,
    weightGoalKg: optionalNumberSchema,
    weeklyRateGoalKg: optionalNumberSchema,
    dietStyle: z.string().trim().default(""),
    bodyGoal: z.string().trim().default(""),
    notes: z.string().trim().default("")
});
export const nutritionDailyActiveCaloriesUpdateSchema = z.object({
    userId: z.string().trim().min(1).optional(),
    dayKey: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    activeCaloriesKcal: z
        .union([z.null(), z.coerce.number().finite().min(0)])
        .optional(),
    notes: z.string().trim().default("")
});
export const nutritionFoodLogCreateSchema = z.object({
    userId: z.string().trim().min(1).optional(),
    loggedAt: z.string().datetime().optional(),
    mealLabel: z.string().trim().default(""),
    source: z
        .enum(["manual", "search", "barcode", "chatgpt", "photo", "saved_meal"])
        .default("manual"),
    confirmationState: z
        .enum(["candidate", "confirmed", "needs_review", "discarded"])
        .default("confirmed"),
    notes: z.string().trim().default(""),
    placeId: z.string().trim().min(1).nullable().optional(),
    stayId: z.string().trim().min(1).nullable().optional(),
    workoutId: z.string().trim().min(1).nullable().optional(),
    sleepId: z.string().trim().min(1).nullable().optional(),
    imageRefs: z.array(z.string().trim().min(1)).default([]),
    parserProvenance: z.record(z.string(), z.unknown()).default({}),
    links: linksSchema,
    items: z.array(mealItemInputSchema).min(1)
});
export const nutritionFoodLogPatchSchema = nutritionFoodLogCreateSchema
    .omit({ userId: true })
    .partial()
    .extend({
    items: z.array(mealItemInputSchema).optional()
});
export const nutritionBodyCheckinCreateSchema = z.object({
    userId: z.string().trim().min(1).optional(),
    checkedAt: z.string().datetime().optional(),
    weightKg: optionalNumberSchema,
    waistCm: optionalNumberSchema,
    hipCm: optionalNumberSchema,
    neckCm: optionalNumberSchema,
    chestCm: optionalNumberSchema,
    armCm: optionalNumberSchema,
    thighCm: optionalNumberSchema,
    bodyFatPercent: optionalNumberSchema,
    clothingFitScore: scoreSchema,
    notes: z.string().trim().default("")
});
export const nutritionAppearanceCheckinCreateSchema = z.object({
    userId: z.string().trim().min(1).optional(),
    checkedAt: z.string().datetime().optional(),
    photoRefs: z.array(z.string().trim().min(1)).default([]),
    facePuffiness: scoreSchema,
    leanness: scoreSchema,
    muscularity: scoreSchema,
    posture: scoreSchema,
    bloatingLook: scoreSchema,
    confidenceScore: scoreSchema,
    notes: z.string().trim().default("")
});
export const nutritionSubjectiveCheckinCreateSchema = z.object({
    userId: z.string().trim().min(1).optional(),
    checkedAt: z.string().datetime().optional(),
    mealLogId: z.string().trim().min(1).nullable().optional(),
    timeRelation: z
        .enum(["before_meal", "with_meal", "after_2h", "end_of_day", "unspecified"])
        .default("unspecified"),
    hunger: scoreSchema,
    fullness: scoreSchema,
    cravings: scoreSchema,
    mood: scoreSchema,
    energy: scoreSchema,
    focus: scoreSchema,
    stress: scoreSchema,
    sleepiness: scoreSchema,
    crashScore: scoreSchema,
    notes: z.string().trim().default("")
});
export const nutritionGutCheckinCreateSchema = z.object({
    userId: z.string().trim().min(1).optional(),
    checkedAt: z.string().datetime().optional(),
    mealLogId: z.string().trim().min(1).nullable().optional(),
    bristolStoolType: z
        .union([z.coerce.number().int().min(1).max(7), z.null()])
        .optional(),
    stoolFrequency: optionalNumberSchema,
    bloating: scoreSchema,
    gas: scoreSchema,
    reflux: scoreSchema,
    abdominalPain: scoreSchema,
    urgency: scoreSchema,
    nausea: scoreSchema,
    constipation: scoreSchema,
    diarrhea: scoreSchema,
    triggerTags: tagsSchema,
    notes: z.string().trim().default("")
});
export const nutritionExperimentCreateSchema = z.object({
    userId: z.string().trim().min(1).optional(),
    hypothesisId: z.string().trim().min(1).nullable().optional(),
    title: z.string().trim().min(1),
    status: z
        .enum(["planned", "running", "complete", "paused"])
        .default("planned"),
    baselineStart: z.string().trim().nullable().optional(),
    baselineEnd: z.string().trim().nullable().optional(),
    interventionStart: z.string().trim().nullable().optional(),
    interventionEnd: z.string().trim().nullable().optional(),
    trackedOutcomes: tagsSchema,
    protocol: z.record(z.string(), z.unknown()).default({}),
    adherence: z.record(z.string(), z.unknown()).default({}),
    resultSummary: z.string().trim().default("")
});
export const nutritionExperimentPatchSchema = nutritionExperimentCreateSchema
    .omit({ userId: true })
    .partial();
export const nutritionParseRequestSchema = z.object({
    text: z.string().trim().min(1),
    mealTime: z.string().datetime().optional(),
    imageRefs: z.array(z.string().trim().min(1)).default([]),
    userId: z.string().trim().min(1).optional(),
    connectionId: z.string().trim().min(1).optional(),
    commitCandidate: z.boolean().default(true)
});
function nowIso() {
    return new Date().toISOString();
}
function newId(prefix) {
    return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
function dayKey(value) {
    return value.slice(0, 10);
}
function jsonString(value) {
    return JSON.stringify(value ?? null);
}
function parseJson(value, fallback) {
    try {
        const parsed = JSON.parse(value);
        return parsed ?? fallback;
    }
    catch {
        return fallback;
    }
}
function n(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function round(value, digits = 1) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
function average(values) {
    const real = values.filter((value) => typeof value === "number" && Number.isFinite(value));
    if (real.length === 0) {
        return null;
    }
    return real.reduce((sum, value) => sum + value, 0) / real.length;
}
function metricTotal(metrics, key) {
    const metric = metrics[key];
    if (!metric || typeof metric !== "object") {
        return null;
    }
    const record = metric;
    for (const field of ["total", "average", "latest"]) {
        const value = record[field];
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
    }
    return null;
}
function parsePlanNoteNumber(notes, key) {
    if (!notes) {
        return null;
    }
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = notes.match(new RegExp(`${escapedKey}=([^;]+)`));
    const parsed = Number(match?.[1]?.trim());
    return Number.isFinite(parsed) ? parsed : null;
}
function estimateStepActiveCaloriesKcal(input) {
    if (input.stepCount == null ||
        input.stepCount <= 0 ||
        input.weightKg == null ||
        input.weightKg <= 0) {
        return null;
    }
    const estimatedKilometers = (input.stepCount * 0.762) / 1000;
    return estimatedKilometers * input.weightKg * 0.57;
}
function mapDailyEnergyOverride(row) {
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        userId: row.user_id,
        dayKey: row.day_key,
        activeCaloriesKcal: row.active_calories_kcal,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function getDailyEnergyOverride(userId, dateKey) {
    const row = getDatabase()
        .prepare(`SELECT *
       FROM nutrition_daily_energy_overrides
       WHERE user_id = ?
         AND day_key = ?`)
        .get(userId, dateKey);
    return mapDailyEnergyOverride(row);
}
function buildStoredEnergyModel(input) {
    const today = new Date();
    const start = new Date(today);
    start.setUTCDate(today.getUTCDate() - 6);
    const todayKey = today.toISOString().slice(0, 10);
    const startKey = start.toISOString().slice(0, 10);
    const dailySummaryRows = getDatabase()
        .prepare(`SELECT date_key, metrics_json
       FROM health_daily_summaries
       WHERE user_id = ?
         AND summary_type = 'vitals'
         AND date_key >= ?
       ORDER BY date_key DESC`)
        .all(input.userId, startKey);
    const dailyHealthKit = dailySummaryRows.map((row) => {
        const metrics = parseJson(row.metrics_json, {});
        return {
            dateKey: row.date_key,
            activeEnergyKcal: metricTotal(metrics, "activeEnergyBurned"),
            restingEnergyKcal: metricTotal(metrics, "basalEnergyBurned"),
            exerciseMinutes: metricTotal(metrics, "appleExerciseTime"),
            stepCount: metricTotal(metrics, "stepCount")
        };
    });
    const workoutRows = getDatabase()
        .prepare(`SELECT date(started_at) AS date_key,
              SUM(active_energy_kcal) AS active_energy_kcal,
              SUM(total_energy_kcal) AS total_energy_kcal,
              NULL AS movement_calories_kcal
       FROM health_workout_sessions
       WHERE user_id = ?
         AND date(started_at) >= ?
       GROUP BY date(started_at)`)
        .all(input.userId, startKey);
    const movementRows = getDatabase()
        .prepare(`SELECT date(started_at) AS date_key,
              NULL AS active_energy_kcal,
              NULL AS total_energy_kcal,
              SUM(calories_kcal) AS movement_calories_kcal
       FROM movement_trips
       WHERE user_id = ?
         AND date(started_at) >= ?
       GROUP BY date(started_at)`)
        .all(input.userId, startKey);
    const workoutByDay = new Map(workoutRows.map((row) => [
        row.date_key,
        n(row.active_energy_kcal) || n(row.total_energy_kcal) || null
    ]));
    const movementByDay = new Map(movementRows.map((row) => [
        row.date_key,
        n(row.movement_calories_kcal) || null
    ]));
    const activeEnergyAverage = average(dailyHealthKit.map((day) => day.activeEnergyKcal));
    const restingEnergyAverage = average(dailyHealthKit.map((day) => day.restingEnergyKcal));
    const workoutEnergyAverage = average([...workoutByDay.values()]);
    const movementCaloriesAverage = average([...movementByDay.values()]);
    const fallbackActiveBurn = workoutEnergyAverage != null || movementCaloriesAverage != null
        ? n(workoutEnergyAverage) + n(movementCaloriesAverage)
        : null;
    const activeBurnKcal = activeEnergyAverage ?? fallbackActiveBurn;
    const baselineActiveCalories = input.defaultActiveCalories ?? activeBurnKcal ?? 0;
    const todayHealthKitActive = dailyHealthKit.find((day) => day.dateKey === todayKey)?.activeEnergyKcal ??
        null;
    const todayStepCount = dailyHealthKit.find((day) => day.dateKey === todayKey)?.stepCount ?? null;
    const todayWorkoutEnergy = workoutByDay.get(todayKey) ?? null;
    const todayMovementCalories = movementByDay.get(todayKey) ?? null;
    const todayWorkoutMovementCalories = todayWorkoutEnergy != null || todayMovementCalories != null
        ? n(todayWorkoutEnergy) + n(todayMovementCalories)
        : null;
    const todayStepEstimatedCalories = estimateStepActiveCaloriesKcal({
        stepCount: todayStepCount,
        weightKg: input.latestWeightKg
    });
    const todayFallbackPartCount = [
        todayWorkoutEnergy,
        todayMovementCalories,
        todayStepEstimatedCalories
    ].filter((value) => value != null).length;
    const todayFallbackActiveCalories = todayFallbackPartCount > 0
        ? n(todayWorkoutEnergy) +
            n(todayMovementCalories) +
            n(todayStepEstimatedCalories)
        : null;
    const todayObservedActiveCalories = todayHealthKitActive ?? todayFallbackActiveCalories;
    const todayFallbackSource = (() => {
        if (todayWorkoutEnergy != null &&
            todayMovementCalories != null &&
            todayStepEstimatedCalories != null) {
            return "today_workout_movement_step_energy";
        }
        if (todayWorkoutEnergy != null && todayStepEstimatedCalories != null) {
            return "today_workout_step_energy";
        }
        if (todayMovementCalories != null && todayStepEstimatedCalories != null) {
            return "today_movement_step_energy";
        }
        if (todayWorkoutEnergy != null && todayMovementCalories != null) {
            return "today_workout_movement_energy";
        }
        if (todayWorkoutEnergy != null) {
            return "today_workout_energy";
        }
        if (todayMovementCalories != null) {
            return "today_movement_trip_calories";
        }
        if (todayStepEstimatedCalories != null) {
            return "today_step_estimate";
        }
        return "default_active_calories";
    })();
    const todayActiveSource = input.dailyActiveOverride != null
        ? "user_override"
        : todayHealthKitActive != null
            ? "today_healthkit_active_energy"
            : todayFallbackActiveCalories != null
                ? todayFallbackSource
                : "default_active_calories";
    const todayActiveCalories = input.dailyActiveOverride?.activeCaloriesKcal ??
        todayObservedActiveCalories ??
        baselineActiveCalories;
    const todayTargetAdjustmentKcal = todayActiveCalories - baselineActiveCalories;
    const estimatedTdeeKcal = activeBurnKcal != null && restingEnergyAverage != null
        ? round(activeBurnKcal + restingEnergyAverage, 0)
        : input.inferredTdee;
    const hasHealthKitEnergy = activeEnergyAverage != null ||
        restingEnergyAverage != null ||
        workoutEnergyAverage != null;
    const hasMovementEnergy = movementCaloriesAverage != null;
    const sourceConfidence = activeEnergyAverage != null
        ? "healthkit_daily_active_energy"
        : fallbackActiveBurn != null
            ? "workout_movement_fallback"
            : "target_inference_only";
    return {
        activeEnergyCalories: activeEnergyAverage != null ? round(activeEnergyAverage, 0) : null,
        restingEnergyCalories: restingEnergyAverage != null ? round(restingEnergyAverage, 0) : null,
        wearableConfidence: hasHealthKitEnergy
            ? "measured_directional"
            : "directional",
        inferredTdee: input.inferredTdee,
        estimatedTdeeKcal,
        activeBurnKcal: activeBurnKcal != null ? round(activeBurnKcal, 0) : null,
        baselineActiveCaloriesKcal: round(baselineActiveCalories, 0),
        todayActiveCaloriesKcal: round(todayActiveCalories, 0),
        todayObservedActiveCaloriesKcal: todayObservedActiveCalories != null
            ? round(todayObservedActiveCalories, 0)
            : null,
        todayActiveCaloriesSource: todayActiveSource,
        todayTargetAdjustmentKcal: round(todayTargetAdjustmentKcal, 0),
        todayWorkoutEnergyKcal: todayWorkoutEnergy != null ? round(todayWorkoutEnergy, 0) : null,
        todayMovementCaloriesKcal: todayMovementCalories != null ? round(todayMovementCalories, 0) : null,
        todayHealthKitActiveCaloriesKcal: todayHealthKitActive != null ? round(todayHealthKitActive, 0) : null,
        todayStepCount: todayStepCount != null ? round(todayStepCount, 0) : null,
        todayStepEstimatedCaloriesKcal: todayStepEstimatedCalories != null
            ? round(todayStepEstimatedCalories, 0)
            : null,
        todayActiveOverride: input.dailyActiveOverride,
        movementCaloriesKcal: movementCaloriesAverage != null
            ? round(movementCaloriesAverage, 0)
            : null,
        workoutEnergyKcal: workoutEnergyAverage != null ? round(workoutEnergyAverage, 0) : null,
        averageCalorieIntake: input.averageCalories,
        currentDeficitEstimate: estimatedTdeeKcal != null
            ? round(input.averageCalories - estimatedTdeeKcal, 0)
            : null,
        estimatedDailyEnergyBalanceKcal: estimatedTdeeKcal != null
            ? round(input.averageCalories - estimatedTdeeKcal, 0)
            : null,
        energySourceConfidence: sourceConfidence,
        evidenceDays: new Set([
            ...dailyHealthKit.map((day) => day.dateKey),
            ...workoutRows.map((row) => row.date_key),
            ...movementRows.map((row) => row.date_key)
        ]).size,
        exerciseMinutesAverage: average(dailyHealthKit.map((day) => day.exerciseMinutes)),
        stepCountAverage: average(dailyHealthKit.map((day) => day.stepCount)),
        sourceAvailability: {
            healthKitDailyEnergy: hasHealthKitEnergy,
            movementTripCalories: hasMovementEnergy,
            workoutEnergy: workoutEnergyAverage != null
        }
    };
}
function resolveWriteUser(userId) {
    return resolveUserForMutation(userId ?? null).id;
}
function resolveReadUser(userIds) {
    return userIds?.[0] ?? getDefaultUser().id;
}
function mapFood(row) {
    const nutrients = parseJson(row.nutrients_json, {});
    const servingGrams = row.serving_grams ??
        (row.source === "open_food_facts"
            ? parseGramQuantity(row.serving_label)
            : null);
    const openFoodFactsNutrient = (currentValue, per100gKey, perServingKey, multiplier = 1) => {
        if (row.source !== "open_food_facts") {
            return currentValue;
        }
        const perServing = nutrients[perServingKey];
        if (typeof perServing === "number" && Number.isFinite(perServing)) {
            return round(perServing * multiplier, multiplier === 1 ? 1 : 0);
        }
        const per100g = nutrients[per100gKey];
        if (typeof per100g === "number" &&
            Number.isFinite(per100g) &&
            servingGrams != null) {
            return round((per100g * servingGrams * multiplier) / 100, multiplier === 1 ? 1 : 0);
        }
        return currentValue;
    };
    return {
        id: row.id,
        source: row.source,
        sourceId: row.source_id,
        barcode: row.barcode,
        name: row.name,
        brand: row.brand,
        servingLabel: row.serving_label,
        servingGrams,
        calories: openFoodFactsNutrient(row.calories, "energy-kcal_100g", "energy-kcal_serving"),
        proteinGrams: openFoodFactsNutrient(row.protein_grams, "proteins_100g", "proteins_serving"),
        carbohydrateGrams: openFoodFactsNutrient(row.carbohydrate_grams, "carbohydrates_100g", "carbohydrates_serving"),
        fatGrams: openFoodFactsNutrient(row.fat_grams, "fat_100g", "fat_serving"),
        fiberGrams: openFoodFactsNutrient(row.fiber_grams, "fiber_100g", "fiber_serving"),
        sugarGrams: openFoodFactsNutrient(row.sugar_grams, "sugars_100g", "sugars_serving"),
        sodiumMg: openFoodFactsNutrient(row.sodium_mg, "sodium_100g", "sodium_serving", 1000),
        potassiumMg: row.potassium_mg,
        caffeineMg: row.caffeine_mg,
        alcoholGrams: row.alcohol_grams,
        novaGroup: row.nova_group,
        nutriScore: row.nutri_score,
        tags: parseJson(row.tags_json, []),
        nutrients,
        confidence: row.confidence,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function mapItem(row) {
    return {
        id: row.id,
        logId: row.log_id,
        foodId: row.food_id,
        name: row.name,
        quantity: row.quantity,
        unit: row.unit,
        grams: row.grams,
        calories: row.calories,
        proteinGrams: row.protein_grams,
        carbohydrateGrams: row.carbohydrate_grams,
        fatGrams: row.fat_grams,
        fiberGrams: row.fiber_grams,
        sugarGrams: row.sugar_grams,
        sodiumMg: row.sodium_mg,
        potassiumMg: row.potassium_mg,
        caffeineMg: row.caffeine_mg,
        alcoholGrams: row.alcohol_grams,
        tags: parseJson(row.tags_json, []),
        nutrients: parseJson(row.nutrients_json, {}),
        confidence: row.confidence,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function mapFoodLog(row, items = []) {
    return {
        id: row.id,
        userId: row.user_id,
        loggedAt: row.logged_at,
        mealLabel: row.meal_label,
        source: row.source,
        confirmationState: row.confirmation_state,
        notes: row.notes,
        placeId: row.place_id,
        stayId: row.stay_id,
        workoutId: row.workout_id,
        sleepId: row.sleep_id,
        dayKey: row.day_key,
        imageRefs: parseJson(row.image_refs_json, []),
        parserProvenance: parseJson(row.parser_provenance_json, {}),
        links: parseJson(row.links_json, []),
        items: items.map(mapItem),
        totals: sumItems(items.map(mapItem)),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function mapTarget(row, userId) {
    return {
        id: row?.id ?? null,
        userId,
        calorieTarget: row?.calorie_target ?? 2200,
        proteinGramsTarget: row?.protein_grams_target ?? 140,
        fiberGramsTarget: row?.fiber_grams_target ?? 30,
        carbohydrateGramsTarget: row?.carbohydrate_grams_target ?? null,
        fatGramsTarget: row?.fat_grams_target ?? null,
        weightGoalKg: row?.weight_goal_kg ?? null,
        weeklyRateGoalKg: row?.weekly_rate_goal_kg ?? -0.35,
        dietStyle: row?.diet_style ?? "",
        bodyGoal: row?.body_goal ?? "",
        notes: row?.notes ?? "",
        createdAt: row?.created_at ?? null,
        updatedAt: row?.updated_at ?? null
    };
}
function sumItems(items) {
    return {
        calories: round(items.reduce((sum, item) => sum + n(item.calories), 0), 0),
        proteinGrams: round(items.reduce((sum, item) => sum + n(item.proteinGrams), 0), 1),
        carbohydrateGrams: round(items.reduce((sum, item) => sum + n(item.carbohydrateGrams), 0), 1),
        fatGrams: round(items.reduce((sum, item) => sum + n(item.fatGrams), 0), 1),
        fiberGrams: round(items.reduce((sum, item) => sum + n(item.fiberGrams), 0), 1),
        sugarGrams: round(items.reduce((sum, item) => sum + n(item.sugarGrams), 0), 1),
        sodiumMg: round(items.reduce((sum, item) => sum + n(item.sodiumMg), 0), 0),
        potassiumMg: round(items.reduce((sum, item) => sum + n(item.potassiumMg), 0), 0),
        caffeineMg: round(items.reduce((sum, item) => sum + n(item.caffeineMg), 0), 0),
        alcoholGrams: round(items.reduce((sum, item) => sum + n(item.alcoholGrams), 0), 1)
    };
}
function readMealItems(logIds) {
    if (logIds.length === 0) {
        return new Map();
    }
    const placeholders = logIds.map(() => "?").join(",");
    const rows = getDatabase()
        .prepare(`SELECT *
       FROM nutrition_meal_items
       WHERE log_id IN (${placeholders})
       ORDER BY created_at ASC`)
        .all(...logIds);
    const byLog = new Map();
    for (const row of rows) {
        byLog.set(row.log_id, [...(byLog.get(row.log_id) ?? []), row]);
    }
    return byLog;
}
function listFoodLogs(userId, limit = 120) {
    const rows = getDatabase()
        .prepare(`SELECT *
       FROM nutrition_food_logs
       WHERE user_id = ?
         AND confirmation_state != 'discarded'
       ORDER BY logged_at DESC
       LIMIT ?`)
        .all(userId, limit);
    const itemsByLog = readMealItems(rows.map((row) => row.id));
    return rows.map((row) => mapFoodLog(row, itemsByLog.get(row.id) ?? []));
}
function insertMealItem(logId, input) {
    const now = nowIso();
    const id = input.id ?? newId("meal_item");
    getDatabase()
        .prepare(`INSERT INTO nutrition_meal_items (
        id, log_id, food_id, name, quantity, unit, grams, calories,
        protein_grams, carbohydrate_grams, fat_grams, fiber_grams, sugar_grams,
        sodium_mg, potassium_mg, caffeine_mg, alcohol_grams, tags_json,
        nutrients_json, confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, logId, input.foodId ?? null, input.name, input.quantity, input.unit, input.grams ?? null, input.calories ?? null, input.proteinGrams ?? null, input.carbohydrateGrams ?? null, input.fatGrams ?? null, input.fiberGrams ?? null, input.sugarGrams ?? null, input.sodiumMg ?? null, input.potassiumMg ?? null, input.caffeineMg ?? null, input.alcoholGrams ?? null, jsonString(input.tags), jsonString(input.nutrients), input.confidence, now, now);
}
export function createNutritionFoodLog(input) {
    const parsed = nutritionFoodLogCreateSchema.parse(input);
    const userId = resolveWriteUser(parsed.userId);
    const loggedAt = parsed.loggedAt ?? nowIso();
    const id = newId("meal");
    const now = nowIso();
    runInTransaction(() => {
        getDatabase()
            .prepare(`INSERT INTO nutrition_food_logs (
          id, user_id, logged_at, meal_label, source, confirmation_state, notes,
          place_id, stay_id, workout_id, sleep_id, day_key, image_refs_json,
          parser_provenance_json, links_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, userId, loggedAt, parsed.mealLabel, parsed.source, parsed.confirmationState, parsed.notes, parsed.placeId ?? null, parsed.stayId ?? null, parsed.workoutId ?? null, parsed.sleepId ?? null, dayKey(loggedAt), jsonString(parsed.imageRefs), jsonString(parsed.parserProvenance), jsonString(parsed.links), now, now);
        for (const item of parsed.items) {
            insertMealItem(id, item);
        }
    });
    return getNutritionFoodLogById(id);
}
export function patchNutritionFoodLog(logId, input) {
    const parsed = nutritionFoodLogPatchSchema.parse(input);
    const existing = getNutritionFoodLogById(logId);
    if (!existing) {
        return null;
    }
    const nextLoggedAt = parsed.loggedAt ?? existing.loggedAt;
    const now = nowIso();
    runInTransaction(() => {
        getDatabase()
            .prepare(`UPDATE nutrition_food_logs
         SET logged_at = ?, meal_label = ?, source = ?, confirmation_state = ?,
             notes = ?, place_id = ?, stay_id = ?, workout_id = ?, sleep_id = ?,
             day_key = ?, image_refs_json = ?, parser_provenance_json = ?,
             links_json = ?, updated_at = ?
         WHERE id = ?`)
            .run(nextLoggedAt, parsed.mealLabel ?? existing.mealLabel, parsed.source ?? existing.source, parsed.confirmationState ?? existing.confirmationState, parsed.notes ?? existing.notes, parsed.placeId !== undefined ? parsed.placeId : existing.placeId, parsed.stayId !== undefined ? parsed.stayId : existing.stayId, parsed.workoutId !== undefined ? parsed.workoutId : existing.workoutId, parsed.sleepId !== undefined ? parsed.sleepId : existing.sleepId, dayKey(nextLoggedAt), jsonString(parsed.imageRefs ?? existing.imageRefs), jsonString(parsed.parserProvenance ?? existing.parserProvenance), jsonString(parsed.links ?? existing.links), now, logId);
        if (parsed.items) {
            getDatabase()
                .prepare(`DELETE FROM nutrition_meal_items WHERE log_id = ?`)
                .run(logId);
            for (const item of parsed.items) {
                insertMealItem(logId, item);
            }
        }
    });
    return getNutritionFoodLogById(logId);
}
export function deleteNutritionFoodLog(logId) {
    const existing = getNutritionFoodLogById(logId);
    if (!existing) {
        return null;
    }
    getDatabase()
        .prepare(`UPDATE nutrition_food_logs
       SET confirmation_state = 'discarded', updated_at = ?
       WHERE id = ?`)
        .run(nowIso(), logId);
    return existing;
}
export function getNutritionFoodLogById(logId) {
    const row = getDatabase()
        .prepare(`SELECT * FROM nutrition_food_logs WHERE id = ?`)
        .get(logId);
    if (!row) {
        return null;
    }
    const itemsByLog = readMealItems([logId]);
    return mapFoodLog(row, itemsByLog.get(logId) ?? []);
}
export function updateNutritionTarget(input) {
    const parsed = nutritionTargetUpdateSchema.parse(input);
    const userId = resolveWriteUser(parsed.userId);
    const existing = getDatabase()
        .prepare(`SELECT * FROM nutrition_targets WHERE user_id = ?`)
        .get(userId);
    const id = existing?.id ?? newId("nutrition_target");
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO nutrition_targets (
        id, user_id, calorie_target, protein_grams_target, fiber_grams_target,
        carbohydrate_grams_target, fat_grams_target, weight_goal_kg,
        weekly_rate_goal_kg, diet_style, body_goal, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        calorie_target = excluded.calorie_target,
        protein_grams_target = excluded.protein_grams_target,
        fiber_grams_target = excluded.fiber_grams_target,
        carbohydrate_grams_target = excluded.carbohydrate_grams_target,
        fat_grams_target = excluded.fat_grams_target,
        weight_goal_kg = excluded.weight_goal_kg,
        weekly_rate_goal_kg = excluded.weekly_rate_goal_kg,
        diet_style = excluded.diet_style,
        body_goal = excluded.body_goal,
        notes = excluded.notes,
        updated_at = excluded.updated_at`)
        .run(id, userId, parsed.calorieTarget ?? null, parsed.proteinGramsTarget ?? null, parsed.fiberGramsTarget ?? null, parsed.carbohydrateGramsTarget ?? null, parsed.fatGramsTarget ?? null, parsed.weightGoalKg ?? null, parsed.weeklyRateGoalKg ?? null, parsed.dietStyle, parsed.bodyGoal, parsed.notes, existing?.created_at ?? now, now);
    return mapTarget(getDatabase()
        .prepare(`SELECT * FROM nutrition_targets WHERE user_id = ?`)
        .get(userId), userId);
}
export function updateNutritionDailyActiveCalories(input) {
    const parsed = nutritionDailyActiveCaloriesUpdateSchema.parse(input);
    const userId = resolveWriteUser(parsed.userId);
    const dateKey = parsed.dayKey ?? new Date().toISOString().slice(0, 10);
    const now = nowIso();
    if (parsed.activeCaloriesKcal == null) {
        getDatabase()
            .prepare(`DELETE FROM nutrition_daily_energy_overrides
         WHERE user_id = ?
           AND day_key = ?`)
            .run(userId, dateKey);
        return { override: null, dayKey: dateKey };
    }
    const id = newId("daily_energy");
    getDatabase()
        .prepare(`INSERT INTO nutrition_daily_energy_overrides (
        id, user_id, day_key, active_calories_kcal, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, day_key) DO UPDATE SET
        active_calories_kcal = excluded.active_calories_kcal,
        notes = excluded.notes,
        updated_at = excluded.updated_at`)
        .run(id, userId, dateKey, parsed.activeCaloriesKcal, parsed.notes, now, now);
    return {
        override: getDailyEnergyOverride(userId, dateKey),
        dayKey: dateKey
    };
}
export function createNutritionBodyCheckin(input) {
    const parsed = nutritionBodyCheckinCreateSchema.parse(input);
    const userId = resolveWriteUser(parsed.userId);
    const checkedAt = parsed.checkedAt ?? nowIso();
    const id = newId("body");
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO nutrition_body_checkins (
        id, user_id, checked_at, weight_kg, waist_cm, hip_cm, neck_cm, chest_cm,
        arm_cm, thigh_cm, body_fat_percent, clothing_fit_score, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, userId, checkedAt, parsed.weightKg ?? null, parsed.waistCm ?? null, parsed.hipCm ?? null, parsed.neckCm ?? null, parsed.chestCm ?? null, parsed.armCm ?? null, parsed.thighCm ?? null, parsed.bodyFatPercent ?? null, parsed.clothingFitScore ?? null, parsed.notes, now, now);
    return listBodyCheckins(userId, 1)[0];
}
export function createNutritionAppearanceCheckin(input) {
    const parsed = nutritionAppearanceCheckinCreateSchema.parse(input);
    const userId = resolveWriteUser(parsed.userId);
    const checkedAt = parsed.checkedAt ?? nowIso();
    const id = newId("appearance");
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO nutrition_appearance_checkins (
        id, user_id, checked_at, photo_refs_json, face_puffiness, leanness,
        muscularity, posture, bloating_look, confidence_score, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, userId, checkedAt, jsonString(parsed.photoRefs), parsed.facePuffiness ?? null, parsed.leanness ?? null, parsed.muscularity ?? null, parsed.posture ?? null, parsed.bloatingLook ?? null, parsed.confidenceScore ?? null, parsed.notes, now, now);
    return listAppearanceCheckins(userId, 1)[0];
}
export function createNutritionSubjectiveCheckin(input) {
    const parsed = nutritionSubjectiveCheckinCreateSchema.parse(input);
    const userId = resolveWriteUser(parsed.userId);
    const checkedAt = parsed.checkedAt ?? nowIso();
    const id = newId("subjective");
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO nutrition_subjective_checkins (
        id, user_id, checked_at, meal_log_id, time_relation, hunger, fullness,
        cravings, mood, energy, focus, stress, sleepiness, crash_score, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, userId, checkedAt, parsed.mealLogId ?? null, parsed.timeRelation, parsed.hunger ?? null, parsed.fullness ?? null, parsed.cravings ?? null, parsed.mood ?? null, parsed.energy ?? null, parsed.focus ?? null, parsed.stress ?? null, parsed.sleepiness ?? null, parsed.crashScore ?? null, parsed.notes, now, now);
    return listSubjectiveCheckins(userId, 1)[0];
}
export function createNutritionGutCheckin(input) {
    const parsed = nutritionGutCheckinCreateSchema.parse(input);
    const userId = resolveWriteUser(parsed.userId);
    const checkedAt = parsed.checkedAt ?? nowIso();
    const id = newId("gut");
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO nutrition_gut_checkins (
        id, user_id, checked_at, meal_log_id, bristol_stool_type,
        stool_frequency, bloating, gas, reflux, abdominal_pain, urgency, nausea,
        constipation, diarrhea, trigger_tags_json, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, userId, checkedAt, parsed.mealLogId ?? null, parsed.bristolStoolType ?? null, parsed.stoolFrequency ?? null, parsed.bloating ?? null, parsed.gas ?? null, parsed.reflux ?? null, parsed.abdominalPain ?? null, parsed.urgency ?? null, parsed.nausea ?? null, parsed.constipation ?? null, parsed.diarrhea ?? null, jsonString(parsed.triggerTags), parsed.notes, now, now);
    return listGutCheckins(userId, 1)[0];
}
export function createNutritionExperiment(input) {
    const parsed = nutritionExperimentCreateSchema.parse(input);
    const userId = resolveWriteUser(parsed.userId);
    const id = newId("nutrition_experiment");
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO nutrition_experiments (
        id, user_id, hypothesis_id, title, status, baseline_start, baseline_end,
        intervention_start, intervention_end, tracked_outcomes_json,
        protocol_json, adherence_json, result_summary, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, userId, parsed.hypothesisId ?? null, parsed.title, parsed.status, parsed.baselineStart ?? null, parsed.baselineEnd ?? null, parsed.interventionStart ?? null, parsed.interventionEnd ?? null, jsonString(parsed.trackedOutcomes), jsonString(parsed.protocol), jsonString(parsed.adherence), parsed.resultSummary, now, now);
    return listExperiments(userId, 1)[0];
}
export function patchNutritionExperiment(experimentId, input) {
    const parsed = nutritionExperimentPatchSchema.parse(input);
    const existing = getDatabase()
        .prepare(`SELECT * FROM nutrition_experiments WHERE id = ?`)
        .get(experimentId);
    if (!existing) {
        return null;
    }
    getDatabase()
        .prepare(`UPDATE nutrition_experiments
       SET hypothesis_id = ?, title = ?, status = ?, baseline_start = ?,
           baseline_end = ?, intervention_start = ?, intervention_end = ?,
           tracked_outcomes_json = ?, protocol_json = ?, adherence_json = ?,
           result_summary = ?, updated_at = ?
       WHERE id = ?`)
        .run(parsed.hypothesisId !== undefined
        ? parsed.hypothesisId
        : existing.hypothesis_id, parsed.title ?? existing.title, parsed.status ?? existing.status, parsed.baselineStart !== undefined
        ? parsed.baselineStart
        : existing.baseline_start, parsed.baselineEnd !== undefined
        ? parsed.baselineEnd
        : existing.baseline_end, parsed.interventionStart !== undefined
        ? parsed.interventionStart
        : existing.intervention_start, parsed.interventionEnd !== undefined
        ? parsed.interventionEnd
        : existing.intervention_end, parsed.trackedOutcomes
        ? jsonString(parsed.trackedOutcomes)
        : existing.tracked_outcomes_json, parsed.protocol ? jsonString(parsed.protocol) : existing.protocol_json, parsed.adherence ? jsonString(parsed.adherence) : existing.adherence_json, parsed.resultSummary ?? existing.result_summary, nowIso(), experimentId);
    return getDatabase()
        .prepare(`SELECT * FROM nutrition_experiments WHERE id = ?`)
        .get(experimentId);
}
function listBodyCheckins(userId, limit = 30) {
    return getDatabase()
        .prepare(`SELECT * FROM nutrition_body_checkins
         WHERE user_id = ?
         ORDER BY checked_at DESC
         LIMIT ?`)
        .all(userId, limit).map((row) => ({
        id: row.id,
        userId: row.user_id,
        checkedAt: row.checked_at,
        weightKg: row.weight_kg,
        waistCm: row.waist_cm,
        hipCm: row.hip_cm,
        neckCm: row.neck_cm,
        chestCm: row.chest_cm,
        armCm: row.arm_cm,
        thighCm: row.thigh_cm,
        bodyFatPercent: row.body_fat_percent,
        clothingFitScore: row.clothing_fit_score,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }));
}
function listAppearanceCheckins(userId, limit = 20) {
    return getDatabase()
        .prepare(`SELECT * FROM nutrition_appearance_checkins
         WHERE user_id = ?
         ORDER BY checked_at DESC
         LIMIT ?`)
        .all(userId, limit).map((row) => ({
        id: row.id,
        userId: row.user_id,
        checkedAt: row.checked_at,
        photoRefs: parseJson(row.photo_refs_json, []),
        facePuffiness: row.face_puffiness,
        leanness: row.leanness,
        muscularity: row.muscularity,
        posture: row.posture,
        bloatingLook: row.bloating_look,
        confidenceScore: row.confidence_score,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }));
}
function listSubjectiveCheckins(userId, limit = 40) {
    return getDatabase()
        .prepare(`SELECT * FROM nutrition_subjective_checkins
         WHERE user_id = ?
         ORDER BY checked_at DESC
         LIMIT ?`)
        .all(userId, limit).map((row) => ({
        id: row.id,
        userId: row.user_id,
        checkedAt: row.checked_at,
        mealLogId: row.meal_log_id,
        timeRelation: row.time_relation,
        hunger: row.hunger,
        fullness: row.fullness,
        cravings: row.cravings,
        mood: row.mood,
        energy: row.energy,
        focus: row.focus,
        stress: row.stress,
        sleepiness: row.sleepiness,
        crashScore: row.crash_score,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }));
}
function listGutCheckins(userId, limit = 40) {
    return getDatabase()
        .prepare(`SELECT * FROM nutrition_gut_checkins
         WHERE user_id = ?
         ORDER BY checked_at DESC
         LIMIT ?`)
        .all(userId, limit).map((row) => ({
        id: row.id,
        userId: row.user_id,
        checkedAt: row.checked_at,
        mealLogId: row.meal_log_id,
        bristolStoolType: row.bristol_stool_type,
        stoolFrequency: row.stool_frequency,
        bloating: row.bloating,
        gas: row.gas,
        reflux: row.reflux,
        abdominalPain: row.abdominal_pain,
        urgency: row.urgency,
        nausea: row.nausea,
        constipation: row.constipation,
        diarrhea: row.diarrhea,
        triggerTags: parseJson(row.trigger_tags_json, []),
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }));
}
function listHypotheses(userId, limit = 20) {
    return getDatabase()
        .prepare(`SELECT * FROM nutrition_hypotheses
         WHERE user_id = ?
         ORDER BY confidence DESC, evidence_count DESC, updated_at DESC
         LIMIT ?`)
        .all(userId, limit).map((row) => ({
        id: row.id,
        userId: row.user_id,
        title: row.title,
        summary: row.summary,
        status: row.status,
        confidence: row.confidence,
        evidenceCount: row.evidence_count,
        signalKey: row.signal_key,
        outcomeKey: row.outcome_key,
        lagWindow: row.lag_window,
        evidence: parseJson(row.evidence_json, {}),
        confounders: parseJson(row.confounders_json, []),
        suggestedAction: row.suggested_action,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }));
}
function listExperiments(userId, limit = 20) {
    return getDatabase()
        .prepare(`SELECT * FROM nutrition_experiments
         WHERE user_id = ?
         ORDER BY updated_at DESC
         LIMIT ?`)
        .all(userId, limit).map((row) => ({
        id: row.id,
        userId: row.user_id,
        hypothesisId: row.hypothesis_id,
        title: row.title,
        status: row.status,
        baselineStart: row.baseline_start,
        baselineEnd: row.baseline_end,
        interventionStart: row.intervention_start,
        interventionEnd: row.intervention_end,
        trackedOutcomes: parseJson(row.tracked_outcomes_json, []),
        protocol: parseJson(row.protocol_json, {}),
        adherence: parseJson(row.adherence_json, {}),
        resultSummary: row.result_summary,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }));
}
function buildTodayLedger(logs, target, dynamicTargetCalories, activeAdjustmentCalories, activeCaloriesSource) {
    const today = new Date().toISOString().slice(0, 10);
    const todayLogs = logs.filter((log) => log.dayKey === today);
    const totals = todayLogs.reduce((acc, log) => ({
        calories: acc.calories + log.totals.calories,
        proteinGrams: acc.proteinGrams + log.totals.proteinGrams,
        carbohydrateGrams: acc.carbohydrateGrams + log.totals.carbohydrateGrams,
        fatGrams: acc.fatGrams + log.totals.fatGrams,
        fiberGrams: acc.fiberGrams + log.totals.fiberGrams,
        sodiumMg: acc.sodiumMg + log.totals.sodiumMg,
        caffeineMg: acc.caffeineMg + log.totals.caffeineMg,
        alcoholGrams: acc.alcoholGrams + log.totals.alcoholGrams
    }), {
        calories: 0,
        proteinGrams: 0,
        carbohydrateGrams: 0,
        fatGrams: 0,
        fiberGrams: 0,
        sodiumMg: 0,
        caffeineMg: 0,
        alcoholGrams: 0
    });
    return {
        dateKey: today,
        meals: todayLogs,
        totals,
        plannedTargetCalories: target.calorieTarget,
        targetCalories: dynamicTargetCalories,
        activeAdjustmentCalories,
        activeCaloriesSource,
        calorieDelta: round(totals.calories - dynamicTargetCalories, 0),
        proteinCoverage: n(target.proteinGramsTarget) > 0
            ? round(totals.proteinGrams / n(target.proteinGramsTarget), 2)
            : null,
        fiberCoverage: n(target.fiberGramsTarget) > 0
            ? round(totals.fiberGrams / n(target.fiberGramsTarget), 2)
            : null,
        unconfirmedCount: todayLogs.filter((log) => log.confirmationState !== "confirmed").length
    };
}
function latestHealthKitBodyMass(userId) {
    const rows = getDatabase()
        .prepare(`SELECT date_key, metrics_json
       FROM health_daily_summaries
       WHERE user_id = ?
         AND summary_type = 'vitals'
       ORDER BY date_key DESC
       LIMIT 30`)
        .all(userId);
    for (const row of rows) {
        const metrics = parseJson(row.metrics_json, {});
        const bodyMassKg = metricTotal(metrics, "bodyMass");
        if (bodyMassKg != null && bodyMassKg > 0) {
            return {
                weightKg: round(bodyMassKg, 2),
                checkedAt: `${row.date_key}T12:00:00.000Z`
            };
        }
    }
    return null;
}
function buildWeightTrend(userId, body) {
    const withWeight = body
        .filter((entry) => typeof entry.weightKg === "number")
        .slice()
        .reverse();
    const latest = withWeight.at(-1) ?? null;
    const healthKitFallback = latest ? null : latestHealthKitBodyMass(userId);
    const previous = withWeight.length > 1 ? withWeight.at(-2) : null;
    const first = withWeight[0] ?? null;
    const latestWeight = latest?.weightKg ?? healthKitFallback?.weightKg ?? null;
    const deltaFromPrevious = latestWeight != null && previous?.weightKg != null
        ? round(latestWeight - previous.weightKg, 2)
        : null;
    const deltaFromFirst = latestWeight != null && first?.weightKg != null
        ? round(latestWeight - first.weightKg, 2)
        : null;
    return {
        latestWeightKg: latestWeight,
        latestCheckedAt: latest?.checkedAt ?? healthKitFallback?.checkedAt ?? null,
        latestWeightSource: latest
            ? "nutrition_body_checkin"
            : healthKitFallback
                ? "healthkit_body_mass"
                : null,
        deltaFromPreviousKg: deltaFromPrevious,
        deltaFromFirstKg: deltaFromFirst,
        trendWeightKg: withWeight.length > 0
            ? round(average(withWeight.slice(-7).map((entry) => entry.weightKg)) ?? 0, 2)
            : (healthKitFallback?.weightKg ?? null),
        weeklyRateKg: withWeight.length >= 2 && first && latest
            ? round((latest.weightKg - first.weightKg) /
                Math.max(1, (new Date(latest.checkedAt).getTime() -
                    new Date(first.checkedAt).getTime()) /
                    (7 * 24 * 60 * 60 * 1000)), 2)
            : null,
        sevenDayRateKg: withWeight.length >= 2 && first && latest
            ? round((latest.weightKg - first.weightKg) /
                Math.max(1, (new Date(latest.checkedAt).getTime() -
                    new Date(first.checkedAt).getTime()) /
                    (7 * 24 * 60 * 60 * 1000)), 2)
            : null,
        waistToHeightRatio: null
    };
}
function buildFoodQuality(logs) {
    const items = logs.flatMap((log) => log.items);
    const totals = sumItems(items);
    const tagCounts = new Map();
    for (const item of items) {
        for (const tag of item.tags) {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
    }
    const total = Math.max(1, items.length);
    const calorieBase = Math.max(1, totals.calories / 1000);
    const highProteinShare = round((tagCounts.get("high_protein") ?? 0) / total, 2);
    const highFiberShare = round((tagCounts.get("high_fiber") ?? 0) / total, 2);
    const ultraProcessedShare = round(((tagCounts.get("ultra_processed") ?? 0) + (tagCounts.get("nova_4") ?? 0)) /
        total, 2);
    return {
        itemCount: items.length,
        qualityScore: items.length > 0
            ? round(Math.max(0, Math.min(10, 4 +
                highProteinShare * 2 +
                highFiberShare * 2 -
                ultraProcessedShare * 2)), 1)
            : null,
        proteinPer1000Kcal: items.length > 0 ? round(totals.proteinGrams / calorieBase, 1) : null,
        fiberPer1000Kcal: items.length > 0 ? round(totals.fiberGrams / calorieBase, 1) : null,
        highProteinShare,
        highFiberShare,
        ultraProcessedShare,
        lateMealCount: logs.filter((log) => {
            const hour = new Date(log.loggedAt).getHours();
            return hour >= 21 || hour < 4;
        }).length,
        topTags: Array.from(tagCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([tag, count]) => ({ tag, count }))
    };
}
function buildSubjectiveSummary(checkins) {
    return {
        checkinCount: checkins.length,
        averageEnergy: average(checkins.map((entry) => entry.energy)),
        averageFocus: average(checkins.map((entry) => entry.focus)),
        averageCravings: average(checkins.map((entry) => entry.cravings)),
        averageCrash: average(checkins.map((entry) => entry.crashScore)),
        recent: checkins.slice(0, 8)
    };
}
function buildGutSummary(checkins) {
    const averageBloating = average(checkins.map((entry) => entry.bloating));
    const averageReflux = average(checkins.map((entry) => entry.reflux));
    const averageAbdominalPain = average(checkins.map((entry) => entry.abdominalPain));
    const discomfortAverage = average([
        averageBloating,
        averageReflux,
        averageAbdominalPain
    ]);
    return {
        checkinCount: checkins.length,
        averageBloating,
        averageReflux,
        averageAbdominalPain,
        gutComfortScore: discomfortAverage == null
            ? null
            : round(Math.max(0, 10 - discomfortAverage), 1),
        bristolDistribution: [1, 2, 3, 4, 5, 6, 7].map((type) => ({
            type,
            count: checkins.filter((entry) => entry.bristolStoolType === type).length
        })),
        recent: checkins.slice(0, 8)
    };
}
function buildGeneratedHypotheses(logs, subjective, gut, appearance) {
    const cards = [];
    const lateMeals = logs.filter((log) => new Date(log.loggedAt).getHours() >= 21);
    const lowEnergy = subjective.filter((entry) => typeof entry.energy === "number" && entry.energy <= 4);
    const gutSymptoms = gut.filter((entry) => n(entry.bloating) >= 6 ||
        n(entry.reflux) >= 6 ||
        n(entry.abdominalPain) >= 6);
    const puffiness = appearance.filter((entry) => typeof entry.facePuffiness === "number" && entry.facePuffiness >= 6);
    if (lateMeals.length >= 2 && puffiness.length >= 1) {
        cards.push({
            id: "generated_late_meal_puffiness",
            title: "Late meals may be affecting next-day look",
            summary: "Forge sees repeated late eating plus recent face-puffiness check-ins. Track sodium, alcohol, and bedtime for a cleaner read.",
            status: "candidate",
            confidence: 0.35,
            evidenceCount: lateMeals.length + puffiness.length,
            signalKey: "late_meal",
            outcomeKey: "face_puffiness",
            lagWindow: "next_morning",
            confounders: ["sleep", "sodium", "alcohol", "stress"],
            suggestedAction: "Run a 7-day experiment: log dinner time, sodium-heavy foods, and morning face puffiness."
        });
    }
    if (lowEnergy.length >= 2 && logs.length >= 3) {
        cards.push({
            id: "generated_post_meal_energy",
            title: "Food and afternoon energy need tighter logging",
            summary: "Low-energy check-ins exist near logged meals. Add 2-hour post-meal energy scores to identify stable lunches versus crash meals.",
            status: "candidate",
            confidence: 0.3,
            evidenceCount: lowEnergy.length,
            signalKey: "meal_composition",
            outcomeKey: "energy",
            lagWindow: "2h_post_meal",
            confounders: ["sleep", "caffeine", "training", "work stress"],
            suggestedAction: "For the next five lunches, log protein/fiber and a 2-hour energy score."
        });
    }
    if (gutSymptoms.length >= 2) {
        cards.push({
            id: "generated_gut_trigger_window",
            title: "Gut trigger window is ready for an n-of-1 test",
            summary: "Bloating, reflux, or abdominal pain has repeated enough to start tagging dairy, gluten, high-FODMAP, spice, fat, alcohol, and fiber jumps.",
            status: "candidate",
            confidence: 0.32,
            evidenceCount: gutSymptoms.length,
            signalKey: "food_trigger_tags",
            outcomeKey: "gut_symptoms",
            lagWindow: "6h_to_48h",
            confounders: ["stress", "sleep", "travel", "training load"],
            suggestedAction: "Choose one suspected trigger and compare two baseline weeks with one intervention week."
        });
    }
    return cards;
}
export function getWeightLossViewData(userIds) {
    const generatedAt = new Date().toISOString();
    const userId = resolveReadUser(userIds);
    const todayKey = generatedAt.slice(0, 10);
    const targetRow = getDatabase()
        .prepare(`SELECT * FROM nutrition_targets WHERE user_id = ?`)
        .get(userId);
    const target = mapTarget(targetRow, userId);
    const logs = listFoodLogs(userId);
    const body = listBodyCheckins(userId);
    const appearance = listAppearanceCheckins(userId);
    const subjective = listSubjectiveCheckins(userId);
    const gut = listGutCheckins(userId);
    const storedHypotheses = listHypotheses(userId);
    const generatedHypotheses = buildGeneratedHypotheses(logs, subjective, gut, appearance);
    const experiments = listExperiments(userId);
    const weightTrend = buildWeightTrend(userId, body);
    const recentLogs = logs.slice(0, 14);
    const recentTotals = sumItems(recentLogs.flatMap((log) => log.items));
    const trackedDays = new Set(logs.map((log) => log.dayKey)).size;
    const averageCalories = trackedDays > 0 ? round(recentTotals.calories / trackedDays, 0) : 0;
    const inferredTdee = target.calorieTarget != null
        ? round(target.calorieTarget + Math.abs(n(target.weeklyRateGoalKg)) * 1100, 0)
        : null;
    const defaultActiveCalories = parsePlanNoteNumber(target.notes, "activity_kcal");
    const dailyActiveOverride = getDailyEnergyOverride(userId, todayKey);
    const energyModel = buildStoredEnergyModel({
        userId,
        inferredTdee,
        averageCalories,
        defaultActiveCalories,
        latestWeightKg: weightTrend.latestWeightKg,
        dailyActiveOverride
    });
    const todayTargetCalories = Math.max(0, round(target.calorieTarget + energyModel.todayTargetAdjustmentKcal, 0));
    const todayLedger = buildTodayLedger(logs, target, todayTargetCalories, energyModel.todayTargetAdjustmentKcal, energyModel.todayActiveCaloriesSource);
    return {
        generatedAt,
        userId,
        target,
        summary: {
            loggedMealCount: logs.length,
            trackedDays,
            todayCalories: todayLedger.totals.calories,
            targetCalories: todayLedger.targetCalories,
            todayCalorieDelta: todayLedger.calorieDelta,
            averageCalories,
            inferredTdee,
            proteinCoverage: todayLedger.proteinCoverage,
            fiberCoverage: todayLedger.fiberCoverage,
            unconfirmedCount: logs.filter((log) => log.confirmationState !== "confirmed").length,
            hypothesisCount: storedHypotheses.length + generatedHypotheses.length,
            dataQualityScore: round(Math.min(1, trackedDays / 7 +
                Math.min(0.2, body.length * 0.04) +
                Math.min(0.2, subjective.length * 0.02) +
                Math.min(0.2, gut.length * 0.02)), 2)
        },
        todayLedger,
        recentMeals: logs.slice(0, 30),
        energyModel,
        weightTrend,
        bodyCheckins: body,
        appearanceCheckins: appearance,
        foodQuality: buildFoodQuality(logs),
        trainingFuel: {
            linkedWorkoutMealCount: logs.filter((log) => log.workoutId).length,
            preWorkoutFuelCount: logs.filter((log) => log.items.some((item) => item.tags.includes("pre_workout"))).length,
            postWorkoutProteinCount: logs.filter((log) => log.items.some((item) => item.tags.includes("post_workout"))).length,
            fuelingScore: logs.length > 0 ? 5 : null,
            recentTrainingLoad: null,
            carbsPerTrainingLoad: null,
            lowEnergyAvailabilityFlag: averageCalories > 0 && inferredTdee != null
                ? averageCalories < inferredTdee - 750
                : false
        },
        subjective: buildSubjectiveSummary(subjective),
        gut: buildGutSummary(gut),
        hypotheses: [...storedHypotheses, ...generatedHypotheses],
        experiments,
        dataQuality: {
            sourceConfidence: logs.length === 0
                ? "empty"
                : logs.some((log) => log.confirmationState !== "confirmed")
                    ? "mixed"
                    : "confirmed",
            missingHighValueCheckins: [
                logs.length === 0 ? "food log" : null,
                body.length === 0 ? "body measurement" : null,
                subjective.length < 3 ? "post-meal energy" : null,
                gut.length < 3 ? "gut symptom" : null
            ].filter((value) => Boolean(value)),
            notes: "AI, photo, and barcode estimates stay provisional until confirmed by the user."
        }
    };
}
function cacheFood(input) {
    const now = nowIso();
    const existing = getDatabase()
        .prepare(`SELECT id FROM nutrition_food_catalog WHERE source = ? AND source_id = ?`)
        .get(input.source, input.sourceId);
    const id = existing?.id ?? newId("food");
    getDatabase()
        .prepare(`INSERT INTO nutrition_food_catalog (
        id, source, source_id, barcode, name, brand, serving_label,
        serving_grams, calories, protein_grams, carbohydrate_grams, fat_grams,
        fiber_grams, sugar_grams, sodium_mg, potassium_mg, nova_group,
        nutri_score, tags_json, nutrients_json, confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, source_id) DO UPDATE SET
        barcode = excluded.barcode,
        name = excluded.name,
        brand = excluded.brand,
        serving_label = excluded.serving_label,
        serving_grams = excluded.serving_grams,
        calories = excluded.calories,
        protein_grams = excluded.protein_grams,
        carbohydrate_grams = excluded.carbohydrate_grams,
        fat_grams = excluded.fat_grams,
        fiber_grams = excluded.fiber_grams,
        sugar_grams = excluded.sugar_grams,
        sodium_mg = excluded.sodium_mg,
        potassium_mg = excluded.potassium_mg,
        nova_group = excluded.nova_group,
        nutri_score = excluded.nutri_score,
        tags_json = excluded.tags_json,
        nutrients_json = excluded.nutrients_json,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at`)
        .run(id, input.source, input.sourceId, input.barcode ?? null, input.name, input.brand ?? "", input.servingLabel ?? "", input.servingGrams ?? null, input.calories ?? null, input.proteinGrams ?? null, input.carbohydrateGrams ?? null, input.fatGrams ?? null, input.fiberGrams ?? null, input.sugarGrams ?? null, input.sodiumMg ?? null, input.potassiumMg ?? null, input.novaGroup ?? null, input.nutriScore ?? null, jsonString(input.tags ?? []), jsonString(input.nutrients ?? {}), input.confidence ?? 0.65, now, now);
    return mapFood(getDatabase()
        .prepare(`SELECT * FROM nutrition_food_catalog WHERE id = ?`)
        .get(id));
}
function localFoodSearch(query, limit) {
    return getDatabase()
        .prepare(`SELECT *
         FROM nutrition_food_catalog
         WHERE name LIKE ? OR brand LIKE ? OR barcode = ?
         ORDER BY updated_at DESC
         LIMIT ?`)
        .all(`%${query}%`, `%${query}%`, query, limit).map(mapFood);
}
function readOffNutrient(product, key) {
    const nutriments = product.nutriments;
    const value = nutriments?.[key];
    return typeof value === "number" ? value : null;
}
function parseGramQuantity(value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return value;
    }
    if (typeof value !== "string") {
        return null;
    }
    const match = value
        .toLowerCase()
        .replace(",", ".")
        .match(/(\d+(?:\.\d+)?)\s*(kg|g|gram|grams|ml|l)\b/);
    if (!match) {
        return null;
    }
    const quantity = Number(match[1]);
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return null;
    }
    const unit = match[2];
    return unit === "kg" || unit === "l" ? quantity * 1000 : quantity;
}
function openFoodFactsServingGrams(product) {
    const servingSizeGrams = parseGramQuantity(product.serving_size);
    if (servingSizeGrams != null) {
        return servingSizeGrams;
    }
    const servingQuantity = parseGramQuantity(product.serving_quantity);
    if (servingQuantity != null) {
        return servingQuantity;
    }
    return null;
}
function openFoodFactsServingNutrient(product, per100gKey, perServingKey, servingGrams) {
    const perServing = readOffNutrient(product, perServingKey);
    if (perServing != null) {
        return perServing;
    }
    const per100g = readOffNutrient(product, per100gKey);
    if (per100g == null) {
        return null;
    }
    return servingGrams != null
        ? round((per100g * servingGrams) / 100, 1)
        : per100g;
}
function mapOpenFoodFactsProduct(product) {
    const code = typeof product.code === "string" ? product.code : "";
    const name = typeof product.product_name === "string" && product.product_name.trim()
        ? product.product_name.trim()
        : typeof product.generic_name === "string"
            ? product.generic_name.trim()
            : "";
    if (!code || !name) {
        return null;
    }
    const nova = typeof product.nova_group === "number" ? product.nova_group : null;
    const tags = [
        nova === 4 ? "ultra_processed" : null,
        nova ? `nova_${nova}` : null
    ].filter((tag) => Boolean(tag));
    const servingGrams = openFoodFactsServingGrams(product);
    const servingLabel = typeof product.serving_size === "string" && product.serving_size.trim()
        ? product.serving_size.trim()
        : servingGrams != null
            ? `${servingGrams} g`
            : "100 g";
    const sodiumServingGrams = openFoodFactsServingNutrient(product, "sodium_100g", "sodium_serving", servingGrams);
    return cacheFood({
        source: "open_food_facts",
        sourceId: code,
        barcode: code,
        name,
        brand: typeof product.brands === "string"
            ? product.brands.split(",")[0].trim()
            : "",
        servingLabel,
        servingGrams: servingGrams ?? 100,
        calories: openFoodFactsServingNutrient(product, "energy-kcal_100g", "energy-kcal_serving", servingGrams),
        proteinGrams: openFoodFactsServingNutrient(product, "proteins_100g", "proteins_serving", servingGrams),
        carbohydrateGrams: openFoodFactsServingNutrient(product, "carbohydrates_100g", "carbohydrates_serving", servingGrams),
        fatGrams: openFoodFactsServingNutrient(product, "fat_100g", "fat_serving", servingGrams),
        fiberGrams: openFoodFactsServingNutrient(product, "fiber_100g", "fiber_serving", servingGrams),
        sugarGrams: openFoodFactsServingNutrient(product, "sugars_100g", "sugars_serving", servingGrams),
        sodiumMg: sodiumServingGrams != null ? round(sodiumServingGrams * 1000, 0) : null,
        novaGroup: nova,
        nutriScore: typeof product.nutriscore_grade === "string"
            ? product.nutriscore_grade
            : null,
        tags,
        nutrients: product.nutriments ?? {},
        confidence: 0.72
    });
}
async function searchOpenFoodFacts(query, limit) {
    const url = new URL("https://world.openfoodfacts.org/cgi/search.pl");
    url.searchParams.set("search_terms", query);
    url.searchParams.set("search_simple", "1");
    url.searchParams.set("action", "process");
    url.searchParams.set("json", "1");
    url.searchParams.set("page_size", String(Math.min(limit, 20)));
    const response = await fetch(url, {
        headers: { accept: "application/json" }
    });
    if (!response.ok) {
        return [];
    }
    const payload = (await response.json());
    return (payload.products ?? [])
        .map(mapOpenFoodFactsProduct)
        .filter((food) => Boolean(food));
}
async function lookupOpenFoodFactsBarcode(barcode) {
    const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`, { headers: { accept: "application/json" } });
    if (!response.ok) {
        return [];
    }
    const payload = (await response.json());
    const food = payload.product
        ? mapOpenFoodFactsProduct(payload.product)
        : null;
    return food ? [food] : [];
}
function mapFdcFood(food) {
    const sourceId = typeof food.fdcId === "number"
        ? String(food.fdcId)
        : String(food.fdcId ?? "");
    const name = typeof food.description === "string" ? food.description.trim() : "";
    if (!sourceId || !name) {
        return null;
    }
    const nutrients = Array.isArray(food.foodNutrients)
        ? food.foodNutrients
        : [];
    const findNutrient = (names) => {
        const entry = nutrients.find((nutrient) => names.some((namePart) => String(nutrient.nutrientName ?? "")
            .toLowerCase()
            .includes(namePart)));
        return typeof entry?.value === "number" ? entry.value : null;
    };
    return cacheFood({
        source: "usda_fdc",
        sourceId,
        name,
        brand: typeof food.brandOwner === "string"
            ? food.brandOwner
            : typeof food.brandName === "string"
                ? food.brandName
                : "",
        calories: findNutrient(["energy"]),
        proteinGrams: findNutrient(["protein"]),
        carbohydrateGrams: findNutrient(["carbohydrate"]),
        fatGrams: findNutrient(["total lipid", "total fat"]),
        fiberGrams: findNutrient(["fiber"]),
        sugarGrams: findNutrient(["sugars"]),
        sodiumMg: findNutrient(["sodium"]),
        potassiumMg: findNutrient(["potassium"]),
        nutrients: { foodNutrients: nutrients },
        confidence: 0.78
    });
}
async function searchFoodDataCentral(query, limit) {
    const apiKey = process.env.FDC_API_KEY?.trim() || "DEMO_KEY";
    const response = await fetch("https://api.nal.usda.gov/fdc/v1/foods/search", {
        method: "POST",
        headers: {
            accept: "application/json",
            "content-type": "application/json"
        },
        body: JSON.stringify({
            api_key: apiKey,
            query,
            pageSize: Math.min(limit, 15)
        })
    });
    if (!response.ok) {
        return [];
    }
    const payload = (await response.json());
    return (payload.foods ?? [])
        .map(mapFdcFood)
        .filter((food) => Boolean(food));
}
export async function searchNutritionFoods(input) {
    const parsed = nutritionFoodSearchSchema.parse(input);
    const local = localFoodSearch(parsed.query, parsed.limit);
    const seen = new Set(local.map((food) => `${food.source}:${food.sourceId}`));
    const external = local.length >= parsed.limit
        ? []
        : [
            ...(await searchOpenFoodFacts(parsed.query, parsed.limit - local.length).catch(() => [])),
            ...(await searchFoodDataCentral(parsed.query, parsed.limit - local.length).catch(() => []))
        ].filter((food) => {
            const key = `${food.source}:${food.sourceId}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    return {
        foods: [...local, ...external].slice(0, parsed.limit),
        sources: ["local_cache", "open_food_facts", "usda_fdc"]
    };
}
export async function lookupNutritionBarcode(input) {
    const parsed = nutritionBarcodeLookupSchema.parse(input);
    const local = localFoodSearch(parsed.barcode, parsed.limit);
    const barcodeMatches = local.filter((food) => food.barcode === parsed.barcode);
    if (barcodeMatches.length > 0) {
        const foods = barcodeMatches.slice(0, parsed.limit);
        return { food: foods[0] ?? null, foods };
    }
    const foods = (await lookupOpenFoodFactsBarcode(parsed.barcode).catch(() => [])).slice(0, parsed.limit);
    return { food: foods[0] ?? null, foods };
}
function extractJsonObject(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith("{")) {
        return trimmed;
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
        return trimmed.slice(start, end + 1);
    }
    return trimmed;
}
function getNutritionCodexProfile(connectionId) {
    const settings = getSettings();
    const selectedConnectionId = connectionId?.trim() ||
        settings.modelSettings.forgeAgent.basicChat.connectionId ||
        settings.modelSettings.forgeAgent.wiki.connectionId ||
        "";
    if (!selectedConnectionId) {
        return null;
    }
    const row = getDatabase()
        .prepare(`SELECT provider, auth_mode, base_url, model, secret_id, enabled
       FROM ai_model_connections
       WHERE id = ?`)
        .get(selectedConnectionId);
    if (!row ||
        row.enabled !== 1 ||
        row.provider !== "openai-codex" ||
        row.auth_mode !== "oauth" ||
        !row.secret_id) {
        return null;
    }
    return {
        provider: "openai-codex",
        baseUrl: row.base_url || "https://chatgpt.com/backend-api",
        model: row.model,
        systemPrompt: "",
        secretId: row.secret_id,
        metadata: {}
    };
}
const parsedMealItemSchema = z.object({
    name: z.string().trim().min(1),
    quantity: z.coerce.number().positive().default(1),
    unit: z.string().trim().min(1).default("serving"),
    grams: optionalNumberSchema,
    calories: optionalNumberSchema,
    proteinGrams: optionalNumberSchema,
    carbohydrateGrams: optionalNumberSchema,
    fatGrams: optionalNumberSchema,
    fiberGrams: optionalNumberSchema,
    sugarGrams: optionalNumberSchema,
    sodiumMg: optionalNumberSchema,
    tags: tagsSchema,
    confidence: z.coerce.number().min(0).max(1).default(0.45)
});
const parsedMealSchema = z.object({
    mealLabel: z.string().trim().default(""),
    loggedAt: z.string().datetime().optional(),
    items: z.array(parsedMealItemSchema).min(1),
    uncertaintyReasons: z.array(z.string()).default([]),
    clarificationQuestions: z.array(z.string()).default([]),
    tags: tagsSchema
});
export async function parseNutritionFoodLogWithChatGpt(input, llm) {
    const parsed = nutritionParseRequestSchema.parse(input);
    const profile = getNutritionCodexProfile(parsed.connectionId);
    if (!profile) {
        throw new Error("Connect an OpenAI Codex OAuth model in Settings -> Models before using ChatGPT food parsing.");
    }
    const userId = resolveWriteUser(parsed.userId);
    const context = getWeightLossViewData([userId]);
    const prompt = `Parse this food log into strict JSON only.

Input:
${parsed.text}

Known targets:
${JSON.stringify(context.target)}

Recent meals:
${JSON.stringify(context.recentMeals.slice(0, 8).map((meal) => ({
        mealLabel: meal.mealLabel,
        items: meal.items.map((item) => item.name)
    })))}

Return this JSON shape:
{
  "mealLabel": "short label",
  "loggedAt": "ISO time if known",
  "items": [
    {
      "name": "food name",
      "quantity": 1,
      "unit": "serving|g|ml|piece|cup|tbsp|custom",
      "grams": null,
      "calories": null,
      "proteinGrams": null,
      "carbohydrateGrams": null,
      "fatGrams": null,
      "fiberGrams": null,
      "sugarGrams": null,
      "sodiumMg": null,
      "tags": ["high_protein", "late_meal", "spicy", "dairy", "high_fodmap_candidate"],
      "confidence": 0.0
    }
  ],
  "uncertaintyReasons": [],
  "clarificationQuestions": [],
  "tags": []
}

Use null for unknown nutrients. Prefer conservative estimates and mark uncertainty.`;
    const result = await llm.runTextPrompt(profile, {
        systemPrompt: "You are Forge's nutrition parser. Return strict JSON only. Never claim precision when food quantity is unclear.",
        prompt
    });
    const parsedResult = parsedMealSchema.parse(JSON.parse(extractJsonObject(result.outputText)));
    const candidate = {
        userId,
        loggedAt: parsedResult.loggedAt ?? parsed.mealTime ?? nowIso(),
        mealLabel: parsedResult.mealLabel || "ChatGPT parsed meal",
        source: parsed.imageRefs.length > 0 ? "photo" : "chatgpt",
        confirmationState: "candidate",
        notes: parsedResult.uncertaintyReasons.join("; "),
        imageRefs: parsed.imageRefs,
        parserProvenance: {
            provider: "openai-codex",
            model: profile.model,
            uncertaintyReasons: parsedResult.uncertaintyReasons,
            clarificationQuestions: parsedResult.clarificationQuestions,
            rawText: parsed.text
        },
        links: [],
        items: parsedResult.items.map((item) => ({
            ...item,
            nutrients: {},
            tags: Array.from(new Set([...item.tags, ...parsedResult.tags]))
        }))
    };
    const log = parsed.commitCandidate ? createNutritionFoodLog(candidate) : null;
    return {
        candidate,
        log,
        clarificationQuestions: parsedResult.clarificationQuestions,
        uncertaintyReasons: parsedResult.uncertaintyReasons
    };
}
