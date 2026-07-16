import { createHash } from "node:crypto";

import { ServiceError } from "./errors.js";

export const OPAQUE_ID_PATTERN = "^[A-Za-z0-9_-]{16,128}$";
export const OPAQUE_CHANNEL_PATTERN = "^[A-Za-z0-9_-]{43}$";

export function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export function decodeBase64Url(value: string, maximumBytes: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ServiceError(
      "BLOB_INVALID",
      400,
      "Ciphertext must use unpadded base64url encoding."
    );
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length < 32 || encodeBase64Url(decoded) !== value) {
    throw new ServiceError(
      "BLOB_INVALID",
      400,
      "Ciphertext encoding is invalid or too short."
    );
  }
  if (decoded.length > maximumBytes) {
    throw new ServiceError(
      "BLOB_TOO_LARGE",
      413,
      "Ciphertext exceeds the route limit."
    );
  }
  return decoded;
}

export function sha256(value: string | Uint8Array): Buffer {
  return createHash("sha256").update(value).digest();
}

export function digestBase64Url(value: string | Uint8Array): string {
  return encodeBase64Url(sha256(value));
}

export function digestCiphertextForChannel(
  channelHash: string,
  ciphertext: Uint8Array
): string {
  const digest = createHash("sha256");
  digest.update("forge-connectivity-content-digest-v1\0");
  digest.update(channelHash);
  digest.update("\0");
  digest.update(ciphertext);
  return encodeBase64Url(digest.digest());
}

export function hashOpaqueChannel(opaqueChannel: string): string {
  return digestBase64Url(
    `forge-connectivity-channel-storage-v1\0${opaqueChannel}`
  );
}

export function canonicalJson(value: unknown): string {
  return canonicalJsonAtDepth(value, 0);
}

function canonicalJsonAtDepth(value: unknown, depth: number): string {
  if (depth > 32) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      400,
      "The request JSON nesting depth exceeds the service limit."
    );
  }
  if (value === undefined) {
    return "";
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ServiceError(
        "VALIDATION_ERROR",
        400,
        "The request contains a non-finite number."
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item) =>
        canonicalJsonAtDepth(item === undefined ? null : item, depth + 1)
      )
      .join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareCodeUnits(left, right));
    return `{${entries
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalJsonAtDepth(item, depth + 1)}`
      )
      .join(",")}}`;
  }
  throw new ServiceError(
    "VALIDATION_ERROR",
    400,
    "The request contains an unsupported JSON value."
  );
}

export function canonicalTarget(rawUrl: string): string {
  const parsed = new URL(rawUrl, "http://forge-connectivity.invalid");
  const entries = [...parsed.searchParams.entries()].sort(
    ([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyComparison = compareCodeUnits(leftKey, rightKey);
      return keyComparison === 0
        ? compareCodeUnits(leftValue, rightValue)
        : keyComparison;
    }
  );
  const query = new URLSearchParams(entries).toString();
  return query.length > 0 ? `${parsed.pathname}?${query}` : parsed.pathname;
}

function compareCodeUnits(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function encodeCursor(id: number): string {
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new ServiceError(
      "CURSOR_INVALID",
      400,
      "Cursor position is invalid."
    );
  }
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(id));
  return encodeBase64Url(bytes);
}

export function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(cursor)) {
    throw new ServiceError("CURSOR_INVALID", 400, "Cursor is malformed.");
  }
  const bytes = Buffer.from(cursor, "base64url");
  if (bytes.length !== 8 || encodeBase64Url(bytes) !== cursor) {
    throw new ServiceError("CURSOR_INVALID", 400, "Cursor is malformed.");
  }
  const value = bytes.readBigUInt64BE();
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ServiceError(
      "CURSOR_INVALID",
      400,
      "Cursor is outside the supported range."
    );
  }
  return Number(value);
}

export function assertOpaqueId(value: string): void {
  if (!new RegExp(OPAQUE_ID_PATTERN).test(value)) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      400,
      "Opaque identifiers must be 16-128 base64url characters."
    );
  }
}
