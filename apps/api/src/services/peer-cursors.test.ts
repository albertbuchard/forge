import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { decodePeerCursor, encodePeerCursor } from "./peer-cursors.js";

const payloadSchema = z.object({ id: z.string(), offset: z.number().int() });

test("peer cursors round-trip with an unambiguous base64url separator", () => {
  const key = Buffer.alloc(32, 0x2f);
  const cursor = encodePeerCursor({
    kind: "people:test",
    payload: { id: "person_1", offset: 20 },
    key,
    now: new Date("2026-07-15T10:00:00.000Z")
  });

  assert.equal(cursor.split(".").length, 2);
  assert.deepEqual(
    decodePeerCursor(cursor, {
      kind: "people:test",
      key,
      payloadSchema,
      now: new Date("2026-07-15T10:01:00.000Z")
    }),
    { id: "person_1", offset: 20 }
  );
});

test("peer cursors fail as bounded client errors when tampered or expired", () => {
  const key = Buffer.alloc(32, 0xa7);
  const cursor = encodePeerCursor({
    kind: "people:test",
    payload: { id: "person_1", offset: 20 },
    key,
    now: new Date("2026-07-15T10:00:00.000Z")
  });
  const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}`;

  assert.throws(
    () =>
      decodePeerCursor(tampered, {
        kind: "people:test",
        key,
        payloadSchema
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 400 &&
      error.code === "peer_cursor_invalid"
  );
  assert.throws(
    () =>
      decodePeerCursor(cursor, {
        kind: "people:test",
        key,
        payloadSchema,
        now: new Date("2026-07-16T10:00:00.001Z")
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 400 &&
      error.code === "peer_cursor_expired"
  );
});
