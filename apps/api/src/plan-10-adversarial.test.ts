import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import {
  claimTaskTimeboxProviderOperation,
  completeTaskTimeboxProviderOperation,
  createCalendarConnectionRecord,
  createTaskTimebox,
  deleteTaskTimebox,
  failTaskTimeboxProviderOperation,
  findCoveringTimeboxForTask,
  getTaskTimeboxById,
  getTaskTimeboxByIdIncludingPendingDeletion,
  listCalendarEvents,
  listTaskTimeboxProjectionCandidateIds,
  storeEncryptedSecret,
  suggestTaskTimeboxes,
  updateTaskTimebox,
  upsertCalendarEventRecord,
  upsertCalendarRecord
} from "./repositories/calendar.js";
import { getEntityOwnerId } from "./repositories/entity-ownership.js";
import { createGoal } from "./repositories/goals.js";
import { createProject } from "./repositories/projects.js";
import { createTask, updateTask } from "./repositories/tasks.js";
import { createUser } from "./repositories/users.js";

async function withIsolatedForge(
  run: (app: Awaited<ReturnType<typeof buildServer>>) => Promise<void> | void
) {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-plan10-hardening-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    devrageMetricSync: false
  });
  try {
    await run(app);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function createPlanningFixture(label: string) {
  const user = createUser({
    kind: "human",
    handle: `plan-hardening-${label}`,
    displayName: `Planner ${label}`,
    description: "",
    accentColor: "#336699"
  });
  const goal = createGoal({
    title: `Goal ${label}`,
    description: "",
    horizon: "year",
    status: "active",
    targetPoints: 400,
    themeColor: "#c8a46b",
    tagIds: [],
    notes: [],
    userId: user.id
  });
  const project = createProject({
    goalId: goal.id,
    title: `Project ${label}`,
    userId: user.id
  });
  const task = createTask({
    title: `Task ${label}`,
    projectId: project.id,
    goalId: goal.id,
    userId: user.id,
    owner: user.displayName,
    plannedDurationSeconds: 60 * 60
  });
  return { user, goal, project, task };
}

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

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
      label: `PLAN-10 ${userId}`,
      agentLabel: "PLAN-10 adversarial agent",
      scopes: ["read", "write"],
      scopePolicy: { userIds: [userId], projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { token: { token: string } }).token.token;
}

