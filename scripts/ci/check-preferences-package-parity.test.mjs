import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkPreferenceMigrationCopies } from "./check-preferences-package-parity.mjs";

async function createFixture() {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-preferences-parity-")
  );
  const sourcePath = "apps/api/migrations/086_preference.sql";
  await mkdir(path.join(repoRoot, path.dirname(sourcePath)), {
    recursive: true
  });
  await writeFile(path.join(repoRoot, sourcePath), "SELECT 1;\n");
  return { repoRoot, sourcePath };
}

test("clean checkout fails closed when a required source-runtime migration is absent", async () => {
  const { repoRoot } = await createFixture();
  try {
    const result = await checkPreferenceMigrationCopies({
      repoRoot,
      trackedPaths: new Set(),
      migrationNames: ["086_preference.sql"],
      requiredDestinations: ["plugins/codex/runtime/server/migrations"],
      generatedDestinations: []
    });
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /required source-runtime migration is missing/);
    assert.equal(result.checked, 0);
    assert.equal(result.skippedGenerated, 0);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("clean checkout may skip only explicitly generated runtime outputs", async () => {
  const { repoRoot } = await createFixture();
  try {
    const result = await checkPreferenceMigrationCopies({
      repoRoot,
      trackedPaths: new Set(),
      migrationNames: ["086_preference.sql"],
      requiredDestinations: [],
      generatedDestinations: ["plugins/openclaw/dist/server/migrations"]
    });
    assert.deepEqual(result.failures, []);
    assert.equal(result.checked, 0);
    assert.equal(result.skippedGenerated, 1);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("tracked package mirrors remain mandatory and content-checked", async () => {
  const { repoRoot } = await createFixture();
  const packagedPath =
    "plugins/hermes/forge_hermes/runtime/apps/api/migrations/086_preference.sql";
  try {
    const missing = await checkPreferenceMigrationCopies({
      repoRoot,
      trackedPaths: new Set([packagedPath]),
      migrationNames: ["086_preference.sql"],
      requiredDestinations: [],
      generatedDestinations: [path.dirname(packagedPath)]
    });
    assert.equal(missing.failures.length, 1);
    assert.match(missing.failures[0], /tracked package mirror is missing/);

    await mkdir(path.join(repoRoot, path.dirname(packagedPath)), {
      recursive: true
    });
    await writeFile(path.join(repoRoot, packagedPath), "SELECT 2;\n");
    const stale = await checkPreferenceMigrationCopies({
      repoRoot,
      trackedPaths: new Set([packagedPath]),
      migrationNames: ["086_preference.sql"],
      requiredDestinations: [],
      generatedDestinations: [path.dirname(packagedPath)]
    });
    assert.deepEqual(stale.failures, [
      `${packagedPath}: content differs from apps/api/migrations/086_preference.sql`
    ]);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("explicit generated-output checks fail truthfully when a build output is absent", async () => {
  const { repoRoot } = await createFixture();
  try {
    const result = await checkPreferenceMigrationCopies({
      repoRoot,
      trackedPaths: new Set(),
      checkGeneratedOutputs: true,
      migrationNames: ["086_preference.sql"],
      requiredDestinations: [],
      generatedDestinations: [
        "plugins/codex/runtime/dist/server/migrations"
      ]
    });
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /generated output is missing/);
    assert.equal(result.skippedGenerated, 0);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
