import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { buildOpenApiDocument } from "./openapi.js";
import { setEntityOwner } from "./repositories/entity-ownership.js";
import { buildEntityNavigationTargetPath } from "./services/entity-navigation.js";
import type { CrudEntityType, EntityNavigationPayload } from "./types.js";

test("entity navigation OpenAPI documents human-only pin mutation and agent recents", () => {
  const document = buildOpenApiDocument() as {
    tags?: Array<{ name: string }>;
    components?: { schemas?: Record<string, unknown> };
    paths?: Record<
      string,
      {
        get?: { tags?: string[]; description?: string };
        put?: { description?: string };
        post?: { description?: string };
        delete?: { description?: string };
      }
    >;
  };
  assert.ok(document.tags?.some((tag) => tag.name === "Navigation"));
  assert.ok(document.components?.schemas?.EntityNavigationItem);
  assert.ok(document.components?.schemas?.EntityNavigationPayload);
  assert.deepEqual(document.paths?.["/api/v1/entity-navigation"]?.get?.tags, [
    "Navigation"
  ]);
  assert.match(
    document.paths?.["/api/v1/entity-navigation/pins"]?.put?.description ?? "",
    /human operator session/
  );
  assert.match(
    document.paths?.["/api/v1/entity-navigation/touch"]?.post?.description ??
      "",
    /calling operator or token actor/
  );
  assert.ok(document.paths?.["/api/v1/entity-navigation/pins/{id}"]?.delete);
});

test("entity navigation defines a truthful destination for every CRUD entity type", () => {
  const id = "record 1";
  const encodedId = "record%201";
  const expected = {
    goal: `/goals/${encodedId}`,
    project: `/projects/${encodedId}`,
    task: `/tasks/${encodedId}`,
    strategy: `/strategies/${encodedId}`,
    habit: `/habits?focus=${encodedId}`,
    tag: `/knowledge-graph?focus=tag%3A${encodedId}`,
    note: `/notes?focus=${encodedId}`,
    person: `/people/${encodedId}`,
    insight: `/knowledge-graph?focus=insight%3A${encodedId}`,
    calendar_event: `/calendar?focus=${encodedId}&focusType=calendar_event`,
    work_block_template: `/calendar?focus=${encodedId}&focusType=work_block_template`,
    task_timebox: `/calendar?focus=${encodedId}&focusType=task_timebox`,
    life_event: `/life-events?focus=${encodedId}`,
    artifact: `/artifacts/${encodedId}`,
    psyche_value: `/psyche/values?focus=${encodedId}`,
    behavior_pattern: `/psyche/patterns?focus=${encodedId}`,
    behavior: `/psyche/behaviors?focus=${encodedId}`,
    belief_entry: `/psyche/schemas-beliefs?focus=${encodedId}`,
    mode_profile: `/psyche/modes?focus=${encodedId}`,
    mode_guide_session: `/psyche/modes/guide?focus=${encodedId}`,
    flashcard: `/psyche/flashcards?focus=${encodedId}`,
    event_type: `/knowledge-graph?focus=event_type%3A${encodedId}`,
    emotion_definition: `/knowledge-graph?focus=emotion_definition%3A${encodedId}`,
    trigger_report: `/psyche/reports/${encodedId}`,
    preference_catalog: `/preferences?tab=concepts&focusCatalog=${encodedId}`,
    preference_catalog_item: `/preferences?tab=concepts&focusCatalogItem=${encodedId}`,
    preference_context: `/preferences?tab=contexts&focusContext=${encodedId}`,
    preference_item: `/preferences?tab=table&focusItem=${encodedId}`,
    questionnaire_instrument: `/psyche/questionnaires/${encodedId}`,
    sleep_session: `/sleep?focus=${encodedId}`,
    workout_session: `/sports/workouts/${encodedId}`
  } satisfies Record<CrudEntityType, string>;

  for (const [entityType, targetPath] of Object.entries(expected) as Array<
    [CrudEntityType, string]
  >) {
    assert.equal(
      buildEntityNavigationTargetPath(entityType, id, { kind: "evidence" }),
      targetPath,
      entityType
    );
  }
  assert.equal(
    buildEntityNavigationTargetPath("note", id, {
      kind: "wiki",
      slug: "Route safety",
      spaceId: "shared space"
    }),
    "/wiki/page/Route%20safety?spaceId=shared%20space"
  );
  assert.equal(
    buildEntityNavigationTargetPath("preference_catalog", id, {
      domain: "food",
      userId: "user operator"
    }),
    `/preferences?tab=concepts&domain=food&userId=user%20operator&focusCatalog=${encodedId}`
  );
});