test("PLAN-10 batch CRUD enforces owner scope, replays idempotency, and keeps implicit search bounded", async () => {
  await withIsolatedForge(async (app) => {
    const alpha = createPlanningFixture("batch-alpha");
    const beta = createPlanningFixture("batch-beta");
    const cookie = await issueOperatorSessionCookie(app);
    const alphaToken = await issueScopedToken(app, cookie, alpha.user.id);
    const headers = { authorization: `Bearer ${alphaToken}` };

    const forbiddenCreate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers,
      payload: {
        operations: [
          {
            entityType: "task_timebox",
            data: {
              taskId: beta.task.id,
              title: "Cross-owner create",
              startsAt: "2031-01-06T09:00:00.000Z",
              endsAt: "2031-01-06T10:00:00.000Z"
            }
          }
        ]
      }
    });
    assert.equal(forbiddenCreate.statusCode, 200, forbiddenCreate.body);
    assert.equal(
      forbiddenCreate.json().results[0].error.code,
      "user_scope_forbidden"
    );

    const createPayload = {
      operations: [
        {
          entityType: "task_timebox",
          idempotencyKey: "plan10-batch-idempotency-0001",
          data: {
            taskId: alpha.task.id,
            title: "Scoped batch timebox",
            startsAt: "2031-01-06T09:00:00.000Z",
            endsAt: "2031-01-06T10:00:00.000Z"
          }
        }
      ]
    };
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers,
      payload: createPayload
    });
    const replayed = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers,
      payload: createPayload
    });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(replayed.statusCode, 200, replayed.body);
    assert.equal(created.json().results[0].ok, true);
    assert.equal(replayed.json().results[0].id, created.json().results[0].id);

    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers,
      payload: {
        operations: [
          {
            ...createPayload.operations[0],
            data: {
              ...createPayload.operations[0].data,
              title: "Different payload"
            }
          }
        ]
      }
    });
    assert.equal(conflict.json().results[0].error.code, "idempotency_conflict");

    const betaTimebox = createTaskTimebox({
      taskId: beta.task.id,
      userId: beta.user.id,
      status: "planned",
      source: "manual",
      title: "Beta private timebox",
      startsAt: "2031-01-07T09:00:00.000Z",
      endsAt: "2031-01-07T10:00:00.000Z",
      overrideReason: null
    });
    for (const [url, payload] of [
      [
        "/api/v1/entities/update",
        {
          operations: [
            {
              entityType: "task_timebox",
              id: betaTimebox.id,
              patch: { title: "Cross-owner update" }
            }
          ]
        }
      ],
      [
        "/api/v1/entities/delete",
        {
          operations: [
            { entityType: "task_timebox", id: betaTimebox.id, mode: "hard" }
          ]
        }
      ]
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url,
        headers,
        payload
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(
        response.json().results[0].error.code,
        "not_found"
      );
    }

    const implicitSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers,
      payload: { searches: [{ query: "Scoped batch timebox" }] }
    });
    assert.equal(implicitSearch.statusCode, 200, implicitSearch.body);
    const matches = implicitSearch.json().results[0].matches as Array<{
      entityType: string;
      id: string;
    }>;
    assert.ok(
      matches.some(
        (match) =>
          match.entityType === "task_timebox" &&
          match.id === created.json().results[0].id
      )
    );
    assert.ok(!matches.some((match) => match.id === betaTimebox.id));

    const createdTimeboxId = created.json().results[0].id as string;
    storeEncryptedSecret(
      "secret_batch_delete",
      "sealed-test-secret",
      "PLAN-10 batch deletion fixture"
    );
    const projectionConnection = createCalendarConnectionRecord({
      provider: "google",
      label: "Batch delete projection",
      accountLabel: "batch-delete",
      config: {},
      credentialsSecretId: "secret_batch_delete",
      userId: alpha.user.id
    });
    const projectionClaim = claimTaskTimeboxProviderOperation({
      timeboxId: createdTimeboxId,
      connectionId: projectionConnection.id
    });
    assert.ok(projectionClaim);
    assert.equal(
      completeTaskTimeboxProviderOperation({
        timeboxId: createdTimeboxId,
        operation: "upsert",
        claimToken: projectionClaim.claimToken,
        claimVersion: projectionClaim.claimVersion,
        connectionId: projectionConnection.id,
        calendarId: null,
        remoteEventId: "remote_batch_delete"
      }),
      true
    );
    const deletePayload = {
      operations: [
        {
          entityType: "task_timebox",
          id: createdTimeboxId,
          mode: "hard"
        }
      ]
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const deleted = await app.inject({
        method: "POST",
        url: "/api/v1/entities/delete",
        headers,
        payload: deletePayload
      });
      assert.equal(deleted.statusCode, 200, deleted.body);
      assert.equal(deleted.json().results[0].ok, true, deleted.body);
      assert.equal(
        getEntityOwnerId("task_timebox", createdTimeboxId),
        alpha.user.id
      );
    }
    assert.equal(getTaskTimeboxById(createdTimeboxId), undefined);
    assert.ok(getTaskTimeboxByIdIncludingPendingDeletion(createdTimeboxId));
    const deleteClaim = claimTaskTimeboxProviderOperation({
      timeboxId: createdTimeboxId,
      connectionId: projectionConnection.id
    });
    assert.ok(deleteClaim);
    assert.equal(deleteClaim.operation, "delete");
    assert.equal(
      completeTaskTimeboxProviderOperation({
        timeboxId: createdTimeboxId,
        operation: "delete",
        claimToken: deleteClaim.claimToken,
        claimVersion: deleteClaim.claimVersion,
        connectionId: projectionConnection.id,
        calendarId: null,
        remoteEventId: null
      }),
      true
    );
    assert.equal(
      getTaskTimeboxByIdIncludingPendingDeletion(createdTimeboxId),
      undefined
    );
    assert.equal(getEntityOwnerId("task_timebox", createdTimeboxId), null);
  });
});

