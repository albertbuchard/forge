import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { buildOpenApiDocument } from "./openapi.js";
import { createTag } from "./repositories/tags.js";

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

async function issueReadToken(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  userId: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label: "Gamification route test",
      agentLabel: "Gamification test agent",
      scopes: ["read"],
      scopePolicy: { userIds: [userId], projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { token: { token: string } }).token.token;
}

async function issueScopedRewardToken(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  input: {
    userIds: string[];
    projectIds?: string[];
    tagIds?: string[];
    scopes?: string[];
  }
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label: "Scoped reward mutation test",
      agentLabel: "Scoped reward test agent",
      scopes: input.scopes ?? ["read", "write", "rewards.manage"],
      scopePolicy: {
        userIds: input.userIds,
        projectIds: input.projectIds ?? [],
        tagIds: input.tagIds ?? []
      }
    }
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { token: { token: string } }).token.token;
}

function gamificationWriteCounts() {
  const database = getDatabase();
  const count = (table: string) =>
    (
      database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count: number;
      }
    ).count;
  return {
    tasks: count("tasks"),
    workAdjustments: count("work_adjustments"),
    rules: count("reward_rules"),
    rewards: count("reward_ledger"),
    events: count("event_log"),
    dailyActivity: count("gamification_daily_activity"),
    unlocks: count("gamification_item_unlocks"),
    celebrations: count("gamification_celebrations")
  };
}