async function withTestServer(
  run: (app: Awaited<ReturnType<typeof buildServer>>) => Promise<void>
) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-navigation-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    await run(app);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
}

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

test("entity navigation requires authentication and keeps pin mutation operator-only", async () => {
  await withTestServer(async (app) => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/v1/entity-navigation"
    });
    assert.equal(unauthenticated.statusCode, 401);

    const cookie = await issueOperatorSessionCookie(app);
    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: { cookie },
      payload: {
        label: "Navigation token",
        scopes: ["read", "write"],
        scopePolicy: { userIds: [], projectIds: [], tagIds: [] }
      }
    });
    assert.equal(tokenResponse.statusCode, 201, tokenResponse.body);
    const token = (tokenResponse.json() as { token: { token: string } }).token
      .token;

    const agentPin = await app.inject({
      method: "PUT",
      url: "/api/v1/entity-navigation/pins",
      headers: { authorization: `Bearer ${token}` },
      payload: { entityType: "goal", entityId: "goal_build_forge" }
    });
    assert.equal(agentPin.statusCode, 401);

    const agentTouch = await app.inject({
      method: "POST",
      url: "/api/v1/entity-navigation/touch",
      headers: { authorization: `Bearer ${token}` },
      payload: { entityType: "goal", entityId: "goal_build_forge" }
    });
    assert.equal(agentTouch.statusCode, 200, agentTouch.body);
    const agentList = await app.inject({
      method: "GET",
      url: "/api/v1/entity-navigation",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(agentList.statusCode, 200, agentList.body);
    assert.equal(
      (agentList.json() as EntityNavigationPayload).recent[0]?.entityId,
      "goal_build_forge"
    );

    const operatorList = await app.inject({
      method: "GET",
      url: "/api/v1/entity-navigation",
      headers: { cookie }
    });
    assert.equal(operatorList.statusCode, 200);
    assert.equal(
      (operatorList.json() as EntityNavigationPayload).recent.length,
      0,
      "agent and operator recent history must remain isolated"
    );
  });
});

test("entity navigation pins are idempotent, audited, bounded, and excluded from recents", async () => {
  await withTestServer(async (app) => {
    const cookie = await issueOperatorSessionCookie(app);
    setEntityOwner("task", "task_flagship_review", "user_operator");
    const pin = await app.inject({
      method: "PUT",
      url: "/api/v1/entity-navigation/pins",
      headers: { cookie },
      payload: {
        entityType: "task",
        entityId: "task_flagship_review",
        ownerUserId: "user_operator"
      }
    });
    assert.equal(pin.statusCode, 201, pin.body);
    const pinId = (pin.json() as { pin: { pinId: string } }).pin.pinId;

    const repeatedPin = await app.inject({
      method: "PUT",
      url: "/api/v1/entity-navigation/pins",
      headers: { cookie },
      payload: {
        entityType: "task",
        entityId: "task_flagship_review",
        ownerUserId: "user_operator"
      }
    });
    assert.equal(repeatedPin.statusCode, 201);
    assert.equal(
      (repeatedPin.json() as { pin: { pinId: string } }).pin.pinId,
      pinId
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            "SELECT COUNT(*) AS count FROM entity_pin_events WHERE pin_id = ? AND event_type = 'pinned'"
          )
          .get(pinId) as { count: number }
      ).count,
      1
    );

    for (let index = 0; index < 2; index += 1) {
      const touch = await app.inject({
        method: "POST",
        url: "/api/v1/entity-navigation/touch",
        headers: { cookie },
        payload: {
          entityType: "task",
          entityId: "task_flagship_review"
        }
      });
      assert.equal(touch.statusCode, 200, touch.body);
      assert.equal(
        (touch.json() as { recent: { viewCount: number } }).recent.viewCount,
        index + 1
      );
    }

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/entity-navigation?pinnedLimit=1&recentLimit=1&userId=user_operator",
      headers: { cookie }
    });
    assert.equal(list.statusCode, 200, list.body);
    const payload = list.json() as EntityNavigationPayload;
    assert.equal(payload.pinned.length, 1);
    assert.equal(payload.pinned[0]?.entityId, "task_flagship_review");
    assert.equal(payload.recent.length, 0);

    const unpin = await app.inject({
      method: "DELETE",
      url: `/api/v1/entity-navigation/pins/${pinId}`,
      headers: { cookie }
    });
    assert.equal(unpin.statusCode, 200, unpin.body);
    assert.equal(
      (
        getDatabase()
          .prepare(
            "SELECT COUNT(*) AS count FROM entity_pin_events WHERE pin_id = ? AND event_type = 'unpinned'"
          )
          .get(pinId) as { count: number }
      ).count,
      1
    );
  });
});

