import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("NUTR-04 rejects overlapping windows and requires explicit repeated evidence before completion", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-nutr-04-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const base = {
      title: "Carbohydrates before kickboxing",
      hypothesis: "Pre-training carbohydrates improve perceived performance",
      metricKey: "energy",
      intervention: "Eat 60 g carbohydrates before kickboxing",
      successCriteria: "Energy improves by at least one point",
      baselineStart: "2026-08-01",
      baselineEnd: "2026-08-03",
      experimentStart: "2026-08-04",
      experimentEnd: "2026-08-10",
      status: "running"
    };
    const overlap = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/experiments",
      headers: { cookie },
      payload: {
        ...base,
        baselineEnd: "2026-08-05"
      }
    });
    assert.equal(overlap.statusCode, 409, overlap.body);
    assert.equal(overlap.json().code, "nutrition_experiment_windows_overlap");
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM nutrition_experiments")
          .get() as { count: number }
      ).count,
      0
    );

    const invalidDate = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/experiments",
      headers: { cookie },
      payload: {
        ...base,
        baselineStart: "2026-02-30"
      }
    });
    assert.equal(invalidDate.statusCode, 400, invalidDate.body);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/experiments",
      headers: { cookie },
      payload: base
    });
    assert.equal(created.statusCode, 201, created.body);
    const experimentId = (created.json() as { experiment: { id: string } })
      .experiment.id;

    const conclusionOnly = await app.inject({
      method: "PATCH",
      url: `/api/v1/health/weight-loss/experiments/${experimentId}`,
      headers: { cookie },
      payload: {
        status: "completed",
        conclusion: "Energy appeared better."
      }
    });
    assert.equal(conclusionOnly.statusCode, 409, conclusionOnly.body);
    assert.equal(
      conclusionOnly.json().code,
      "nutrition_experiment_evidence_insufficient"
    );

    const baselineSparse = await app.inject({
      method: "PATCH",
      url: `/api/v1/health/weight-loss/experiments/${experimentId}`,
      headers: { cookie },
      payload: {
        status: "completed",
        conclusion:
          "Energy improved, but interpretation remains limited by adherence.",
        adherence: {
          plannedExposures: 3,
          completedExposures: 2,
          baselineObservationCount: 1,
          interventionObservationCount: 2,
          notes: "One session was missed."
        }
      }
    });
    assert.equal(baselineSparse.statusCode, 409, baselineSparse.body);
    assert.equal(baselineSparse.json().baselineObservations, 1);

    const missingPlan = await app.inject({
      method: "PATCH",
      url: `/api/v1/health/weight-loss/experiments/${experimentId}`,
      headers: { cookie },
      payload: {
        status: "completed",
        conclusion: "Energy improved in both observations.",
        adherence: {
          completedExposures: 1,
          baselineObservationCount: 2,
          interventionObservationCount: 2
        }
      }
    });
    assert.equal(missingPlan.statusCode, 409, missingPlan.body);
    assert.equal(missingPlan.json().plannedExposures, 0);

    const initialAdherence = await app.inject({
      method: "PATCH",
      url: `/api/v1/health/weight-loss/experiments/${experimentId}`,
      headers: { cookie },
      payload: {
        adherence: {
          plannedExposures: 3,
          completedExposures: 2,
          baselineObservationCount: 2,
          notes: "One planned exposure was missed."
        }
      }
    });
    assert.equal(initialAdherence.statusCode, 200, initialAdherence.body);

    const mergedAdherence = await app.inject({
      method: "PATCH",
      url: `/api/v1/health/weight-loss/experiments/${experimentId}`,
      headers: { cookie },
      payload: {
        adherence: { interventionObservationCount: 2 }
      }
    });
    assert.equal(mergedAdherence.statusCode, 200, mergedAdherence.body);
    assert.deepEqual(mergedAdherence.json().experiment.adherence, {
      plannedExposures: 3,
      completedExposures: 2,
      baselineObservationCount: 2,
      interventionObservationCount: 2,
      notes: "One planned exposure was missed."
    });

    const completed = await app.inject({
      method: "PATCH",
      url: `/api/v1/health/weight-loss/experiments/${experimentId}`,
      headers: { cookie },
      payload: {
        status: "completed",
        conclusion:
          "Energy was higher in both intervention observations, but one planned exposure was missed; repeat before treating the result as stable."
      }
    });
    assert.equal(completed.statusCode, 200, completed.body);
    const experiment = (
      completed.json() as {
        experiment: {
          status: string;
          conclusion: string;
          adherence: Record<string, unknown>;
          baselineEnd: string;
          experimentStart: string;
        };
      }
    ).experiment;
    assert.equal(experiment.status, "completed");
    assert.match(experiment.conclusion, /repeat before treating/i);
    assert.deepEqual(experiment.adherence, {
      plannedExposures: 3,
      completedExposures: 2,
      baselineObservationCount: 2,
      interventionObservationCount: 2,
      notes: "One planned exposure was missed."
    });
    assert.equal(experiment.baselineEnd, "2026-08-03");
    assert.equal(experiment.experimentStart, "2026-08-04");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
