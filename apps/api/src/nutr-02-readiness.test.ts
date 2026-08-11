import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import {
  canonicalMobileRequest,
  MOBILE_REQUEST_PROTOCOL
} from "./security/mobile-companion-request.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

function insertActiveEnergyDay(dayKey: string, total: number) {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO health_daily_summaries (
         id, user_id, date_key, summary_type, metrics_json, derived_json,
         source, created_at, updated_at
       ) VALUES (?, 'user_operator', ?, 'vitals', ?, '{}', 'healthkit', ?, ?)`
    )
    .run(
      `hds_nutr_02_${dayKey}`,
      dayKey,
      JSON.stringify({
        activeEnergyBurned: {
          metric: "activeEnergyBurned",
          unit: "kcal",
          total,
          sampleCount: 24,
          latestSampleAt: `${dayKey}T21:00:00.000Z`
        }
      }),
      now,
      now
    );
}

function insertWorkoutEnergyDay(dayKey: string, total: number) {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO health_workout_sessions (
         id, external_uid, user_id, source, workout_type, started_at, ended_at,
         duration_seconds, active_energy_kcal, total_energy_kcal, created_at,
         updated_at
       ) VALUES (?, ?, 'user_operator', 'apple_health', 'walking', ?, ?, 1800, ?, ?, ?, ?)`
    )
    .run(
      `workout_nutr_02_${dayKey}`,
      `workout_nutr_02_${dayKey}`,
      `${dayKey}T12:00:00.000Z`,
      `${dayKey}T12:30:00.000Z`,
      total,
      total,
      now,
      now
    );
}

type BaselineModel = {
  activeBurnKcal: number;
  activeEnergyCalories: number;
  activeBaselineWindowDays: number;
  activeBaselineMinimumEvidenceDays: number;
  activeBaselineEvidenceDays: number;
  activeBaselineSelectedEvidenceDays: number;
  activeBaselineCoverage: number;
  activeBaselineReliability: string;
  activeBaselineDecision: string;
  activeBaselineSource: string;
  activeBaselineObservedCaloriesKcal: number;
  baselineActiveCaloriesKcal: number;
  energySourceConfidence: string;
  canonicalUnits: {
    energy: string;
    bodyMass: string;
    macronutrients: string;
  };
};

