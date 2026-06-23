import type { FacetedTokenOption } from "@/components/search/faceted-token-search";
import type { MovementPlaceDraftSeed } from "@/components/movement/movement-place-editor-dialog";
import { isSleepOverlaySegment } from "@/components/movement/movement-sleep-overlay";
import type {
  MovementBoxDetailCoordinate,
  MovementKnownPlace,
  MovementTimelineLaneSide,
  MovementTimelineSegment
} from "@/lib/types";

export const TIMELINE_PAGE_SIZE = 24;
export const GRID_ROW_HEIGHT = 64;
export const MAX_DISPLAY_SECONDS = 6 * 60 * 60;
export const HISTORY_LEAD_HOURS = 5;
export const FUTURE_GRID_HOURS = 1;
export const HISTORY_CAP_HEIGHT = 104;
export const TIMELINE_ROW_OVERSCAN_PX = GRID_ROW_HEIGHT * 8;

export type TimelineDraft = {
  kind: MovementTimelineSegment["kind"];
  label: string;
  placeLabel: string;
  tagsInput: string;
  startedAtInput: string;
  endedAtInput: string;
};

export type TimelineItemLayoutMetric = {
  id: string;
  segment: MovementTimelineSegment;
  gapBefore: number;
  displayHeight: number;
  boxTop: number;
  boxBottom: number;
};

export type TimelineHourMarker = {
  y: number;
  label: string;
  strong: boolean;
};

export type MovementTimelineLayoutModel = {
  historyHeaderHeight: number;
  leadHeight: number;
  items: TimelineItemLayoutMetric[];
  markers: TimelineHourMarker[];
  rangeEndMs: number;
  futureTailHeight: number;
  totalHeight: number;
};

export function normalizeSearchText(text: string) {
  return text.trim().toLowerCase();
}

export function formatDurationLabel(durationSeconds: number) {
  if (durationSeconds >= 86_400) {
    return `${Math.round(durationSeconds / 3_600)}h`;
  }
  if (durationSeconds >= 3_600) {
    return `${(durationSeconds / 3_600).toFixed(1)}h`;
  }
  return `${Math.max(1, Math.round(durationSeconds / 60))}m`;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatStickyDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  }).format(new Date(value));
}

export function formatHourMarker(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    hour12: false
  }).format(value);
}

export function formatDateTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function parseDateTimeInput(value: string) {
  if (!value.trim()) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

export function distanceLabel(distanceMeters: number) {
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(distanceMeters)} m`;
}

export function compactTimeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

export function shortLatLngLabel(latitude: number, longitude: number) {
  return `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
}

