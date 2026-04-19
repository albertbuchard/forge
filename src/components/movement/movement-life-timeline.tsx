import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUpRight,
  Database,
  MapPin,
  MoonStar,
  PencilLine,
  Route,
  Save,
  Trash2,
  X
} from "lucide-react";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import {
  FacetedTokenSearch,
  type FacetedTokenOption
} from "@/components/search/faceted-token-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/page-state";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import {
  createMovementUserBox,
  getMovementBoxDetail,
  createMovementPlace,
  deleteMovementUserBox,
  getMovementTimeline,
  invalidateAutomaticMovementBox,
  listMovementPlaces,
  patchMovementStay,
  preflightMovementUserBox,
  patchMovementUserBox
} from "@/lib/api";
import type {
  MovementBoxDetailCoordinate,
  MovementBoxDetailData,
  MovementKnownPlace,
  MovementTimelineLaneSide,
  MovementTimelineSegment,
  MovementTimelineSleepOverlay,
  MovementUserBoxPreflight
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  MovementPlaceEditorDialog,
  type MovementPlaceDraftSeed
} from "@/components/movement/movement-place-editor-dialog";
import {
  applySleepOverlayToMovementSegments,
  isSleepOverlaySegment
} from "@/components/movement/movement-sleep-overlay";

const TIMELINE_PAGE_SIZE = 24;
const GRID_ROW_HEIGHT = 64;
const MAX_DISPLAY_SECONDS = 6 * 60 * 60;
const HISTORY_LEAD_HOURS = 5;
const CENTER_PADDING = GRID_ROW_HEIGHT * HISTORY_LEAD_HOURS;
const FUTURE_GRID_HOURS = 1;
const SEGMENT_BOX_TOP = 32;

type MovementLifeTimelineProps = {
  userIds?: string[];
};

type TimelineDraft = {
  kind: MovementTimelineSegment["kind"];
  label: string;
  placeLabel: string;
  tagsInput: string;
  startedAtInput: string;
  endedAtInput: string;
};

type TimelineRowMetric = {
  segment: MovementTimelineSegment;
  rowStart: number;
  rowHeight: number;
  displayHeight: number;
  boxTop: number;
  boxBottom: number;
};

function normalizeSearchText(text: string) {
  return text.trim().toLowerCase();
}

function formatDurationLabel(durationSeconds: number) {
  if (durationSeconds >= 86_400) {
    return `${Math.round(durationSeconds / 3_600)}h`;
  }
  if (durationSeconds >= 3_600) {
    return `${(durationSeconds / 3_600).toFixed(1)}h`;
  }
  return `${Math.max(1, Math.round(durationSeconds / 60))}m`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatStickyDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  }).format(new Date(value));
}

function formatHourMarker(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    hour12: false
  }).format(value);
}

