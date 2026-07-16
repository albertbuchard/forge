import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";

import {
  createChannelAuthorization,
  deriveOpaqueChannel
} from "../../src/auth.js";
import { hashOpaqueChannel } from "../../src/encoding.js";
import {
  ciphertextFixture,
  createTestHarness,
  opaqueId,
  signedHeaders,
  signedInject,
  waitForTurn
} from "../helpers.js";

describe("authentication abuse controls", () => {
  it("rejects malformed signatures, tampering, and request replay", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const url = `/v1/presence/${channel}`;

    const malformed = await harness.service.app.inject({
      method: "GET",
      url,
      headers: { authorization: "ForgeChannel not-a-signature" }
    });
    assert.equal(malformed.statusCode, 401);

    const signedBody = {
      ciphertext: ciphertextFixture("signed-body"),
      expiresInSeconds: 60
    };
    const tamperedBody = {
      ciphertext: ciphertextFixture("tampered-body"),
      expiresInSeconds: 60
    };
    const idempotencyKey = opaqueId("tamper-idempotency");
    const headers = signedHeaders(harness, {
      method: "PUT",
      url,
      body: signedBody,
      idempotencyKey
    });
    const tampered = await harness.service.app.inject({
      method: "PUT",
      url,
      headers,
      payload: tamperedBody
    });
    assert.equal(tampered.statusCode, 401);
    assert.equal(tampered.json().error.code, "AUTH_INVALID");

    const replayHeaders = signedHeaders(harness, {
      method: "GET",
      url,
      nonce: Buffer.alloc(16, 9)
    });
    const first = await harness.service.app.inject({
      method: "GET",
      url,
      headers: replayHeaders
    });
    assert.equal(first.statusCode, 404);
    const replayed = await harness.service.app.inject({
      method: "GET",
      url,
      headers: replayHeaders
    });
    assert.equal(replayed.statusCode, 401);
    assert.equal(replayed.json().error.code, "AUTH_REPLAYED");
  });

  it("consumes a valid nonce before strict schema rejection", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const url = `/v1/presence/${channel}`;
    const body = {
      ciphertext: ciphertextFixture("strict-schema"),
      expiresInSeconds: 60,
      forbidden: true
    };
    const idempotencyKey = opaqueId("strict-schema-idempotency");
    const headers = signedHeaders(harness, {
      method: "PUT",
      url,
      body,
      idempotencyKey,
      nonce: Buffer.alloc(16, 5)
    });

    const rejected = await harness.service.app.inject({
      method: "PUT",
      url,
      headers,
      payload: body
    });
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.json().error.code, "VALIDATION_ERROR");
    const replayed = await harness.service.app.inject({
      method: "PUT",
      url,
      headers,
      payload: body
    });
    assert.equal(replayed.statusCode, 401);
    assert.equal(replayed.json().error.code, "AUTH_REPLAYED");
  });

  it("retains a nonce through both inclusive clock-skew boundaries", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_CLOCK_SKEW_SECONDS: "30",
      FORGE_CONNECTIVITY_NONCE_RETENTION_SECONDS: "60"
    });
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const url = `/v1/presence/${channel}`;
    const signed = createChannelAuthorization({
      method: "GET",
      nonce: Buffer.alloc(16, 0x5a),
      nowMs: harness.clock.now() + harness.config.auth.clockSkewMs,
      privateKey: harness.keyPair.privateKey,
      publicKey: harness.keyPair.publicKey,
      url
    });
    const headers = { authorization: signed.authorization };

    const futureBoundary = await harness.service.app.inject({
      method: "GET",
      headers,
      url
    });
    assert.equal(futureBoundary.statusCode, 404);

    harness.clock.advance(harness.config.auth.nonceRetentionMs);
    harness.service.store.cleanupExpired(harness.clock.now(), 10);
    const pastBoundaryReplay = await harness.service.app.inject({
      method: "GET",
      headers,
      url
    });
    assert.equal(pastBoundaryReplay.statusCode, 401);
    assert.equal(pastBoundaryReplay.json().error.code, "AUTH_REPLAYED");
  });

  it("rejects pathological signed-body depth without a server error", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const url = `/v1/presence/${channel}`;
    const idempotencyKey = opaqueId("deep-body-idempotency");
    const headers = signedHeaders(harness, {
      method: "PUT",
      url,
      body: { ciphertext: ciphertextFixture("deep-body") },
      idempotencyKey
    });
    let nested: unknown = "leaf";
    for (let index = 0; index < 34; index += 1) {
      nested = { nested };
    }

    const response = await harness.service.app.inject({
      method: "PUT",
      url,
      headers,
      payload: { nested }
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "VALIDATION_ERROR");
  });

  it("rate-limits before durable nonce admission", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_CHANNEL_BURST_REQUESTS: "1",
      FORGE_CONNECTIVITY_CHANNEL_REQUESTS_PER_MINUTE: "1"
    });
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const channelHash = hashOpaqueChannel(channel);
    const url = `/v1/presence/${channel}`;

    const admitted = await signedInject(harness, {
      method: "GET",
      nonce: Buffer.alloc(16, 1),
      url
    });
    assert.equal(admitted.statusCode, 404);
    const limitedHeaders = signedHeaders(harness, {
      method: "GET",
      nonce: Buffer.alloc(16, 2),
      url
    });
    const limited = await harness.service.app.inject({
      method: "GET",
      headers: limitedHeaders,
      url
    });
    assert.equal(limited.statusCode, 429);
    assert.equal(
      harness.service.store.getUsage(channelHash).channel.nonceCount,
      1
    );

    harness.clock.advance(60_000);
    const admittedAfterRefill = await harness.service.app.inject({
      method: "GET",
      headers: limitedHeaders,
      url
    });
    assert.equal(admittedAfterRefill.statusCode, 404);
    assert.equal(
      harness.service.store.getUsage(channelHash).channel.nonceCount,
      2
    );
  });

  it("caps nonce records globally and per channel", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_MAX_CHANNEL_NONCE_RECORDS: "2",
      FORGE_CONNECTIVITY_MAX_GLOBAL_NONCE_RECORDS: "2"
    });
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const channelHash = hashOpaqueChannel(channel);
    const url = `/v1/presence/${channel}`;

    for (const nonceByte of [1, 2]) {
      const response = await signedInject(harness, {
        method: "GET",
        nonce: Buffer.alloc(16, nonceByte),
        url
      });
      assert.equal(response.statusCode, 404);
    }
    const capped = await signedInject(harness, {
      method: "GET",
      nonce: Buffer.alloc(16, 3),
      url
    });
    assert.equal(capped.statusCode, 429);
    assert.equal(capped.json().error.code, "QUOTA_EXCEEDED");
    assert.equal(
      harness.service.store.getUsage(channelHash).globalNonceCount,
      2
    );

    harness.clock.advance(harness.config.auth.nonceRetentionMs + 1);
    harness.service.store.cleanupExpired(harness.clock.now(), 10);
    const afterCleanup = await signedInject(harness, {
      method: "GET",
      nonce: Buffer.alloc(16, 4),
      url
    });
    assert.equal(afterCleanup.statusCode, 404);
  });
});