export function exactLatLngLabel(latitude: number, longitude: number) {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export function formatDurationMinutes(seconds: number) {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function normalizeDetailMapPoints(points: MovementBoxDetailCoordinate[]) {
  if (points.length === 0) {
    return [];
  }
  const minLat = Math.min(...points.map((point) => point.latitude));
  const maxLat = Math.max(...points.map((point) => point.latitude));
  const minLng = Math.min(...points.map((point) => point.longitude));
  const maxLng = Math.max(...points.map((point) => point.longitude));
  const latRange = Math.max(maxLat - minLat, 0.0001);
  const lngRange = Math.max(maxLng - minLng, 0.0001);
  return points.map((point, index) => ({
    ...point,
    x: 12 + ((point.longitude - minLng) / lngRange) * 76,
    y: 12 + (1 - (point.latitude - minLat) / latRange) * 76,
    id: `${point.recordedAt ?? "point"}-${index}`
  }));
}

export function hasRecordedTrip(
  segment: MovementTimelineSegment
): segment is Extract<MovementTimelineSegment, { kind: "trip" }> & {
  trip: NonNullable<Extract<MovementTimelineSegment, { kind: "trip" }>["trip"]>;
} {
  return segment.kind === "trip" && segment.trip !== null;
}

export function hasRecordedStay(
  segment: MovementTimelineSegment
): segment is Extract<MovementTimelineSegment, { kind: "stay" }> & {
  stay: NonNullable<Extract<MovementTimelineSegment, { kind: "stay" }>["stay"]>;
} {
  return segment.kind === "stay" && segment.stay !== null;
}

export function movementPlaceSeedFromSegment(
  segment: MovementTimelineSegment
): MovementPlaceDraftSeed | null {
  if (!hasRecordedStay(segment) || segment.stay.place) {
    return null;
  }
  return {
    label: segment.stay.label || segment.title,
    latitude: segment.stay.centerLatitude,
    longitude: segment.stay.centerLongitude,
    radiusMeters: segment.stay.radiusMeters,
    categoryTags: segment.tags
  };
}

export function resolveSegmentPlaceLabel(segment: MovementTimelineSegment | null) {
  if (!segment) {
    return null;
  }
  if (segment.kind === "stay") {
    return hasRecordedStay(segment)
      ? segment.stay.place?.label ?? segment.placeLabel ?? segment.stay.label ?? null
      : segment.placeLabel ?? null;
  }
  return segment.placeLabel ?? null;
}

export function distanceBetweenCoordinates(
  startLatitude: number,
  startLongitude: number,
  endLatitude: number,
  endLongitude: number
) {
  const earthRadiusMeters = 6_371_000;
  const latDelta = ((endLatitude - startLatitude) * Math.PI) / 180;
  const lngDelta = ((endLongitude - startLongitude) * Math.PI) / 180;
  const startLatRadians = (startLatitude * Math.PI) / 180;
  const endLatRadians = (endLatitude * Math.PI) / 180;
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLatRadians) *
      Math.cos(endLatRadians) *
      Math.sin(lngDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

export function buildMovementPlaceSearchText(place: MovementKnownPlace) {
  return normalizeSearchText([place.label, ...place.aliases].join(" "));
}

export function resolveTripEndpoint(
  segment: Extract<MovementTimelineSegment, { kind: "trip" }>,
  kind: "start" | "end",
  options?: {
    includeCoordinates?: boolean;
    useHistoryAnchorFallback?: boolean;
  }
) {
  if (!segment.trip) {
    return {
      label:
        segment.placeLabel ??
        (kind === "start" ? "Known origin" : "Known destination"),
      detail: compactTimeLabel(kind === "start" ? segment.startedAt : segment.endedAt)
    };
  }
  const point =
    kind === "start"
      ? segment.trip.points[0] ?? null
      : segment.trip.points[segment.trip.points.length - 1] ?? null;
  const place = kind === "start" ? segment.trip.startPlace : segment.trip.endPlace;
  const includeCoordinates = options?.includeCoordinates ?? true;
  const historyFallback =
    options?.useHistoryAnchorFallback && kind === "start" ? "Beginning of history" : null;
  return {
    label:
      place?.label ??
      (historyFallback ??
        (includeCoordinates && point
          ? shortLatLngLabel(point.latitude, point.longitude)
          : kind === "start"
            ? "Unknown origin"
            : "Unknown destination")),
    detail:
      includeCoordinates && point && !place
        ? shortLatLngLabel(point.latitude, point.longitude)
        : compactTimeLabel(kind === "start" ? segment.startedAt : segment.endedAt)
  };
}

export function isGenericTripTitle(title: string) {
  const normalized = title.trim().toLowerCase();
  return normalized === "travel" || normalized === "trip" || normalized === "move";
}

export function normalizeMissingSegmentTitle(
  segment: Extract<MovementTimelineSegment, { kind: "missing" }>
) {
  const normalized = segment.title.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized === "stay" ||
    normalized === "continued stay" ||
    normalized === "repaired stay"
  ) {
    return segment.sourceKind === "user_defined"
      ? segment.origin === "user_invalidated"
        ? "User invalidated movement"
        : "User-defined missing data"
      : "Missing data";
  }
  return segment.title;
}

export function resolveStayDisplayTitle(
  segment: Extract<MovementTimelineSegment, { kind: "stay" }>
) {
  const canonicalLabel = resolveSegmentPlaceLabel(segment);
  const normalizedTitle = segment.title.trim().toLowerCase();
  const titleIsGeneric =
    normalizedTitle.length === 0 ||
    normalizedTitle === "stay" ||
    normalizedTitle === "continued stay" ||
    normalizedTitle === "repaired stay" ||
    normalizedTitle === "manual stay";

  if (canonicalLabel && titleIsGeneric) {
    return canonicalLabel;
  }

  return segment.title.trim() || canonicalLabel || "Stay";
}

export function displaySegmentTitle(segment: MovementTimelineSegment) {
  if (isSleepOverlaySegment(segment)) {
    return "Sleep";
  }
  if (segment.kind === "missing") {
    return normalizeMissingSegmentTitle(segment);
  }
  if (segment.kind === "stay") {
    return resolveStayDisplayTitle(segment);
  }
  if (segment.kind === "trip" && isGenericTripTitle(segment.title)) {
    const start = resolveTripEndpoint(segment, "start").label;
    const end = resolveTripEndpoint(segment, "end").label;
    return `${start} \u2192 ${end}`;
  }
  return segment.title;
}

export function displaySegmentBadge(segment: MovementTimelineSegment) {
  if (isSleepOverlaySegment(segment)) {
    return "Sleep";
  }
  if (hasRecordedTrip(segment)) {
    return segment.trip.travelMode === "walking" ? "Walk" : "Move";
  }
  if (segment.kind === "trip") {
    return "Repair";
  }
  if (segment.kind === "missing") {
    return "Missing";
  }
  return "Stay";
}

export function lanePercent(side: MovementTimelineLaneSide | "center") {
  if (side === "left") {
    return 24;
  }
  if (side === "right") {
    return 76;
  }
  return 50;
}

export function segmentDisplayHeight(
  durationSeconds: number,
  kind: MovementTimelineSegment["kind"],
  syncSource?: string
) {
  const cappedHours = Math.min(durationSeconds, MAX_DISPLAY_SECONDS) / 3600;
  const isSleep = syncSource === "sleep overlay";
  const minHeight = isSleep ? 112 : kind === "stay" ? 104 : 92;
  const maxHeight = isSleep ? 272 : kind === "stay" ? 288 : 232;
  const height = minHeight + cappedHours * 30;
  return Math.max(minHeight, Math.min(maxHeight, height));
}

export function buildDraft(segment: MovementTimelineSegment): TimelineDraft {
  return {
    kind: segment.kind,
    label: hasRecordedStay(segment)
      ? segment.stay.label || segment.title
      : hasRecordedTrip(segment)
        ? segment.trip.label || segment.title
        : segment.title,
    placeLabel: hasRecordedStay(segment)
      ? segment.stay.place?.label ?? segment.placeLabel ?? ""
      : "",
    tagsInput: segment.tags.join(", "),
    startedAtInput: formatDateTimeInput(segment.startedAt),
    endedAtInput: formatDateTimeInput(segment.endedAt)
  };
}

export function buildNewDraft(
  kind: MovementTimelineSegment["kind"],
  seedSegment?: MovementTimelineSegment | null
): TimelineDraft {
  const seedStart = seedSegment?.startedAt ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const seedEnd = seedSegment?.endedAt ?? new Date().toISOString();
  return {
    kind,
    label:
      kind === "missing"
        ? "User-defined missing data"
        : kind === "stay"
          ? seedSegment?.placeLabel || "Manual stay"
          : "Manual move",
    placeLabel: seedSegment?.placeLabel ?? "",
    tagsInput:
      kind === "missing"
        ? "user-defined, missing-data"
        : kind === "stay"
          ? "user-defined, stay"
          : "user-defined, move",
    startedAtInput: formatDateTimeInput(seedStart),
    endedAtInput: formatDateTimeInput(seedEnd)
  };
}

export function buildMovementUserBoxPayloadInput(
  draft: TimelineDraft,
  segment: MovementTimelineSegment | null
) {
  const tags = draft.tagsInput
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const startedAt =
    parseDateTimeInput(draft.startedAtInput) ??
    segment?.startedAt ??
    new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const endedAt =
    parseDateTimeInput(draft.endedAtInput) ??
    segment?.endedAt ??
    new Date().toISOString();
  return {
    kind: draft.kind,
    startedAt,
    endedAt,
    title: draft.label.trim(),
    subtitle:
      draft.kind === "missing"
        ? "User-defined missing-data override."
        : "User-defined movement box.",
    placeLabel: draft.placeLabel.trim() || null,
    tags,
    distanceMeters:
      draft.kind === "trip" ? Math.max(segment?.trip?.distanceMeters ?? 150, 150) : null,
    averageSpeedMps: draft.kind === "trip" ? segment?.trip?.averageSpeedMps ?? null : null,
    metadata: { createdFrom: "movement-life-timeline" }
  };
}

export function resolveStayOverrideTitle(
  segment: MovementTimelineSegment,
  fallbackPlaceLabel: string
) {
  const recordedLabel =
    segment.kind === "stay" ? segment.stay?.label?.trim() ?? "" : "";
  if (recordedLabel) {
    return recordedLabel;
  }
  const title = segment.title.trim();
  if (title && title.toLowerCase() !== "stay") {
    return title;
  }
  return fallbackPlaceLabel.trim() || "Stay";
}

export function buildStayPlaceLabelOverridePayload(
  segment: MovementTimelineSegment,
  placeLabel: string
) {
  const draft = buildDraft(segment);
  const trimmedPlaceLabel = placeLabel.trim();
  return buildMovementUserBoxPayloadInput(
    {
      ...draft,
      label: resolveStayOverrideTitle(segment, trimmedPlaceLabel),
      placeLabel: trimmedPlaceLabel
    },
    segment
  );
}

export function segmentTimeBucket(value: string) {
  const hour = new Date(value).getHours();
  if (hour < 6) {
    return "night";
  }
  if (hour < 12) {
    return "morning";
  }
  if (hour < 18) {
    return "afternoon";
  }
  return "evening";
}

export function formatSegmentTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function buildMovementSegmentSearchText(segment: MovementTimelineSegment) {
  return normalizeSearchText(
    [
      segment.kind,
      displaySegmentTitle(segment),
      segment.subtitle,
      segment.placeLabel ?? "",
      ...segment.tags,
      formatSegmentTimestamp(segment.startedAt),
      formatSegmentTimestamp(segment.endedAt),
      segmentTimeBucket(segment.startedAt),
      hasRecordedStay(segment)
        ? segment.stay.place?.label ?? segment.stay.label
        : hasRecordedTrip(segment)
          ? [
              segment.trip.label,
              segment.trip.activityType,
              segment.trip.travelMode,
              segment.trip.startPlace?.label,
              segment.trip.endPlace?.label
            ]
              .filter(Boolean)
              .join(" ")
          : segment.kind === "trip"
            ? [segment.title, segment.subtitle, segment.placeLabel ?? ""]
                .filter(Boolean)
                .join(" ")
            : "missing data gap"
    ].join(" ")
  );
}

export function createMovementSegmentFilterOptions(
  segments: MovementTimelineSegment[]
): FacetedTokenOption[] {
  const options = new Map<string, FacetedTokenOption>();
  options.set("kind:stay", {
    id: "kind:stay",
    label: "Stay",
    description: "Stationary spans and place anchors."
  });
  options.set("kind:trip", {
    id: "kind:trip",
    label: "Move",
    description: "Trips and movement connectors."
  });
  for (const bucket of ["night", "morning", "afternoon", "evening"] as const) {
    options.set(`time:${bucket}`, {
      id: `time:${bucket}`,
      label: bucket[0]!.toUpperCase() + bucket.slice(1),
      description: "Filter by the segment start time."
    });
  }
  for (const segment of segments) {
    for (const tag of segment.tags) {
      options.set(`tag:${tag}`, {
        id: `tag:${tag}`,
        label: tag,
        description: "Movement tag"
      });
    }
    if (segment.placeLabel) {
      options.set(`place:${segment.placeLabel}`, {
        id: `place:${segment.placeLabel}`,
        label: segment.placeLabel,
        description: "Matched place"
      });
    }
  }
  return [...options.values()].sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

export function matchesMovementSegmentFilters(
  segment: MovementTimelineSegment,
  filterIds: string[]
) {
  return filterIds.every((filterId) => {
    if (filterId === "kind:stay" || filterId === "kind:trip") {
      return segment.kind === filterId.slice("kind:".length);
    }
    if (filterId.startsWith("time:")) {
      return segmentTimeBucket(segment.startedAt) === filterId.slice("time:".length);
    }
    if (filterId.startsWith("tag:")) {
      return segment.tags.includes(filterId.slice("tag:".length));
    }
    if (filterId.startsWith("place:")) {
      return (segment.placeLabel ?? "") === filterId.slice("place:".length);
    }
    return true;
  });
}

export function removeSegmentFromTimelinePages(
  data: { pages: Array<{ segments: MovementTimelineSegment[] }>; pageParams: unknown[] } | undefined,
  segmentId: string
) {
  if (!data) {
    return data;
  }
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      segments: page.segments.filter((segment) => segment.id !== segmentId)
    }))
  };
}

