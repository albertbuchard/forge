export type CompanionSyncLabSourceFixture = {
  id: string;
  title: string;
  desiredEnabled: boolean;
  appliedEnabled: boolean;
  authorizationStatus:
    | "not_determined"
    | "pending"
    | "approved"
    | "denied"
    | "restricted"
    | "unavailable"
    | "partial"
    | "disabled";
  syncEligible: boolean;
  lastObservedAt: string | null;
};

export type CompanionSyncLabGapFixture = {
  id: string;
  title: string;
  gapSeconds: number;
  displacementMeters: number | null;
  hasStartBoundary: boolean;
  hasEndBoundary: boolean;
};

export type CompanionSyncLabGapPreview = {
  kind: "stay" | "trip" | "missing";
  origin: "continued_stay" | "repaired_gap" | "missing";
  reason: string;
  suppressedShortJump: boolean;
};

export type CompanionSyncLabTimelineFixture = {
  id: string;
  title: string;
  rangeStart: string;
  rangeEnd: string;
  segments: Array<{
    id: string;
    kind: "stay" | "trip";
    startedAt: string;
    endedAt: string;
    placeLabel: string | null;
    placeExternalUid: string | null;
    startCoordinate: { latitude: number; longitude: number } | null;
    endCoordinate: { latitude: number; longitude: number } | null;
  }>;
};

export type CompanionSyncLabTimelinePreviewSegment = {
  id: string;
  kind: "stay" | "trip" | "missing";
  origin: "recorded" | "continued_stay" | "repaired_gap" | "missing";
  startedAt: string;
  endedAt: string;
  title: string;
};

export type CompanionSyncLabTimelinePreview = {
  segments: CompanionSyncLabTimelinePreviewSegment[];
  uncoveredIntervals: Array<{ startedAt: string; endedAt: string }>;
};

export const companionSyncLabSourceFixtures: CompanionSyncLabSourceFixture[] = [
  {
    id: "health-ready",
    title: "Health ready",
    desiredEnabled: true,
    appliedEnabled: true,
    authorizationStatus: "approved",
    syncEligible: true,
    lastObservedAt: "2026-04-12T09:00:00.000Z"
  },
  {
    id: "movement-pending-phone",
    title: "Movement pending on phone",
    desiredEnabled: true,
    appliedEnabled: false,
    authorizationStatus: "pending",
    syncEligible: false,
    lastObservedAt: "2026-04-12T09:04:00.000Z"
  },
  {
    id: "screen-time-denied",
    title: "Screen Time denied",
    desiredEnabled: true,
    appliedEnabled: true,
    authorizationStatus: "denied",
    syncEligible: false,
    lastObservedAt: "2026-04-12T08:54:00.000Z"
  },
  {
    id: "health-off",
    title: "Health off",
    desiredEnabled: false,
    appliedEnabled: false,
    authorizationStatus: "disabled",
    syncEligible: false,
    lastObservedAt: null
  }
];

export const companionSyncLabGapFixtures: CompanionSyncLabGapFixture[] = [
  {
    id: "gap-stay",
    title: "Quiet short gap",
    gapSeconds: 18 * 60,
    displacementMeters: 42,
    hasStartBoundary: true,
    hasEndBoundary: true
  },
  {
    id: "gap-short-jump",
    title: "Suppressed short jump",
    gapSeconds: 4 * 60,
    displacementMeters: 260,
    hasStartBoundary: true,
    hasEndBoundary: true
  },
  {
    id: "gap-trip",
    title: "Repaired move",
    gapSeconds: 22 * 60,
    displacementMeters: 1850,
    hasStartBoundary: true,
    hasEndBoundary: true
  },
  {
    id: "gap-missing-long",
    title: "Long missing gap",
    gapSeconds: 2 * 60 * 60,
    displacementMeters: 320,
    hasStartBoundary: true,
    hasEndBoundary: true
  },
  {
    id: "gap-missing-boundary",
    title: "Missing boundary anchor",
    gapSeconds: 16 * 60,
    displacementMeters: null,
    hasStartBoundary: false,
    hasEndBoundary: true
  }
];

