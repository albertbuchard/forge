import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";

type TestApp = Awaited<ReturnType<typeof buildServer>>;

async function issueOperatorCookie(app: TestApp) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: { host: "127.0.0.1:4317" }
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

async function issueToken(
  app: TestApp,
  cookie: string,
  label: string,
  scopes: string[]
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label,
      agentLabel: label,
      agentType: "assistant",
      trustLevel: "standard",
      autonomyMode: "approval_required",
      approvalMode: "approval_by_default",
      scopes,
      scopePolicy: {
        userIds: ["user_operator"],
        projectIds: [],
        tagIds: []
      }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { token: { token: string } }).token.token;
}

function bearer(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "x-forge-source": "agent",
    "x-forge-actor": "Nested Note authorization test"
  };
}

const PSYCHE_NOTE = {
  contentMarkdown: "Sensitive nested evidence",
  links: [{ entityType: "belief_entry", entityId: "belief_private" }]
};

test("parent and task-run mutations cannot bypass Psyche Note authorization", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-nested-note-auth-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorCookie(app);
    const ordinaryToken = await issueToken(app, cookie, "Ordinary writer", [
      "read",
      "write",
      "rewards.manage"
    ]);
    const ordinaryHeaders = bearer(ordinaryToken);

    const securityResponse = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: { cookie },
      payload: { security: { psycheAuthRequired: true } }
    });
    assert.equal(securityResponse.statusCode, 200, securityResponse.body);

    const blockedGoalCreate = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: ordinaryHeaders,
      payload: {
        title: "Blocked nested-note goal",
        userId: "user_operator",
        notes: [PSYCHE_NOTE]
      }
    });
    assert.equal(blockedGoalCreate.statusCode, 403, blockedGoalCreate.body);

    const goalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: { cookie },
      payload: { title: "Authorized parent goal", userId: "user_operator" }
    });
    assert.equal(goalResponse.statusCode, 201, goalResponse.body);
    const goalId = (goalResponse.json() as { goal: { id: string } }).goal.id;

    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie },
      payload: {
        goalId,
        title: "Authorized parent project",
        userId: "user_operator"
      }
    });
    assert.equal(projectResponse.statusCode, 201, projectResponse.body);
    const projectId = (projectResponse.json() as { project: { id: string } })
      .project.id;

    const taskResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: { cookie },
      payload: {
        title: "Authorized parent task",
        goalId,
        projectId,
        userId: "user_operator"
      }
    });
    assert.equal(taskResponse.statusCode, 201, taskResponse.body);
    const task = (
      taskResponse.json() as { task: { id: string; title: string } }
    ).task;

    const blockedParentUpdates = [
      {
        method: "PATCH" as const,
        url: `/api/v1/goals/${goalId}`,
        payload: { title: "Forbidden goal title", notes: [PSYCHE_NOTE] }
      },
      {
        method: "PATCH" as const,
        url: `/api/v1/projects/${projectId}`,
        payload: { title: "Forbidden project title", notes: [PSYCHE_NOTE] }
      },
      {
        method: "PATCH" as const,
        url: `/api/v1/tasks/${task.id}`,
        payload: { title: "Forbidden task title", notes: [PSYCHE_NOTE] }
      }
    ];
    for (const mutation of blockedParentUpdates) {
      const response = await app.inject({
        ...mutation,
        headers: ordinaryHeaders
      });
      assert.equal(response.statusCode, 403, response.body);
      assert.equal(
        (response.json() as { code: string }).code,
        "insufficient_scope"
      );
    }

    const batchResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: ordinaryHeaders,
      payload: {
        atomic: true,
        operations: [
          {
            entityType: "goal",
            clientRef: "blocked-nested-note-goal",
            data: {
              title: "Blocked batch parent",
              userId: "user_operator",
              notes: [PSYCHE_NOTE]
            }
          }
        ]
      }
    });
    assert.equal(batchResponse.statusCode, 403, batchResponse.body);

    const claimResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${task.id}/runs`,
      headers: { cookie },
      payload: {
        actor: "Albert",
        timerMode: "unlimited",
        plannedDurationSeconds: null,
        leaseTtlSeconds: 900,
        note: "Work in progress"
      }
    });
    assert.equal(claimResponse.statusCode, 201, claimResponse.body);
    const runId = (claimResponse.json() as { taskRun: { id: string } }).taskRun
      .id;

    const blockedCompletion = await app.inject({
      method: "POST",
      url: `/api/v1/task-runs/${runId}/complete`,
      headers: ordinaryHeaders,
      payload: {
        actor: "Albert",
        note: "Attempted closeout",
        closeoutNote: PSYCHE_NOTE
      }
    });
    assert.equal(blockedCompletion.statusCode, 403, blockedCompletion.body);

    const blockedLogWork = await app.inject({
      method: "POST",
      url: "/api/v1/operator/log-work",
      headers: ordinaryHeaders,
      payload: {
        taskId: task.id,
        summary: "Attempted retroactive closeout",
        title: "Forbidden retroactive title",
        closeoutNote: PSYCHE_NOTE
      }
    });
    assert.equal(blockedLogWork.statusCode, 403, blockedLogWork.body);

    const taskRead = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${task.id}`,
      headers: { cookie }
    });
    assert.equal(taskRead.statusCode, 200, taskRead.body);
    const unchangedTask = (
      taskRead.json() as { task: { title: string; status: string } }
    ).task;
    assert.equal(unchangedTask.title, task.title);
    assert.equal(unchangedTask.status, "in_progress");

    const runRead = await app.inject({
      method: "GET",
      url: `/api/v1/task-runs?taskId=${encodeURIComponent(task.id)}`,
      headers: { cookie }
    });
    assert.equal(runRead.statusCode, 200, runRead.body);
    const runs = (
      runRead.json() as { taskRuns: Array<{ id: string; status: string }> }
    ).taskRuns;
    assert.equal(runs.find((run) => run.id === runId)?.status, "active");

    const notesRead = await app.inject({
      method: "GET",
      url: "/api/v1/notes?query=Sensitive%20nested%20evidence",
      headers: { cookie }
    });
    assert.equal(notesRead.statusCode, 200, notesRead.body);
    assert.deepEqual((notesRead.json() as { notes: unknown[] }).notes, []);

    const goalsRead = await app.inject({
      method: "GET",
      url: "/api/v1/goals",
      headers: { cookie }
    });
    assert.equal(goalsRead.statusCode, 200, goalsRead.body);
    assert.equal(
      (goalsRead.json() as { goals: Array<{ title: string }> }).goals.some(
        (goal) => goal.title === "Blocked nested-note goal"
      ),
      false
    );
    assert.equal(
      (goalsRead.json() as { goals: Array<{ title: string }> }).goals.some(
        (goal) => goal.title === "Blocked batch parent"
      ),
      false
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
