import {
  createPublicKey,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject
} from "node:crypto";

import type { FastifyRequest } from "fastify";

import type { ConnectivityConfig } from "./config.js";
import {
  canonicalJson,
  canonicalTarget,
  digestBase64Url,
  encodeBase64Url,
  hashOpaqueChannel,
  sha256
} from "./encoding.js";
import { ServiceError, unauthorized } from "./errors.js";
import type { ConnectivityStore } from "./storage/types.js";

const AUTHORIZATION_PREFIX = "ForgeChannel ";
const AUTHORIZATION_VERSION = "v1";
const ED25519_SPKI_BYTES = 44;
const ED25519_SPKI_BASE64URL_LENGTH = 59;
const ED25519_SIGNATURE_BYTES = 64;
const ED25519_SIGNATURE_BASE64URL_LENGTH = 86;
const MIN_NONCE_BYTES = 16;
const MAX_NONCE_BYTES = 32;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
export const CHANNEL_AUTHORIZATION_HEADER_PATTERN =
  `^ForgeChannel v1\\.[A-Za-z0-9_-]{${ED25519_SPKI_BASE64URL_LENGTH}}\\.` +
  `[0-9]{10,12}\\.[A-Za-z0-9_-]{22,43}\\.` +
  `[A-Za-z0-9_-]{${ED25519_SIGNATURE_BASE64URL_LENGTH}}$`;
const AUTHORIZATION_PATTERN = new RegExp(CHANNEL_AUTHORIZATION_HEADER_PATTERN);

export interface ChannelAuthContext {
  channelHash: string;
  idempotencyKey?: string;
  requestDigest: string;
}

export interface SignRequestInput {
  body?: unknown;
  idempotencyKey?: string;
  method: string;
  nonce?: Uint8Array;
  nowMs?: number;
  privateKey: KeyObject;
  publicKey?: KeyObject;
  url: string;
}

export interface SignedRequest {
  authorization: string;
  opaqueChannel: string;
}

interface ParsedAuthorization {
  nonce: string;
  publicKeyDer: Buffer;
  signature: Buffer;
  timestampSeconds: number;
}

export function deriveOpaqueChannel(publicKey: KeyObject): string {
  const publicKeyDer = exportPublicKey(publicKey);
  return digestBase64Url(
    `forge-connectivity-channel-id-v1\0${encodeBase64Url(publicKeyDer)}`
  );
}

export function createChannelAuthorization(
  input: SignRequestInput
): SignedRequest {
  const publicKey = input.publicKey ?? createPublicKey(input.privateKey);
  const publicKeyDer = exportPublicKey(publicKey);
  const timestampSeconds = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  if (!/^\d{10,12}$/.test(String(timestampSeconds))) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      400,
      "The authorization timestamp is outside the supported range."
    );
  }
  const nonceBytes = input.nonce ?? randomBytes(MIN_NONCE_BYTES);
  if (
    nonceBytes.byteLength < MIN_NONCE_BYTES ||
    nonceBytes.byteLength > MAX_NONCE_BYTES
  ) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      400,
      "The authorization nonce must contain 16-32 bytes."
    );
  }
  const nonce = encodeBase64Url(nonceBytes);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const canonical = canonicalSignaturePayload({
    body: input.body,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    method: input.method,
    nonce,
    timestampSeconds,
    url: input.url
  });
  const signature = sign(null, Buffer.from(canonical), input.privateKey);

  return {
    authorization: `${AUTHORIZATION_PREFIX}${AUTHORIZATION_VERSION}.${encodeBase64Url(publicKeyDer)}.${timestampSeconds}.${nonce}.${encodeBase64Url(signature)}`,
    opaqueChannel: deriveOpaqueChannel(publicKey)
  };
}

export function authenticateChannelRequest(
  request: FastifyRequest<{ Params: { opaqueChannel: string } }>,
  store: ConnectivityStore,
  config: ConnectivityConfig,
  nowMs: number,
  admit?: (channelHash: string, nowMs: number) => void
): ChannelAuthContext {
  const parsed = parseAuthorization(request.headers.authorization);
  const publicKey = parsePublicKey(parsed.publicKeyDer);
  const derivedChannel = deriveOpaqueChannel(publicKey);
  if (!safeTextEqual(derivedChannel, request.params.opaqueChannel)) {
    throw unauthorized("AUTH_INVALID");
  }

  const requestTimestampMs = parsed.timestampSeconds * 1_000;
  if (Math.abs(nowMs - requestTimestampMs) > config.auth.clockSkewMs) {
    throw unauthorized("AUTH_STALE");
  }

  const idempotencyKey = normalizeIdempotencyKey(
    headerValue(request.headers["idempotency-key"])
  );
  const canonical = canonicalSignaturePayload({
    body: request.body,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    method: request.method,
    nonce: parsed.nonce,
    timestampSeconds: parsed.timestampSeconds,
    url: request.url
  });
  if (!verify(null, Buffer.from(canonical), publicKey, parsed.signature)) {
    throw unauthorized("AUTH_INVALID");
  }

  const channelHash = hashOpaqueChannel(derivedChannel);
  admit?.(channelHash, nowMs);
  const nonceHash = digestBase64Url(
    `forge-connectivity-request-nonce-v1\0${parsed.nonce}`
  );
  const claimed = store.claimNonce({
    channelHash,
    expiresAt: nowMs + config.auth.nonceRetentionMs,
    maxChannelRecords: config.limits.maxChannelNonceRecords,
    maxGlobalRecords: config.limits.maxGlobalNonceRecords,
    nonceHash,
    nowMs
  });
  if (!claimed) {
    throw unauthorized("AUTH_REPLAYED");
  }

  return {
    channelHash,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    requestDigest: computeIdempotencyDigest(
      request.method,
      request.url,
      request.body
    )
  };
}

