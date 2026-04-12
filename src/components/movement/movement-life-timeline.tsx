import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUpRight,
  Database,
  MapPin,
  PencilLine,
  Route,
  Save,
  Trash2
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
  createMovementPlace,
  deleteMovementStay,
  deleteMovementTrip,
  getMovementTimeline,
  patchMovementStay,
  patchMovementTrip
} from "@/lib/api";
import type {
  MovementTimelineLaneSide,
  MovementTimelineSegment
} from "@/lib/types";
import { cn } from "@/lib/utils";

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

function displaySegmentTitle(segment: MovementTimelineSegment) {
  if (segment.kind === "trip" && isGenericTripTitle(segment.title)) {
    const start = resolveTripEndpoint(segment, "start").label;
    const end = resolveTripEndpoint(segment, "end").label;
    return `${start} → ${end}`;
  }
  return segment.title;
}

function displaySegmentBadge(segment: MovementTimelineSegment) {
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
  kind: MovementTimelineSegment["kind"]
) {
  const cappedHours = Math.min(durationSeconds, MAX_DISPLAY_SECONDS) / 3600;
  const minHeight = kind === "stay" ? 132 : 124;
  const maxHeight = kind === "stay" ? 404 : 328;
  const height = minHeight + cappedHours * 44;
  return Math.max(minHeight, Math.min(maxHeight, height));
}

function rowHeightForSegment(segment: MovementTimelineSegment) {
  return Math.max(250, segmentDisplayHeight(segment.durationSeconds, segment.kind) + 130);
}

