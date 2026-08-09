import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { createGoal } from "./repositories/goals.js";
import { getNoteById } from "./repositories/notes.js";
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
  scopePolicy: { userIds: string[]; projectIds: string[]; tagIds: string[] },
  scopes = ["read", "write", "rewards.manage", "artifact.readMetadata"]
) {
  return createAgentToken(
    createAgentTokenSchema.parse({
      label: "PLAN-17 scoped task token",
      agentLabel: "PLAN-17 scoped task agent",
      scopes,
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

async function softDeleteEntity(input: {
  app: TestApp;
  cookie: string;
  entityType: string;
  entityId: string;
}) {
  const response = await input.app.inject({
    method: "POST",
    url: "/api/v1/entities/delete",
    headers: { cookie: input.cookie },
    payload: {
      operations: [
        {
          entityType: input.entityType,
          id: input.entityId,
          mode: "soft",
          reason: "PLAN-17 access regression"
        }
      ]
    }
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(
    (response.json() as { results: Array<{ ok: boolean }> }).results[0]?.ok,
    true,
    response.body
  );
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
    const deletedArtifactId = await uploadArtifact({
      app,
      cookie,
      title: "plan17-deleted-artifact",
      userId: allowed.user.id,
      projectId: allowed.project.id,
      tagId: allowed.tag.id
    });
    await softDeleteEntity({
      app,
      cookie,
      entityType: "artifact",
      entityId: deletedArtifactId
    });
    const token = await issueTaskToken(
      app,
      cookie,
      {
        userIds: [allowed.user.id],
        projectIds: [allowed.project.id],
        tagIds: [allowed.tag.id]
      },
      ["*"]
    );
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

    for (const artifactId of [
      hiddenArtifactId,
      deletedArtifactId,
      "artifact_missing_plan17"
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/operator/log-work",
        headers,
        payload: closeout(artifactId)
      });
      assert.equal(response.statusCode, 404, response.body);
      assert.deepEqual(response.json(), {
        code: "note_link_not_found",
        error: "Linked record not found.",
        statusCode: 404
      });
      assert.equal(getTaskById(task.id)?.completionReport, null);
      assert.deepEqual(getTaskById(task.id)?.gitRefs, []);
    }

    const hiddenNestedNote = {
      contentMarkdown: "Must not retain a hidden structured link.",
      links: [{ entityType: "artifact", entityId: hiddenArtifactId }]
    };
    const guardedRequests = [
      {
        method: "POST",
        url: "/api/v1/tasks",
        payload: {
          title: "PLAN-17 rejected direct task",
          userId: allowed.user.id,
          goalId: allowed.goal.id,
          projectId: allowed.project.id,
          tagIds: [allowed.tag.id],
          notes: [hiddenNestedNote]
        }
      },
      {
        method: "PATCH",
        url: `/api/v1/tasks/${task.id}`,
        payload: {
          title: "PLAN-17 rejected direct update",
          notes: [hiddenNestedNote]
        }
      },
      {
        method: "POST",
        url: "/api/v1/entities/create",
        payload: {
          operations: [
            {
              entityType: "task",
              data: {
                title: "PLAN-17 rejected batch task",
                userId: allowed.user.id,
                goalId: allowed.goal.id,
                projectId: allowed.project.id,
                tagIds: [allowed.tag.id],
                notes: [hiddenNestedNote]
              }
            }
          ]
        }
      },
      {
        method: "POST",
        url: "/api/v1/entities/update",
        payload: {
          operations: [
            {
              entityType: "task",
              id: task.id,
              patch: {
                title: "PLAN-17 rejected batch update",
                notes: [hiddenNestedNote]
              }
            }
          ]
        }
      }
    ] as const;
    for (const request of guardedRequests) {
      const response = await app.inject({ ...request, headers });
      assert.equal(
        response.statusCode,
        404,
        `${request.url}: ${response.body}`
      );
      assert.equal(response.json().code, "note_link_not_found");
    }
    assert.equal(
      listTasks().some((candidate) =>
        candidate.title.startsWith("PLAN-17 rejected")
      ),
      false
    );
    assert.equal(getTaskById(task.id)?.title, "PLAN-17 artifact closeout task");

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

test("PLAN-17 projects Note links for every read and preserves hidden links through edits", async () => {
  await withIsolatedForge(async (app) => {
    const allowed = createOwnedPlanningFixture("note-read-allowed");
    const foreign = createOwnedPlanningFixture("note-read-foreign");
    const allowedTask = createScopedTask({
      title: "PLAN-17 visible linked task",
      userId: allowed.user.id,
      owner: allowed.user.displayName,
      goalId: allowed.goal.id,
      projectId: allowed.project.id,
      tagId: allowed.tag.id
    });
    const foreignTask = createScopedTask({
      title: "PLAN-17 hidden linked task",
      userId: foreign.user.id,
      owner: foreign.user.displayName,
      goalId: foreign.goal.id,
      projectId: foreign.project.id,
      tagId: foreign.tag.id
    });
    const cookie = await issueOperatorCookie(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: { cookie },
      payload: {
        title: "PLAN-17 projected note",
        contentMarkdown: "Visible body with one inaccessible structured link.",
        userId: allowed.user.id,
        links: [
          {
            entityType: "task",
            entityId: allowedTask.id,
            anchorKey: "visible"
          },
          {
            entityType: "task",
            entityId: foreignTask.id,
            anchorKey: "hidden"
          }
        ]
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    const noteId = (created.json() as { note: { id: string } }).note.id;
    const token = await issueTaskToken(app, cookie, {
      userIds: [allowed.user.id],
      projectIds: [],
      tagIds: []
    });
    const headers = { authorization: `Bearer ${token}` };

    const assertProjectedNote = (
      note: {
        links: Array<{ entityType: string; entityId: string }>;
        unavailableLinkCount: number;
      },
      body: string
    ) => {
      assert.deepEqual(note.links, [
        {
          entityType: "task",
          entityId: allowedTask.id,
          anchorKey: "visible"
        }
      ]);
      assert.equal(note.unavailableLinkCount, 1);
      assert.equal(body.includes(foreignTask.id), false, body);
    };

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/notes/${noteId}`,
      headers
    });
    assert.equal(detail.statusCode, 200, detail.body);
    assertProjectedNote(
      (detail.json() as { note: Parameters<typeof assertProjectedNote>[0] })
        .note,
      detail.body
    );

    const page = await app.inject({
      method: "GET",
      url: `/api/v1/notes?userIds=${encodeURIComponent(allowed.user.id)}`,
      headers
    });
    assert.equal(page.statusCode, 200, page.body);
    const pageNote = (
      page.json() as { notes: Array<Parameters<typeof assertProjectedNote>[0]> }
    ).notes.find((note) =>
      note.links.some((link) => link.entityId === allowedTask.id)
    );
    assert.ok(pageNote);
    assertProjectedNote(pageNote, page.body);

    const hiddenFilter = await app.inject({
      method: "GET",
      url: `/api/v1/notes?linkedEntityType=task&linkedEntityId=${encodeURIComponent(foreignTask.id)}`,
      headers
    });
    assert.equal(hiddenFilter.statusCode, 200, hiddenFilter.body);
    assert.deepEqual(hiddenFilter.json(), {
      notes: [],
      total: 0,
      limit: 40,
      nextCursor: null,
      hasMore: false
    });
    const forbiddenOwnerFilter = await app.inject({
      method: "GET",
      url: `/api/v1/notes?userIds=${encodeURIComponent(foreign.user.id)}&linkedEntityType=task&linkedEntityId=${encodeURIComponent(foreignTask.id)}`,
      headers
    });
    assert.equal(
      forbiddenOwnerFilter.statusCode,
      403,
      forbiddenOwnerFilter.body
    );

    const batchSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers,
      payload: {
        searches: [{ entityTypes: ["note"], limit: 100 }]
      }
    });
    assert.equal(batchSearch.statusCode, 200, batchSearch.body);
    const batchNote = (
      batchSearch.json() as {
        results: Array<{
          matches: Array<{
            id: string;
            entity: Parameters<typeof assertProjectedNote>[0];
          }>;
        }>;
      }
    ).results[0]?.matches.find((match) => match.id === noteId);
    assert.ok(batchNote);
    assertProjectedNote(batchNote.entity, batchSearch.body);

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/operator/overview",
      headers
    });
    assert.equal(overview.statusCode, 200, overview.body);
    assert.match(overview.body, new RegExp(noteId));
    assert.equal(overview.body.includes(foreignTask.id), false);
    assert.match(overview.body, /"unavailableLinkCount":1/);

    const directUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/notes/${noteId}`,
      headers,
      payload: {
        summary: "Edited without seeing the hidden link.",
        links: [
          {
            entityType: "task",
            entityId: allowedTask.id,
            anchorKey: "visible"
          }
        ]
      }
    });
    assert.equal(directUpdate.statusCode, 200, directUpdate.body);
    assertProjectedNote(
      (
        directUpdate.json() as {
          note: Parameters<typeof assertProjectedNote>[0];
        }
      ).note,
      directUpdate.body
    );
    assert.equal(
      getNoteById(noteId)?.links.some(
        (link) => link.entityId === foreignTask.id
      ),
      true
    );

    const batchUpdate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers,
      payload: {
        operations: [
          {
            entityType: "note",
            id: noteId,
            patch: {
              contentMarkdown: "Edited again through the batch route.",
              links: [
                {
                  entityType: "task",
                  entityId: allowedTask.id,
                  anchorKey: "visible"
                }
              ]
            }
          }
        ]
      }
    });
    assert.equal(batchUpdate.statusCode, 200, batchUpdate.body);
    const batchUpdatedNote = (
      batchUpdate.json() as {
        results: Array<{
          ok: boolean;
          entity: Parameters<typeof assertProjectedNote>[0];
        }>;
      }
    ).results[0];
    assert.equal(batchUpdatedNote?.ok, true, batchUpdate.body);
    assert.ok(batchUpdatedNote?.entity);
    assertProjectedNote(batchUpdatedNote.entity, batchUpdate.body);
    const stored = getNoteById(noteId);
    assert.equal(stored?.links.length, 2);
    assert.equal(
      stored?.links.some((link) => link.entityId === foreignTask.id),
      true
    );
  });
});

test("PLAN-17 resolves exact terminal replay before current link validation", async () => {
  await withIsolatedForge(async (app) => {
    const fixture = createOwnedPlanningFixture("terminal-replay");
    const completionTask = createScopedTask({
      title: "PLAN-17 completion replay task",
      userId: fixture.user.id,
      owner: fixture.user.displayName,
      goalId: fixture.goal.id,
      projectId: fixture.project.id,
      tagId: fixture.tag.id
    });
    const releaseTask = createScopedTask({
      title: "PLAN-17 release replay task",
      userId: fixture.user.id,
      owner: fixture.user.displayName,
      goalId: fixture.goal.id,
      projectId: fixture.project.id,
      tagId: fixture.tag.id
    });
    const completionRun = claimTaskRun(completionTask.id, {
      actor: "PLAN-17 replay agent",
      leaseTtlSeconds: 900
    }).run;
    const cookie = await issueOperatorCookie(app);
    const completionArtifactId = await uploadArtifact({
      app,
      cookie,
      title: "plan17-completion-replay-artifact",
      userId: fixture.user.id,
      projectId: fixture.project.id,
      tagId: fixture.tag.id
    });
    const releaseArtifactId = await uploadArtifact({
      app,
      cookie,
      title: "plan17-release-replay-artifact",
      userId: fixture.user.id,
      projectId: fixture.project.id,
      tagId: fixture.tag.id
    });
    const token = await issueTaskToken(app, cookie, {
      userIds: [fixture.user.id],
      projectIds: [fixture.project.id],
      tagIds: [fixture.tag.id]
    });
    const headers = { authorization: `Bearer ${token}` };
    const completionPayload = {
      actor: "PLAN-17 replay agent",
      note: "Completed with durable evidence.",
      completionReport: {
        workSummary: "Verified exact terminal replay ordering.",
        modifiedFiles: ["apps/api/src/app.ts"],
        linkedGitRefIds: ["plan17-terminal-replay-ref"]
      },
      gitRefs: [
        {
          id: "plan17-terminal-replay-ref",
          refType: "commit",
          refValue: "plan17-terminal-replay-sha"
        }
      ],
      closeoutNote: {
        contentMarkdown: "Completion evidence linked to an Artifact.",
        links: [{ entityType: "artifact", entityId: completionArtifactId }]
      }
    };
    const completed = await app.inject({
      method: "POST",
      url: `/api/v1/task-runs/${completionRun.id}/complete`,
      headers,
      payload: completionPayload
    });
    assert.equal(completed.statusCode, 200, completed.body);
    await softDeleteEntity({
      app,
      cookie,
      entityType: "artifact",
      entityId: completionArtifactId
    });
    const completionReplay = await app.inject({
      method: "POST",
      url: `/api/v1/task-runs/${completionRun.id}/complete`,
      headers,
      payload: completionPayload
    });
    assert.equal(completionReplay.statusCode, 200, completionReplay.body);
    const changedCompletion = await app.inject({
      method: "POST",
      url: `/api/v1/task-runs/${completionRun.id}/complete`,
      headers,
      payload: {
        ...completionPayload,
        completionReport: {
          ...completionPayload.completionReport,
          workSummary: "Changed replay evidence must still conflict."
        }
      }
    });
    assert.equal(changedCompletion.statusCode, 409, changedCompletion.body);
    assert.equal(changedCompletion.json().code, "task_run_closeout_conflict");

    const releaseRun = claimTaskRun(releaseTask.id, {
      actor: "PLAN-17 replay agent",
      leaseTtlSeconds: 900
    }).run;
    const releasePayload = {
      actor: "PLAN-17 replay agent",
      note: "Paused with a durable handoff.",
      closeoutNote: {
        contentMarkdown: "Release evidence linked to an Artifact.",
        links: [{ entityType: "artifact", entityId: releaseArtifactId }]
      }
    };
    const released = await app.inject({
      method: "POST",
      url: `/api/v1/task-runs/${releaseRun.id}/release`,
      headers,
      payload: releasePayload
    });
    assert.equal(released.statusCode, 200, released.body);
    await softDeleteEntity({
      app,
      cookie,
      entityType: "artifact",
      entityId: releaseArtifactId
    });
    const releaseReplay = await app.inject({
      method: "POST",
      url: `/api/v1/task-runs/${releaseRun.id}/release`,
      headers,
      payload: releasePayload
    });
    assert.equal(releaseReplay.statusCode, 200, releaseReplay.body);
    const contentFreeReleaseReplay = await app.inject({
      method: "POST",
      url: `/api/v1/task-runs/${releaseRun.id}/release`,
      headers,
      payload: { actor: "PLAN-17 replay agent" }
    });
    assert.equal(
      contentFreeReleaseReplay.statusCode,
      409,
      contentFreeReleaseReplay.body
    );
    assert.equal(
      contentFreeReleaseReplay.json().code,
      "task_run_handoff_conflict"
    );
    const changedRelease = await app.inject({
      method: "POST",
      url: `/api/v1/task-runs/${releaseRun.id}/release`,
      headers,
      payload: { ...releasePayload, note: "Changed replay handoff." }
    });
    assert.equal(changedRelease.statusCode, 409, changedRelease.body);
    assert.equal(changedRelease.json().code, "task_run_handoff_conflict");
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
