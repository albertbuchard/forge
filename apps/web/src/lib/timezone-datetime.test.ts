import { describe, expect, it } from "vitest";
import {
  formatDateTimeInputInTimeZone,
  formatTimeInTimeZone,
  localDateKeyInTimeZone,
  parseDateTimeInputInTimeZone
} from "@/lib/timezone-datetime";

describe("timezone datetime helpers", () => {
  it("keeps a Los Angeles flight departure on its local calendar date", () => {
    const instant = "2026-09-13T02:35:00.000Z";

    expect(localDateKeyInTimeZone(instant, "America/Los_Angeles")).toBe(
      "2026-09-12"
    );
    expect(formatDateTimeInputInTimeZone(instant, "America/Los_Angeles")).toBe(
      "2026-09-12T19:35"
    );
    expect(formatTimeInTimeZone(instant, "America/Los_Angeles")).toBe(
      "19:35"
    );
  });

  it("parses a timezone-local datetime input back to the same instant", () => {
    expect(
      parseDateTimeInputInTimeZone(
        "2026-09-12T19:35",
        "America/Los_Angeles"
      )
    ).toBe("2026-09-13T02:35:00.000Z");
  });
});