test("PLAN-10 provider imports inherit connection ownership and affect only that owner's recommendations", async () => {
  await withIsolatedForge(() => {
    const alpha = createPlanningFixture("provider-alpha");
    const beta = createPlanningFixture("provider-beta");
    const createImportedEvent = (input: {
      ownerId: string;
      suffix: string;
      title: string;
      startAt: string;
      endAt: string;
    }) => {
      storeEncryptedSecret(
        `secret_${input.suffix}`,
        "sealed-test-secret",
        "PLAN-10 provider fixture"
      );
      const connection = createCalendarConnectionRecord({
        provider: "google",
        label: `Connection ${input.suffix}`,
        accountLabel: input.suffix,
        config: {},
        credentialsSecretId: `secret_${input.suffix}`,
        userId: input.ownerId
      });
      upsertCalendarRecord(connection.id, {
        remoteId: `https://calendar.example/${input.suffix}/`,
        title: `Calendar ${input.suffix}`,
        timezone: "UTC",
        canWrite: true,
        selectedForSync: true
      });
      return upsertCalendarEventRecord(connection.id, {
        calendarRemoteId: `https://calendar.example/${input.suffix}/`,
        remoteId: `remote_${input.suffix}`,
        ownership: "external",
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        timezone: "UTC",
        availability: "busy"
      });
    };
    const alphaEvent = createImportedEvent({
      ownerId: alpha.user.id,
      suffix: "alpha",
      title: "Alpha provider meeting",
      startAt: "2031-02-03T08:00:00.000Z",
      endAt: "2031-02-03T09:00:00.000Z"
    });
    const betaEvent = createImportedEvent({
      ownerId: beta.user.id,
      suffix: "beta",
      title: "Beta provider meeting",
      startAt: "2031-02-03T09:00:00.000Z",
      endAt: "2031-02-03T10:00:00.000Z"
    });
    assert.equal(
      getEntityOwnerId("calendar_event", alphaEvent.id),
      alpha.user.id
    );
    assert.equal(
      getEntityOwnerId("calendar_event", betaEvent.id),
      beta.user.id
    );

    const alphaEvents = listCalendarEvents({
      from: "2031-02-03T00:00:00.000Z",
      to: "2031-02-04T00:00:00.000Z",
      userIds: [alpha.user.id]
    });
    assert.ok(alphaEvents.some((event) => event.id === alphaEvent.id));
    assert.ok(!alphaEvents.some((event) => event.id === betaEvent.id));

    const suggestions = suggestTaskTimeboxes(alpha.task.id, {
      from: "2031-02-03T06:00:00.000Z",
      to: "2031-02-03T12:00:00.000Z",
      timeZone: "UTC",
      limit: 6
    });
    assert.ok(
      suggestions.every(
        (slot) =>
          Date.parse(slot.endsAt) <= Date.parse(alphaEvent.startAt) ||
          Date.parse(slot.startsAt) >= Date.parse(alphaEvent.endAt)
      )
    );
    assert.ok(
      suggestions.some(
        (slot) =>
          Date.parse(slot.startsAt) < Date.parse(betaEvent.endAt) &&
          Date.parse(slot.endsAt) > Date.parse(betaEvent.startAt)
      )
    );
  });
});

