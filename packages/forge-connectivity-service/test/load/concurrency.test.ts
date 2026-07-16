import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { describe, it } from "node:test";

import { deriveOpaqueChannel } from "../../src/auth.js";
import { hashOpaqueChannel } from "../../src/encoding.js";
import {
  ciphertextFixture,
  createTestHarness,
  opaqueId,
  signedHeaders,
  signedInject
} from "../helpers.js";

describe("bounded load behavior", () => {
  it("collapses 100 concurrent exact retries into one durable mutation", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_CHANNEL_BURST_REQUESTS: "200",
      FORGE_CONNECTIVITY_CHANNEL_REQUESTS_PER_MINUTE: "1000",
      FORGE_CONNECTIVITY_GLOBAL_BURST_REQUESTS: "200",
      FORGE_CONNECTIVITY_GLOBAL_REQUESTS_PER_MINUTE: "1000"
    });
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const channelHash = hashOpaqueChannel(channel);
    const url = `/v1/envelopes/${channel}`;
    const body = {
      messageId: opaqueId("load-exact-retry-message"),
      ciphertext: ciphertextFixture("load-exact-retry-ciphertext"),
      expiresInSeconds: 120
    };
    const idempotencyKey = opaqueId("load-exact-retry-idempotency");

    const responses = await Promise.all(
      Array.from({ length: 100 }, () =>
        signedInject(harness, {
          method: "POST",
          url,
          body,
          idempotencyKey
        })
      )
    );

    assert.equal(
      responses.every((response) => response.statusCode === 202),
      true
    );
    assert.equal(
      responses.filter(
        (response) => response.headers["idempotency-replayed"] === "false"
      ).length,
      1
    );
    assert.equal(
      responses.filter(
        (response) => response.headers["idempotency-replayed"] === "true"
      ).length,
      99
    );
    const usage = harness.service.store.getUsage(channelHash);
    assert.equal(usage.channel.envelopeCount, 1);
    assert.equal(usage.channel.idempotencyCount, 1);
    assert.equal(usage.channel.nonceCount, 100);
  });

  it("keeps concurrent unique writes at the transactional envelope quota", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_CHANNEL_BURST_REQUESTS: "250",
      FORGE_CONNECTIVITY_CHANNEL_REQUESTS_PER_MINUTE: "1000",
      FORGE_CONNECTIVITY_GLOBAL_BURST_REQUESTS: "250",
      FORGE_CONNECTIVITY_GLOBAL_REQUESTS_PER_MINUTE: "1000",
      FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_COUNT: "25"
    });
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const channelHash = hashOpaqueChannel(channel);
    const url = `/v1/envelopes/${channel}`;

    const responses = await Promise.all(
      Array.from({ length: 200 }, (_value, index) =>
        signedInject(harness, {
          method: "POST",
          url,
          body: {
            messageId: opaqueId(`load-unique-message-${index}`),
            ciphertext: ciphertextFixture(`load-unique-ciphertext-${index}`),
            expiresInSeconds: 120
          },
          idempotencyKey: opaqueId(`load-unique-idempotency-${index}`)
        })
      )
    );

    assert.equal(
      responses.filter((response) => response.statusCode === 202).length,
      25
    );
    assert.equal(
      responses.filter(
        (response) =>
          response.statusCode === 429 &&
          response.json().error.code === "QUOTA_EXCEEDED"
      ).length,
      175
    );
    const usage = harness.service.store.getUsage(channelHash);
    assert.equal(usage.channel.envelopeCount, 25);
    assert.equal(usage.channel.idempotencyCount, 25);
    assert.equal(usage.channel.nonceCount, 200);
  });

  it("notifies long polls only after the idempotent write commits", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_MAX_LONG_POLL_SECONDS: "1"
    });
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const channelHash = hashOpaqueChannel(channel);
    const url = `/v1/envelopes/${channel}`;
    const poll = signedInject(harness, {
      method: "GET",
      url: `${url}?waitSeconds=1`
    });
    await delay(20);

    const control = new DatabaseSync(harness.databasePath);
    testContext.after(() => control.close());
    control.exec(`
      CREATE TRIGGER reject_idempotency_insert
      BEFORE INSERT ON idempotency_records
      BEGIN
        SELECT RAISE(ABORT, 'forced idempotency failure');
      END;
    `);
    const body = {
      messageId: opaqueId("post-commit-notification-message"),
      ciphertext: ciphertextFixture("post-commit-notification-ciphertext"),
      expiresInSeconds: 120
    };
    const idempotencyKey = opaqueId("post-commit-notification-idempotency");
    const failed = await signedInject(harness, {
      method: "POST",
      url,
      body,
      idempotencyKey
    });
    assert.equal(failed.statusCode, 500);
    assert.equal(
      harness.service.store.getUsage(channelHash).channel.envelopeCount,
      0
    );

    const earlyWake = await Promise.race([
      poll.then(() => "settled" as const),
      delay(75, "waiting" as const)
    ]);
    assert.equal(earlyWake, "waiting");

    control.exec("DROP TRIGGER reject_idempotency_insert");
    const committed = await signedInject(harness, {
      method: "POST",
      url,
      body,
      idempotencyKey
    });
    assert.equal(committed.statusCode, 202);
    const delivered = await poll;
    assert.equal(delivered.statusCode, 200);
    assert.equal(delivered.json().envelopes[0].messageId, body.messageId);
  });

  it("keeps readiness responsive after regular traffic exhausts its burst", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_GLOBAL_BURST_REQUESTS: "1",
      FORGE_CONNECTIVITY_GLOBAL_REQUESTS_PER_MINUTE: "1"
    });
    testContext.after(harness.cleanup);

    const first = await harness.service.app.inject({
      method: "GET",
      url: "/.well-known/forge-connectivity"
    });
    const limited = await harness.service.app.inject({
      method: "GET",
      url: "/.well-known/forge-connectivity"
    });
    assert.equal(first.statusCode, 200);
    assert.equal(limited.statusCode, 429);

    const healthResponses = await Promise.all(
      Array.from({ length: 100 }, () =>
        harness.service.app.inject({ method: "GET", url: "/healthz" })
      )
    );
    assert.equal(
      healthResponses.every(
        (response) =>
          response.statusCode === 200 && response.json().status === "ok"
      ),
      true
    );
  });

  it("releases a long-poll slot when the network client disconnects", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_MAX_CHANNEL_LONG_POLLS: "1",
      FORGE_CONNECTIVITY_MAX_GLOBAL_LONG_POLLS: "1",
      FORGE_CONNECTIVITY_MAX_LONG_POLL_SECONDS: "1"
    });
    testContext.after(harness.cleanup);
    const address = await harness.service.app.listen({
      host: "127.0.0.1",
      port: 0
    });
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const envelopesUrl = `/v1/envelopes/${channel}`;
    const pollUrl = `${envelopesUrl}?waitSeconds=1`;
    const abort = new AbortController();
    const disconnected = fetch(`${address}${pollUrl}`, {
      headers: signedHeaders(harness, { method: "GET", url: pollUrl }),
      signal: abort.signal
    });

    await delay(30);
    abort.abort();
    await assert.rejects(
      disconnected,
      (error: unknown) => error instanceof Error && error.name === "AbortError"
    );
    await delay(30);
    assert.equal(
      harness.logs.some((line) => line.includes('"code":"SERVICE_CLOSING"')),
      false
    );

    const admitted = signedInject(harness, {
      method: "GET",
      url: pollUrl
    });
    await delay(20);
    const posted = await signedInject(harness, {
      method: "POST",
      url: envelopesUrl,
      body: {
        messageId: opaqueId("disconnect-load-message"),
        ciphertext: ciphertextFixture("disconnect-load-ciphertext"),
        expiresInSeconds: 120
      },
      idempotencyKey: opaqueId("disconnect-load-idempotency")
    });
    assert.equal(posted.statusCode, 202);
    assert.equal((await admitted).statusCode, 200);
  });
});