export function warpDisplayRatio(ratio: number, severity: number) {
  const eased =
    ratio + (Math.sin((ratio - 0.5) * Math.PI) + 1) * 0.5 - ratio;
  const centered = ratio - 0.5;
  const cubicCompression =
    centered * (1 - severity * 0.64) +
    centered * centered * centered * severity * 2.56;
  const warped = 0.5 + cubicCompression;
  return Math.max(0, Math.min(1, warped - (eased - ratio) * severity * 0.08));
}

export function timelineHourMarkerLabel(value: Date) {
  return value.getHours() === 0
    ? formatStickyDate(value.toISOString())
    : formatHourMarker(value);
}

export function segmentDisplayRatioAtHour(
  segment: MovementTimelineSegment,
  valueMs: number
) {
  const endMs = new Date(segment.endedAt).getTime();
  const startMs = new Date(segment.startedAt).getTime();
  const durationMs = Math.max(1, endMs - startMs);
  const rawRatio = Math.max(0, Math.min(1, (valueMs - startMs) / durationMs));
  if (segment.durationSeconds <= MAX_DISPLAY_SECONDS) {
    return rawRatio;
  }
  const compressionSeverity = Math.max(
    0,
    1 - Math.min(1, MAX_DISPLAY_SECONDS / Math.max(1, segment.durationSeconds))
  );
  return warpDisplayRatio(rawRatio, compressionSeverity);
}

