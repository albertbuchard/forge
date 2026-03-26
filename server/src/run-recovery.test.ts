import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeDatabase, configureDatabase, initializeDatabase } from "./db.js";
import { claimTaskRun, listTaskRuns } from "./repositories/task-runs.js";
import { listTasks } from "./repositories/tasks.js";
import { recoverExpiredTaskRunsOnStartup } from "./services/run-recovery.js";

test("startup recovery marks expired task runs timed out after a restart gap", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-startup-recovery-"));

  try {
    configureDatabase({ dataRoot: rootDir });
    await initializeDatabase();

    const taskId = listTasks()[0]!.id;
    const claimed = claimTaskRun(
      taskId,
      {
        actor: "OpenClaw",
        leaseTtlSeconds: 1,
        note: "Boot recovery should reclaim this stale lease."
      },
      new Date("2026-03-22T05:00:00.000Z"),
      { source: "openclaw" }
    );

    closeDatabase();

    configureDatabase({ dataRoot: rootDir });
    await initializeDatabase();

    const summary = recoverExpiredTaskRunsOnStartup({
      now: new Date("2026-03-22T05:00:03.000Z")
    });

    assert.equal(summary.recoveredCount, 1);
    assert.deepEqual(summary.recoveredRunIds, [claimed.run.id]);

    const recoveredRun = listTaskRuns({ taskId }).find((run) => run.id === claimed.run.id);
    assert.equal(recoveredRun?.status, "timed_out");
    assert.equal(recoveredRun?.timedOutAt, "2026-03-22T05:00:03.000Z");
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("startup recovery stays a no-op when there are no expired task runs", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-startup-recovery-noop-"));

  try {
    configureDatabase({ dataRoot: rootDir });
    await initializeDatabase();

    const summary = recoverExpiredTaskRunsOnStartup({
      now: new Date("2026-03-22T05:00:00.000Z")
    });

    assert.equal(summary.recoveredCount, 0);
    assert.deepEqual(summary.recoveredRunIds, []);
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
