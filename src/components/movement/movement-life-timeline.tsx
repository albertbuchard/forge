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
  MapPin,
  PencilLine,
  Route,
  Save
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/page-state";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import {
  createMovementPlace,
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
const CENTER_PADDING = 420;
const END_PADDING = 260;
const GRID_ROW_HEIGHT = 64;
const MAX_DISPLAY_SECONDS = 6 * 60 * 60;

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

function resolveTripEndpoint(
  segment: Extract<MovementTimelineSegment, { kind: "trip" }>,
  kind: "start" | "end",
  options?: {
    includeCoordinates?: boolean;
    useHistoryAnchorFallback?: boolean;
  }
) {
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
  if (segment.kind === "trip") {
    return segment.trip.travelMode === "walking" ? "Walk" : "Move";
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
    label:
      segment.kind === "stay"
        ? segment.stay.label || segment.title
        : segment.trip.label || segment.title,
    placeLabel:
      segment.kind === "stay"
        ? segment.stay.place?.label ?? segment.placeLabel ?? ""
        : "",
    tagsInput: segment.tags.join(", "),
    startedAtInput: formatDateTimeInput(segment.startedAt),
    endedAtInput: formatDateTimeInput(segment.endedAt)
  };
}

function compressedMarkerFractions(durationSeconds: number) {
  const count = durationSeconds > MAX_DISPLAY_SECONDS ? 5 : 3;
  return Array.from({ length: count }, (_, index) => {
    const ratio = index / (count - 1);
    return durationSeconds > MAX_DISPLAY_SECONDS ? Math.pow(ratio, 1.9) : ratio;
  });
}

