import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { it } from "node:test";

import { deriveOpaqueChannel } from "../../src/auth.js";
import { encodeBase64Url } from "../../src/encoding.js";
import {
  createTestHarness,
  opaqueId,
  signedHeaders,
  signedInject
} from "../helpers.js";

const PLAINTEXT_FIXTURE = "PRIVATE_FIXTURE_JON_CYCLING_NEXT_MONDAY_0845";
const FORGE_BEARER_FIXTURE = "PRIVATE_FORGE_BEARER_TOKEN_FIXTURE_7ZQ9";
const GRANT_FIXTURE = "PRIVATE_FORGE_GRANT_FIXTURE_4M2K";
const PROJECTION_FIXTURE = "PRIVATE_FORGE_PROJECTION_FIXTURE_8W6P";
const CONTACT_FIXTURE = "private-contact-fixture@example.invalid";
const FORBIDDEN_FIXTURES = [
  PLAINTEXT_FIXTURE,
  FORGE_BEARER_FIXTURE,
  GRANT_FIXTURE,
  PROJECTION_FIXTURE,
  CONTACT_FIXTURE
] as const;

it("proves stored and logged data contains no plaintext fixture, request body, channel, IP, or credential", async () => {
  const harness = await createTestHarness();
  let serviceClosed = false;
  try {
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const encryptedBytes = deterministicEncrypt(PLAINTEXT_FIXTURE);
    const ciphertext = encodeBase64Url(encryptedBytes);
    const presenceUrl = `/v1/presence/${channel}`;
    const rejectedBody = {
      ciphertext,
      expiresInSeconds: 60,
      plaintextProbe: PLAINTEXT_FIXTURE,
      forgeBearerToken: FORGE_BEARER_FIXTURE,
      grant: GRANT_FIXTURE,
      projection: PROJECTION_FIXTURE,
      contact: CONTACT_FIXTURE
    };
    const rejectedIdempotency = opaqueId("blindness-rejected-idempotency");
    const rejectedHeaders = signedHeaders(harness, {
      method: "PUT",
      url: presenceUrl,
      body: rejectedBody,
      idempotencyKey: rejectedIdempotency
    });
    const rejected = await harness.service.app.inject({
      method: "PUT",
      url: presenceUrl,
      headers: rejectedHeaders,
      payload: rejectedBody
    });
    assert.equal(rejected.statusCode, 400);

    const envelopeUrl = `/v1/envelopes/${channel}`;
    const accepted = await signedInject(harness, {
      method: "POST",
      url: envelopeUrl,
      body: {
        messageId: opaqueId("blindness-message"),
        ciphertext,
        expiresInSeconds: 120
      },
      idempotencyKey: opaqueId("blindness-envelope-idempotency")
    });
    assert.equal(accepted.statusCode, 202);

    harness.service.store.checkpoint();
    await harness.service.close();
    serviceClosed = true;

    const logOutput = harness.logs.join("\n");
    const rejectedAuthorization = rejectedHeaders.authorization;
    assert.ok(rejectedAuthorization);
    for (const forbidden of FORBIDDEN_FIXTURES) {
      assert.equal(logOutput.includes(forbidden), false);
    }
    assert.equal(logOutput.includes(ciphertext), false);
    assert.equal(logOutput.includes(channel), false);
    assert.equal(logOutput.includes(rejectedAuthorization), false);
    assert.equal(logOutput.includes("127.0.0.1"), false);

    for (const line of harness.logs) {
      const fields = Object.keys(JSON.parse(line) as Record<string, unknown>);
      const allowed = new Set([
        "timestamp",
        "level",
        "event",
        "durationBucketMs",
        "method",
        "route",
        "statusClass",
        "code",
        "signal"
      ]);
      assert.equal(
        fields.every((field) => allowed.has(field)),
        true
      );
    }

    for (const filePath of [
      harness.databasePath,
      `${harness.databasePath}-wal`,
      `${harness.databasePath}-shm`
    ]) {
      const bytes = await readFile(filePath).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") {
            return Buffer.alloc(0);
          }
          throw error;
        }
      );
      for (const forbidden of FORBIDDEN_FIXTURES) {
        assert.equal(bytes.includes(Buffer.from(forbidden)), false, filePath);
      }
      assert.equal(bytes.includes(Buffer.from(ciphertext)), false, filePath);
    }

    const database = new DatabaseSync(harness.databasePath, { readOnly: true });
    const idempotencyRows = database
      .prepare("SELECT response_json FROM idempotency_records")
      .all() as unknown as { response_json: string }[];
    database.close();
    assert.ok(idempotencyRows.length > 0);
    assert.equal(
      idempotencyRows.some((row) =>
        /ciphertext|plaintextProbe|forgeBearerToken|grant|projection|contact|PRIVATE_FIXTURE/.test(
          row.response_json
        )
      ),
      false
    );
  } finally {
    if (!serviceClosed) {
      await harness.service.close();
    }
    await rm(harness.directory, { force: true, recursive: true });
  }
});

function deterministicEncrypt(plaintext: string): Buffer {
  const key = createHash("sha256")
    .update("forge-connectivity-blindness-test-key")
    .digest();
  const nonce = Buffer.alloc(12, 0x5a);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  return Buffer.concat([nonce, encrypted, cipher.getAuthTag()]);
}
