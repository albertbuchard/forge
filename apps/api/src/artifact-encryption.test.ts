import assert from "node:assert/strict";
import test from "node:test";
import {
  ARTIFACT_ENCRYPTION_MEMLIMIT,
  ARTIFACT_ENCRYPTION_OPSLIMIT,
  decryptArtifactBytes,
  encryptArtifactBytes,
  safeContentProtectionFromEnvelope
} from "./services/artifact-encryption.js";

const password = "correct sample passphrase";
const fixture = Buffer.from(
  "name,value\nalpha,1\nbeta,2\n".repeat(8000),
  "utf8"
);

test("artifact encryption round trips exact bytes and records KDF parameters", async () => {
  const encrypted = await encryptArtifactBytes({
    plaintext: fixture,
    password,
    originalFileName: "fixture.csv",
    detectedMimeType: "text/csv",
    artifactId: "artifact_crypto_test",
    versionId: "artifact_version_crypto_test",
    encryptedAt: "2026-07-01T12:00:00.000Z"
  });

  assert.notEqual(encrypted.ciphertext.toString("utf8"), fixture.toString("utf8"));
  assert.equal(encrypted.envelope.kdf, "argon2id");
  assert.equal(encrypted.envelope.kdfParams.memlimit, ARTIFACT_ENCRYPTION_MEMLIMIT);
  assert.equal(encrypted.envelope.kdfParams.opslimit, ARTIFACT_ENCRYPTION_OPSLIMIT);
  assert.equal(encrypted.envelope.kdfParams.parallelism, 1);

  const decrypted = await decryptArtifactBytes({
    ciphertext: encrypted.ciphertext,
    password,
    envelope: encrypted.envelope
  });
  assert.deepEqual(decrypted.plaintext, fixture);

  const safe = safeContentProtectionFromEnvelope({
    mode: "password_encrypted",
    encryptedAt: encrypted.envelope.encryptedAt,
    envelope: encrypted.envelope,
    passwordHint: "csv hint"
  });
  assert.equal(safe.mode, "password_encrypted");
  assert.equal(safe.passwordHint, "csv hint");
  assert.equal(safe.kdfParams?.parallelism, 1);
  assert.equal(JSON.stringify(safe).includes(password), false);
});

test("artifact encryption rejects wrong password and tampering", async () => {
  const encrypted = await encryptArtifactBytes({
    plaintext: fixture,
    password,
    originalFileName: "fixture.csv",
    detectedMimeType: "text/csv",
    artifactId: "artifact_crypto_test",
    versionId: "artifact_version_crypto_test",
    encryptedAt: "2026-07-01T12:00:00.000Z"
  });

  await assert.rejects(
    () =>
      decryptArtifactBytes({
        ciphertext: encrypted.ciphertext,
        password: "wrong sample passphrase",
        envelope: encrypted.envelope
      }),
    /password|decrypt|Artifact/i
  );

  const tamperedCiphertext = Buffer.from(encrypted.ciphertext);
  tamperedCiphertext[Math.floor(tamperedCiphertext.length / 2)] ^= 0xff;
  await assert.rejects(
    () =>
      decryptArtifactBytes({
        ciphertext: tamperedCiphertext,
        password,
        envelope: encrypted.envelope
      }),
    /password|decrypt|Artifact/i
  );

  await assert.rejects(
    () =>
      decryptArtifactBytes({
        ciphertext: encrypted.ciphertext,
        password,
        envelope: {
          ...encrypted.envelope,
          originalFileName: "tampered.csv"
        }
      }),
    /password|decrypt|Artifact/i
  );
});

test("artifact encryption uses random salts for same password and plaintext", async () => {
  const base = {
    plaintext: fixture,
    password,
    originalFileName: "fixture.csv",
    detectedMimeType: "text/csv",
    artifactId: "artifact_crypto_test",
    versionId: "artifact_version_crypto_test",
    encryptedAt: "2026-07-01T12:00:00.000Z"
  };
  const first = await encryptArtifactBytes(base);
  const second = await encryptArtifactBytes(base);

  assert.notEqual(first.envelope.saltBase64, second.envelope.saltBase64);
  assert.notDeepEqual(first.ciphertext, second.ciphertext);
});

test("artifact encryption round trips zero-byte plaintext", async () => {
  const encrypted = await encryptArtifactBytes({
    plaintext: Buffer.alloc(0),
    password,
    originalFileName: "empty.txt",
    detectedMimeType: "text/plain",
    artifactId: "artifact_crypto_empty_test",
    versionId: "artifact_version_crypto_empty_test",
    encryptedAt: "2026-07-01T12:00:00.000Z"
  });

  assert.ok(encrypted.ciphertext.byteLength > 0);
  assert.equal(encrypted.envelope.plaintextByteSize, 0);

  const decrypted = await decryptArtifactBytes({
    ciphertext: encrypted.ciphertext,
    password,
    envelope: encrypted.envelope
  });
  assert.equal(decrypted.plaintext.byteLength, 0);
});
