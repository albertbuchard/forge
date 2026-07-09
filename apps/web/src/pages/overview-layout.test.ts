import { describe, expect, it } from "vitest";
import type { SurfaceLayoutPayload } from "@/lib/types";
import { normalizeOverviewLayout } from "@/pages/overview-layout";

function layout(
  order: string[],
  updatedAt = new Date(0).toISOString(),
  widgets: SurfaceLayoutPayload["widgets"] = {}
): SurfaceLayoutPayload {
  return {
    surfaceId: "overview",
    order,
    widgets,
    updatedAt
  };
}

describe("normalizeOverviewLayout", () => {
  it("puts current state and next actions before detailed summaries", () => {
    const normalized = normalizeOverviewLayout(
      layout([
        "hero",
        "gamification",
        "summary",
        "life-force",
        "body-signals",
        "signals",
        "goals",
        "pipeline",
        "weather"
      ])
    );

    expect(normalized.order).toEqual([
      "hero",
      "summary",
      "signals",
      "pipeline",
      "body-signals",
      "goals",
      "gamification",
      "life-force",
      "weather"
    ]);
  });

  it("migrates the former default core order and preserves utilities", () => {
    const normalized = normalizeOverviewLayout(
      layout(
        [
          "hero",
          "signals",
          "summary",
          "goals",
          "pipeline",
          "time",
          "weather",
          "gamification",
          "life-force",
          "body-signals"
        ],
        "2026-04-07T17:59:05.413Z",
        {
          summary: {
            hidden: false,
            fullWidth: false,
            titleVisible: true,
            descriptionVisible: true
          },
          signals: {
            hidden: false,
            fullWidth: false,
            titleVisible: true,
            descriptionVisible: true
          },
          pipeline: {
            hidden: false,
            fullWidth: true,
            titleVisible: true,
            descriptionVisible: true
          }
        }
      )
    );

    expect(normalized.order).toEqual([
      "hero",
      "summary",
      "signals",
      "pipeline",
      "body-signals",
      "goals",
      "gamification",
      "life-force",
      "time",
      "weather"
    ]);
    expect(normalized.widgets.summary).toMatchObject({
      titleVisible: false,
      descriptionVisible: false
    });
    expect(normalized.widgets.signals).toMatchObject({
      titleVisible: false,
      descriptionVisible: false
    });
    expect(normalized.widgets.pipeline).toMatchObject({
      titleVisible: true,
      descriptionVisible: false
    });
  });

  it("does not override a deliberately customized current layout", () => {
    const customized = layout(
      ["hero", "goals", "summary", "signals", "body-signals", "pipeline"],
      "2026-07-09T20:00:00.000Z"
    );

    expect(normalizeOverviewLayout(customized)).toBe(customized);
  });

  it("does not mistake an unsaved custom order for the generated default", () => {
    const customized = layout([
      "hero",
      "goals",
      "summary",
      "signals",
      "pipeline",
      "body-signals"
    ]);

    expect(normalizeOverviewLayout(customized)).toBe(customized);
  });

  it("is idempotent once the operational order is active", () => {
    const current = layout([
      "hero",
      "summary",
      "signals",
      "pipeline",
      "body-signals",
      "goals",
      "gamification",
      "life-force"
    ]);

    expect(normalizeOverviewLayout(current)).toBe(current);
  });
});
