import type {
  MovementTimelineSegment,
  MovementTimelineSleepOverlay
} from "@/lib/types";

const OVERLAY_EPSILON_MS = 1_000;

function parseTime(value: string) {
  return new Date(value).getTime();
}

function toIso(valueMs: number) {
  return new Date(valueMs).toISOString();
}

function compareSegmentsAscending(
  left: MovementTimelineSegment,
  right: MovementTimelineSegment
) {
  const startedDelta = parseTime(left.startedAt) - parseTime(right.startedAt);
  if (startedDelta !== 0) {
    return startedDelta;
  }
  const endedDelta = parseTime(left.endedAt) - parseTime(right.endedAt);
  if (endedDelta !== 0) {
    return endedDelta;
  }
  return left.id.localeCompare(right.id);
}

export function isSleepOverlaySegment(segment: MovementTimelineSegment) {
  return segment.syncSource === "sleep overlay";
}

function mergeSleepOverlays(overlays: MovementTimelineSleepOverlay[]) {
  const sorted = [...overlays]
    .filter((overlay) => parseTime(overlay.endedAt) > parseTime(overlay.startedAt))
    .sort((left, right) => {
      const startedDelta = parseTime(left.startedAt) - parseTime(right.startedAt);
      if (startedDelta !== 0) {
        return startedDelta;
      }
      const endedDelta = parseTime(left.endedAt) - parseTime(right.endedAt);
      if (endedDelta !== 0) {
        return endedDelta;
      }
      return left.id.localeCompare(right.id);
    });
  if (sorted.length === 0) {
    return [];
  }
  const merged: MovementTimelineSleepOverlay[] = [];
  for (const overlay of sorted) {
    const current = merged.at(-1);
    if (!current) {
      merged.push(overlay);
      continue;
    }
    const currentEndMs = parseTime(current.endedAt);
    const nextStartMs = parseTime(overlay.startedAt);
    if (nextStartMs <= currentEndMs + OVERLAY_EPSILON_MS) {
      const nextEndMs = Math.max(currentEndMs, parseTime(overlay.endedAt));
      merged[merged.length - 1] = {
        ...current,
        id: `${current.id}__${overlay.id}`,
        endedAt: toIso(nextEndMs),
        asleepSeconds:
          (current.asleepSeconds ?? 0) + (overlay.asleepSeconds ?? 0) || null,
        timeInBedSeconds:
          (current.timeInBedSeconds ?? 0) + (overlay.timeInBedSeconds ?? 0) || null,
        sleepScore: overlay.sleepScore ?? current.sleepScore,
        regularityScore: overlay.regularityScore ?? current.regularityScore,
        efficiency: overlay.efficiency ?? current.efficiency,
        recoveryState: overlay.recoveryState ?? current.recoveryState
      };
      continue;
    }
    merged.push(overlay);
  }
  return merged;
}

function buildSleepSubtitle(overlay: MovementTimelineSleepOverlay) {
  const pieces: string[] = [];
  if (typeof overlay.asleepSeconds === "number" && overlay.asleepSeconds > 0) {
    const hours = overlay.asleepSeconds / 3_600;
    pieces.push(`${hours.toFixed(hours >= 1 ? 1 : 2)}h asleep`);
  } else if (
    typeof overlay.timeInBedSeconds === "number" &&
    overlay.timeInBedSeconds > 0
  ) {
    const hours = overlay.timeInBedSeconds / 3_600;
    pieces.push(`${hours.toFixed(hours >= 1 ? 1 : 2)}h in bed`);
  }
  if (typeof overlay.sleepScore === "number") {
    pieces.push(`score ${overlay.sleepScore}`);
  }
  if (typeof overlay.regularityScore === "number") {
    pieces.push(`regularity ${overlay.regularityScore}`);
  }
  if (overlay.recoveryState) {
    pieces.push(overlay.recoveryState);
  }
  return pieces.join(" · ") || "Sleep session";
}

