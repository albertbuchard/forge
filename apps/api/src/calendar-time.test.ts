import assert from "node:assert/strict";
import test from "node:test";
import {
  providerDateToInstant,
  resolveZonedDateTime
} from "./services/calendar-time.js";

test("provider date-only values preserve exclusive local-midnight spans", () => {
  assert.equal(
    providerDateToInstant({ date: "2026-03-29" }, "Europe/Zurich"),
    "2026-03-28T23:00:00.000Z"
  );
  assert.equal(
    providerDateToInstant({ date: "2026-03-30" }, "Europe/Zurich"),
    "2026-03-29T22:00:00.000Z"
  );
});

test("provider date-only values preserve their date across the date line", () => {
  assert.equal(
    providerDateToInstant({ date: "2026-01-01" }, "Pacific/Kiritimati"),
    "2025-12-31T10:00:00.000Z"
  );
  assert.equal(
    providerDateToInstant({ date: "2025-12-31" }, "Pacific/Pago_Pago"),
    "2025-12-31T11:00:00.000Z"
  );
});

test("zoned datetime resolution identifies repeated and skipped local times", () => {
  assert.deepEqual(
    resolveZonedDateTime("2026-11-01T01:30", "America/Los_Angeles"),
    {
      kind: "ambiguous",
      instants: ["2026-11-01T08:30:00.000Z", "2026-11-01T09:30:00.000Z"]
    }
  );
  assert.deepEqual(resolveZonedDateTime("2011-12-30T12:00", "Pacific/Apia"), {
    kind: "nonexistent",
    instants: []
  });
});
