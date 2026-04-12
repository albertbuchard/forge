import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { createWorkoutSession } from "./health.js";
import { createHabit, createHabitCheckIn } from "./repositories/habits.js";
import { createTask } from "./repositories/tasks.js";
import {
  buildLifeForcePayload,
  buildTaskLifeForceFields
} from "./services/life-force.js";

test("life force accounting derives AP from real work and avoids note or habit-generated double counting", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-life-force-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const database = getDatabase();
    const projectRow = database
      .prepare(`SELECT id, goal_id FROM projects ORDER BY created_at ASC LIMIT 1`)
      .get() as { id: string; goal_id: string };
    const today = new Date();
    const dateKey = today.toISOString().slice(0, 10);
    const runStart = `${dateKey}T09:00:00.000Z`;
    const runEnd = `${dateKey}T10:00:00.000Z`;
    const noteCreatedAt = `${dateKey}T09:30:00.000Z`;
    const now = new Date(`${dateKey}T11:00:00.000Z`);

    const task = createTask(
      {
        title: "Life Force calibration task",
        description: "",
        status: "focus",
        priority: "medium",
        owner: "Albert",
        userId: "user_operator",
        goalId: projectRow.goal_id,
        projectId: projectRow.id,
        dueDate: null,
        effort: "deep",
        energy: "steady",
        points: 60,
        plannedDurationSeconds: 86_400,
        schedulingRules: null,
        tagIds: [],
        actionCostBand: "standard",
        notes: []
      },
      { source: "ui", actor: "Albert" }
    );

    database
      .prepare(
        `INSERT INTO task_runs (
           id,
           task_id,
           actor,
           status,
           note,
           lease_ttl_seconds,
           claimed_at,
           heartbeat_at,
           lease_expires_at,
           completed_at,
           released_at,
           timed_out_at,
           updated_at,
           timer_mode,
           planned_duration_seconds,
           is_current
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "run_life_force_1",
        task.id,
        "Albert",
        "completed",
        "",
        1800,
        runStart,
        runEnd,
        runEnd,
        runEnd,
        null,
        null,
        runEnd,
        "planned",
        3600,
        0
      );

    database
      .prepare(
        `INSERT INTO notes (
           id,
           title,
           content_markdown,
           content_plain,
           author,
           source,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "note_life_force_1",
        "Captured inside the run",
        "Captured inside the run",
        "Captured inside the run",
        "Albert",
        "ui",
        noteCreatedAt,
        noteCreatedAt
      );
    database
      .prepare(
        `INSERT INTO note_links (note_id, entity_type, entity_id, anchor_key, created_at)
         VALUES (?, 'task', ?, '', ?)`
      )
      .run("note_life_force_1", task.id, noteCreatedAt);
    database
      .prepare(
        `INSERT INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
         VALUES ('note', ?, 'user_operator', 'owner', ?, ?)`
      )
      .run("note_life_force_1", noteCreatedAt, noteCreatedAt);

    const habit = createHabit(
      {
        title: "Habit-generated workout",
        description: "",
        status: "active",
        polarity: "positive",
        frequency: "daily",
        targetCount: 1,
        weekDays: [],
        linkedGoalIds: [],
        linkedProjectIds: [],
        linkedTaskIds: [],
        linkedValueIds: [],
        linkedPatternIds: [],
        linkedBehaviorIds: [],
        linkedBeliefIds: [],
        linkedModeIds: [],
        linkedReportIds: [],
        linkedBehaviorId: null,
        rewardXp: 12,
        penaltyXp: 8,
        generatedHealthEventTemplate: {
          enabled: true,
          workoutType: "mobility",
          title: "Mobility block",
          durationMinutes: 30,
          xpReward: 0,
          tags: [],
          links: [],
          notesTemplate: ""
        },
        userId: "user_operator"
      },
      { source: "ui", actor: "Albert" }
    );
    createHabitCheckIn(
      habit.id,
      { dateKey, status: "done", note: "" },
      { source: "ui", actor: "Albert" }
    );

    const payload = buildLifeForcePayload(now, ["user_operator"]);
    const taskFields = buildTaskLifeForceFields(task, "user_operator");

    assert.equal(
      Number(taskFields.actionPointSummary.spentTodayAp.toFixed(2)),
      4.17
    );
    assert.equal(payload.stats.length, 6);
    assert.ok(payload.overloadApPerHour >= 0);

    const noteLedgerCount = (
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM ap_ledger_events
           WHERE date_key = ? AND entity_type = 'note' AND entity_id = ?`
        )
        .get(dateKey, "note_life_force_1") as { count: number }
    ).count;
    assert.equal(noteLedgerCount, 0);

    const habitLedgerCount = (
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM ap_ledger_events
           WHERE date_key = ? AND entity_type = 'habit' AND entity_id = ?`
        )
        .get(dateKey, habit.id) as { count: number }
    ).count;
    assert.equal(habitLedgerCount, 0);

    const workoutLedgerCount = (
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM ap_ledger_events
           WHERE date_key = ? AND entity_type = 'workout_session'`
        )
        .get(dateKey) as { count: number }
    ).count;
    assert.ok(workoutLedgerCount >= 1);

    const statXpKeys = (
      database
        .prepare(
          `SELECT stat_key
           FROM stat_xp_events
           WHERE user_id = 'user_operator'
             AND json_extract(metadata_json, '$.dateKey') = ?
           ORDER BY stat_key ASC`
        )
        .all(dateKey) as Array<{ stat_key: string }>
    ).map((row) => row.stat_key);
    assert.ok(statXpKeys.includes("focus"));
    assert.ok(statXpKeys.includes("life_force"));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
