import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { buildOpenApiDocument } from "./openapi.js";
import { createAgentToken } from "./repositories/settings.js";
import { getDefaultUser, listUsers } from "./repositories/users.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import { createAgentTokenSchema, type SavedView } from "./types.js";

type TestApp = Awaited<ReturnType<typeof buildServer>>;

async function withTestServer(
  run: (app: TestApp, cookie: string) => Promise<void>
) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-saved-views-"));
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    devrageMetricSync: false
  });
  const cookie = issueTestOperatorSessionCookie(app);
  try {
    await run(app, cookie);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function issueWriteToken() {
  return createAgentToken(
    createAgentTokenSchema.parse({
      label: "Saved-view agent",
      agentLabel: "Saved-view agent",
      scopes: ["read", "write"],
      scopePolicy: {
        userIds: [getDefaultUser().id],
        projectIds: [],
        tagIds: []
      }
    }),
    { actor: "Saved-view test", source: "system" }
  ).token;
}

test("saved-view OpenAPI publishes the bounded operator-only contract", () => {
  const document = buildOpenApiDocument() as {
    tags?: Array<{ name: string }>;
    components?: { schemas?: Record<string, unknown> };
    paths?: Record<string, Record<string, unknown>>;
  };
  assert.ok(document.tags?.some((tag) => tag.name === "Saved Views"));
  assert.ok(document.components?.schemas?.SavedView);
  assert.ok(document.components?.schemas?.SavedViewCreateInput);
  const savedView = document.components?.schemas?.SavedView as {
    properties?: Record<string, { maxItems?: number }>;
  };
  const createInput = document.components?.schemas?.SavedViewCreateInput as {
    properties?: Record<string, { maxItems?: number }>;
  };
  assert.equal(savedView.properties?.filterIds?.maxItems, 16);
  assert.equal(savedView.properties?.scopeUserIds?.maxItems, 100);
  assert.equal(createInput.properties?.filterIds?.maxItems, 16);
  assert.equal(createInput.properties?.scopeUserIds?.maxItems, 100);
  assert.ok(document.paths?.["/api/v1/saved-views"]?.get);
  assert.ok(document.paths?.["/api/v1/saved-views"]?.post);
  assert.ok(document.paths?.["/api/v1/saved-views/{id}"]?.delete);
});

test("an operator can save, reopen, and delete one user's bounded Action Bar state", async () => {
  await withTestServer(async (app, cookie) => {
    const owner = getDefaultUser();
    const scopedUser =
      listUsers().find((user) => user.id !== owner.id) ?? owner;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/saved-views",
      headers: { cookie },
      payload: {
        ownerUserId: owner.id,
        name: "Weekly decisions",
        query: "decision",
        filterIds: ["task", "calendar_event", "task"],
        scopeMode: "selected",
        scopeUserIds: [scopedUser.id, scopedUser.id]
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    const savedView = (created.json() as { savedView: SavedView }).savedView;
    assert.deepEqual(savedView.filterIds, ["task", "calendar_event"]);
    assert.deepEqual(savedView.scopeUserIds, [scopedUser.id]);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/saved-views",
      headers: { cookie },
      payload: {
        ownerUserId: owner.id,
        name: "weekly DECISIONS",
        query: "different",
        scopeMode: "all"
      }
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/saved-views?ownerUserId=${encodeURIComponent(owner.id)}`,
      headers: { cookie }
    });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(
      (listed.json() as { savedViews: SavedView[] }).savedViews[0]?.id,
      savedView.id
    );

    const wrongOwner = listUsers().find((user) => user.id !== owner.id);
    if (wrongOwner) {
      const wrongOwnerDelete = await app.inject({
        method: "DELETE",
        url: `/api/v1/saved-views/${savedView.id}?ownerUserId=${encodeURIComponent(wrongOwner.id)}`,
        headers: { cookie }
      });
      assert.equal(wrongOwnerDelete.statusCode, 404);
    }

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/saved-views/${savedView.id}?ownerUserId=${encodeURIComponent(owner.id)}`,
      headers: { cookie }
    });
    assert.equal(deleted.statusCode, 200, deleted.body);
  });
});