function buildDraft(segment: MovementTimelineSegment): TimelineDraft {
  return {
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
  onEdit
}: {
  segment: MovementTimelineSegment;
  onEdit: () => void;
}) {
  return (
    <Card className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,14,26,0.98),rgba(5,9,19,0.95))] p-5 shadow-[0_24px_74px_rgba(0,0,0,0.34)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/40">
            {segment.kind === "stay"
              ? "Stay detail"
              : segment.kind === "trip"
                ? "Move detail"
                : "Missing data"}
          </div>
          <div className="mt-2 text-lg text-white">{displaySegmentTitle(segment)}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={onEdit}
            variant="ghost"
            className="size-9 rounded-full border border-white/10 bg-white/[0.04] text-white/78 hover:bg-white/[0.08]"
            aria-label="Edit movement segment"
            disabled={segment.kind === "missing"}
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
        {segment.placeLabel ? (
          <Badge className="bg-white/[0.08] text-white/74">
            {segment.placeLabel}
          </Badge>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3">
        <div className="rounded-[18px] border border-white/8 bg-white/[0.03] p-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/34">
            Timeline summary
          </div>
          <div className="mt-2 text-sm leading-6 text-white/76">
            {segment.kind === "stay"
              ? `Stay block from ${compactTimeLabel(segment.startedAt)} to ${compactTimeLabel(segment.endedAt)}.`
              : segment.kind === "trip"
                ? `Connector from ${resolveTripEndpoint(segment, "start").label} to ${resolveTripEndpoint(segment, "end").label}.`
                : `No reliable movement signal reached Forge from ${compactTimeLabel(segment.startedAt)} to ${compactTimeLabel(segment.endedAt)}.`}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-white/56">
        {hasRecordedStay(segment) ? (
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

function MovementTimelineEditDialog({
  open,
  segment,
  draft,
  saving,
  onDraftChange,
  onSave,
  onOpenChange
}: {
  open: boolean;
  segment: MovementTimelineSegment | null;
  draft: TimelineDraft | null;
  saving: boolean;
  onDraftChange: (draft: TimelineDraft) => void;
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
                Edit movement segment
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-white/62">
                {segment
                  ? `Adjust the canonical ${segment.kind} metadata, labels, tags, timing, and place attachment in a dedicated form.`
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

          {segment && draft ? (
            <div className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm text-white/78">
                Label
                <Input
                  value={draft.label}
                  onChange={(event) =>
                    onDraftChange({ ...draft, label: event.target.value })
                  }
                />
              </label>
              {segment.kind === "stay" ? (
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
            <Button onClick={onSave} disabled={!segment || !draft || saving}>
              <Save className="size-4" />
              {saving ? "Saving…" : "Save changes"}
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
  onEdit
}: {
  segment: MovementTimelineSegment;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const lane = segment.laneSide;
  const detailSide = lane === "right" ? "left" : "right";
  const shiftX = selected ? (detailSide === "right" ? -176 : 176) : 0;
  const displayHeight = segmentDisplayHeight(segment.durationSeconds, segment.kind);
  const minRowHeight = Math.max(240, displayHeight + 120);
  const staySurface =
    segment.kind === "stay"
      ? "bg-[linear-gradient(180deg,rgba(98,130,238,0.22),rgba(18,34,79,0.22))] border-[rgba(152,208,255,0.24)]"
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
                    Stay
                  </Badge>
                  <div className="text-xs tracking-[0.18em] text-white/46">
                    {formatDurationLabel(segment.durationSeconds)}
                  </div>
                </div>
                <div className="mt-auto pt-14">
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
  const [dataModalOpen, setDataModalOpen] = useState(false);
  const [reopenDataModalOnEditClose, setReopenDataModalOnEditClose] = useState(false);
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
  const futureTailHeight = useMemo(() => {
    const latestEndedAt = segments[segments.length - 1]?.endedAt;
    if (!latestEndedAt) {
      return GRID_ROW_HEIGHT * FUTURE_GRID_HOURS;
    }
    const nowPlusOneHourMs = Date.now() + FUTURE_GRID_HOURS * 3_600_000;
    const latestEndedMs = new Date(latestEndedAt).getTime();
    return Math.max(
      GRID_ROW_HEIGHT * FUTURE_GRID_HOURS,
      ((nowPlusOneHourMs - latestEndedMs) / 3_600_000) * GRID_ROW_HEIGHT
    );
  }, [segments]);
  const timelineRows = useMemo(() => {
    let cursor = CENTER_PADDING;
    return segments.map((segment) => {
      const displayHeight = segmentDisplayHeight(segment.durationSeconds, segment.kind);
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
  }, [segments]);

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
    count: segments.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: (index) => rowHeightForSegment(segments[index] ?? segments[0]!),
    overscan: 6,
    paddingStart: CENTER_PADDING,
    paddingEnd: futureTailHeight
  });

  useEffect(() => {
    const latest = segments.at(-1);
    if (!autoSelectedRef.current && latest) {
      autoSelectedRef.current = true;
      setSelectedSegmentId(latest.id);
    }
  }, [segments]);

  useEffect(() => {
    if (!initializedRef.current && segments.length > 0) {
      initializedRef.current = true;
      requestAnimationFrame(() => {
        rowVirtualizer.scrollToIndex(segments.length - 1, {
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
      segments.length > prependAnchorRef.current.count &&
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
  }, [rowVirtualizer, segments.length]);

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

  const saveMutation = useMutation({
    mutationFn: async (segment: MovementTimelineSegment) => {
      const draft = draftById[segment.id] ?? buildDraft(segment);
      const tags = draft.tagsInput
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const startedAt = parseDateTimeInput(draft.startedAtInput) ?? segment.startedAt;
      const endedAt = parseDateTimeInput(draft.endedAtInput) ?? segment.endedAt;

      if (hasRecordedStay(segment)) {
        let placeId: string | undefined;
        const desiredPlaceLabel = draft.placeLabel.trim();
        if (!hasRecordedStay(segment)) {
          throw new Error("Only recorded stays can create or link canonical places.");
        }
        if (
          desiredPlaceLabel &&
          desiredPlaceLabel !== (segment.stay.place?.label ?? segment.placeLabel ?? "")
        ) {
          const created = await createMovementPlace(
            {
              label: desiredPlaceLabel,
              latitude: segment.stay.centerLatitude,
              longitude: segment.stay.centerLongitude,
              radiusMeters: segment.stay.radiusMeters,
              categoryTags: tags.length > 0 ? tags : ["movement"]
            },
            userIds
          );
          placeId = created.place.id;
        }

        await patchMovementStay(segment.stay.id, {
          label: draft.label.trim(),
          tags,
          startedAt,
          endedAt,
          ...(placeId ? { placeId } : {})
        });
      } else if (hasRecordedTrip(segment)) {
        await patchMovementTrip(segment.trip.id, {
          label: draft.label.trim(),
          tags,
          startedAt,
          endedAt
        });
      } else {
        throw new Error("Only recorded movement segments can be edited.");
      }
    },
    onSuccess: async () => {
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
        queryClient.invalidateQueries({ queryKey: ["forge-movement-places"] }),
        queryClient.invalidateQueries({
          queryKey: ["forge-psyche-self-observation-calendar"]
        })
      ]);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (segment: MovementTimelineSegment) => {
      if (hasRecordedStay(segment)) {
        await deleteMovementStay(segment.stay.id);
        return;
      }
      if (hasRecordedTrip(segment)) {
        await deleteMovementTrip(segment.trip.id);
        return;
      }
      throw new Error("Only recorded movement segments can be deleted.");
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
        count: segments.length,
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
  const editingSegment = editingSegmentId
    ? segments.find((segment) => segment.id === editingSegmentId) ?? null
    : null;
  const editingDraft = editingSegment
    ? (draftById[editingSegment.id] ?? buildDraft(editingSegment))
    : null;

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
              {segments.length} loaded
            </Badge>
          </div>
        </div>
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
            <MovementTimelineHistoryCap segment={segments[0] ?? null} />
            {virtualRows.map((virtualRow) => {
              const segment = segments[virtualRow.index];
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
                  />
                </div>
              );
            })}
          </div>
        </div>
      </Card>
      <MovementTimelineEditDialog
        open={editingSegment !== null}
        segment={editingSegment}
        draft={editingDraft}
        saving={saveMutation.isPending}
        onDraftChange={(nextDraft) => {
          if (!editingSegment) {
            return;
          }
          setDraftById((current) => ({
            ...current,
            [editingSegment.id]: nextDraft
          }));
        }}
        onSave={() => {
          if (!editingSegment) {
            return;
          }
          void saveMutation.mutateAsync(editingSegment, {
            onSuccess: () => {
              setEditingSegmentId(null);
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
            if (reopenDataModalOnEditClose) {
              setReopenDataModalOnEditClose(false);
              setDataModalOpen(true);
            }
          }
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
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                Data records
              </div>
              <div className="flex items-center gap-2">
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
                                </div>
                              </div>
                            </button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 shrink-0 rounded-full border border-rose-400/22 bg-rose-500/10 px-2.5 text-rose-100 hover:bg-rose-500/18"
                              pending={
                                deleteMutation.isPending &&
                                deleteMutation.variables?.id === segment.id
                              }
                              pendingLabel=""
                              disabled={!segment.editable}
                              onClick={() => {
                                if (!segment.editable) {
                                  return;
                                }
                                const confirmed = window.confirm(
                                  `Delete ${displaySegmentTitle(segment)} and keep it deleted across companion sync?`
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
