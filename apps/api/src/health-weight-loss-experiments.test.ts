import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";

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

test("nutrition experiment contract preserves agent fields across API surfaces", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-nutrition-experiment-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const openApiResponse = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json"
    });
    assert.equal(openApiResponse.statusCode, 200);
    const openApi = openApiResponse.json() as {
      components: {
        schemas: Record<
          string,
          {
            additionalProperties?: boolean;
            properties?: Record<string, unknown>;
          }
        >;
      };
      paths: Record<
        string,
        {
          post?: {
            parameters?: Array<{ name?: string }>;
            requestBody?: unknown;
          };
          patch?: {
            parameters?: Array<{ name?: string }>;
            requestBody?: unknown;
          };
        }
      >;
    };
    assert.equal(
      openApi.components.schemas.NutritionExperiment.additionalProperties,
      false
    );
    assert.equal(
      openApi.components.schemas.NutritionExperimentInput.additionalProperties,
      false
    );
    assert.equal(
      openApi.components.schemas.NutritionExperimentPatchInput
        .additionalProperties,
      false
    );
    assert.ok(
      openApi.components.schemas.NutritionExperimentInput.properties?.metricKey
    );
    assert.equal(
      openApi.components.schemas.NutritionExperimentPatchInput.properties
        ?.userId,
      undefined
    );
    assert.ok(
      openApi.paths["/api/v1/health/weight-loss/experiments"].post?.requestBody
    );
    assert.ok(
      openApi.paths[
        "/api/v1/health/weight-loss/experiments"
      ].post?.parameters?.some((parameter) => parameter.name === "userIds")
    );
    assert.ok(
      openApi.paths[
        "/api/v1/health/weight-loss/experiments/{id}"
      ].patch?.parameters?.some((parameter) => parameter.name === "id")
    );

    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/experiments?userIds=user_forge_bot",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Carbohydrates before kickboxing",
        hypothesis:
          "Pre-training carbohydrates improve performance without more bloating",
        metricKey: "workoutPerformance",
        intervention: "Eat 60 g carbohydrates two hours before training",
        baselineStart: "2026-07-01",
        baselineEnd: "2026-07-07",
        experimentStart: "2026-07-08",
        experimentEnd: "2026-07-21",
        status: "running",
        successCriteria: "Performance improves by at least one point",
        confounders: ["sleep", "training intensity"]
      }
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = (
      createdResponse.json() as { experiment: Record<string, unknown> }
    ).experiment;
    assert.equal(created.userId, "user_forge_bot");
    assert.equal(
      created.hypothesis,
      "Pre-training carbohydrates improve performance without more bloating"
    );
    assert.equal(created.metricKey, "workoutPerformance");
    assert.equal(
      created.intervention,
      "Eat 60 g carbohydrates two hours before training"
    );
    assert.equal(created.experimentStart, "2026-07-08");
    assert.equal(created.experimentEnd, "2026-07-21");
    assert.equal(created.status, "running");
    assert.equal(
      created.successCriteria,
      "Performance improves by at least one point"
    );
    assert.deepEqual(created.confounders, ["sleep", "training intensity"]);
    assert.deepEqual(created.trackedOutcomes, ["workoutPerformance"]);

    const pausedResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/experiments",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Paused compatibility experiment",
        status: "paused"
      }
    });
    assert.equal(pausedResponse.statusCode, 201);
    assert.equal(
      (pausedResponse.json() as { experiment: { status: string } }).experiment
        .status,
      "paused"
    );

    const patchedResponse = await app.inject({
      method: "PATCH",
      url:
        `/api/v1/health/weight-loss/experiments/${String(created.id)}` +
        "?userIds=user_forge_bot",
      headers: { cookie: operatorCookie },
      payload: {
        status: "complete",
        metricKey: "sleepQuality",
        conclusion:
          "The intervention improved training but reduced sleep quality"
      }
    });
    assert.equal(patchedResponse.statusCode, 200);
    const patched = (
      patchedResponse.json() as { experiment: Record<string, unknown> }
    ).experiment;
    assert.equal(patched.status, "completed");
    assert.equal(patched.metricKey, "sleepQuality");
    assert.deepEqual(patched.trackedOutcomes, ["sleepQuality"]);
    assert.equal(
      patched.conclusion,
      "The intervention improved training but reduced sleep quality"
    );
    assert.equal(patched.hypothesis, created.hypothesis);
    assert.equal(patched.intervention, created.intervention);
    assert.deepEqual(patched.confounders, created.confounders);

    const patternsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/weight-loss/patterns?userIds=user_forge_bot"
    });
    assert.equal(patternsResponse.statusCode, 200);
    const patterns = patternsResponse.json() as {
      experiments: Array<Record<string, unknown>>;
    };
    const listed = patterns.experiments.find(
      (experiment) => experiment.id === created.id
    );
    assert.ok(listed);
    assert.equal(listed.metricKey, "sleepQuality");
    assert.equal(listed.status, "completed");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
