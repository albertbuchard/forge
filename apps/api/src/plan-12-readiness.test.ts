import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase
} from "./db.js";
import {
  createHabit,
  createHabitCheckIn,
  getHabitById,
  updateHabit
} from "./repositories/habits.js";

function positiveHabitInput(
  overrides: Partial<Parameters<typeof createHabit>[0]> = {}
): Parameters<typeof createHabit>[0] {
  return {
    title: "Complete the planned practice",
    description: "Keep one truthful positive-habit record.",
    status: "active",
    polarity: "positive",
    frequency: "daily",
    timezone: "Europe/Zurich",
    dayBoundaryMode: "fixed",
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
      enabled: false,
      workoutType: "workout",
      title: "",
      durationMinutes: 45,
      xpReward: 0,
      tags: [],
      links: [],
      notesTemplate: ""
    },
    userId: "user_operator",
    ...overrides
  };
}

async function withPlan12Database(
  label: string,
  operation: (
    app: Awaited<ReturnType<typeof buildServer>>,
    rootDir: string
  ) => Promise<void> | void
) {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), `forge-plan12-${label}-`)
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });
  try {
    await operation(app, rootDir);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
}

function addUtcDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitForPaths(paths: string[], timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await Promise.all(paths.map(pathExists))).every(Boolean)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${paths.join(", ")}`);
}

function startHabitCheckInWorker(input: {
  rootDir: string;
  readyPath: string;
  startPath: string;
  habitId: string;
  dateKey: string;
}) {
  const workerScript = String.raw`
    import { access, writeFile } from "node:fs/promises";
    import path from "node:path";
    import { pathToFileURL } from "node:url";

    const repoRoot = process.env.FORGE_PLAN12_REPO_ROOT;
    const dbModule = await import(pathToFileURL(path.join(repoRoot, "apps/api/src/db.ts")).href);
    const habitModule = await import(pathToFileURL(path.join(repoRoot, "apps/api/src/repositories/habits.ts")).href);
    dbModule.configureDatabase({ dataRoot: process.env.FORGE_PLAN12_DATA_ROOT, seedDemoData: false });
    dbModule.configureLegacyWikiAutoImport(false);
    await writeFile(process.env.FORGE_PLAN12_READY_PATH, "ready", "utf8");
    while (true) {
      try {
        await access(process.env.FORGE_PLAN12_START_PATH);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    try {
      const habit = habitModule.createHabitCheckIn(
        process.env.FORGE_PLAN12_HABIT_ID,
        {
          dateKey: process.env.FORGE_PLAN12_DATE_KEY,
          status: "done",
          note: "The same positive-habit evidence."
        },
        { source: "agent", actor: "PLAN-12 worker" }
      );
      process.stdout.write(JSON.stringify({ kind: "stored", id: habit?.id }) + "\n");
    } catch (error) {
      process.stdout.write(JSON.stringify({
        kind: "error",
        code: error?.code ?? "unknown",
        message: error instanceof Error ? error.message : String(error)
      }) + "\n");
    } finally {
      dbModule.closeDatabase();
    }
  `;

  return new Promise<{ kind: "stored" | "error"; code?: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", workerScript],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            FORGE_PLAN12_REPO_ROOT: process.cwd(),
            FORGE_PLAN12_DATA_ROOT: input.rootDir,
            FORGE_PLAN12_READY_PATH: input.readyPath,
            FORGE_PLAN12_START_PATH: input.startPath,
            FORGE_PLAN12_HABIT_ID: input.habitId,
            FORGE_PLAN12_DATE_KEY: input.dateKey
          },
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(`PLAN-12 worker exited ${code}: ${stderr || stdout}`)
          );
          return;
        }
        const resultLine = stdout.trim().split("\n").at(-1);
        if (!resultLine) {
          reject(new Error(`PLAN-12 worker returned no result: ${stderr}`));
          return;
        }
        resolve(
          JSON.parse(resultLine) as {
            kind: "stored" | "error";
            code?: string;
          }
        );
      });
    }
  );
}

test("positive habits preserve fixed-home and travel-local days across daylight saving time", async () => {
  await withPlan12Database("dst", () => {
    const habit = createHabit(
      positiveHabitInput({ timezone: "America/New_York" })
    );
    for (const dateKey of ["2026-03-28", "2026-03-29"]) {
      createHabitCheckIn(habit.id, {
        dateKey,
        status: "done",
        note: `Completed on ${dateKey}.`
      });
    }

    const boundaryInstant = new Date("2026-03-30T00:30:00.000Z");
    const fixed = getHabitById(habit.id, {
      now: boundaryInstant,
      timezone: "Europe/Zurich"
    })!;
    assert.equal(fixed.effectiveTimezone, "America/New_York");
    assert.equal(fixed.currentDateKey, "2026-03-29");
    assert.equal(fixed.dueToday, false);
    assert.equal(fixed.streakCount, 2);

    updateHabit(habit.id, { dayBoundaryMode: "travel" });
    const traveling = getHabitById(habit.id, {
      now: boundaryInstant,
      timezone: "Europe/Zurich"
    })!;
    assert.equal(traveling.effectiveTimezone, "Europe/Zurich");
    assert.equal(traveling.currentDateKey, "2026-03-30");
    assert.equal(traveling.dueToday, true);
    assert.equal(traveling.streakCount, 2);
  });
});

test("weekly streaks remain exact beyond the fourteen visible check-ins", async () => {
  await withPlan12Database("weekly-window", () => {
    const habit = createHabit(
      positiveHabitInput({
        title: "Practice twice each week",
        frequency: "weekly",
        targetCount: 2,
        weekDays: [1, 3],
        timezone: "UTC"
      })
    );
    const currentWeekStart = "2026-08-03";
    for (let week = 0; week < 40; week += 1) {
      const monday = addUtcDays(currentWeekStart, -7 * week);
      const wednesday = addUtcDays(monday, 2);
      createHabitCheckIn(habit.id, {
        dateKey: monday,
        status: "done",
        note: "Monday practice."
      });
      createHabitCheckIn(habit.id, {
        dateKey: wednesday,
        status: "done",
        note: "Wednesday practice."
      });
    }
    const olderWeek = addUtcDays(currentWeekStart, -7 * 41);
    createHabitCheckIn(habit.id, {
      dateKey: olderWeek,
      status: "done",
      note: "Older Monday practice before a gap."
    });
    createHabitCheckIn(habit.id, {
      dateKey: addUtcDays(olderWeek, 2),
      status: "done",
      note: "Older Wednesday practice before a gap."
    });

    const current = getHabitById(habit.id, {
      now: new Date("2026-08-06T12:00:00.000Z"),
      timezone: "UTC"
    })!;
    assert.equal(current.streakCount, 40);
    assert.equal(current.checkIns.length, 14);
    assert.equal(current.completionRate, 100);
    assert.equal(current.dueToday, false);
    const storedCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM habit_check_ins
         WHERE habit_id = ?`
      )
      .get(habit.id) as { count: number };
    assert.equal(storedCount.count, 82);
  });
});

