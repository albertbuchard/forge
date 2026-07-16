import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import {
  createPreferenceContext,
  createPreferenceItem,
  refreshPreferenceWorkspace
} from "./repositories/preferences.js";

const dimensions = {
  novelty: 0,
  simplicity: 0,
  rigor: 0,
  aesthetics: 0,
  depth: 0,
  structure: 0,
  familiarity: 0,
  surprise: 0
};

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

async function issueScopedToken(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  userId: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label: "Preference authorization test",
      agentLabel: "Preference test agent",
      scopes: ["read", "write"],
      scopePolicy: { userIds: [userId], projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { token: { token: string } }).token.token;
}

function itemInput(userId: string, label: string) {
  return {
    userId,
    domain: "projects" as const,
    label,
    description: "",
    tags: [],
    featureWeights: dimensions,
    metadata: {},
    queueForCompare: false
  };
}

test("preference routes enforce exact user scope and authenticated provenance", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-pref-auth-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const token = await issueScopedToken(app, cookie, "user_forge_bot");
    const headers = {
      authorization: `Bearer ${token}`,
      "x-forge-source": "agent",
      "x-forge-actor": "Spoofed preference actor"
    };
    const operatorWorkspace = refreshPreferenceWorkspace({
      userId: "user_operator",
      domain: "projects"
    });
    const botWorkspace = refreshPreferenceWorkspace({
      userId: "user_forge_bot",
      domain: "projects"
    });
    const operatorContext = createPreferenceContext({
      userId: "user_operator",
      domain: "projects",
      name: "Operator private context",
      description: "",
      shareMode: "isolated",
      active: true,
      isDefault: false,
      decayDays: 90
    });
    const operatorItem = createPreferenceItem(
      itemInput("user_operator", "Operator private item")
    );
    const botLeft = createPreferenceItem(
      itemInput("user_forge_bot", "Bot left item")
    );
    const botRight = createPreferenceItem(
      itemInput("user_forge_bot", "Bot right item")
    );

    for (const url of [
      "/api/v1/preferences/contexts",
      "/api/v1/preferences/items"
    ]) {
      const anonymous = await app.inject({ method: "GET", url });
      assert.equal(anonymous.statusCode, 401);
    }

    const contextList = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/contexts",
      headers
    });
    assert.equal(contextList.statusCode, 200);
    const contexts = contextList.json().contexts as Array<{
      id: string;
      profileId: string;
    }>;
    assert.ok(
      contexts.some((context) => context.id === botWorkspace.selectedContext.id)
    );
    assert.ok(
      contexts.every((context) => context.profileId === botWorkspace.profile.id)
    );

    const itemList = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/items",
      headers
    });
    assert.equal(itemList.statusCode, 200);
    const items = itemList.json().items as Array<{
      id: string;
      profileId: string;
    }>;
    assert.ok(items.some((item) => item.id === botLeft.id));
    assert.ok(
      items.every((item) => item.profileId === botWorkspace.profile.id)
    );

    for (const url of [
      `/api/v1/preferences/contexts/${operatorContext.id}`,
      `/api/v1/preferences/items/${operatorItem.id}`
    ]) {
      const hidden = await app.inject({ method: "GET", url, headers });
      assert.equal(hidden.statusCode, 404);
      assert.equal(hidden.json().code, "preferences_record_not_found");
    }

    const forbiddenContext = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/contexts",
      headers,
      payload: {
        userId: "user_operator",
        domain: "projects",
        name: "Scope escape"
      }
    });
    const forbiddenItem = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items",
      headers,
      payload: itemInput("user_operator", "Scope escape")
    });
    assert.equal(forbiddenContext.statusCode, 403);
    assert.equal(forbiddenItem.statusCode, 403);

    const forbiddenJudgment = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/judgments",
      headers,
      payload: {
        userId: "user_operator",
        domain: "projects",
        contextId: operatorWorkspace.selectedContext.id,
        leftItemId: operatorItem.id,
        rightItemId: botLeft.id,
        outcome: "left"
      }
    });
    const forbiddenSignal = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/signals",
      headers,
      payload: {
        userId: "user_operator",
        domain: "projects",
        contextId: operatorWorkspace.selectedContext.id,
        itemId: operatorItem.id,
        signalType: "favorite"
      }
    });
    assert.equal(forbiddenJudgment.statusCode, 403);
    assert.equal(forbiddenSignal.statusCode, 403);

    const judgment = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/judgments",
      headers,
      payload: {
        userId: "user_forge_bot",
        domain: "projects",
        contextId: botWorkspace.selectedContext.id,
        leftItemId: botLeft.id,
        rightItemId: botRight.id,
        outcome: "left",
        strength: 1
      }
    });
    assert.equal(judgment.statusCode, 201);
    assert.equal(judgment.json().judgment.source, "agent");
    const judgmentId = judgment.json().judgment.id as string;
    const activity = getDatabase()
      .prepare(
        `SELECT actor, source
         FROM activity_events
         WHERE json_extract(metadata_json, '$.judgmentId') = ?`
      )
      .get(judgmentId) as { actor: string | null; source: string } | undefined;
    assert.deepEqual(activity ? { ...activity } : null, {
      actor: "Preference test agent",
      source: "agent"
    });

    const timestamp = new Date().toISOString();
    const insertContext = getDatabase().prepare(
      `INSERT INTO preference_contexts (
         id, profile_id, name, description, share_mode, active, is_default,
         decay_days, created_at, updated_at
       ) VALUES (?, ?, ?, '', 'blended', 1, 0, 90, ?, ?)`
    );
    for (let index = 0; index < 205; index += 1) {
      insertContext.run(
        `context_bound_${index}`,
        botWorkspace.profile.id,
        `Bounded context ${index}`,
        timestamp,
        timestamp
      );
    }
    const bounded = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/contexts",
      headers
    });
    assert.equal(bounded.statusCode, 200);
    assert.equal(bounded.json().contexts.length, 200);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
