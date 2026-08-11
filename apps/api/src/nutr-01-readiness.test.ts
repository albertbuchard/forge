import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("NUTR-01 replays an uncertain food-log submission without duplicating the meal or catalog food", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-nutr-01-"));
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const idempotencyKey = "nutr-01-uncertain-response";
    const payload = {
      loggedAt: "2026-08-11T12:15:00.000Z",
      dayKey: "2026-08-11",
      timeZone: "Europe/Zurich",
      mealLabel: "Lunch",
      source: "manual",
      confirmationState: "confirmed",
      notes: "Submitted once even if the response is lost.",
      items: [
        {
          name: "Recovery rice bowl",
          quantity: 1,
          unit: "bowl",
          calories: 610,
          proteinGrams: 34,
          carbohydrateGrams: 82,
          fatGrams: 16,
          confidence: 0.9
        }
      ]
    };

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/food-logs",
      headers: { cookie, "idempotency-key": idempotencyKey },
      payload
    });
    assert.equal(create.statusCode, 201, create.body);
    assert.equal(create.headers["idempotency-replayed"], undefined);
    const createdLog = (
      create.json() as { log: { id: string; items: Array<{ foodId: string }> } }
    ).log;
    assert.ok(createdLog.items[0]?.foodId);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/food-logs",
      headers: { cookie, "idempotency-key": idempotencyKey },
      payload
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.headers["idempotency-replayed"], "true");
    assert.deepEqual(replay.json(), create.json());

    const changedPayload = await app.inject({
      method: "POST",
      url: "/api/v1/health/weight-loss/food-logs",
      headers: { cookie, "idempotency-key": idempotencyKey },
      payload: { ...payload, mealLabel: "Changed lunch" }
    });
    assert.equal(changedPayload.statusCode, 409, changedPayload.body);
    assert.equal(
      (changedPayload.json() as { code: string }).code,
      "idempotency_conflict"
    );

    const mealCount = getDatabase()
      .prepare(`SELECT COUNT(*) AS count FROM nutrition_food_logs`)
      .get() as { count: number };
    const itemCount = getDatabase()
      .prepare(`SELECT COUNT(*) AS count FROM nutrition_meal_items`)
      .get() as { count: number };
    const customFoodCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM nutrition_food_catalog
         WHERE source = 'custom' AND name = 'Recovery rice bowl'`
      )
      .get() as { count: number };
    const receiptCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM nutrition_mutation_idempotency
         WHERE operation = 'food_log.create'
           AND idempotency_key = ?`
      )
      .get(idempotencyKey) as { count: number };

    assert.deepEqual(
      {
        meals: mealCount.count,
        items: itemCount.count,
        customFoods: customFoodCount.count,
        receipts: receiptCount.count
      },
      { meals: 1, items: 1, customFoods: 1, receipts: 1 }
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