test("separate Forge processes collapse one positive-habit outcome into one receipt", async () => {
  await withPlan12Database("process-race", async (_app, rootDir) => {
    const habit = createHabit(
      positiveHabitInput({ title: "One concurrent positive outcome" })
    );
    closeDatabase();

    const readyPaths = [
      path.join(rootDir, "worker-a.ready"),
      path.join(rootDir, "worker-b.ready")
    ];
    const startPath = path.join(rootDir, "workers.start");
    const workers = readyPaths.map((readyPath) =>
      startHabitCheckInWorker({
        rootDir,
        readyPath,
        startPath,
        habitId: habit.id,
        dateKey: "2026-08-03"
      })
    );
    await waitForPaths(readyPaths);
    await writeFile(startPath, "start", "utf8");
    const outcomes = await Promise.all(workers);
    assert.deepEqual(
      outcomes.map((outcome) => outcome.kind),
      ["stored", "stored"]
    );

    configureDatabase({ dataRoot: rootDir, seedDemoData: false });
    configureLegacyWikiAutoImport(false);
    await initializeDatabase();
    const checkInCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM habit_check_ins
         WHERE habit_id = ? AND date_key = ?`
      )
      .get(habit.id, "2026-08-03") as { count: number };
    assert.equal(checkInCount.count, 1);
    const rewardCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM reward_ledger
         WHERE reversible_group = ?`
      )
      .get(`habit:${habit.id}:2026-08-03`) as { count: number };
    assert.equal(rewardCount.count, 1);
    const activityCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM activity_events
         WHERE entity_type = 'habit'
           AND entity_id = ?
           AND event_type = 'habit_done'`
      )
      .get(habit.id) as { count: number };
    assert.equal(activityCount.count, 1);
  });
});