function formatDateTimeInput(value: string) {
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

function parseDateTimeInput(value: string) {
  if (!value.trim()) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function distanceLabel(distanceMeters: number) {
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(distanceMeters)} m`;
}

function compactTimeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function shortLatLngLabel(latitude: number, longitude: number) {
  return `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
}

function exactLatLngLabel(latitude: number, longitude: number) {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function formatDurationMinutes(seconds: number) {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function normalizeDetailMapPoints(points: MovementBoxDetailCoordinate[]) {
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

function movementPlaceSeedFromSegment(
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

function resolveSegmentPlaceLabel(segment: MovementTimelineSegment | null) {
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

function distanceBetweenCoordinates(
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

function buildMovementPlaceSearchText(place: MovementKnownPlace) {
  return normalizeSearchText([place.label, ...place.aliases].join(" "));
}

function hasRecordedTrip(
  segment: MovementTimelineSegment
): segment is Extract<MovementTimelineSegment, { kind: "trip" }> & {
  trip: NonNullable<Extract<MovementTimelineSegment, { kind: "trip" }>["trip"]>;
} {
  return segment.kind === "trip" && segment.trip !== null;
}

function hasRecordedStay(
  segment: MovementTimelineSegment
): segment is Extract<MovementTimelineSegment, { kind: "stay" }> & {
  stay: NonNullable<Extract<MovementTimelineSegment, { kind: "stay" }>["stay"]>;
} {
  return segment.kind === "stay" && segment.stay !== null;
}

function resolveTripEndpoint(
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

function isGenericTripTitle(title: string) {
  const normalized = title.trim().toLowerCase();
  return normalized === "travel" || normalized === "trip" || normalized === "move";
}

function normalizeMissingSegmentTitle(segment: Extract<MovementTimelineSegment, { kind: "missing" }>) {
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

function resolveStayDisplayTitle(
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

function displaySegmentTitle(segment: MovementTimelineSegment) {
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
    return `${start} → ${end}`;
  }
  return segment.title;
}

function displaySegmentBadge(segment: MovementTimelineSegment) {
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

function lanePercent(side: MovementTimelineLaneSide | "center") {
  if (side === "left") {
    return 24;
  }
  if (side === "right") {
    return 76;
  }
  return 50;
}

function segmentDisplayHeight(
  durationSeconds: number,
  kind: MovementTimelineSegment["kind"],
  syncSource?: string
) {
  const cappedHours = Math.min(durationSeconds, MAX_DISPLAY_SECONDS) / 3600;
  const isSleep = syncSource === "sleep overlay";
  const minHeight = isSleep ? 144 : kind === "stay" ? 132 : 124;
  const maxHeight = isSleep ? 364 : kind === "stay" ? 404 : 328;
  const height = minHeight + cappedHours * 44;
  return Math.max(minHeight, Math.min(maxHeight, height));
}

function rowHeightForSegment(segment: MovementTimelineSegment) {
  return Math.max(
    250,
    segmentDisplayHeight(segment.durationSeconds, segment.kind, segment.syncSource) + 130
  );
}

function buildDraft(segment: MovementTimelineSegment): TimelineDraft {
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

function buildNewDraft(
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

function buildMovementUserBoxPayloadInput(
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

function resolveStayOverrideTitle(
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

function buildStayPlaceLabelOverridePayload(
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

function segmentTimeBucket(value: string) {
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

function formatSegmentTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function buildMovementSegmentSearchText(segment: MovementTimelineSegment) {
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

function createMovementSegmentFilterOptions(
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

function matchesMovementSegmentFilters(
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

function removeSegmentFromTimelinePages(
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

function warpDisplayRatio(ratio: number, severity: number) {
  const eased =
    ratio + (Math.sin((ratio - 0.5) * Math.PI) + 1) * 0.5 - ratio;
  const centered = ratio - 0.5;
  const cubicCompression = centered * (1 - severity * 0.64) + centered * centered * centered * severity * 2.56;
  const warped = 0.5 + cubicCompression;
  return Math.max(0, Math.min(1, warped - (eased - ratio) * severity * 0.08));
}

function buildHourMarkers(segment: MovementTimelineSegment) {
  const endMs = new Date(segment.endedAt).getTime();
  const startMs = new Date(segment.startedAt).getTime();
  const durationMs = Math.max(1, endMs - startMs);
  const markers = new Map<number, { ratio: number; label: string; strong: boolean }>();
  let hourCursor = new Date(startMs);
  hourCursor.setMinutes(0, 0, 0);
  if (hourCursor.getTime() <= startMs) {
    hourCursor = new Date(hourCursor.getTime() + 3_600_000);
  }
  while (hourCursor.getTime() < endMs) {
    const timeMs = hourCursor.getTime();
    const ratio = Math.min(1, Math.max(0, (timeMs - startMs) / durationMs));
    markers.set(timeMs, {
      ratio,
      label: hourCursor.getHours() === 0
        ? formatStickyDate(hourCursor.toISOString())
        : formatHourMarker(hourCursor),
      strong: hourCursor.getHours() === 0
    });
    hourCursor = new Date(timeMs + 3_600_000);
  }
  return [...markers.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, marker]) => marker);
}

function nextHourBoundaryMs(valueMs: number) {
  const hourStart = new Date(valueMs);
  hourStart.setMinutes(0, 0, 0);
  const hourMs = hourStart.getTime();
  return hourMs <= valueMs ? hourMs + 3_600_000 : hourMs;
}

function buildTimelineHourMarkers(
  rows: TimelineRowMetric[],
  rangeEndMs: number
) {
  const markers: Array<{ y: number; label: string; strong: boolean }> = [];
  if (rows.length === 0) {
    return markers;
  }

  const firstRow = rows[0]!;
  const firstStartMs = new Date(firstRow.segment.startedAt).getTime();
  for (
    let hourMs = nextHourBoundaryMs(firstStartMs - HISTORY_LEAD_HOURS * 3_600_000);
    hourMs < firstStartMs;
    hourMs += 3_600_000
  ) {
    const y =
      firstRow.boxTop - ((firstStartMs - hourMs) / 3_600_000) * GRID_ROW_HEIGHT;
    const hourDate = new Date(hourMs);
    markers.push({
      y,
      label:
        hourDate.getHours() === 0
          ? formatStickyDate(hourDate.toISOString())
          : formatHourMarker(hourDate),
      strong: hourDate.getHours() === 0
    });
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const segment = row.segment;
    const durationMs = Math.max(
      1,
      new Date(segment.endedAt).getTime() - new Date(segment.startedAt).getTime()
    );
    const compressionSeverity = Math.max(
      0,
      1 - Math.min(1, MAX_DISPLAY_SECONDS / Math.max(1, segment.durationSeconds))
    );
    for (const marker of buildHourMarkers(segment)) {
      const displayRatio =
        segment.durationSeconds > MAX_DISPLAY_SECONDS
          ? warpDisplayRatio(marker.ratio, compressionSeverity)
          : marker.ratio;
      markers.push({
        y: row.boxTop + displayRatio * row.displayHeight,
        label: marker.label,
        strong: marker.strong
      });
    }

    const nextRow = rows[index + 1] ?? null;
    if (nextRow) {
      const gapStartMs = new Date(segment.endedAt).getTime();
      const gapEndMs = new Date(nextRow.segment.startedAt).getTime();
      const gapDurationMs = gapEndMs - gapStartMs;
      if (gapDurationMs > 0) {
        for (
          let hourMs = nextHourBoundaryMs(gapStartMs);
          hourMs < gapEndMs;
          hourMs += 3_600_000
        ) {
          const ratio = (hourMs - gapStartMs) / gapDurationMs;
          const y = row.boxBottom + (nextRow.boxTop - row.boxBottom) * ratio;
          const hourDate = new Date(hourMs);
          markers.push({
            y,
            label:
              hourDate.getHours() === 0
                ? formatStickyDate(hourDate.toISOString())
                : formatHourMarker(hourDate),
            strong: hourDate.getHours() === 0
          });
        }
      }
      continue;
    }

    const lastEndMs = new Date(segment.endedAt).getTime();
    for (
      let hourMs = nextHourBoundaryMs(lastEndMs);
      hourMs <= rangeEndMs;
      hourMs += 3_600_000
    ) {
      const y = row.boxBottom + ((hourMs - lastEndMs) / 3_600_000) * GRID_ROW_HEIGHT;
      const hourDate = new Date(hourMs);
      markers.push({
        y,
        label:
          hourDate.getHours() === 0
            ? formatStickyDate(hourDate.toISOString())
            : formatHourMarker(hourDate),
        strong: hourDate.getHours() === 0
      });
    }
  }

  return markers.sort((left, right) => left.y - right.y);
}

function MovementTimelineViewportGrid({
  rows,
  totalHeight,
  scrollTop,
  viewportHeight
}: {
  rows: TimelineRowMetric[];
  totalHeight: number;
  scrollTop: number;
  viewportHeight: number;
}) {
  const rangeEndMs = Date.now() + FUTURE_GRID_HOURS * 3_600_000;
  const markers = buildTimelineHourMarkers(rows, rangeEndMs);
  const overscan = GRID_ROW_HEIGHT * 6;
  const visibleStart = Math.max(0, scrollTop - overscan);
  const visibleEnd = Math.min(
    totalHeight,
    scrollTop + Math.max(viewportHeight, GRID_ROW_HEIGHT * 8) + overscan
  );
  const visibleMarkers = markers.filter(
    (marker) => marker.y >= visibleStart && marker.y <= visibleEnd
  );

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden rounded-[30px]"
      style={{ height: `${totalHeight}px` }}
    >
      <div className="absolute inset-y-0 left-0 w-18 bg-[linear-gradient(90deg,rgba(7,12,22,0.96),rgba(7,12,22,0.42),transparent)]" />
      {visibleMarkers.map((marker, index) => {
        return (
          <div
            key={`timeline-grid-${index}`}
            className="absolute inset-x-0"
            style={{ top: `${marker.y}px` }}
          >
            <div
              className={cn(
                "border-t",
                marker.strong ? "border-white/14" : "border-white/7"
              )}
            />
            <div
              className={cn(
                "absolute left-3 top-0 -translate-y-1/2 font-label text-[9px] tracking-[0.24em]",
                marker.strong ? "text-white/38" : "text-white/22"
              )}
            >
              {marker.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MovementTripConnector({
  fromSide,
  toSide,
  height,
  emphasized
}: {
  fromSide: MovementTimelineLaneSide | "center";
  toSide: MovementTimelineLaneSide | "center";
  height: number;
  emphasized: boolean;
}) {
  const startX = lanePercent(fromSide);
  const endX = lanePercent(toSide);
  const curve = `M ${startX} 16 C ${startX} ${Math.max(
    40,
    height * 0.26
  )}, ${endX} ${Math.max(70, height * 0.72)}, ${endX} ${height - 18}`;

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      className="absolute inset-x-0 top-0 h-full w-full overflow-visible"
      preserveAspectRatio="none"
    >
      <path
        d={curve}
        fill="none"
        stroke={emphasized ? "rgba(241,246,255,0.18)" : "rgba(241,246,255,0.11)"}
        strokeWidth={emphasized ? "1.05" : "0.85"}
        strokeDasharray={emphasized ? "3 10" : "2.5 12"}
        strokeLinecap="round"
      />
      <circle cx={startX} cy="16" r="1.5" fill="rgba(255,255,255,0.26)" />
      <circle cx={endX} cy={height - 18} r="1.5" fill="rgba(255,255,255,0.26)" />
    </svg>
  );
}

function MovementStayHandle({
  position
}: {
  position: "top" | "bottom";
}) {
  return (
    <div
      className={cn(
        "absolute left-1/2 z-20 flex -translate-x-1/2 items-center justify-center",
        position === "top" ? "-top-3" : "-bottom-3"
      )}
    >
      <div className="h-6 w-[3px] rounded-full bg-[rgba(160,224,255,0.92)] shadow-[0_0_14px_rgba(126,229,255,0.36)]" />
    </div>
  );
}

function MovementTimelineHistoryCap({
  segment
}: {
  segment: MovementTimelineSegment | null;
}) {
  const knownLabel =
    segment?.kind === "stay"
      ? segment.placeLabel || segment.title || null
      : segment?.kind === "trip"
        ? resolveTripEndpoint(segment, "start", {
            includeCoordinates: false,
            useHistoryAnchorFallback: true
          }).label
        : null;
  const label = knownLabel || "Beginning of time";

  return (
    <div className="pointer-events-none flex justify-center px-6 py-4">
      <div className="relative w-[min(18rem,calc(100vw-6rem))] overflow-hidden rounded-[26px] border border-[rgba(152,208,255,0.2)] bg-[linear-gradient(180deg,rgba(98,130,238,0.14),rgba(18,34,79,0.14))] shadow-[0_20px_48px_rgba(3,8,20,0.3)]">
        <MovementStayHandle position="bottom" />
        <div className="relative z-10 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <Badge tone="signal" className="bg-white/10 text-white/78">
              Start
            </Badge>
            <div className="font-label text-[10px] uppercase tracking-[0.2em] text-white/28">
              Beginning of history
            </div>
          </div>
          <div className="mt-5 font-display text-[1.25rem] tracking-[-0.05em] text-white">
            {label}
          </div>
          <div className="mt-2 font-label text-[10px] uppercase tracking-[0.22em] text-white/30">
            {knownLabel ? "Oldest loaded known stay" : "Earliest known anchor"}
          </div>
        </div>
      </div>
    </div>
  );
}

function MovementTimelineDetailCard({
  segment,
  onEdit,
  onOpenDetail,
  onDefinePlace
}: {
  segment: MovementTimelineSegment;
  onEdit: () => void;
  onOpenDetail: () => void;
  onDefinePlace: () => void;
}) {
  const sleepOverlay = isSleepOverlaySegment(segment);
  return (
    <Card className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,14,26,0.98),rgba(5,9,19,0.95))] p-5 shadow-[0_24px_74px_rgba(0,0,0,0.34)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/40">
            {sleepOverlay
              ? "Sleep overlay"
              : segment.kind === "stay"
              ? "Stay detail"
              : segment.kind === "trip"
                ? "Move detail"
                : "Missing data"}
          </div>
          <div className="mt-2 text-lg text-white">{displaySegmentTitle(segment)}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge
              className={
                sleepOverlay
                  ? "bg-cyan-400/14 text-cyan-100"
                  : segment.sourceKind === "user_defined"
                  ? "bg-fuchsia-400/12 text-fuchsia-100"
                  : "bg-white/[0.06] text-white/70"
              }
            >
              {sleepOverlay
                ? "Virtual"
                : segment.sourceKind === "user_defined"
                ? segment.origin === "user_invalidated"
                  ? "User invalidated"
                  : "User-defined"
                : "Automatic"}
            </Badge>
            {segment.overrideCount > 0 ? (
              <Badge className="bg-amber-400/10 text-amber-100">
                Overrides {segment.overrideCount} automatic box{segment.overrideCount === 1 ? "" : "es"}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={onOpenDetail}
            variant="ghost"
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 text-white/78 hover:bg-white/[0.08]"
            disabled={sleepOverlay}
          >
            Details
          </Button>
          <Button
            onClick={onEdit}
            variant="ghost"
            className="size-9 rounded-full border border-white/10 bg-white/[0.04] text-white/78 hover:bg-white/[0.08]"
            aria-label="Edit movement segment"
            disabled={sleepOverlay || segment.kind === "missing" || !segment.editable}
          >
            <PencilLine className="size-4" />
          </Button>
          <ArrowUpRight className="size-4 text-white/42" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[18px] border border-white/8 bg-white/[0.03] p-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
            Started
          </div>
          <div className="mt-2 text-sm text-white/82">
            {formatDateTime(segment.startedAt)}
          </div>
        </div>
        <div className="rounded-[18px] border border-white/8 bg-white/[0.03] p-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
            Ended
          </div>
          <div className="mt-2 text-sm text-white/82">
            {formatDateTime(segment.endedAt)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone="signal">{formatDurationLabel(segment.durationSeconds)}</Badge>
        {hasRecordedTrip(segment) ? (
          <>
            <Badge className="bg-white/[0.08] text-white/74">
              {distanceLabel(segment.trip.distanceMeters)}
            </Badge>
            {segment.trip.stops.length > 0 ? (
              <Badge className="bg-white/[0.08] text-white/74">
                {segment.trip.stops.length} stop{segment.trip.stops.length === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </>
        ) : null}
        {sleepOverlay ? (
          <Badge className="bg-cyan-400/12 text-cyan-50">
            {segment.subtitle}
          </Badge>
        ) : resolveSegmentPlaceLabel(segment) ? (
          <Badge className="bg-white/[0.08] text-white/74">
            {resolveSegmentPlaceLabel(segment)}
          </Badge>
        ) : null}
      </div>

      {hasRecordedStay(segment) && !sleepOverlay ? (
        <div className="mt-4 rounded-[18px] border border-sky-300/14 bg-sky-300/8 p-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-sky-100/66">
            Location label
          </div>
          <div className="mt-2 text-sm leading-6 text-sky-50/86">
            {segment.stay.place
              ? `This stay is currently linked to ${segment.stay.place.label}. Search saved places or relabel it from this stay center.`
              : "Search saved places for this stay, or create a new one from the stay center so later matching stays inherit it automatically."}
          </div>
          <div className="mt-3">
            <Button
              onClick={onDefinePlace}
              variant="ghost"
              className="rounded-full border border-sky-300/24 bg-sky-300/12 px-4 text-sky-50 hover:bg-sky-300/18"
            >
              Label location
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3">
        <div className="rounded-[18px] border border-white/8 bg-white/[0.03] p-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
            Timeline summary
          </div>
          <div className="mt-2 text-sm leading-6 text-white/76">
            {segment.kind === "stay"
              ? sleepOverlay
                ? `Sleep overlay from ${compactTimeLabel(segment.startedAt)} to ${compactTimeLabel(segment.endedAt)}. Underlying movement boxes are sliced virtually while this overlay is visible.`
                : `Stay block from ${compactTimeLabel(segment.startedAt)} to ${compactTimeLabel(segment.endedAt)}.`
              : segment.kind === "trip"
                ? `Connector from ${resolveTripEndpoint(segment, "start").label} to ${resolveTripEndpoint(segment, "end").label}.`
                : `No reliable movement signal reached Forge from ${compactTimeLabel(segment.startedAt)} to ${compactTimeLabel(segment.endedAt)}.`}
          </div>
        </div>
        <div className="rounded-[18px] border border-white/8 bg-white/[0.03] p-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
            Projection model
          </div>
          <div className="mt-2 text-sm leading-6 text-white/76">
            {sleepOverlay
              ? "This sleep layer is visual only. Forge does not persist these split boxes; it temporarily slices the visible movement boxes around each sleep interval."
              : "Raw phone measurements stay immutable. Forge derives automatic boxes from that raw movement evidence, then overlays user-defined boxes on top without mutating the imported raw data."}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge className="bg-white/[0.08] text-white/74">
              Raw stays {segment.rawStayIds.length}
            </Badge>
            <Badge className="bg-white/[0.08] text-white/74">
              Raw trips {segment.rawTripIds.length}
            </Badge>
            <Badge className="bg-white/[0.08] text-white/74">
              Raw points {segment.rawPointCount}
            </Badge>
            {segment.hasLegacyCorrections ? (
              <Badge className="bg-amber-400/10 text-amber-100">
                Legacy corrections present
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-white/56">
        {sleepOverlay ? (
          <>
            <MoonStar className="size-4 text-cyan-300" />
            Sleep overlay
          </>
        ) : hasRecordedStay(segment) ? (
          <>
            <MapPin className="size-4 text-[var(--primary)]" />
            {segment.stay.place?.label ?? "No canonical place linked yet"}
          </>
        ) : hasRecordedTrip(segment) ? (
          <>
            <Route className="size-4 text-[var(--primary)]" />
            {segment.trip.activityType || segment.trip.travelMode}
          </>
        ) : segment.kind === "trip" ? (
          <>
            <Route className="size-4 text-[var(--primary)]" />
            Repaired movement connector
          </>
        ) : (
          <>
            <Database className="size-4 text-white/56" />
            Missing intervals are synthesized from long signal gaps instead of inventing fake travel.
          </>
        )}
      </div>
    </Card>
  );
}

function MovementDetailMap({
  title,
  points,
  averagePoint
}: {
  title: string;
  points: MovementBoxDetailCoordinate[];
  averagePoint?: MovementBoxDetailCoordinate | null;
}) {
  const normalized = normalizeDetailMapPoints(
    averagePoint ? [...points, averagePoint] : points
  );
  const baseCount = averagePoint ? normalized.length - 1 : normalized.length;
  const pathPoints = normalized.slice(0, baseCount);
  const average = averagePoint ? normalized[normalized.length - 1] ?? null : null;
  const path = pathPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  return (
    <Card className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,13,25,0.95),rgba(10,17,30,0.88))] p-5">
      <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
        {title}
      </div>
      <div className="mt-2 text-sm text-white/62">
        Relative coordinates normalized into one view so we can inspect the actual captured stay or trip geometry in one glance.
      </div>
      <div className="mt-5 rounded-[24px] border border-white/8 bg-[rgba(255,255,255,0.03)] p-3">
        <svg viewBox="0 0 100 100" className="h-52 w-full">
          <rect x="0" y="0" width="100" height="100" rx="18" fill="rgba(255,255,255,0.02)" />
          {pathPoints.length > 1 ? (
            <path d={path} fill="none" stroke="rgba(92,225,230,0.95)" strokeWidth="1.6" />
          ) : null}
          {pathPoints.map((point, index) => (
            <circle
              key={point.id}
              cx={point.x}
              cy={point.y}
              r={index === 0 || index === pathPoints.length - 1 ? 2.2 : 1.4}
              fill={index === 0 || index === pathPoints.length - 1 ? "#ffffff" : "rgba(92,225,230,0.9)"}
            />
          ))}
          {average ? (
            <>
              <circle cx={average.x} cy={average.y} r={3} fill="rgba(255,208,88,0.95)" />
              <circle
                cx={average.x}
                cy={average.y}
                r={6}
                fill="none"
                stroke="rgba(255,208,88,0.48)"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
            </>
          ) : null}
        </svg>
      </div>
    </Card>
  );
}

function MovementTimelineDetailDialog({
  open,
  onOpenChange,
  segment,
  detail,
  loading,
  onEdit,
  onDefinePlace
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segment: MovementTimelineSegment | null;
  detail: MovementBoxDetailData | null;
  loading: boolean;
  onEdit: () => void;
  onDefinePlace: () => void;
}) {
  const activeSegment = detail?.segment ?? segment;
  const stayDetail = detail?.stayDetail ?? null;
  const tripDetail = detail?.tripDetail ?? null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(3,7,18,0.74)] backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[6vh] z-50 max-h-[88vh] w-[min(60rem,calc(100vw-1.25rem))] -translate-x-1/2 overflow-y-auto rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,14,28,0.98),rgba(10,16,30,0.95))] p-5 shadow-[0_32px_90px_rgba(0,0,0,0.45)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="font-display text-[1.3rem] tracking-[-0.05em] text-white">
                {activeSegment ? `${displaySegmentTitle(activeSegment)} details` : "Movement details"}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-white/62">
                Inspect the canonical box, the raw movement evidence behind it, and the exact coordinates Forge used to assemble this stay or trip.
              </Dialog.Description>
            </div>
            <div className="flex items-center gap-2">
              {activeSegment ? (
                <Button
                  onClick={onEdit}
                  variant="ghost"
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 text-white/78 hover:bg-white/[0.08]"
                  disabled={!activeSegment.editable || activeSegment.kind === "missing"}
                >
                  <PencilLine className="size-4" />
                  Edit
                </Button>
              ) : null}
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/64 transition hover:bg-white/[0.08] hover:text-white"
                >
                  <ArrowUpRight className="size-4 rotate-45" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {loading ? (
            <div className="mt-6 rounded-[22px] border border-white/8 bg-white/[0.03] p-5 text-sm text-white/62">
              Loading the canonical box detail and raw movement evidence…
            </div>
          ) : activeSegment ? (
            <div className="mt-6 grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Started</div>
                  <div className="mt-2 text-sm text-white">{formatDateTime(activeSegment.startedAt)}</div>
                </Card>
                <Card className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Ended</div>
                  <div className="mt-2 text-sm text-white">{formatDateTime(activeSegment.endedAt)}</div>
                </Card>
                <Card className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Duration</div>
                  <div className="mt-2 text-sm text-white">{formatDurationLabel(activeSegment.durationSeconds)}</div>
                </Card>
                <Card className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/38">Raw coverage</div>
                  <div className="mt-2 text-sm text-white">
                    {activeSegment.rawStayIds.length} stays · {activeSegment.rawTripIds.length} trips · {activeSegment.rawPointCount} points
                  </div>
                </Card>
              </div>

              {stayDetail ? (
                <>
                  <Card className="rounded-[22px] border border-sky-300/14 bg-sky-300/8 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-sky-100/66">Location label</div>
                    <div className="mt-2 text-sm leading-6 text-sky-50/86">
                      {stayDetail.canonicalPlace
                        ? `This stay is linked to ${stayDetail.canonicalPlace.label}. Search a different saved place or relabel it from the stay center.`
                        : "This stay has no saved place yet. Search known locations first, or create a new place directly from the stay center."}
                    </div>
                    <div className="mt-3">
                      <Button
                        onClick={onDefinePlace}
                        variant="ghost"
                        className="rounded-full border border-sky-300/24 bg-sky-300/12 px-4 text-sky-50 hover:bg-sky-300/18"
                      >
                        Label location
                      </Button>
                    </div>
                  </Card>
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                    <MovementDetailMap
                      title="Stay positions"
                      points={stayDetail.positions}
                      averagePoint={stayDetail.averagePosition}
                    />
                    <Card className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
                      <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">Stay metrics</div>
                      <div className="mt-4 grid gap-3">
                        <div className="text-sm text-white/78">
                          Canonical place: {stayDetail.canonicalPlace?.label ?? "Not linked yet"}
                        </div>
                        <div className="text-sm text-white/78">
                          Average position: {stayDetail.averagePosition ? exactLatLngLabel(stayDetail.averagePosition.latitude, stayDetail.averagePosition.longitude) : "Unavailable"}
                        </div>
                        <div className="text-sm text-white/78">
                          Radius: {stayDetail.radiusMeters != null ? distanceLabel(stayDetail.radiusMeters) : "Unavailable"}
                        </div>
                        <div className="text-sm text-white/78">Samples: {stayDetail.sampleCount}</div>
                        <div className="rounded-[18px] border border-white/8 bg-black/10 p-3">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">Exact positions</div>
                          <div className="mt-3 grid gap-2">
                            {stayDetail.positions.map((position, index) => (
                              <div key={`${position.recordedAt ?? "stay"}-${index}`} className="text-sm text-white/74">
                                {position.label ?? `Position ${index + 1}`}: {exactLatLngLabel(position.latitude, position.longitude)}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </Card>
                  </div>
                </>
              ) : null}

              {tripDetail ? (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                  <MovementDetailMap title="Travel map" points={tripDetail.positions} />
                  <Card className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
                    <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">Trip metrics</div>
                    <div className="mt-4 grid gap-3">
                      <div className="text-sm text-white/78">
                        Start position: {tripDetail.startPosition ? exactLatLngLabel(tripDetail.startPosition.latitude, tripDetail.startPosition.longitude) : "Unavailable"}
                      </div>
                      <div className="text-sm text-white/78">
                        End position: {tripDetail.endPosition ? exactLatLngLabel(tripDetail.endPosition.latitude, tripDetail.endPosition.longitude) : "Unavailable"}
                      </div>
                      <div className="text-sm text-white/78">Distance: {distanceLabel(tripDetail.totalDistanceMeters)}</div>
                      <div className="text-sm text-white/78">Moving time: {formatDurationMinutes(tripDetail.movingSeconds)}</div>
                      <div className="text-sm text-white/78">Idle time: {formatDurationMinutes(tripDetail.idleSeconds)}</div>
                      <div className="text-sm text-white/78">
                        Average speed: {tripDetail.averageSpeedMps != null ? `${tripDetail.averageSpeedMps.toFixed(2)} m/s` : "Unavailable"}
                      </div>
                      <div className="text-sm text-white/78">
                        Max speed: {tripDetail.maxSpeedMps != null ? `${tripDetail.maxSpeedMps.toFixed(2)} m/s` : "Unavailable"}
                      </div>
                      <div className="text-sm text-white/78">Stops: {tripDetail.stopCount}</div>
                    </div>
                  </Card>
                </div>
              ) : null}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MovementStayPlaceLabelDialog({
  open,
  onOpenChange,
  segment,
  places,
  loading,
  onSelectPlace,
  onCreatePlace
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segment: MovementTimelineSegment | null;
  places: MovementKnownPlace[];
  loading: boolean;
  onSelectPlace: (place: MovementKnownPlace) => Promise<boolean>;
  onCreatePlace: (segment: MovementTimelineSegment, labelHint: string) => void;
}) {
  const seed = segment ? movementPlaceSeedFromSegment(segment) : null;
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    setQuery(resolveSegmentPlaceLabel(segment) ?? "");
  }, [open, segment]);

  const filteredPlaces = useMemo(() => {
    if (!seed) {
      return [];
    }
    const normalizedQuery = normalizeSearchText(query);
    return [...places]
      .filter((place) =>
        normalizedQuery.length === 0
          ? true
          : buildMovementPlaceSearchText(place).includes(normalizedQuery)
      )
      .sort((left, right) => {
        const leftLabel = normalizeSearchText(left.label);
        const rightLabel = normalizeSearchText(right.label);
        const leftStartsWith =
          normalizedQuery.length > 0 && leftLabel.startsWith(normalizedQuery);
        const rightStartsWith =
          normalizedQuery.length > 0 && rightLabel.startsWith(normalizedQuery);
        if (leftStartsWith !== rightStartsWith) {
          return leftStartsWith ? -1 : 1;
        }
        const leftDistance = distanceBetweenCoordinates(
          seed.latitude,
          seed.longitude,
          left.latitude,
          left.longitude
        );
        const rightDistance = distanceBetweenCoordinates(
          seed.latitude,
          seed.longitude,
          right.latitude,
          right.longitude
        );
        if (Math.abs(leftDistance - rightDistance) > 1) {
          return leftDistance - rightDistance;
        }
        return left.label.localeCompare(right.label);
      })
      .slice(0, 6);
  }, [places, query, seed]);

  const normalizedQuery = normalizeSearchText(query);
  const exactMatchExists = filteredPlaces.some(
    (place) => normalizeSearchText(place.label) === normalizedQuery
  );
  const currentLabel = resolveSegmentPlaceLabel(segment);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(3,7,18,0.74)] backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[8vh] z-50 max-h-[84vh] w-[min(38rem,calc(100vw-1.25rem))] -translate-x-1/2 overflow-y-auto rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,14,28,0.98),rgba(10,16,30,0.95))] p-5 shadow-[0_32px_90px_rgba(0,0,0,0.45)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="font-display text-[1.3rem] tracking-[-0.05em] text-white">
                Label stay location
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-white/62">
                Search saved locations by name first. If this stay is new, create a location from the
                stay center with latitude and longitude already filled in.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/64 transition hover:bg-white/[0.08] hover:text-white"
                aria-label="Close location label dialog"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          {seed ? (
            <div className="mt-5 rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="signal">Stay center</Badge>
                {currentLabel ? (
                  <Badge className="bg-white/[0.08] text-white/74">{currentLabel}</Badge>
                ) : null}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[18px] border border-white/8 bg-black/10 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
                    Latitude
                  </div>
                  <div className="mt-1 text-sm text-white/82">{seed.latitude.toFixed(6)}</div>
                </div>
                <div className="rounded-[18px] border border-white/8 bg-black/10 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
                    Longitude
                  </div>
                  <div className="mt-1 text-sm text-white/82">{seed.longitude.toFixed(6)}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-[22px] border border-amber-300/14 bg-amber-300/8 p-4 text-sm text-amber-50/86">
              Forge can only label stays that already have a recorded stay center.
            </div>
          )}

          <div className="mt-5 grid gap-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type a location name or create a new one"
            />
            <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
                Known places
              </div>
              {loading ? (
                <div className="mt-3 text-sm text-white/58">Loading saved places…</div>
              ) : filteredPlaces.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {filteredPlaces.map((place) => {
                    const radialDistance =
                      seed == null
                        ? null
                        : distanceBetweenCoordinates(
                            seed.latitude,
                            seed.longitude,
                            place.latitude,
                            place.longitude
                          );
                    return (
                      <button
                        key={place.id}
                        type="button"
                        onClick={() =>
                          void onSelectPlace(place).then((assigned) => {
                            if (assigned) {
                              onOpenChange(false);
                            }
                          })
                        }
                        className="rounded-[18px] border border-white/8 bg-black/10 px-4 py-3 text-left transition hover:border-[var(--primary)]/40 hover:bg-white/[0.05]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm text-white">{place.label}</div>
                          {radialDistance != null ? (
                            <Badge className="bg-white/[0.08] text-white/70">
                              {distanceLabel(radialDistance)} away
                            </Badge>
                          ) : null}
                        </div>
                        {(place.aliases.length > 0 || place.categoryTags.length > 0) ? (
                          <div className="mt-1 text-xs text-white/52">
                            {[...place.aliases, ...place.categoryTags].join(" · ")}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 text-sm text-white/58">
                  No saved place matches this stay yet.
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="border border-white/10 bg-white/[0.04]"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!segment || !seed) {
                  return;
                }
                onCreatePlace(segment, exactMatchExists ? "" : query.trim());
              }}
              disabled={!segment || !seed}
            >
              {normalizedQuery.length > 0 && !exactMatchExists
                ? `Create "${query.trim()}"`
                : "Create new location"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MovementTimelineEditDialog({
  open,
  segment,
  draft,
  creating,
  saving,
  preflight,
  preflightLoading,
  onDraftChange,
  onFitMissing,
  onSave,
  onOpenChange
}: {
  open: boolean;
  segment: MovementTimelineSegment | null;
  draft: TimelineDraft | null;
  creating: boolean;
  saving: boolean;
  preflight: MovementUserBoxPreflight | null;
  preflightLoading: boolean;
  onDraftChange: (draft: TimelineDraft) => void;
  onFitMissing: () => void;
  onSave: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(3,7,18,0.74)] backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[8vh] z-50 w-[min(34rem,calc(100vw-1.25rem))] -translate-x-1/2 rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,14,28,0.98),rgba(10,16,30,0.95))] p-5 shadow-[0_32px_90px_rgba(0,0,0,0.45)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="font-display text-[1.3rem] tracking-[-0.05em] text-white">
                {creating ? "Create movement box" : "Edit movement box"}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-white/62">
                {draft
                  ? creating
                    ? "Create a canonical user-defined stay, move, or missing-data box without mutating raw phone measurements."
                    : `Adjust this user-defined ${draft.kind} box. Automatic boxes stay immutable and can only be invalidated.`
                  : "No segment selected."}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/72 transition hover:bg-white/[0.08]"
              >
                <ArrowUpRight className="size-4 rotate-45" />
              </button>
            </Dialog.Close>
          </div>

          {draft ? (
            <div className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm text-white/78">
                Kind
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ["stay", "Stay"],
                    ["trip", "Move"],
                    ["missing", "Missing"]
                  ] as const).map(([kind, label]) => (
                    <Button
                      key={kind}
                      type="button"
                      variant="ghost"
                      className={cn(
                        "border border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]",
                        draft.kind === kind ? "ring-1 ring-[rgba(126,229,255,0.42)]" : ""
                      )}
                      onClick={() => onDraftChange({ ...draft, kind })}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </label>
              <label className="grid gap-2 text-sm text-white/78">
                Label
                <Input
                  value={draft.label}
                  onChange={(event) =>
                    onDraftChange({ ...draft, label: event.target.value })
                  }
                />
              </label>
              {draft.kind !== "trip" ? (
                <label className="grid gap-2 text-sm text-white/78">
                  Place
                  <Input
                    value={draft.placeLabel}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        placeLabel: event.target.value
                      })
                    }
                    placeholder="Home, Office, Riverside path..."
                  />
                </label>
              ) : null}
              <label className="grid gap-2 text-sm text-white/78">
                Tags
                <Input
                  value={draft.tagsInput}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      tagsInput: event.target.value
                    })
                  }
                  placeholder="movement, social, errand"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm text-white/78">
                  Started
                  <Input
                    type="datetime-local"
                    value={draft.startedAtInput}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        startedAtInput: event.target.value
                      })
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm text-white/78">
                  Ended
                  <Input
                    type="datetime-local"
                    value={draft.endedAtInput}
                    onChange={(event) =>
                      onDraftChange({
                        ...draft,
                        endedAtInput: event.target.value
                      })
                    }
                  />
                </label>
              </div>
              <Card className="grid gap-3 border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-white">
                    Overlap guidance
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="border border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                    onClick={onFitMissing}
                    disabled={
                      !preflight?.nearestMissingStartedAt ||
                      !preflight?.nearestMissingEndedAt
                    }
                  >
                    Fit Missing Time
                  </Button>
                </div>
                <div className="text-sm leading-6 text-white/62">
                  {preflightLoading
                    ? "Checking visible overlaps and missing windows…"
                    : preflight?.overlapsAnything
                      ? `This box overlaps ${preflight.affectedAutomaticBoxIds.length} automatic and ${preflight.affectedUserBoxIds.length} manual boxes. Saving will fully override ${preflight.fullyOverriddenUserBoxIds.length} manual boxes and trim ${preflight.trimmedUserBoxIds.length}.`
                      : "No overlap in the currently visible timeline window."}
                </div>
                <div className="grid gap-1 text-xs text-white/50">
                  <div>
                    Visible range:{" "}
                    {preflight?.visibleRangeStart && preflight?.visibleRangeEnd
                      ? `${formatDateTime(preflight.visibleRangeStart)} -> ${formatDateTime(preflight.visibleRangeEnd)}`
                      : "Unavailable"}
                  </div>
                  <div>
                    Suggested missing slot:{" "}
                    {preflight?.nearestMissingStartedAt && preflight?.nearestMissingEndedAt
                      ? `${formatDateTime(preflight.nearestMissingStartedAt)} -> ${formatDateTime(preflight.nearestMissingEndedAt)}`
                      : "No missing interval in view"}
                  </div>
                </div>
              </Card>
            </div>
          ) : null}

          <div className="mt-6 flex items-center justify-end gap-3">
            <Dialog.Close asChild>
              <Button
                type="button"
                variant="ghost"
                className="border border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
              >
                Cancel
              </Button>
            </Dialog.Close>
            <Button onClick={onSave} disabled={!draft || saving}>
              <Save className="size-4" />
              {saving ? "Saving…" : creating ? "Create box" : "Save changes"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MovementTripEndpointBox({
  side,
  vertical,
  emphasized = false
}: {
  side: "left" | "right" | "center";
  vertical: "top" | "bottom";
  emphasized?: boolean;
}) {
  return (
    <div
      className={cn(
        "absolute z-10 h-7 w-8 rounded-[12px] border bg-[linear-gradient(180deg,rgba(10,16,28,0.94),rgba(7,12,24,0.88))] shadow-[0_12px_30px_rgba(0,0,0,0.22)] backdrop-blur-sm",
        emphasized ? "border-[rgba(152,208,255,0.34)]" : "border-white/10",
        side === "left"
          ? "left-[8%]"
          : side === "right"
            ? "right-[8%]"
            : "left-1/2 -translate-x-1/2",
        vertical === "top" ? "top-0" : "bottom-0"
      )}
    />
  );
}

function MovementTimelineRow({
  segment,
  selected,
  onToggle,
  onEdit,
  onOpenDetail,
  onDefinePlace
}: {
  segment: MovementTimelineSegment;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onOpenDetail: () => void;
  onDefinePlace: () => void;
}) {
  const lane = segment.laneSide;
  const detailSide = lane === "right" ? "left" : "right";
  const shiftX = selected ? (detailSide === "right" ? -176 : 176) : 0;
  const sleepOverlay = isSleepOverlaySegment(segment);
  const displayHeight = segmentDisplayHeight(
    segment.durationSeconds,
    segment.kind,
    segment.syncSource
  );
  const minRowHeight = Math.max(240, displayHeight + 120);
  const staySurface =
    segment.kind === "stay"
      ? sleepOverlay
        ? "bg-[linear-gradient(180deg,rgba(39,127,173,0.28),rgba(16,51,79,0.22))] border-[rgba(138,227,255,0.28)]"
        : "bg-[linear-gradient(180deg,rgba(98,130,238,0.22),rgba(18,34,79,0.22))] border-[rgba(152,208,255,0.24)]"
      : "";
  const tripEndpoints =
    segment.kind === "trip"
      ? {
          start: resolveTripEndpoint(segment, "start", {
            includeCoordinates: false,
            useHistoryAnchorFallback: true
          }),
          end: resolveTripEndpoint(segment, "end", {
            includeCoordinates: false
          })
        }
      : null;

  return (
    <div className="relative w-full px-6">
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.08),rgba(255,255,255,0.02))]" />
      <div
        className="relative"
        style={{ minHeight: `${minRowHeight}px` }}
      >
        {segment.kind === "trip" ? (
          <motion.div
            layout
            animate={{ x: shiftX }}
            transition={{ type: "spring", stiffness: 240, damping: 30 }}
            className="absolute inset-x-0 top-8 h-[calc(100%-2rem)] z-10"
          >
            {tripEndpoints && selected ? (
              <>
                <MovementTripEndpointBox
                  side="center"
                  vertical="top"
                  emphasized
                />
                <MovementTripEndpointBox
                  side="center"
                  vertical="bottom"
                  emphasized
                />
              </>
            ) : null}
            <MovementTripConnector
              fromSide="center"
              toSide="center"
              height={displayHeight}
              emphasized={selected}
            />
            <button
              type="button"
              onClick={onToggle}
              className={cn(
                "group absolute top-1/2 max-w-[min(9rem,calc(100vw-9rem))] -translate-y-1/2 rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(9,14,24,0.58),rgba(8,12,22,0.42))] px-3 py-2 text-left shadow-[0_12px_24px_rgba(0,0,0,0.14)] backdrop-blur-sm transition hover:border-white/14",
                "left-1/2 -translate-x-1/2",
                selected ? "ring-1 ring-[rgba(126,229,255,0.38)]" : ""
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-label text-[10px] uppercase tracking-[0.18em] text-white/34">
                  Move
                </div>
                <div className="text-[11px] tracking-[0.18em] text-white/44">
                  {formatDurationLabel(segment.durationSeconds)}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge className="bg-white/[0.08] text-white/74">
                  {distanceLabel(segment.trip?.distanceMeters ?? 0)}
                </Badge>
                {(segment.trip?.stops.length ?? 0) > 0 ? (
                  <Badge className="bg-white/[0.08] text-white/74">
                    {segment.trip?.stops.length} stop{segment.trip?.stops.length === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-2 font-label text-[9px] uppercase tracking-[0.22em] text-white/28">
                {compactTimeLabel(segment.startedAt)} → {compactTimeLabel(segment.endedAt)}
              </div>
            </button>
          </motion.div>
        ) : (
          <motion.div
            layout
            animate={{ x: shiftX }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            className="absolute top-8 left-1/2 z-10 w-[min(22rem,calc(100vw-5rem))] -translate-x-1/2"
          >
            <button
              type="button"
              onClick={onToggle}
              className={cn(
                "group relative w-full overflow-hidden rounded-[30px] border text-left shadow-[0_26px_68px_rgba(3,8,20,0.42)] transition",
                staySurface,
                selected ? "ring-1 ring-[rgba(126,229,255,0.42)]" : "hover:border-white/22"
              )}
              style={{ minHeight: `${displayHeight}px` }}
            >
              <MovementStayHandle position="top" />
              <MovementStayHandle position="bottom" />
              <div className="relative z-10 flex h-full flex-col justify-between p-5">
                <div className="flex items-center justify-between gap-3">
                  <Badge tone="signal" className="bg-white/10 text-white/82">
                    {sleepOverlay ? "Sleep" : "Stay"}
                  </Badge>
                  <div className="text-xs tracking-[0.18em] text-white/46">
                    {formatDurationLabel(segment.durationSeconds)}
                  </div>
                </div>
                <div className="mt-5 min-w-0">
                  <div className="truncate font-display text-[1.12rem] tracking-[-0.04em] text-white">
                    {displaySegmentTitle(segment)}
                  </div>
                  {segment.kind === "stay" &&
                  resolveSegmentPlaceLabel(segment) &&
                  !sleepOverlay ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge className="max-w-full truncate bg-white/[0.08] text-white/76">
                        {resolveSegmentPlaceLabel(segment)}
                      </Badge>
                    </div>
                  ) : sleepOverlay ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge className="max-w-full truncate bg-cyan-400/12 text-cyan-50">
                        {segment.subtitle}
                      </Badge>
                    </div>
                  ) : null}
                </div>
                <div className="mt-auto pt-8">
                  <div className="font-label text-[10px] uppercase tracking-[0.22em] text-white/34">
                    {compactTimeLabel(segment.startedAt)} → {compactTimeLabel(segment.endedAt)}
                  </div>
                </div>
              </div>
            </button>
          </motion.div>
        )}

        {selected ? (
          <motion.div
            layout
            initial={{ opacity: 0, x: detailSide === "right" ? 28 : -28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: detailSide === "right" ? 28 : -28 }}
            className={cn(
              "absolute top-6 w-[min(22rem,calc(100vw-4rem))]",
              detailSide === "right" ? "right-[3%]" : "left-[3%]"
            )}
          >
            <MovementTimelineDetailCard
              segment={segment}
              onEdit={onEdit}
              onOpenDetail={onOpenDetail}
              onDefinePlace={onDefinePlace}
            />
          </motion.div>
        ) : null}
      </div>
    </div>
  );
}

export function MovementLifeTimeline({ userIds = [] }: MovementLifeTimelineProps) {
  const queryClient = useQueryClient();
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const dataListRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const autoSelectedRef = useRef(false);
  const prependAnchorRef = useRef<{ count: number; size: number } | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [draftById, setDraftById] = useState<Record<string, TimelineDraft>>({});
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState<TimelineDraft | null>(null);
  const [detailSegmentId, setDetailSegmentId] = useState<string | null>(null);
  const [placeLabelSegmentId, setPlaceLabelSegmentId] = useState<string | null>(null);
  const [placeLabelDialogOpen, setPlaceLabelDialogOpen] = useState(false);
  const [placeEditorOpen, setPlaceEditorOpen] = useState(false);
  const [placeSeed, setPlaceSeed] = useState<MovementPlaceDraftSeed | null>(null);
  const [placeSeedSegmentId, setPlaceSeedSegmentId] = useState<string | null>(null);
  const [dataModalOpen, setDataModalOpen] = useState(false);
  const [reopenDataModalOnEditClose, setReopenDataModalOnEditClose] = useState(false);
  const [sleepOverlayVisible, setSleepOverlayVisible] = useState(false);
  const [segmentQuery, setSegmentQuery] = useState("");
  const [selectedFilterIds, setSelectedFilterIds] = useState<string[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const syncScrollMetrics = () => {
    const element = scrollParentRef.current;
    if (!element) {
      return;
    }
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight);
  };

  const timelineQuery = useInfiniteQuery({
    queryKey: ["forge-movement-life-timeline", ...userIds],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      getMovementTimeline({
        before: pageParam ?? undefined,
        limit: TIMELINE_PAGE_SIZE,
        userIds
      }).then((response) => response.movement),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: false,
    refetchOnWindowFocus: false
  });

  const dataTimelineQuery = useInfiniteQuery({
    queryKey: ["forge-movement-life-timeline-data", ...userIds],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      getMovementTimeline({
        before: pageParam ?? undefined,
        includeInvalid: true,
        limit: TIMELINE_PAGE_SIZE,
        userIds
      }).then((response) => response.movement),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: false,
    refetchOnWindowFocus: false
  });

  const segmentsDescending = useMemo(
    () => timelineQuery.data?.pages.flatMap((page) => page.segments) ?? [],
    [timelineQuery.data]
  );
  const dataSegmentsDescending = useMemo(
    () => dataTimelineQuery.data?.pages.flatMap((page) => page.segments) ?? [],
    [dataTimelineQuery.data]
  );
  const invalidSegmentCount = useMemo(
    () =>
      timelineQuery.data?.pages.reduce(
        (count, page) => Math.max(count, page.invalidSegmentCount ?? 0),
        0
      ) ?? 0,
    [timelineQuery.data]
  );
  const segments = useMemo(
    () => [...segmentsDescending].reverse(),
    [segmentsDescending]
  );
  const dataSegments = useMemo(
    () => [...dataSegmentsDescending].reverse(),
    [dataSegmentsDescending]
  );
  const sleepOverlays = useMemo(() => {
    const byId = new Map<string, MovementTimelineSleepOverlay>();
    for (const page of timelineQuery.data?.pages ?? []) {
      for (const overlay of page.sleepOverlays ?? []) {
        byId.set(overlay.id, overlay);
      }
    }
    return [...byId.values()].sort(
      (left, right) =>
        new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime()
    );
  }, [timelineQuery.data]);
  const sleepDisplaySegments = useMemo(
    () => applySleepOverlayToMovementSegments(segments, sleepOverlays),
    [segments, sleepOverlays]
  );
  const displaySegments = useMemo(
    () =>
      sleepOverlayVisible
        ? sleepDisplaySegments
        : segments,
    [segments, sleepDisplaySegments, sleepOverlayVisible]
  );
  const renderedSleepSegments = useMemo(
    () =>
      sleepDisplaySegments.filter(
        (segment) => segment.syncSource === "sleep overlay"
      ),
    [sleepDisplaySegments]
  );
  const mostRelevantSleepSegmentId = renderedSleepSegments.at(-1)?.id ?? null;
  const detailSegment = useMemo(
    () => displaySegments.find((segment) => segment.id === detailSegmentId) ?? null,
    [detailSegmentId, displaySegments]
  );
  const detailQuery = useQuery({
    queryKey: ["forge-movement-box-detail", detailSegment?.boxId ?? null, ...userIds],
    queryFn: async () =>
      detailSegment?.boxId
        ? (await getMovementBoxDetail(detailSegment.boxId, userIds)).movement
        : null,
    enabled: Boolean(detailSegment?.boxId)
  });
  const placeLabelSegment = useMemo(
    () => segments.find((segment) => segment.id === placeLabelSegmentId) ?? null,
    [placeLabelSegmentId, segments]
  );
  const movementPlacesQuery = useQuery({
    queryKey: ["forge-movement-places", ...userIds],
    queryFn: async () => (await listMovementPlaces(userIds)).places,
    retry: false,
    refetchOnWindowFocus: false
  });
  const futureTailHeight = useMemo(() => {
    const latestEndedAt = displaySegments[displaySegments.length - 1]?.endedAt;
    if (!latestEndedAt) {
      return GRID_ROW_HEIGHT * FUTURE_GRID_HOURS;
    }
    const nowPlusOneHourMs = Date.now() + FUTURE_GRID_HOURS * 3_600_000;
    const latestEndedMs = new Date(latestEndedAt).getTime();
    return Math.max(
      GRID_ROW_HEIGHT * FUTURE_GRID_HOURS,
      ((nowPlusOneHourMs - latestEndedMs) / 3_600_000) * GRID_ROW_HEIGHT
    );
  }, [displaySegments]);
  const timelineRows = useMemo(() => {
    let cursor = CENTER_PADDING;
    return displaySegments.map((segment) => {
      const displayHeight = segmentDisplayHeight(
        segment.durationSeconds,
        segment.kind,
        segment.syncSource
      );
      const rowHeight = rowHeightForSegment(segment);
      const rowStart = cursor;
      const boxTop = rowStart + SEGMENT_BOX_TOP;
      const boxBottom = boxTop + displayHeight;
      cursor += rowHeight;
      return {
        segment,
        rowStart,
        rowHeight,
        displayHeight,
        boxTop,
        boxBottom
      } satisfies TimelineRowMetric;
    });
  }, [displaySegments]);

  useEffect(() => {
    if (!dataModalOpen) {
      return;
    }
    if (!dataTimelineQuery.hasNextPage || dataTimelineQuery.isFetchingNextPage) {
      return;
    }
    void dataTimelineQuery.fetchNextPage();
  }, [
    dataModalOpen,
    dataTimelineQuery.fetchNextPage,
    dataTimelineQuery.hasNextPage,
    dataTimelineQuery.isFetchingNextPage
  ]);

  const rowVirtualizer = useVirtualizer({
    count: displaySegments.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: (index) =>
      rowHeightForSegment(displaySegments[index] ?? displaySegments[0]!),
    overscan: 6,
    paddingStart: CENTER_PADDING,
    paddingEnd: futureTailHeight
  });

  useEffect(() => {
    const latest = displaySegments.at(-1);
    if (!autoSelectedRef.current && latest) {
      autoSelectedRef.current = true;
      setSelectedSegmentId(latest.id);
    }
  }, [displaySegments]);

  useEffect(() => {
    if (!initializedRef.current && displaySegments.length > 0) {
      initializedRef.current = true;
      requestAnimationFrame(() => {
        rowVirtualizer.scrollToIndex(displaySegments.length - 1, {
          align: "center"
        });
        requestAnimationFrame(() => {
          syncScrollMetrics();
        });
      });
      return;
    }

    if (
      prependAnchorRef.current &&
      displaySegments.length > prependAnchorRef.current.count &&
      scrollParentRef.current
    ) {
      const anchor = prependAnchorRef.current;
      prependAnchorRef.current = null;
      requestAnimationFrame(() => {
        const scrollElement = scrollParentRef.current;
        if (!scrollElement) {
          return;
        }
        const delta = rowVirtualizer.getTotalSize() - anchor.size;
        scrollElement.scrollTop += delta;
        syncScrollMetrics();
      });
    }
  }, [displaySegments.length, rowVirtualizer]);

  useEffect(() => {
    const element = scrollParentRef.current;
    if (!element) {
      return;
    }
    const updateViewport = () => {
      syncScrollMetrics();
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    if (!selectedSegmentId) {
      return;
    }
    const segment = segments.find((entry) => entry.id === selectedSegmentId);
    if (!segment) {
      return;
    }
    setDraftById((current) =>
      current[selectedSegmentId]
        ? current
        : {
            ...current,
            [selectedSegmentId]: buildDraft(segment)
          }
    );
  }, [segments, selectedSegmentId]);

  useEffect(() => {
    if (!selectedSegmentId) {
      return;
    }
    if (!displaySegments.some((segment) => segment.id === selectedSegmentId)) {
      setSelectedSegmentId(displaySegments.at(-1)?.id ?? null);
    }
  }, [displaySegments, selectedSegmentId]);

  useEffect(() => {
    if (!sleepOverlayVisible || !mostRelevantSleepSegmentId) {
      return;
    }
    const targetIndex = displaySegments.findIndex(
      (segment) => segment.id === mostRelevantSleepSegmentId
    );
    if (targetIndex < 0) {
      return;
    }
    setSelectedSegmentId(mostRelevantSleepSegmentId);
    requestAnimationFrame(() => {
      rowVirtualizer.scrollToIndex(targetIndex, {
        align: "center"
      });
    });
  }, [displaySegments, mostRelevantSleepSegmentId, rowVirtualizer, sleepOverlayVisible]);

  const invalidateMovementProjectionQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["forge-movement-life-timeline"]
      }),
      queryClient.invalidateQueries({
        queryKey: ["forge-movement-life-timeline-data"]
      }),
      queryClient.invalidateQueries({ queryKey: ["forge-movement-box-detail"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-movement-day"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-movement-month"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-movement-all-time"] }),
      queryClient.invalidateQueries({ queryKey: ["forge-movement-places"] }),
      queryClient.invalidateQueries({
        queryKey: ["forge-psyche-self-observation-calendar"]
      })
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async (input: {
      segment: MovementTimelineSegment | null;
      draft: TimelineDraft;
      creating: boolean;
    }) => {
      const { segment, draft, creating } = input;
      const payload = buildMovementUserBoxPayloadInput(draft, segment);

      if (creating) {
        await createMovementUserBox(payload, userIds);
        return;
      }

      if (!segment) {
        throw new Error("No movement box selected.");
      }
      if (segment.sourceKind !== "user_defined") {
        throw new Error(
          "Automatic movement boxes are immutable. Invalidate them into missing data or create a user-defined override instead."
        );
      }

      await patchMovementUserBox(
        segment.boxId,
        {
          ...payload,
          metadata: { updatedFrom: "movement-life-timeline" }
        },
        userIds
      );
    },
    onSuccess: invalidateMovementProjectionQueries
  });

  const persistPlaceLabelOverride = async (
    segment: MovementTimelineSegment,
    place: Pick<MovementKnownPlace, "label">
  ) => {
    if (segment.kind !== "stay") {
      throw new Error("Only stays can be linked to a saved place.");
    }

    const payload = buildStayPlaceLabelOverridePayload(segment, place.label);
    if (segment.sourceKind === "user_defined") {
      await patchMovementUserBox(
        segment.boxId,
        {
          ...payload,
          metadata: { updatedFrom: "movement-life-timeline-place-label" }
        },
        userIds
      );
      return;
    }

    await createMovementUserBox(
      {
        ...payload,
        metadata: { createdFrom: "movement-life-timeline-place-label" }
      },
      userIds
    );
  };

  const persistRecordedStayPlaceLink = async (
    segment: Extract<MovementTimelineSegment, { kind: "stay" }> & {
      stay: NonNullable<Extract<MovementTimelineSegment, { kind: "stay" }>["stay"]>;
    },
    place: Pick<MovementKnownPlace, "externalUid" | "label">
  ) => {
    if (segment.rawStayIds.length === 0) {
      throw new Error("This stay has no raw stay ids to relabel.");
    }
    await Promise.all(
      segment.rawStayIds.map((stayId) =>
        patchMovementStay(stayId, {
          placeExternalUid: place.externalUid,
          placeLabel: place.label
        })
      )
    );
  };

  const confirmDistantPlaceSelection = (
    segment: MovementTimelineSegment,
    place: MovementKnownPlace
  ) => {
    const seed = movementPlaceSeedFromSegment(segment);
    if (!seed) {
      return true;
    }
    const distanceMeters = distanceBetweenCoordinates(
      seed.latitude,
      seed.longitude,
      place.latitude,
      place.longitude
    );
    if (distanceMeters <= 100) {
      return true;
    }
    if (typeof window === "undefined" || typeof window.confirm !== "function") {
      return true;
    }
    return window.confirm(
      `"${place.label}" is ${distanceLabel(
        distanceMeters
      )} away from this stay's recorded center. Link it anyway?`
    );
  };

  const placeMutation = useMutation({
    mutationFn: async (input: {
      segment: MovementTimelineSegment | null;
      id?: string;
      label: string;
      latitude: number;
      longitude: number;
      radiusMeters: number;
      categoryTags: string[];
    }) => {
      const { segment, ...placeInput } = input;
      const response = await createMovementPlace(placeInput, userIds);
      if (segment && hasRecordedStay(segment)) {
        await persistRecordedStayPlaceLink(segment, response.place);
      }
      return response;
    },
    onSuccess: invalidateMovementProjectionQueries
  });

  const assignPlaceMutation = useMutation({
    mutationFn: async (input: {
      segment: MovementTimelineSegment;
      place: MovementKnownPlace;
    }) => {
      const { segment, place } = input;
      if (!confirmDistantPlaceSelection(segment, place)) {
        return { assigned: false };
      }
      if (hasRecordedStay(segment)) {
        await persistRecordedStayPlaceLink(segment, place);
        return { assigned: true };
      }
      if (segment.kind !== "stay") {
        throw new Error("Only stays can be linked to a saved place.");
      }
      await persistPlaceLabelOverride(segment, place);
      return { assigned: true };
    },
    onSuccess: async (result) => {
      if (result.assigned) {
        await invalidateMovementProjectionQueries();
      }
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (segment: MovementTimelineSegment) => {
      if (segment.sourceKind === "user_defined") {
        await deleteMovementUserBox(segment.boxId, userIds);
        return;
      }
      await invalidateAutomaticMovementBox(
        segment.boxId,
        {
          title: "User invalidated automatic movement",
          subtitle: `Overrides ${displaySegmentTitle(segment)} with missing data.`
        },
        userIds
      );
    },
    onSuccess: async (_, segment) => {
      setSelectedSegmentId((current) => (current === segment.id ? null : current));
      setEditingSegmentId((current) => (current === segment.id ? null : current));
      queryClient.setQueryData(
        ["forge-movement-life-timeline", ...userIds],
        (current: { pages: Array<{ segments: MovementTimelineSegment[] }>; pageParams: unknown[] } | undefined) =>
          removeSegmentFromTimelinePages(current, segment.id)
      );
      queryClient.setQueryData(
        ["forge-movement-life-timeline-data", ...userIds],
        (current: { pages: Array<{ segments: MovementTimelineSegment[] }>; pageParams: unknown[] } | undefined) =>
          removeSegmentFromTimelinePages(current, segment.id)
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["forge-movement-life-timeline"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["forge-movement-life-timeline-data"]
        }),
        queryClient.invalidateQueries({ queryKey: ["forge-movement-day"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-movement-month"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-movement-all-time"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-movement-selection"] }),
        queryClient.invalidateQueries({
          queryKey: ["forge-psyche-self-observation-calendar"]
        })
      ]);
    }
  });

  const segmentFilterOptions = useMemo(
    () => createMovementSegmentFilterOptions(dataSegments),
    [dataSegments]
  );

  const filteredSegments = useMemo(() => {
    const normalizedQuery = normalizeSearchText(segmentQuery);
    return [...dataSegments]
      .sort(
        (left, right) =>
          new Date(right.endedAt).getTime() - new Date(left.endedAt).getTime()
      )
      .filter((segment) => {
        const matchesQuery =
          normalizedQuery.length === 0 ||
          buildMovementSegmentSearchText(segment).includes(normalizedQuery);
        return matchesQuery && matchesMovementSegmentFilters(segment, selectedFilterIds);
      });
  }, [dataSegments, segmentQuery, selectedFilterIds]);

  const dataResultSummary = useMemo(() => {
    if (dataSegments.length === 0) {
      return "No movement records loaded yet.";
    }
    if (
      filteredSegments.length === dataSegments.length &&
      segmentQuery.trim().length === 0 &&
      selectedFilterIds.length === 0
    ) {
      return `${dataSegments.length} loaded movement records visible`;
    }
    return `${filteredSegments.length} of ${dataSegments.length} loaded records visible`;
  }, [
    dataSegments.length,
    filteredSegments.length,
    segmentQuery,
    selectedFilterIds.length
  ]);

  const dataListVirtualizer = useVirtualizer({
    count: filteredSegments.length,
    getScrollElement: () => dataListRef.current,
    estimateSize: () => 136,
    overscan: 8
  });

  const editingSegment = editingSegmentId
    ? segments.find((segment) => segment.id === editingSegmentId) ?? null
    : null;
  const editingDraft = editingSegment
    ? (draftById[editingSegment.id] ?? buildDraft(editingSegment))
    : null;
  const isCreating = creatingDraft !== null;
  const activeDraft = creatingDraft ?? editingDraft;
  const visibleRangeStart = segments[0]?.startedAt ?? null;
  const visibleRangeEnd = segments[segments.length - 1]?.endedAt ?? null;
  const preflightQuery = useQuery({
    queryKey: [
      "forge-movement-user-box-preflight",
      editingSegment?.boxId ?? "create",
      activeDraft?.kind ?? null,
      activeDraft?.startedAtInput ?? null,
      activeDraft?.endedAtInput ?? null,
      visibleRangeStart,
      visibleRangeEnd,
      ...userIds
    ],
    enabled:
      activeDraft !== null &&
      parseDateTimeInput(activeDraft.startedAtInput) !== null &&
      parseDateTimeInput(activeDraft.endedAtInput) !== null,
    queryFn: async () => {
      if (!activeDraft) {
        return null;
      }
      const payload = buildMovementUserBoxPayloadInput(activeDraft, editingSegment);
      const response = await preflightMovementUserBox(
        {
          ...payload,
          excludeBoxId:
            editingSegment?.sourceKind === "user_defined"
              ? editingSegment.boxId
              : null,
          rangeStart: visibleRangeStart,
          rangeEnd: visibleRangeEnd
        },
        userIds
      );
      return response.preflight;
    }
  });

  const openPlaceLabelDialog = (segment: MovementTimelineSegment) => {
    if (!hasRecordedStay(segment)) {
      return;
    }
    setPlaceLabelSegmentId(segment.id);
    setPlaceLabelDialogOpen(true);
  };

  const openCanonicalPlaceDraft = (segment: MovementTimelineSegment) => {
    const seed = movementPlaceSeedFromSegment(segment);
    if (!seed) {
      return;
    }
    setPlaceSeed(seed);
    setPlaceSeedSegmentId(segment.id);
    setPlaceEditorOpen(true);
  };

  const openPlaceCreateFromLabelDialog = (
    segment: MovementTimelineSegment,
    labelHint: string
  ) => {
    const seed = movementPlaceSeedFromSegment(segment);
    if (!seed) {
      return;
    }
    setPlaceLabelDialogOpen(false);
    setPlaceLabelSegmentId(segment.id);
    setPlaceSeed({
      ...seed,
      label: labelHint.trim() || seed.label
    });
    setPlaceSeedSegmentId(segment.id);
    setPlaceEditorOpen(true);
  };

  const handleScroll = () => {
    const element = scrollParentRef.current;
    if (!element) {
      return;
    }
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight);
    if (!timelineQuery.hasNextPage || timelineQuery.isFetchingNextPage) {
      return;
    }
    if (element.scrollTop <= 960) {
      prependAnchorRef.current = {
        count: displaySegments.length,
        size: rowVirtualizer.getTotalSize()
      };
      void timelineQuery.fetchNextPage();
    }
  };

  if (timelineQuery.isPending) {
    return (
      <SurfaceSkeleton
        eyebrow="Movement"
        title="Loading life timeline"
        description="Reconstructing the longer road of stays, moves, and places."
        columns={1}
        blocks={6}
      />
    );
  }

  if (timelineQuery.isError) {
    return (
      <ErrorState
        eyebrow="Movement"
        error={timelineQuery.error}
        onRetry={() => void timelineQuery.refetch()}
      />
    );
  }

  const virtualRows = rowVirtualizer.getVirtualItems();
  const contentHeight = Math.max(
    timelineRows.length > 0
      ? timelineRows[timelineRows.length - 1]!.rowStart +
          timelineRows[timelineRows.length - 1]!.rowHeight +
          futureTailHeight
      : CENTER_PADDING + futureTailHeight,
    viewportHeight > 0 ? viewportHeight + 260 : 960,
    CENTER_PADDING + futureTailHeight
  );
  return (
    <section className="grid gap-4">
      <Card className="overflow-hidden rounded-[34px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(88,182,255,0.08),transparent_28%),linear-gradient(180deg,rgba(4,8,17,0.99),rgba(5,9,18,0.97))] p-4">
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <div className="font-label text-[11px] uppercase tracking-[0.22em] text-white/34">
            Movement
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full border border-white/10 bg-white/[0.04] px-3 text-white/72 hover:bg-white/[0.08] hover:text-white"
              onClick={() => setCreatingDraft(buildNewDraft("stay", segments.at(-1) ?? null))}
            >
              <PencilLine className="size-3.5" />
              Add box
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full border border-white/10 bg-white/[0.04] px-3 text-white/72 hover:bg-white/[0.08] hover:text-white"
              onClick={() =>
                setSleepOverlayVisible((current) => {
                  const nextValue = !current;
                  if (nextValue && mostRelevantSleepSegmentId) {
                    setSelectedSegmentId(mostRelevantSleepSegmentId);
                  }
                  return nextValue;
                })
              }
            >
              <MoonStar className="size-3.5" />
              {sleepOverlayVisible ? "Hide sleep" : "Show sleep"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full border border-white/10 bg-white/[0.04] px-3 text-white/72 hover:bg-white/[0.08] hover:text-white"
              onClick={() => setDataModalOpen(true)}
            >
              <Database className="size-3.5" />
              View data
            </Button>
            {invalidSegmentCount > 0 ? (
              <Badge className="bg-amber-500/10 text-amber-100">
                {invalidSegmentCount} invalid hidden
              </Badge>
            ) : null}
            <Badge className="bg-white/[0.06] text-white/68">
              {displaySegments.length} visible
            </Badge>
          </div>
        </div>
        {sleepOverlayVisible && renderedSleepSegments.length === 0 ? (
          <p className="mb-3 px-1 text-sm text-amber-100/80">
            No sleep session overlaps the currently loaded timeline range yet.
            Scroll further back to load older history.
          </p>
        ) : null}
        <div
          ref={scrollParentRef}
          onScroll={handleScroll}
          className="relative h-[82vh] overflow-auto rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(4,7,15,0.98),rgba(6,10,18,0.96))]"
        >
          <MovementTimelineViewportGrid
            rows={timelineRows}
            totalHeight={contentHeight}
            scrollTop={scrollTop}
            viewportHeight={viewportHeight}
          />

          <div
            className="relative"
            style={{ height: `${contentHeight}px` }}
          >
            <MovementTimelineHistoryCap segment={displaySegments[0] ?? null} />
            {virtualRows.map((virtualRow) => {
              const segment = displaySegments[virtualRow.index];
              if (!segment) {
                return null;
              }
              return (
                <div
                  key={segment.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  <MovementTimelineRow
                    segment={segment}
                    selected={selectedSegmentId === segment.id}
                    onToggle={() =>
                      setSelectedSegmentId((current) =>
                        current === segment.id ? null : segment.id
                      )
                    }
                    onEdit={() => {
                      if (!segment.editable) {
                        return;
                      }
                      setEditingSegmentId(segment.id);
                    }}
                    onOpenDetail={() => setDetailSegmentId(segment.id)}
                    onDefinePlace={() => openPlaceLabelDialog(segment)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </Card>
      <MovementTimelineEditDialog
        open={editingSegment !== null || creatingDraft !== null}
        segment={editingSegment}
        draft={activeDraft}
        creating={isCreating}
        saving={saveMutation.isPending}
        preflight={preflightQuery.data ?? null}
        preflightLoading={preflightQuery.isFetching}
        onDraftChange={(nextDraft) => {
          if (isCreating) {
            setCreatingDraft(nextDraft);
            return;
          }
          if (!editingSegment) {
            return;
          }
          setDraftById((current) => ({
            ...current,
            [editingSegment.id]: nextDraft
          }));
        }}
        onFitMissing={() => {
          const preflight = preflightQuery.data;
          if (!preflight?.nearestMissingStartedAt || !preflight.nearestMissingEndedAt) {
            return;
          }
          const nextDraft = {
            ...(activeDraft ?? buildNewDraft("stay", editingSegment)),
            startedAtInput: formatDateTimeInput(preflight.nearestMissingStartedAt),
            endedAtInput: formatDateTimeInput(preflight.nearestMissingEndedAt)
          };
          if (isCreating) {
            setCreatingDraft(nextDraft);
            return;
          }
          if (!editingSegment) {
            return;
          }
          setDraftById((current) => ({
            ...current,
            [editingSegment.id]: nextDraft
          }));
        }}
        onSave={() => {
          if (!activeDraft) {
            return;
          }
          void saveMutation.mutateAsync(
            {
              segment: editingSegment,
              draft: activeDraft,
              creating: isCreating
            },
            {
            onSuccess: () => {
              setEditingSegmentId(null);
              setCreatingDraft(null);
              if (reopenDataModalOnEditClose) {
                setReopenDataModalOnEditClose(false);
                setDataModalOpen(true);
              }
            }
          });
        }}
        onOpenChange={(open) => {
          if (!open) {
            setEditingSegmentId(null);
            setCreatingDraft(null);
            if (reopenDataModalOnEditClose) {
              setReopenDataModalOnEditClose(false);
              setDataModalOpen(true);
            }
          }
        }}
      />
      <MovementTimelineDetailDialog
        open={detailSegment !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailSegmentId(null);
          }
        }}
        segment={detailSegment}
        detail={detailQuery.data ?? null}
        loading={detailQuery.isFetching}
        onEdit={() => {
          if (!detailSegment || !detailSegment.editable) {
            return;
          }
          setEditingSegmentId(detailSegment.id);
          setDetailSegmentId(null);
        }}
        onDefinePlace={() => {
          if (!detailSegment) {
            return;
          }
          openPlaceLabelDialog(detailSegment);
        }}
      />
      <MovementStayPlaceLabelDialog
        open={placeLabelDialogOpen}
        onOpenChange={(open) => {
          setPlaceLabelDialogOpen(open);
          if (!open) {
            setPlaceLabelSegmentId(null);
          }
        }}
        segment={placeLabelSegment}
        places={movementPlacesQuery.data ?? []}
        loading={movementPlacesQuery.isFetching}
        onSelectPlace={async (place) => {
          if (!placeLabelSegment) {
            return false;
          }
          const result = await assignPlaceMutation.mutateAsync({
            segment: placeLabelSegment,
            place
          });
          return result.assigned;
        }}
        onCreatePlace={(segment, labelHint) => {
          openPlaceCreateFromLabelDialog(segment, labelHint);
        }}
      />
      <MovementPlaceEditorDialog
        open={placeEditorOpen}
        onOpenChange={(open) => {
          setPlaceEditorOpen(open);
          if (!open) {
            setPlaceSeed(null);
            setPlaceSeedSegmentId(null);
          }
        }}
        place={null}
        seed={placeSeed}
        onSave={async (input) => {
          await placeMutation.mutateAsync({
            ...input,
            segment:
              segments.find((segment) => segment.id === placeSeedSegmentId) ?? null
          });
        }}
      />
      <SheetScaffold
        open={dataModalOpen}
        onOpenChange={(open) => {
          setDataModalOpen(open);
          if (!open) {
            if (!reopenDataModalOnEditClose) {
              setSegmentQuery("");
              setSelectedFilterIds([]);
            }
          }
        }}
        eyebrow="Movement data"
        title="View data"
        description=""
      >
        <div className="grid gap-4">
          <FacetedTokenSearch
            title=""
            description=""
            query={segmentQuery}
            onQueryChange={setSegmentQuery}
            options={segmentFilterOptions}
            selectedOptionIds={selectedFilterIds}
            onSelectedOptionIdsChange={setSelectedFilterIds}
            resultSummary={dataResultSummary}
            placeholder="Search movement labels, places, times, tags, or add time and kind filters"
            emptyStateMessage="Keep typing or pick filters to narrow the movement history."
          />

          <Card className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-2">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                  Canonical boxes
                </div>
                <div className="max-w-3xl text-sm leading-6 text-white/56">
                  This list shows the canonical movement boxes projected by Forge. Automatic boxes are derived from immutable raw phone measurements. User-defined boxes override the projection without mutating raw movement data.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full border border-white/10 bg-white/[0.04] px-3 text-white/70"
                  onClick={() => {
                    setReopenDataModalOnEditClose(true);
                    setDataModalOpen(false);
                    setCreatingDraft(buildNewDraft("stay", filteredSegments.at(-1) ?? null));
                  }}
                >
                  Add box
                </Button>
                <Badge tone="meta">{dataResultSummary}</Badge>
                {invalidSegmentCount > 0 ? (
                  <Badge className="bg-amber-500/10 text-amber-100">
                    {invalidSegmentCount} invalid hidden included
                  </Badge>
                ) : null}
                {dataTimelineQuery.hasNextPage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-full border border-white/10 bg-white/[0.04] px-3 text-white/70"
                    pending={dataTimelineQuery.isFetchingNextPage}
                    pendingLabel="Loading…"
                    onClick={() => void dataTimelineQuery.fetchNextPage()}
                  >
                    Load older
                  </Button>
                ) : null}
              </div>
            </div>

              <div
                ref={dataListRef}
                className="h-[36rem] overflow-y-auto rounded-[24px] border border-white/8 bg-white/[0.03]"
              >
                {filteredSegments.length === 0 ? (
                  <div className="flex h-full items-center justify-center p-6 text-center text-sm leading-6 text-white/50">
                    No movement record matches the current search. Clear filters or load older timeline history.
                  </div>
                ) : (
                  <div
                    className="relative w-full"
                    style={{ height: `${dataListVirtualizer.getTotalSize()}px` }}
                  >
                    {dataListVirtualizer.getVirtualItems().map((virtualRow) => {
                      const segment = filteredSegments[virtualRow.index]!;
                      return (
                        <div
                          key={segment.id}
                          ref={dataListVirtualizer.measureElement}
                          data-index={virtualRow.index}
                          className="absolute left-0 top-0 w-full px-3 py-2"
                          style={{ transform: `translateY(${virtualRow.start}px)` }}
                        >
                          <div className="flex items-start gap-2 rounded-[18px] border border-white/8 bg-white/[0.04] px-3 py-2.5">
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left transition hover:opacity-100"
                              onClick={() => {
                                if (!segment.editable) {
                                  return;
                                }
                                setReopenDataModalOnEditClose(true);
                                setDataModalOpen(false);
                                setEditingSegmentId(segment.id);
                              }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 text-white">
                                    {segment.kind === "stay" ? (
                                      <MapPin className="size-3.5 shrink-0 text-[var(--primary)]" />
                                    ) : segment.kind === "missing" ? (
                                      <Database className="size-3.5 shrink-0 text-slate-300/80" />
                                    ) : (
                                      <Route className="size-3.5 shrink-0 text-[var(--primary)]" />
                                    )}
                                    <span className="truncate text-sm font-medium">
                                      {displaySegmentTitle(segment)}
                                    </span>
                                  </div>
                                  <div className="mt-1 text-xs text-white/56">
                                    {formatSegmentTimestamp(segment.startedAt)} →{" "}
                                    {formatSegmentTimestamp(segment.endedAt)}
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                                    <Badge tone={segment.kind === "trip" ? "signal" : "meta"}>
                                      {segment.kind === "trip"
                                        ? "Move"
                                        : segment.kind === "missing"
                                          ? "Missing"
                                          : "Stay"}
                                    </Badge>
                                  <Badge
                                    className={
                                      segment.sourceKind === "user_defined"
                                        ? "bg-fuchsia-400/12 text-fuchsia-100"
                                        : "bg-white/[0.06] text-white/70"
                                    }
                                  >
                                    {segment.sourceKind === "user_defined"
                                      ? segment.origin === "user_invalidated"
                                        ? "User invalidated"
                                        : "User-defined"
                                      : "Automatic"}
                                  </Badge>
                                  <Badge tone="meta">
                                    {formatDurationLabel(segment.durationSeconds)}
                                  </Badge>
                                  {segment.origin === "continued_stay" ? (
                                    <Badge className="bg-sky-400/10 text-sky-100">
                                      Continued stay
                                    </Badge>
                                  ) : null}
                                  {segment.origin === "repaired_gap" ? (
                                    <Badge className="bg-amber-400/10 text-amber-100">
                                      Repaired
                                    </Badge>
                                  ) : null}
                                  {segment.kind === "missing" ? (
                                    <Badge className="bg-slate-300/10 text-slate-100">
                                      Missing
                                    </Badge>
                                  ) : null}
                                  {segment.isInvalid ? (
                                    <Badge className="bg-amber-500/10 text-amber-100">
                                      Invalid
                                    </Badge>
                                  ) : null}
                                  {segment.placeLabel ? (
                                    <Badge tone="default">{segment.placeLabel}</Badge>
                                  ) : null}
                                  {segment.overrideCount > 0 ? (
                                    <Badge className="bg-amber-400/10 text-amber-100">
                                      Overrides {segment.overrideCount}
                                    </Badge>
                                  ) : null}
                                  <Badge className="bg-white/[0.06] text-white/66">
                                    Raw stays {segment.rawStayIds.length}
                                  </Badge>
                                  <Badge className="bg-white/[0.06] text-white/66">
                                    Raw trips {segment.rawTripIds.length}
                                  </Badge>
                                  <Badge className="bg-white/[0.06] text-white/66">
                                    Raw points {segment.rawPointCount}
                                  </Badge>
                                  {segment.hasLegacyCorrections ? (
                                    <Badge className="bg-amber-400/10 text-amber-100">
                                      Legacy corrections
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>
                            </button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "h-8 shrink-0 rounded-full border px-2.5",
                                segment.sourceKind === "user_defined"
                                  ? "border-rose-400/22 bg-rose-500/10 text-rose-100 hover:bg-rose-500/18"
                                  : "border-amber-400/22 bg-amber-500/10 text-amber-100 hover:bg-amber-500/18"
                              )}
                              pending={
                                deleteMutation.isPending &&
                                deleteMutation.variables?.id === segment.id
                              }
                              pendingLabel=""
                              onClick={() => {
                                const confirmed = window.confirm(
                                  segment.sourceKind === "user_defined"
                                    ? `Delete ${displaySegmentTitle(segment)} and remove this user-defined box from every synced surface?`
                                    : `Invalidate ${displaySegmentTitle(segment)} into missing data and hide the automatic box everywhere?`
                                );
                                if (!confirmed) {
                                  return;
                                }
                                void deleteMutation.mutateAsync(segment);
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>
        </div>
      </SheetScaffold>
    </section>
  );
}