function MovementTimelineViewportGrid({
  totalHeight,
  latestEndedAt
}: {
  totalHeight: number;
  latestEndedAt: string;
}) {
  const lineCount = Math.max(10, Math.ceil(totalHeight / GRID_ROW_HEIGHT) + 2);
  const anchorY = totalHeight - END_PADDING;
  const latestDate = new Date(latestEndedAt);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[30px]">
      <div className="absolute inset-y-0 left-0 w-18 bg-[linear-gradient(90deg,rgba(7,12,22,0.96),rgba(7,12,22,0.42),transparent)]" />
      {Array.from({ length: lineCount }).map((_, index) => {
        const y = Math.max(0, anchorY - index * GRID_ROW_HEIGHT);
        const lineDate = new Date(latestDate.getTime() - index * 3_600_000);
        const isDateLine = lineDate.getHours() === 0;
        return (
          <div
            key={`timeline-grid-${index}`}
            className="absolute inset-x-0"
            style={{ top: `${y}px` }}
          >
            <div
              className={cn(
                "border-t",
                isDateLine ? "border-white/14" : "border-white/7"
              )}
            />
            <div
              className={cn(
                "absolute left-3 top-0 -translate-y-1/2 font-label text-[9px] tracking-[0.24em]",
                isDateLine ? "text-white/38" : "text-white/22"
              )}
            >
              {isDateLine ? formatStickyDate(lineDate.toISOString()) : formatHourMarker(lineDate)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MovementTimelineSegmentScale({
  segment,
  className
}: {
  segment: MovementTimelineSegment;
  className?: string;
}) {
  const markers = compressedMarkerFractions(segment.durationSeconds);
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden rounded-[30px]",
        className
      )}
    >
      {markers.map((ratio, index) => {
        const markerDate = new Date(
          new Date(segment.endedAt).getTime() - segment.durationSeconds * 1000 * ratio
        );
        const isStart = index === markers.length - 1;
        const isDateLine = markerDate.getHours() === 0 || isStart;
        return (
          <div
            key={`${segment.id}-marker-${index}`}
            className="absolute inset-x-0"
            style={{ top: `${ratio * 100}%` }}
          >
            <div className={cn("border-t", isDateLine ? "border-white/10" : "border-white/6")} />
            <div
              className={cn(
                "absolute left-3 top-0 -translate-y-1/2 font-label text-[9px] tracking-[0.22em]",
                isDateLine ? "text-white/32" : "text-white/18"
              )}
            >
              {isDateLine
                ? formatStickyDate(markerDate.toISOString())
                : formatHourMarker(markerDate)}
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
      : segment
        ? resolveTripEndpoint(segment, "start", {
            includeCoordinates: false,
            useHistoryAnchorFallback: true
          }).label
        : null;
  const label = knownLabel || "Beginning of time";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-6 z-10 flex justify-center px-6">
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
            {segment.kind === "stay" ? "Stay detail" : "Move detail"}
          </div>
          <div className="mt-2 text-lg text-white">{displaySegmentTitle(segment)}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={onEdit}
            variant="ghost"
            className="size-9 rounded-full border border-white/10 bg-white/[0.04] text-white/78 hover:bg-white/[0.08]"
            aria-label="Edit movement segment"
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
        {segment.kind === "trip" ? (
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
              : `Connector from ${resolveTripEndpoint(segment, "start").label} to ${resolveTripEndpoint(segment, "end").label}.`}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-white/56">
        {segment.kind === "stay" ? (
          <>
            <MapPin className="size-4 text-[var(--primary)]" />
            {segment.stay.place?.label ?? "No canonical place linked yet"}
          </>
        ) : (
          <>
            <Route className="size-4 text-[var(--primary)]" />
            {segment.trip.activityType || segment.trip.travelMode}
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
  label,
  detail
}: {
  side: "left" | "right" | "center";
  vertical: "top" | "bottom";
  label: string;
  detail: string;
}) {
  return (
    <div
      className={cn(
        "absolute z-10 w-[min(10.8rem,32vw)] rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,16,28,0.94),rgba(7,12,24,0.88))] px-3 py-2 shadow-[0_12px_30px_rgba(0,0,0,0.22)] backdrop-blur-sm",
        side === "left"
          ? "left-[8%]"
          : side === "right"
            ? "right-[8%]"
            : "left-1/2 -translate-x-1/2",
        vertical === "top" ? "top-4" : "bottom-4"
      )}
    >
      <div className="truncate text-xs font-semibold text-white/84">
        {label}
      </div>
      <div className="mt-1 truncate font-label text-[9px] uppercase tracking-[0.18em] text-white/34">
        {detail}
      </div>
    </div>
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
  const isWrapped = segment.durationSeconds > MAX_DISPLAY_SECONDS;
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
        <div className="pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden rounded-[34px]">
          {compressedMarkerFractions(segment.durationSeconds).map((ratio, index) => {
            const markerDate = new Date(
              new Date(segment.endedAt).getTime() - segment.durationSeconds * 1000 * ratio
            );
            const isDateLine = markerDate.getHours() === 0 || index === compressedMarkerFractions(segment.durationSeconds).length - 1;
            return (
              <div
                key={`${segment.id}-bg-${index}`}
                className="absolute inset-x-0"
                style={{ top: `${ratio * 100}%` }}
              >
                <div className={cn("border-t", isDateLine ? "border-white/10" : "border-white/5")} />
                <div className={cn("mt-1 pl-4 font-label text-[9px] tracking-[0.22em]", isDateLine ? "text-white/28" : "text-white/14")}>
                  {isDateLine ? formatStickyDate(markerDate.toISOString()) : formatHourMarker(markerDate)}
                </div>
              </div>
            );
          })}
        </div>

        {segment.kind === "trip" ? (
          <motion.div
            layout
            animate={{ x: shiftX }}
            transition={{ type: "spring", stiffness: 240, damping: 30 }}
            className="absolute inset-x-0 top-8 h-[calc(100%-2rem)]"
          >
            {tripEndpoints && selected ? (
              <>
                <MovementTripEndpointBox
                  side="center"
                  vertical="top"
                  label={tripEndpoints.start.label}
                  detail={tripEndpoints.start.detail}
                />
                <MovementTripEndpointBox
                  side="center"
                  vertical="bottom"
                  label={tripEndpoints.end.label}
                  detail={tripEndpoints.end.detail}
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
                "group absolute top-1/2 max-w-[min(10rem,calc(100vw-9rem))] -translate-y-1/2 rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(9,14,24,0.58),rgba(8,12,22,0.42))] px-3 py-2 text-left shadow-[0_12px_24px_rgba(0,0,0,0.14)] backdrop-blur-sm transition hover:border-white/14",
                "left-1/2 -translate-x-1/2",
                selected ? "ring-1 ring-[rgba(126,229,255,0.38)]" : ""
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-label text-[10px] uppercase tracking-[0.18em] text-white/34">
                  {compactTimeLabel(segment.startedAt)} → {compactTimeLabel(segment.endedAt)}
                </div>
                <div className="text-[11px] tracking-[0.18em] text-white/44">
                  {formatDurationLabel(segment.durationSeconds)}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge className="bg-white/[0.08] text-white/74">
                  {distanceLabel(segment.trip.distanceMeters)}
                </Badge>
                {segment.trip.stops.length > 0 ? (
                  <Badge className="bg-white/[0.08] text-white/74">
                    {segment.trip.stops.length} stop{segment.trip.stops.length === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </div>
              {isWrapped ? (
                <div className="mt-2 font-label text-[9px] uppercase tracking-[0.22em] text-white/28">
                  Wrapped to a 6h road height, actual duration {formatDurationLabel(segment.durationSeconds)}
                </div>
              ) : null}
            </button>
          </motion.div>
        ) : (
          <motion.div
            layout
            animate={{ x: shiftX }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            className="absolute top-8 left-1/2 w-[min(22rem,calc(100vw-5rem))] -translate-x-1/2"
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
              <MovementTimelineSegmentScale segment={segment} />
              <div className="relative z-10 flex h-full flex-col justify-between p-5">
                <div className="flex items-center justify-between gap-3">
                  <Badge tone="signal" className="bg-white/10 text-white/82">
                    {displaySegmentBadge(segment)}
                  </Badge>
                  <div className="text-xs tracking-[0.18em] text-white/46">
                    {formatDurationLabel(segment.durationSeconds)}
                  </div>
                </div>
                <div className="mt-10">
                  <div className="font-display text-[clamp(1.3rem,2.2vw,1.72rem)] tracking-[-0.05em] text-white">
                    {displaySegmentTitle(segment)}
                  </div>
                  <div className="mt-2 max-w-[18rem] text-sm leading-6 text-white/62">
                    {segment.subtitle}
                  </div>
                  <div className="mt-3 font-label text-[10px] uppercase tracking-[0.22em] text-white/34">
                    {compactTimeLabel(segment.startedAt)} → {compactTimeLabel(segment.endedAt)}
                  </div>
                </div>
                <div className="mt-6 flex flex-wrap gap-2">
                  {(segment.tags.length > 0 ? segment.tags : [segment.syncSource])
                    .slice(0, 3)
                    .map((tag) => (
                      <Badge
                        key={`${segment.id}-${tag}`}
                        className="bg-white/[0.08] text-white/74"
                      >
                        {tag}
                      </Badge>
                    ))}
                </div>
                {isWrapped ? (
                  <div className="mt-3 font-label text-[10px] uppercase tracking-[0.22em] text-white/32">
                    Wrapped to a 6h block, actual stay {formatDurationLabel(segment.durationSeconds)}
                  </div>
                ) : null}
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
  const initializedRef = useRef(false);
  const autoSelectedRef = useRef(false);
  const prependAnchorRef = useRef<{ count: number; size: number } | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [draftById, setDraftById] = useState<Record<string, TimelineDraft>>({});
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);

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

  const segmentsDescending = useMemo(
    () => timelineQuery.data?.pages.flatMap((page) => page.segments) ?? [],
    [timelineQuery.data]
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

  const rowVirtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: (index) => rowHeightForSegment(segments[index] ?? segments[0]!),
    overscan: 6,
    paddingStart: CENTER_PADDING,
    paddingEnd: END_PADDING
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
      });
    }
  }, [rowVirtualizer, segments.length]);

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

      if (segment.kind === "stay") {
        let placeId: string | undefined;
        const desiredPlaceLabel = draft.placeLabel.trim();
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
      } else {
        await patchMovementTrip(segment.trip.id, {
          label: draft.label.trim(),
          tags,
          startedAt,
          endedAt
        });
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["forge-movement-life-timeline"]
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

  const handleScroll = () => {
    const element = scrollParentRef.current;
    if (!element) {
      return;
    }
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
  return (
    <section className="grid gap-4">
      <Card className="overflow-hidden rounded-[34px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(88,182,255,0.08),transparent_28%),linear-gradient(180deg,rgba(4,8,17,0.99),rgba(5,9,18,0.97))] p-4">
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <div className="font-label text-[11px] uppercase tracking-[0.22em] text-white/34">
            Movement
          </div>
          <div className="flex items-center gap-2">
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
          {segments.length > 0 ? (
            <MovementTimelineViewportGrid
              totalHeight={rowVirtualizer.getTotalSize()}
              latestEndedAt={segments.at(-1)?.endedAt ?? new Date().toISOString()}
            />
          ) : null}

          <div
            className="relative"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {segments.length > 0 ? (
              <MovementTimelineHistoryCap segment={segments[0] ?? null} />
            ) : null}
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
                    onEdit={() => setEditingSegmentId(segment.id)}
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
            onSuccess: () => setEditingSegmentId(null)
          });
        }}
        onOpenChange={(open) => {
          if (!open) {
            setEditingSegmentId(null);
          }
        }}
      />
    </section>
  );
}
