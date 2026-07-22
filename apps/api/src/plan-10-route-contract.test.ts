import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { buildOpenApiDocument } from "./openapi.js";
import {
  claimTaskTimeboxProviderOperation,
  completeTaskTimeboxProviderOperation,
  createCalendarConnectionRecord,
  getTaskTimeboxById,
  getTaskTimeboxByIdIncludingPendingDeletion,
  storeEncryptedSecret,
  updateCalendarConnectionRecord,
  upsertCalendarRecord
} from "./repositories/calendar.js";
import { setEntityOwner } from "./repositories/entity-ownership.js";
import { listTasks } from "./repositories/tasks.js";
import { listUsers } from "./repositories/users.js";

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
      label: "PLAN-10 route contract",
      agentLabel: "PLAN-10 test agent",
      scopes: ["read", "write"],
      scopePolicy: { userIds: [userId], projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { token: { token: string } }).token.token;
}

test("PLAN-10 direct routes enforce task ownership, authentication, bounds, and timezone", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-plan10-route-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const task = listTasks()[0];
    assert.ok(task);
    const taskOwner = listUsers()[0];
    assert.ok(taskOwner);
    const taskOwnerUserId = taskOwner.id;
    setEntityOwner("task", task.id, taskOwnerUserId);
    const foreignUser = listUsers().find((user) => user.id !== taskOwnerUserId);
    assert.ok(foreignUser);

    const anonymous = await app.inject({
      method: "GET",
      url: "/api/v1/calendar/timeboxes"
    });
    assert.equal(anonymous.statusCode, 401);

    const cookie = await issueOperatorSessionCookie(app);
    const token = await issueScopedToken(app, cookie, foreignUser.id);
    const foreignHeaders = { authorization: `Bearer ${token}` };

    const foreignRecommendation = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/timeboxes/recommend",
      headers: foreignHeaders,
      payload: {
        taskId: task.id,
        from: "2030-03-25T00:00:00.000Z",
        to: "2030-03-26T00:00:00.000Z",
        timezone: "Europe/Zurich",
        limit: 12
      }
    });
    assert.equal(foreignRecommendation.statusCode, 404);

    const foreignCreate = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/timeboxes",
      headers: foreignHeaders,
      payload: {
        taskId: task.id,
        title: "Cross-scope timebox",
        startsAt: "2030-03-25T09:00:00.000Z",
        endsAt: "2030-03-25T10:00:00.000Z",
        overrideReason: "Authorization regression fixture"
      }
    });
    assert.equal(foreignCreate.statusCode, 404);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/timeboxes",
      headers: { cookie },
      payload: {
        taskId: task.id,
        title: "Owner-scoped timebox",
        startsAt: "2030-03-25T09:00:00.000Z",
        endsAt: "2030-03-25T10:00:00.000Z",
        overrideReason: "Authorization regression fixture",
        userId: taskOwnerUserId
      }
    });
    assert.equal(created.statusCode, 201);
    const timeboxId = (created.json() as { timebox: { id: string } }).timebox
      .id;

    const invalidCreatePreset = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/timeboxes",
      headers: { cookie },
      payload: {
        taskId: task.id,
        title: "Invalid AP preset",
        startsAt: "2030-03-25T11:00:00.000Z",
        endsAt: "2030-03-25T12:00:00.000Z",
        activityPresetKey: "not_a_real_preset"
      }
    });
    assert.equal(invalidCreatePreset.statusCode, 400, invalidCreatePreset.body);
    const invalidPatchPreset = await app.inject({
      method: "PATCH",
      url: `/api/v1/calendar/timeboxes/${timeboxId}`,
      headers: { cookie },
      payload: { activityPresetKey: "not_a_real_preset" }
    });
    assert.equal(invalidPatchPreset.statusCode, 400, invalidPatchPreset.body);

    for (const request of [
      { method: "GET", url: `/api/v1/calendar/timeboxes/${timeboxId}` },
      {
        method: "PATCH",
        url: `/api/v1/calendar/timeboxes/${timeboxId}`,
        payload: { title: "Unauthorized edit" }
      },
      { method: "DELETE", url: `/api/v1/calendar/timeboxes/${timeboxId}` }
    ] as const) {
      const response = await app.inject({
        ...request,
        headers: foreignHeaders
      });
      assert.equal(response.statusCode, 404);
    }

    const foreignList = await app.inject({
      method: "GET",
      url: "/api/v1/calendar/timeboxes?from=2030-03-25T00:00:00.000Z&to=2030-03-26T00:00:00.000Z",
      headers: foreignHeaders
    });
    assert.equal(foreignList.statusCode, 200);
    assert.ok(
      !(foreignList.json().timeboxes as Array<{ id: string }>).some(
        (timebox) => timebox.id === timeboxId
      )
    );

    const scopeEscape = await app.inject({
      method: "GET",
      url: `/api/v1/calendar/timeboxes?from=2030-03-25T00:00:00.000Z&to=2030-03-26T00:00:00.000Z&userIds=${encodeURIComponent(taskOwnerUserId)}`,
      headers: foreignHeaders
    });
    assert.equal(scopeEscape.statusCode, 403);

    const recommendation = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/timeboxes/recommend",
      headers: { cookie },
      payload: {
        taskId: task.id,
        from: "2030-03-25T00:00:00.000Z",
        to: "2030-03-26T00:00:00.000Z",
        timezone: "Europe/Zurich",
        limit: 12
      }
    });
    assert.equal(recommendation.statusCode, 200);
    assert.ok((recommendation.json().timeboxes as unknown[]).length <= 12);

    storeEncryptedSecret(
      "secret_plan10_direct_delete",
      "invalid-encrypted-fixture",
      "PLAN-10 direct deletion failure fixture"
    );
    const connection = createCalendarConnectionRecord({
      provider: "google",
      label: "PLAN-10 direct delete",
      accountLabel: "direct-delete",
      config: {},
      credentialsSecretId: "secret_plan10_direct_delete",
      userId: taskOwnerUserId
    });
    const calendar = upsertCalendarRecord(connection.id, {
      remoteId: "https://calendar.example/plan10-direct-delete/",
      title: "PLAN-10 direct delete",
      timezone: "UTC",
      canWrite: true,
      selectedForSync: true,
      forgeManaged: true
    });
    updateCalendarConnectionRecord(connection.id, {
      status: "connected",
      forgeCalendarId: calendar.id
    });
    const projectionClaim = claimTaskTimeboxProviderOperation({
      timeboxId,
      connectionId: connection.id
    });
    assert.ok(projectionClaim);
    assert.equal(
      completeTaskTimeboxProviderOperation({
        timeboxId,
        operation: "upsert",
        claimToken: projectionClaim.claimToken,
        claimVersion: projectionClaim.claimVersion,
        connectionId: connection.id,
        calendarId: calendar.id,
        remoteEventId: "remote_plan10_direct_delete"
      }),
      true
    );
    const directDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/calendar/timeboxes/${timeboxId}`,
      headers: { cookie }
    });
    assert.equal(directDelete.statusCode, 200, directDelete.body);
    assert.equal(directDelete.json().projection.state, "error");
    assert.equal(directDelete.json().projection.retryable, true);
    assert.equal(getTaskTimeboxById(timeboxId), undefined);
    assert.ok(getTaskTimeboxByIdIncludingPendingDeletion(timeboxId));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("PLAN-10 OpenAPI publishes the complete direct timebox lifecycle", () => {
  const document = buildOpenApiDocument() as unknown as {
    components: {
      schemas: Record<
        string,
        {
          additionalProperties?: boolean;
          required?: string[];
          properties?: Record<string, unknown>;
        }
      >;
    };
    paths: Record<string, Record<string, unknown>>;
  };
  const create = document.components.schemas.TaskTimeboxCreateInput;
  const patch = document.components.schemas.TaskTimeboxPatchInput;
  const recommend = document.components.schemas.TaskTimeboxRecommendationInput;
  assert.equal(create?.additionalProperties, false);
  assert.deepEqual(create?.required, ["taskId", "title", "startsAt", "endsAt"]);
  assert.deepEqual(
    (
      create?.properties?.activityPresetKey as {
        anyOf: Array<{ enum?: string[] }>;
      }
    ).anyOf[0]?.enum,
    [
      "deep_work",
      "admin",
      "maintenance",
      "meeting",
      "recovery_break",
      "holiday_leisure",
      "light_context",
      "task_inherited"
    ]
  );
  assert.equal(patch?.additionalProperties, false);
  assert.ok(recommend?.properties?.timezone);
  assert.equal(recommend?.additionalProperties, false);

  const collection = document.paths["/api/v1/calendar/timeboxes"];
  assert.ok(collection?.get);
  assert.ok(collection?.post);
  const detail = document.paths["/api/v1/calendar/timeboxes/{id}"];
  assert.ok(detail?.get);
  assert.ok(detail?.patch);
  assert.ok(detail?.delete);
  const deleteResponse = detail.delete as {
    responses: {
      "200": {
        content: {
          "application/json": {
            schema: { required: string[] };
          };
        };
      };
    };
  };
  assert.deepEqual(
    deleteResponse.responses["200"].content["application/json"].schema.required,
    ["timebox", "projection"]
  );
  assert.ok(document.paths["/api/v1/calendar/timeboxes/recommend"]?.post);
});

test("PLAN-10 OpenAPI publishes the complete work-block lifecycle and true create minimum", () => {
  const document = buildOpenApiDocument() as unknown as {
    components: {
      schemas: Record<
        string,
        {
          additionalProperties?: boolean;
          required?: string[];
          properties?: Record<string, { default?: unknown }>;
        }
      >;
    };
    paths: Record<string, Record<string, unknown>>;
  };
  const create = document.components.schemas.WorkBlockTemplateCreateInput;
  const patch = document.components.schemas.WorkBlockTemplatePatchInput;

  assert.equal(create?.additionalProperties, false);
  assert.deepEqual(create?.required, [
    "title",
    "weekDays",
    "startMinute",
    "endMinute"
  ]);
  assert.equal(create?.properties?.kind?.default, "custom");
  assert.equal(create?.properties?.color?.default, "#60a5fa");
  assert.equal(create?.properties?.timezone?.default, "UTC");
  assert.equal(create?.properties?.blockingState?.default, "blocked");
  assert.equal(patch?.additionalProperties, false);
  assert.equal(patch?.required, undefined);

  const collection = document.paths["/api/v1/calendar/work-block-templates"];
  assert.ok(collection?.get);
  assert.ok(collection?.post);
  const detail =
    document.paths["/api/v1/calendar/work-block-templates/{id}"];
  assert.ok(detail?.get);
  assert.ok(detail?.patch);
  assert.ok(detail?.delete);
});
