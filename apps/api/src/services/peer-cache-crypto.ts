import { createHash } from "node:crypto";
import sodium from "libsodium-wrappers-sumo";
import { z } from "zod";

type PeerAeadSodium = typeof sodium & {
  readonly crypto_aead_xchacha20poly1305_ietf_KEYBYTES: number;
  readonly crypto_aead_xchacha20poly1305_ietf_NPUBBYTES: number;
  readonly crypto_aead_xchacha20poly1305_ietf_ABYTES: number;
  crypto_aead_xchacha20poly1305_ietf_encrypt(
    message: Uint8Array,
    additionalData: Uint8Array | null,
    secretNonce: null,
    publicNonce: Uint8Array,
    key: Uint8Array
  ): Uint8Array;
  crypto_aead_xchacha20poly1305_ietf_decrypt(
    secretNonce: null,
    ciphertext: Uint8Array,
    additionalData: Uint8Array | null,
    publicNonce: Uint8Array,
    key: Uint8Array
  ): Uint8Array;
  to_string(value: Uint8Array): string;
};

const peerAeadSodium = sodium as PeerAeadSodium;

export const PEER_CACHE_ENCRYPTION_ALGORITHM =
  "xchacha20-poly1305-ietf" as const;
export const PEER_CACHE_ENVELOPE_VERSION = 1 as const;
export const PEER_CACHE_MAX_PLAINTEXT_BYTES = 1024 * 1024;
export const PEER_CACHE_KEY_BYTES = 32;
export const PEER_CACHE_NONCE_BYTES = 24;
export const PEER_CACHE_TAG_BYTES = 16;

const peerCacheContextSchema = z
  .object({
    ownerUserId: z.string().trim().min(1).max(240),
    relationshipId: z.string().trim().min(1).max(240),
    projectionId: z.string().trim().min(1).max(120),
    queryHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRecordId: z.string().trim().min(1).max(240),
    sourceVersion: z.union([
      z.number().int().nonnegative(),
      z.string().trim().min(1).max(240)
    ])
  })
  .strict();
export type PeerCacheContext = z.infer<typeof peerCacheContextSchema>;

export const peerCacheEnvelopeSchema = z
  .object({
    version: z.literal(PEER_CACHE_ENVELOPE_VERSION),
    algorithm: z.literal(PEER_CACHE_ENCRYPTION_ALGORITHM),
    keyId: z.string().trim().min(1).max(240),
    nonceBase64: z.string().min(1).max(256),
    ciphertextBase64: z
      .string()
      .min(1)
      .max(2 * PEER_CACHE_MAX_PLAINTEXT_BYTES),
    plaintextBytes: z.number().int().min(0).max(PEER_CACHE_MAX_PLAINTEXT_BYTES)
  })
  .strict();
export type PeerCacheEnvelope = z.infer<typeof peerCacheEnvelopeSchema>;

function canonicalContext(context: PeerCacheContext): Uint8Array {
  const parsed = peerCacheContextSchema.parse(context);
  return sodium.from_string(
    JSON.stringify({
      ownerUserId: parsed.ownerUserId,
      projectionId: parsed.projectionId,
      queryHash: parsed.queryHash,
      relationshipId: parsed.relationshipId,
      sourceRecordId: parsed.sourceRecordId,
      sourceVersion: parsed.sourceVersion
    })
  );
}

function copyAndValidateKey(key: Uint8Array): Uint8Array {
  if (key.byteLength !== PEER_CACHE_KEY_BYTES) {
    throw new Error("Peer cache key must be 32 bytes.");
  }
  return new Uint8Array(key);
}

export function peerCacheKeyId(key: Uint8Array): string {
  const validated = copyAndValidateKey(key);
  try {
    return `peer_cache_v1_${createHash("sha256")
      .update("forge-peer/remote-cache-key-id/v1\0", "utf8")
      .update(validated)
      .digest("hex")}`;
  } finally {
    validated.fill(0);
  }
}

