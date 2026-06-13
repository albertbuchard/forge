import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { parseNutritionFoodLogWithChatGpt } from "./health-weight-loss.js";
import type { LlmManager } from "./managers/platform/llm-manager.js";

async function issueOperatorSessionCookie(
  app: Awaited<ReturnType<typeof buildServer>>
) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: { host: "127.0.0.1:4317" }
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

function insertVitalsDay(input: {
  id: string;
  dayKey: string;
  metrics: Record<string, unknown>;
  createdAt?: string;
}) {
  const now = input.createdAt ?? new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO health_daily_summaries (
         id, user_id, date_key, summary_type, metrics_json, derived_json, source, created_at, updated_at
       )
       VALUES (?, 'user_operator', ?, 'vitals', ?, '{}', 'healthkit', ?, ?)`
    )
    .run(input.id, input.dayKey, JSON.stringify(input.metrics), now, now);
}

test("weight loss overview reflects food logs and body check-ins", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-weight-loss-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const createLog = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/food-logs",
      headers: { cookie },
      payload: {
        loggedAt: new Date().toISOString(),
        mealLabel: "Protein breakfast",
        source: "manual",
        confirmationState: "confirmed",
        items: [
          {
            name: "Greek yogurt",
            quantity: 250,
            unit: "g",
            calories: 180,
            proteinGrams: 25,
            carbohydrateGrams: 9,
            fatGrams: 4,
            fiberGrams: 0,
            tags: ["high-protein"]
          },
          {
            name: "Berries",
            quantity: 120,
            unit: "g",
            calories: 70,
            proteinGrams: 1,
            carbohydrateGrams: 16,
            fatGrams: 0,
            fiberGrams: 5,
            tags: ["fiber"]
          }
        ]
      }
    });
    assert.equal(createLog.statusCode, 201);
    const createLogBody = createLog.json() as {
      log: {
        totals: { calories: number; proteinGrams: number; fiberGrams: number };
      };
    };
    assert.equal(createLogBody.log.totals.calories, 250);
    assert.equal(createLogBody.log.totals.proteinGrams, 26);
    assert.equal(createLogBody.log.totals.fiberGrams, 5);

    const savedMealLog = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/food-logs",
      headers: { cookie },
      payload: {
        loggedAt: new Date().toISOString(),
        mealLabel: "Repeat protein breakfast",
        source: "saved_meal",
        confirmationState: "confirmed",
        items: [
          {
            name: "Greek yogurt",
            quantity: 250,
            unit: "g",
            calories: 180,
            proteinGrams: 25,
            carbohydrateGrams: 9,
            fatGrams: 4
          },
          {
            name: "Berries",
            quantity: 120,
            unit: "g",
            calories: 70,
            proteinGrams: 1,
            carbohydrateGrams: 16,
            fatGrams: 0,
            fiberGrams: 5
          }
        ]
      }
    });
    assert.equal(savedMealLog.statusCode, 201);
    const savedMealBody = savedMealLog.json() as {
      log: {
        source: string;
        totals: { calories: number; proteinGrams: number; fiberGrams: number };
      };
    };
    assert.equal(savedMealBody.log.source, "saved_meal");
    assert.equal(savedMealBody.log.totals.calories, 250);

    const bodyCheckin = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/body-checkins",
      headers: { cookie },
      payload: {
        checkedAt: new Date().toISOString(),
        weightKg: 82.4,
        waistCm: 86,
        notes: "Morning check-in"
      }
    });
    assert.equal(bodyCheckin.statusCode, 201);

    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const updateTarget = await app.inject({
      method: "PATCH",
      url: "/api/v1/health/weight-loss/target",
      headers: { cookie },
      payload: {
        calorieTarget: 2100,
        proteinGramsTarget: 160,
        fiberGramsTarget: 32,
        carbohydrateGramsTarget: 210,
        fatGramsTarget: 70,
        weightGoalKg: 78,
        weeklyRateGoalKg: -0.35,
        dietStyle: "balanced",
        bodyGoal: "lose fat",
        notes:
          "Forge science plan; sex=male; age_years=39; height_cm=180; resting_kcal=1700; activity_kcal=300; maintenance_kcal=2000"
      }
    });
    assert.equal(updateTarget.statusCode, 200);
    insertVitalsDay({
      id: "hds_weight_loss_energy",
      dayKey: today,
      createdAt: now,
      metrics: {
        activeEnergyBurned: {
          metric: "activeEnergyBurned",
          label: "Active energy",
          category: "activity",
          unit: "kcal",
          displayUnit: "kcal",
          aggregation: "cumulative",
          total: 420,
          sampleCount: 12,
          latestSampleAt: `${today}T12:00:00.000Z`
        },
        basalEnergyBurned: {
          metric: "basalEnergyBurned",
          label: "Basal energy",
          category: "activity",
          unit: "kcal",
          displayUnit: "kcal",
          aggregation: "cumulative",
          total: 1600,
          sampleCount: 12,
          latestSampleAt: `${today}T12:00:00.000Z`
        }
      }
    });
    getDatabase()
      .prepare(
        `INSERT INTO health_workout_sessions (
           id, external_uid, user_id, source, workout_type, started_at, ended_at,
           duration_seconds, active_energy_kcal, total_energy_kcal, created_at, updated_at
         )
         VALUES (?, ?, 'user_operator', 'apple_health', 'running', ?, ?, 1800, 650, 700, ?, ?)`
      )
      .run(
        "workout_weight_loss_energy",
        "workout_weight_loss_energy",
        `${today}T17:00:00.000Z`,
        `${today}T17:30:00.000Z`,
        now,
        now
      );
    getDatabase()
      .prepare(
        `INSERT INTO movement_trips (
           id, external_uid, user_id, started_at, ended_at, distance_meters,
           moving_seconds, idle_seconds, calories_kcal, created_at, updated_at
         )
         VALUES (?, ?, 'user_operator', ?, ?, 1200, 900, 0, 120, ?, ?)`
      )
      .run(
        "trip_weight_loss_energy",
        "trip_weight_loss_energy",
        `${today}T10:00:00.000Z`,
        `${today}T10:15:00.000Z`,
        now,
        now
      );

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss"
    });
    assert.equal(overview.statusCode, 200);
    const overviewBody = overview.json() as {
      weightLoss: {
        todayLedger: {
          totals: {
            calories: number;
            proteinGrams: number;
            fiberGrams: number;
          };
          meals: unknown[];
          plannedTargetCalories: number;
          targetCalories: number;
          activeAdjustmentCalories: number;
          activeCaloriesSource: string;
          remainingCalories: number;
        };
        summary: {
          loggedMealCount: number;
          targetCalories: number;
          remainingCalories: number;
        };
        energyModel: {
          estimatedTdeeKcal: number | null;
          activeBurnKcal: number | null;
          baselineActiveCaloriesKcal: number;
          todayActiveCaloriesKcal: number;
          todayActiveCaloriesSource: string;
          todayTargetAdjustmentKcal: number;
          todayWorkoutEnergyKcal: number | null;
          todayActivityBufferKcal: number;
          movementCaloriesKcal: number | null;
          restingEnergyCalories: number | null;
          formulaRestingKcal: number | null;
          wearableRestingKcal: number | null;
          chosenRestingKcal: number | null;
          chosenRestingSource: string | null;
          restingConfidence: string;
          restingExclusionReasons: string[];
          estimatedDailyEnergyBalanceKcal: number | null;
        };
        foodQuality: {
          qualityScore: number;
          proteinPer1000Kcal: number;
          fiberPer1000Kcal: number;
        };
        gut: { gutComfortScore: number | null };
        trainingFuel: { fuelingScore: number | null };
        bodyCheckins: unknown[];
        weightTrend: { latestWeightKg: number | null };
      };
    };
    assert.equal(overviewBody.weightLoss.todayLedger.totals.calories, 500);
    assert.equal(overviewBody.weightLoss.todayLedger.totals.proteinGrams, 52);
    assert.equal(overviewBody.weightLoss.todayLedger.totals.fiberGrams, 10);
    assert.equal(overviewBody.weightLoss.todayLedger.meals.length, 2);
    assert.equal(
      overviewBody.weightLoss.todayLedger.plannedTargetCalories,
      2100
    );
    assert.equal(overviewBody.weightLoss.todayLedger.targetCalories, 2160);
    assert.equal(overviewBody.weightLoss.todayLedger.remainingCalories, 1660);
    assert.equal(overviewBody.weightLoss.summary.targetCalories, 2160);
    assert.equal(overviewBody.weightLoss.summary.remainingCalories, 1660);
    assert.equal(
      overviewBody.weightLoss.todayLedger.activeAdjustmentCalories,
      60
    );
    assert.equal(
      overviewBody.weightLoss.todayLedger.activeCaloriesSource,
      "today_healthkit_active_energy"
    );
    assert.equal(overviewBody.weightLoss.summary.loggedMealCount, 2);
    assert.ok(
      typeof overviewBody.weightLoss.energyModel.estimatedTdeeKcal ===
        "number" ||
        overviewBody.weightLoss.energyModel.estimatedTdeeKcal === null
    );
    assert.ok(
      typeof overviewBody.weightLoss.energyModel.activeBurnKcal === "number" ||
        overviewBody.weightLoss.energyModel.activeBurnKcal === null
    );
    assert.equal(overviewBody.weightLoss.energyModel.activeBurnKcal, 300);
    assert.equal(
      overviewBody.weightLoss.energyModel.baselineActiveCaloriesKcal,
      300
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActiveCaloriesKcal,
      420
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActiveCaloriesSource,
      "today_healthkit_active_energy"
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayTargetAdjustmentKcal,
      60
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActivityBufferKcal,
      60
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayWorkoutEnergyKcal,
      650
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.restingEnergyCalories,
      1759
    );
    assert.equal(overviewBody.weightLoss.energyModel.formulaRestingKcal, 1759);
    assert.equal(overviewBody.weightLoss.energyModel.wearableRestingKcal, null);
    assert.equal(overviewBody.weightLoss.energyModel.chosenRestingKcal, 1759);
    assert.equal(
      overviewBody.weightLoss.energyModel.chosenRestingSource,
      "mifflin_profile_baseline"
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.restingConfidence,
      "medium"
    );
    assert.ok(
      overviewBody.weightLoss.energyModel.restingExclusionReasons.some(
        (reason) => reason.includes("current_day_or_future_day")
      )
    );
    assert.equal(overviewBody.weightLoss.energyModel.estimatedTdeeKcal, 2059);
    assert.ok(
      typeof overviewBody.weightLoss.energyModel.movementCaloriesKcal ===
        "number" ||
        overviewBody.weightLoss.energyModel.movementCaloriesKcal === null
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.movementCaloriesKcal,
      null
    );
    assert.equal(
      typeof overviewBody.weightLoss.energyModel
        .estimatedDailyEnergyBalanceKcal,
      "number"
    );
    assert.equal(
      typeof overviewBody.weightLoss.foodQuality.qualityScore,
      "number"
    );
    assert.equal(
      typeof overviewBody.weightLoss.foodQuality.proteinPer1000Kcal,
      "number"
    );
    assert.equal(
      typeof overviewBody.weightLoss.foodQuality.fiberPer1000Kcal,
      "number"
    );
    assert.ok(
      typeof overviewBody.weightLoss.gut.gutComfortScore === "number" ||
        overviewBody.weightLoss.gut.gutComfortScore === null
    );
    assert.ok(
      typeof overviewBody.weightLoss.trainingFuel.fuelingScore === "number" ||
        overviewBody.weightLoss.trainingFuel.fuelingScore === null
    );
    assert.equal(overviewBody.weightLoss.bodyCheckins.length, 1);
    assert.equal(overviewBody.weightLoss.weightTrend.latestWeightKg, 82.4);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("ChatGPT food parser uses one model call when catalog nutrition completes every item", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-weight-loss-chatgpt-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO stored_secrets (id, cipher_text, description, created_at, updated_at)
         VALUES ('secret_codex_food', 'present', 'Codex OAuth test secret', ?, ?)`
      )
      .run(now, now);
    getDatabase()
      .prepare(
        `INSERT INTO ai_model_connections (
           id, label, provider, auth_mode, base_url, model, account_label,
           secret_id, enabled, metadata_json, created_at, updated_at
         )
         VALUES (
           'conn_codex_food', 'Codex food parser', 'openai-codex', 'oauth',
           'https://chatgpt.com/backend-api', 'gpt-5.4-mini', 'test',
           'secret_codex_food', 1, '{}', ?, ?
         )`
      )
      .run(now, now);
    getDatabase()
      .prepare(
        `INSERT INTO nutrition_food_catalog (
           id, source, source_id, barcode, name, brand, serving_label,
           serving_grams, calories, protein_grams, carbohydrate_grams,
           fat_grams, fiber_grams, sugar_grams, sodium_mg, potassium_mg,
           caffeine_mg, alcohol_grams, nova_group, nutri_score, tags_json,
           nutrients_json, confidence, created_at, updated_at
         )
         VALUES (
           'food_kagi_chief_bar', 'open_food_facts', 'kagi-chief-13g',
           NULL, 'Kagi Chief 13g Protein Bar', 'Kagi', '1 bar', 45,
           180, 13, 19, 7, 2, 8, 120, NULL, NULL, NULL, NULL, NULL,
           '["protein_bar"]', '{}', 0.86, ?, ?
         )`
      )
      .run(now, now);
    getDatabase()
      .prepare(
        `INSERT INTO nutrition_food_catalog (
           id, source, source_id, barcode, name, brand, serving_label,
           serving_grams, calories, protein_grams, carbohydrate_grams,
           fat_grams, fiber_grams, sugar_grams, sodium_mg, potassium_mg,
           caffeine_mg, alcohol_grams, nova_group, nutri_score, tags_json,
           nutrients_json, confidence, created_at, updated_at
         )
         VALUES (
           'food_almonds_raw', 'usda_fdc', 'almonds-raw',
           NULL, 'Almonds', '', '100 g', 100,
           579, 21.2, 21.6, 49.9, 12.5, 4.4, 1, NULL, NULL, NULL, NULL, NULL,
           '["nuts"]', '{}', 0.84, ?, ?
         )`
      )
      .run(now, now);

    const llmCalls: string[] = [];
    const fakeLlm = {
      async runTextPrompt() {
        llmCalls.push("parse");
        return {
          outputText: JSON.stringify({
            mealLabel: "Breakfast",
            loggedAt: null,
            items: [
              {
                name: "Kagi Chief 13g Protein Bar",
                searchQuery: "Kagi Chief 13g Protein Bar",
                brand: "Kagi",
                quantity: 1,
                unit: "serving",
                grams: null,
                calories: null,
                proteinGrams: null,
                carbohydrateGrams: null,
                fatGrams: null,
                fiberGrams: null,
                sugarGrams: null,
                sodiumMg: null,
                tags: ["high_protein"],
                confidence: 0.6
              },
              {
                name: "almonds",
                searchQuery: "almonds",
                brand: "",
                quantity: 20,
                unit: "piece",
                grams: null,
                calories: null,
                proteinGrams: null,
                carbohydrateGrams: null,
                fatGrams: null,
                fiberGrams: null,
                sugarGrams: null,
                sodiumMg: null,
                tags: ["nuts"],
                confidence: 0.6
              }
            ],
            uncertaintyReasons: ["User gave a rough free-text description."],
            clarificationQuestions: [],
            tags: ["breakfast"]
          })
        };
      }
    } as unknown as LlmManager;

    const parsed = await parseNutritionFoodLogWithChatGpt(
      {
        text: "I had one kaggi chief 13g protein bar and 20 almonds this morning",
        commitCandidate: false
      },
      fakeLlm
    );

    assert.equal(parsed.log, null);
    assert.equal(llmCalls.length, 1);
    assert.deepEqual(parsed.parseSummary, {
      itemCount: 2,
      completeNutritionItemCount: 2,
      catalogResolvedItemCount: 2,
      chatGptEstimatedItemCount: 0,
      chatGptValidatedItemCount: 0,
      elapsedMs: parsed.parseSummary.elapsedMs,
      llmCallCount: 1
    });
    assert.equal(typeof parsed.parseSummary.elapsedMs, "number");
    assert.equal(parsed.candidate.items.length, 2);
    const item = parsed.candidate.items[0]!;
    assert.equal(item.foodId, "food_kagi_chief_bar");
    assert.equal(item.name, "Kagi Chief 13g Protein Bar");
    assert.equal(item.calories, 180);
    assert.equal(item.proteinGrams, 13);
    assert.equal(item.carbohydrateGrams, 19);
    assert.equal(item.fatGrams, 7);
    const almonds = parsed.candidate.items[1]!;
    assert.equal(almonds.foodId, "food_almonds_raw");
    assert.equal(almonds.name, "Almonds");
    assert.equal(almonds.grams, 24);
    assert.equal(almonds.calories, 138.96);
    assert.equal(almonds.proteinGrams, 5.09);
    assert.equal(almonds.carbohydrateGrams, 5.18);
    assert.equal(almonds.fatGrams, 11.98);
    assert.match(parsed.candidate.notes, /Resolved "Kagi Chief 13g Protein Bar"/);
    assert.match(parsed.candidate.notes, /Resolved "almonds" to Almonds/);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("ChatGPT food parser uses one extra validation call for unresolved nutrition", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-weight-loss-chatgpt-fallback-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO stored_secrets (id, cipher_text, description, created_at, updated_at)
         VALUES ('secret_codex_food', 'present', 'Codex OAuth test secret', ?, ?)`
      )
      .run(now, now);
    getDatabase()
      .prepare(
        `INSERT INTO ai_model_connections (
           id, label, provider, auth_mode, base_url, model, account_label,
           secret_id, enabled, metadata_json, created_at, updated_at
         )
         VALUES (
           'conn_codex_food', 'Codex food parser', 'openai-codex', 'oauth',
           'https://chatgpt.com/backend-api', 'gpt-5.4-mini', 'test',
           'secret_codex_food', 1, '{}', ?, ?
         )`
      )
      .run(now, now);

    const llmPrompts: string[] = [];
    const fakeLlm = {
      async runTextPrompt(_profile: unknown, request: { prompt: string }) {
        llmPrompts.push(request.prompt);
        if (llmPrompts.length === 1) {
          return {
            outputText: JSON.stringify({
              mealLabel: "Snack",
              loggedAt: null,
              items: [
                {
                  name: "homemade seed cracker",
                  searchQuery: "homemade seed cracker",
                  brand: "",
                  quantity: 1,
                  unit: "piece",
                  grams: null,
                  calories: null,
                  proteinGrams: null,
                  carbohydrateGrams: null,
                  fatGrams: null,
                  fiberGrams: null,
                  sugarGrams: null,
                  sodiumMg: null,
                  tags: ["homemade"],
                  confidence: 0.35
                }
              ],
              uncertaintyReasons: ["Homemade item needs estimated nutrition."],
              clarificationQuestions: [],
              tags: ["snack"]
            })
          };
        }
        return {
          outputText: JSON.stringify({
            items: [
              {
                index: 0,
                grams: 18,
                calories: 82,
                proteinGrams: 2.7,
                carbohydrateGrams: 6.8,
                fatGrams: 5.1,
                fiberGrams: 1.8,
                sugarGrams: 0.6,
                sodiumMg: 95,
                confidence: 0.48,
                reason:
                  "Conservative estimate for one small homemade seed cracker."
              }
            ],
            validationNotes: ["Validated unresolved homemade item."]
          })
        };
      }
    } as unknown as LlmManager;

    const parsed = await parseNutritionFoodLogWithChatGpt(
      {
        text: "I ate one homemade seed cracker",
        commitCandidate: false
      },
      fakeLlm
    );

    assert.equal(parsed.log, null);
    assert.equal(llmPrompts.length, 2);
    assert.equal(parsed.parseSummary.llmCallCount, 2);
    assert.equal(parsed.parseSummary.itemCount, 1);
    assert.equal(parsed.parseSummary.completeNutritionItemCount, 1);
    assert.equal(parsed.parseSummary.chatGptEstimatedItemCount, 1);
    assert.equal(parsed.parseSummary.chatGptValidatedItemCount, 1);
    const item = parsed.candidate.items[0]!;
    assert.equal(item.name, "homemade seed cracker");
    assert.equal(item.grams, 18);
    assert.equal(item.calories, 82);
    assert.equal(item.proteinGrams, 2.7);
    assert.equal(item.carbohydrateGrams, 6.8);
    assert.equal(item.fatGrams, 5.1);
    assert.match(parsed.candidate.notes, /Validated unresolved homemade item/);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("weight loss overview keeps formula resting baseline despite partial HealthKit basal rows", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-weight-loss-resting-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const now = new Date().toISOString();
    const today = "2030-06-06";

    const bodyCheckin = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/body-checkins",
      headers: { cookie },
      payload: {
        checkedAt: "2030-06-06T07:30:00.000Z",
        weightKg: 84
      }
    });
    assert.equal(bodyCheckin.statusCode, 201);

    const updateTarget = await app.inject({
      method: "PATCH",
      url: "/api/v1/health/weight-loss/target",
      headers: { cookie },
      payload: {
        calorieTarget: 1500,
        proteinGramsTarget: 152,
        fiberGramsTarget: 21,
        carbohydrateGramsTarget: 121,
        fatGramsTarget: 45,
        weightGoalKg: 76,
        weeklyRateGoalKg: -0.35,
        dietStyle: "balanced",
        bodyGoal: "lose fat",
        notes:
          "Forge legacy plan; sex=male; age_years=39; height_cm=180; resting_kcal=1292; activity_kcal=388; maintenance_kcal=1680"
      }
    });
    assert.equal(updateTarget.statusCode, 200);

    const basalRows = [
      ["2030-06-06", 880, 59, "2030-06-06T09:05:00.000Z", 52],
      ["2030-06-05", 2129, 99, "2030-06-05T21:51:00.000Z", 596],
      ["2030-06-04", 2033, 112, "2030-06-04T21:03:00.000Z", 669],
      ["2030-06-03", 1298, 75, "2030-06-03T21:45:00.000Z", 1419],
      ["2030-06-02", 75, 1, "2030-06-02T21:07:00.000Z", null],
      ["2030-06-01", 300, 4, "2030-06-01T21:29:00.000Z", null]
    ] as const;
    for (const [
      dayKey,
      basalTotal,
      sampleCount,
      latestSampleAt,
      active
    ] of basalRows) {
      insertVitalsDay({
        id: `hds_resting_${dayKey}`,
        dayKey,
        createdAt: now,
        metrics: {
          ...(active == null
            ? {}
            : {
                activeEnergyBurned: {
                  metric: "activeEnergyBurned",
                  unit: "kcal",
                  total: active,
                  sampleCount,
                  latestSampleAt
                }
              }),
          basalEnergyBurned: {
            metric: "basalEnergyBurned",
            unit: "kcal",
            total: basalTotal,
            sampleCount,
            latestSampleAt
          }
        }
      });
    }

    const overview = await app.inject({
      method: "GET",
      url: `/api/v1/health/weight-loss?dateKey=${today}`
    });
    assert.equal(overview.statusCode, 200);
    const overviewBody = overview.json() as {
      weightLoss: {
        energyModel: {
          formulaRestingKcal: number | null;
          wearableRestingKcal: number | null;
          chosenRestingKcal: number | null;
          chosenRestingSource: string | null;
          restingEnergyCalories: number | null;
          restingConfidence: string;
          restingExclusionReasons: string[];
          wearableRestingDayCount: number;
          wearableRestingCoverageQualifiedDayCount: number;
          estimatedTdeeKcal: number | null;
          baselineActiveCaloriesKcal: number;
          todayActiveCaloriesKcal: number;
          todayActiveSurplusKcal: number;
          todayActivityBufferKcal: number;
          todayTargetAdjustmentKcal: number;
        };
        todayLedger: {
          plannedTargetCalories: number;
          targetCalories: number;
          activeAdjustmentCalories: number;
        };
      };
    };

    assert.equal(overviewBody.weightLoss.energyModel.formulaRestingKcal, 1775);
    assert.equal(overviewBody.weightLoss.energyModel.wearableRestingKcal, 2081);
    assert.equal(overviewBody.weightLoss.energyModel.chosenRestingKcal, 1775);
    assert.equal(
      overviewBody.weightLoss.energyModel.chosenRestingSource,
      "mifflin_profile_baseline"
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.restingEnergyCalories,
      1775
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.restingConfidence,
      "review"
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.wearableRestingDayCount,
      6
    );
    assert.equal(
      overviewBody.weightLoss.energyModel
        .wearableRestingCoverageQualifiedDayCount,
      2
    );
    assert.ok(
      overviewBody.weightLoss.energyModel.restingExclusionReasons.some(
        (reason) =>
          reason.includes("2030-06-06") &&
          reason.includes("current_day_or_future_day")
      )
    );
    assert.ok(
      overviewBody.weightLoss.energyModel.restingExclusionReasons.some(
        (reason) =>
          reason.includes("2030-06-03") && reason.includes("below_1331")
      )
    );
    assert.ok(
      overviewBody.weightLoss.energyModel.restingExclusionReasons.some(
        (reason) =>
          reason.includes("2030-06-02") &&
          reason.includes("sample_count_1_below_24")
      )
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.baselineActiveCaloriesKcal,
      895
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActiveCaloriesKcal,
      52
    );
    assert.equal(overviewBody.weightLoss.energyModel.todayActiveSurplusKcal, 0);
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActivityBufferKcal,
      0
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayTargetAdjustmentKcal,
      0
    );
    assert.equal(
      overviewBody.weightLoss.todayLedger.plannedTargetCalories,
      1500
    );
    assert.equal(overviewBody.weightLoss.todayLedger.targetCalories, 1500);
    assert.equal(
      overviewBody.weightLoss.todayLedger.activeAdjustmentCalories,
      0
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("weight loss active baseline averages only measured prior days across the past week", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-weight-loss-active-baseline-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const now = new Date().toISOString();
    const updateTarget = await app.inject({
      method: "PATCH",
      url: "/api/v1/health/weight-loss/target",
      headers: { cookie },
      payload: {
        calorieTarget: 2000,
        proteinGramsTarget: 150,
        fiberGramsTarget: 28,
        carbohydrateGramsTarget: 220,
        fatGramsTarget: 60,
        weightGoalKg: 76,
        weeklyRateGoalKg: -0.35,
        dietStyle: "balanced",
        bodyGoal: "lose fat",
        notes:
          "Forge science plan; sex=male; age_years=39; height_cm=180; resting_kcal=1775"
      }
    });
    assert.equal(updateTarget.statusCode, 200);

    const activeRows = [
      ["2030-01-01", 100],
      ["2030-01-02", null],
      ["2030-01-03", 300],
      ["2030-01-04", 1000]
    ] as const;
    for (const [dayKey, activeTotal] of activeRows) {
      insertVitalsDay({
        id: `hds_active_baseline_${dayKey}`,
        dayKey,
        createdAt: now,
        metrics:
          activeTotal == null
            ? {}
            : {
                activeEnergyBurned: {
                  metric: "activeEnergyBurned",
                  unit: "kcal",
                  total: activeTotal,
                  sampleCount: 24,
                  latestSampleAt: `${dayKey}T21:00:00.000Z`
                }
              }
      });
    }

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss?dateKey=2030-01-04"
    });
    assert.equal(overview.statusCode, 200);
    const overviewBody = overview.json() as {
      weightLoss: {
        energyModel: {
          activeBurnKcal: number | null;
          activeBaselineWindowDays: number;
          activeBaselineEvidenceDays: number;
          baselineActiveCaloriesKcal: number;
          todayActiveCaloriesKcal: number;
          todayActiveSurplusKcal: number;
          todayActivityBufferKcal: number;
          todayTargetAdjustmentKcal: number;
        };
        todayLedger: {
          targetCalories: number;
          activeAdjustmentCalories: number;
        };
      };
    };

    assert.equal(overviewBody.weightLoss.energyModel.activeBurnKcal, 200);
    assert.equal(
      overviewBody.weightLoss.energyModel.activeBaselineWindowDays,
      7
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.activeBaselineEvidenceDays,
      2
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.baselineActiveCaloriesKcal,
      200
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActiveCaloriesKcal,
      1000
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActiveSurplusKcal,
      800
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActivityBufferKcal,
      400
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayTargetAdjustmentKcal,
      400
    );
    assert.equal(overviewBody.weightLoss.todayLedger.targetCalories, 2400);
    assert.equal(
      overviewBody.weightLoss.todayLedger.activeAdjustmentCalories,
      400
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("custom nutrition foods require calories and macros and are cached for reuse", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-weight-loss-custom-food-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const invalidCustom = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/food-logs",
      headers: { cookie },
      payload: {
        mealLabel: "Name only",
        source: "manual",
        confirmationState: "confirmed",
        items: [{ name: "Albert's custom toast", quantity: 1 }]
      }
    });
    assert.equal(invalidCustom.statusCode, 400);
    assert.match(invalidCustom.body, /calories, proteinGrams/i);

    const createCustom = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/food-logs",
      headers: { cookie },
      payload: {
        mealLabel: "Reusable custom food",
        source: "manual",
        confirmationState: "confirmed",
        items: [
          {
            name: "Albert's custom toast",
            quantity: 1,
            unit: "serving",
            calories: 310,
            proteinGrams: 19,
            carbohydrateGrams: 34,
            fatGrams: 11,
            fiberGrams: 7,
            tags: ["custom_test"]
          }
        ]
      }
    });
    assert.equal(createCustom.statusCode, 201);
    const createdBody = createCustom.json() as {
      log: { items: Array<{ foodId: string | null }> };
    };
    const customFoodId = createdBody.log.items[0]?.foodId;
    assert.ok(customFoodId);

    const searchCustom = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/foods/search",
      payload: { query: "custom toast", limit: 5 }
    });
    assert.equal(searchCustom.statusCode, 200);
    const searchBody = searchCustom.json() as {
      foods: Array<{
        id: string;
        source: string;
        calories: number | null;
        proteinGrams: number | null;
        carbohydrateGrams: number | null;
        fatGrams: number | null;
      }>;
    };
    const customFood = searchBody.foods.find(
      (food) => food.id === customFoodId
    );
    assert.ok(customFood);
    assert.equal(customFood.source, "custom");
    assert.equal(customFood.calories, 310);
    assert.equal(customFood.proteinGrams, 19);
    assert.equal(customFood.carbohydrateGrams, 34);
    assert.equal(customFood.fatGrams, 11);

    const reuseCustom = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/food-logs",
      headers: { cookie },
      payload: {
        mealLabel: "Reuse custom food",
        source: "search",
        confirmationState: "confirmed",
        items: [
          {
            foodId: customFoodId,
            name: "Albert's custom toast",
            quantity: 1
          }
        ]
      }
    });
    assert.equal(reuseCustom.statusCode, 201);
    const reuseBody = reuseCustom.json() as {
      log: {
        totals: {
          calories: number;
          proteinGrams: number;
          carbohydrateGrams: number;
          fatGrams: number;
        };
        items: Array<{ foodId: string | null }>;
      };
    };
    assert.equal(reuseBody.log.items[0]?.foodId, customFoodId);
    assert.equal(reuseBody.log.totals.calories, 310);
    assert.equal(reuseBody.log.totals.proteinGrams, 19);
    assert.equal(reuseBody.log.totals.carbohydrateGrams, 34);
    assert.equal(reuseBody.log.totals.fatGrams, 11);

    const customRows = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM nutrition_food_catalog
         WHERE source = 'custom' AND name = ?`
      )
      .get("Albert's custom toast") as { count: number };
    assert.equal(customRows.count, 1);

    const createGramCustom = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/food-logs",
      headers: { cookie },
      payload: {
        mealLabel: "Reusable gram custom food",
        source: "manual",
        confirmationState: "confirmed",
        items: [
          {
            name: "Albert gram bowl",
            quantity: 180,
            unit: "g",
            grams: 180,
            calories: 360,
            proteinGrams: 30,
            carbohydrateGrams: 42,
            fatGrams: 12
          }
        ]
      }
    });
    assert.equal(createGramCustom.statusCode, 201);
    const gramCustomBody = createGramCustom.json() as {
      log: { items: Array<{ foodId: string | null }> };
    };
    const gramCustomFoodId = gramCustomBody.log.items[0]?.foodId;
    assert.ok(gramCustomFoodId);

    const reuseHalfGramCustom = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/food-logs",
      headers: { cookie },
      payload: {
        mealLabel: "Reuse half gram custom food",
        source: "search",
        confirmationState: "confirmed",
        items: [
          {
            foodId: gramCustomFoodId,
            name: "Albert gram bowl",
            quantity: 90,
            unit: "g"
          }
        ]
      }
    });
    assert.equal(reuseHalfGramCustom.statusCode, 201);
    const reuseHalfGramBody = reuseHalfGramCustom.json() as {
      log: {
        totals: {
          calories: number;
          proteinGrams: number;
          carbohydrateGrams: number;
          fatGrams: number;
        };
      };
    };
    assert.equal(reuseHalfGramBody.log.totals.calories, 180);
    assert.equal(reuseHalfGramBody.log.totals.proteinGrams, 15);
    assert.equal(reuseHalfGramBody.log.totals.carbohydrateGrams, 21);
    assert.equal(reuseHalfGramBody.log.totals.fatGrams, 6);

    const candidateCustom = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/food-logs",
      headers: { cookie },
      payload: {
        mealLabel: "Candidate custom food",
        source: "chatgpt",
        confirmationState: "candidate",
        items: [
          {
            name: "Albert candidate oats",
            quantity: 1,
            unit: "bowl",
            calories: 420,
            proteinGrams: 24,
            carbohydrateGrams: 58,
            fatGrams: 10
          }
        ]
      }
    });
    assert.equal(candidateCustom.statusCode, 201);
    const candidateBody = candidateCustom.json() as {
      log: { id: string; items: Array<{ foodId: string | null }> };
    };
    assert.equal(candidateBody.log.items[0]?.foodId, null);

    const confirmCandidate = await app.inject({
      method: "PATCH",
      url: `/api/v1/health/weight-loss/food-logs/${candidateBody.log.id}`,
      headers: { cookie },
      payload: { confirmationState: "confirmed" }
    });
    assert.equal(confirmCandidate.statusCode, 200);
    const confirmedBody = confirmCandidate.json() as {
      log: { items: Array<{ foodId: string | null }> };
    };
    assert.ok(confirmedBody.log.items[0]?.foodId);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("weight loss ledger and active override are scoped to the requested local day", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-weight-loss-day-scope-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const dayOne = "2030-01-01";
    const dayTwo = "2030-01-02";

    const createLog = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/food-logs",
      headers: { cookie },
      payload: {
        loggedAt: "2029-12-31T23:30:00.000Z",
        dayKey: dayOne,
        mealLabel: "Local midnight snack",
        source: "manual",
        confirmationState: "confirmed",
        items: [
          {
            name: "Yogurt",
            quantity: 200,
            unit: "grams",
            grams: 200,
            calories: 160,
            proteinGrams: 18,
            carbohydrateGrams: 12,
            fatGrams: 3
          }
        ]
      }
    });
    assert.equal(createLog.statusCode, 201);

    const override = await app.inject({
      method: "PATCH",
      url: "/api/v1/health/weight-loss/daily-active-calories",
      headers: { cookie },
      payload: {
        dayKey: dayOne,
        activeCaloriesKcal: 650,
        notes: "Day-one override"
      }
    });
    assert.equal(override.statusCode, 200);

    const dayOneOverview = await app.inject({
      method: "GET",
      url:
        "/api/v1/health/weight-loss?dateKey=2030-01-01" +
        "&dayStartAt=2029-12-31T23%3A00%3A00.000Z" +
        "&dayEndAt=2030-01-01T23%3A00%3A00.000Z"
    });
    assert.equal(dayOneOverview.statusCode, 200);
    const dayOneBody = dayOneOverview.json() as {
      weightLoss: {
        todayLedger: {
          dateKey: string;
          meals: unknown[];
          totals: { calories: number };
          activeCaloriesSource: string;
        };
        energyModel: {
          todayActiveCaloriesKcal: number;
          todayActiveCaloriesSource: string;
          todayActiveOverride: { activeCaloriesKcal: number } | null;
        };
      };
    };
    assert.equal(dayOneBody.weightLoss.todayLedger.dateKey, dayOne);
    assert.equal(dayOneBody.weightLoss.todayLedger.meals.length, 1);
    assert.equal(dayOneBody.weightLoss.todayLedger.totals.calories, 160);
    assert.equal(
      dayOneBody.weightLoss.todayLedger.activeCaloriesSource,
      "user_override"
    );
    assert.equal(
      dayOneBody.weightLoss.energyModel.todayActiveCaloriesKcal,
      650
    );
    assert.equal(
      dayOneBody.weightLoss.energyModel.todayActiveCaloriesSource,
      "user_override"
    );
    assert.equal(
      dayOneBody.weightLoss.energyModel.todayActiveOverride?.activeCaloriesKcal,
      650
    );

    const dayTwoOverview = await app.inject({
      method: "GET",
      url:
        "/api/v1/health/weight-loss?dateKey=2030-01-02" +
        "&dayStartAt=2030-01-01T23%3A00%3A00.000Z" +
        "&dayEndAt=2030-01-02T23%3A00%3A00.000Z"
    });
    assert.equal(dayTwoOverview.statusCode, 200);
    const dayTwoBody = dayTwoOverview.json() as {
      weightLoss: {
        todayLedger: {
          dateKey: string;
          meals: unknown[];
          totals: { calories: number };
          activeCaloriesSource: string;
        };
        energyModel: {
          todayActiveCaloriesKcal: number;
          todayActiveCaloriesSource: string;
          todayActiveOverride: { activeCaloriesKcal: number } | null;
        };
      };
    };
    assert.equal(dayTwoBody.weightLoss.todayLedger.dateKey, dayTwo);
    assert.equal(dayTwoBody.weightLoss.todayLedger.meals.length, 0);
    assert.equal(dayTwoBody.weightLoss.todayLedger.totals.calories, 0);
    assert.equal(
      dayTwoBody.weightLoss.todayLedger.activeCaloriesSource,
      "default_active_calories"
    );
    assert.equal(dayTwoBody.weightLoss.energyModel.todayActiveCaloriesKcal, 0);
    assert.equal(
      dayTwoBody.weightLoss.energyModel.todayActiveCaloriesSource,
      "default_active_calories"
    );
    assert.equal(dayTwoBody.weightLoss.energyModel.todayActiveOverride, null);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("food logs without dayKey use the supplied local timezone day", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-weight-loss-timezone-day-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const createLog = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/food-logs",
      headers: { cookie },
      payload: {
        loggedAt: "2030-01-01T23:30:00.000Z",
        timeZone: "Europe/Zurich",
        mealLabel: "",
        source: "manual",
        confirmationState: "confirmed",
        items: [
          {
            name: "Late pasta",
            quantity: 1,
            unit: "bowl",
            calories: 321,
            proteinGrams: 12,
            carbohydrateGrams: 55,
            fatGrams: 7
          }
        ]
      }
    });
    assert.equal(createLog.statusCode, 201);
    const createBody = createLog.json() as {
      log: { dayKey: string; totals: { calories: number } };
    };
    assert.equal(createBody.log.dayKey, "2030-01-02");
    assert.equal(createBody.log.totals.calories, 321);

    const dayOneOverview = await app.inject({
      method: "GET",
      url:
        "/api/v1/health/weight-loss?dateKey=2030-01-01" +
        "&timeZone=Europe%2FZurich"
    });
    assert.equal(dayOneOverview.statusCode, 200);
    const dayOneBody = dayOneOverview.json() as {
      weightLoss: {
        todayLedger: { meals: unknown[]; totals: { calories: number } };
      };
    };
    assert.equal(dayOneBody.weightLoss.todayLedger.meals.length, 0);
    assert.equal(dayOneBody.weightLoss.todayLedger.totals.calories, 0);

    const dayTwoOverview = await app.inject({
      method: "GET",
      url:
        "/api/v1/health/weight-loss?dateKey=2030-01-02" +
        "&timeZone=Europe%2FZurich"
    });
    assert.equal(dayTwoOverview.statusCode, 200);
    const dayTwoBody = dayTwoOverview.json() as {
      weightLoss: {
        todayLedger: {
          dateKey: string;
          meals: unknown[];
          totals: { calories: number };
        };
      };
    };
    assert.equal(dayTwoBody.weightLoss.todayLedger.dateKey, "2030-01-02");
    assert.equal(dayTwoBody.weightLoss.todayLedger.meals.length, 1);
    assert.equal(dayTwoBody.weightLoss.todayLedger.totals.calories, 321);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("weight loss energy gap averages intake over the same recent log window", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-weight-loss-energy-gap-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const now = new Date().toISOString();
    const updateTarget = await app.inject({
      method: "PATCH",
      url: "/api/v1/health/weight-loss/target",
      headers: { cookie },
      payload: {
        calorieTarget: 2000,
        proteinGramsTarget: 140,
        fiberGramsTarget: 30,
        carbohydrateGramsTarget: 220,
        fatGramsTarget: 65,
        weightGoalKg: 78,
        weeklyRateGoalKg: -0.35,
        dietStyle: "balanced",
        bodyGoal: "lose fat",
        notes: "Forge science plan; resting_kcal=1500; activity_kcal=500"
      }
    });
    assert.equal(updateTarget.statusCode, 200);

    getDatabase()
      .prepare(
        `INSERT INTO health_daily_summaries (
           id, user_id, date_key, summary_type, metrics_json, derived_json, source, created_at, updated_at
         )
         VALUES (?, 'user_operator', '2030-01-15', 'vitals', ?, '{}', 'healthkit', ?, ?)`
      )
      .run(
        "hds_energy_gap_window",
        JSON.stringify({
          activeEnergyBurned: {
            metric: "activeEnergyBurned",
            unit: "kcal",
            total: 500
          },
          basalEnergyBurned: {
            metric: "basalEnergyBurned",
            unit: "kcal",
            total: 1500
          }
        }),
        now,
        now
      );

    for (let day = 1; day <= 15; day += 1) {
      const dayKey = `2030-01-${String(day).padStart(2, "0")}`;
      const createLog = await app.inject({
        method: "POST",
        url: "/api/v1/health/weight-loss/food-logs",
        headers: { cookie },
        payload: {
          loggedAt: `${dayKey}T12:00:00.000Z`,
          dayKey,
          mealLabel: `Measured meal ${day}`,
          source: "manual",
          confirmationState: "confirmed",
          items: [
            {
              name: "Measured food",
              quantity: 1,
              unit: "serving",
              calories: 100,
              proteinGrams: 8,
              carbohydrateGrams: 12,
              fatGrams: 3
            }
          ]
        }
      });
      assert.equal(createLog.statusCode, 201);
    }

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss?dateKey=2030-01-15"
    });
    assert.equal(overview.statusCode, 200);
    const overviewBody = overview.json() as {
      weightLoss: {
        energyModel: {
          averageCalorieIntake: number;
          recentFoodLogCount: number;
          recentFoodLogDayCount: number;
          estimatedTdeeKcal: number | null;
          estimatedDailyEnergyBalanceKcal: number | null;
        };
      };
    };
    assert.equal(overviewBody.weightLoss.energyModel.averageCalorieIntake, 100);
    assert.equal(overviewBody.weightLoss.energyModel.recentFoodLogCount, 14);
    assert.equal(overviewBody.weightLoss.energyModel.recentFoodLogDayCount, 14);
    assert.equal(overviewBody.weightLoss.energyModel.estimatedTdeeKcal, 2000);
    assert.equal(
      overviewBody.weightLoss.energyModel.estimatedDailyEnergyBalanceKcal,
      -1900
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("weight loss overview seeds latest weight from HealthKit body mass", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-weight-loss-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO health_daily_summaries (
           id, user_id, date_key, summary_type, metrics_json, derived_json, source, created_at, updated_at
         )
         VALUES (?, 'user_operator', ?, 'vitals', ?, '{}', 'healthkit', ?, ?)`
      )
      .run(
        "hds_weight_loss_body_mass",
        today,
        JSON.stringify({
          bodyMass: {
            metric: "bodyMass",
            label: "Body mass",
            category: "composition",
            unit: "kg",
            displayUnit: "kg",
            aggregation: "discrete",
            latest: 81.7,
            sampleCount: 1
          }
        }),
        now,
        now
      );

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss"
    });
    assert.equal(overview.statusCode, 200);
    const overviewBody = overview.json() as {
      weightLoss: {
        weightTrend: {
          latestWeightKg: number | null;
          latestWeightSource: string | null;
          trendWeightKg: number | null;
        };
      };
    };

    assert.equal(overviewBody.weightLoss.weightTrend.latestWeightKg, 81.7);
    assert.equal(
      overviewBody.weightLoss.weightTrend.latestWeightSource,
      "healthkit_body_mass"
    );
    assert.equal(overviewBody.weightLoss.weightTrend.trendWeightKg, 81.7);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("weight loss overview uses same-day workout, movement, and step active calories when HealthKit active energy is missing", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-weight-loss-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    const updateTarget = await app.inject({
      method: "PATCH",
      url: "/api/v1/health/weight-loss/target",
      headers: { cookie },
      payload: {
        calorieTarget: 2000,
        proteinGramsTarget: 150,
        fiberGramsTarget: 30,
        carbohydrateGramsTarget: 220,
        fatGramsTarget: 65,
        weightGoalKg: 78,
        weeklyRateGoalKg: -0.35,
        dietStyle: "balanced",
        bodyGoal: "lose fat",
        notes: "Forge science plan; activity_kcal=300"
      }
    });
    assert.equal(updateTarget.statusCode, 200);

    getDatabase()
      .prepare(
        `INSERT INTO health_daily_summaries (
           id, user_id, date_key, summary_type, metrics_json, derived_json, source, created_at, updated_at
         )
         VALUES (?, 'user_operator', ?, 'vitals', ?, '{}', 'healthkit', ?, ?)`
      )
      .run(
        "hds_weight_loss_fallback_steps",
        today,
        JSON.stringify({
          bodyMass: {
            metric: "bodyMass",
            label: "Body mass",
            category: "composition",
            unit: "kg",
            displayUnit: "kg",
            aggregation: "discrete",
            latest: 80,
            sampleCount: 1
          },
          stepCount: {
            metric: "stepCount",
            label: "Steps",
            category: "activity",
            unit: "count",
            displayUnit: "steps",
            aggregation: "cumulative",
            total: 10000,
            sampleCount: 24
          }
        }),
        now,
        now
      );

    getDatabase()
      .prepare(
        `INSERT INTO health_workout_sessions (
           id, external_uid, user_id, source, workout_type, started_at, ended_at,
           duration_seconds, active_energy_kcal, total_energy_kcal, created_at, updated_at
         )
         VALUES (?, ?, 'user_operator', 'apple_health', 'cycling', ?, ?, 2400, 500, 560, ?, ?)`
      )
      .run(
        "workout_weight_loss_fallback",
        "workout_weight_loss_fallback",
        `${today}T07:00:00.000Z`,
        `${today}T07:40:00.000Z`,
        now,
        now
      );
    getDatabase()
      .prepare(
        `INSERT INTO movement_trips (
           id, external_uid, user_id, started_at, ended_at, distance_meters,
           moving_seconds, idle_seconds, calories_kcal, created_at, updated_at
         )
         VALUES (?, ?, 'user_operator', ?, ?, 1800, 1200, 0, 140, ?, ?)`
      )
      .run(
        "trip_weight_loss_fallback",
        "trip_weight_loss_fallback",
        `${today}T12:00:00.000Z`,
        `${today}T12:20:00.000Z`,
        now,
        now
      );

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss"
    });
    assert.equal(overview.statusCode, 200);
    const overviewBody = overview.json() as {
      weightLoss: {
        todayLedger: {
          plannedTargetCalories: number;
          targetCalories: number;
          activeAdjustmentCalories: number;
          activeCaloriesSource: string;
        };
        energyModel: {
          baselineActiveCaloriesKcal: number;
          todayActiveCaloriesKcal: number;
          todayObservedActiveCaloriesKcal: number | null;
          todayActiveCaloriesSource: string;
          todayWorkoutEnergyKcal: number | null;
          todayMovementCaloriesKcal: number | null;
          todayStepEstimatedCaloriesKcal: number | null;
        };
      };
    };

    assert.equal(
      overviewBody.weightLoss.todayLedger.plannedTargetCalories,
      2000
    );
    assert.equal(overviewBody.weightLoss.todayLedger.targetCalories, 2344);
    assert.equal(
      overviewBody.weightLoss.todayLedger.activeAdjustmentCalories,
      344
    );
    assert.equal(
      overviewBody.weightLoss.todayLedger.activeCaloriesSource,
      "today_workout_movement_step_energy"
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.baselineActiveCaloriesKcal,
      300
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayObservedActiveCaloriesKcal,
      987
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActiveCaloriesKcal,
      987
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActiveCaloriesSource,
      "today_workout_movement_step_energy"
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayWorkoutEnergyKcal,
      500
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayMovementCaloriesKcal,
      140
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayStepEstimatedCaloriesKcal,
      347
    );

    const override = await app.inject({
      method: "PATCH",
      url: "/api/v1/health/weight-loss/daily-active-calories",
      headers: { cookie },
      payload: {
        dayKey: today,
        activeCaloriesKcal: 800,
        notes: "Manual test override"
      }
    });
    assert.equal(override.statusCode, 200);

    const overriddenOverview = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss"
    });
    assert.equal(overriddenOverview.statusCode, 200);
    const overriddenBody = overriddenOverview.json() as {
      weightLoss: {
        todayLedger: {
          targetCalories: number;
          activeAdjustmentCalories: number;
          activeCaloriesSource: string;
          remainingCalories: number;
        };
        energyModel: {
          todayActiveCaloriesKcal: number;
          todayTargetAdjustmentKcal: number;
          todayActiveDeltaKcal: number;
          todayActiveCaloriesSource: string;
          todayActiveOverride: { activeCaloriesKcal: number } | null;
        };
      };
    };
    assert.equal(overriddenBody.weightLoss.todayLedger.targetCalories, 2250);
    assert.equal(
      overriddenBody.weightLoss.todayLedger.activeAdjustmentCalories,
      250
    );
    assert.equal(overriddenBody.weightLoss.todayLedger.remainingCalories, 2250);
    assert.equal(
      overriddenBody.weightLoss.todayLedger.activeCaloriesSource,
      "user_override"
    );
    assert.equal(
      overriddenBody.weightLoss.energyModel.todayActiveCaloriesKcal,
      800
    );
    assert.equal(
      overriddenBody.weightLoss.energyModel.todayTargetAdjustmentKcal,
      250
    );
    assert.equal(
      overriddenBody.weightLoss.energyModel.todayActiveDeltaKcal,
      500
    );
    assert.equal(
      overriddenBody.weightLoss.energyModel.todayActiveCaloriesSource,
      "user_override"
    );
    assert.equal(
      overriddenBody.weightLoss.energyModel.todayActiveOverride
        ?.activeCaloriesKcal,
      800
    );

    const lowOverride = await app.inject({
      method: "PATCH",
      url: "/api/v1/health/weight-loss/daily-active-calories",
      headers: { cookie },
      payload: {
        dayKey: today,
        activeCaloriesKcal: 100,
        notes: "Manual low-activity override"
      }
    });
    assert.equal(lowOverride.statusCode, 200);

    const lowOverview = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss"
    });
    assert.equal(lowOverview.statusCode, 200);
    const lowBody = lowOverview.json() as {
      weightLoss: {
        todayLedger: {
          targetCalories: number;
          activeAdjustmentCalories: number;
          activeCaloriesSource: string;
          remainingCalories: number;
        };
        energyModel: {
          todayActiveCaloriesKcal: number;
          todayTargetAdjustmentKcal: number;
          todayActiveDeltaKcal: number;
          todayActiveCaloriesSource: string;
          todayActiveOverride: { activeCaloriesKcal: number } | null;
        };
      };
    };
    assert.equal(lowBody.weightLoss.todayLedger.targetCalories, 1900);
    assert.equal(lowBody.weightLoss.todayLedger.activeAdjustmentCalories, -100);
    assert.equal(lowBody.weightLoss.todayLedger.remainingCalories, 1900);
    assert.equal(
      lowBody.weightLoss.todayLedger.activeCaloriesSource,
      "user_override"
    );
    assert.equal(lowBody.weightLoss.energyModel.todayActiveCaloriesKcal, 100);
    assert.equal(
      lowBody.weightLoss.energyModel.todayTargetAdjustmentKcal,
      -100
    );
    assert.equal(lowBody.weightLoss.energyModel.todayActiveDeltaKcal, -200);
    assert.equal(
      lowBody.weightLoss.energyModel.todayActiveCaloriesSource,
      "user_override"
    );
    assert.equal(
      lowBody.weightLoss.energyModel.todayActiveOverride?.activeCaloriesKcal,
      100
    );

    const resetOverride = await app.inject({
      method: "PATCH",
      url: "/api/v1/health/weight-loss/daily-active-calories",
      headers: { cookie },
      payload: {
        dayKey: today,
        activeCaloriesKcal: null
      }
    });
    assert.equal(resetOverride.statusCode, 200);

    const resetOverview = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss"
    });
    assert.equal(resetOverview.statusCode, 200);
    const resetBody = resetOverview.json() as {
      weightLoss: {
        todayLedger: {
          targetCalories: number;
          activeCaloriesSource: string;
        };
        energyModel: {
          todayActiveCaloriesKcal: number;
          todayActiveCaloriesSource: string;
          todayActiveOverride: { activeCaloriesKcal: number } | null;
        };
      };
    };
    assert.equal(resetBody.weightLoss.todayLedger.targetCalories, 2344);
    assert.equal(
      resetBody.weightLoss.todayLedger.activeCaloriesSource,
      "today_workout_movement_step_energy"
    );
    assert.equal(resetBody.weightLoss.energyModel.todayActiveCaloriesKcal, 987);
    assert.equal(
      resetBody.weightLoss.energyModel.todayActiveCaloriesSource,
      "today_workout_movement_step_energy"
    );
    assert.equal(resetBody.weightLoss.energyModel.todayActiveOverride, null);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("weight loss overview uses movement calories when only movement trips exist today", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-weight-loss-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const updateTarget = await app.inject({
      method: "PATCH",
      url: "/api/v1/health/weight-loss/target",
      headers: { cookie },
      payload: {
        calorieTarget: 2000,
        proteinGramsTarget: 150,
        fiberGramsTarget: 30,
        carbohydrateGramsTarget: 220,
        fatGramsTarget: 65,
        weightGoalKg: 78,
        weeklyRateGoalKg: -0.25,
        dietStyle: "balanced",
        bodyGoal: "lose fat",
        notes: "Forge science plan; activity_kcal=388"
      }
    });
    assert.equal(updateTarget.statusCode, 200);

    getDatabase()
      .prepare(
        `INSERT INTO movement_trips (
           id, external_uid, user_id, started_at, ended_at, distance_meters,
           moving_seconds, idle_seconds, calories_kcal, created_at, updated_at
         )
         VALUES (?, ?, 'user_operator', ?, ?, 700, 480, 0, 49, ?, ?)`
      )
      .run(
        "trip_weight_loss_movement_only",
        "trip_weight_loss_movement_only",
        `${today}T12:00:00.000Z`,
        `${today}T12:08:00.000Z`,
        now,
        now
      );

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss"
    });
    assert.equal(overview.statusCode, 200);
    const overviewBody = overview.json() as {
      weightLoss: {
        todayLedger: {
          targetCalories: number;
          activeAdjustmentCalories: number;
          activeCaloriesSource: string;
        };
        energyModel: {
          baselineActiveCaloriesKcal: number;
          todayActiveCaloriesKcal: number;
          todayObservedActiveCaloriesKcal: number | null;
          todayActiveCaloriesSource: string;
          todayMovementCaloriesKcal: number | null;
          todayWorkoutEnergyKcal: number | null;
        };
      };
    };

    assert.equal(overviewBody.weightLoss.todayLedger.targetCalories, 2000);
    assert.equal(
      overviewBody.weightLoss.todayLedger.activeAdjustmentCalories,
      0
    );
    assert.equal(
      overviewBody.weightLoss.todayLedger.activeCaloriesSource,
      "today_movement_trip_calories"
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.baselineActiveCaloriesKcal,
      388
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActiveCaloriesKcal,
      49
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayObservedActiveCaloriesKcal,
      49
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActiveCaloriesSource,
      "today_movement_trip_calories"
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayMovementCaloriesKcal,
      49
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayWorkoutEnergyKcal,
      null
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("weight loss overview estimates active calories from steps before using the default", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-weight-loss-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const updateTarget = await app.inject({
      method: "PATCH",
      url: "/api/v1/health/weight-loss/target",
      headers: { cookie },
      payload: {
        calorieTarget: 2000,
        proteinGramsTarget: 150,
        fiberGramsTarget: 30,
        carbohydrateGramsTarget: 220,
        fatGramsTarget: 65,
        weightGoalKg: 78,
        weeklyRateGoalKg: -0.25,
        dietStyle: "balanced",
        bodyGoal: "lose fat",
        notes: "Forge science plan; activity_kcal=300"
      }
    });
    assert.equal(updateTarget.statusCode, 200);

    getDatabase()
      .prepare(
        `INSERT INTO health_daily_summaries (
           id, user_id, date_key, summary_type, metrics_json, derived_json, source, created_at, updated_at
         )
         VALUES (?, 'user_operator', ?, 'vitals', ?, '{}', 'healthkit', ?, ?)`
      )
      .run(
        "hds_weight_loss_steps_only",
        today,
        JSON.stringify({
          bodyMass: {
            metric: "bodyMass",
            label: "Body mass",
            category: "composition",
            unit: "kg",
            displayUnit: "kg",
            aggregation: "discrete",
            latest: 80,
            sampleCount: 1
          },
          stepCount: {
            metric: "stepCount",
            label: "Steps",
            category: "activity",
            unit: "count",
            displayUnit: "steps",
            aggregation: "cumulative",
            total: 10000,
            sampleCount: 24
          }
        }),
        now,
        now
      );

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss"
    });
    assert.equal(overview.statusCode, 200);
    const overviewBody = overview.json() as {
      weightLoss: {
        todayLedger: {
          targetCalories: number;
          activeAdjustmentCalories: number;
          activeCaloriesSource: string;
        };
        energyModel: {
          baselineActiveCaloriesKcal: number;
          todayActiveCaloriesKcal: number;
          todayObservedActiveCaloriesKcal: number | null;
          todayActiveCaloriesSource: string;
          todayStepCount: number | null;
          todayStepEstimatedCaloriesKcal: number | null;
        };
      };
    };

    assert.equal(
      overviewBody.weightLoss.energyModel.baselineActiveCaloriesKcal,
      300
    );
    assert.equal(overviewBody.weightLoss.energyModel.todayStepCount, 10000);
    assert.equal(
      overviewBody.weightLoss.energyModel.todayStepEstimatedCaloriesKcal,
      347
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayObservedActiveCaloriesKcal,
      347
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActiveCaloriesKcal,
      347
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActiveCaloriesSource,
      "today_step_estimate"
    );
    assert.equal(
      overviewBody.weightLoss.todayLedger.activeCaloriesSource,
      "today_step_estimate"
    );
    assert.equal(
      overviewBody.weightLoss.todayLedger.activeAdjustmentCalories,
      24
    );
    assert.equal(overviewBody.weightLoss.todayLedger.targetCalories, 2024);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("weight loss overview keeps the default active calories when only trivial steps are synced", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-weight-loss-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const updateTarget = await app.inject({
      method: "PATCH",
      url: "/api/v1/health/weight-loss/target",
      headers: { cookie },
      payload: {
        calorieTarget: 2000,
        proteinGramsTarget: 150,
        fiberGramsTarget: 30,
        carbohydrateGramsTarget: 220,
        fatGramsTarget: 65,
        weightGoalKg: 78,
        weeklyRateGoalKg: -0.25,
        dietStyle: "balanced",
        bodyGoal: "lose fat",
        notes: "Forge science plan; activity_kcal=388"
      }
    });
    assert.equal(updateTarget.statusCode, 200);

    getDatabase()
      .prepare(
        `INSERT INTO health_daily_summaries (
           id, user_id, date_key, summary_type, metrics_json, derived_json, source, created_at, updated_at
         )
         VALUES (?, 'user_operator', ?, 'vitals', ?, '{}', 'healthkit', ?, ?)`
      )
      .run(
        "hds_weight_loss_trivial_steps_only",
        today,
        JSON.stringify({
          bodyMass: {
            metric: "bodyMass",
            label: "Body mass",
            category: "composition",
            unit: "kg",
            displayUnit: "kg",
            aggregation: "discrete",
            latest: 80,
            sampleCount: 1
          },
          stepCount: {
            metric: "stepCount",
            label: "Steps",
            category: "activity",
            unit: "count",
            displayUnit: "steps",
            aggregation: "cumulative",
            total: 8,
            sampleCount: 1
          }
        }),
        now,
        now
      );

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss"
    });
    assert.equal(overview.statusCode, 200);
    const overviewBody = overview.json() as {
      weightLoss: {
        todayLedger: {
          targetCalories: number;
          activeAdjustmentCalories: number;
          activeCaloriesSource: string;
        };
        energyModel: {
          baselineActiveCaloriesKcal: number;
          todayActiveCaloriesKcal: number;
          todayObservedActiveCaloriesKcal: number | null;
          todayActiveCaloriesSource: string;
          todayStepCount: number | null;
          todayStepEstimatedCaloriesKcal: number | null;
        };
      };
    };

    assert.equal(
      overviewBody.weightLoss.energyModel.baselineActiveCaloriesKcal,
      388
    );
    assert.equal(overviewBody.weightLoss.energyModel.todayStepCount, 8);
    assert.equal(
      overviewBody.weightLoss.energyModel.todayStepEstimatedCaloriesKcal,
      0
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayObservedActiveCaloriesKcal,
      null
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActiveCaloriesKcal,
      388
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayActiveCaloriesSource,
      "default_active_calories"
    );
    assert.equal(
      overviewBody.weightLoss.todayLedger.activeCaloriesSource,
      "default_active_calories"
    );
    assert.equal(
      overviewBody.weightLoss.todayLedger.activeAdjustmentCalories,
      0
    );
    assert.equal(overviewBody.weightLoss.todayLedger.targetCalories, 2000);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
