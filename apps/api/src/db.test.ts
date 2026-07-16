import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import {
  resolveDatabasePathForDataRoot,
  resolveDefaultDataRoot
} from "./db.js";

test("resolveDefaultDataRoot selects an available implicit Forge data root", () => {
  const originalForgeDataRoot = process.env.FORGE_DATA_ROOT;
  delete process.env.FORGE_DATA_ROOT;

  try {
    const monorepoDataRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "..",
      "..",
      "data",
      "forge"
    );
    const expected = existsSync(monorepoDataRoot)
      ? monorepoDataRoot
      : path.join(os.homedir(), ".forge");

    assert.equal(resolveDefaultDataRoot("/tmp/forge-standalone"), expected);
  } finally {
    if (originalForgeDataRoot === undefined) {
      delete process.env.FORGE_DATA_ROOT;
    } else {
      process.env.FORGE_DATA_ROOT = originalForgeDataRoot;
    }
  }
});

test("resolveDatabasePathForDataRoot prefers the flat runtime database path", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-db-layout-"));

  try {
    const canonicalPath = path.join(dataRoot, "forge.sqlite");
    await writeFile(canonicalPath, "");

    assert.equal(resolveDatabasePathForDataRoot(dataRoot), canonicalPath);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("resolveDatabasePathForDataRoot falls back to the legacy nested runtime database path", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-db-layout-"));

  try {
    const legacyDir = path.join(dataRoot, "data");
    const legacyPath = path.join(legacyDir, "forge.sqlite");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(legacyPath, "");

    assert.equal(resolveDatabasePathForDataRoot(dataRoot), legacyPath);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
