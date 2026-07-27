import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

async function issueScopedToken(input: {
  app: Awaited<ReturnType<typeof buildServer>>;
  cookie: string;
  userIds: string[];
}) {
  const response = await input.app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie: input.cookie },
    payload: {
      label: "Nutrition mutation scope test",
      scopes: ["read", "write"],
      scopePolicy: {
        userIds: input.userIds,
        projectIds: [],
        tagIds: []
      }
    }
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { token: { token: string } }).token.token;
}

test("nutrition mutations consistently write to the selected non-default user", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-nutrition-selected-user-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const headers = { cookie };
    const selected = "?userIds=user_forge_bot";

    const openApiResponse = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json",
      headers
    });
    assert.equal(openApiResponse.statusCode, 200);
    const openApi = openApiResponse.json() as {
      paths: Record<
        string,
        {
          post?: { parameters?: Array<{ name?: string; in?: string }> };
        }
      >;
    };
    for (const route of [
      "body-checkins",
      "appearance-checkins",
      "subjective-checkins",
      "gut-checkins"
    ]) {
      const parameters =
        openApi.paths[`/api/v1/health/weight-loss/${route}`]?.post
          ?.parameters ?? [];
      assert.ok(
        parameters.some(
          (parameter) =>
            parameter.name === "userIds" && parameter.in === "query"
        ),
        route
      );
      assert.ok(
        parameters.some(
          (parameter) =>
            parameter.name === "Idempotency-Key" && parameter.in === "header"
        ),
        route
      );
    }

    const target = await app.inject({
      method: "PATCH",
      url: `/api/v1/health/weight-loss/target${selected}`,
      headers,
      payload: { calorieTarget: 2300, bodyGoal: "Fuel training" }
    });
    assert.equal(target.statusCode, 200);
    assert.equal(
      (target.json() as { target: { userId: string } }).target.userId,
      "user_forge_bot"
    );

    const activeCalories = await app.inject({
      method: "PATCH",
      url: `/api/v1/health/weight-loss/daily-active-calories${selected}`,
      headers,
      payload: { dayKey: "2026-07-11", activeCaloriesKcal: 540 }
    });
    assert.equal(activeCalories.statusCode, 200);
    assert.equal(
      (
        activeCalories.json() as {
          override: { userId: string };
        }
      ).override.userId,
      "user_forge_bot"
    );

    const foodLog = await app.inject({
      method: "POST",
      url: `/api/v1/health/weight-loss/food-logs${selected}`,
      headers,
      payload: {
        loggedAt: "2026-07-11T08:00:00.000Z",
        mealLabel: "Scoped breakfast",
        items: [
          {
            name: "Oats",
            quantity: 80,
            unit: "g",
            calories: 300,
            proteinGrams: 10,
            carbohydrateGrams: 50,
            fatGrams: 6
          }
        ]
      }
    });
    assert.equal(foodLog.statusCode, 201);
    const foodLogBody = foodLog.json() as {
      log: { id: string; userId: string };
    };
    assert.equal(foodLogBody.log.userId, "user_forge_bot");

    const checkins = [
      ["body-checkins", { weightKg: 78.4 }],
      ["appearance-checkins", { leanness: 7 }],
      ["subjective-checkins", { energy: 8 }],
      ["gut-checkins", { bloating: 2 }]
    ] as const;
    for (const [route, payload] of checkins) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/health/weight-loss/${route}${selected}`,
        headers,
        payload
      });
      assert.equal(response.statusCode, 201, route);
      assert.equal(
        (response.json() as { checkin: { userId: string } }).checkin.userId,
        "user_forge_bot",
        route
      );
    }

    const experiment = await app.inject({
      method: "POST",
      url: `/api/v1/health/weight-loss/experiments${selected}`,
      headers,
      payload: { title: "Scoped experiment" }
    });
    assert.equal(experiment.statusCode, 201);
    assert.equal(
      (
        experiment.json() as {
          experiment: { userId: string };
        }
      ).experiment.userId,
      "user_forge_bot"
    );

    for (const table of [
      "nutrition_targets",
      "nutrition_daily_energy_overrides",
      "nutrition_food_logs",
      "nutrition_body_checkins",
      "nutrition_appearance_checkins",
      "nutrition_subjective_checkins",
      "nutrition_gut_checkins",
      "nutrition_experiments"
    ]) {
      const row = getDatabase()
        .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ?`)
        .get("user_forge_bot") as { count: number };
      assert.ok(row.count >= 1, table);
    }

    const crossUserMealLink = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/subjective-checkins?userIds=user_operator",
      headers,
      payload: { mealLogId: foodLogBody.log.id, energy: 5 }
    });
    assert.equal(crossUserMealLink.statusCode, 400);
    assert.equal(
      (crossUserMealLink.json() as { code: string }).code,
      "nutrition_meal_owner_mismatch"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("nutrition mutations enforce token user scope and reject ambiguous ownership", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-nutrition-token-scope-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const token = await issueScopedToken({
      app,
      cookie,
      userIds: ["user_forge_bot"]
    });
    const tokenHeaders = { authorization: `Bearer ${token}` };

    const implicitScopedUser = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/body-checkins",
      headers: tokenHeaders,
      payload: { weightKg: 77.2 }
    });
    assert.equal(implicitScopedUser.statusCode, 201);
    assert.equal(
      (
        implicitScopedUser.json() as {
          checkin: { userId: string };
        }
      ).checkin.userId,
      "user_forge_bot"
    );

    for (const request of [
      {
        url: "/api/v1/health/weight-loss/body-checkins?userIds=user_operator",
        payload: { weightKg: 80 }
      },
      {
        url: "/api/v1/health/weight-loss/appearance-checkins",
        payload: { userId: "user_operator", leanness: 6 }
      }
    ]) {
      const response = await app.inject({
        method: "POST",
        url: request.url,
        headers: tokenHeaders,
        payload: request.payload
      });
      assert.equal(response.statusCode, 403);
      assert.equal(
        (response.json() as { code: string }).code,
        "user_scope_forbidden"
      );
    }

    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/gut-checkins?userIds=user_forge_bot",
      headers: { cookie },
      payload: { userId: "user_operator", bloating: 3 }
    });
    assert.equal(conflict.statusCode, 400);
    assert.equal(
      (conflict.json() as { code: string }).code,
      "nutrition_user_selection_conflict"
    );

    const ambiguous = await app.inject({
      method: "POST",
      url:
        "/api/v1/health/weight-loss/gut-checkins" +
        "?userIds=user_operator&userIds=user_forge_bot",
      headers: { cookie },
      payload: { bloating: 3 }
    });
    assert.equal(ambiguous.statusCode, 400);
    assert.equal(
      (ambiguous.json() as { code: string }).code,
      "nutrition_user_selection_ambiguous"
    );

    const operatorFoodLog = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/food-logs",
      headers: { cookie },
      payload: {
        mealLabel: "Operator meal",
        items: [
          {
            name: "Rice",
            quantity: 1,
            calories: 200,
            proteinGrams: 4,
            carbohydrateGrams: 44,
            fatGrams: 1
          }
        ]
      }
    });
    assert.equal(operatorFoodLog.statusCode, 201);
    const operatorFoodLogId = (
      operatorFoodLog.json() as { log: { id: string } }
    ).log.id;
    const outOfScopePatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/health/weight-loss/food-logs/${operatorFoodLogId}`,
      headers: tokenHeaders,
      payload: { notes: "Must not be written" }
    });
    assert.equal(outOfScopePatch.statusCode, 404);
    assert.equal(
      (outOfScopePatch.json() as { code: string }).code,
      "nutrition_record_not_found"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("check-in idempotency survives a committed response loss without duplicates", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-nutrition-idempotency-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const headers = {
      cookie,
      "idempotency-key": "checkin-batch-2026-07-11:body"
    };
    const payload = {
      checkedAt: "2026-07-11T07:00:00.000Z",
      weightKg: 78.1,
      waistCm: 84
    };

    const committedResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/body-checkins",
      headers,
      payload
    });
    assert.equal(committedResponse.statusCode, 201);
    const original = committedResponse.json() as {
      checkin: { id: string };
    };

    // The caller can lose the first response after commit and retry unchanged.
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/body-checkins",
      headers,
      payload
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.headers["idempotency-replayed"], "true");
    assert.equal(
      (replay.json() as { checkin: { id: string } }).checkin.id,
      original.checkin.id
    );

    const count = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM nutrition_body_checkins
         WHERE user_id = 'user_operator' AND checked_at = ?`
      )
      .get(payload.checkedAt) as { count: number };
    assert.equal(count.count, 1);

    const conflictingReplay = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/body-checkins",
      headers,
      payload: { ...payload, weightKg: 79.2 }
    });
    assert.equal(conflictingReplay.statusCode, 409);
    assert.equal(
      (conflictingReplay.json() as { code: string }).code,
      "idempotency_conflict"
    );

    const sameKeyDifferentDomain = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/gut-checkins",
      headers,
      payload: { checkedAt: payload.checkedAt, bloating: 2 }
    });
    assert.equal(sameKeyDifferentDomain.statusCode, 201);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
