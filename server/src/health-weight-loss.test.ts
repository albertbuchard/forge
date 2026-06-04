import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";

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
            fiberGrams: 0,
            tags: ["high-protein"]
          },
          {
            name: "Berries",
            quantity: 120,
            unit: "g",
            calories: 70,
            carbohydrateGrams: 16,
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
    assert.equal(createLogBody.log.totals.proteinGrams, 25);
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
            proteinGrams: 25
          },
          {
            name: "Berries",
            quantity: 120,
            unit: "g",
            calories: 70,
            carbohydrateGrams: 16,
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
          "Forge science plan; resting_kcal=1700; activity_kcal=300; maintenance_kcal=2000"
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
        "hds_weight_loss_energy",
        today,
        JSON.stringify({
          activeEnergyBurned: {
            metric: "activeEnergyBurned",
            label: "Active energy",
            category: "activity",
            unit: "kcal",
            displayUnit: "kcal",
            aggregation: "cumulative",
            total: 420,
            sampleCount: 12
          },
          basalEnergyBurned: {
            metric: "basalEnergyBurned",
            label: "Basal energy",
            category: "activity",
            unit: "kcal",
            displayUnit: "kcal",
            aggregation: "cumulative",
            total: 1600,
            sampleCount: 12
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
        };
        summary: { loggedMealCount: number; targetCalories: number };
        energyModel: {
          estimatedTdeeKcal: number | null;
          activeBurnKcal: number | null;
          baselineActiveCaloriesKcal: number;
          todayActiveCaloriesKcal: number;
          todayActiveCaloriesSource: string;
          todayTargetAdjustmentKcal: number;
          todayWorkoutEnergyKcal: number | null;
          movementCaloriesKcal: number | null;
          restingEnergyCalories: number | null;
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
    assert.equal(overviewBody.weightLoss.todayLedger.totals.proteinGrams, 50);
    assert.equal(overviewBody.weightLoss.todayLedger.totals.fiberGrams, 10);
    assert.equal(overviewBody.weightLoss.todayLedger.meals.length, 2);
    assert.equal(
      overviewBody.weightLoss.todayLedger.plannedTargetCalories,
      2100
    );
    assert.equal(overviewBody.weightLoss.todayLedger.targetCalories, 2220);
    assert.equal(overviewBody.weightLoss.summary.targetCalories, 2220);
    assert.equal(
      overviewBody.weightLoss.todayLedger.activeAdjustmentCalories,
      120
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
    assert.equal(overviewBody.weightLoss.energyModel.activeBurnKcal, 420);
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
      120
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.todayWorkoutEnergyKcal,
      650
    );
    assert.equal(
      overviewBody.weightLoss.energyModel.restingEnergyCalories,
      1600
    );
    assert.equal(overviewBody.weightLoss.energyModel.estimatedTdeeKcal, 2020);
    assert.ok(
      typeof overviewBody.weightLoss.energyModel.movementCaloriesKcal ===
        "number" ||
        overviewBody.weightLoss.energyModel.movementCaloriesKcal === null
    );
    assert.equal(overviewBody.weightLoss.energyModel.movementCaloriesKcal, 120);
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
            proteinGrams: 18
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

test("weight loss energy gap averages intake over the same recent log window", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-weight-loss-energy-gap-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const now = new Date().toISOString();

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
              calories: 100
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
    assert.equal(overviewBody.weightLoss.todayLedger.targetCalories, 2687);
    assert.equal(
      overviewBody.weightLoss.todayLedger.activeAdjustmentCalories,
      687
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
        };
        energyModel: {
          todayActiveCaloriesKcal: number;
          todayActiveCaloriesSource: string;
          todayActiveOverride: { activeCaloriesKcal: number } | null;
        };
      };
    };
    assert.equal(overriddenBody.weightLoss.todayLedger.targetCalories, 2500);
    assert.equal(
      overriddenBody.weightLoss.todayLedger.activeAdjustmentCalories,
      500
    );
    assert.equal(
      overriddenBody.weightLoss.todayLedger.activeCaloriesSource,
      "user_override"
    );
    assert.equal(
      overriddenBody.weightLoss.energyModel.todayActiveCaloriesKcal,
      800
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
    assert.equal(resetBody.weightLoss.todayLedger.targetCalories, 2687);
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

    assert.equal(overviewBody.weightLoss.todayLedger.targetCalories, 1661);
    assert.equal(
      overviewBody.weightLoss.todayLedger.activeAdjustmentCalories,
      -339
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
      47
    );
    assert.equal(overviewBody.weightLoss.todayLedger.targetCalories, 2047);
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