test("PLAN-10 provider operations use one leased claim, reject tampering, recover after expiry, and delete only after acknowledgement", async () => {
  await withIsolatedForge(() => {
    const fixture = createPlanningFixture("projection-claim");
    const createProjectionConnection = (suffix: string) => {
      const secretId = `secret_projection_${suffix}`;
      storeEncryptedSecret(
        secretId,
        "sealed-test-secret",
        "PLAN-10 claim fixture"
      );
      const connection = createCalendarConnectionRecord({
        provider: "google",
        label: `Projection ${suffix}`,
        accountLabel: suffix,
        config: {},
        credentialsSecretId: secretId,
        userId: fixture.user.id
      });
      const calendar = upsertCalendarRecord(connection.id, {
        remoteId: `https://calendar.example/projection-${suffix}/`,
        title: `Projection ${suffix}`,
        timezone: "UTC",
        canWrite: true,
        selectedForSync: true,
        forgeManaged: true
      });
      return { connection, calendar };
    };
    const projectionA = createProjectionConnection("a");
    const projectionB = createProjectionConnection("b");
    const timebox = createTaskTimebox({
      taskId: fixture.task.id,
      userId: fixture.user.id,
      status: "planned",
      source: "manual",
      title: "Durable projection",
      startsAt: "2031-03-03T08:00:00.000Z",
      endsAt: "2031-03-03T09:00:00.000Z",
      overrideReason: null
    });
    assert.deepEqual(
      listTaskTimeboxProjectionCandidateIds({
        connectionId: projectionA.connection.id,
        from: "2031-03-03T00:00:00.000Z",
        to: "2031-03-04T00:00:00.000Z"
      }),
      [timebox.id]
    );
    const firstClaim = claimTaskTimeboxProviderOperation({
      timeboxId: timebox.id,
      connectionId: projectionA.connection.id,
      now: "2031-03-01T00:00:00.000Z",
      leaseMs: 1_000
    });
    assert.ok(firstClaim);
    assert.equal(
      claimTaskTimeboxProviderOperation({
        timeboxId: timebox.id,
        connectionId: projectionB.connection.id,
        now: "2031-03-01T00:00:00.500Z",
        leaseMs: 1_000
      }),
      null
    );
    assert.equal(
      completeTaskTimeboxProviderOperation({
        timeboxId: timebox.id,
        operation: "upsert",
        claimToken: "tampered",
        claimVersion: firstClaim.claimVersion,
        connectionId: projectionA.connection.id,
        calendarId: projectionA.calendar.id,
        remoteEventId: "remote_tampered"
      }),
      false
    );
    const recoveredClaim = claimTaskTimeboxProviderOperation({
      timeboxId: timebox.id,
      connectionId: projectionB.connection.id,
      now: "2031-03-01T00:00:02.000Z",
      leaseMs: 1_000
    });
    assert.ok(recoveredClaim);
    assert.ok(recoveredClaim.claimVersion > firstClaim.claimVersion);
    assert.equal(
      completeTaskTimeboxProviderOperation({
        timeboxId: timebox.id,
        operation: "upsert",
        claimToken: recoveredClaim.claimToken,
        claimVersion: recoveredClaim.claimVersion,
        connectionId: projectionB.connection.id,
        calendarId: projectionB.calendar.id,
        remoteEventId: "remote_b"
      }),
      true
    );
    assert.equal(getTaskTimeboxById(timebox.id)?.remoteEventId, "remote_b");

    updateTaskTimebox(timebox.id, { title: "Updated projection" });
    assert.equal(
      claimTaskTimeboxProviderOperation({
        timeboxId: timebox.id,
        connectionId: projectionA.connection.id
      }),
      null
    );
    const assignedClaim = claimTaskTimeboxProviderOperation({
      timeboxId: timebox.id,
      connectionId: projectionB.connection.id
    });
    assert.ok(assignedClaim);
    updateTaskTimebox(timebox.id, {
      title: "Changed while projection is claimed"
    });
    assert.equal(
      claimTaskTimeboxProviderOperation({
        timeboxId: timebox.id,
        connectionId: projectionB.connection.id
      }),
      null
    );
    assert.equal(
      completeTaskTimeboxProviderOperation({
        timeboxId: timebox.id,
        operation: "upsert",
        claimToken: assignedClaim.claimToken,
        claimVersion: assignedClaim.claimVersion,
        connectionId: projectionB.connection.id,
        calendarId: projectionB.calendar.id,
        remoteEventId: "remote_b"
      }),
      true
    );
    const retryClaim = claimTaskTimeboxProviderOperation({
      timeboxId: timebox.id,
      connectionId: projectionB.connection.id
    });
    assert.ok(retryClaim);
    assert.equal(
      retryClaim.timebox.title,
      "Changed while projection is claimed"
    );
    assert.equal(
      failTaskTimeboxProviderOperation({
        timeboxId: timebox.id,
        claimToken: retryClaim.claimToken,
        claimVersion: retryClaim.claimVersion,
        error: "provider timeout"
      }),
      true
    );

    deleteTaskTimebox(timebox.id);
    assert.equal(getTaskTimeboxById(timebox.id), undefined);
    assert.ok(getTaskTimeboxByIdIncludingPendingDeletion(timebox.id));
    const deleteClaim = claimTaskTimeboxProviderOperation({
      timeboxId: timebox.id,
      connectionId: projectionB.connection.id
    });
    assert.ok(deleteClaim);
    assert.equal(deleteClaim.operation, "delete");
    assert.equal(
      completeTaskTimeboxProviderOperation({
        timeboxId: timebox.id,
        operation: "delete",
        claimToken: "tampered-delete",
        claimVersion: deleteClaim.claimVersion,
        connectionId: projectionB.connection.id,
        calendarId: projectionB.calendar.id,
        remoteEventId: "remote_b"
      }),
      false
    );
    assert.ok(getTaskTimeboxByIdIncludingPendingDeletion(timebox.id));
    assert.equal(
      completeTaskTimeboxProviderOperation({
        timeboxId: timebox.id,
        operation: "delete",
        claimToken: deleteClaim.claimToken,
        claimVersion: deleteClaim.claimVersion,
        connectionId: projectionB.connection.id,
        calendarId: projectionB.calendar.id,
        remoteEventId: "remote_b"
      }),
      true
    );
    assert.equal(
      getTaskTimeboxByIdIncludingPendingDeletion(timebox.id),
      undefined
    );
    assert.equal(getEntityOwnerId("task_timebox", timebox.id), null);
  });
});

