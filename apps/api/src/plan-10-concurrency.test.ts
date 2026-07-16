import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { createTaskTimebox } from "./repositories/calendar.js";
import { createGoal } from "./repositories/goals.js";
import { createProject } from "./repositories/projects.js";
import { createTask } from "./repositories/tasks.js";
import { createUser } from "./repositories/users.js";

function createPlanningFixture() {
  const user = createUser({
    kind: "human",
    handle: "plan-concurrency",
    displayName: "Plan concurrency",
    description: "",
    accentColor: "#336699"
  });
  const goal = createGoal({
    title: "Concurrency goal",
    description: "",
    horizon: "year",
    status: "active",
    targetPoints: 400,
    themeColor: "#c8a46b",
    tagIds: [],
    notes: [],
    userId: user.id
  });
  const project = createProject({
    goalId: goal.id,
    title: "Concurrency project",
    userId: user.id
  });
  const task = createTask({
    title: "Concurrency task",
    projectId: project.id,
    goalId: goal.id,
    userId: user.id,
    owner: user.displayName,
    plannedDurationSeconds: 60 * 60
  });
  return { user, project, task };
}

function startMutationWorker(input: {
  dataRoot: string;
  operation: "create" | "update";
  taskId: string;
  userId: string;
  projectId: string;
  timeboxId?: string;
  title: string;
  startsAt: string;
  endsAt: string;
}) {
  const dbUrl = pathToFileURL(path.resolve("apps/api/src/db.ts")).href;
  const calendarUrl = pathToFileURL(
    path.resolve("apps/api/src/repositories/calendar.ts")
  ).href;
  const script = `
    import { configureDatabase, closeDatabase } from ${JSON.stringify(dbUrl)};
    import { createTaskTimebox, updateTaskTimebox } from ${JSON.stringify(calendarUrl)};
    const input = JSON.parse(process.env.PLAN10_WORKER_INPUT);
    configureDatabase({ dataRoot: input.dataRoot, seedDemoData: false });
    process.stdout.write("READY\\n");
    await new Promise((resolve) => process.stdin.once("data", resolve));
    try {
      const result = input.operation === "create"
        ? createTaskTimebox({
            taskId: input.taskId,
            projectId: input.projectId,
            userId: input.userId,
            title: input.title,
            startsAt: input.startsAt,
            endsAt: input.endsAt
          })
        : updateTaskTimebox(input.timeboxId, {
            title: input.title,
            startsAt: input.startsAt,
            endsAt: input.endsAt
          });
      process.stdout.write(JSON.stringify({ ok: true, id: result?.id }) + "\\n");
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) }) + "\\n");
    } finally {
      closeDatabase();
    }
  `;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PLAN10_WORKER_INPUT: JSON.stringify(input)
      },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
  return observeWorker(child);
}

function observeWorker(child: ChildProcessWithoutNullStreams) {
  let stdout = "";
  let stderr = "";
  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
    if (stdout.includes("READY\n")) {
      readyResolve();
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const result = new Promise<{ ok: boolean; code?: string; id?: string }>(
    (resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`PLAN-10 worker exited ${code}: ${stderr}`));
          return;
        }
        const line = stdout
          .split("\n")
          .map((value) => value.trim())
          .find((value) => value.startsWith("{"));
        if (!line) {
          reject(
            new Error(`PLAN-10 worker returned no result: ${stdout} ${stderr}`)
          );
          return;
        }
        resolve(JSON.parse(line));
      });
    }
  );
  return {
    ready,
    result,
    release: () => child.stdin.end("GO\n")
  };
}

async function runConcurrentPair(
  left: ReturnType<typeof startMutationWorker>,
  right: ReturnType<typeof startMutationWorker>
) {
  await Promise.all([left.ready, right.ready]);
  left.release();
  right.release();
  return Promise.all([left.result, right.result]);
}

function assertOnePlacementWins(
  results: Array<{ ok: boolean; code?: string }>
) {
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(
    results.filter(
      (result) =>
        !result.ok &&
        result.code === "calendar_timebox_overlap_requires_override"
    ).length,
    1,
    JSON.stringify(results)
  );
}

test("PLAN-10 create and update serialize overlap validation across two database connections", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-plan10-concurrency-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    devrageMetricSync: false
  });
  try {
    const fixture = createPlanningFixture();
    const createResults = await runConcurrentPair(
      startMutationWorker({
        dataRoot,
        operation: "create",
        taskId: fixture.task.id,
        userId: fixture.user.id,
        projectId: fixture.project.id,
        title: "Concurrent create A",
        startsAt: "2031-06-02T09:00:00.000Z",
        endsAt: "2031-06-02T10:00:00.000Z"
      }),
      startMutationWorker({
        dataRoot,
        operation: "create",
        taskId: fixture.task.id,
        userId: fixture.user.id,
        projectId: fixture.project.id,
        title: "Concurrent create B",
        startsAt: "2031-06-02T09:00:00.000Z",
        endsAt: "2031-06-02T10:00:00.000Z"
      })
    );
    assertOnePlacementWins(createResults);

    const first = createTaskTimebox({
      taskId: fixture.task.id,
      userId: fixture.user.id,
      status: "planned",
      source: "manual",
      title: "Concurrent update A",
      startsAt: "2031-06-03T08:00:00.000Z",
      endsAt: "2031-06-03T09:00:00.000Z",
      overrideReason: null
    });
    const second = createTaskTimebox({
      taskId: fixture.task.id,
      userId: fixture.user.id,
      status: "planned",
      source: "manual",
      title: "Concurrent update B",
      startsAt: "2031-06-03T10:00:00.000Z",
      endsAt: "2031-06-03T11:00:00.000Z",
      overrideReason: null
    });
    const updateResults = await runConcurrentPair(
      startMutationWorker({
        dataRoot,
        operation: "update",
        taskId: fixture.task.id,
        userId: fixture.user.id,
        projectId: fixture.project.id,
        timeboxId: first.id,
        title: "Moved A",
        startsAt: "2031-06-03T12:00:00.000Z",
        endsAt: "2031-06-03T13:00:00.000Z"
      }),
      startMutationWorker({
        dataRoot,
        operation: "update",
        taskId: fixture.task.id,
        userId: fixture.user.id,
        projectId: fixture.project.id,
        timeboxId: second.id,
        title: "Moved B",
        startsAt: "2031-06-03T12:00:00.000Z",
        endsAt: "2031-06-03T13:00:00.000Z"
      })
    );
    assertOnePlacementWins(updateResults);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