export const companionSyncLabTimelineFixtures: CompanionSyncLabTimelineFixture[] = [
  {
    id: "overnight-gap-before-move",
    title: "Exact overnight stay-gap-move bug",
    rangeStart: "2026-04-05T21:15:00.000Z",
    rangeEnd: "2026-04-06T02:40:00.000Z",
    segments: [
      {
        id: "stay-home-evening",
        kind: "stay",
        startedAt: "2026-04-05T21:15:00.000Z",
        endedAt: "2026-04-05T21:30:00.000Z",
        placeLabel: "Home",
        placeExternalUid: "place_home",
        startCoordinate: { latitude: 46.5191, longitude: 6.6323 },
        endCoordinate: { latitude: 46.5191, longitude: 6.6323 }
      },
      {
        id: "trip-night-move",
        kind: "trip",
        startedAt: "2026-04-06T02:34:00.000Z",
        endedAt: "2026-04-06T02:40:00.000Z",
        placeLabel: "Night move",
        placeExternalUid: null,
        startCoordinate: { latitude: 46.5216, longitude: 6.6404 },
        endCoordinate: { latitude: 46.5226, longitude: 6.6424 }
      }
    ]
  },
  {
    id: "repeated-home-stays",
    title: "Repeated home stays coalesce",
    rangeStart: "2026-04-05T07:00:00.000Z",
    rangeEnd: "2026-04-05T08:44:00.000Z",
    segments: [
      {
        id: "stay-home-1",
        kind: "stay",
        startedAt: "2026-04-05T07:00:00.000Z",
        endedAt: "2026-04-05T08:00:00.000Z",
        placeLabel: "Home",
        placeExternalUid: "place_home",
        startCoordinate: { latitude: 46.5191, longitude: 6.6323 },
        endCoordinate: { latitude: 46.5191, longitude: 6.6323 }
      },
      {
        id: "stay-home-2",
        kind: "stay",
        startedAt: "2026-04-05T08:20:00.000Z",
        endedAt: "2026-04-05T08:40:00.000Z",
        placeLabel: "Home",
        placeExternalUid: "place_home",
        startCoordinate: { latitude: 46.51912, longitude: 6.63231 },
        endCoordinate: { latitude: 46.51912, longitude: 6.63231 }
      },
      {
        id: "trip-start-anchor",
        kind: "trip",
        startedAt: "2026-04-05T08:44:00.000Z",
        endedAt: "2026-04-05T08:49:00.000Z",
        placeLabel: "Walk out",
        placeExternalUid: null,
        startCoordinate: { latitude: 46.5217, longitude: 6.6405 },
        endCoordinate: { latitude: 46.5221, longitude: 6.6412 }
      }
    ]
  }
];

const HOUR_SECONDS = 60 * 60;
const TRIP_MINIMUM_SECONDS = 5 * 60;
const DISPLACEMENT_THRESHOLD_METERS = 100;

function durationSeconds(startedAt: string, endedAt: string) {
  return Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
}