test("entity navigation preserves deleted pins but hides deleted recents", async () => {
  await withTestServer(async (app) => {
    const cookie = await issueOperatorSessionCookie(app);
    const pin = await app.inject({
      method: "PUT",
      url: "/api/v1/entity-navigation/pins",
      headers: { cookie },
      payload: { entityType: "goal", entityId: "goal_build_forge" }
    });
    assert.equal(pin.statusCode, 201, pin.body);
    const touch = await app.inject({
      method: "POST",
      url: "/api/v1/entity-navigation/touch",
      headers: { cookie },
      payload: { entityType: "goal", entityId: "goal_build_forge" }
    });
    assert.equal(touch.statusCode, 200, touch.body);

    const deleted = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        operations: [
          { entityType: "goal", id: "goal_build_forge", mode: "soft" }
        ]
      }
    });
    assert.equal(deleted.statusCode, 200, deleted.body);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/entity-navigation",
      headers: { cookie }
    });
    assert.equal(list.statusCode, 200, list.body);
    const payload = list.json() as EntityNavigationPayload;
    assert.equal(payload.pinned[0]?.availability, "deleted");
    assert.equal(payload.pinned[0]?.targetPath, "/settings/bin");
    assert.equal(payload.recent.length, 0);
    assert.ok(payload.hiddenRecentCount >= 1);
  });
});

test("entity navigation enforces token user scope for reads and touches", async () => {
  await withTestServer(async (app) => {
    const cookie = await issueOperatorSessionCookie(app);
    setEntityOwner("goal", "goal_build_forge", "user_operator");
    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: { cookie },
      payload: {
        label: "Wrong user navigation token",
        scopes: ["read", "write"],
        scopePolicy: {
          userIds: ["user_forge_bot"],
          projectIds: [],
          tagIds: []
        }
      }
    });
    assert.equal(tokenResponse.statusCode, 201, tokenResponse.body);
    const token = (tokenResponse.json() as { token: { token: string } }).token
      .token;
    const headers = { authorization: `Bearer ${token}` };

    const touch = await app.inject({
      method: "POST",
      url: "/api/v1/entity-navigation/touch",
      headers,
      payload: { entityType: "goal", entityId: "goal_build_forge" }
    });
    assert.equal(touch.statusCode, 404);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/entity-navigation",
      headers
    });
    assert.equal(list.statusCode, 200, list.body);
    assert.deepEqual((list.json() as EntityNavigationPayload).recent, []);
  });
});

test("entity navigation calendar targets preserve their concrete entity type", async () => {
  await withTestServer(async (app) => {
    const cookie = await issueOperatorSessionCookie(app);
    const taskId = (
      getDatabase().prepare("SELECT id FROM tasks LIMIT 1").get() as {
        id: string;
      }
    ).id;
    const projectId = (
      getDatabase().prepare("SELECT id FROM projects LIMIT 1").get() as {
        id: string;
      }
    ).id;
    setEntityOwner("task", taskId, "user_operator");
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "work_block_template",
            clientRef: "navigation-work-block",
            data: {
              title: "Navigation work block",
              kind: "main_activity",
              color: "#38bdf8",
              timezone: "Europe/Zurich",
              weekDays: [1],
              startMinute: 540,
              endMinute: 600,
              blockingState: "blocked"
            }
          },
          {
            entityType: "task_timebox",
            clientRef: "navigation-timebox",
            data: {
              taskId,
              projectId,
              title: "Navigation timebox",
              startsAt: "2026-07-13T09:00:00.000Z",
              endsAt: "2026-07-13T10:00:00.000Z",
              source: "suggested"
            }
          }
        ]
      }
    });
    assert.equal(created.statusCode, 200, created.body);
    const results = (
      created.json() as {
        results: Array<{
          ok: boolean;
          entityType?: "work_block_template" | "task_timebox";
          entity?: { id: string };
        }>;
      }
    ).results;
    assert.equal(
      results.every((result) => result.ok),
      true,
      created.body
    );

    for (const result of results) {
      assert.ok(result.entityType);
      assert.ok(result.entity?.id);
      const pin = await app.inject({
        method: "PUT",
        url: "/api/v1/entity-navigation/pins",
        headers: { cookie },
        payload: {
          entityType: result.entityType,
          entityId: result.entity.id
        }
      });
      assert.equal(pin.statusCode, 201, pin.body);
      assert.equal(
        (pin.json() as { pin: { targetPath: string } }).pin.targetPath,
        `/calendar?focus=${result.entity.id}&focusType=${result.entityType}`
      );
    }
  });
});

