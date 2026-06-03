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
        };
        summary: { loggedMealCount: number };
        energyModel: {
          estimatedTdeeKcal: number | null;
          activeBurnKcal: number | null;
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
    assert.equal(overviewBody.weightLoss.energyModel.restingEnergyCalories, 1600);
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
    assert.equal(typeof overviewBody.weightLoss.foodQuality.qualityScore, "number");
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
