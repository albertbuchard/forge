import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FORGE_NATIVE_SOURCE_REPOSITORY,
  NATIVE_SOURCE_MANIFEST_FILE,
  NATIVE_SOURCE_SIGNATURE_FILE,
  NativeSourceManifestError,
  UNSIGNED_INTEGRATION_COMMIT_SHA,
  UNSIGNED_INTEGRATION_SIGNING_KEY_ID,
  createNativeSourceManifest,
  serializeNativeSourceManifest,
  serializeNativeSourceSignature,
  signNativeSourceManifest,
  verifyNativeSourceBundle
} from "../lib/native-source-manifest.mjs";

const GENERATED_AT = new Date("2026-07-15T12:00:00.000Z");
const VERIFY_AT = new Date("2026-07-15T13:00:00.000Z");

function keyFixture(overrides = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const id = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex")
    .slice(0, 32);
  return {
    privateKey,
    trusted: {
      id,
      algorithm: "Ed25519",
      publicKeyPem,
      notBefore: "2026-01-01T00:00:00.000Z",
      notAfter: null,
      revokedAt: null,
      ...overrides
    }
  };
}

async function sourceFixture(t) {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), "forge-native-source-test-")
  );
  t.after(async () => await rm(parent, { recursive: true, force: true }));
  const sourceRoot = path.join(parent, "forge-peer-src");
  await mkdir(path.join(sourceRoot, "src"), { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(sourceRoot, "Cargo.toml"),
    '[package]\nname = "forge-peer"\nversion = "0.1.0"\n',
    { mode: 0o600 }
  );
  await writeFile(path.join(sourceRoot, "src", "lib.rs"), "pub fn ok() {}\n", {
    mode: 0o600
  });
  return sourceRoot;
}

async function signedFixture(t, options = {}) {
  const sourceRoot = await sourceFixture(t);
  const key = options.key ?? keyFixture();
  const manifest = await createNativeSourceManifest({
    sourceRoot,
    packageVersion: "0.1.0",
    runtimePackageVersion: "0.3.33",
    commitSha: "a".repeat(40),
    generatedAt: GENERATED_AT,
    signingKeyId: key.trusted.id
  });
  const signature = signNativeSourceManifest(manifest, key.privateKey);
  await writeFile(
    path.join(sourceRoot, NATIVE_SOURCE_MANIFEST_FILE),
    serializeNativeSourceManifest(manifest),
    { mode: 0o600 }
  );
  await writeFile(
    path.join(sourceRoot, NATIVE_SOURCE_SIGNATURE_FILE),
    serializeNativeSourceSignature(signature),
    { mode: 0o600 }
  );
  return { sourceRoot, key, manifest, signature };
}

async function verify(fixture, overrides = {}) {
  return await verifyNativeSourceBundle({
    sourceRoot: fixture.sourceRoot,
    expectedRuntimePackageVersion: "0.3.33",
    trustedKeys: [fixture.key.trusted],
    now: VERIFY_AT,
    ...overrides
  });
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof NativeSourceManifestError);
    assert.equal(error.code, code);
    return true;
  });
}

test("verifies a canonical source tree against a pinned Ed25519 key", async (t) => {
  const fixture = await signedFixture(t);
  const result = await verify(fixture);
  assert.equal(result.manifest.repository, FORGE_NATIVE_SOURCE_REPOSITORY);
  assert.equal(result.manifest.files.length, 2);
  assert.deepEqual(
    result.manifest.files.map((entry) => entry.path),
    ["Cargo.toml", "src/lib.rs"]
  );
});

test("unsigned integration provenance is explicit and never verifies for adoption", async (t) => {
  const sourceRoot = await sourceFixture(t);
  const manifest = await createNativeSourceManifest({
    sourceRoot,
    packageVersion: "0.1.0",
    runtimePackageVersion: "0.3.33",
    commitSha: UNSIGNED_INTEGRATION_COMMIT_SHA,
    generatedAt: GENERATED_AT,
    signingKeyId: UNSIGNED_INTEGRATION_SIGNING_KEY_ID
  });
  assert.equal(manifest.commitSha, UNSIGNED_INTEGRATION_COMMIT_SHA);
  assert.equal(manifest.signingKeyId, UNSIGNED_INTEGRATION_SIGNING_KEY_ID);
  await writeFile(
    path.join(sourceRoot, NATIVE_SOURCE_MANIFEST_FILE),
    serializeNativeSourceManifest(manifest),
    { mode: 0o600 }
  );
  await rejectsCode(
    verifyNativeSourceBundle({
      sourceRoot,
      expectedRuntimePackageVersion: "0.3.33",
      trustedKeys: [],
      now: VERIFY_AT
    }),
    "missing"
  );
  await assert.rejects(
    createNativeSourceManifest({
      sourceRoot,
      packageVersion: "0.1.0",
      runtimePackageVersion: "0.3.33",
      commitSha: "a".repeat(40),
      generatedAt: GENERATED_AT,
      signingKeyId: UNSIGNED_INTEGRATION_SIGNING_KEY_ID
    }),
    (error) =>
      error instanceof NativeSourceManifestError && error.code === "provenance"
  );
});

