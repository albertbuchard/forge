import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  assertActiveSupplyChainSecurityExceptions,
  SUPPLY_CHAIN_INVENTORY,
  SUPPLY_CHAIN_SECURITY_EXCEPTIONS
} from "./supply-chain-inventory.js";

const execFileAsync = promisify(execFile);

async function sourceFiles(root: URL): Promise<URL[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: URL[] = [];
  for (const entry of entries) {
    const child = new URL(
      `${entry.name}${entry.isDirectory() ? "/" : ""}`,
      root
    );
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(child)));
    } else if (/\.(?:ts|tsx|js|jsx)$/u.test(entry.name)) {
      files.push(child);
    }
  }
  return files;
}

test("the React Router High advisory exception is bounded and non-reachable", async () => {
  const rootManifest = JSON.parse(
    await readFile(new URL("../../../../package.json", import.meta.url), "utf8")
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const openClawManifest = JSON.parse(
    await readFile(
      new URL("../../../../plugins/openclaw/package.json", import.meta.url),
      "utf8"
    )
  ) as {
    dependencies?: Record<string, string>;
  };
  const exception = SUPPLY_CHAIN_SECURITY_EXCEPTIONS.find(
    (entry) => entry.advisoryId === "GHSA-qwww-vcr4-c8h2"
  );

  assert.ok(exception);
  assert.equal(rootManifest.dependencies?.["react-router-dom"], "7.18.1");
  assert.equal(openClawManifest.dependencies?.["react-router-dom"], "7.18.1");
  assert.equal(rootManifest.dependencies?.["@react-router/dev"], undefined);
  assert.equal(rootManifest.devDependencies?.["@react-router/dev"], undefined);
  assert.doesNotThrow(() => assertActiveSupplyChainSecurityExceptions());
  assert.throws(
    () =>
      assertActiveSupplyChainSecurityExceptions(new Date(exception.expiresAt)),
    /expired/u
  );
  assert.ok(
    Date.parse(exception.expiresAt) <= Date.parse("2026-08-25T00:00:00Z")
  );
  const webSources = await sourceFiles(
    new URL("../../../../apps/web/src/", import.meta.url)
  );
  const contents = await Promise.all(
    webSources.map(async (file) => await readFile(file, "utf8"))
  );
  assert.ok(
    contents.some((content) =>
      /import\s+\{\s*BrowserRouter\s*\}\s+from\s+["']react-router-dom["']/u.test(
        content
      )
    )
  );
  assert.equal(
    contents.some((content) =>
      /createRequestHandler|entry\.rsc|@react-router\/dev/u.test(content)
    ),
    false
  );
  const shippedOpenClawAssets = await sourceFiles(
    new URL("../../../../plugins/openclaw/dist/assets/", import.meta.url)
  );
  const shippedContents = await Promise.all(
    shippedOpenClawAssets.map(async (file) => await readFile(file, "utf8"))
  );
  assert.ok(shippedContents.length > 0);
  assert.equal(
    shippedContents.some((content) =>
      /createRequestHandler|entry\.rsc|react-server-dom|@react-router\/dev/u.test(
        content
      )
    ),
    false
  );
});

test("the desktop RSA advisory exception is bounded and absent from every target graph", async () => {
  const exception = SUPPLY_CHAIN_SECURITY_EXCEPTIONS.find(
    (entry) => entry.advisoryId === "RUSTSEC-2023-0071"
  );

  assert.ok(exception);
  assert.equal(exception.owner, "Forge security maintainers");
  assert.equal(exception.scope, "apps/desktop-tauri/Cargo.lock");
  assert.ok(exception.compensatingControls.length > 0);
  assert.throws(
    () =>
      assertActiveSupplyChainSecurityExceptions(new Date(exception.expiresAt)),
    /expired/u
  );

  const repoRoot = path.resolve(
    new URL("../../../../", import.meta.url).pathname
  );
  const { stdout, stderr } = await execFileAsync(
    "cargo",
    [
      "tree",
      "--locked",
      "--manifest-path",
      "apps/desktop-tauri/Cargo.toml",
      "--target",
      "all",
      "-i",
      "rsa"
    ],
    { cwd: repoRoot }
  );
  assert.equal(stdout.trim(), "");
  assert.match(stderr, /nothing to print/u);
});

test("shipped plugin audits exclude host peer dependencies", () => {
  const openClaw = SUPPLY_CHAIN_INVENTORY.find(
    (entry) => entry.id === "openclaw-node"
  );

  assert.ok(openClaw);
  assert.deepEqual(openClaw.auditCommands, [
    "npm --prefix plugins/openclaw audit --omit=dev --omit=peer --json"
  ]);
});

test("every shipped ecosystem has a canonical manifest, lock policy, and executable scan plan", async () => {
  const repoRoot = path.resolve(
    new URL("../../../../", import.meta.url).pathname
  );
  const requiredCanonicalManifests = new Set([
    "package.json",
    "packages/course-kit/package.json",
    "packages/forge-memory/package.json",
    "packages/forge-connectivity-service/package.json",
    "plugins/openclaw/package.json",
    "plugins/hermes/pyproject.toml",
    "packages/forge-peer/Cargo.toml",
    "packages/forge-peer/fuzz/Cargo.toml",
    "packages/companion-iroh/Cargo.toml",
    "apps/desktop-tauri/Cargo.toml",
    "apps/ios-companion/Gemfile",
    "apps/ios-companion/project.yml"
  ]);
  const inventoriedManifests: Set<string> = new Set(
    SUPPLY_CHAIN_INVENTORY.flatMap((entry) => entry.canonicalManifests)
  );
  assert.deepEqual(
    [...requiredCanonicalManifests].filter(
      (manifest) => !inventoriedManifests.has(manifest)
    ),
    []
  );
  for (const entry of SUPPLY_CHAIN_INVENTORY) {
    assert.ok(entry.auditCommands.length > 0, `${entry.id}: audit commands`);
    if (entry.lockRequiredBeforeRelease) {
      assert.ok(entry.lockfiles.length > 0, `${entry.id}: lockfile required`);
    }
    for (const relativePath of [
      ...entry.canonicalManifests,
      ...entry.lockfiles,
      ...entry.generatedMirrors
    ]) {
      await assert.doesNotReject(
        access(path.join(repoRoot, relativePath)),
        `${entry.id}: ${relativePath}`
      );
    }
  }
  await assert.doesNotReject(
    access(path.join(repoRoot, "scripts/ci/check-security-mirror-receipts.mjs"))
  );
  await assert.doesNotReject(
    access(path.join(repoRoot, "apps/desktop-tauri/deny.toml"))
  );
});

test("Forge peer Git dependencies are pinned to full commit revisions", async () => {
  const manifest = await readFile(
    new URL("../../../../packages/forge-peer/Cargo.toml", import.meta.url),
    "utf8"
  );
  const gitDependencies = [
    ...manifest.matchAll(
      /^\s*[a-zA-Z0-9_-]+\s*=\s*\{[^}\n]*\bgit\s*=\s*"[^"]+"[^}\n]*\}\s*$/gmu
    )
  ];

  assert.doesNotMatch(manifest, /=\s*"\*"/u);
  assert.doesNotMatch(manifest, /\bversion\s*=\s*"\*"/u);
  assert.ok(gitDependencies.length > 0);
  for (const dependency of gitDependencies) {
    assert.match(dependency[0], /\brev\s*=\s*"[a-f0-9]{40}"/u);
  }
});