test("stale state is narrowed truthfully and agent tokens cannot manage saved views", async () => {
  await withTestServer(async (app, cookie) => {
    const owner = getDefaultUser();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/saved-views",
      headers: { cookie },
      payload: {
        ownerUserId: owner.id,
        name: "Migration-safe view",
        query: "review",
        filterIds: ["task"],
        scopeMode: "selected",
        scopeUserIds: [owner.id]
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    const savedView = (created.json() as { savedView: SavedView }).savedView;
    getDatabase()
      .prepare(
        `UPDATE saved_views
         SET filter_ids_json = ?, scope_user_ids_json = ?
         WHERE id = ?`
      )
      .run(
        JSON.stringify(["task", "retired_filter"]),
        JSON.stringify([owner.id, "user_retired"]),
        savedView.id
      );

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/saved-views?ownerUserId=${encodeURIComponent(owner.id)}`,
      headers: { cookie }
    });
    const migrated = (listed.json() as { savedViews: SavedView[] })
      .savedViews[0]!;
    assert.deepEqual(migrated.filterIds, ["task"]);
    assert.deepEqual(migrated.scopeUserIds, [owner.id]);
    assert.deepEqual(migrated.unavailableFilterIds, ["retired_filter"]);
    assert.deepEqual(migrated.unavailableScopeUserIds, ["user_retired"]);

    getDatabase()
      .prepare(
        `UPDATE saved_views
         SET scope_user_ids_json = ?, schema_version = ?
         WHERE id = ?`
      )
      .run(JSON.stringify(["user_retired"]), 2, savedView.id);
    const incompatibleList = await app.inject({
      method: "GET",
      url: `/api/v1/saved-views?ownerUserId=${encodeURIComponent(owner.id)}`,
      headers: { cookie }
    });
    const incompatible = (
      incompatibleList.json() as { savedViews: SavedView[] }
    ).savedViews[0]!;
    assert.equal(incompatible.compatibility, "unsupported");
    assert.equal(incompatible.scopeMode, "selected");
    assert.deepEqual(incompatible.scopeUserIds, []);
    assert.deepEqual(incompatible.unavailableScopeUserIds, ["user_retired"]);

    const token = issueWriteToken();
    for (const request of [
      { method: "GET", url: `/api/v1/saved-views?ownerUserId=${owner.id}` },
      { method: "POST", url: "/api/v1/saved-views" },
      {
        method: "DELETE",
        url: `/api/v1/saved-views/${savedView.id}?ownerUserId=${owner.id}`
      }
    ] as const) {
      const denied = await app.inject({
        ...request,
        headers: { authorization: `Bearer ${token}` },
        payload:
          request.method === "POST"
            ? {
                ownerUserId: owner.id,
                name: "Agent view",
                scopeMode: "all"
              }
            : undefined
      });
      assert.equal(denied.statusCode, 403, denied.body);
    }
  });
});

test("an owner can keep exactly 20 reachable saved views", async () => {
  await withTestServer(async (app, cookie) => {
    const owner = getDefaultUser();
    for (let index = 1; index <= 20; index += 1) {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/saved-views",
        headers: { cookie },
        payload: {
          ownerUserId: owner.id,
          name: `View ${String(index).padStart(2, "0")}`,
          query: `query ${index}`,
          scopeMode: "all"
        }
      });
      assert.equal(created.statusCode, 201, created.body);
    }

    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/saved-views?ownerUserId=${encodeURIComponent(owner.id)}`,
      headers: { cookie }
    });
    assert.equal(
      (listed.json() as { savedViews: SavedView[] }).savedViews.length,
      20
    );

    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/saved-views",
      headers: { cookie },
      payload: {
        ownerUserId: owner.id,
        name: "View 21",
        query: "unreachable without a cap",
        scopeMode: "all"
      }
    });
    assert.equal(rejected.statusCode, 409, rejected.body);
    assert.match(rejected.body, /save up to 20 views/i);
  });
});
