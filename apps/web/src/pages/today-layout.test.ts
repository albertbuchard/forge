import { describe, expect, it } from "vitest";
import { normalizeTodayLayout } from "@/pages/today-layout";
import type { SurfaceLayoutPayload } from "@/lib/types";

function layout(
  order: string[],
  updatedAt = new Date(0).toISOString()
): SurfaceLayoutPayload {
  return {
    surfaceId: "today",
    order,
    widgets: {},
    updatedAt
  };
}

describe("normalizeTodayLayout", () => {
  it("puts action and capacity before reward summaries in a new layout", () => {
    const normalized = normalizeTodayLayout(
      layout([
        "hero",
        "life-force",
        "metrics",
        "runway",
        "calendar",
        "focus",
        "weather"
      ])
    );

    expect(normalized.order).toEqual([
      "hero",
      "runway",
      "life-force",
      "focus",
      "calendar",
      "metrics",
      "weather"
    ]);
  });

  it("migrates the former default while preserving optional widget order", () => {
    const normalized = normalizeTodayLayout(
      layout(
        [
          "hero",
          "metrics",
          "runway",
          "calendar",
          "focus",
          "weather",
          "life-force",
          "quick-capture"
        ],
        "2026-04-07T18:01:44.257Z"
      )
    );

    expect(normalized.order).toEqual([
      "hero",
      "runway",
      "life-force",
      "focus",
      "calendar",
      "metrics",
      "weather",
      "quick-capture"
    ]);
  });

  it("does not override a deliberately customized current layout", () => {
    const customized = layout(
      ["hero", "calendar", "runway", "focus", "metrics", "life-force"],
      "2026-07-09T20:00:00.000Z"
    );

    expect(normalizeTodayLayout(customized)).toBe(customized);
  });

  it("is idempotent once the operational order is active", () => {
    const current = layout([
      "hero",
      "runway",
      "life-force",
      "focus",
      "calendar",
      "metrics"
    ]);

    expect(normalizeTodayLayout(current)).toBe(current);
  });
});
