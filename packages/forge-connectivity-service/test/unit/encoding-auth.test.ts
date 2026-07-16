import assert from "node:assert/strict";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync
} from "node:crypto";
import { describe, it } from "node:test";

import {
  createChannelAuthorization,
  deriveOpaqueChannel
} from "../../src/auth.js";
import {
  canonicalJson,
  canonicalTarget,
  decodeBase64Url,
  decodeCursor,
  encodeCursor
} from "../../src/encoding.js";
import { ServiceError } from "../../src/errors.js";

describe("canonical request encoding", () => {
  it("sorts JSON object keys and query parameters deterministically", () => {
    assert.equal(
      canonicalJson({ z: 1, a: { y: true, x: [2, 1] } }),
      '{"a":{"x":[2,1],"y":true},"z":1}'
    );
    assert.equal(canonicalJson({ ä: 1, z: 2 }), '{"z":2,"ä":1}');
    assert.equal(canonicalJson([1, undefined, 2]), "[1,null,2]");
    assert.equal(
      canonicalTarget("/v1/test?z=2&a=3&a=1"),
      "/v1/test?a=1&a=3&z=2"
    );
  });

  it("round-trips fixed-width opaque cursors", () => {
    assert.equal(decodeCursor(encodeCursor(9_007_199)), 9_007_199);
    assert.throws(() => decodeCursor("not-a-cursor"), ServiceError);
  });

  it("rejects noncanonical or short ciphertext encoding", () => {
    assert.throws(() => decodeBase64Url("cGxhaW50ZXh0", 100), /too short/);
    assert.throws(() => decodeBase64Url("abcd=", 100), /unpadded/);
  });

  it("rejects pathological JSON depth before signature verification", () => {
    let value: unknown = "leaf";
    for (let index = 0; index < 34; index += 1) {
      value = { nested: value };
    }
    assert.throws(() => canonicalJson(value), /nesting depth/);
  });
});

describe("channel authorization creation", () => {
  it("is deterministic for fixed Ed25519 input and derives an opaque channel", () => {
    const keyPair = generateKeyPairSync("ed25519");
    const input = {
      body: { ciphertext: "A".repeat(43) },
      idempotencyKey: "idempotency_key_0001",
      method: "PUT",
      nonce: Buffer.alloc(16, 7),
      nowMs: 1_752_580_800_000,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      url: `/v1/presence/${deriveOpaqueChannel(keyPair.publicKey)}`
    } as const;

    const first = createChannelAuthorization(input);
    const second = createChannelAuthorization(input);

    assert.equal(first.authorization, second.authorization);
    assert.match(first.authorization, /^ForgeChannel v1\./);
    assert.match(first.opaqueChannel, /^[A-Za-z0-9_-]{43}$/);
  });

  it("matches the published deterministic signing vector", () => {
    const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
    const seed = Buffer.from(
      Array.from({ length: 32 }, (_value, index) => index)
    );
    const privateKey = createPrivateKey({
      format: "der",
      key: Buffer.concat([prefix, seed]),
      type: "pkcs8"
    });
    const publicKey = createPublicKey(privateKey);
    const opaqueChannel = deriveOpaqueChannel(publicKey);
    const signed = createChannelAuthorization({
      method: "GET",
      nonce: Buffer.alloc(16, 7),
      nowMs: 1_752_580_800_000,
      privateKey,
      publicKey,
      url: `/v1/envelopes/${opaqueChannel}?waitSeconds=5&limit=2`
    });

    assert.equal(opaqueChannel, "c_cvWTPHmJKGLNpXdXxrNgK4hDqt4TPDCGDyViiOII0");
    assert.equal(
      signed.authorization,
      "ForgeChannel v1.MCowBQYDK2VwAyEAA6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg.1752580800.BwcHBwcHBwcHBwcHBwcHBw.yEN-CL-bAWjhlxY-uKH7_5JH6zozm9701y_eo1s0PYG4Xl6vxXEGV5Csnutk6HtRgl3InJJzpW7z4jPvwGtADA"
    );
  });

  it("rejects client-side nonce and timestamp values outside auth bounds", () => {
    const keyPair = generateKeyPairSync("ed25519");
    assert.throws(
      () =>
        createChannelAuthorization({
          method: "GET",
          nonce: Buffer.alloc(15),
          privateKey: keyPair.privateKey,
          url: "/v1/presence/invalid"
        }),
      /16-32 bytes/
    );
    assert.throws(
      () =>
        createChannelAuthorization({
          method: "GET",
          nowMs: Number.POSITIVE_INFINITY,
          privateKey: keyPair.privateKey,
          url: "/v1/presence/invalid"
        }),
      /timestamp/
    );
  });
});
