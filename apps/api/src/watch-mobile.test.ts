import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { createGoal } from "./repositories/goals.js";
import { createProject } from "./repositories/projects.js";
import { getTaskRunById } from "./repositories/task-runs.js";
import { createTask, getTaskById } from "./repositories/tasks.js";
import { createUser } from "./repositories/users.js";
import {
  buildBoundedWatchDirectionSnapshot,
  buildBoundedWatchTodaySnapshot,
  buildDirectionSnapshot,
  buildWatchBootstrap,
  ingestWatchCommandBatch
} from "./watch-mobile.js";

test("watch direction ranks the full result set before bounding the payload", () => {
  const goals = [
    ["lifetime", "Lifetime", "lifetime", 500],
    ["quarter-low", "Quarter low", "quarter", 10],
    ["year", "Year", "year", 100],
    ["quarter-high", "Quarter high", "quarter", 90],
    ["quarter-mid", "Quarter mid", "quarter", 40],
    ["year-two", "Year two", "year", 80],
    ["lifetime-two", "Lifetime two", "lifetime", 300],
    ["quarter-two", "Quarter two", "quarter", 30],
    ["year-three", "Year three", "year", 60],
    ["quarter-three", "Quarter three", "quarter", 20]
  ].map(([id, title, horizon, targetPoints]) => ({
    id: String(id),
    title: String(title),
    horizon: String(horizon),
    status: "active",
    targetPoints: Number(targetPoints)
  }));
  const projects = Array.from({ length: 11 }, (_, index) => ({
    id: `project-${index}`,
    title: `Project ${String(index).padStart(2, "0")}`,
    status: "active",
    workflowStatus: index >= 8 ? "focus" : "backlog",
    goalId: "goal-watch",
    goalTitle: "Watch",
    activeRunCount: index === 10 ? 1 : 0,
    openTaskCount: index
  }));

  const snapshot = buildBoundedWatchDirectionSnapshot(goals, projects);

  assert.equal(snapshot.goalCount, 10);
  assert.equal(snapshot.goals.length, 8);
  assert.deepEqual(
    snapshot.goals.slice(0, 5).map((goal) => goal.id),
    ["quarter-high", "quarter-mid", "quarter-two", "quarter-three", "quarter-low"]
  );
  assert.equal(snapshot.projectCount, 11);
  assert.equal(snapshot.projects.length, 8);
  assert.deepEqual(
    snapshot.projects.slice(0, 3).map((project) => project.id),
    ["project-10", "project-9", "project-8"]
  );
});

