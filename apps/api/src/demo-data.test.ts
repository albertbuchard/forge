import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { seedDemoDataIntoRuntime } from "./demo-data.js";

test("demo seed bootstraps fixtures into an empty runtime", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-demo-seed-"));

  try {
    const summary = await seedDemoDataIntoRuntime(dataRoot);

    assert.equal(summary.dataRoot, dataRoot);
    assert.equal(summary.databasePath, path.join(dataRoot, "forge.sqlite"));
    assert.equal(summary.counts.goals, 3);
    assert.equal(summary.counts.projects, 3);
    assert.equal(summary.counts.tasks, 5);
    assert.equal(summary.counts.task_runs, 0);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("demo seed refuses to write into a runtime that already has personal content", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-demo-seed-"));

  try {
    await seedDemoDataIntoRuntime(dataRoot);
    await assert.rejects(
      () => seedDemoDataIntoRuntime(dataRoot),
      /Refusing to seed demo data into a non-empty Forge runtime/
    );
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
