import { describe, expect, it } from "vitest";
import { formatMeasurement } from "./weight-loss-format";

describe("formatMeasurement", () => {
  it("does not append a unit to missing evidence", () => {
    expect(formatMeasurement(null, "g", 1)).toBe("n/a");
    expect(formatMeasurement(undefined, "%", 0)).toBe("n/a");
    expect(formatMeasurement(12.34, "g", 1)).toBe("12.3g");
  });
});
