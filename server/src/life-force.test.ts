import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { createWorkoutSession } from "./health.js";
import {
  createCalendarEvent,
  createTaskTimebox,
  createWorkBlockTemplate
} from "./repositories/calendar.js";
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

test("life force integrates sleep, wake, movement, and planned calendar drains into one daily model", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-life-force-calendar-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const database = getDatabase();
    const projectRow = database
      .prepare(`SELECT id, goal_id FROM projects ORDER BY created_at ASC LIMIT 1`)
      .get() as { id: string; goal_id: string };
    const dateKey = "2026-04-11";
    const now = new Date(`${dateKey}T10:30:00.000Z`);

    database
      .prepare(
        `INSERT INTO health_sleep_sessions (
           id, external_uid, pairing_session_id, user_id, source, source_type, source_device,
           started_at, ended_at, time_in_bed_seconds, asleep_seconds, awake_seconds,
           sleep_score, regularity_score, bedtime_consistency_minutes, wake_consistency_minutes,
           stage_breakdown_json, recovery_metrics_json, links_json, annotations_json,
           provenance_json, derived_json, created_at, updated_at
         ) VALUES (?, ?, NULL, 'user_operator', 'manual', 'manual', '', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, '[]', '{}', '[]', '{}', '{}', '{}', ?, ?)`
      )
      .run(
        "sleep_life_force_main",
        "sleep-life-force-main",
        `${dateKey}T00:15:00.000Z`,
        `${dateKey}T07:45:00.000Z`,
        8 * 3600,
        Math.floor(7.5 * 3600),
        1800,
        88,
        `${dateKey}T08:00:00.000Z`,
        `${dateKey}T08:00:00.000Z`
      );

    database
      .prepare(
        `INSERT INTO movement_trips (
           id, external_uid, pairing_session_id, user_id, start_place_id, end_place_id,
           label, status, travel_mode, activity_type, started_at, ended_at,
           distance_meters, moving_seconds, idle_seconds, average_speed_mps, max_speed_mps,
           calories_kcal, expected_met, weather_json, tags_json, linked_entities_json,
           linked_people_json, metadata_json, published_note_id, created_at, updated_at
         ) VALUES (?, ?, NULL, 'user_operator', NULL, NULL, ?, 'completed', 'walk', 'walk', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, '{}', '[]', '[]', '[]', '{}', NULL, ?, ?)`
      )
      .run(
        "trip_life_force_1",
        "trip-life-force-1",
        "Morning walk to coworking",
        `${dateKey}T08:20:00.000Z`,
        `${dateKey}T08:50:00.000Z`,
        2200,
        1800,
        0,
        3.2,
        `${dateKey}T09:00:00.000Z`,
        `${dateKey}T09:00:00.000Z`
      );

    const task = createTask(
      {
        title: "Planned AP task",
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

    createTaskTimebox({
      taskId: task.id,
      projectId: projectRow.id,
      title: "Deep work timebox",
      startsAt: `${dateKey}T14:00:00.000Z`,
      endsAt: `${dateKey}T16:00:00.000Z`,
      userId: "user_operator"
    });

    createWorkBlockTemplate({
      title: "Admin window",
      kind: "secondary_activity",
      color: "#60a5fa",
      timezone: "UTC",
      weekDays: [6],
      startMinute: 17 * 60,
      endMinute: 18 * 60,
      blockingState: "allowed",
      userId: "user_operator"
    });

    const payload = buildLifeForcePayload(now, ["user_operator"]);

    assert.ok(payload.sleepRecoveryMultiplier > 1);
    assert.ok(payload.spentTodayAp > 0);
    assert.ok(payload.plannedRemainingAp > 0);
    assert.ok(payload.forecastAp >= payload.spentTodayAp);
    assert.ok(
      payload.plannedDrains.some((entry) => entry.sourceType === "task_timebox")
    );
    assert.ok(
      payload.plannedDrains.some((entry) => entry.sourceType === "work_block")
    );

    const wakeLedgerCount = (
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM ap_ledger_events
           WHERE date_key = ? AND event_kind = 'wake_start'`
        )
        .get(dateKey) as { count: number }
    ).count;
    assert.equal(wakeLedgerCount, 1);

    const movementLedgerCount = (
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM ap_ledger_events
           WHERE date_key = ? AND entity_type = 'movement_trip'`
        )
        .get(dateKey) as { count: number }
    ).count;
    assert.equal(movementLedgerCount, 1);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("life force debits elapsed timeboxes, work blocks, and calendar containers when no richer source exists", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-life-force-containers-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const database = getDatabase();
    const projectRow = database
      .prepare(`SELECT id, goal_id FROM projects ORDER BY created_at ASC LIMIT 1`)
      .get() as { id: string; goal_id: string };
    const dateKey = "2026-04-11";
    const now = new Date(`${dateKey}T12:30:00.000Z`);

    const task = createTask(
      {
        title: "Container-backed task",
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

    createTaskTimebox({
      taskId: task.id,
      projectId: projectRow.id,
      title: "Morning planning",
      startsAt: `${dateKey}T09:00:00.000Z`,
      endsAt: `${dateKey}T10:00:00.000Z`,
      userId: "user_operator"
    });

    createWorkBlockTemplate({
      title: "Admin block",
      kind: "secondary_activity",
      color: "#60a5fa",
      timezone: "UTC",
      weekDays: [6],
      startMinute: 10 * 60,
      endMinute: 11 * 60,
      blockingState: "allowed",
      userId: "user_operator"
    });

    createCalendarEvent({
      title: "Hiring meeting",
      description: "",
      location: "",
      startAt: `${dateKey}T11:00:00.000Z`,
      endAt: `${dateKey}T12:00:00.000Z`,
      timezone: "UTC",
      isAllDay: false,
      availability: "busy",
      eventType: "meeting",
      categories: [],
      links: [],
      userId: "user_operator"
    });

    const payload = buildLifeForcePayload(now, ["user_operator"]);

    const containerKinds = (
      database
        .prepare(
          `SELECT event_kind
           FROM ap_ledger_events
           WHERE date_key = ?
             AND event_kind IN ('task_timebox_actual', 'work_block_actual', 'calendar_event_actual')
           ORDER BY event_kind ASC`
        )
        .all(dateKey) as Array<{ event_kind: string }>
    ).map((row) => row.event_kind);

    assert.deepEqual(containerKinds, [
      "calendar_event_actual",
      "task_timebox_actual",
      "work_block_actual"
    ]);
    assert.ok(payload.spentTodayAp > 25);
    assert.ok(payload.plannedDrains.length === 0);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("life force honors custom calendar AP profiles and keeps rest or holiday blocks non-zero", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-life-force-calendar-custom-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const database = getDatabase();
    const projectRow = database
      .prepare(`SELECT id, goal_id FROM projects ORDER BY created_at ASC LIMIT 1`)
      .get() as { id: string; goal_id: string };
    const dateKey = "2026-04-11";
    const now = new Date(`${dateKey}T12:30:00.000Z`);

    const task = createTask(
      {
        title: "Custom AP timebox task",
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

    createTaskTimebox({
      taskId: task.id,
      projectId: projectRow.id,
      title: "Custom AP timebox",
      startsAt: `${dateKey}T09:00:00.000Z`,
      endsAt: `${dateKey}T10:00:00.000Z`,
      activityPresetKey: "admin",
      customSustainRateApPerHour: 7.25,
      userId: "user_operator"
    });

    createWorkBlockTemplate({
      title: "Rest block with real cost",
      kind: "rest",
      color: "#60a5fa",
      timezone: "UTC",
      weekDays: [6],
      startMinute: 10 * 60,
      endMinute: 11 * 60,
      blockingState: "blocked",
      activityPresetKey: "recovery_break",
      customSustainRateApPerHour: 5.5,
      userId: "user_operator"
    });

    createCalendarEvent({
      title: "Free lunch but still an activity",
      description: "",
      location: "",
      startAt: `${dateKey}T11:00:00.000Z`,
      endAt: `${dateKey}T12:00:00.000Z`,
      timezone: "UTC",
      isAllDay: false,
      availability: "free",
      eventType: "lunch",
      categories: [],
      activityPresetKey: "recovery_break",
      customSustainRateApPerHour: 4.5,
      links: [],
      userId: "user_operator"
    });

    const payload = buildLifeForcePayload(now, ["user_operator"]);
    const ledgerRows = (
      database
      .prepare(
        `SELECT event_kind, rate_ap_per_hour
         FROM ap_ledger_events
         WHERE date_key = ?
           AND event_kind IN ('task_timebox_actual', 'work_block_actual', 'calendar_event_actual')
         ORDER BY event_kind ASC`
      )
      .all(dateKey) as Array<{ event_kind: string; rate_ap_per_hour: number }>
    ).map((row) => ({
      event_kind: row.event_kind,
      rate_ap_per_hour: row.rate_ap_per_hour
    }));

    assert.deepEqual(ledgerRows, [
      { event_kind: "calendar_event_actual", rate_ap_per_hour: 4.5 },
      { event_kind: "task_timebox_actual", rate_ap_per_hour: 7.25 },
      { event_kind: "work_block_actual", rate_ap_per_hour: 5.5 }
    ]);
    assert.ok(payload.spentTodayAp >= 17.25);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
