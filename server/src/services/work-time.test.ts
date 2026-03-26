import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeDatabase, configureDatabase, getDatabase, initializeDatabase } from "../db.js";
import { getSettings } from "../repositories/settings.js";
import { computeWorkTime } from "./work-time.js";

async function setupDatabase(prefix: string) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  configureDatabase({ dataRoot: rootDir });
  await initializeDatabase();
  getSettings();
  return rootDir;
}

function insertRun(options: {
  id: string;
  taskId: string;
  actor: string;
  status?: "active" | "completed" | "released" | "timed_out";
  claimedAt: string;
  leaseExpiresAt: string;
  heartbeatAt?: string;
  updatedAt?: string;
  timerMode?: "planned" | "unlimited";
  plannedDurationSeconds?: number | null;
  isCurrent?: boolean;
  completedAt?: string | null;
  releasedAt?: string | null;
  timedOutAt?: string | null;
}) {
  getDatabase()
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
       ) VALUES (?, ?, ?, ?, '', 900, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      options.id,
      options.taskId,
      options.actor,
      options.status ?? "active",
      options.claimedAt,
      options.heartbeatAt ?? options.claimedAt,
      options.leaseExpiresAt,
      options.completedAt ?? null,
      options.releasedAt ?? null,
      options.timedOutAt ?? null,
      options.updatedAt ?? options.leaseExpiresAt,
      options.timerMode ?? "unlimited",
      options.plannedDurationSeconds ?? null,
      options.isCurrent ? 1 : 0
    );
}

test("computeWorkTime applies split, parallel, and primary_only accounting for overlapping timers", async () => {
  const rootDir = await setupDatabase("forge-work-time-accounting-");

  try {
    const database = getDatabase();
    const tasks = database.prepare("SELECT id FROM tasks ORDER BY id ASC LIMIT 2").all() as Array<{ id: string }>;
    const [taskOne, taskTwo] = tasks;
    assert.ok(taskOne?.id);
    assert.ok(taskTwo?.id);

    const now = new Date("2026-03-26T09:10:00.000Z");
    const claimedAt = "2026-03-26T09:00:00.000Z";
    const expiresAt = "2026-03-26T09:10:00.000Z";

    insertRun({
      id: "run_primary",
      taskId: taskOne.id,
      actor: "Aurel",
      claimedAt,
      leaseExpiresAt: expiresAt,
      isCurrent: true
    });
    insertRun({
      id: "run_secondary",
      taskId: taskTwo.id,
      actor: "Aurel",
      claimedAt,
      leaseExpiresAt: expiresAt,
      isCurrent: false
    });

    database.prepare("UPDATE app_settings SET time_accounting_mode = ? WHERE id = 1").run("split");
    let computation = computeWorkTime(now);
    assert.equal(computation.mode, "split");
    assert.equal(computation.runMetrics.get("run_primary")?.elapsedWallSeconds, 600);
    assert.equal(computation.runMetrics.get("run_primary")?.creditedSeconds, 300);
    assert.equal(computation.runMetrics.get("run_secondary")?.creditedSeconds, 300);

    database.prepare("UPDATE app_settings SET time_accounting_mode = ? WHERE id = 1").run("parallel");
    computation = computeWorkTime(now);
    assert.equal(computation.mode, "parallel");
    assert.equal(computation.runMetrics.get("run_primary")?.creditedSeconds, 600);
    assert.equal(computation.runMetrics.get("run_secondary")?.creditedSeconds, 600);

    database.prepare("UPDATE app_settings SET time_accounting_mode = ? WHERE id = 1").run("primary_only");
    computation = computeWorkTime(now);
    assert.equal(computation.mode, "primary_only");
    assert.equal(computation.runMetrics.get("run_primary")?.creditedSeconds, 600);
    assert.equal(computation.runMetrics.get("run_secondary")?.creditedSeconds, 0);
    assert.equal(computation.taskSummaries.get(taskOne.id)?.hasCurrentRun, true);
    assert.equal(computation.taskSummaries.get(taskTwo.id)?.hasCurrentRun, false);
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("computeWorkTime derives planned timer overtime and task totals", async () => {
  const rootDir = await setupDatabase("forge-work-time-planned-");

  try {
    const database = getDatabase();
    const task = database.prepare("SELECT id FROM tasks ORDER BY id ASC LIMIT 1").get() as { id: string };
    assert.ok(task.id);

    insertRun({
      id: "run_planned",
      taskId: task.id,
      actor: "Aurel",
      claimedAt: "2026-03-26T10:00:00.000Z",
      leaseExpiresAt: "2026-03-26T10:20:00.000Z",
      timerMode: "planned",
      plannedDurationSeconds: 900,
      isCurrent: true
    });

    const computation = computeWorkTime(new Date("2026-03-26T10:20:00.000Z"));
    const metric = computation.runMetrics.get("run_planned");
    const summary = computation.taskSummaries.get(task.id);

    assert.equal(metric?.elapsedWallSeconds, 1200);
    assert.equal(metric?.creditedSeconds, 1200);
    assert.equal(metric?.remainingSeconds, 0);
    assert.equal(metric?.overtimeSeconds, 300);
    assert.equal(metric?.isCurrent, true);
    assert.equal(summary?.totalTrackedSeconds, 1200);
    assert.equal(summary?.totalCreditedSeconds, 1200);
    assert.equal(summary?.activeRunCount, 1);
    assert.equal(summary?.currentRunId, "run_planned");
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
