import { describe, expect, it } from "vitest";
import { validateWeeklyReviewBoundary } from "@/pages/weekly-review-page";

describe("weekly review evidence boundaries", () => {
  it("accepts a seven-day Monday-to-Sunday window across a year boundary", () => {
    expect(
      validateWeeklyReviewBoundary({
        weekKey: "2025-12-29",
        weekStartDate: "2025-12-29",
        weekEndDate: "2026-01-04",
        chart: Array.from({ length: 7 }, (_, index) => ({
          label: `Day ${index + 1}`,
          xp: 0,
          focusHours: 0
        }))
      })
    ).toEqual({ valid: true, issues: [] });
  });

  it("rejects timezone-shifted and oversized cross-week windows", () => {
    const result = validateWeeklyReviewBoundary({
      weekKey: "2026-06-28",
      weekStartDate: "2026-06-28",
      weekEndDate: "2026-07-05",
      chart: Array.from({ length: 8 }, (_, index) => ({
        label: `Day ${index + 1}`,
        xp: 0,
        focusHours: 0
      }))
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContain(
      "The review boundary must run from Monday through Sunday."
    );
    expect(result.issues).toContain(
      "The review must contain exactly seven daily evidence buckets."
    );
  });

  it("rejects a closure key that points at another week", () => {
    expect(
      validateWeeklyReviewBoundary({
        weekKey: "2026-07-06",
        weekStartDate: "2026-07-13",
        weekEndDate: "2026-07-19",
        chart: Array.from({ length: 7 }, (_, index) => ({
          label: `Day ${index + 1}`,
          xp: 0,
          focusHours: 0
        }))
      }).issues
    ).toContain("The review key does not match the displayed week start.");
  });
});
