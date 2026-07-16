import assert from "node:assert/strict";
import test from "node:test";
import sodium from "libsodium-wrappers-sumo";
import {
  decryptPeerCachePayload,
  encryptPeerCachePayload,
  PEER_CACHE_KEY_BYTES,
  peerCacheKeyId,
  type PeerCacheContext
} from "./peer-cache-crypto.js";

const context: PeerCacheContext = {
  ownerUserId: "owner_user",
  relationshipId: "relationship_jon",
  projectionId: "goals.horizon_summary.v1",
  queryHash: "a".repeat(64),
  sourceRecordId: "remote_goal_1",
  sourceVersion: 3
};

async function key() {
  await sodium.ready;
  return sodium.randombytes_buf(PEER_CACHE_KEY_BYTES);
}

test("remote projection cache encrypts and authenticates its full context", async () => {
  const cacheKey = await key();
  const cacheKeyId = peerCacheKeyId(cacheKey);
  const payload = { title: "Finish the thesis", status: "active" };
  const envelope = await encryptPeerCachePayload({
    key: cacheKey,
    keyId: cacheKeyId,
    context,
    payload
  });
  assert.equal(envelope.ciphertextBase64.includes("Finish the thesis"), false);
  assert.deepEqual(
    await decryptPeerCachePayload({
      key: cacheKey,
      expectedKeyId: cacheKeyId,
      context,
      envelope
    }),
    payload
  );
  await assert.rejects(
    decryptPeerCachePayload({
      key: cacheKey,
      expectedKeyId: cacheKeyId,
      context: { ...context, ownerUserId: "different_owner" },
      envelope
    }),
    /authentication failed/
  );
});

test("cache decryption fails for wrong key ids, keys, and tampering", async () => {
  const cacheKey = await key();
  const wrongKey = await key();
  const cacheKeyId = peerCacheKeyId(cacheKey);
  const envelope = await encryptPeerCachePayload({
    key: cacheKey,
    keyId: cacheKeyId,
    context,
    payload: { distance: 42 }
  });
  await assert.rejects(
    decryptPeerCachePayload({
      key: cacheKey,
      expectedKeyId: `${cacheKeyId}_wrong`,
      context,
      envelope
    }),
    /key id/
  );
  await assert.rejects(
    decryptPeerCachePayload({
      key: wrongKey,
      expectedKeyId: cacheKeyId,
      context,
      envelope
    }),
    /unavailable/
  );
  const ciphertext = Buffer.from(envelope.ciphertextBase64, "base64");
  ciphertext[ciphertext.length - 1] ^= 1;
  await assert.rejects(
    decryptPeerCachePayload({
      key: cacheKey,
      expectedKeyId: cacheKeyId,
      context,
      envelope: {
        ...envelope,
        ciphertextBase64: ciphertext.toString("base64")
      }
    }),
    /authentication failed/
  );
});

test("cache encryption rejects non-JSON values and non-canonical envelopes", async () => {
  const cacheKey = await key();
  const cacheKeyId = peerCacheKeyId(cacheKey);
  await assert.rejects(
    encryptPeerCachePayload({
      key: cacheKey,
      keyId: "peer_cache_v1_wrong",
      context,
      payload: { safe: true }
    }),
    /does not identify/
  );
  await assert.rejects(
    encryptPeerCachePayload({
      key: cacheKey,
      keyId: cacheKeyId,
      context,
      payload: undefined
    }),
    /JSON serializable/
  );
  const envelope = await encryptPeerCachePayload({
    key: cacheKey,
    keyId: cacheKeyId,
    context,
    payload: { safe: true }
  });
  await assert.rejects(
    decryptPeerCachePayload({
      key: cacheKey,
      expectedKeyId: cacheKeyId,
      context,
      envelope: { ...envelope, nonceBase64: `${envelope.nonceBase64.slice(0, -1)}!` }
    }),
    /encoding is invalid/
  );
  await assert.rejects(
    decryptPeerCachePayload({
      key: cacheKey,
      expectedKeyId: cacheKeyId,
      context,
      envelope: { ...envelope, plaintextBytes: envelope.plaintextBytes + 1 }
    }),
    /encoding is invalid/
  );
});
