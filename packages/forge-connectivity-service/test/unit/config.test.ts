import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ZodError } from "zod";

import { loadConfig } from "../../src/config.js";

describe("structured configuration", () => {
  it("loads bounded production defaults", () => {
    const config = loadConfig({ FORGE_CONNECTIVITY_DATABASE_PATH: ":memory:" });

    assert.equal(config.server.host, "127.0.0.1");
    assert.equal(config.server.port, 8_787);
    assert.equal(config.limits.maxEnvelopeBytes, 262_144);
    assert.equal(config.polling.maxWaitMs, 25_000);
    assert.equal(config.polling.defaultPageSize, 50);
    assert.equal(config.rateLimit.globalBurstRequests, 100);
    assert.equal(config.rateLimit.channelBurstRequests, 30);
    assert.ok(config.auth.nonceRetentionMs >= config.auth.clockSkewMs * 2);
  });

  it("caps the default cursor page at the configured maximum", () => {
    const config = loadConfig({
      FORGE_CONNECTIVITY_DATABASE_PATH: ":memory:",
      FORGE_CONNECTIVITY_MAX_CURSOR_PAGE_SIZE: "10"
    });

    assert.equal(config.polling.defaultPageSize, 10);
    assert.equal(config.polling.maxPageSize, 10);
  });

  it("rejects unknown prefixed settings", () => {
    assert.throws(
      () =>
        loadConfig({
          FORGE_CONNECTIVITY_DATABASE_PATH: ":memory:",
          FORGE_CONNECTIVITY_MISSPELLED_LIMIT: "1"
        }),
      ZodError
    );
  });

  it("rejects a body ceiling that cannot contain the configured envelope", () => {
    assert.throws(
      () =>
        loadConfig({
          FORGE_CONNECTIVITY_DATABASE_PATH: ":memory:",
          FORGE_CONNECTIVITY_MAX_ENVELOPE_BYTES: "60000",
          FORGE_CONNECTIVITY_REQUEST_BODY_LIMIT_BYTES: "65536"
        }),
      /maximum-size ciphertext/
    );
  });

  it("rejects nonce retention shorter than the replay clock window", () => {
    assert.throws(
      () =>
        loadConfig({
          FORGE_CONNECTIVITY_CLOCK_SKEW_SECONDS: "300",
          FORGE_CONNECTIVITY_DATABASE_PATH: ":memory:",
          FORGE_CONNECTIVITY_NONCE_RETENTION_SECONDS: "300"
        }),
      /clock-skew window/
    );
  });

  it("rejects unbounded or internally inconsistent operator limits", () => {
    assert.throws(
      () =>
        loadConfig({
          FORGE_CONNECTIVITY_DATABASE_PATH: ":memory:",
          FORGE_CONNECTIVITY_REQUEST_BODY_LIMIT_BYTES: "9000000"
        }),
      ZodError
    );
    assert.throws(
      () =>
        loadConfig({
          FORGE_CONNECTIVITY_DATABASE_PATH: ":memory:",
          FORGE_CONNECTIVITY_MAX_ENVELOPE_BYTES: "2048",
          FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_BYTES: "1024"
        }),
      /maximum-size envelope/
    );
    assert.throws(
      () =>
        loadConfig({
          FORGE_CONNECTIVITY_CHANNEL_BURST_REQUESTS: "11",
          FORGE_CONNECTIVITY_CHANNEL_REQUESTS_PER_MINUTE: "10",
          FORGE_CONNECTIVITY_DATABASE_PATH: ":memory:"
        }),
      /requests-per-minute/
    );
    assert.throws(
      () =>
        loadConfig({
          FORGE_CONNECTIVITY_DATABASE_PATH: ":memory:",
          FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_COUNT: "1001",
          FORGE_CONNECTIVITY_MAX_CHANNEL_RETAINED_ENVELOPE_COUNT: "1000"
        }),
      /pending-envelope count quota/
    );
    assert.throws(
      () =>
        loadConfig({
          FORGE_CONNECTIVITY_DATABASE_PATH: ":memory:",
          FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_BYTES: "1024",
          FORGE_CONNECTIVITY_MAX_CHANNEL_KEY_PACKAGE_BYTES: "1024",
          FORGE_CONNECTIVITY_MAX_ENVELOPE_BYTES: "32",
          FORGE_CONNECTIVITY_MAX_GLOBAL_BYTES: "1024",
          FORGE_CONNECTIVITY_MAX_KEY_PACKAGE_BYTES: "32",
          FORGE_CONNECTIVITY_MAX_PRESENCE_BYTES: "2048"
        }),
      /maximum-size presence descriptor/
    );
  });
});
