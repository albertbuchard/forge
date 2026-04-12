import { describe, expect, it } from "vitest";
import {
  classifyCompanionSyncLabGap,
  companionSyncLabGapFixtures,
  companionSyncLabTimelineFixtures,
  previewCompanionSyncLabTimeline
} from "@/features/companion-sync-lab-fixtures";

describe("companion sync lab gap fixtures", () => {
  it("covers repaired stay, repaired trip, suppressed short jump, and missing cases", () => {
    const previews = companionSyncLabGapFixtures.map((fixture) => ({
      id: fixture.id,
      preview: classifyCompanionSyncLabGap(fixture)
    }));

    expect(previews).toEqual([
      expect.objectContaining({
        id: "gap-stay",
        preview: expect.objectContaining({
          kind: "stay",
          origin: "repaired_gap",
          suppressedShortJump: false
        })
      }),
      expect.objectContaining({
        id: "gap-short-jump",
        preview: expect.objectContaining({
          kind: "stay",
          origin: "repaired_gap",
          suppressedShortJump: true
        })
      }),
      expect.objectContaining({
        id: "gap-trip",
        preview: expect.objectContaining({
          kind: "trip",
          origin: "repaired_gap",
          suppressedShortJump: false
        })
      }),
      expect.objectContaining({
        id: "gap-missing-long",
        preview: expect.objectContaining({
          kind: "missing",
          origin: "missing",
          suppressedShortJump: false
        })
      }),
      expect.objectContaining({
        id: "gap-missing-boundary",
        preview: expect.objectContaining({
          kind: "missing",
          origin: "missing",
          suppressedShortJump: false
        })
      })
    ]);
  });

  it("covers the overnight gap bug with explicit missing data and no uncovered interval", () => {
    const overnight = companionSyncLabTimelineFixtures.find(
      (fixture) => fixture.id === "overnight-gap-before-move"
    );
    expect(overnight).toBeDefined();
    const preview = previewCompanionSyncLabTimeline(overnight!);

    expect(preview.uncoveredIntervals).toEqual([]);
    expect(preview.segments).toEqual([
      expect.objectContaining({
        kind: "stay",
        origin: "recorded",
        startedAt: "2026-04-05T21:15:00.000Z",
        endedAt: "2026-04-05T21:30:00.000Z"
      }),
      expect.objectContaining({
        kind: "missing",
        origin: "missing",
        startedAt: "2026-04-05T21:30:00.000Z",
        endedAt: "2026-04-06T02:34:00.000Z"
      }),
      expect.objectContaining({
        kind: "trip",
        origin: "recorded",
        startedAt: "2026-04-06T02:34:00.000Z",
        endedAt: "2026-04-06T02:40:00.000Z"
      })
    ]);
  });
});