test("NUTR-02 keeps sparse activity directional and promotes a measured baseline only after majority coverage", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-nutr-02-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const target = await app.inject({
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
          "NUTR-02 plan; activity_kcal=300; resting_kcal=1500; eat_back_fraction=0.5"
      }
    });
    assert.equal(target.statusCode, 200, target.body);

    insertActiveEnergyDay("2030-01-07", 900);
    const sparse = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss?dateKey=2030-01-08",
      headers: { cookie }
    });
    assert.equal(sparse.statusCode, 200, sparse.body);
    const sparseBody = sparse.json() as {
      weightLoss: {
        energyModel: BaselineModel;
        todayLedger: {
          targetCalories: number;
          activeAdjustmentCalories: number;
        };
      };
    };
    assert.deepEqual(sparseBody.weightLoss.energyModel, {
      ...sparseBody.weightLoss.energyModel,
      activeBurnKcal: 300,
      activeEnergyCalories: 900,
      activeBaselineWindowDays: 7,
      activeBaselineMinimumEvidenceDays: 4,
      activeBaselineEvidenceDays: 1,
      activeBaselineSelectedEvidenceDays: 1,
      activeBaselineCoverage: 0.14,
      activeBaselineReliability: "sparse",
      activeBaselineDecision: "configured_default_sparse_evidence",
      activeBaselineSource: "healthkit_daily_active_energy",
      activeBaselineObservedCaloriesKcal: 900,
      baselineActiveCaloriesKcal: 300,
      energySourceConfidence: "target_inference_only",
      canonicalUnits: {
        energy: "kcal",
        bodyMass: "kg",
        macronutrients: "g"
      }
    });
    assert.equal(sparseBody.weightLoss.todayLedger.targetCalories, 2000);
    assert.equal(sparseBody.weightLoss.todayLedger.activeAdjustmentCalories, 0);

    for (const dayKey of [
      "2030-01-01",
      "2030-01-02",
      "2030-01-03",
      "2030-01-04"
    ]) {
      insertWorkoutEnergyDay(dayKey, 400);
    }
    const fallbackQualified = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss?dateKey=2030-01-08",
      headers: { cookie }
    });
    assert.equal(fallbackQualified.statusCode, 200, fallbackQualified.body);
    const fallbackModel = (
      fallbackQualified.json() as {
        weightLoss: { energyModel: BaselineModel };
      }
    ).weightLoss.energyModel;
    assert.equal(
      fallbackModel.activeBaselineSource,
      "workout_movement_fallback"
    );
    assert.equal(fallbackModel.activeBaselineSelectedEvidenceDays, 4);
    assert.equal(fallbackModel.activeBaselineReliability, "partial");
    assert.equal(fallbackModel.baselineActiveCaloriesKcal, 400);

    insertActiveEnergyDay("2030-01-04", 500);
    insertActiveEnergyDay("2030-01-05", 700);
    insertActiveEnergyDay("2030-01-06", 1100);
    const qualified = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss?dateKey=2030-01-08",
      headers: { cookie }
    });
    assert.equal(qualified.statusCode, 200, qualified.body);
    const qualifiedModel = (
      qualified.json() as { weightLoss: { energyModel: BaselineModel } }
    ).weightLoss.energyModel;
    assert.equal(qualifiedModel.activeEnergyCalories, 800);
    assert.equal(qualifiedModel.activeBaselineSelectedEvidenceDays, 4);
    assert.equal(qualifiedModel.activeBaselineCoverage, 0.57);
    assert.equal(qualifiedModel.activeBaselineReliability, "partial");
    assert.equal(qualifiedModel.activeBaselineDecision, "measured_baseline");
    assert.equal(qualifiedModel.activeBaselineObservedCaloriesKcal, 800);
    assert.equal(qualifiedModel.baselineActiveCaloriesKcal, 800);
    assert.equal(qualifiedModel.activeBurnKcal, 800);
    assert.equal(
      qualifiedModel.energySourceConfidence,
      "healthkit_daily_active_energy"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("NUTR-02 converts a pound preference to the canonical kilogram weight used by the nutrition model", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-nutr-02-unit-"));
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: { cookie, host: "127.0.0.1:4317" },
      payload: { userId: "user_operator" }
    });
    assert.equal(pairingResponse.statusCode, 201, pairingResponse.body);
    const pairing = (
      pairingResponse.json() as {
        qrPayload: { sessionId: string; pairingToken: string };
      }
    ).qrPayload;
    const payload = {
      sessionId: pairing.sessionId,
      pairingToken: pairing.pairingToken,
      device: {
        name: "NUTR-02 iPhone",
        platform: "ios",
        appVersion: "1.0",
        sourceDevice: "Apple Watch"
      },
      permissions: {
        healthKitAuthorized: true,
        backgroundRefreshEnabled: true,
        motionReady: false,
        locationReady: false,
        screenTimeReady: false
      },
      vitals: {
        daySummaries: [
          {
            dateKey: "2026-08-10",
            sourceTimezone: "Europe/Zurich",
            metrics: [
              {
                metric: "bodyMass",
                label: "Body mass",
                category: "composition",
                unit: "lb",
                displayUnit: "lb",
                aggregation: "discrete",
                average: 176.369_809_747,
                minimum: 176.369_809_747,
                maximum: 176.369_809_747,
                latest: 176.369_809_747,
                sampleCount: 1,
                latestSampleAt: "2026-08-10T07:00:00.000Z"
              }
            ]
          }
        ]
      }
    };
    const requestPath = "/api/v1/mobile/healthkit/sync";
    const issuedAt = new Date().toISOString();
    const nonce = randomUUID().replaceAll("-", "");
    const bodySha256 = createHash("sha256")
      .update(JSON.stringify(payload), "utf8")
      .digest("hex");
    const sync = await app.inject({
      method: "POST",
      url: requestPath,
      headers: {
        "x-forge-mobile-request-protocol": MOBILE_REQUEST_PROTOCOL,
        "x-forge-mobile-session-id": pairing.sessionId,
        "x-forge-mobile-request-issued-at": issuedAt,
        "x-forge-mobile-request-nonce": nonce,
        "x-forge-mobile-body-sha256": bodySha256,
        "x-forge-mobile-request-signature": createHmac(
          "sha256",
          pairing.pairingToken
        )
          .update(
            canonicalMobileRequest({
              method: "POST",
              path: requestPath,
              sessionId: pairing.sessionId,
              issuedAt,
              nonce,
              bodySha256
            }),
            "utf8"
          )
          .digest("hex")
      },
      payload
    });
    assert.equal(sync.statusCode, 200, sync.body);

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss?dateKey=2026-08-10",
      headers: { cookie }
    });
    assert.equal(overview.statusCode, 200, overview.body);
    const weightLoss = (
      overview.json() as {
        weightLoss: {
          weightTrend: { latestWeightKg: number; latestWeightSource: string };
          energyModel: BaselineModel;
        };
      }
    ).weightLoss;
    assert.equal(weightLoss.weightTrend.latestWeightKg, 80);
    assert.equal(
      weightLoss.weightTrend.latestWeightSource,
      "healthkit_body_mass"
    );
    assert.deepEqual(weightLoss.energyModel.canonicalUnits, {
      energy: "kcal",
      bodyMass: "kg",
      macronutrients: "g"
    });
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