export function timelineHourMarkerY(
  layout: MovementTimelineLayoutModel,
  hourMs: number,
  rangeEndMs: number
) {
  if (layout.items.length === 0) {
    return null;
  }

  const firstRow = layout.items[0]!;
  if (hourMs < new Date(firstRow.segment.startedAt).getTime()) {
    return (
      layout.historyHeaderHeight +
      layout.leadHeight -
      ((new Date(firstRow.segment.startedAt).getTime() - hourMs) / 3_600_000) *
        GRID_ROW_HEIGHT
    );
  }

  for (let index = 0; index < layout.items.length; index += 1) {
    const row = layout.items[index]!;
    const rowStartMs = new Date(row.segment.startedAt).getTime();
    const rowEndMs = new Date(row.segment.endedAt).getTime();
    if (hourMs >= rowStartMs && hourMs <= rowEndMs) {
      return row.boxTop + segmentDisplayRatioAtHour(row.segment, hourMs) * row.displayHeight;
    }

    const nextRow = layout.items[index + 1] ?? null;
    const gapEndMs = nextRow
      ? new Date(nextRow.segment.startedAt).getTime()
      : rangeEndMs;
    if (hourMs > rowEndMs && hourMs < gapEndMs) {
      return row.boxBottom + ((hourMs - rowEndMs) / 3_600_000) * GRID_ROW_HEIGHT;
    }
  }

  const lastRow = layout.items[layout.items.length - 1]!;
  const lastEndMs = new Date(lastRow.segment.endedAt).getTime();
  if (hourMs >= lastEndMs) {
    return (
      lastRow.boxBottom + ((hourMs - lastEndMs) / 3_600_000) * GRID_ROW_HEIGHT
    );
  }

  return null;
}