describe("bounded resource controls", () => {
  it("rejects an oversized HTTP body before channel work", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const response = await harness.service.app.inject({
      method: "POST",
      url: `/v1/envelopes/${channel}`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        ciphertext: "A".repeat(harness.config.server.requestBodyLimitBytes + 1)
      })
    });

    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error.code, "BLOB_TOO_LARGE");
  });

  it("enforces per-channel envelope count quota transactionally", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_BYTES: "1024",
      FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_COUNT: "1",
      FORGE_CONNECTIVITY_MAX_ENVELOPE_BYTES: "64"
    });
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const url = `/v1/envelopes/${channel}`;

    const first = await signedInject(harness, {
      method: "POST",
      url,
      body: {
        messageId: opaqueId("quota-message-1"),
        ciphertext: ciphertextFixture("quota-envelope-1", 64),
        expiresInSeconds: 120
      },
      idempotencyKey: opaqueId("quota-idempotency-1")
    });
    assert.equal(first.statusCode, 202);

    const second = await signedInject(harness, {
      method: "POST",
      url,
      body: {
        messageId: opaqueId("quota-message-2"),
        ciphertext: ciphertextFixture("quota-envelope-2", 64),
        expiresInSeconds: 120
      },
      idempotencyKey: opaqueId("quota-idempotency-2")
    });
    assert.equal(second.statusCode, 429);
    assert.equal(second.json().error.code, "QUOTA_EXCEEDED");
  });

  it("bounds retained replay tombstones and releases quota after expiry", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_COUNT: "1",
      FORGE_CONNECTIVITY_MAX_CHANNEL_RETAINED_ENVELOPE_COUNT: "1"
    });
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const url = `/v1/envelopes/${channel}`;
    const firstMessageId = opaqueId("retained-quota-message-1");

    await signedInject(harness, {
      method: "POST",
      url,
      body: {
        messageId: firstMessageId,
        ciphertext: ciphertextFixture("retained-quota-envelope-1"),
        expiresInSeconds: 60
      },
      idempotencyKey: opaqueId("retained-quota-put-1")
    });
    await signedInject(harness, {
      method: "POST",
      url: `${url}/ack`,
      body: { messageIds: [firstMessageId] },
      idempotencyKey: opaqueId("retained-quota-ack")
    });

    const blocked = await signedInject(harness, {
      method: "POST",
      url,
      body: {
        messageId: opaqueId("retained-quota-message-2"),
        ciphertext: ciphertextFixture("retained-quota-envelope-2"),
        expiresInSeconds: 60
      },
      idempotencyKey: opaqueId("retained-quota-put-2")
    });
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json().error.code, "QUOTA_EXCEEDED");

    harness.clock.advance(harness.config.limits.replayRetentionMs + 61_000);
    harness.service.store.cleanupExpired(harness.clock.now(), 100);
    const accepted = await signedInject(harness, {
      method: "POST",
      url,
      body: {
        messageId: opaqueId("retained-quota-message-3"),
        ciphertext: ciphertextFixture("retained-quota-envelope-3"),
        expiresInSeconds: 60
      },
      idempotencyKey: opaqueId("retained-quota-put-3")
    });
    assert.equal(accepted.statusCode, 202);
  });

  it("bounds idempotency metadata while preserving exact retries", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_MAX_CHANNEL_IDEMPOTENCY_RECORDS: "1"
    });
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const url = `/v1/presence/${channel}`;
    const firstKey = opaqueId("idempotency-quota-1");

    const first = await signedInject(harness, {
      method: "DELETE",
      url,
      idempotencyKey: firstKey
    });
    assert.equal(first.statusCode, 200);
    const exactRetry = await signedInject(harness, {
      method: "DELETE",
      url,
      idempotencyKey: firstKey
    });
    assert.equal(exactRetry.statusCode, 200);
    assert.equal(exactRetry.headers["idempotency-replayed"], "true");

    const blocked = await signedInject(harness, {
      method: "DELETE",
      url,
      idempotencyKey: opaqueId("idempotency-quota-2")
    });
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json().error.code, "QUOTA_EXCEEDED");
  });

  it("caps presence and key-package rows across attacker-created channels", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_MAX_CHANNEL_KEY_PACKAGE_COUNT: "1",
      FORGE_CONNECTIVITY_MAX_GLOBAL_KEY_PACKAGE_COUNT: "1",
      FORGE_CONNECTIVITY_MAX_GLOBAL_PRESENCE_COUNT: "1"
    });
    testContext.after(harness.cleanup);
    const secondKeyPair = generateKeyPairSync("ed25519");
    const firstChannel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const secondChannel = deriveOpaqueChannel(secondKeyPair.publicKey);

    const firstPresence = await signedInject(harness, {
      method: "PUT",
      url: `/v1/presence/${firstChannel}`,
      body: {
        ciphertext: ciphertextFixture("global-presence-1"),
        expiresInSeconds: 60
      },
      idempotencyKey: opaqueId("global-presence-idempotency-1")
    });
    assert.equal(firstPresence.statusCode, 201);
    const cappedPresence = await signedInject(harness, {
      method: "PUT",
      url: `/v1/presence/${secondChannel}`,
      body: {
        ciphertext: ciphertextFixture("global-presence-2"),
        expiresInSeconds: 60
      },
      idempotencyKey: opaqueId("global-presence-idempotency-2"),
      keyPair: secondKeyPair
    });
    assert.equal(cappedPresence.statusCode, 429);
    assert.equal(cappedPresence.json().error.code, "QUOTA_EXCEEDED");

    const firstPackage = await signedInject(harness, {
      method: "PUT",
      url: `/v1/key-packages/${firstChannel}`,
      body: {
        packageId: opaqueId("global-package-1"),
        ciphertext: ciphertextFixture("global-package-ciphertext-1"),
        expiresInSeconds: 60
      },
      idempotencyKey: opaqueId("global-package-idempotency-1")
    });
    assert.equal(firstPackage.statusCode, 201);
    const cappedPackage = await signedInject(harness, {
      method: "PUT",
      url: `/v1/key-packages/${secondChannel}`,
      body: {
        packageId: opaqueId("global-package-2"),
        ciphertext: ciphertextFixture("global-package-ciphertext-2"),
        expiresInSeconds: 60
      },
      idempotencyKey: opaqueId("global-package-idempotency-2"),
      keyPair: secondKeyPair
    });
    assert.equal(cappedPackage.statusCode, 429);
    assert.equal(cappedPackage.json().error.code, "QUOTA_EXCEEDED");

    const usage = harness.service.store.getUsage(
      hashOpaqueChannel(firstChannel)
    );
    assert.equal(usage.globalPresenceCount, 1);
    assert.equal(usage.globalKeyPackageCount, 1);
  });

  it("rate limits by authenticated channel without using an IP key", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_CHANNEL_REQUESTS_PER_MINUTE: "1"
    });
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const url = `/v1/presence/${channel}`;

    const first = await signedInject(harness, { method: "GET", url });
    assert.equal(first.statusCode, 404);
    const limited = await signedInject(harness, { method: "GET", url });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().error.code, "RATE_LIMITED");
  });

  it("bounds concurrent long polls per channel", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_MAX_CHANNEL_LONG_POLLS: "1",
      FORGE_CONNECTIVITY_MAX_GLOBAL_LONG_POLLS: "2",
      FORGE_CONNECTIVITY_MAX_LONG_POLL_SECONDS: "1"
    });
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const url = `/v1/envelopes/${channel}`;

    const firstPoll = signedInject(harness, {
      method: "GET",
      url: `${url}?waitSeconds=1`
    });
    await waitForTurn();
    const secondPoll = await signedInject(harness, {
      method: "GET",
      url: `${url}?waitSeconds=1`
    });
    assert.equal(secondPoll.statusCode, 429);
    assert.equal(secondPoll.json().error.code, "POLL_LIMIT_EXCEEDED");

    await signedInject(harness, {
      method: "POST",
      url,
      body: {
        messageId: opaqueId("poll-limit-message"),
        ciphertext: ciphertextFixture("poll-limit-envelope"),
        expiresInSeconds: 120
      },
      idempotencyKey: opaqueId("poll-limit-put")
    });
    assert.equal((await firstPoll).statusCode, 200);
  });
});

