#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(candidate) : [candidate];
  });
}

export function collectPeopleSharingTestFiles(root = repoRoot) {
  const sourceRoot = path.join(root, "apps/api/src");
  return walk(sourceRoot)
    .filter((candidate) => /\/(?:people|peer)[^/]*\.test\.ts$/.test(candidate))
    .map((candidate) => path.relative(root, candidate))
    .sort();
}

function main() {
  const files = collectPeopleSharingTestFiles();
  if (files.length === 0) {
    throw new Error("No People or peer-sharing API tests were found.");
  }

  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "--test-concurrency=1", ...files],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit"
    }
  );
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(
      `People and peer-sharing API tests failed with exit code ${child.status}.`
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `ERROR: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