test("rejects a manifest changed after signing", async (t) => {
  const fixture = await signedFixture(t);
  const changed = {
    ...fixture.manifest,
    packageVersion: "0.1.1"
  };
  await writeFile(
    path.join(fixture.sourceRoot, NATIVE_SOURCE_MANIFEST_FILE),
    serializeNativeSourceManifest(changed),
    { mode: 0o600 }
  );
  await rejectsCode(verify(fixture), "signature");
});

test("rejects a substituted manifest key even when the attacker signs it", async (t) => {
  const fixture = await signedFixture(t);
  const attacker = keyFixture();
  const attackerManifest = {
    ...fixture.manifest,
    signingKeyId: attacker.trusted.id
  };
  const attackerSignature = signNativeSourceManifest(
    attackerManifest,
    attacker.privateKey
  );
  await writeFile(
    path.join(fixture.sourceRoot, NATIVE_SOURCE_MANIFEST_FILE),
    serializeNativeSourceManifest(attackerManifest),
    { mode: 0o600 }
  );
  await writeFile(
    path.join(fixture.sourceRoot, NATIVE_SOURCE_SIGNATURE_FILE),
    serializeNativeSourceSignature(attackerSignature),
    { mode: 0o600 }
  );
  await rejectsCode(verify(fixture), "untrusted_key");
});

test("rejects a wrong repository before admitting source", async (t) => {
  const fixture = await signedFixture(t);
  const manifestPath = path.join(
    fixture.sourceRoot,
    NATIVE_SOURCE_MANIFEST_FILE
  );
  const value = JSON.parse(await readFile(manifestPath, "utf8"));
  value.repository = "https://github.com/attacker/forge";
  await writeFile(manifestPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rejectsCode(verify(fixture), "provenance");
});

test("rejects a manifest signed after the key validity interval", async (t) => {
  const fixture = await signedFixture(t);
  await rejectsCode(
    verify(fixture, {
      trustedKeys: [
        {
          ...fixture.key.trusted,
          notAfter: "2026-07-15T11:59:59.000Z"
        }
      ]
    }),
    "expired_key"
  );
});

test("rejects a revoked signing key regardless of signature age", async (t) => {
  const fixture = await signedFixture(t);
  await rejectsCode(
    verify(fixture, {
      trustedKeys: [
        {
          ...fixture.key.trusted,
          revokedAt: "2026-07-15T12:30:00.000Z"
        }
      ]
    }),
    "revoked_key"
  );
});

test("rejects checksum drift in a signed source file", async (t) => {
  const fixture = await signedFixture(t);
  await writeFile(
    path.join(fixture.sourceRoot, "src", "lib.rs"),
    "pub fn changed() {}\n",
    { mode: 0o600 }
  );
  await rejectsCode(verify(fixture), "checksum");
});

test("rejects a missing signed file", async (t) => {
  const fixture = await signedFixture(t);
  await rm(path.join(fixture.sourceRoot, "src", "lib.rs"));
  await rejectsCode(verify(fixture), "file_set");
});

test("rejects an unsigned extra executable", async (t) => {
  const fixture = await signedFixture(t);
  const executable = path.join(fixture.sourceRoot, "install.sh");
  await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await chmod(executable, 0o700);
  await rejectsCode(verify(fixture), "file_set");
});

test("rejects a symlink anywhere in the native source tree", async (t) => {
  const fixture = await signedFixture(t);
  await symlink("lib.rs", path.join(fixture.sourceRoot, "src", "alias.rs"));
  await rejectsCode(verify(fixture), "filesystem");
});

test("rejects unknown manifest fields and non-canonical JSON", async (t) => {
  const fixture = await signedFixture(t);
  const manifestPath = path.join(
    fixture.sourceRoot,
    NATIVE_SOURCE_MANIFEST_FILE
  );
  const value = JSON.parse(await readFile(manifestPath, "utf8"));
  value.publicKey = createPublicKey(fixture.key.privateKey).export({
    type: "spki",
    format: "pem"
  });
  await writeFile(manifestPath, JSON.stringify(value, null, 2), {
    mode: 0o600
  });
  await rejectsCode(verify(fixture), "schema");
});

test("rejects a missing detached signature", async (t) => {
  const fixture = await signedFixture(t);
  await rm(path.join(fixture.sourceRoot, NATIVE_SOURCE_SIGNATURE_FILE));
  await rejectsCode(verify(fixture), "missing");
});