function boundaryDistanceMeters(
  left: { latitude: number; longitude: number } | null,
  right: { latitude: number; longitude: number } | null
) {
  if (!left || !right) {
    return null;
  }
  const earthRadius = 6371000;
  const latitudeDelta = ((right.latitude - left.latitude) * Math.PI) / 180;
  const longitudeDelta = ((right.longitude - left.longitude) * Math.PI) / 180;
  const leftRadians = (left.latitude * Math.PI) / 180;
  const rightRadians = (right.latitude * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftRadians) * Math.cos(rightRadians) * Math.sin(longitudeDelta / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function boundariesShareAnchor(
  left: CompanionSyncLabTimelineFixture["segments"][number],
  right: CompanionSyncLabTimelineFixture["segments"][number]
) {
  if (
    left.placeExternalUid &&
    right.placeExternalUid &&
    left.placeExternalUid === right.placeExternalUid
  ) {
    return true;
  }
  const displacement = boundaryDistanceMeters(left.endCoordinate, right.startCoordinate);
  return displacement !== null && displacement <= DISPLACEMENT_THRESHOLD_METERS;
}

export function classifyCompanionSyncLabGap(
  input: CompanionSyncLabGapFixture
): CompanionSyncLabGapPreview {
  if (input.gapSeconds > 60 * 60) {
    return {
      kind: "missing",
      origin: "missing",
      reason: "Gap exceeded one hour, so Forge keeps it as explicit missing data.",
      suppressedShortJump: false
    };
  }

  if (!input.hasStartBoundary || !input.hasEndBoundary || input.displacementMeters === null) {
    return {
      kind: "missing",
      origin: "missing",
      reason: "One or both boundary anchors were missing, so the gap stays missing instead of inventing movement.",
      suppressedShortJump: false
    };
  }

  if (input.displacementMeters <= 100) {
    return {
      kind: "stay",
      origin: "repaired_gap",
      reason: "Boundary displacement stayed within 100 m, so the gap repairs into one stay.",
      suppressedShortJump: false
    };
  }

  if (input.gapSeconds < 5 * 60) {
    return {
      kind: "stay",
      origin: "repaired_gap",
      reason: "The jump crossed 100 m but stayed under five minutes, so Forge suppresses it into stay continuity.",
      suppressedShortJump: true
    };
  }

  return {
    kind: "trip",
    origin: "repaired_gap",
    reason: "The gap stayed under one hour, crossed 100 m, and lasted at least five minutes, so Forge repairs it into a move.",
    suppressedShortJump: false
  };
}

export function previewCompanionSyncLabTimeline(
  fixture: CompanionSyncLabTimelineFixture
): CompanionSyncLabTimelinePreview {
  const raw = [...fixture.segments].sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt)
  );
  const normalized: CompanionSyncLabTimelinePreviewSegment[] = [];
  if (raw.length === 0) {
    return {
      segments: [],
      uncoveredIntervals: []
    };
  }

  const first = raw[0]!;
  if (durationSeconds(fixture.rangeStart, first.startedAt) > 0) {
    normalized.push({
      id: `missing_${fixture.rangeStart}_${first.startedAt}`,
      kind: "missing",
      origin: "missing",
      startedAt: fixture.rangeStart,
      endedAt: first.startedAt,
      title: "Missing data"
    });
  }

  raw.forEach((segment, index) => {
    if (index > 0) {
      const previous = raw[index - 1]!;
      const gapSeconds = durationSeconds(previous.endedAt, segment.startedAt);
      if (gapSeconds > 0) {
        if (gapSeconds > HOUR_SECONDS) {
          normalized.push({
            id: `missing_${previous.id}_${segment.id}`,
            kind: "missing",
            origin: "missing",
            startedAt: previous.endedAt,
            endedAt: segment.startedAt,
            title: "Missing data"
          });
        } else if (boundariesShareAnchor(previous, segment)) {
          normalized.push({
            id: `repaired_stay_${previous.id}_${segment.id}`,
            kind: "stay",
            origin: "repaired_gap",
            startedAt: previous.endedAt,
            endedAt: segment.startedAt,
            title: previous.placeLabel ?? segment.placeLabel ?? "Repaired stay"
          });
        } else {
          const displacementMeters = boundaryDistanceMeters(
            previous.endCoordinate,
            segment.startCoordinate
          );
          if (displacementMeters === null) {
            normalized.push({
              id: `missing_${previous.id}_${segment.id}`,
              kind: "missing",
              origin: "missing",
              startedAt: previous.endedAt,
              endedAt: segment.startedAt,
              title: "Missing data"
            });
          } else if (gapSeconds < TRIP_MINIMUM_SECONDS) {
            normalized.push({
              id: `repaired_short_jump_${previous.id}_${segment.id}`,
              kind: "stay",
              origin: "repaired_gap",
              startedAt: previous.endedAt,
              endedAt: segment.startedAt,
              title: previous.placeLabel ?? segment.placeLabel ?? "Repaired stay"
            });
          } else {
            normalized.push({
              id: `repaired_trip_${previous.id}_${segment.id}`,
              kind: "trip",
              origin: "repaired_gap",
              startedAt: previous.endedAt,
              endedAt: segment.startedAt,
              title: "Repaired move"
            });
          }
        }
      }
    }
    normalized.push({
      id: segment.id,
      kind: segment.kind,
      origin: "recorded",
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      title: segment.placeLabel ?? segment.kind
    });
  });

  const last = raw[raw.length - 1]!;
  const trailingGapSeconds = durationSeconds(last.endedAt, fixture.rangeEnd);
  if (trailingGapSeconds > 0) {
    if (last.kind === "stay" && trailingGapSeconds <= HOUR_SECONDS) {
      normalized.push({
        id: `continued_${last.id}_${fixture.rangeEnd}`,
        kind: "stay",
        origin: "continued_stay",
        startedAt: last.endedAt,
        endedAt: fixture.rangeEnd,
        title: last.placeLabel ?? "Continued stay"
      });
    } else {
      normalized.push({
        id: `missing_${last.endedAt}_${fixture.rangeEnd}`,
        kind: "missing",
        origin: "missing",
        startedAt: last.endedAt,
        endedAt: fixture.rangeEnd,
        title: "Missing data"
      });
    }
  }

  const coalesced: CompanionSyncLabTimelinePreviewSegment[] = [];
  for (const segment of normalized) {
    const previous = coalesced[coalesced.length - 1];
    if (
      previous &&
      previous.kind === "stay" &&
      segment.kind === "stay" &&
      (previous.origin !== "recorded" || segment.origin !== "recorded") &&
      previous.endedAt === segment.startedAt
    ) {
      coalesced[coalesced.length - 1] = {
        ...previous,
        id: `${previous.id}_${segment.id}`,
        origin:
          previous.origin === "continued_stay" || segment.origin === "continued_stay"
            ? "continued_stay"
            : "repaired_gap",
        endedAt: segment.endedAt
      };
      continue;
    }
    coalesced.push(segment);
  }

  const uncoveredIntervals: Array<{ startedAt: string; endedAt: string }> = [];
  const sorted = [...coalesced].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  if (sorted[0]?.startedAt !== fixture.rangeStart) {
    uncoveredIntervals.push({
      startedAt: fixture.rangeStart,
      endedAt: sorted[0]?.startedAt ?? fixture.rangeEnd
    });
  }
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1]!.endedAt !== sorted[index]!.startedAt) {
      uncoveredIntervals.push({
        startedAt: sorted[index - 1]!.endedAt,
        endedAt: sorted[index]!.startedAt
      });
    }
  }
  if (sorted[sorted.length - 1]?.endedAt !== fixture.rangeEnd) {
    uncoveredIntervals.push({
      startedAt: sorted[sorted.length - 1]?.endedAt ?? fixture.rangeStart,
      endedAt: fixture.rangeEnd
    });
  }

  return {
    segments: sorted,
    uncoveredIntervals
  };
}
