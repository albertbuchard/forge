#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireForgeWebBuildLock } from "./forge-web-build-lock.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");

export async function runLockedWebBuild(args = process.argv.slice(2)) {
  const runLock = await acquireForgeWebBuildLock({
    repositoryRoot: repoRoot,
    onWait: (message) => process.stderr.write(message)
  });
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, "node_modules/vite/bin/vite.js"), "build", ...args],
      {
        cwd: repoRoot,
        stdio: "inherit",
        env: process.env
      }
    );
    if (result.error) throw result.error;
    if (result.signal) {
      throw new Error(`Vite build stopped after signal ${result.signal}.`);
    }
    return result.status ?? 1;
  } finally {
    runLock.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runLockedWebBuild()
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error) => {
      process.stderr.write(
        `ERROR: ${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    });
}
