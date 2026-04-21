import { describe, expect, it } from "vitest";

import {
  formatDateKeyInTimeZone,
  formatLocalDateKey,
  getRuntimeTimeZone
} from "@/lib/date-keys";

describe("date key helpers", () => {
  it("formats date keys for specific timezones", () => {
    const value = new Date("2026-04-21T00:30:00.000Z");

    expect(formatDateKeyInTimeZone(value, "Europe/Zurich")).toBe("2026-04-21");
    expect(formatDateKeyInTimeZone(value, "America/Los_Angeles")).toBe(
      "2026-04-20"
    );
  });

  it("formats the local runtime date key", () => {
    const value = new Date("2026-04-21T12:00:00.000Z");

    expect(formatLocalDateKey(value)).toBe(
      formatDateKeyInTimeZone(value, getRuntimeTimeZone())
    );
  });
});