describe("attack surface", () => {
  it("rejects credentials and content-bearing metadata outside ciphertext fields", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const forbiddenFixture = "PRIVATE_FORGE_GRANT_PROJECTION_CONTACT_FIXTURE";
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const presenceUrl = `/v1/presence/${channel}`;

    const bearer = await harness.service.app.inject({
      method: "GET",
      url: "/healthz",
      headers: { authorization: `Bearer ${forbiddenFixture}` }
    });
    assert.equal(bearer.statusCode, 401);
    const cookie = await harness.service.app.inject({
      method: "GET",
      url: "/healthz",
      headers: { cookie: `forge=${forbiddenFixture}` }
    });
    assert.equal(cookie.statusCode, 400);
    const grantHeader = await harness.service.app.inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-forge-future-contact-data": forbiddenFixture }
    });
    assert.equal(grantHeader.statusCode, 400);
    assert.equal(
      grantHeader.json().error.code,
      "SENSITIVE_METADATA_NOT_ALLOWED"
    );

    const publicBody = await harness.service.app.inject({
      method: "GET",
      url: "/.well-known/forge-connectivity",
      headers: { "content-type": "text/plain" },
      payload: forbiddenFixture
    });
    assert.equal(publicBody.statusCode, 400);
    assert.equal(publicBody.json().error.code, "REQUEST_BODY_NOT_ALLOWED");
    const publicQuery = await harness.service.app.inject({
      method: "GET",
      url: `/healthz?contact=${forbiddenFixture}`
    });
    assert.equal(publicQuery.statusCode, 400);

    const deleteIdempotency = opaqueId("forbidden-delete-body");
    const deleteHeaders = signedHeaders(harness, {
      method: "DELETE",
      url: presenceUrl,
      body: forbiddenFixture,
      idempotencyKey: deleteIdempotency
    });
    const deleteBody = await harness.service.app.inject({
      method: "DELETE",
      url: presenceUrl,
      headers: {
        ...deleteHeaders,
        "content-type": "text/plain"
      },
      payload: forbiddenFixture
    });
    assert.equal(deleteBody.statusCode, 400);
    assert.equal(deleteBody.json().error.code, "REQUEST_BODY_NOT_ALLOWED");

    const protectedQuery = await signedInject(harness, {
      method: "GET",
      url: `${presenceUrl}?projection=${forbiddenFixture}`
    });
    assert.equal(protectedQuery.statusCode, 400);
    assert.equal(protectedQuery.json().error.code, "VALIDATION_ERROR");
    assert.equal(harness.logs.join("\n").includes(forbiddenFixture), false);
  });

  it("has no administrative content-reading route", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);

    for (const url of ["/admin", "/v1/admin", "/v1/envelopes", "/metrics"]) {
      const response = await harness.service.app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 404);
    }
    assert.doesNotMatch(
      harness.service.app.printRoutes(),
      /admin|content|decrypt/i
    );
  });

  it("fails closed before idempotency storage can persist a new response field", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const channelHash = hashOpaqueChannel(
      deriveOpaqueChannel(harness.keyPair.publicKey)
    );
    const nowMs = harness.clock.now();

    assert.throws(
      () =>
        harness.service.store.runIdempotent(
          {
            channelHash,
            expiresAt: nowMs + 60_000,
            key: opaqueId("forbidden-response-field-key"),
            maxChannelRecords: 10,
            maxGlobalRecords: 10,
            nowMs,
            requestDigest: opaqueId("forbidden-response-field-request"),
            scope: "adversarial response"
          },
          () => ({
            statusCode: 200,
            body: { grant: "must-not-persist" }
          })
        ),
      /content-bearing response/
    );
    assert.equal(
      harness.service.store.getUsage(channelHash).channel.idempotencyCount,
      0
    );
  });

  it("rejects a signature made for a different target", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const signed = createChannelAuthorization({
      method: "GET",
      nowMs: harness.clock.now(),
      privateKey: harness.keyPair.privateKey,
      publicKey: harness.keyPair.publicKey,
      url: `/v1/presence/${channel}`
    });
    const response = await harness.service.app.inject({
      method: "GET",
      url: `/v1/envelopes/${channel}`,
      headers: { authorization: signed.authorization }
    });
    assert.equal(response.statusCode, 401);
  });
});
