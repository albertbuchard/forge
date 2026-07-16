import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createNativeSourceManifest,
  serializeNativeSourceManifest,
  serializeNativeSourceSignature,
  signNativeSourceManifest
} from "../lib/native-source-manifest.mjs";
import {
  inspectForgePeerRuntime,
  PeerRuntimeInstallError,
  prepareForgePeerRuntime
} from "../lib/peer-runtime-install.mjs";

const NOW = new Date("2026-07-15T13:00:00.000Z");

function keyFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const id = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")
    .slice(0, 32);
  return {
    privateKey,
    trusted: {
      id,
      algorithm: "Ed25519",
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
      notBefore: "2026-01-01T00:00:00.000Z",
      notAfter: null,
      revokedAt: null
    }
  };
}

async function fixture(t, { signed = true } = {}) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "forge-peer-install-test-")
  );
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const pluginRoot = path.join(root, "plugin");
  const sourceRoot = path.join(pluginRoot, "dist", "forge-peer-src");
  const nativeRoot = path.join(root, "native");
  await mkdir(path.join(sourceRoot, "src"), { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(sourceRoot, "Cargo.toml"),
    '[package]\nname = "forge-peer"\nversion = "0.1.0"\n',
    { mode: 0o600 }
  );
  await writeFile(path.join(sourceRoot, "Cargo.lock"), "# locked\n", {
    mode: 0o600
  });
  await writeFile(path.join(sourceRoot, "src", "lib.rs"), "pub fn ok() {}\n", {
    mode: 0o600
  });
  const key = keyFixture();
  const manifest = await createNativeSourceManifest({
    sourceRoot,
    packageVersion: "0.1.0",
    runtimePackageVersion: "0.3.33",
    commitSha: "b".repeat(40),
    generatedAt: new Date("2026-07-15T12:00:00.000Z"),
    signingKeyId: key.trusted.id
  });
  await writeFile(
    path.join(sourceRoot, "native-source.manifest.json"),
    serializeNativeSourceManifest(manifest),
    { mode: 0o600 }
  );
  if (signed) {
    await writeFile(
      path.join(sourceRoot, "native-source.signature.json"),
      serializeNativeSourceSignature(
        signNativeSourceManifest(manifest, key.privateKey)
      ),
      { mode: 0o600 }
    );
  }
  return { root, pluginRoot, sourceRoot, nativeRoot, key };
}

function fakeCargo(calls) {
  return async ({ args, cwd, env }) => {
    calls.push({ args, cwd, env });
    const binaryPath = path.join(env.CARGO_TARGET_DIR, "release", "forge-peer");
    await mkdir(path.dirname(binaryPath), { recursive: true, mode: 0o700 });
    await writeFile(binaryPath, "verified fake peer binary\n", { mode: 0o700 });
    await chmod(binaryPath, 0o700);
    return { ok: true };
  };
}

async function prepare(value, calls) {
  return await prepareForgePeerRuntime({
    mode: "packaged",
    pluginRoot: value.pluginRoot,
    repoRoot: null,
    nativeRoot: value.nativeRoot,
    runtimePackageVersion: "0.3.33",
    trustedKeys: [value.key.trusted],
    now: NOW,
    environment: { PATH: process.env.PATH },
    runCargo: fakeCargo(calls)
  });
}

async function inspect(value) {
  return await inspectForgePeerRuntime({
    mode: "packaged",
    pluginRoot: value.pluginRoot,
    repoRoot: null,
    nativeRoot: value.nativeRoot,
    runtimePackageVersion: "0.3.33",
    trustedKeys: [value.key.trusted],
    now: NOW
  });
}

