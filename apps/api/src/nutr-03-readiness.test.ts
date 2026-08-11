import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("NUTR-03 keeps missing metrics explicit and counts evidence by populated metric", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-nutr-03-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    let requestIndex = 0;
    const post = async (route: string, payload: Record<string, unknown>) => {
      requestIndex += 1;
      const response = await app.inject({
        method: "POST",
        url: route,
        headers: {
          cookie,
          "Idempotency-Key": `nutr-03-${requestIndex}`
        },
        payload
      });
      assert.equal(response.statusCode, 201, response.body);
      return response;
    };
    const read = async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/health/weight-loss?dateKey=2026-08-11",
        headers: { cookie }
      });
      assert.equal(response.statusCode, 200, response.body);
      return (
        response.json() as {
          weightLoss: {
            subjective: {
              checkinCount: number;
              averageEnergy: number | null;
              averageFocus: number | null;
              averageHunger: number | null;
              metricCoverage: Record<string, number>;
              recent: Array<{ notes: string }>;
            };
            gut: {
              checkinCount: number;
              averageBloating: number | null;
              averageReflux: number | null;
              averageAbdominalPain: number | null;
              metricCoverage: Record<string, number>;
              recent: Array<{ notes: string }>;
            };
            appearanceCheckins: Array<{ notes: string }>;
            dataQuality: { missingHighValueCheckins: string[] };
          };
        }
      ).weightLoss;
    };

    await post("/api/v1/health/weight-loss/subjective-checkins", {
      notes: "Subjective context without a rating"
    });
    await post("/api/v1/health/weight-loss/gut-checkins", {
      notes: "Gut context without a symptom rating"
    });
    await post("/api/v1/health/weight-loss/appearance-checkins", {
      notes: "Appearance context without an observation"
    });

    const noteOnly = await read();
    assert.equal(noteOnly.subjective.checkinCount, 1);
    assert.equal(noteOnly.subjective.averageEnergy, null);
    assert.equal(noteOnly.subjective.metricCoverage.energy, 0);
    assert.equal(noteOnly.gut.checkinCount, 1);
    assert.equal(noteOnly.gut.averageBloating, null);
    assert.equal(noteOnly.gut.metricCoverage.bloating, 0);
    assert.deepEqual(noteOnly.dataQuality.missingHighValueCheckins, [
      "food log",
      "body measurement",
      "energy rating",
      "gut symptom",
      "appearance signal"
    ]);

    await post("/api/v1/health/weight-loss/subjective-checkins", {
      energy: 4,
      hunger: 7,
      notes: "Energy context one"
    });
    await post("/api/v1/health/weight-loss/subjective-checkins", {
      energy: 6,
      notes: "Energy context two"
    });
    await post("/api/v1/health/weight-loss/subjective-checkins", {
      energy: 8,
      notes: "Energy context three"
    });
    await post("/api/v1/health/weight-loss/gut-checkins", {
      bloating: 4,
      notes: "Bloating context"
    });
    await post("/api/v1/health/weight-loss/gut-checkins", {
      reflux: 6,
      notes: "Reflux context"
    });
    await post("/api/v1/health/weight-loss/gut-checkins", {
      abdominalPain: 2,
      notes: "Pain context"
    });
    await post("/api/v1/health/weight-loss/appearance-checkins", {
      leanness: 5,
      notes: "Appearance observation context"
    });

    const populated = await read();
    assert.equal(populated.subjective.checkinCount, 4);
    assert.equal(populated.subjective.averageEnergy, 6);
    assert.equal(populated.subjective.averageFocus, null);
    assert.equal(populated.subjective.averageHunger, 7);
    assert.deepEqual(populated.subjective.metricCoverage, {
      energy: 3,
      focus: 0,
      hunger: 1,
      cravings: 0,
      mood: 0,
      stress: 0,
      sleepiness: 0,
      crash: 0
    });
    assert.equal(populated.gut.checkinCount, 4);
    assert.equal(populated.gut.averageBloating, 4);
    assert.equal(populated.gut.averageReflux, 6);
    assert.equal(populated.gut.averageAbdominalPain, 2);
    assert.deepEqual(populated.gut.metricCoverage, {
      bloating: 1,
      reflux: 1,
      abdominalPain: 1,
      gas: 0,
      nausea: 0,
      stoolType: 0
    });
    assert.ok(
      !populated.dataQuality.missingHighValueCheckins.includes("energy rating")
    );
    assert.ok(
      !populated.dataQuality.missingHighValueCheckins.includes("gut symptom")
    );
    assert.ok(
      !populated.dataQuality.missingHighValueCheckins.includes(
        "appearance signal"
      )
    );
    assert.ok(
      populated.subjective.recent.every(
        (entry) => !entry.notes.includes("Gut context")
      )
    );
    assert.ok(
      populated.gut.recent.every(
        (entry) => !entry.notes.includes("Appearance context")
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
