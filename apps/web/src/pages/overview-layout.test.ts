import { describe, expect, it } from "vitest";
import type { SurfaceLayoutPayload } from "@/lib/types";
import { normalizeOverviewLayout } from "@/pages/overview-layout";

function layout(
  order: string[],
  widgets: SurfaceLayoutPayload["widgets"] = {},
  updatedAt = "2026-08-01T12:00:00.000Z"
): SurfaceLayoutPayload {
  return { surfaceId: "overview", order, widgets, updatedAt };
}

describe("normalizeOverviewLayout", () => {
  it("keeps the exact generated information hierarchy", () => {
    const generated = layout([
      "hero",
      "gamification",
      "what-matters",
      "signals",
      "forge-map",
      "body-signals",
      "summary",
      "pipeline",
      "goals",
      "life-force",
      "time"
    ]);

    expect(normalizeOverviewLayout(generated)).toBe(generated);
  });

  it("repairs a persisted core order and keeps optional order", () => {
    const normalized = normalizeOverviewLayout(
      layout([
        "hero",
        "gamification",
        "summary",
        "signals",
        "pipeline",
        "body-signals",
        "goals",
        "life-force",
        "weather"
      ])
    );

    expect(normalized.order).toEqual([
      "hero",
      "gamification",
      "what-matters",
      "signals",
      "forge-map",
      "body-signals",
      "summary",
      "pipeline",
      "goals",
      "life-force",
      "weather"
    ]);
  });

  it("preserves every preference and the relative order of optional widgets", () => {
    const widgets: SurfaceLayoutPayload["widgets"] = {
      signals: {
        hidden: true,
        fullWidth: true,
        titleVisible: true,
        descriptionVisible: false
      },
      goals: {
        hidden: true,
        fullWidth: false,
        titleVisible: false,
        descriptionVisible: true
      },
      hero: {
        hidden: false,
        fullWidth: true,
        titleVisible: true,
        descriptionVisible: true
      }
    };
    const normalized = normalizeOverviewLayout(
      layout(
        ["goals", "hero", "signals", "gamification", "weather", "summary"],
        widgets
      )
    );

    expect(normalized.order).toEqual([
      "hero",
      "gamification",
      "what-matters",
      "signals",
      "forge-map",
      "body-signals",
      "goals",
      "weather",
      "summary"
    ]);
    expect(normalized.widgets.signals).toEqual(widgets.signals);
    expect(normalized.widgets.goals).toEqual(widgets.goals);
    expect(normalized.widgets.hero).toEqual(widgets.hero);
  });

  it("restores exactly the four required widgets", () => {
    const hidden = {
      hidden: true,
      fullWidth: false,
      titleVisible: false,
      descriptionVisible: false
    };
    const normalized = normalizeOverviewLayout(
      layout(
        [
          "hero",
          "gamification",
          "what-matters",
          "signals",
          "forge-map",
          "goals"
        ],
        {
          hero: hidden,
          gamification: hidden,
          "what-matters": hidden,
          "forge-map": hidden,
          signals: hidden,
          goals: hidden
        }
      )
    );

    for (const id of ["hero", "gamification", "what-matters", "forge-map"]) {
      expect(normalized.widgets[id]?.hidden).toBe(false);
    }
    expect(normalized.widgets.signals?.hidden).toBe(true);
    expect(normalized.widgets.goals?.hidden).toBe(true);
  });

  it("is idempotent after normalization", () => {
    const first = normalizeOverviewLayout(
      layout(["hero", "signals", "gamification", "body-signals"])
    );
    expect(normalizeOverviewLayout(first)).toBe(first);
  });
});
