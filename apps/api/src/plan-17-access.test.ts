import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { createGoal } from "./repositories/goals.js";
import { createProject } from "./repositories/projects.js";
import { claimTaskRun } from "./repositories/task-runs.js";
import { createTag } from "./repositories/tags.js";
import { createTask, getTaskById, listTasks } from "./repositories/tasks.js";
import { createUser } from "./repositories/users.js";
import { createAgentToken } from "./repositories/settings.js";
import type { ApplicationSecurityRuntime } from "./security/application-security-runtime.js";
import { createAgentTokenSchema } from "./types.js";

type TestApp = Awaited<ReturnType<typeof buildServer>>;
const operatorAuthorities = new WeakMap<
  TestApp,
  { cookie: string; csrf: string }
>();

async function withIsolatedForge(run: (app: TestApp) => Promise<void> | void) {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-plan17-access-")
  );
  let security!: ApplicationSecurityRuntime;
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    devrageMetricSync: false,
    onSecurityRuntimeReady(runtime) {
      security = runtime;
    }
  });
  const ownerEpoch = security.store.readOwnerSecurityEpoch("user_operator");
  assert.ok(ownerEpoch);
  const session = security.browserSessions.create({
    kind: "operator_session",
    subjectId: "user_operator",
    ownerId: "user_operator",
    clientId: null,
    installationId: null,
    audience: security.audience,
    scopes: ["*"],
    profile: "operator",
    ownerSecurityEpoch: ownerEpoch,
    clientSecurityEpoch: null,
    authenticatedAt: new Date().toISOString()
  });
  const authority = {
    cookie: `forge_session=${encodeURIComponent(session.sessionToken)}`,
    csrf: session.csrfToken
  };
  operatorAuthorities.set(app, authority);
  const inject = app.inject.bind(app);
  app.inject = ((options: {
    method?: string;
    headers?: Record<string, string>;
    [key: string]: unknown;
  }) => {
    const headers = {
      ...(options.headers ?? {})
    };
    if (
      headers.cookie === authority.cookie &&
      !["GET", "HEAD", "OPTIONS"].includes(
        String(options.method ?? "GET").toUpperCase()
      )
    ) {
      headers["x-forge-csrf"] = authority.csrf;
    }
    return inject({
      remoteAddress: "127.0.0.1",
      ...options,
      headers
    } as never);
  }) as unknown as typeof app.inject;
  try {
    await run(app);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

async function issueOperatorCookie(app: TestApp) {
  const authority = operatorAuthorities.get(app);
  assert.ok(authority);
  return authority.cookie;
}

async function issueTaskToken(
  _app: TestApp,
  _cookie: string,
  scopePolicy: { userIds: string[]; projectIds: string[]; tagIds: string[] }
) {
  return createAgentToken(
    createAgentTokenSchema.parse({
      label: "PLAN-17 scoped task token",
      agentLabel: "PLAN-17 scoped task agent",
      scopes: ["read", "write", "rewards.manage", "artifact.readMetadata"],
      scopePolicy
    }),
    { actor: "PLAN-17 test", source: "system" }
  ).token;
}

function createOwnedPlanningFixture(label: string) {
  const user = createUser({
    kind: "human",
    handle: `plan17-access-${label}`,
    displayName: `PLAN-17 ${label}`,
    description: "",
    accentColor: "#336699"
  });
  const goal = createGoal({
    title: `PLAN-17 access goal ${label}`,
    description: "",
    horizon: "year",
    status: "active",
    targetPoints: 200,
    themeColor: "#336699",
    tagIds: [],
    notes: [],
    userId: user.id
  });
  const project = createProject({
    goalId: goal.id,
    title: `PLAN-17 access project ${label}`,
    userId: user.id
  });
  const tag = createTag({
    name: `plan17-access-${label}`,
    kind: "execution",
    color: "#336699",
    description: "",
    userId: user.id
  });
  return { user, goal, project, tag };
}

function createScopedTask(input: {
  title: string;
  userId: string;
  owner: string;
  goalId: string;
  projectId: string;
  tagId: string;
}) {
  return createTask({
    title: input.title,
    userId: input.userId,
    owner: input.owner,
    goalId: input.goalId,
    projectId: input.projectId,
    tagIds: [input.tagId]
  });
}

async function uploadArtifact(input: {
  app: TestApp;
  cookie: string;
  title: string;
  userId: string;
  projectId: string;
  tagId: string;
}) {
  const response = await input.app.inject({
    method: "POST",
    url: "/api/v1/artifacts",
    headers: { cookie: input.cookie },
    payload: {
      title: input.title,
      originalFileName: `${input.title}.txt`,
      declaredMimeType: "text/plain",
      actingForUserId: input.userId,
      contentBase64: Buffer.from(input.title).toString("base64"),
      links: [
        {
          entityType: "project",
          entityId: input.projectId,
          relationship: "project_context"
        },
        {
          entityType: "tag",
          entityId: input.tagId,
          relationship: "tag_context"
        }
      ]
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { artifact: { id: string } }).artifact.id;
}

function taskIds(
  response: { json: () => unknown },
  key: "tasks" | "workItems"
) {
  return (response.json() as Record<string, Array<{ id: string }>>)[key]!.map(
    (task) => task.id
  );
}

test("PLAN-17 enforces user, project, and tag scope across task, batch, and run routes", async () => {
  await withIsolatedForge(async (app) => {
    const allowed = createOwnedPlanningFixture("allowed");
    const foreign = createOwnedPlanningFixture("foreign");
    const otherProject = createProject({
      goalId: allowed.goal.id,
      title: "PLAN-17 other project",
      userId: allowed.user.id
    });
    const otherTag = createTag({
      name: "plan17-access-other-tag",
      kind: "execution",
      color: "#663399",
      description: "",
      userId: allowed.user.id
    });
    const allowedTask = createScopedTask({
      title: "PLAN-17 allowed task",
      userId: allowed.user.id,
      owner: allowed.user.displayName,
      goalId: allowed.goal.id,
      projectId: allowed.project.id,
      tagId: allowed.tag.id
    });
    const wrongProjectTask = createScopedTask({
      title: "PLAN-17 wrong project task",
      userId: allowed.user.id,
      owner: allowed.user.displayName,
      goalId: allowed.goal.id,
      projectId: otherProject.id,
      tagId: allowed.tag.id
    });
    const wrongTagTask = createScopedTask({
      title: "PLAN-17 wrong tag task",
      userId: allowed.user.id,
      owner: allowed.user.displayName,
      goalId: allowed.goal.id,
      projectId: allowed.project.id,
      tagId: otherTag.id
    });
    const foreignTask = createScopedTask({
      title: "PLAN-17 foreign user task",
      userId: foreign.user.id,
      owner: foreign.user.displayName,
      goalId: foreign.goal.id,
      projectId: foreign.project.id,
      tagId: foreign.tag.id
    });
    const allowedRun = claimTaskRun(allowedTask.id, {
      actor: "Allowed agent",
      leaseTtlSeconds: 900
    }).run;
    const foreignRun = claimTaskRun(foreignTask.id, {
      actor: "Foreign agent",
      leaseTtlSeconds: 900
    }).run;

    const cookie = await issueOperatorCookie(app);
    const token = await issueTaskToken(app, cookie, {
      userIds: [allowed.user.id],
      projectIds: [allowed.project.id],
      tagIds: [allowed.tag.id]
    });
    const headers = { authorization: `Bearer ${token}` };
    const projectToken = await issueTaskToken(app, cookie, {
      userIds: [allowed.user.id],
      projectIds: [allowed.project.id],
      tagIds: []
    });
    const projectHeaders = {
      authorization: `Bearer ${projectToken}`
    };

    const projectList = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: projectHeaders
    });
    assert.equal(projectList.statusCode, 200, projectList.body);
    assert.deepEqual(
      (projectList.json() as { projects: Array<{ id: string }> }).projects.map(
        (project) => project.id
      ),
      [allowed.project.id]
    );
    for (const request of [
      {
        method: "GET",
        url: `/api/v1/projects/${foreign.project.id}`
      },
      {
        method: "PATCH",
        url: `/api/v1/projects/${foreign.project.id}`,
        payload: { title: "PLAN-17 forbidden project update" }
      },
      {
        method: "DELETE",
        url: `/api/v1/projects/${foreign.project.id}`
      }
    ] as const) {
      const response = await app.inject({
        ...request,
        headers: projectHeaders
      });
      assert.equal(response.statusCode, 404, response.body);
    }

    for (const route of [
      `/api/v1/tasks/${wrongProjectTask.id}`,
      `/api/v1/tasks/${wrongTagTask.id}`,
      `/api/v1/tasks/${foreignTask.id}`,
      `/api/tasks/${foreignTask.id}`,
      `/api/v1/work-items/${foreignTask.id}`,
      `/api/v1/tasks/${foreignTask.id}/context`,
      `/api/v1/work-items/${foreignTask.id}/context`
    ]) {
      const response = await app.inject({ method: "GET", url: route, headers });
      assert.equal(response.statusCode, 404, `${route}: ${response.body}`);
    }

    for (const [route, key] of [
      ["/api/v1/tasks", "tasks"],
      ["/api/tasks", "tasks"],
      ["/api/v1/work-items", "workItems"]
    ] as const) {
      const response = await app.inject({ method: "GET", url: route, headers });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(taskIds(response, key), [allowedTask.id]);
    }

    const runs = await app.inject({
      method: "GET",
      url: "/api/v1/task-runs",
      headers
    });
    assert.equal(runs.statusCode, 200, runs.body);
    assert.deepEqual(
      (runs.json() as { taskRuns: Array<{ id: string }> }).taskRuns.map(
        (run) => run.id
      ),
      [allowedRun.id]
    );

    const forbiddenCreateTitle = "PLAN-17 forbidden create";
    const forbiddenCreate = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers,
      payload: {
        title: forbiddenCreateTitle,
        userId: allowed.user.id,
        goalId: allowed.goal.id,
        projectId: otherProject.id,
        tagIds: [allowed.tag.id]
      }
    });
    assert.equal(forbiddenCreate.statusCode, 403, forbiddenCreate.body);
    assert.equal(
      listTasks().some((task) => task.title === forbiddenCreateTitle),
      false
    );

    const forbiddenMove = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${allowedTask.id}`,
      headers,
      payload: { projectId: otherProject.id }
    });
    assert.equal(forbiddenMove.statusCode, 403, forbiddenMove.body);
    assert.equal(getTaskById(allowedTask.id)?.projectId, allowed.project.id);

    for (const request of [
      { method: "DELETE", url: `/api/v1/tasks/${foreignTask.id}` },
      {
        method: "POST",
        url: `/api/v1/tasks/${foreignTask.id}/split`,
        payload: { firstTitle: "One", secondTitle: "Two" }
      },
      {
        method: "POST",
        url: `/api/v1/tasks/${foreignTask.id}/runs`,
        payload: { actor: "Scoped agent" }
      },
      {
        method: "POST",
        url: `/api/v1/task-runs/${foreignRun.id}/heartbeat`,
        payload: {}
      },
      {
        method: "POST",
        url: `/api/v1/task-runs/${foreignRun.id}/complete`,
        payload: {}
      },
      {
        method: "POST",
        url: `/api/v1/task-runs/${foreignRun.id}/release`,
        payload: {}
      }
    ] as const) {
      const response = await app.inject({ ...request, headers });
      assert.equal(
        response.statusCode,
        404,
        `${request.url}: ${response.body}`
      );
    }

    const batchSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers,
      payload: {
        searches: [{ entityTypes: ["task"], limit: 100 }]
      }
    });
    assert.equal(batchSearch.statusCode, 200, batchSearch.body);
    const matches = (
      batchSearch.json() as {
        results: Array<{ matches: Array<{ id: string }> }>;
      }
    ).results[0]!.matches;
    assert.deepEqual(
      matches.map((match) => match.id),
      [allowedTask.id]
    );

    const batchUpdate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers,
      payload: {
        operations: [
          {
            entityType: "task",
            id: foreignTask.id,
            patch: { title: "PLAN-17 leaked update" }
          }
        ]
      }
    });
    assert.equal(batchUpdate.statusCode, 200, batchUpdate.body);
    assert.equal(
      (batchUpdate.json() as { results: Array<{ ok: boolean }> }).results[0]
        ?.ok,
      false
    );
    assert.equal(
      getTaskById(foreignTask.id)?.title,
      "PLAN-17 foreign user task"
    );

    const logForeign = await app.inject({
      method: "POST",
      url: "/api/v1/operator/log-work",
      headers,
      payload: { taskId: foreignTask.id, summary: "Should stay hidden" }
    });
    assert.equal(logForeign.statusCode, 404, logForeign.body);
  });
});

test("PLAN-17 closeout Artifact links enforce visibility without existence oracles", async () => {
  await withIsolatedForge(async (app) => {
    const allowed = createOwnedPlanningFixture("artifact-allowed");
    const foreign = createOwnedPlanningFixture("artifact-foreign");
    const task = createScopedTask({
      title: "PLAN-17 artifact closeout task",
      userId: allowed.user.id,
      owner: allowed.user.displayName,
      goalId: allowed.goal.id,
      projectId: allowed.project.id,
      tagId: allowed.tag.id
    });
    const cookie = await issueOperatorCookie(app);
    const visibleArtifactId = await uploadArtifact({
      app,
      cookie,
      title: "plan17-visible-artifact",
      userId: allowed.user.id,
      projectId: allowed.project.id,
      tagId: allowed.tag.id
    });
    const hiddenArtifactId = await uploadArtifact({
      app,
      cookie,
      title: "plan17-hidden-artifact",
      userId: foreign.user.id,
      projectId: foreign.project.id,
      tagId: foreign.tag.id
    });
    const token = await issueTaskToken(app, cookie, {
      userIds: [allowed.user.id],
      projectIds: [allowed.project.id],
      tagIds: [allowed.tag.id]
    });
    const headers = { authorization: `Bearer ${token}` };
    const closeout = (artifactId: string) => ({
      taskId: task.id,
      completionReport: {
        workSummary: "Completed with visible Artifact evidence.",
        modifiedFiles: ["apps/api/src/app.ts"],
        linkedGitRefIds: ["plan17-artifact-ref"]
      },
      gitRefs: [
        {
          id: "plan17-artifact-ref",
          refType: "commit",
          refValue: "abc123"
        }
      ],
      closeoutNote: {
        contentMarkdown: "Artifact-backed closeout.",
        links: [{ entityType: "artifact", entityId: artifactId }]
      }
    });

    for (const artifactId of [hiddenArtifactId, "artifact_missing_plan17"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/operator/log-work",
        headers,
        payload: closeout(artifactId)
      });
      assert.equal(response.statusCode, 404, response.body);
      assert.equal(response.json().code, "artifact_not_found");
      assert.equal(getTaskById(task.id)?.completionReport, null);
      assert.deepEqual(getTaskById(task.id)?.gitRefs, []);
    }

    const visible = await app.inject({
      method: "POST",
      url: "/api/v1/operator/log-work",
      headers,
      payload: closeout(visibleArtifactId)
    });
    assert.equal(visible.statusCode, 200, visible.body);
    const saved = (visible.json() as { task: { closeoutState: string } }).task;
    assert.equal(saved.closeoutState, "complete");
  });
});

test("PLAN-17 Git helper and watchdog routes require operator auth and enforce bounds", async () => {
  await withIsolatedForge(async (app) => {
    const fixture = createOwnedPlanningFixture("operator-auth");
    const cookie = await issueOperatorCookie(app);
    const token = await issueTaskToken(app, cookie, {
      userIds: [fixture.user.id],
      projectIds: [fixture.project.id],
      tagIds: [fixture.tag.id]
    });
    const bearer = { authorization: `Bearer ${token}` };

    for (const route of [
      "/api/v1/git-helper/overview",
      "/api/v1/git-helper/search?kind=branch",
      "/api/task-runs/watchdog"
    ]) {
      const anonymous = await app.inject({ method: "GET", url: route });
      assert.equal(anonymous.statusCode, 401, `${route}: ${anonymous.body}`);
      const tokenOnly = await app.inject({
        method: "GET",
        url: route,
        headers: bearer
      });
      assert.equal(tokenOnly.statusCode, 403, `${route}: ${tokenOnly.body}`);
    }

    for (const route of [
      "/api/task-runs/watchdog/reconcile",
      "/api/task-runs/recover"
    ]) {
      const anonymous = await app.inject({
        method: "POST",
        url: route,
        payload: {}
      });
      assert.equal(anonymous.statusCode, 401, `${route}: ${anonymous.body}`);
      const tokenOnly = await app.inject({
        method: "POST",
        url: route,
        headers: bearer,
        payload: {}
      });
      assert.equal(tokenOnly.statusCode, 403, `${route}: ${tokenOnly.body}`);
    }

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/git-helper/overview",
      headers: { cookie }
    });
    assert.equal(overview.statusCode, 200, overview.body);
    assert.equal(overview.body.includes("repoRoot"), false);
    assert.equal(overview.body.includes("/Users/"), false);

    for (const query of [
      `kind=branch&query=${"q".repeat(201)}`,
      "kind=branch&limit=26",
      "kind=branch&repository=../../private",
      "kind=branch&repository=other/repository"
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/git-helper/search?${query}`,
        headers: { cookie }
      });
      assert.equal(response.statusCode, 400, `${query}: ${response.body}`);
    }

    const watchdog = await app.inject({
      method: "GET",
      url: "/api/task-runs/watchdog",
      headers: { cookie }
    });
    assert.equal(watchdog.statusCode, 200, watchdog.body);
    const recovery = await app.inject({
      method: "POST",
      url: "/api/task-runs/recover",
      headers: { cookie },
      payload: { limit: 1 }
    });
    assert.equal(recovery.statusCode, 200, recovery.body);
  });
});