test("PLAN-10 task owner and project moves cascade to timeboxes and run binding is half-open", async () => {
  await withIsolatedForge(() => {
    const alpha = createPlanningFixture("cascade-alpha");
    const beta = createPlanningFixture("cascade-beta");
    const timebox = createTaskTimebox({
      taskId: alpha.task.id,
      userId: alpha.user.id,
      status: "planned",
      source: "manual",
      title: "Move with task",
      startsAt: "2031-04-01T09:00:00.000Z",
      endsAt: "2031-04-01T10:00:00.000Z",
      overrideReason: null
    });
    const moved = updateTask(alpha.task.id, {
      projectId: beta.project.id,
      goalId: beta.goal.id,
      userId: beta.user.id,
      owner: beta.user.displayName
    });
    assert.ok(moved);
    assert.equal(getTaskTimeboxById(timebox.id)?.projectId, beta.project.id);
    assert.equal(getEntityOwnerId("task_timebox", timebox.id), beta.user.id);

    updateTaskTimebox(timebox.id, { status: "cancelled" });
    assert.equal(
      findCoveringTimeboxForTask(
        alpha.task.id,
        new Date("2031-04-01T09:30:00.000Z")
      ),
      undefined
    );
    const active = createTaskTimebox({
      taskId: alpha.task.id,
      projectId: beta.project.id,
      userId: beta.user.id,
      status: "planned",
      source: "manual",
      title: "Half-open run window",
      startsAt: "2031-04-01T11:00:00.000Z",
      endsAt: "2031-04-01T12:00:00.000Z",
      overrideReason: null
    });
    assert.equal(
      findCoveringTimeboxForTask(
        alpha.task.id,
        new Date("2031-04-01T11:59:59.999Z")
      )?.id,
      active.id
    );
    assert.equal(
      findCoveringTimeboxForTask(
        alpha.task.id,
        new Date("2031-04-01T12:00:00.000Z")
      ),
      undefined
    );
  });
});