export function requireIdempotencyKey(context: ChannelAuthContext): string {
  if (context.idempotencyKey === undefined) {
    throw new ServiceError(
      "IDEMPOTENCY_REQUIRED",
      400,
      "Idempotency-Key is required for mutating requests."
    );
  }
  return context.idempotencyKey;
}

export function computeIdempotencyDigest(
  method: string,
  url: string,
  body: unknown
): string {
  return digestBase64Url(
    `forge-connectivity-idempotency-v1\n${method.toUpperCase()}\n${canonicalTarget(url)}\n${digestBase64Url(canonicalJson(body))}`
  );
}

function canonicalSignaturePayload(input: {
  body: unknown;
  idempotencyKey?: string;
  method: string;
  nonce: string;
  timestampSeconds: number;
  url: string;
}): string {
  return [
    "forge-connectivity-request-signature-v1",
    input.method.toUpperCase(),
    canonicalTarget(input.url),
    String(input.timestampSeconds),
    input.nonce,
    digestBase64Url(canonicalJson(input.body)),
    input.idempotencyKey ?? "-"
  ].join("\n");
}

function parseAuthorization(value: string | undefined): ParsedAuthorization {
  if (value === undefined || !AUTHORIZATION_PATTERN.test(value)) {
    throw unauthorized("AUTH_INVALID");
  }
  const parts = value.slice(AUTHORIZATION_PREFIX.length).split(".");
  if (parts.length !== 5 || parts[0] !== AUTHORIZATION_VERSION) {
    throw unauthorized("AUTH_INVALID");
  }
  const [, publicKeyValue, timestampValue, nonce, signatureValue] = parts;
  if (
    publicKeyValue === undefined ||
    timestampValue === undefined ||
    nonce === undefined ||
    signatureValue === undefined ||
    !/^\d{10,12}$/.test(timestampValue) ||
    !/^[A-Za-z0-9_-]{22,43}$/.test(nonce)
  ) {
    throw unauthorized("AUTH_INVALID");
  }

  const publicKeyDer = strictDecode(publicKeyValue, ED25519_SPKI_BYTES);
  const nonceBytes = strictDecode(nonce, MAX_NONCE_BYTES);
  const signature = strictDecode(signatureValue, ED25519_SIGNATURE_BYTES);
  if (
    publicKeyDer.length !== ED25519_SPKI_BYTES ||
    nonceBytes.length < MIN_NONCE_BYTES ||
    signature.length !== ED25519_SIGNATURE_BYTES
  ) {
    throw unauthorized("AUTH_INVALID");
  }

  return {
    nonce,
    publicKeyDer,
    signature,
    timestampSeconds: Number(timestampValue)
  };
}

function strictDecode(value: string, maximumBytes: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw unauthorized("AUTH_INVALID");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length > maximumBytes || encodeBase64Url(decoded) !== value) {
    throw unauthorized("AUTH_INVALID");
  }
  return decoded;
}

function parsePublicKey(publicKeyDer: Buffer): KeyObject {
  try {
    const publicKey = createPublicKey({
      format: "der",
      key: publicKeyDer,
      type: "spki"
    });
    if (
      publicKey.asymmetricKeyType !== "ed25519" ||
      !exportPublicKey(publicKey).equals(publicKeyDer)
    ) {
      throw unauthorized("AUTH_INVALID");
    }
    return publicKey;
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }
    throw unauthorized("AUTH_INVALID");
  }
}

function exportPublicKey(publicKey: KeyObject): Buffer {
  if (
    publicKey.type !== "public" ||
    publicKey.asymmetricKeyType !== "ed25519"
  ) {
    throw new ServiceError(
      "AUTH_INVALID",
      401,
      "Channel authorization requires an Ed25519 public key."
    );
  }
  return publicKey.export({ format: "der", type: "spki" });
}

function safeTextEqual(left: string, right: string): boolean {
  const leftDigest = sha256(left);
  const rightDigest = sha256(right);
  return timingSafeEqual(leftDigest, rightDigest) && left === right;
}

function normalizeIdempotencyKey(
  value: string | undefined
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      400,
      "Idempotency-Key must be 16-128 unpadded base64url characters."
    );
  }
  return value;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}
