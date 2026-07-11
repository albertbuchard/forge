import { describe, expect, it } from "vitest";
import {
  formatDateInTimeZone,
  formatDateTimeInputInTimeZone,
  formatTimeInTimeZone,
  localDateKeyInTimeZone,
  parseDateTimeInputInTimeZone,
  resolveDateTimeInputInTimeZone
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
    expect(formatTimeInTimeZone(instant, "America/Los_Angeles")).toBe("19:35");
  });

  it("parses a timezone-local datetime input back to the same instant", () => {
    expect(
      parseDateTimeInputInTimeZone("2026-09-12T19:35", "America/Los_Angeles")
    ).toBe("2026-09-13T02:35:00.000Z");
  });

  it("keeps one instant on the correct local date on both sides of the date line", () => {
    const instant = "2025-12-31T10:30:00.000Z";

    expect(localDateKeyInTimeZone(instant, "Pacific/Kiritimati")).toBe(
      "2026-01-01"
    );
    expect(localDateKeyInTimeZone(instant, "Pacific/Pago_Pago")).toBe(
      "2025-12-30"
    );
  });

  it("localizes labels without changing the underlying calendar date", () => {
    const instant = "2026-09-13T02:35:00.000Z";

    expect(
      formatDateInTimeZone(instant, "America/Los_Angeles", "en-US")
    ).toContain("Sep 12");
    expect(
      formatDateInTimeZone(instant, "America/Los_Angeles", "de-CH")
    ).toContain("12. Sept");
    expect(localDateKeyInTimeZone(instant, "America/Los_Angeles")).toBe(
      "2026-09-12"
    );
  });

  it("reports both instants in a repeated hour and rejects a skipped date", () => {
    expect(
      resolveDateTimeInputInTimeZone("2026-11-01T01:30", "America/Los_Angeles")
    ).toEqual({
      kind: "ambiguous",
      instants: ["2026-11-01T08:30:00.000Z", "2026-11-01T09:30:00.000Z"]
    });
    expect(
      parseDateTimeInputInTimeZone("2026-11-01T01:30", "America/Los_Angeles", {
        disambiguation: "later"
      })
    ).toBe("2026-11-01T09:30:00.000Z");
    expect(
      resolveDateTimeInputInTimeZone("2011-12-30T12:00", "Pacific/Apia")
    ).toEqual({ kind: "nonexistent", instants: [] });
  });
});
