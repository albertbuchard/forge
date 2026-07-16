import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveOpaqueChannel } from "../../src/auth.js";
import { hashOpaqueChannel } from "../../src/encoding.js";
import {
  ciphertextFixture,
  createTestHarness,
  opaqueId,
  signedInject,
  waitForTurn
} from "../helpers.js";

describe("discovery and health", () => {
  it("publishes the exact public contract and a content-free health response", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);

    const discovery = await harness.service.app.inject({
      method: "GET",
      url: "/.well-known/forge-connectivity"
    });
    assert.equal(discovery.statusCode, 200);
    assert.deepEqual(discovery.json().capabilities, {
      presence: true,
      envelopes: true,
      keyPackages: true,
      longPoll: true,
      ciphertextOnly: true
    });
    assert.equal(discovery.json().auth.algorithm, "Ed25519");

    const health = await harness.service.app.inject({
      method: "GET",
      url: "/healthz"
    });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), {
      status: "ok",
      service: "forge-connectivity-service",
      version: "0.1.4",
      storage: { status: "ok", schemaVersion: 3 }
    });
    assert.equal(discovery.json().limits.channelBurstRequests, 30);
  });

  it("rejects Forge bearer tokens on channel routes", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);

    const response = await harness.service.app.inject({
      method: "GET",
      url: `/v1/presence/${channel}`,
      headers: { authorization: "Bearer forge-token-must-not-work" }
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "AUTH_INVALID");
  });
});

describe("presence", () => {
  it("puts, retries, reads, and deletes an encrypted descriptor", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const url = `/v1/presence/${channel}`;
    const body = {
      ciphertext: ciphertextFixture("presence"),
      expiresInSeconds: 60
    };
    const idempotencyKey = opaqueId("presence-put");

    const created = await signedInject(harness, {
      method: "PUT",
      url,
      body,
      idempotencyKey
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.headers["idempotency-replayed"], "false");

    const retried = await signedInject(harness, {
      method: "PUT",
      url,
      body,
      idempotencyKey
    });
    assert.equal(retried.statusCode, 201);
    assert.equal(retried.headers["idempotency-replayed"], "true");

    const conflict = await signedInject(harness, {
      method: "PUT",
      url,
      body: { ...body, ciphertext: ciphertextFixture("different-presence") },
      idempotencyKey
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, "IDEMPOTENCY_CONFLICT");

    const fetched = await signedInject(harness, { method: "GET", url });
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.json().ciphertext, body.ciphertext);

    const deleted = await signedInject(harness, {
      method: "DELETE",
      url,
      idempotencyKey: opaqueId("presence-delete")
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json().deleted, true);

    const missing = await signedInject(harness, { method: "GET", url });
    assert.equal(missing.statusCode, 404);
  });
});

describe("envelopes", () => {
  it("supports idempotent put, indexed cursor reads, and acknowledgement", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const url = `/v1/envelopes/${channel}`;
    const firstBody = {
      messageId: opaqueId("message-1"),
      ciphertext: ciphertextFixture("envelope-1"),
      expiresInSeconds: 120
    };
    const secondBody = {
      messageId: opaqueId("message-2"),
      ciphertext: ciphertextFixture("envelope-2"),
      expiresInSeconds: 120
    };

    const first = await signedInject(harness, {
      method: "POST",
      url,
      body: firstBody,
      idempotencyKey: opaqueId("envelope-put-1")
    });
    assert.equal(first.statusCode, 202);
    assert.equal(first.json().accepted, true);

    const duplicate = await signedInject(harness, {
      method: "POST",
      url,
      body: firstBody,
      idempotencyKey: opaqueId("envelope-put-1-duplicate")
    });
    assert.equal(duplicate.statusCode, 200);
    assert.equal(duplicate.json().duplicate, true);

    const second = await signedInject(harness, {
      method: "POST",
      url,
      body: secondBody,
      idempotencyKey: opaqueId("envelope-put-2")
    });
    assert.equal(second.statusCode, 202);

    const firstPage = await signedInject(harness, {
      method: "GET",
      url: `${url}?limit=1`
    });
    assert.equal(firstPage.statusCode, 200);
    assert.equal(firstPage.json().envelopes.length, 1);
    assert.equal(firstPage.json().envelopes[0].messageId, firstBody.messageId);

    const secondPage = await signedInject(harness, {
      method: "GET",
      url: `${url}?cursor=${firstPage.json().nextCursor}&limit=1`
    });
    assert.equal(
      secondPage.json().envelopes[0].messageId,
      secondBody.messageId
    );

    const acknowledged = await signedInject(harness, {
      method: "POST",
      url: `${url}/ack`,
      body: { messageIds: [firstBody.messageId, secondBody.messageId] },
      idempotencyKey: opaqueId("envelope-ack")
    });
    assert.deepEqual(acknowledged.json(), {
      acknowledged: 2,
      alreadyFinalized: 0,
      unknown: 0
    });

    const empty = await signedInject(harness, { method: "GET", url });
    assert.deepEqual(empty.json().envelopes, []);
    const usage = harness.service.store.getUsage(hashOpaqueChannel(channel));
    assert.equal(usage.channel.envelopeBytes, 0);
    assert.equal(usage.channel.envelopeCount, 0);
    assert.equal(usage.channel.retainedEnvelopeCount, 2);
    assert.equal(usage.globalBytes, 0);
  });

  it("wakes a long poll when an envelope arrives", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const url = `/v1/envelopes/${channel}`;

    const polling = signedInject(harness, {
      method: "GET",
      url: `${url}?waitSeconds=1`
    });
    await waitForTurn();
    const posted = await signedInject(harness, {
      method: "POST",
      url,
      body: {
        messageId: opaqueId("long-poll-message"),
        ciphertext: ciphertextFixture("long-poll-envelope"),
        expiresInSeconds: 120
      },
      idempotencyKey: opaqueId("long-poll-put")
    });
    assert.equal(posted.statusCode, 202);

    const response = await polling;
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().pollTimedOut, false);
    assert.equal(response.json().envelopes.length, 1);
  });
});

describe("key packages and expiry", () => {
  it("stores bounded packages and removes expired live bytes", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const keyUrl = `/v1/key-packages/${channel}`;
    const presenceUrl = `/v1/presence/${channel}`;

    const keyPackage = await signedInject(harness, {
      method: "PUT",
      url: keyUrl,
      body: {
        packageId: opaqueId("key-package-1"),
        ciphertext: ciphertextFixture("key-package"),
        expiresInSeconds: 60
      },
      idempotencyKey: opaqueId("key-package-put")
    });
    assert.equal(keyPackage.statusCode, 201);

    const listed = await signedInject(harness, { method: "GET", url: keyUrl });
    assert.equal(listed.json().keyPackages.length, 1);

    await signedInject(harness, {
      method: "PUT",
      url: presenceUrl,
      body: {
        ciphertext: ciphertextFixture("expiring-presence"),
        expiresInSeconds: 30
      },
      idempotencyKey: opaqueId("expiring-presence-put")
    });
    harness.clock.advance(61_000);
    const cleanup = harness.service.store.cleanupExpired(
      harness.clock.now(),
      100
    );
    assert.equal(cleanup.keyPackagesExpired, 1);
    assert.equal(cleanup.presenceExpired, 1);

    const noPackages = await signedInject(harness, {
      method: "GET",
      url: keyUrl
    });
    assert.deepEqual(noPackages.json().keyPackages, []);
    const noPresence = await signedInject(harness, {
      method: "GET",
      url: presenceUrl
    });
    assert.equal(noPresence.statusCode, 404);
  });
});