test("entity navigation preference targets preserve the owning user and domain", async () => {
  await withTestServer(async (app) => {
    const cookie = await issueOperatorSessionCookie(app);
    const refreshResponse = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/workspace/refresh",
      headers: { cookie },
      payload: { userId: "user_operator", domain: "food" }
    });
    assert.equal(refreshResponse.statusCode, 200, refreshResponse.body);
    const workspaceResponse = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/workspace?userId=user_operator&domain=food",
      headers: { cookie }
    });
    assert.equal(workspaceResponse.statusCode, 200, workspaceResponse.body);
    const workspace = (
      workspaceResponse.json() as {
        workspace: {
          profile: { userId: string; domain: string };
          selectedContext: { id: string };
          catalogs: Array<{
            id: string;
            items: Array<{ id: string }>;
          }>;
        };
      }
    ).workspace;
    const catalog = workspace.catalogs.find((entry) => entry.items.length > 0);
    assert.ok(catalog);
    const catalogItem = catalog.items[0];
    assert.ok(catalogItem);

    const itemResponse = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items",
      headers: { cookie },
      payload: {
        userId: workspace.profile.userId,
        domain: workspace.profile.domain,
        label: "Navigation preference",
        description: "Exact preference navigation test",
        queueForCompare: false
      }
    });
    assert.equal(itemResponse.statusCode, 201, itemResponse.body);
    const preferenceItemId = (itemResponse.json() as { item: { id: string } })
      .item.id;

    const expectedTargets: Array<{
      entityType:
        | "preference_catalog"
        | "preference_catalog_item"
        | "preference_context"
        | "preference_item";
      entityId: string;
      tab: string;
      focusKey: string;
    }> = [
      {
        entityType: "preference_catalog",
        entityId: catalog.id,
        tab: "concepts",
        focusKey: "focusCatalog"
      },
      {
        entityType: "preference_catalog_item",
        entityId: catalogItem.id,
        tab: "concepts",
        focusKey: "focusCatalogItem"
      },
      {
        entityType: "preference_context",
        entityId: workspace.selectedContext.id,
        tab: "contexts",
        focusKey: "focusContext"
      },
      {
        entityType: "preference_item",
        entityId: preferenceItemId,
        tab: "table",
        focusKey: "focusItem"
      }
    ];

    for (const target of expectedTargets) {
      const pin = await app.inject({
        method: "PUT",
        url: "/api/v1/entity-navigation/pins",
        headers: { cookie },
        payload: {
          entityType: target.entityType,
          entityId: target.entityId
        }
      });
      assert.equal(pin.statusCode, 201, pin.body);
      assert.equal(
        (pin.json() as { pin: { targetPath: string } }).pin.targetPath,
        `/preferences?tab=${target.tab}&domain=food&userId=user_operator&${target.focusKey}=${target.entityId}`
      );
    }
  });
});

