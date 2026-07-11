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
  it("keeps the Forge Smith and its trophy before the metric summary", () => {
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
      "gamification",
      "summary",
      "signals",
      "pipeline",
      "body-signals",
      "goals",
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
      "gamification",
      "summary",
      "signals",
      "pipeline",
      "body-signals",
      "goals",
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

  it("migrates a known legacy order with an invalid stored timestamp", () => {
    const legacy = layout(
      ["hero", "signals", "summary", "goals", "pipeline", "weather"],
      "invalid-legacy-timestamp"
    );

    expect(normalizeOverviewLayout(legacy).order).toEqual([
      "hero",
      "summary",
      "signals",
      "pipeline",
      "goals",
      "weather"
    ]);
  });

  it("is idempotent once the operational order is active", () => {
    const current = layout([
      "hero",
      "gamification",
      "summary",
      "signals",
      "pipeline",
      "body-signals",
      "goals",
      "life-force"
    ]);

    expect(normalizeOverviewLayout(current)).toBe(current);
  });

  it("repairs the regressed order that hid the Forge Smith below the fold", () => {
    const regressed = layout(
      [
        "hero",
        "summary",
        "gamification",
        "signals",
        "pipeline",
        "body-signals",
        "goals",
        "life-force",
        "weather"
      ],
      "2026-07-10T08:00:00.000Z"
    );

    expect(normalizeOverviewLayout(regressed).order).toEqual([
      "hero",
      "gamification",
      "summary",
      "signals",
      "pipeline",
      "body-signals",
      "goals",
      "life-force",
      "weather"
    ]);
  });

  it("preserves a deliberate direct reorder after the migration cutover", () => {
    const customized = layout(
      [
        "hero",
        "summary",
        "gamification",
        "signals",
        "pipeline",
        "body-signals",
        "goals",
        "life-force"
      ],
      "2026-07-11T09:30:00.000Z"
    );

    expect(normalizeOverviewLayout(customized)).toBe(customized);
  });

  it("restores required overview widgets without disturbing custom order", () => {
    const customized = layout(
      ["hero", "goals", "gamification", "summary"],
      "2026-07-10T08:00:00.000Z",
      {
        hero: {
          hidden: true,
          fullWidth: false,
          titleVisible: false,
          descriptionVisible: false
        },
        gamification: {
          hidden: true,
          fullWidth: false,
          titleVisible: false,
          descriptionVisible: false
        }
      }
    );

    expect(normalizeOverviewLayout(customized)).toMatchObject({
      order: customized.order,
      widgets: {
        hero: {
          hidden: false
        },
        gamification: {
          hidden: false
        }
      }
    });
  });
});
