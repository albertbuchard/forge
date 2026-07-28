import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateIsolatedE2eRuntime } from "./security/e2e-runtime-guard.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

function isolatedRoot() {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "forge-e2e-guard-"))
  );
  chmodSync(root, 0o700);
  writeFileSync(
    path.join(root, ".forge-people-sharing-release-root.json"),
    `${JSON.stringify({
      schema: "forge-people-sharing-release-root/1",
      purpose: "isolated Forge People sharing release verification",
      root,
      allowMutation: true
    })}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return root;
}

function environment(root: string): NodeJS.ProcessEnv {
  return {
    FORGE_E2E_MODE: "isolated",
    FORGE_E2E_DATA_ROOT: root,
    FORGE_E2E_PORT: "45678",
    HOST: "127.0.0.1",
    PORT: "45678"
  };
}

test("accepts only an owner-only marked loopback E2E root", () => {
  const root = isolatedRoot();
  try {
    assert.deepEqual(validateIsolatedE2eRuntime(environment(root), repoRoot), {
      dataRoot: root,
      host: "127.0.0.1",
      port: 45678,
      authorityPath: path.join(root, ".forge-e2e-browser-authority.json")
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects missing mode, remote hosts, live ports, and stale authority", () => {
  const root = isolatedRoot();
  try {
    assert.throws(
      () =>
        validateIsolatedE2eRuntime(
          { ...environment(root), FORGE_E2E_MODE: "" },
          repoRoot
        ),
      /explicit isolated mode/
    );
    assert.throws(
      () =>
        validateIsolatedE2eRuntime(
          { ...environment(root), HOST: "0.0.0.0" },
          repoRoot
        ),
      /only to 127\.0\.0\.1/
    );
    assert.throws(
      () =>
        validateIsolatedE2eRuntime(
          {
            ...environment(root),
            PORT: "4317",
            FORGE_E2E_PORT: "4317"
          },
          repoRoot
        ),
      /non-live loopback port/
    );
    writeFileSync(
      path.join(root, ".forge-e2e-browser-authority.json"),
      "{}\n",
      { encoding: "utf8", mode: 0o600 }
    );
    assert.throws(
      () => validateIsolatedE2eRuntime(environment(root), repoRoot),
      /stale browser authority/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "rejects permissive roots on Unix",
  { skip: process.platform === "win32" },
  () => {
    const root = isolatedRoot();
    try {
      chmodSync(root, 0o755);
      assert.throws(
        () => validateIsolatedE2eRuntime(environment(root), repoRoot),
        /accessible only by this user/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);
