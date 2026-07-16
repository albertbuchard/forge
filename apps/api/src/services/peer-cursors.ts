import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HttpError } from "../errors.js";

const CURSOR_SEPARATOR = ".";

const cursorEnvelopeSchema = z
  .object({
    version: z.literal(1),
    kind: z.string().trim().min(1).max(80),
    payload: z.record(z.union([z.string().max(500), z.number().finite()])),
    expiresAt: z.string().datetime({ offset: true })
  })
  .strict();

function signCursorPayload(payload: string, key: Uint8Array) {
  if (key.byteLength < 32) {
    throw new Error("Peer cursors require a 32-byte signing key.");
  }
  return createHmac("sha256", key)
    .update("forge-peer/cursor/v1\0", "utf8")
    .update(payload, "utf8")
    .digest("base64url");
}

export function encodePeerCursor(input: {
  kind: string;
  payload: Record<string, string | number>;
  key: Uint8Array;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const envelope = cursorEnvelopeSchema.parse({
    version: 1,
    kind: input.kind,
    payload: input.payload,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString()
  });
  const body = Buffer.from(JSON.stringify(envelope), "utf8").toString(
    "base64url"
  );
  return `${body}${CURSOR_SEPARATOR}${signCursorPayload(body, input.key)}`;
}

function invalidCursor(code: string, message: string): never {
  throw new HttpError(400, code, message);
}

export function decodePeerCursor<T extends Record<string, string | number>>(
  cursor: string | undefined,
  input: {
    kind: string;
    key: Uint8Array;
    payloadSchema: z.ZodType<T>;
    now?: Date;
  }
): T | null {
  if (!cursor) {
    return null;
  }
  const separator = cursor.lastIndexOf(CURSOR_SEPARATOR);
  if (separator <= 0) {
    return invalidCursor("peer_cursor_invalid", "Cursor is invalid.");
  }
  const body = cursor.slice(0, separator);
  const signature = cursor.slice(separator + 1);
  const expected = signCursorPayload(body, input.key);
  const suppliedBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    return invalidCursor("peer_cursor_invalid", "Cursor is invalid.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return invalidCursor("peer_cursor_invalid", "Cursor is invalid.");
  }
  const envelope = cursorEnvelopeSchema.parse(decoded);
  if (envelope.kind !== input.kind) {
    return invalidCursor("peer_cursor_invalid", "Cursor is invalid.");
  }
  if (Date.parse(envelope.expiresAt) <= (input.now ?? new Date()).getTime()) {
    return invalidCursor("peer_cursor_expired", "Cursor has expired.");
  }
  return input.payloadSchema.parse(envelope.payload);
}
