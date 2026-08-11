import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

type ProfileRow = {
  base_daily_ap: number;
  readiness_multiplier: number;
  life_force_level: number;
  activation_level: number;
  focus_level: number;
  vigor_level: number;
  composure_level: number;
  flow_level: number;
};

function readProfile(userId: string) {
  return getDatabase()
    .prepare(
      `SELECT base_daily_ap, readiness_multiplier, life_force_level,
              activation_level, focus_level, vigor_level,
              composure_level, flow_level
       FROM life_force_profiles
       WHERE user_id = ?`
    )
    .get(userId) as ProfileRow;
}

async function issueScopedToken(input: {
  app: Awaited<ReturnType<typeof buildServer>>;
  cookie: string;
  label: string;
  userIds?: string[];
  projectIds?: string[];
}) {
  const response = await input.app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie: input.cookie },
    payload: {
      label: input.label,
      scopes: ["read", "write"],
      scopePolicy: {
        userIds: input.userIds ?? [],
        projectIds: input.projectIds ?? [],
        tagIds: []
      }
    }
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { token: { token: string } }).token.token;
}

test("LF-02 keeps partial profile updates owner-scoped, bounded, and atomic", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-lf-02-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const operatorHeaders = { cookie };

    for (const userId of ["user_operator", "user_forge_bot"]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/life-force?userId=${userId}`,
        headers: operatorHeaders
      });
      assert.equal(response.statusCode, 200);
    }

    const botBefore = readProfile("user_forge_bot");
    const botToken = await issueScopedToken({
      app,
      cookie,
      label: "LF-02 bot only",
      userIds: ["user_forge_bot"]
    });
    const botPatch = await app.inject({
      method: "PATCH",
      url: "/api/v1/life-force/profile",
      headers: { authorization: `Bearer ${botToken}` },
      payload: {
        baseDailyAp: 50,
        readinessMultiplier: 0.5,
        stats: { focus: 1 }
      }
    });
    assert.equal(botPatch.statusCode, 200, botPatch.body);
    const botPatchBody = botPatch.json() as {
      lifeForce: {
        userId: string;
        baselineDailyAp: number;
        readinessMultiplier: number;
        stats: Array<{ key: string; level: number }>;
      };
    };
    assert.equal(botPatchBody.lifeForce.userId, "user_forge_bot");
    assert.equal(botPatchBody.lifeForce.baselineDailyAp, 50);
    assert.equal(botPatchBody.lifeForce.readinessMultiplier, 0.5);
    const botAfterPartial = readProfile("user_forge_bot");
    assert.equal(botAfterPartial.focus_level, 1);
    assert.equal(botAfterPartial.life_force_level, botBefore.life_force_level);
    assert.equal(botAfterPartial.activation_level, botBefore.activation_level);
    assert.equal(botAfterPartial.vigor_level, botBefore.vigor_level);
    assert.equal(botAfterPartial.composure_level, botBefore.composure_level);
    assert.equal(botAfterPartial.flow_level, botBefore.flow_level);
    assert.equal(
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count
           FROM life_force_day_snapshots
           WHERE user_id = ?`
        )
        .get("user_forge_bot")?.count,
      1
    );

    const operatorBeforeDeniedWrite = readProfile("user_operator");
    const deniedOtherUser = await app.inject({
      method: "PATCH",
      url: "/api/v1/life-force/profile?userId=user_operator",
      headers: { authorization: `Bearer ${botToken}` },
      payload: { baseDailyAp: 51 }
    });
    assert.equal(deniedOtherUser.statusCode, 403);
    assert.deepEqual(readProfile("user_operator"), operatorBeforeDeniedWrite);

    const multiUserToken = await issueScopedToken({
      app,
      cookie,
      label: "LF-02 explicit selection",
      userIds: ["user_operator", "user_forge_bot"]
    });
    const missingSelection = await app.inject({
      method: "PATCH",
      url: "/api/v1/life-force/profile",
      headers: { authorization: `Bearer ${multiUserToken}` },
      payload: { baseDailyAp: 52 }
    });
    assert.equal(missingSelection.statusCode, 400);

    const projectToken = await issueScopedToken({
      app,
      cookie,
      label: "LF-02 project restricted",
      projectIds: ["project_forge"]
    });
    const deniedProjectScope = await app.inject({
      method: "PATCH",
      url: "/api/v1/life-force/profile",
      headers: { authorization: `Bearer ${projectToken}` },
      payload: { baseDailyAp: 53 }
    });
    assert.equal(deniedProjectScope.statusCode, 403);

    const unknownUser = await app.inject({
      method: "PATCH",
      url: "/api/v1/life-force/profile?userId=user_missing",
      headers: operatorHeaders,
      payload: { baseDailyAp: 54 }
    });
    assert.equal(unknownUser.statusCode, 404);
    assert.deepEqual(readProfile("user_operator"), operatorBeforeDeniedWrite);

    for (const payload of [
      {},
      { stats: {} },
      { unsupported: true },
      { baseDailyAp: 49 },
      { baseDailyAp: 501 },
      { baseDailyAp: 50.5 },
      { readinessMultiplier: 0.49 },
      { readinessMultiplier: 1.51 },
      { stats: { flow: 0 } },
      { stats: { flow: 101 } }
    ]) {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/v1/life-force/profile?userId=user_forge_bot",
        headers: operatorHeaders,
        payload
      });
      assert.equal(response.statusCode, 400, JSON.stringify(payload));
      assert.deepEqual(readProfile("user_forge_bot"), botAfterPartial);
    }

    const upperBounds = await app.inject({
      method: "PATCH",
      url: "/api/v1/life-force/profile?userId=user_forge_bot",
      headers: operatorHeaders,
      payload: {
        baseDailyAp: 500,
        readinessMultiplier: 1.5,
        stats: { flow: 100 }
      }
    });
    assert.equal(upperBounds.statusCode, 200);
    assert.equal(readProfile("user_forge_bot").flow_level, 100);

    const beforeAtomicFailure = readProfile("user_forge_bot");
    getDatabase().exec(
      `CREATE TRIGGER lf_02_snapshot_delete_failure
       BEFORE DELETE ON life_force_day_snapshots
       WHEN OLD.user_id = 'user_forge_bot'
       BEGIN
         SELECT RAISE(ABORT, 'lf_02_snapshot_delete_failure');
       END;`
    );
    const atomicFailure = await app.inject({
      method: "PATCH",
      url: "/api/v1/life-force/profile?userId=user_forge_bot",
      headers: operatorHeaders,
      payload: { baseDailyAp: 499 }
    });
    assert.equal(atomicFailure.statusCode, 500);
    assert.deepEqual(readProfile("user_forge_bot"), beforeAtomicFailure);
    getDatabase().exec("DROP TRIGGER lf_02_snapshot_delete_failure");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