test("entity navigation health pins use the live sleep and workout web routes", async () => {
  await withTestServer(async (app) => {
    const cookie = await issueOperatorSessionCookie(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "sleep_session",
            clientRef: "navigation-sleep",
            data: {
              startedAt: "2026-07-08T22:30:00.000Z",
              endedAt: "2026-07-09T06:30:00.000Z",
              qualitySummary: "Navigation route audit"
            }
          },
          {
            entityType: "workout_session",
            clientRef: "navigation-workout",
            data: {
              workoutType: "walk",
              startedAt: "2026-07-09T10:00:00.000Z",
              endedAt: "2026-07-09T10:45:00.000Z",
              meaningText: "Navigation route audit"
            }
          }
        ]
      }
    });
    assert.equal(created.statusCode, 200, created.body);
    const results = (
      created.json() as {
        results: Array<{
          ok: boolean;
          entityType?: "sleep_session" | "workout_session";
          entity?: { id: string };
        }>;
      }
    ).results;
    assert.equal(
      results.every((result) => result.ok),
      true,
      created.body
    );

    for (const result of results) {
      assert.ok(result.entityType);
      assert.ok(result.entity?.id);
      const pin = await app.inject({
        method: "PUT",
        url: "/api/v1/entity-navigation/pins",
        headers: { cookie },
        payload: {
          entityType: result.entityType,
          entityId: result.entity.id
        }
      });
      assert.equal(pin.statusCode, 201, pin.body);
      const expectedPath =
        result.entityType === "sleep_session"
          ? `/sleep?focus=${result.entity.id}`
          : `/sports/workouts/${result.entity.id}`;
      assert.equal(
        (pin.json() as { pin: { targetPath: string } }).pin.targetPath,
        expectedPath
      );
    }
  });
});

test("entity navigation finds valid recents behind a stale first batch", async () => {
  await withTestServer(async (app) => {
    const cookie = await issueOperatorSessionCookie(app);
    const touch = await app.inject({
      method: "POST",
      url: "/api/v1/entity-navigation/touch",
      headers: { cookie },
      payload: { entityType: "goal", entityId: "goal_build_forge" }
    });
    assert.equal(touch.statusCode, 200, touch.body);

    const insert = getDatabase().prepare(
      `INSERT INTO entity_recent_views (
         actor_key, entity_type, entity_id, view_count,
         first_viewed_at, last_viewed_at
       ) VALUES ('operator', 'goal', ?, 1, ?, ?)`
    );
    const newerTimestamp = "2030-01-01T00:00:00.000Z";
    getDatabase().exec("BEGIN IMMEDIATE");
    try {
      for (let index = 0; index < 300; index += 1) {
        insert.run(
          `missing-newer-goal-${index}`,
          newerTimestamp,
          newerTimestamp
        );
      }
      getDatabase().exec("COMMIT");
    } catch (error) {
      getDatabase().exec("ROLLBACK");
      throw error;
    }

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/entity-navigation?pinnedLimit=0&recentLimit=1",
      headers: { cookie }
    });
    assert.equal(response.statusCode, 200, response.body);
    const payload = response.json() as EntityNavigationPayload;
    assert.equal(payload.recent[0]?.entityId, "goal_build_forge");
    assert.equal(payload.recentTotal, 301);
    assert.equal(payload.hiddenRecentCount, 300);
  });
});

test("entity navigation stays bounded with a large stale recent history", async () => {
  await withTestServer(async (app) => {
    const cookie = await issueOperatorSessionCookie(app);
    const insert = getDatabase().prepare(
      `INSERT INTO entity_recent_views (
         actor_key, entity_type, entity_id, view_count,
         first_viewed_at, last_viewed_at
       ) VALUES ('operator', 'goal', ?, 1, ?, ?)`
    );
    const now = new Date().toISOString();
    getDatabase().exec("BEGIN IMMEDIATE");
    try {
      for (let index = 0; index < 5_000; index += 1) {
        insert.run(`missing-goal-${index}`, now, now);
      }
      getDatabase().exec("COMMIT");
    } catch (error) {
      getDatabase().exec("ROLLBACK");
      throw error;
    }

    const startedAt = performance.now();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/entity-navigation?pinnedLimit=0&recentLimit=25",
      headers: { cookie }
    });
    const durationMs = performance.now() - startedAt;
    assert.equal(response.statusCode, 200, response.body);
    const payload = response.json() as EntityNavigationPayload;
    assert.equal(payload.recent.length, 0);
    assert.equal(payload.recentTotal, 5_000);
    assert.equal(payload.hiddenRecentCount, 5_000);
    assert.ok(
      durationMs < 1_500,
      `Expected bounded navigation read under 1500ms, received ${durationMs.toFixed(1)}ms`
    );
  });
});
