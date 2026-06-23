import { describe, expect, it } from "vitest";
import {
  applySleepOverlayToMovementSegments,
  isSleepOverlaySegment
} from "@/components/movement/movement-sleep-overlay";
import type {
  MovementTimelineSegment,
  MovementTimelineSleepOverlay
} from "@/lib/types";

function makeSegment(
  id: string,
  kind: MovementTimelineSegment["kind"],
  startedAt: string,
  endedAt: string
): MovementTimelineSegment {
  return {
    id,
    boxId: id,
    kind,
    sourceKind: "automatic",
    origin: kind === "missing" ? "missing" : "recorded",
    editable: false,
    isInvalid: false,
    startedAt,
    endedAt,
    trueStartedAt: startedAt,
    trueEndedAt: endedAt,
    visibleStartedAt: startedAt,
    visibleEndedAt: endedAt,
    durationSeconds: Math.round(
      (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1_000
    ),
    laneSide: kind === "trip" ? "right" : "left",
    connectorFromLane: kind === "trip" ? "right" : "left",
    connectorToLane: kind === "trip" ? "right" : "left",
    title: kind === "trip" ? "Move" : kind === "missing" ? "Missing data" : "Stay",
    subtitle: "",
    placeLabel: kind === "stay" ? "Home" : null,
    tags: [],
    syncSource: "automatic",
    cursor: `${endedAt}::${id}`,
    overrideCount: 0,
    overriddenAutomaticBoxIds: [],
    overriddenUserBoxIds: [],
    isFullyHidden: false,
    rawStayIds: [],
    rawTripIds: [],
    rawPointCount: 0,
    hasLegacyCorrections: false,
    stay: null,
    trip: null
  };
}

describe("applySleepOverlayToMovementSegments", () => {
  it("inserts a centered virtual sleep stay and slices overlapping boxes around it", () => {
    const segments: MovementTimelineSegment[] = [
      makeSegment(
        "stay-before",
        "stay",
        "2026-04-19T20:00:00.000Z",
        "2026-04-19T23:00:00.000Z"
      ),
      makeSegment(
        "trip-after",
        "trip",
        "2026-04-20T06:00:00.000Z",
        "2026-04-20T07:00:00.000Z"
      )
    ];
    const overlays: MovementTimelineSleepOverlay[] = [
      {
        id: "sleep-1",
        externalUid: "sleep-1",
        startedAt: "2026-04-19T22:00:00.000Z",
        endedAt: "2026-04-20T06:30:00.000Z",
        localDateKey: "2026-04-20",
        sourceTimezone: "Europe/Zurich",
        asleepSeconds: 28_800,
        timeInBedSeconds: 30_600,
        sleepScore: 84,
        regularityScore: 77,
        efficiency: 0.94,
        recoveryState: "rested"
      }
    ];

    const display = applySleepOverlayToMovementSegments(segments, overlays);

    expect(display).toHaveLength(3);
    expect(display[0]?.id).toContain("stay-before");
    expect(display[0]?.startedAt).toBe("2026-04-19T20:00:00.000Z");
    expect(display[0]?.endedAt).toBe("2026-04-19T21:59:59.000Z");
    expect(isSleepOverlaySegment(display[1]!)).toBe(true);
    expect(display[1]?.startedAt).toBe("2026-04-19T22:00:00.000Z");
    expect(display[1]?.endedAt).toBe("2026-04-20T06:30:00.000Z");
    expect(display[2]?.id).toContain("trip-after");
    expect(display[2]?.startedAt).toBe("2026-04-20T06:30:01.000Z");
    expect(display[2]?.endedAt).toBe("2026-04-20T07:00:00.000Z");
  });

  it("drops boxes that are fully hidden by the sleep overlay", () => {
    const segments: MovementTimelineSegment[] = [
      makeSegment(
        "covered-stay",
        "stay",
        "2026-04-19T23:00:00.000Z",
        "2026-04-20T01:00:00.000Z"
      )
    ];
    const overlays: MovementTimelineSleepOverlay[] = [
      {
        id: "sleep-1",
        externalUid: "sleep-1",
        startedAt: "2026-04-19T22:00:00.000Z",
        endedAt: "2026-04-20T06:30:00.000Z",
        localDateKey: "2026-04-20",
        sourceTimezone: "Europe/Zurich",
        asleepSeconds: 28_800,
        timeInBedSeconds: 30_600,
        sleepScore: 84,
        regularityScore: 77,
        efficiency: 0.94,
        recoveryState: "rested"
      }
    ];

    const display = applySleepOverlayToMovementSegments(segments, overlays);

    expect(display).toHaveLength(1);
    expect(isSleepOverlaySegment(display[0]!)).toBe(true);
  });
});