export function nextHourBoundaryMs(valueMs: number) {
  const hourStart = new Date(valueMs);
  hourStart.setMinutes(0, 0, 0);
  const hourMs = hourStart.getTime();
  return hourMs <= valueMs ? hourMs + 3_600_000 : hourMs;
}

export function buildTimelineHourMarkers(
  layout: MovementTimelineLayoutModel,
  rangeEndMs: number
) {
  const markers: TimelineHourMarker[] = [];
  if (layout.items.length === 0) {
    return markers;
  }

  const firstRow = layout.items[0]!;
  const firstStartMs = new Date(firstRow.segment.startedAt).getTime();
  for (
    let hourMs = nextHourBoundaryMs(firstStartMs - HISTORY_LEAD_HOURS * 3_600_000);
    hourMs <= rangeEndMs;
    hourMs += 3_600_000
  ) {
    const y = timelineHourMarkerY(layout, hourMs, rangeEndMs);
    if (y === null) {
      continue;
    }
    const hourDate = new Date(hourMs);
    markers.push({
      y,
      label: timelineHourMarkerLabel(hourDate),
      strong: hourDate.getHours() === 0
    });
  }

  return markers;
}

export function buildMovementTimelineLayoutModel({
  segments,
  viewportHeight,
  nowMs = Date.now()
}: {
  segments: MovementTimelineSegment[];
  viewportHeight: number;
  nowMs?: number;
}): MovementTimelineLayoutModel {
  const historyHeaderHeight = segments.length > 0 ? HISTORY_CAP_HEIGHT : 0;
  const leadHeight = segments.length > 0 ? GRID_ROW_HEIGHT * HISTORY_LEAD_HOURS : 0;
  let cursor = historyHeaderHeight + leadHeight;
  let previousEndedMs: number | null = null;
  const items = segments.map((segment) => {
    const displayHeight = segmentDisplayHeight(
      segment.durationSeconds,
      segment.kind,
      segment.syncSource
    );
    const startedAtMs = new Date(segment.startedAt).getTime();
    const gapBefore =
      previousEndedMs === null
        ? 0
        : Math.max(0, (startedAtMs - previousEndedMs) / 3_600_000) * GRID_ROW_HEIGHT;
    cursor += gapBefore;
    const boxTop = cursor;
    const boxBottom = boxTop + displayHeight;
    cursor = boxBottom;
    previousEndedMs = new Date(segment.endedAt).getTime();
    return {
      id: segment.id,
      segment,
      gapBefore,
      displayHeight,
      boxTop,
      boxBottom
    } satisfies TimelineItemLayoutMetric;
  });
  const rangeEndMs = nowMs + FUTURE_GRID_HOURS * 3_600_000;
  const futureTailHeight = (() => {
    const latestEndedAt = segments[segments.length - 1]?.endedAt;
    if (!latestEndedAt) {
      return GRID_ROW_HEIGHT * FUTURE_GRID_HOURS;
    }
    const latestEndedMs = new Date(latestEndedAt).getTime();
    return Math.max(
      GRID_ROW_HEIGHT * FUTURE_GRID_HOURS,
      ((rangeEndMs - latestEndedMs) / 3_600_000) * GRID_ROW_HEIGHT
    );
  })();
  const baseHeight =
    (items[items.length - 1]?.boxBottom ?? historyHeaderHeight + leadHeight) +
    futureTailHeight;
  const totalHeight = Math.max(
    baseHeight,
    viewportHeight > 0 ? viewportHeight + 260 : 960,
    historyHeaderHeight + leadHeight + futureTailHeight
  );
  const layout = {
    historyHeaderHeight,
    leadHeight,
    items,
    markers: [] as TimelineHourMarker[],
    rangeEndMs,
    futureTailHeight: futureTailHeight + Math.max(0, totalHeight - baseHeight),
    totalHeight
  } satisfies MovementTimelineLayoutModel;
  return {
    ...layout,
    markers: buildTimelineHourMarkers(layout, rangeEndMs)
  };
}