function buildSleepOverlaySegment(
  overlay: MovementTimelineSleepOverlay
): Extract<MovementTimelineSegment, { kind: "stay" }> {
  const durationSeconds = Math.max(
    60,
    Math.round((parseTime(overlay.endedAt) - parseTime(overlay.startedAt)) / 1_000)
  );
  return {
    id: `sleep-overlay-${overlay.id}`,
    boxId: `sleep-overlay-${overlay.id}`,
    kind: "stay",
    sourceKind: "automatic",
    origin: "recorded",
    editable: false,
    isInvalid: false,
    startedAt: overlay.startedAt,
    endedAt: overlay.endedAt,
    trueStartedAt: overlay.startedAt,
    trueEndedAt: overlay.endedAt,
    visibleStartedAt: overlay.startedAt,
    visibleEndedAt: overlay.endedAt,
    durationSeconds,
    laneSide: "left",
    connectorFromLane: "left",
    connectorToLane: "left",
    title: "Sleep",
    subtitle: buildSleepSubtitle(overlay),
    placeLabel: null,
    tags: ["sleep"],
    syncSource: "sleep overlay",
    cursor: `${overlay.endedAt}::sleep-overlay-${overlay.id}`,
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

function cloneSegmentWithinWindow(
  segment: MovementTimelineSegment,
  startedAtMs: number,
  endedAtMs: number
): MovementTimelineSegment | null {
  if (endedAtMs <= startedAtMs) {
    return null;
  }
  const startedAt = toIso(startedAtMs);
  const endedAt = toIso(endedAtMs);
  const durationSeconds = Math.max(60, Math.round((endedAtMs - startedAtMs) / 1_000));
  return {
    ...segment,
    id: `${segment.id}::virtual-${startedAtMs}-${endedAtMs}`,
    startedAt,
    endedAt,
    trueStartedAt: startedAt,
    trueEndedAt: endedAt,
    visibleStartedAt: startedAt,
    visibleEndedAt: endedAt,
    durationSeconds,
    cursor: `${endedAt}::${segment.id}::virtual`
  };
}

export function applySleepOverlayToMovementSegments(
  segments: MovementTimelineSegment[],
  overlays: MovementTimelineSleepOverlay[]
) {
  let display = [...segments].sort(compareSegmentsAscending);
  for (const overlay of mergeSleepOverlays(overlays)) {
    const overlayStartMs = parseTime(overlay.startedAt);
    const overlayEndMs = parseTime(overlay.endedAt);
    const overlaySegment = buildSleepOverlaySegment(overlay);
    const nextDisplay: MovementTimelineSegment[] = [];
    let inserted = false;
    for (const segment of display) {
      const segmentStartMs = parseTime(segment.startedAt);
      const segmentEndMs = parseTime(segment.endedAt);
      if (segmentEndMs <= overlayStartMs || segmentStartMs >= overlayEndMs) {
        if (!inserted && segmentStartMs >= overlayEndMs) {
          nextDisplay.push(overlaySegment);
          inserted = true;
        }
        nextDisplay.push(segment);
        continue;
      }
      if (segmentStartMs < overlayStartMs) {
        const beforeSegment = cloneSegmentWithinWindow(
          segment,
          segmentStartMs,
          Math.min(segmentEndMs, overlayStartMs - OVERLAY_EPSILON_MS)
        );
        if (beforeSegment) {
          nextDisplay.push(beforeSegment);
        }
      }
      if (!inserted) {
        nextDisplay.push(overlaySegment);
        inserted = true;
      }
      if (segmentEndMs > overlayEndMs) {
        const afterSegment = cloneSegmentWithinWindow(
          segment,
          Math.max(segmentStartMs, overlayEndMs + OVERLAY_EPSILON_MS),
          segmentEndMs
        );
        if (afterSegment) {
          nextDisplay.push(afterSegment);
        }
      }
    }
    if (!inserted) {
      nextDisplay.push(overlaySegment);
    }
    display = nextDisplay.sort(compareSegmentsAscending);
  }
  return display;
}
