import assert from "node:assert/strict";
import test from "node:test";
import { isTimestampInTrailingWindow } from "./health.js";

test("fitness trailing windows include their boundary and reject future data", () => {
  const nowMs = Date.parse("2026-07-10T12:00:00.000Z");
  const windowMs = 7 * 24 * 60 * 60 * 1000;

  assert.equal(
    isTimestampInTrailingWindow(
      "2026-07-03T12:00:00.000Z",
      nowMs,
      windowMs
    ),
    true
  );
  assert.equal(
    isTimestampInTrailingWindow(
      "2026-07-03T11:59:59.999Z",
      nowMs,
      windowMs
    ),
    false
  );
  assert.equal(
    isTimestampInTrailingWindow(
      "2026-07-10T12:00:00.001Z",
      nowMs,
      windowMs
    ),
    false
  );
  assert.equal(isTimestampInTrailingWindow("invalid", nowMs, windowMs), false);
});