test("watch direction uses bounded owner-scoped reads with exact visible counts", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-watch-direction-"));
  const app = await buildServer({ dataRoot, seedDemoData: false });
  try {
    const database = getDatabase();
    const now = "2026-07-15T12:00:00.000Z";
    database
      .prepare(
        `INSERT INTO users (
           id, kind, handle, display_name, description, accent_color, created_at, updated_at
         ) VALUES (?, 'human', ?, 'Watch Direction User', '', '#c0c1ff', ?, ?)`
      )
      .run("user_watch_direction", "watch-direction-user", now, now);
    const insertGoal = database.prepare(
      `INSERT INTO goals (
         id, title, description, horizon, status, target_points, theme_color, created_at, updated_at
       ) VALUES (?, ?, '', 'quarter', 'active', ?, '#c0c1ff', ?, ?)`
    );
    const insertProject = database.prepare(
      `INSERT INTO projects (
         id, goal_id, title, description, status, workflow_status, theme_color,
         target_points, created_at, updated_at
       ) VALUES (?, ?, ?, '', 'active', 'focus', '#c0c1ff', 100, ?, ?)`
    );
    const insertOwner = database.prepare(
      `INSERT INTO entity_owners (
         entity_type, entity_id, user_id, role, created_at, updated_at
       ) VALUES (?, ?, ?, 'owner', ?, ?)`
    );
    const insertTask = database.prepare(
      `INSERT INTO tasks (
         id, title, description, status, priority, owner, goal_id, project_id,
         due_date, effort, energy, points, sort_order, completed_at, created_at, updated_at
       ) VALUES (?, ?, '', 'backlog', 'medium', 'Watch Direction User', ?, ?,
         NULL, 'medium', 'focus', 1, ?, NULL, ?, ?)`
    );

    for (let index = 0; index < 13; index += 1) {
      const goalId = `goal_watch_direction_${index}`;
      const projectId = `project_watch_direction_${index}`;
      insertGoal.run(goalId, `Goal ${String(index).padStart(2, "0")}`, index, now, now);
      insertOwner.run("goal", goalId, "user_watch_direction", now, now);
      insertProject.run(
        projectId,
        goalId,
        `Project ${String(index).padStart(2, "0")}`,
        now,
        now
      );
      insertOwner.run("project", projectId, "user_watch_direction", now, now);
      for (let taskIndex = 0; taskIndex < index; taskIndex += 1) {
        insertTask.run(
          `task_watch_direction_${index}_${taskIndex}`,
          `Task ${index}-${taskIndex}`,
          goalId,
          projectId,
          taskIndex,
          now,
          now
        );
      }
    }

    insertGoal.run("goal_watch_other", "Other goal", 999, now, now);
    insertOwner.run("goal", "goal_watch_other", "user_operator", now, now);
    insertProject.run(
      "project_watch_other",
      "goal_watch_other",
      "Other project",
      now,
      now
    );
    insertOwner.run("project", "project_watch_other", "user_operator", now, now);

    insertProject.run(
      "project_watch_assigned",
      "goal_watch_other",
      "Assigned project",
      now,
      now
    );
    insertOwner.run("project", "project_watch_assigned", "user_operator", now, now);
    database
      .prepare(
        `INSERT INTO entity_assignments (
           entity_type, entity_id, user_id, role, created_at, updated_at
         ) VALUES ('project', 'project_watch_assigned', ?, 'assignee', ?, ?)`
      )
      .run("user_watch_direction", now, now);
    for (let taskIndex = 0; taskIndex < 20; taskIndex += 1) {
      insertTask.run(
        `task_watch_assigned_${taskIndex}`,
        `Assigned task ${taskIndex}`,
        "goal_watch_other",
        "project_watch_assigned",
        taskIndex,
        now,
        now
      );
    }

    const markDeleted = database.prepare(
      `INSERT INTO deleted_entities (
         entity_type, entity_id, title, subtitle, deleted_at, deleted_by_actor,
         deleted_source, delete_reason, snapshot_json
       ) VALUES (?, ?, 'Deleted', '', ?, 'test', 'test', '', '{}')`
    );
    markDeleted.run("goal", "goal_watch_direction_12", now);
    markDeleted.run("project", "project_watch_direction_12", now);

    const snapshot = buildDirectionSnapshot({
      id: "pair_watch_direction",
      user_id: "user_watch_direction"
    });

    assert.equal(snapshot.goalCount, 12);
    assert.equal(snapshot.goals.length, 8);
    assert.deepEqual(
      snapshot.goals.map((goal) => goal.id),
      Array.from({ length: 8 }, (_, index) => `goal_watch_direction_${11 - index}`)
    );
    assert.equal(snapshot.projectCount, 13);
    assert.equal(snapshot.projects.length, 8);
    assert.equal(snapshot.projects[0]?.id, "project_watch_assigned");
    assert.deepEqual(
      snapshot.projects.slice(1).map((project) => project.id),
      Array.from({ length: 7 }, (_, index) => `project_watch_direction_${11 - index}`)
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("watch today reports true counts while bounding and ranking task arrays", () => {
  const todayKey = "2026-07-15";
  const task = (
    id: string,
    status: string,
    priority: string,
    points: number,
    updatedAt = "2026-07-15T10:00:00Z"
  ) => ({
    id,
    title: id,
    status,
    level: "task",
    priority,
    dueDate: todayKey,
    projectId: "project-watch",
    goalId: "goal-watch",
    parentWorkItemId: null,
    points,
    effort: "medium",
    energy: "focus",
    closeoutState: status === "done" ? "deferred" : "not_applicable",
    updatedAt
  });
  const dueTasks = [
    task("backlog-high", "backlog", "high", 3),
    task("focus-low", "focus", "low", 1),
    task("progress-low", "in_progress", "low", 1),
    task("focus-high", "focus", "high", 5),
    task("blocked", "blocked", "critical", 8),
    task("backlog-low", "backlog", "low", 1),
    task("focus-critical", "focus", "critical", 2),
    task("progress-critical", "in_progress", "critical", 2),
    task("blocked-low", "blocked", "low", 1),
    task("backlog-critical", "backlog", "critical", 1)
  ];
  const doneTasks = Array.from({ length: 7 }, (_, index) =>
    task(
      `done-${index}`,
      "done",
      "low",
      1,
      `2026-07-15T${String(10 + index).padStart(2, "0")}:00:00Z`
    )
  );

  const snapshot = buildBoundedWatchTodaySnapshot(
    [...dueTasks, ...doneTasks],
    todayKey
  );

  assert.equal(snapshot.dueCount, 10);
  assert.equal(snapshot.dueTasks.length, 8);
  assert.deepEqual(
    snapshot.dueTasks.slice(0, 4).map((entry) => entry.id),
    ["focus-critical", "focus-high", "focus-low", "progress-critical"]
  );
  assert.equal(snapshot.recentDone.length, 5);
  assert.deepEqual(
    snapshot.recentDone.map((entry) => entry.id),
    ["done-6", "done-5", "done-4", "done-3", "done-2"]
  );
});

test("watch today only counts and returns tasks owned by the paired user", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-watch-scope-"));
  const app = await buildServer({ dataRoot, seedDemoData: true });
  try {
    const database = getDatabase();
    const rows = database
      .prepare(
        `SELECT id
         FROM tasks
         WHERE NOT EXISTS (
           SELECT 1 FROM deleted_entities
           WHERE deleted_entities.entity_type = 'task'
             AND deleted_entities.entity_id = tasks.id
         )
         LIMIT 2`
      )
      .all() as Array<{ id: string }>;
    assert.equal(rows.length, 2);

    const now = new Date().toISOString();
    const today = new Date();
    const todayKey = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0")
    ].join("-");
    database
      .prepare(
        `INSERT INTO users (
           id, kind, handle, display_name, description, accent_color, created_at, updated_at
         ) VALUES (?, 'human', ?, 'Watch Scope User', '', '#c0c1ff', ?, ?)`
      )
      .run("user_watch_scope", "watch-scope-user", now, now);
    database
      .prepare(
        `UPDATE tasks
         SET status = 'focus', priority = 'critical', due_date = ?, updated_at = ?
         WHERE id IN (?, ?)`
      )
      .run(todayKey, now, rows[0]!.id, rows[1]!.id);
    const assignOwner = database.prepare(
      `INSERT INTO entity_owners (
         entity_type, entity_id, user_id, role, created_at, updated_at
       ) VALUES ('task', ?, ?, 'owner', ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
         user_id = excluded.user_id,
         role = excluded.role,
         updated_at = excluded.updated_at`
    );
    assignOwner.run(rows[0]!.id, "user_watch_scope", now, now);
    assignOwner.run(rows[1]!.id, "user_operator", now, now);

    const watch = buildWatchBootstrap({
      id: "pair_watch_scope",
      user_id: "user_watch_scope"
    });

    assert.equal(watch.today.dueCount, 1);
    assert.deepEqual(watch.today.dueTasks.map((task) => task.id), [rows[0]!.id]);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("watch task commands are owner scoped, assignee aware, non-oracular, and receipt atomic", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-watch-plan-17-"));
  const app = await buildServer({ dataRoot, seedDemoData: false });
  try {
    const owner = createUser({
      kind: "human",
      handle: "watch-plan-owner",
      displayName: "Watch Plan Owner",
      description: "",
      accentColor: "#c0c1ff"
    });
    const assignee = createUser({
      kind: "human",
      handle: "watch-plan-assignee",
      displayName: "Watch Plan Assignee",
      description: "",
      accentColor: "#c0c1ff"
    });
    const goal = createGoal({
      title: "Watch PLAN-17 goal",
      description: "Exercises owner-scoped Watch closeout.",
      horizon: "year",
      status: "active",
      targetPoints: 100,
      themeColor: "#c0c1ff",
      tagIds: [],
      notes: [],
      userId: owner.id
    });
    const project = createProject({
      goalId: goal.id,
      title: "Watch PLAN-17 project",
      description: "Exercises PLAN-17 Watch command handling.",
      status: "active",
      workflowStatus: "focus",
      assigneeUserIds: [assignee.id],
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
      notes: [],
      userId: owner.id
    });
    const privateTask = createTask({
      title: "Owner-only watch task",
      owner: owner.displayName,
      userId: owner.id,
      goalId: goal.id,
      projectId: project.id,
      assigneeUserIds: []
    });
    const sharedTask = createTask({
      title: "Assigned watch task",
      owner: owner.displayName,
      userId: owner.id,
      goalId: goal.id,
      projectId: project.id,
      assigneeUserIds: [assignee.id]
    });
    const atomicTask = createTask({
      title: "Atomic watch receipt task",
      owner: assignee.displayName,
      userId: assignee.id,
      goalId: goal.id,
      projectId: project.id,
      assigneeUserIds: []
    });
    const pairing = {
      id: "pair_watch_plan_17",
      user_id: assignee.id
    };
    getDatabase()
      .prepare(
        `INSERT INTO companion_pairing_sessions (
           id, user_id, label, pairing_token, status, capability_flags_json,
           api_base_url, expires_at, created_at, updated_at
         ) VALUES (?, ?, 'PLAN-17 Watch', ?, 'paired', '["watch-ready"]', '', ?, ?, ?)`
      )
      .run(
        pairing.id,
        assignee.id,
        "pairing-token-plan-17",
        "2027-07-16T10:00:00.000Z",
        "2026-07-16T10:00:00.000Z",
        "2026-07-16T10:00:00.000Z"
      );
    const device = {
      name: "Test Watch",
      platform: "watchos",
      appVersion: "1",
      sourceDevice: "Test Watch"
    };
    const commandInput = (
      id: string,
      kind:
        | "task_run_start"
        | "task_run_complete"
        | "task_status_update",
      payload: Record<string, unknown>
    ) => ({
      sessionId: pairing.id,
      pairingToken: "test-pairing-token",
      device,
      commands: [
        {
          id,
          kind,
          createdAt: "2026-07-16T10:00:00.000Z",
          payload
        }
      ]
    });

    const unauthorized = ingestWatchCommandBatch(
      pairing,
      commandInput("watch-denied-existing", "task_status_update", {
        taskId: privateTask.id,
        status: "done",
        closeoutMode: "deferred"
      })
    );
    const nonexistent = ingestWatchCommandBatch(
      pairing,
      commandInput("watch-denied-missing", "task_status_update", {
        taskId: "task_does_not_exist",
        status: "done",
        closeoutMode: "deferred"
      })
    );
    assert.equal(unauthorized.failedCount, 1);
    assert.equal(nonexistent.failedCount, 1);
    assert.deepEqual(unauthorized.receipts[0]?.error, nonexistent.receipts[0]?.error);
    assert.equal(getTaskById(privateTask.id)?.status, "backlog");

    const start = ingestWatchCommandBatch(
      pairing,
      commandInput("watch-assignee-start", "task_run_start", {
        taskId: sharedTask.id,
        timerMode: "unlimited"
      })
    );
    assert.equal(start.processedCount, 1);
    const runId = String(
      (start.receipts[0]?.result.taskRun as { id?: string } | undefined)?.id
    );
    assert.notEqual(runId, "undefined");
    assert.equal(getTaskRunById(runId)?.status, "active");

    const complete = ingestWatchCommandBatch(
      pairing,
      commandInput("watch-assignee-complete", "task_run_complete", {
        runId,
        closeoutMode: "deferred"
      })
    );
    assert.equal(complete.processedCount, 1);
    assert.equal(complete.receipts[0]?.result.closeoutState, "deferred");
    assert.equal(getTaskById(sharedTask.id)?.closeoutState, "deferred");

    getDatabase().exec(`
      CREATE TRIGGER fail_watch_plan_17_receipt
      BEFORE INSERT ON watch_action_receipts
      WHEN NEW.action_id = 'watch-atomic-complete'
      BEGIN
        SELECT RAISE(ABORT, 'injected watch receipt failure');
      END;
    `);
    assert.throws(
      () =>
        ingestWatchCommandBatch(
          pairing,
          commandInput("watch-atomic-complete", "task_status_update", {
            taskId: atomicTask.id,
            status: "done",
            closeoutMode: "deferred"
          })
        ),
      /injected watch receipt failure/
    );
    assert.equal(getTaskById(atomicTask.id)?.status, "backlog");

    getDatabase().exec("DROP TRIGGER fail_watch_plan_17_receipt");
    const retried = ingestWatchCommandBatch(
      pairing,
      commandInput("watch-atomic-complete", "task_status_update", {
        taskId: atomicTask.id,
        status: "done",
        closeoutMode: "deferred"
      })
    );
    const replayed = ingestWatchCommandBatch(
      pairing,
      commandInput("watch-atomic-complete", "task_status_update", {
        taskId: atomicTask.id,
        status: "done",
        closeoutMode: "deferred"
      })
    );
    assert.equal(retried.processedCount, 1);
    assert.equal(replayed.replayedCount, 1);
    assert.equal(getTaskById(atomicTask.id)?.closeoutState, "deferred");
    const receiptCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM watch_action_receipts
         WHERE user_id = ? AND action_id = ?`
      )
      .get(assignee.id, "watch-atomic-complete") as { count: number };
    assert.equal(receiptCount.count, 1);
    const completionEvents = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM activity_events
         WHERE entity_type = 'task'
           AND entity_id = ?
           AND event_type = 'task_completed'`
      )
      .get(atomicTask.id) as { count: number };
    assert.equal(completionEvents.count, 1);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
