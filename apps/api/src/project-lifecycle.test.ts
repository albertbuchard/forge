import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { listActivityEvents } from "./repositories/activity-events.js";
import { listNotes } from "./repositories/notes.js";
import {
  createProject,
  planProjectLifecycleTransition
} from "./repositories/projects.js";
import { createTask, getTaskById } from "./repositories/tasks.js";
import type { Note, Project, Task, WorkItemLevel } from "./types.js";

const statuses = ["active", "paused", "completed"] as const;

async function issueOperatorSessionCookie(
  app: Awaited<ReturnType<typeof buildServer>>
) {
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

async function withTestServer(
  run: (app: Awaited<ReturnType<typeof buildServer>>) => Promise<void>
) {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-project-lifecycle-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    await run(app);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
}

function firstGoalId() {
  const row = getDatabase()
    .prepare("SELECT id FROM goals ORDER BY created_at ASC LIMIT 1")
    .get() as { id: string } | undefined;
  assert.ok(row);
  return row.id;
}

function createLifecycleProject(title: string) {
  return createProject(
    {
      goalId: firstGoalId(),
      title,
      description: "Exercises project lifecycle side effects.",
      status: "active",
      workflowStatus: "in_progress",
      assigneeUserIds: [],
      targetPoints: 100,
      themeColor: "#c0c1ff",
      productRequirementsDocument: "",
      schedulingRules: {
        allowWorkBlockKinds: [],
        blockWorkBlockKinds: [],
        allowCalendarIds: [],
        blockCalendarIds: [],
        allowEventTypes: [],
        blockEventTypes: [],
        allowEventKeywords: [],
        blockEventKeywords: [],
        allowAvailability: [],
        blockAvailability: []
      },
      notes: []
    },
    { source: "ui", actor: "Lifecycle test" }
  );
}

function createWorkItem(options: {
  project: Project;
  title: string;
  level: WorkItemLevel;
  parentWorkItemId?: string | null;
  status?: Task["status"];
}) {
  return createTask(
    {
      title: options.title,
      description: "Lifecycle test work item.",
      level: options.level,
      status: options.status ?? "focus",
      priority: "medium",
      owner: "Albert",
      goalId: options.project.goalId,
      projectId: options.project.id,
      parentWorkItemId: options.parentWorkItemId ?? null,
      dueDate: null,
      effort: "light",
      energy: "steady",
      points: 10,
      plannedDurationSeconds: 900,
      schedulingRules: null,
      sortOrder: 0,
      aiInstructions: "",
      executionMode: null,
      acceptanceCriteria: [],
      blockerLinks: [],
      completionReport: null,
      gitRefs: [],
      assigneeUserIds: [],
      tagIds: [],
      notes: []
    },
    { source: "ui", actor: "Lifecycle test" }
  );
}

function rewardCount(taskIds: string[]) {
  if (taskIds.length === 0) {
    return 0;
  }
  const placeholders = taskIds.map(() => "?").join(", ");
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM reward_ledger
       WHERE entity_type = 'task'
         AND entity_id IN (${placeholders})
         AND delta_xp > 0`
    )
    .get(...taskIds) as { count: number };
  return row.count;
}

test("project lifecycle transition matrix only cascades on first entry into completed", () => {
  for (const previousStatus of statuses) {
    for (const nextStatus of statuses) {
      const plan = planProjectLifecycleTransition(previousStatus, nextStatus);
      assert.deepEqual(plan, {
        previousStatus,
        nextStatus,
        autoCompleteLinkedWorkItems:
          previousStatus !== "completed" && nextStatus === "completed"
      });
    }
  }
});

test("project closeout persists one owned Note with exact generic links and no fabricated task evidence", async () => {
  await withTestServer(async (app) => {
    const cookie = await issueOperatorSessionCookie(app);
    const project = createLifecycleProject("Closeout note project");
    const issue = createWorkItem({
      project,
      title: "Closeout issue",
      level: "issue"
    });
    const taskItem = createWorkItem({
      project,
      title: "Closeout task",
      level: "task",
      parentWorkItemId: issue.id
    });
    const contentMarkdown = [
      "## PLAN-17 closeout",
      "",
      "The durable project evidence is linked without inventing child evidence."
    ].join("\n");
    const suppliedLinks = [
      {
        entityType: "artifact" as const,
        entityId: "artifact_plan_17_closeout",
        anchorKey: "final-evidence"
      },
      {
        entityType: "goal" as const,
        entityId: project.goalId,
        anchorKey: "outcome"
      }
    ];

    const closeout = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: { cookie },
      payload: {
        title: "Closed with durable evidence",
        status: "completed",
        notes: [
          {
            contentMarkdown,
            author: "PLAN-17 closeout test",
            tags: ["closeout", "plan-17"],
            destroyAt: null,
            links: suppliedLinks
          }
        ]
      }
    });
    assert.equal(closeout.statusCode, 200, closeout.body);

    const readBack = await app.inject({
      method: "GET",
      url: `/api/v1/notes?linkedEntityType=project&linkedEntityId=${project.id}`,
      headers: { cookie }
    });
    assert.equal(readBack.statusCode, 200, readBack.body);
    const notes = (readBack.json() as { notes: Note[] }).notes;
    assert.equal(notes.length, 1);
    const [note] = notes;
    assert.ok(note);
    assert.deepEqual(
      {
        contentMarkdown: note.contentMarkdown,
        author: note.author,
        source: note.source,
        tags: note.tags,
        destroyAt: note.destroyAt,
        userId: note.userId
      },
      {
        contentMarkdown,
        author: "PLAN-17 closeout test",
        source: "ui",
        tags: ["closeout", "plan-17"],
        destroyAt: null,
        userId: project.userId
      }
    );
    assert.deepEqual(
      note.links
        .map(
          (link) =>
            `${link.entityType}:${link.entityId}:${link.anchorKey ?? ""}`
        )
        .sort(),
      [
        `project:${project.id}:`,
        ...suppliedLinks.map(
          (link) => `${link.entityType}:${link.entityId}:${link.anchorKey}`
        )
      ].sort()
    );

    const noteEvent = listActivityEvents({
      entityType: "project",
      entityId: project.id
    }).find(
      (event) =>
        event.eventType === "note.created" && event.metadata.noteId === note.id
    );
    assert.ok(noteEvent);
    assert.equal(noteEvent.actor, "PLAN-17 closeout test");
    assert.equal(noteEvent.source, "ui");

    for (const workItemId of [issue.id, taskItem.id]) {
      const workItem = getTaskById(workItemId);
      assert.equal(workItem?.status, "done");
      assert.equal(workItem?.completionReport, null);
      assert.deepEqual(workItem?.gitRefs, []);
      assert.equal(
        listNotes({
          linkedEntityType: "task",
          linkedEntityId: workItemId
        }).length,
        0
      );
    }
  });
});

test("project completion cascades once and records exact lifecycle audit evidence", async () => {
  await withTestServer(async (app) => {
    const cookie = await issueOperatorSessionCookie(app);
    const project = createLifecycleProject("Auditable lifecycle project");
    const issue = createWorkItem({
      project,
      title: "Open issue",
      level: "issue"
    });
    const taskItem = createWorkItem({
      project,
      title: "Blocked task",
      level: "task",
      parentWorkItemId: issue.id,
      status: "blocked"
    });
    const subtask = createWorkItem({
      project,
      title: "Open subtask",
      level: "subtask",
      parentWorkItemId: taskItem.id
    });
    const alreadyDone = createWorkItem({
      project,
      title: "Already done issue",
      level: "issue",
      status: "done"
    });
    const cascadedIds = [issue.id, taskItem.id, subtask.id];

    const pause = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: { cookie },
      payload: { status: "paused" }
    });
    assert.equal(pause.statusCode, 200, pause.body);
    assert.equal(getTaskById(issue.id)?.status, "focus");

    const complete = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: { cookie },
      payload: { status: "completed" }
    });
    assert.equal(complete.statusCode, 200, complete.body);
    assert.equal(getTaskById(alreadyDone.id)?.status, "done");
    for (const taskId of cascadedIds) {
      assert.equal(getTaskById(taskId)?.status, "done");
    }

    const projectEvents = listActivityEvents({
      entityType: "project",
      entityId: project.id
    });
    const completionEvent = projectEvents.find(
      (event) =>
        event.eventType === "project_status_changed" &&
        event.metadata.status === "completed"
    );
    assert.ok(completionEvent);
    assert.equal(completionEvent.metadata.completedLinkedTaskCount, 3);
    assert.deepEqual(
      new Set(completionEvent.metadata.autoCompletedWorkItemIds as string[]),
      new Set(cascadedIds)
    );
    assert.deepEqual(completionEvent.metadata.lifecyclePlan, {
      previousStatus: "paused",
      nextStatus: "completed",
      autoCompleteLinkedWorkItems: true
    });

    for (const taskId of cascadedIds) {
      const taskCompletion = listActivityEvents({
        entityType: "task",
        entityId: taskId
      }).find((event) => event.eventType === "task_completed");
      assert.ok(taskCompletion);
      assert.deepEqual(taskCompletion.metadata.lifecycleCause, {
        kind: "project_completion",
        projectId: project.id,
        previousProjectStatus: "paused"
      });
    }
    assert.equal(rewardCount(cascadedIds), cascadedIds.length);

    const retry = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: { cookie },
      payload: { status: "completed" }
    });
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal(rewardCount(cascadedIds), cascadedIds.length);
    assert.equal(
      listActivityEvents({
        entityType: "project",
        entityId: project.id
      }).filter(
        (event) =>
          event.eventType === "project_status_changed" &&
          event.metadata.status === "completed"
      ).length,
      1
    );
    for (const taskId of cascadedIds) {
      assert.equal(
        listActivityEvents({ entityType: "task", entityId: taskId }).filter(
          (event) => event.eventType === "task_completed"
        ).length,
        1
      );
    }
  });
});

test("project completion rolls back every side effect and succeeds once on retry", async () => {
  await withTestServer(async (app) => {
    const cookie = await issueOperatorSessionCookie(app);
    const project = createLifecycleProject("Atomic lifecycle project");
    const issue = createWorkItem({
      project,
      title: "First update",
      level: "issue"
    });
    const failingTask = createWorkItem({
      project,
      title: "Injected failure",
      level: "task",
      parentWorkItemId: issue.id
    });
    const taskIds = [issue.id, failingTask.id];
    const database = getDatabase();
    database.exec(`
      CREATE TRIGGER fail_project_lifecycle_task_update
      BEFORE UPDATE OF status ON tasks
      WHEN NEW.id = '${failingTask.id}' AND NEW.status = 'done'
      BEGIN
        SELECT RAISE(ABORT, 'injected project lifecycle failure');
      END;
    `);

    const failed = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: { cookie },
      payload: { status: "completed" }
    });
    assert.equal(failed.statusCode, 500, failed.body);
    assert.equal(
      (
        database
          .prepare("SELECT status FROM projects WHERE id = ?")
          .get(project.id) as {
          status: string;
        }
      ).status,
      "active"
    );
    for (const taskId of taskIds) {
      assert.notEqual(getTaskById(taskId)?.status, "done");
      assert.equal(
        listActivityEvents({ entityType: "task", entityId: taskId }).filter(
          (event) => event.eventType === "task_completed"
        ).length,
        0
      );
    }
    assert.equal(rewardCount(taskIds), 0);
    assert.equal(
      listActivityEvents({
        entityType: "project",
        entityId: project.id
      }).filter(
        (event) =>
          event.eventType === "project_status_changed" &&
          event.metadata.status === "completed"
      ).length,
      0
    );

    database.exec("DROP TRIGGER fail_project_lifecycle_task_update");
    const retry = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: { cookie },
      payload: { status: "completed" }
    });
    assert.equal(retry.statusCode, 200, retry.body);
    for (const taskId of taskIds) {
      assert.equal(getTaskById(taskId)?.status, "done");
    }
    assert.equal(rewardCount(taskIds), taskIds.length);
  });
});

test("a nested closeout Note failure rolls back project and task transitions before a clean retry", async () => {
  await withTestServer(async (app) => {
    const cookie = await issueOperatorSessionCookie(app);
    const originalTitle = "Atomic closeout note project";
    const project = createLifecycleProject(originalTitle);
    const issue = createWorkItem({
      project,
      title: "Atomic closeout issue",
      level: "issue"
    });
    const taskItem = createWorkItem({
      project,
      title: "Atomic closeout task",
      level: "task",
      parentWorkItemId: issue.id
    });
    const taskIds = [issue.id, taskItem.id];
    const contentMarkdown = "PLAN-17 injected Note failure";
    const payload = {
      title: "Title that must roll back",
      status: "completed" as const,
      notes: [
        {
          contentMarkdown,
          links: [
            {
              entityType: "artifact" as const,
              entityId: "artifact_retry_evidence",
              anchorKey: "retry"
            }
          ]
        }
      ]
    };
    const database = getDatabase();
    database.exec(`
      CREATE TRIGGER fail_project_closeout_note_insert
      BEFORE INSERT ON notes
      WHEN NEW.content_markdown = '${contentMarkdown}'
      BEGIN
        SELECT RAISE(ABORT, 'injected project closeout Note failure');
      END;
    `);

    const failed = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: { cookie },
      payload
    });
    assert.equal(failed.statusCode, 500, failed.body);
    assert.deepEqual(
      {
        ...(database
          .prepare("SELECT title, status FROM projects WHERE id = ?")
          .get(project.id) as { title: string; status: string })
      },
      { title: originalTitle, status: "active" }
    );
    for (const taskId of taskIds) {
      assert.notEqual(getTaskById(taskId)?.status, "done");
      assert.equal(
        listActivityEvents({ entityType: "task", entityId: taskId }).filter(
          (event) => event.eventType === "task_completed"
        ).length,
        0
      );
    }
    assert.equal(rewardCount(taskIds), 0);
    assert.equal(
      listNotes({ linkedEntityType: "project", linkedEntityId: project.id })
        .length,
      0
    );
    assert.equal(
      listActivityEvents({
        entityType: "project",
        entityId: project.id
      }).filter(
        (event) =>
          event.eventType === "note.created" ||
          event.eventType === "project_status_changed"
      ).length,
      0
    );

    database.exec("DROP TRIGGER fail_project_closeout_note_insert");
    const retry = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: { cookie },
      payload
    });
    assert.equal(retry.statusCode, 200, retry.body);
    assert.deepEqual(
      {
        ...(database
          .prepare("SELECT title, status FROM projects WHERE id = ?")
          .get(project.id) as { title: string; status: string })
      },
      { title: payload.title, status: "completed" }
    );
    for (const taskId of taskIds) {
      assert.equal(getTaskById(taskId)?.status, "done");
    }
    assert.equal(rewardCount(taskIds), taskIds.length);
    const notes = listNotes({
      linkedEntityType: "project",
      linkedEntityId: project.id
    });
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.contentMarkdown, contentMarkdown);
  });
});