test("XP metrics enforce token user scope and publish the applied timezone", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-xp-route-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/xp"
    });
    assert.equal(anonymous.statusCode, 401);

    const cookie = await issueOperatorSessionCookie(app);
    const token = await issueReadToken(app, cookie, "user_forge_bot");
    const headers = { authorization: `Bearer ${token}` };

    const allowed = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/xp?timezone=Europe%2FZurich",
      headers
    });
    assert.equal(allowed.statusCode, 200);
    const metrics = allowed.json().metrics as {
      timezone: string;
      scope: { userIds: string[] };
      recentLedger: unknown[];
    };
    assert.equal(metrics.timezone, "Europe/Zurich");
    assert.deepEqual(metrics.scope.userIds, ["user_forge_bot"]);
    assert.ok(metrics.recentLedger.length <= 25);

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/xp?userIds=user_operator",
      headers
    });
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.json().code, "user_scope_forbidden");

    const invalidTimezone = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/xp?timezone=Not%2FA_Timezone",
      headers
    });
    assert.equal(invalidTimezone.statusCode, 400);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("all gamification reads require read auth, enforce scope, and stay pure", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-game-read-route-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const routes = [
      "/api/v1/metrics",
      "/api/v1/gamification/catalog",
      "/api/v1/gamification/equipment"
    ];
    for (const url of routes) {
      const anonymous = await app.inject({ method: "GET", url });
      assert.equal(anonymous.statusCode, 401, url);
    }

    const cookie = await issueOperatorSessionCookie(app);
    const token = await issueReadToken(app, cookie, "user_forge_bot");
    const headers = { authorization: `Bearer ${token}` };
    const database = getDatabase();
    database
      .prepare(
        `INSERT INTO reward_ledger (
           id, rule_id, event_log_id, entity_type, entity_id, actor, source,
           delta_xp, reason_title, reason_summary, reversible_group,
           reversed_by_reward_id, metadata_json, created_at
         ) VALUES (?, NULL, NULL, 'system', ?, 'test', 'system', 5, ?, '', NULL, NULL, ?, ?)`
      )
      .run(
        "rwd_pure_read_probe",
        "pure_read_probe",
        "Pure read probe",
        JSON.stringify({
          ownerUserId: "user_forge_bot",
          qualifiesForStreak: true
        }),
        new Date().toISOString()
      );
    database.prepare("DELETE FROM gamification_daily_activity").run();
    database.prepare("DELETE FROM gamification_item_unlocks").run();
    database.prepare("DELETE FROM gamification_celebrations").run();
    database.prepare("DELETE FROM reward_rules").run();
    const before = gamificationWriteCounts();

    const anonymousAssets = await app.inject({
      method: "GET",
      url: "/api/v1/gamification/assets"
    });
    assert.equal(anonymousAssets.statusCode, 401);
    const allowedAssets = await app.inject({
      method: "GET",
      url: "/api/v1/gamification/assets",
      headers
    });
    assert.equal(allowedAssets.statusCode, 200);

    for (const url of routes) {
      const allowed = await app.inject({
        method: "GET",
        url: `${url}?timezone=Pacific%2FHonolulu`,
        headers
      });
      assert.equal(allowed.statusCode, 200, url);
      const forbidden = await app.inject({
        method: "GET",
        url: `${url}?userIds=user_operator`,
        headers
      });
      assert.equal(forbidden.statusCode, 403, url);
      assert.equal(forbidden.json().code, "user_scope_forbidden", url);
      const invalidTimezone = await app.inject({
        method: "GET",
        url: `${url}?timezone=Not%2FA_Timezone`,
        headers
      });
      assert.equal(invalidTimezone.statusCode, 400, url);
    }

    const anonymousReconcile = await app.inject({
      method: "POST",
      url: "/api/v1/gamification/reconcile",
      payload: { userIds: ["user_forge_bot"], timezone: "UTC" }
    });
    assert.equal(anonymousReconcile.statusCode, 401);
    const readOnlyReconcile = await app.inject({
      method: "POST",
      url: "/api/v1/gamification/reconcile",
      headers,
      payload: { userIds: ["user_forge_bot"], timezone: "UTC" }
    });
    assert.equal(readOnlyReconcile.statusCode, 403);

    const anonymousInstall = await app.inject({
      method: "POST",
      url: "/api/v1/gamification/assets/install",
      payload: { style: "dark-fantasy" }
    });
    assert.equal(anonymousInstall.statusCode, 401);
    const readOnlyInstall = await app.inject({
      method: "POST",
      url: "/api/v1/gamification/assets/install",
      headers,
      payload: { style: "dark-fantasy" }
    });
    assert.equal(readOnlyInstall.statusCode, 403);

    const anonymousEquipmentUpdate = await app.inject({
      method: "PUT",
      url: "/api/v1/gamification/equipment",
      payload: {}
    });
    assert.equal(anonymousEquipmentUpdate.statusCode, 401);
    const tokenEquipmentUpdate = await app.inject({
      method: "PUT",
      url: "/api/v1/gamification/equipment",
      headers,
      payload: {}
    });
    assert.equal(tokenEquipmentUpdate.statusCode, 403);
    const invalidEquipmentUpdate = await app.inject({
      method: "PUT",
      url: "/api/v1/gamification/equipment?timezone=Not%2FA_Timezone",
      headers: { cookie },
      payload: {}
    });
    assert.equal(invalidEquipmentUpdate.statusCode, 400);

    const anonymousLedger = await app.inject({
      method: "GET",
      url: "/api/v1/rewards/ledger"
    });
    assert.equal(anonymousLedger.statusCode, 401);
    const tokenLedger = await app.inject({
      method: "GET",
      url: "/api/v1/rewards/ledger",
      headers
    });
    assert.equal(tokenLedger.statusCode, 403);
    const invalidLedger = await app.inject({
      method: "GET",
      url: "/api/v1/rewards/ledger?limit=0",
      headers: { cookie }
    });
    assert.equal(invalidLedger.statusCode, 400);
    const allowedLedger = await app.inject({
      method: "GET",
      url: "/api/v1/rewards/ledger?limit=1",
      headers: { cookie }
    });
    assert.equal(allowedLedger.statusCode, 200);

    assert.deepEqual(gamificationWriteCounts(), before);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("celebration acknowledgement is operator-only and rejects tokens", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-game-celebration-auth-route-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const token = await issueReadToken(app, cookie, "user_forge_bot");
    const url = "/api/v1/gamification/celebrations/missing/seen";

    const anonymous = await app.inject({ method: "POST", url });
    assert.equal(anonymous.statusCode, 401);
    const tokenResponse = await app.inject({
      method: "POST",
      url,
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(tokenResponse.statusCode, 403);
    const operator = await app.inject({
      method: "POST",
      url,
      headers: { cookie }
    });
    assert.equal(operator.statusCode, 404);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("manual rewards derive and authorize the target owner and entity scope", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-game-bonus-route-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const targetTag = createTag({
      name: "Scoped reward target",
      kind: "category",
      color: "#71717a",
      description: "Adversarial route fixture",
      userId: "user_operator"
    });
    const target = { id: targetTag.id, user_id: "user_operator" };
    const otherUserId =
      target.user_id === "user_forge_bot" ? "user_operator" : "user_forge_bot";

    const otherUserToken = await issueScopedRewardToken(app, cookie, {
      userIds: [otherUserId]
    });
    const crossUserReconcile = await app.inject({
      method: "POST",
      url: "/api/v1/gamification/reconcile",
      headers: { authorization: `Bearer ${otherUserToken}` },
      payload: { userIds: [target.user_id], timezone: "UTC" }
    });
    assert.equal(crossUserReconcile.statusCode, 403);
    assert.equal(crossUserReconcile.json().code, "user_scope_forbidden");
    const basePayload = {
      entityType: "tag",
      entityId: target.id,
      deltaXp: 7,
      reasonTitle: "Scoped correction",
      reasonSummary: "Target ownership must come from Forge.",
      metadata: {
        idempotencyKey: "gamification-route-owner-test",
        ownerUserId: otherUserId,
        clientContext: "original"
      }
    };
    const crossUser = await app.inject({
      method: "POST",
      url: "/api/v1/rewards/bonus",
      headers: { authorization: `Bearer ${otherUserToken}` },
      payload: basePayload
    });
    assert.equal(crossUser.statusCode, 403);
    assert.equal(crossUser.json().code, "user_scope_forbidden");

    const wrongProjectToken = await issueScopedRewardToken(app, cookie, {
      userIds: [target.user_id],
      projectIds: ["project_outside_scope"]
    });
    const crossProject = await app.inject({
      method: "POST",
      url: "/api/v1/rewards/bonus",
      headers: { authorization: `Bearer ${wrongProjectToken}` },
      payload: basePayload
    });
    assert.equal(crossProject.statusCode, 403);
    assert.equal(crossProject.json().code, "project_scope_forbidden");

    const wrongTagToken = await issueScopedRewardToken(app, cookie, {
      userIds: [target.user_id],
      tagIds: ["tag_outside_scope"]
    });
    const crossTag = await app.inject({
      method: "POST",
      url: "/api/v1/rewards/bonus",
      headers: { authorization: `Bearer ${wrongTagToken}` },
      payload: basePayload
    });
    assert.equal(crossTag.statusCode, 403);
    assert.equal(crossTag.json().code, "tag_scope_forbidden");

    const allowedToken = await issueScopedRewardToken(app, cookie, {
      userIds: [target.user_id]
    });
    for (const [key, value] of Object.entries({
      manual: false,
      qualifiesForStreak: true,
      idempotencyFingerprint: "caller-controlled"
    })) {
      const reserved = await app.inject({
        method: "POST",
        url: "/api/v1/rewards/bonus",
        headers: { authorization: `Bearer ${allowedToken}` },
        payload: {
          ...basePayload,
          metadata: { ...basePayload.metadata, [key]: value }
        }
      });
      assert.equal(reserved.statusCode, 400, `${key}: ${reserved.body}`);
    }
    assert.equal(
      (
        getDatabase()
          .prepare(
            "SELECT COUNT(*) AS count FROM reward_ledger WHERE entity_type = 'tag' AND entity_id = ?"
          )
          .get(target.id) as { count: number }
      ).count,
      0
    );

    const allowed = await app.inject({
      method: "POST",
      url: "/api/v1/rewards/bonus",
      headers: { authorization: `Bearer ${allowedToken}` },
      payload: basePayload
    });
    assert.equal(allowed.statusCode, 201, allowed.body);
    const response = allowed.json() as {
      reward: {
        id: string;
        metadata: {
          ownerUserId?: string;
          manual?: boolean;
          qualifiesForStreak?: boolean;
          idempotencyFingerprint?: string;
        };
      };
      metrics: { scope: { userIds: string[] } };
    };
    assert.equal(response.reward.metadata.ownerUserId, target.user_id);
    assert.equal(response.reward.metadata.manual, true);
    assert.equal(response.reward.metadata.qualifiesForStreak, false);
    assert.equal(
      typeof response.reward.metadata.idempotencyFingerprint,
      "string"
    );
    assert.deepEqual(response.metrics.scope.userIds, [target.user_id]);

    const retried = await app.inject({
      method: "POST",
      url: "/api/v1/rewards/bonus",
      headers: { authorization: `Bearer ${allowedToken}` },
      payload: basePayload
    });
    assert.equal(retried.statusCode, 201, retried.body);
    assert.equal(
      (retried.json() as { reward: { id: string } }).reward.id,
      response.reward.id
    );

    const conflictingRetry = await app.inject({
      method: "POST",
      url: "/api/v1/rewards/bonus",
      headers: { authorization: `Bearer ${allowedToken}` },
      payload: {
        ...basePayload,
        metadata: { ...basePayload.metadata, clientContext: "changed" }
      }
    });
    assert.equal(conflictingRetry.statusCode, 409, conflictingRetry.body);
    assert.equal(conflictingRetry.json().code, "reward_idempotency_conflict");
    assert.equal(conflictingRetry.json().existingRewardId, response.reward.id);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("reward mutations require both write and rewards.manage token scopes", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-game-reward-scope-route-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const rule = getDatabase()
      .prepare("SELECT id FROM reward_rules ORDER BY id LIMIT 1")
      .get() as { id: string } | undefined;
    const task = getDatabase()
      .prepare("SELECT id FROM tasks ORDER BY id LIMIT 1")
      .get() as { id: string } | undefined;
    assert.ok(rule);
    assert.ok(task);

    const rewardManageOnly = await issueScopedRewardToken(app, cookie, {
      userIds: [],
      scopes: ["rewards.manage"]
    });
    const writeOnly = await issueScopedRewardToken(app, cookie, {
      userIds: [],
      scopes: ["write"]
    });
    const combined = await issueScopedRewardToken(app, cookie, {
      userIds: [],
      scopes: ["write", "rewards.manage"]
    });
    const endpoints = [
      {
        name: "reward rule update",
        request: (token: string) =>
          app.inject({
            method: "PATCH",
            url: `/api/v1/rewards/rules/${rule.id}`,
            headers: { authorization: `Bearer ${token}` },
            payload: { description: "Verified all-scope authorization." }
          }),
        successStatus: 200
      },
      {
        name: "manual reward bonus",
        request: (token: string) =>
          app.inject({
            method: "POST",
            url: "/api/v1/rewards/bonus",
            headers: { authorization: `Bearer ${token}` },
            payload: {
              entityType: "system",
              entityId: "reward-scope-contract",
              deltaXp: 1,
              reasonTitle: "All-scope authorization"
            }
          }),
        successStatus: 201
      },
      {
        name: "work adjustment",
        request: (token: string) =>
          app.inject({
            method: "POST",
            url: "/api/v1/work-adjustments",
            headers: { authorization: `Bearer ${token}` },
            payload: {
              entityType: "task",
              entityId: task.id,
              deltaMinutes: 1
            }
          }),
        successStatus: 201
      },
      {
        name: "operator log work",
        request: (token: string) =>
          app.inject({
            method: "POST",
            url: "/api/v1/operator/log-work",
            headers: { authorization: `Bearer ${token}` },
            payload: {
              taskId: task.id,
              status: "done"
            }
          }),
        successStatus: 200
      }
    ];

    for (const endpoint of endpoints) {
      const rewardsManageOnly = await endpoint.request(rewardManageOnly);
      assert.equal(
        rewardsManageOnly.statusCode,
        403,
        `${endpoint.name} accepted rewards.manage without write: ${rewardsManageOnly.body}`
      );
      const writeOnlyResponse = await endpoint.request(writeOnly);
      assert.equal(
        writeOnlyResponse.statusCode,
        403,
        `${endpoint.name} accepted write without rewards.manage: ${writeOnlyResponse.body}`
      );
      const allowed = await endpoint.request(combined);
      assert.equal(allowed.statusCode, endpoint.successStatus, allowed.body);
    }
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("OpenAPI exposes XP timezone, scope behavior, and bounded ledger filters", () => {
  const document = buildOpenApiDocument() as unknown as {
    components: {
      schemas: Record<
        string,
        { required?: string[]; properties?: Record<string, unknown> }
      >;
    };
    paths: Record<
      string,
      {
        get?: {
          description?: string;
          parameters?: Array<{
            name: string;
            description?: string;
            schema?: { maximum?: number; default?: number };
          }>;
          responses?: Record<string, unknown>;
        };
        post?: {
          description?: string;
          requestBody?: {
            content?: {
              "application/json"?: {
                schema?: {
                  required?: string[];
                  properties?: Record<string, unknown>;
                };
              };
            };
          };
          responses?: Record<string, unknown>;
        };
        put?: {
          responses?: Record<string, unknown>;
        };
        patch?: {
          responses?: Record<string, unknown>;
        };
      }
    >;
  };
  const xpSchema = document.components.schemas.XpMetricsPayload;
  assert.ok(xpSchema?.required?.includes("timezone"));
  assert.ok(xpSchema?.properties?.timezone);

  const responseStatuses = (responses: Record<string, unknown> | undefined) =>
    Object.keys(responses ?? {}).sort();
  assert.deepEqual(
    responseStatuses(document.paths["/api/v1/metrics"]?.get?.responses),
    ["200", "400", "401", "403"]
  );
  assert.deepEqual(
    responseStatuses(document.paths["/api/v1/metrics/xp"]?.get?.responses),
    ["200", "400", "401", "403"]
  );
  assert.deepEqual(
    responseStatuses(
      document.paths["/api/v1/gamification/equipment"]?.put?.responses
    ),
    ["200", "400", "401"]
  );
  assert.deepEqual(
    responseStatuses(document.paths["/api/v1/rewards/ledger"]?.get?.responses),
    ["200", "400", "401"]
  );
  assert.deepEqual(
    responseStatuses(document.paths["/api/v1/rewards/rules"]?.get?.responses),
    ["200", "401"]
  );
  assert.deepEqual(
    responseStatuses(
      document.paths["/api/v1/rewards/rules/{id}"]?.get?.responses
    ),
    ["200", "401", "404"]
  );
  assert.deepEqual(
    responseStatuses(
      document.paths["/api/v1/rewards/rules/{id}"]?.patch?.responses
    ),
    ["200", "400", "401", "403", "404"]
  );
  assert.deepEqual(
    responseStatuses(
      document.paths["/api/v1/gamification/celebrations/{id}/seen"]?.post
        ?.responses
    ),
    ["200", "401", "404"]
  );

  const xpParameters = document.paths["/api/v1/metrics/xp"]?.get?.parameters;
  assert.ok(xpParameters?.some((parameter) => parameter.name === "timezone"));
  assert.match(
    xpParameters?.find((parameter) => parameter.name === "userIds")
      ?.description ?? "",
    /empty scope/i
  );

  const ledgerParameters =
    document.paths["/api/v1/rewards/ledger"]?.get?.parameters;
  assert.deepEqual(
    ledgerParameters?.map((parameter) => parameter.name),
    ["entityType", "entityId", "limit"]
  );
  assert.equal(
    ledgerParameters?.find((parameter) => parameter.name === "limit")?.schema
      ?.maximum,
    200
  );
  assert.equal(
    ledgerParameters?.find((parameter) => parameter.name === "limit")?.schema
      ?.default,
    50
  );

  for (const path of [
    "/api/v1/metrics",
    "/api/v1/gamification/catalog",
    "/api/v1/gamification/equipment"
  ]) {
    assert.match(document.paths[path]?.get?.description ?? "", /read-only/i);
    assert.ok(
      document.paths[path]?.get?.parameters?.some(
        (parameter) => parameter.name === "timezone"
      ),
      path
    );
  }
  assert.match(
    document.paths["/api/v1/gamification/reconcile"]?.post?.description ?? "",
    /authenticated write command/i
  );
  const assetStatus = document.paths["/api/v1/gamification/assets"]?.get;
  assert.match(assetStatus?.description ?? "", /requires read authorization/i);
  assert.deepEqual(Object.keys(assetStatus?.responses ?? {}).sort(), [
    "200",
    "401",
    "403"
  ]);
  const assetInstall =
    document.paths["/api/v1/gamification/assets/install"]?.post;
  assert.match(assetInstall?.description ?? "", /operator session/i);
  assert.deepEqual(Object.keys(assetInstall?.responses ?? {}).sort(), [
    "200",
    "400",
    "401",
    "502"
  ]);
  const bonusSchema =
    document.paths["/api/v1/rewards/bonus"]?.post?.requestBody?.content?.[
      "application/json"
    ]?.schema;
  assert.deepEqual(bonusSchema?.required, [
    "entityType",
    "entityId",
    "deltaXp",
    "reasonTitle"
  ]);
  assert.ok(bonusSchema?.properties?.metadata);
  assert.ok(document.paths["/api/v1/rewards/bonus"]?.post?.responses?.["409"]);
});
