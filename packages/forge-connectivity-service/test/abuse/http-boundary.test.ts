import assert from "node:assert/strict";
import net from "node:net";
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

describe("hostile HTTP boundary", () => {
  it("rejects duplicate authorization headers before nonce admission", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const address = await harness.service.app.listen({
      host: "127.0.0.1",
      port: 0
    });
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const url = `/v1/presence/${channel}`;
    const authorization = signedHeaders(harness, {
      method: "GET",
      url
    }).authorization;

    const response = await rawHttpRequest(address, [
      `GET ${url} HTTP/1.1`,
      `Host: ${new URL(address).host}`,
      `Authorization: ${authorization}`,
      "Authorization: attacker-controlled-second-value",
      "Connection: close",
      "",
      ""
    ]);

    assert.equal(response.statusCode, 400);
    assert.equal(
      (JSON.parse(response.bodyText) as { error: { code: string } }).error.code,
      "AMBIGUOUS_REQUEST_HEADERS"
    );
    assert.equal(
      harness.service.store.getUsage(hashOpaqueChannel(channel)).channel
        .nonceCount,
      0
    );
  });

  it("rejects conflicting HTTP framing before route handling", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const address = await harness.service.app.listen({
      host: "127.0.0.1",
      port: 0
    });

    const response = await rawHttpRequest(address, [
      "POST /healthz HTTP/1.1",
      `Host: ${new URL(address).host}`,
      "Content-Length: 4",
      "Transfer-Encoding: chunked",
      "Connection: close",
      "",
      "0",
      "",
      ""
    ]);

    assert.equal(response.statusCode, 400);
  });

  it("does not log an unsupported HTTP method verbatim", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const address = await harness.service.app.listen({
      host: "127.0.0.1",
      port: 0
    });
    const unsupportedMethod = "PATCH";

    const response = await rawHttpRequest(address, [
      `${unsupportedMethod} /not-a-route HTTP/1.1`,
      `Host: ${new URL(address).host}`,
      "Connection: close",
      "",
      ""
    ]);

    assert.equal(response.statusCode, 404);
    assert.equal(
      harness.logs.some((line) => line.includes(unsupportedMethod)),
      false
    );
    assert.equal(
      harness.logs.some((line) => line.includes('"method":"OTHER"')),
      true
    );
  });

  it("rejects undeclared media types and coercible signed JSON", async (testContext) => {
    const harness = await createTestHarness();
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const envelopeUrl = `/v1/envelopes/${channel}`;
    const presenceUrl = `/v1/presence/${channel}`;

    for (const contentType of ["application/xml", "text/plain"]) {
      const unsupported = await harness.service.app.inject({
        method: "POST",
        url: envelopeUrl,
        headers: { "content-type": contentType },
        payload: "attacker-controlled-body"
      });
      assert.equal(unsupported.statusCode, 415);
      assert.equal(unsupported.json().error.code, "CONTENT_TYPE_UNSUPPORTED");
    }

    const numericIdentifier = await signedInject(harness, {
      method: "POST",
      url: envelopeUrl,
      body: {
        messageId: 1_234_567_890_123_456,
        ciphertext: ciphertextFixture("numeric-identifier"),
        expiresInSeconds: 60
      },
      idempotencyKey: opaqueId("numeric-identifier")
    });
    assert.equal(numericIdentifier.statusCode, 400);
    assert.equal(numericIdentifier.json().error.code, "VALIDATION_ERROR");

    const stringTtl = await signedInject(harness, {
      method: "PUT",
      url: presenceUrl,
      body: {
        ciphertext: ciphertextFixture("string-ttl"),
        expiresInSeconds: "60"
      },
      idempotencyKey: opaqueId("string-ttl")
    });
    assert.equal(stringTtl.statusCode, 400);
    assert.equal(stringTtl.json().error.code, "VALIDATION_ERROR");
  });

  it("accepts only declared canonical integer queries and a bounded default", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_MAX_CURSOR_PAGE_SIZE: "10"
    });
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const url = `/v1/envelopes/${channel}`;

    const defaultPage = await signedInject(harness, { method: "GET", url });
    assert.equal(defaultPage.statusCode, 200);

    const undeclaredPublicQuery = await harness.service.app.inject({
      method: "GET",
      url: "/.well-known/forge-connectivity?type=object"
    });
    assert.equal(undeclaredPublicQuery.statusCode, 400);

    for (const query of ["limit=1e1", "limit=01", "limit=1&limit=2"]) {
      const response = await signedInject(harness, {
        method: "GET",
        url: `${url}?${query}`
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, "VALIDATION_ERROR");
    }

    const undeclaredChannelQuery = await signedInject(harness, {
      method: "GET",
      url: `${url}?unknown=1`
    });
    assert.equal(undeclaredChannelQuery.statusCode, 400);
    assert.equal(undeclaredChannelQuery.json().error.code, "VALIDATION_ERROR");
  });

  it("applies global admission before malformed request handling", async (testContext) => {
    const harness = await createTestHarness({
      FORGE_CONNECTIVITY_GLOBAL_BURST_REQUESTS: "1",
      FORGE_CONNECTIVITY_GLOBAL_REQUESTS_PER_MINUTE: "1"
    });
    testContext.after(harness.cleanup);
    const channel = deriveOpaqueChannel(harness.keyPair.publicKey);
    const request = {
      method: "POST" as const,
      url: `/v1/envelopes/${channel}`,
      headers: { "content-type": "application/xml" },
      payload: "<invalid/>"
    };

    const first = await harness.service.app.inject(request);
    const second = await harness.service.app.inject(request);
    assert.equal(first.statusCode, 415);
    assert.equal(second.statusCode, 429);
    assert.equal(second.json().error.code, "RATE_LIMITED");
  });
});

async function rawHttpRequest(
  address: string,
  lines: readonly string[]
): Promise<{ bodyText: string; statusCode: number }> {
  const endpoint = new URL(address);
  const response = await new Promise<string>((resolve, reject) => {
    const socket = net.connect(Number(endpoint.port), endpoint.hostname);
    let received = "";
    socket.setEncoding("utf8");
    socket.setTimeout(2_000, () => socket.destroy(new Error("HTTP timeout")));
    socket.on("connect", () => socket.end(lines.join("\r\n")));
    socket.on("data", (chunk) => {
      received += chunk;
    });
    socket.on("end", () => resolve(received));
    socket.on("error", reject);
  });
  const [head = "", body = ""] = response.split("\r\n\r\n", 2);
  const statusCode = Number(head.match(/^HTTP\/1\.1 ([0-9]{3})/)?.[1]);
  return {
    bodyText: body,
    statusCode
  };
}
