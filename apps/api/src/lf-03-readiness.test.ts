import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
] as const;

function readTemplate(userId: string, weekday: number) {
  return getDatabase()
    .prepare(
      `SELECT points_json
       FROM life_force_weekday_templates
       WHERE user_id = ? AND weekday = ?`
    )
    .get(userId, weekday) as { points_json: string };
}

async function issueScopedToken(input: {
  app: Awaited<ReturnType<typeof buildServer>>;
  cookie: string;
  label: string;
  userIds: string[];
}) {
  const response = await input.app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie: input.cookie },
    payload: {
      label: input.label,
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

test("LF-03 maps every named weekday, enforces ownership, and refreshes today's curve", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-lf-03-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const operatorHeaders = { cookie };
    for (const userId of ["user_operator", "user_forge_bot"]) {
      const overview = await app.inject({
        method: "GET",
        url: `/api/v1/life-force?userId=${userId}`,
        headers: operatorHeaders
      });
      assert.equal(overview.statusCode, 200);
    }
    const currentWeekday = new Date().getUTCDay();
    const currentDateKey = new Date().toISOString().slice(0, 10);
    const initialCurrentSnapshot = getDatabase()
      .prepare(
        `SELECT points_json
         FROM life_force_day_snapshots
         WHERE user_id = ? AND date_key = ?`
      )
      .get("user_forge_bot", currentDateKey) as { points_json: string };

    const operatorTemplatesBefore = WEEKDAYS.map(
      (_, weekday) => readTemplate("user_operator", weekday).points_json
    );
    const botToken = await issueScopedToken({
      app,
      cookie,
      label: "LF-03 bot weekdays",
      userIds: ["user_forge_bot"]
    });

    for (const [weekday, name] of WEEKDAYS.entries()) {
      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/life-force/templates/${name}`,
        headers: { authorization: `Bearer ${botToken}` },
        payload: {
          points: [
            { minuteOfDay: 0, rateApPerHour: weekday + 1 },
            { minuteOfDay: 720, rateApPerHour: weekday + 3 },
            { minuteOfDay: 1440, rateApPerHour: weekday + 2 }
          ]
        }
      });
      assert.equal(response.statusCode, 200, `${name}: ${response.body}`);
      const body = response.json() as {
        weekday: number;
        points: Array<{ minuteOfDay: number; rateApPerHour: number }>;
        actor: string;
      };
      assert.equal(body.weekday, weekday);
      assert.ok(body.actor.length > 0);
      assert.deepEqual(
        JSON.parse(readTemplate("user_forge_bot", weekday).points_json),
        body.points
      );
    }

    assert.deepEqual(
      WEEKDAYS.map(
        (_, weekday) => readTemplate("user_operator", weekday).points_json
      ),
      operatorTemplatesBefore
    );

    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM life_force_day_snapshots
             WHERE user_id = ? AND date_key = ?`
          )
          .get("user_forge_bot", currentDateKey) as { count: number }
      ).count,
      0
    );
    const refreshedOverview = await app.inject({
      method: "GET",
      url: "/api/v1/life-force?userId=user_forge_bot",
      headers: operatorHeaders
    });
    assert.equal(refreshedOverview.statusCode, 200);
    const refreshedCurrentSnapshot = getDatabase()
      .prepare(
        `SELECT points_json
         FROM life_force_day_snapshots
         WHERE user_id = ? AND date_key = ?`
      )
      .get("user_forge_bot", currentDateKey) as { points_json: string };
    assert.notEqual(
      refreshedCurrentSnapshot.points_json,
      initialCurrentSnapshot.points_json
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM life_force_day_snapshots
             WHERE user_id = ? AND date_key = ?`
          )
          .get("user_forge_bot", currentDateKey) as { count: number }
      ).count,
      1
    );

    const numericWeekday = await app.inject({
      method: "PUT",
      url: `/api/v1/life-force/templates/${currentWeekday}`,
      headers: { authorization: `Bearer ${botToken}` },
      payload: {
        points: [
          { minuteOfDay: 0, rateApPerHour: 1 },
          { minuteOfDay: 1440, rateApPerHour: 1 }
        ]
      }
    });
    assert.equal(numericWeekday.statusCode, 200);
    assert.equal(numericWeekday.json().weekday, currentWeekday);
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM life_force_day_snapshots
             WHERE user_id = ? AND date_key = ?`
          )
          .get("user_forge_bot", currentDateKey) as { count: number }
      ).count,
      0
    );

    const botTemplatesBeforeInvalid = WEEKDAYS.map(
      (_, weekday) => readTemplate("user_forge_bot", weekday).points_json
    );
    for (const invalidWeekday of ["-1", "7", "1.5", "mondayy"]) {
      const response = await app.inject({
        method: "PUT",
        url: `/api/v1/life-force/templates/${invalidWeekday}`,
        headers: operatorHeaders,
        payload: {
          points: [
            { minuteOfDay: 0, rateApPerHour: 1 },
            { minuteOfDay: 1440, rateApPerHour: 1 }
          ]
        }
      });
      assert.equal(response.statusCode, 400, invalidWeekday);
    }
    assert.deepEqual(
      WEEKDAYS.map(
        (_, weekday) => readTemplate("user_forge_bot", weekday).points_json
      ),
      botTemplatesBeforeInvalid
    );

    const operatorToken = await issueScopedToken({
      app,
      cookie,
      label: "LF-03 operator only",
      userIds: ["user_operator"]
    });
    const deniedCrossOwnerWrite = await app.inject({
      method: "PUT",
      url: "/api/v1/life-force/templates/monday?userId=user_forge_bot",
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        points: [
          { minuteOfDay: 0, rateApPerHour: 1 },
          { minuteOfDay: 1440, rateApPerHour: 1 }
        ]
      }
    });
    assert.equal(deniedCrossOwnerWrite.statusCode, 403);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
