#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  mkdtempSync,
  openSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initializeReleaseTestRoot,
  validateReleaseTestRoot
} from "./check-people-sharing-release.mjs";
import { acquireForgeWebBuildLock } from "./forge-web-build-lock.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");

function validationEnvironment(root) {
  return {
    ...process.env,
    FORGE_E2E_DATA_ROOT: "",
    FORGE_DATA_ROOT:
      path.resolve(process.env.FORGE_DATA_ROOT ?? "") === path.resolve(root)
        ? ""
        : process.env.FORGE_DATA_ROOT
  };
}

function parsePreferredPort(value) {
  if (!value?.trim()) return null;
  const port = Number.parseInt(value, 10);
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65_535 ||
    port === 4317 ||
    port === 3027
  ) {
    throw new Error("FORGE_E2E_PORT must be a non-live user port.");
  }
  return port;
}

async function probePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(null));
    server.listen({ host: "127.0.0.1", port }, () => {
      const address = server.address();
      const selected =
        typeof address === "object" && address ? address.port : null;
      server.close(() => resolve(selected));
    });
  });
}

export async function reserveIsolatedE2ePort(preferredPort = null) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = await probePort(
      attempt === 0 && preferredPort ? preferredPort : 0
    );
    if (!candidate || candidate === 4317 || candidate === 3027) {
      continue;
    }
    const lockPath = path.join(os.tmpdir(), `forge-e2e-port-${candidate}.lock`);
    try {
      const descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(descriptor, `${process.pid}\n`, { encoding: "utf8" });
      closeSync(descriptor);
      return {
        port: candidate,
        release() {
          unlinkSync(lockPath);
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not reserve an isolated Forge E2E port.");
}

export async function runIsolatedE2e(args = process.argv.slice(2)) {
  const runLock = await acquireForgeWebBuildLock({
    repositoryRoot: repoRoot,
    onWait: (message) => process.stderr.write(message)
  });
  try {
    const configuredRoot = process.env.FORGE_E2E_DATA_ROOT?.trim();
    let autoRoot = null;
    const dataRoot = configuredRoot
      ? validateReleaseTestRoot(
          configuredRoot,
          validationEnvironment(configuredRoot)
        )
      : initializeReleaseTestRoot(
          (autoRoot = mkdtempSync(path.join(os.tmpdir(), "forge-e2e-run-"))),
          validationEnvironment(autoRoot)
        );
    const reservation = await reserveIsolatedE2ePort(
      parsePreferredPort(process.env.FORGE_E2E_PORT)
    );
    try {
      const outputDir = path.join(
        dataRoot,
        ".forge-e2e-artifacts",
        randomUUID()
      );
      const result = spawnSync(
        process.execPath,
        [
          path.join(repoRoot, "node_modules/@playwright/test/cli.js"),
          "test",
          ...args
        ],
        {
          cwd: repoRoot,
          stdio: "inherit",
          env: {
            ...process.env,
            FORGE_DATA_ROOT: dataRoot,
            FORGE_E2E_DATA_ROOT: dataRoot,
            FORGE_E2E_MODE: "isolated",
            FORGE_E2E_OUTPUT_DIR: outputDir,
            FORGE_E2E_PORT: String(reservation.port),
            FORGE_E2E_REUSE_EXISTING_SERVER: "0",
            HOST: "127.0.0.1",
            PORT: String(reservation.port)
          }
        }
      );
      if (result.error) throw result.error;
      if (result.signal) {
        throw new Error(`Playwright stopped after signal ${result.signal}.`);
      }
      return result.status ?? 1;
    } finally {
      reservation.release();
      if (autoRoot) {
        validateReleaseTestRoot(autoRoot, validationEnvironment(autoRoot));
        rmSync(autoRoot, { recursive: true, force: true });
      }
    }
  } finally {
    runLock.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runIsolatedE2e()
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
