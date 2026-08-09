import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase
} from "./db.js";
import { HttpError } from "./errors.js";
import {
  createInsight,
  listInsights,
  updateInsight
} from "./repositories/collaboration.js";
import { deleteEntity } from "./services/entity-crud.js";
import type { CreateInsightInput } from "./types.js";

const operatorContext = { source: "ui" as const, actor: "Operator" };

const insightInput: CreateInsightInput = {
  originType: "user",
  originAgentId: null,
  originLabel: "Operator",
  visibility: "visible",
  status: "open",
  entityType: null,
  entityId: null,
  timeframeLabel: "This week",
  title: "Protect the review boundary",
  summary: "The week needs one exact evidence window.",
  recommendation: "Keep every review event inside that window.",
  rationale: "The recommendation follows the linked review evidence.",
  confidence: 0.82,
  ctaLabel: "Review insight",
  evidence: [
    {
      entityType: "trigger_report",
      entityId: "report_review_boundary",
      label: "Weekly review evidence"
    }
  ]
};

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

function startCreateWorker(input: {
  rootDir: string;
  readyPath: string;
  startPath: string;
  insight: CreateInsightInput;
}) {
  const workerScript = String.raw`
    import { access, writeFile } from "node:fs/promises";
    import path from "node:path";
    import { pathToFileURL } from "node:url";

    const repoRoot = process.env.FORGE_RACE_REPO_ROOT;
    const dbModule = await import(pathToFileURL(path.join(repoRoot, "apps/api/src/db.ts")).href);
    const collaborationModule = await import(pathToFileURL(path.join(repoRoot, "apps/api/src/repositories/collaboration.ts")).href);
    dbModule.configureDatabase({ dataRoot: process.env.FORGE_RACE_DATA_ROOT, seedDemoData: false });
    dbModule.configureLegacyWikiAutoImport(false);
    await writeFile(process.env.FORGE_RACE_READY_PATH, "ready", "utf8");
    while (true) {
      try {
        await access(process.env.FORGE_RACE_START_PATH);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    try {
      const insight = collaborationModule.createInsight(
        JSON.parse(process.env.FORGE_RACE_INSIGHT),
        { source: "ui", actor: "Operator" }
      );
      process.stdout.write(JSON.stringify({ kind: "created", id: insight.id }) + "\n");
    } catch (error) {
      process.stdout.write(JSON.stringify({
        kind: "error",
        code: error?.code ?? "unknown",
        statusCode: error?.statusCode ?? 0
      }) + "\n");
    } finally {
      dbModule.closeDatabase();
    }
  `;

  return new Promise<{
    kind: "created" | "error";
    id?: string;
    code?: string;
    statusCode?: number;
  }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", workerScript],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          FORGE_RACE_REPO_ROOT: process.cwd(),
          FORGE_RACE_DATA_ROOT: input.rootDir,
          FORGE_RACE_READY_PATH: input.readyPath,
          FORGE_RACE_START_PATH: input.startPath,
          FORGE_RACE_INSIGHT: JSON.stringify(input.insight)
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
          new Error(`Insight race worker exited ${code}: ${stderr || stdout}`)
        );
        return;
      }
      const resultLine = stdout.trim().split("\n").at(-1);
      if (!resultLine) {
        reject(new Error(`Insight race worker returned no result: ${stderr}`));
        return;
      }
      resolve(
        JSON.parse(resultLine) as {
          kind: "created" | "error";
          id?: string;
          code?: string;
          statusCode?: number;
        }
      );
    });
  });
}

test("insight creation is owner-scoped, normalized, retry-safe, and bin-aware", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-insight-dedup-readiness-")
  );
  const readyPaths = [
    path.join(rootDir, "worker-a.ready"),
    path.join(rootDir, "worker-b.ready")
  ];
  const startPath = path.join(rootDir, "workers.start");

  configureDatabase({ dataRoot: rootDir, seedDemoData: false });
  configureLegacyWikiAutoImport(false);
  await initializeDatabase();
  closeDatabase();

  try {
    const workers = [
      startCreateWorker({
        rootDir,
        readyPath: readyPaths[0]!,
        startPath,
        insight: insightInput
      }),
      startCreateWorker({
        rootDir,
        readyPath: readyPaths[1]!,
        startPath,
        insight: {
          ...insightInput,
          timeframeLabel: " this   WEEK ",
          title: "  PROTECT   the review boundary ",
          summary: "the week needs one exact evidence window.",
          recommendation: "Keep every review event inside that window."
        }
      })
    ];
    await waitForPaths(readyPaths);
    await writeFile(startPath, "start", "utf8");
    const outcomes = await Promise.all(workers);

    assert.equal(
      outcomes.filter((outcome) => outcome.kind === "created").length,
      1
    );
    assert.deepEqual(
      outcomes
        .filter((outcome) => outcome.kind === "error")
        .map((outcome) => [outcome.statusCode, outcome.code]),
      [[409, "insight_duplicate"]]
    );

    configureDatabase({ dataRoot: rootDir, seedDemoData: false });
    await initializeDatabase();
    const active = listInsights({ userIds: ["user_operator"] });
    assert.equal(active.length, 1);
    assert.deepEqual(active[0]?.evidence, insightInput.evidence);

    const dismissed = updateInsight(
      active[0]!.id,
      { status: "dismissed" },
      operatorContext
    );
    assert.equal(dismissed?.status, "dismissed");

    const replacement = createInsight(insightInput, operatorContext);
    assert.notEqual(replacement.id, active[0]!.id);

    const otherOwner = createInsight(insightInput, {
      source: "agent",
      actor: "Forge Bot"
    });
    assert.notEqual(otherOwner.id, replacement.id);
    const ownerRows = getDatabase()
      .prepare(
        `SELECT entity_id, user_id
         FROM entity_owners
         WHERE entity_type = 'insight'
           AND entity_id IN (?, ?)
         ORDER BY entity_id`
      )
      .all(replacement.id, otherOwner.id) as Array<{
      entity_id: string;
      user_id: string;
    }>;
    assert.deepEqual(
      new Set(ownerRows.map((row) => row.user_id)),
      new Set(["user_operator", "user_forge_bot"])
    );

    assert.equal(
      deleteEntity("insight", replacement.id, {}, operatorContext)?.id,
      replacement.id
    );
    assert.throws(
      () => createInsight(insightInput, operatorContext),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 409 &&
        error.code === "insight_duplicate_in_bin" &&
        error.details?.existingId === replacement.id
    );

    const reactivated = updateInsight(
      active[0]!.id,
      { status: "open" },
      operatorContext
    );
    assert.equal(reactivated?.status, "open");
    assert.throws(
      () => createInsight(insightInput, operatorContext),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 409 &&
        error.code === "insight_duplicate" &&
        error.details?.existingId === active[0]!.id
    );
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