function assertPeerAeadRuntime(): void {
  if (
    peerAeadSodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES !==
      PEER_CACHE_KEY_BYTES ||
    peerAeadSodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES !==
      PEER_CACHE_NONCE_BYTES ||
    peerAeadSodium.crypto_aead_xchacha20poly1305_ietf_ABYTES !==
      PEER_CACHE_TAG_BYTES
  ) {
    throw new Error("Peer cache encryption runtime is incompatible.");
  }
}

function serializePeerCachePayload(payload: unknown): string {
  try {
    const serialized = JSON.stringify(payload);
    if (serialized === undefined) {
      throw new Error("unsupported JSON value");
    }
    return serialized;
  } catch {
    throw new Error("Peer cache payload must be JSON serializable.");
  }
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value
    )
  ) {
    throw new Error("Peer cache envelope encoding is invalid.");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error("Peer cache envelope encoding is invalid.");
  }
  return new Uint8Array(decoded);
}

export async function encryptPeerCachePayload(input: {
  key: Uint8Array;
  keyId: string;
  context: PeerCacheContext;
  payload: unknown;
}): Promise<PeerCacheEnvelope> {
  await sodium.ready;
  assertPeerAeadRuntime();
  const key = copyAndValidateKey(input.key);
  try {
    if (input.keyId !== peerCacheKeyId(key)) {
      throw new Error("Peer cache key id does not identify the supplied key.");
    }
    const plaintext = sodium.from_string(
      serializePeerCachePayload(input.payload)
    );
    if (plaintext.byteLength > PEER_CACHE_MAX_PLAINTEXT_BYTES) {
      throw new Error("Peer cache payload exceeds the encryption limit.");
    }
    const nonce = sodium.randombytes_buf(PEER_CACHE_NONCE_BYTES);
    const ciphertext =
      peerAeadSodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        plaintext,
        canonicalContext(input.context),
        null,
        nonce,
        key
      );
    return peerCacheEnvelopeSchema.parse({
      version: PEER_CACHE_ENVELOPE_VERSION,
      algorithm: PEER_CACHE_ENCRYPTION_ALGORITHM,
      keyId: input.keyId,
      nonceBase64: Buffer.from(nonce).toString("base64"),
      ciphertextBase64: Buffer.from(ciphertext).toString("base64"),
      plaintextBytes: plaintext.byteLength
    });
  } finally {
    key.fill(0);
  }
}

export async function decryptPeerCachePayload<T = unknown>(input: {
  key: Uint8Array;
  expectedKeyId: string;
  context: PeerCacheContext;
  envelope: PeerCacheEnvelope | unknown;
}): Promise<T> {
  await sodium.ready;
  assertPeerAeadRuntime();
  const envelope = peerCacheEnvelopeSchema.parse(input.envelope);
  if (envelope.keyId !== input.expectedKeyId) {
    throw new Error("Peer cache key id does not match the active key.");
  }
  if (input.expectedKeyId !== peerCacheKeyId(input.key)) {
    throw new Error("The key for this peer cache envelope is unavailable.");
  }
  const nonce = decodeCanonicalBase64(envelope.nonceBase64);
  const ciphertext = decodeCanonicalBase64(envelope.ciphertextBase64);
  if (
    nonce.byteLength !== PEER_CACHE_NONCE_BYTES ||
    ciphertext.byteLength !== envelope.plaintextBytes + PEER_CACHE_TAG_BYTES
  ) {
    throw new Error("Peer cache envelope encoding is invalid.");
  }
  const key = copyAndValidateKey(input.key);
  try {
    let plaintext: Uint8Array;
    try {
      plaintext = peerAeadSodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        ciphertext,
        canonicalContext(input.context),
        nonce,
        key
      );
    } catch {
      throw new Error("Peer cache payload authentication failed.");
    }
    if (plaintext.byteLength !== envelope.plaintextBytes) {
      throw new Error("Peer cache payload length does not match its envelope.");
    }
    try {
      return JSON.parse(peerAeadSodium.to_string(plaintext)) as T;
    } catch {
      throw new Error("Peer cache payload is not valid JSON.");
    }
  } finally {
    key.fill(0);
  }
}
