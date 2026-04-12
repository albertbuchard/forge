import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import { resolveDatabasePathForDataRoot, resolveDefaultDataRoot } from "./db.js";

test("resolveDefaultDataRoot prefers the tracked monorepo Forge data root when available", () => {
  const expected = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "data",
    "forge"
  );

  assert.equal(resolveDefaultDataRoot("/tmp/forge-standalone"), expected);
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