test("builds verified source outside the signed tree and records a receipt", async (t) => {
  const value = await fixture(t);
  const calls = [];
  const before = await readFile(path.join(value.sourceRoot, "src", "lib.rs"));
  const result = await prepare(value, calls);
  assert.equal(result.built, true);
  assert.equal(calls.length, 1);
  assert.ok(!result.binaryPath.startsWith(value.sourceRoot));
  assert.deepEqual(
    await readFile(path.join(value.sourceRoot, "src", "lib.rs")),
    before
  );
  assert.equal(
    JSON.parse(await readFile(result.receiptPath, "utf8")).schemaVersion,
    1
  );
});

test("reuses only an exact verified binary receipt", async (t) => {
  const value = await fixture(t);
  const calls = [];
  const first = await prepare(value, calls);
  const second = await prepare(value, calls);
  assert.equal(first.built, true);
  assert.equal(second.built, false);
  assert.equal(calls.length, 1);
});

test("inspects a verified cached runtime without rebuilding it", async (t) => {
  const value = await fixture(t);
  const calls = [];
  const prepared = await prepare(value, calls);
  const inspected = await inspect(value);
  assert.equal(inspected.ok, true);
  assert.equal(inspected.sourceVerified, true);
  assert.equal(inspected.binaryVerified, true);
  assert.equal(inspected.binaryPath, prepared.binaryPath);
  assert.equal(calls.length, 1);
});

test("rebuilds a cached binary after checksum tampering", async (t) => {
  const value = await fixture(t);
  const calls = [];
  const first = await prepare(value, calls);
  await writeFile(first.binaryPath, "tampered\n", { mode: 0o700 });
  const second = await prepare(value, calls);
  assert.equal(second.built, true);
  assert.equal(calls.length, 2);
});

test("treats a malformed receipt timestamp as a cache miss", async (t) => {
  const value = await fixture(t);
  const calls = [];
  const first = await prepare(value, calls);
  const receipt = JSON.parse(await readFile(first.receiptPath, "utf8"));
  await writeFile(
    first.receiptPath,
    `${JSON.stringify({ ...receipt, builtAt: "not-a-timestamp" })}\n`,
    { mode: 0o600 }
  );
  const second = await prepare(value, calls);
  assert.equal(second.built, true);
  assert.equal(calls.length, 2);
});

test("reports a tampered cached runtime without mutating it", async (t) => {
  const value = await fixture(t);
  const calls = [];
  const first = await prepare(value, calls);
  await writeFile(first.binaryPath, "tampered\n", { mode: 0o700 });
  const inspected = await inspect(value);
  assert.equal(inspected.ok, false);
  assert.equal(inspected.sourceVerified, true);
  assert.equal(inspected.binaryVerified, false);
  assert.equal(inspected.binaryPath, null);
  assert.equal(calls.length, 1);
});

test("rejects a symlinked intermediate native build directory", async (t) => {
  const value = await fixture(t);
  const outside = path.join(value.root, "outside");
  await mkdir(value.nativeRoot, { recursive: true, mode: 0o700 });
  await mkdir(outside, { mode: 0o700 });
  await symlink(outside, path.join(value.nativeRoot, "forge-peer"));
  const calls = [];
  await assert.rejects(prepare(value, calls), (error) => {
    assert.equal(error.code, "filesystem");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("refuses unsigned packaged peer source before invoking Cargo", async (t) => {
  const value = await fixture(t, { signed: false });
  const calls = [];
  await assert.rejects(prepare(value, calls), (error) => {
    assert.equal(error.code, "missing");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("fails closed when Cargo cannot build verified source", async (t) => {
  const value = await fixture(t);
  await assert.rejects(
    prepareForgePeerRuntime({
      mode: "packaged",
      pluginRoot: value.pluginRoot,
      repoRoot: null,
      nativeRoot: value.nativeRoot,
      runtimePackageVersion: "0.3.33",
      trustedKeys: [value.key.trusted],
      now: NOW,
      environment: {},
      runCargo: async () => ({ ok: false })
    }),
    (error) => {
      assert.ok(error instanceof PeerRuntimeInstallError);
      assert.equal(error.code, "build");
      return true;
    }
  );
});
