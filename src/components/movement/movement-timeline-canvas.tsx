import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { isSleepOverlaySegment } from "@/components/movement/movement-sleep-overlay";
import {
  GRID_ROW_HEIGHT,
  compactTimeLabel,
  displaySegmentTitle,
  distanceLabel,
  formatDurationLabel,
  formatStickyDate,
  lanePercent,
  resolveSegmentPlaceLabel,
  resolveTripEndpoint,
  type MovementTimelineLayoutModel,
  type TimelineItemLayoutMetric
} from "@/components/movement/movement-life-timeline-model";
import type {
  MovementTimelineLaneSide,
  MovementTimelineSegment
} from "@/lib/types";
import { cn } from "@/lib/utils";

const timelineRailShadeClassName =
  "bg-[linear-gradient(90deg,color-mix(in_srgb,var(--canvas)_96%,transparent),color-mix(in_srgb,var(--canvas)_42%,transparent),transparent)]";
const timelineCenterLineClassName =
  "bg-[linear-gradient(180deg,color-mix(in_srgb,var(--ui-ink-strong)_2%,transparent),color-mix(in_srgb,var(--ui-ink-strong)_8%,transparent),color-mix(in_srgb,var(--ui-ink-strong)_2%,transparent))]";
const timelineHandleClassName =
  "h-6 w-[3px] rounded-full bg-[var(--info)] shadow-[0_0_14px_color-mix(in_srgb,var(--info)_36%,transparent)]";
const timelineHistoryCapClassName =
  "relative w-[min(18rem,calc(100vw-6rem))] overflow-hidden rounded-[26px] border border-[color-mix(in_srgb,var(--info)_22%,transparent)] bg-[linear-gradient(180deg,var(--ui-accent-soft),var(--ui-info-soft))] shadow-[var(--ui-shadow-soft)]";
const timelineEndpointClassName =
  "absolute z-10 h-7 w-8 rounded-[12px] border bg-[image:var(--ui-surface-modal)] shadow-[var(--ui-shadow-soft)] backdrop-blur-sm";
const timelineTripChipClassName =
  "group absolute top-1/2 max-w-[min(8rem,calc(100vw-8rem))] -translate-y-1/2 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-modal)] px-2.5 py-2 text-left shadow-[var(--ui-shadow-soft)] backdrop-blur-sm transition hover:border-[var(--ui-border-strong)] sm:max-w-[9rem] sm:px-3";
export const timelineSelectedRingClassName =
  "ring-1 ring-[color-mix(in_srgb,var(--info)_42%,transparent)]";
export const timelineSubtleBadgeClassName =
  "bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]";
export const timelineInfoBadgeClassName =
  "bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_78%,var(--ui-ink-strong)_22%)]";
export const timelineWarningBadgeClassName =
  "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]";
export const timelineDangerActionClassName =
  "border-[color-mix(in_srgb,var(--danger)_26%,transparent)] bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_78%,var(--ui-ink-strong)_22%)] hover:bg-[color-mix(in_srgb,var(--danger)_18%,transparent)]";
export const timelineWarningActionClassName =
  "border-[color-mix(in_srgb,var(--warning)_26%,transparent)] bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)] hover:bg-[color-mix(in_srgb,var(--warning)_18%,transparent)]";

export function MovementTimelineViewportGrid({
  layout,
  scrollTop,
  viewportHeight
}: {
  layout: MovementTimelineLayoutModel;
  scrollTop: number;
  viewportHeight: number;
}) {
  const overscan = GRID_ROW_HEIGHT * 6;
  const visibleStart = Math.max(0, scrollTop - overscan);
  const visibleEnd = Math.min(
    layout.totalHeight,
    scrollTop + Math.max(viewportHeight, GRID_ROW_HEIGHT * 8) + overscan
  );
  const visibleMarkers = layout.markers.filter(
    (marker) => marker.y >= visibleStart && marker.y <= visibleEnd
  );

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden rounded-[30px]"
      style={{ height: `${layout.totalHeight}px` }}
    >
      <div className={cn("absolute inset-y-0 left-0 w-18", timelineRailShadeClassName)} />
      {visibleMarkers.map((marker, index) => (
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
      ))}
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
        stroke={
          emphasized
            ? "color-mix(in srgb, var(--ui-ink-strong) 18%, transparent)"
            : "color-mix(in srgb, var(--ui-ink-strong) 11%, transparent)"
        }
        strokeWidth={emphasized ? "1.05" : "0.85"}
        strokeDasharray={emphasized ? "3 10" : "2.5 12"}
        strokeLinecap="round"
      />
      <circle
        cx={startX}
        cy="16"
        r="1.5"
        fill="color-mix(in srgb, var(--ui-ink-strong) 26%, transparent)"
      />
      <circle
        cx={endX}
        cy={height - 18}
        r="1.5"
        fill="color-mix(in srgb, var(--ui-ink-strong) 26%, transparent)"
      />
    </svg>
  );
}

function MovementStayHandle({ position }: { position: "top" | "bottom" }) {
  return (
    <div
      className={cn(
        "absolute left-1/2 z-20 flex -translate-x-1/2 items-center justify-center",
        position === "top" ? "-top-3" : "-bottom-3"
      )}
    >
      <div className={timelineHandleClassName} />
    </div>
  );
}

export function MovementTimelineHistoryCap({
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
      <div className={timelineHistoryCapClassName}>
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
          <div className="mt-5 font-display text-[1.25rem] tracking-normal text-white">
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

export function resolveStickyTimelineDay(
  layout: MovementTimelineLayoutModel,
  scrollTop: number,
  viewportHeight: number
) {
  const anchorY = scrollTop + Math.max(96, Math.min(viewportHeight * 0.28, 220));
  const visibleItem =
    layout.items.find((item) => item.boxBottom >= anchorY) ??
    layout.items[layout.items.length - 1] ??
    null;
  return visibleItem ? formatStickyDate(visibleItem.segment.startedAt) : null;
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
        timelineEndpointClassName,
        emphasized
          ? "border-[color-mix(in_srgb,var(--info)_34%,transparent)]"
          : "border-[var(--ui-border-subtle)]",
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

export function MovementTimelineRow({
  layout,
  selected,
  onToggle
}: {
  layout: TimelineItemLayoutMetric;
  selected: boolean;
  onToggle: () => void;
}) {
  const { segment } = layout;
  const sleepOverlay = isSleepOverlaySegment(segment);
  const displayHeight = layout.displayHeight;
  const staySurface =
    segment.kind === "stay"
      ? sleepOverlay
        ? "bg-[var(--ui-info-soft)] border-[color-mix(in_srgb,var(--info)_28%,transparent)]"
        : "bg-[var(--ui-accent-soft)] border-[color-mix(in_srgb,var(--primary)_24%,transparent)]"
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
    <div
      className={cn(
        "absolute left-0 w-full px-3 sm:px-6",
        selected ? "z-40" : "z-10"
      )}
      data-testid="movement-timeline-row"
      data-selected={selected ? "true" : "false"}
      style={{
        top: `${layout.boxTop}px`,
        height: `${displayHeight}px`
      }}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-1/2 w-px -translate-x-1/2",
          timelineCenterLineClassName
        )}
      />
      <div className="relative h-full">
        {segment.kind === "trip" ? (
          <motion.div
            layout
            animate={{ x: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 30 }}
            className="absolute inset-x-0 top-0 z-10 h-full"
          >
            {tripEndpoints && selected ? (
              <>
                <MovementTripEndpointBox side="center" vertical="top" emphasized />
                <MovementTripEndpointBox side="center" vertical="bottom" emphasized />
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
                timelineTripChipClassName,
                "left-1/2 -translate-x-1/2",
                selected ? timelineSelectedRingClassName : ""
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
                    {segment.trip?.stops.length} stop
                    {segment.trip?.stops.length === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-2 font-label text-[9px] uppercase tracking-[0.22em] text-white/28">
                {compactTimeLabel(segment.startedAt)} →{" "}
                {compactTimeLabel(segment.endedAt)}
              </div>
            </button>
          </motion.div>
        ) : (
          <motion.div
            layout
            animate={{ x: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            className="absolute left-1/2 top-0 z-10 w-[min(18.5rem,calc(100vw-3.25rem))] -translate-x-1/2 sm:w-[min(21rem,calc(100vw-5rem))]"
          >
            <button
              type="button"
              onClick={onToggle}
              className={cn(
                "group relative w-full overflow-hidden rounded-[24px] border text-left shadow-[var(--ui-shadow-soft)] transition sm:rounded-[30px]",
                staySurface,
                selected
                  ? timelineSelectedRingClassName
                  : "hover:border-[var(--ui-border-strong)]"
              )}
              style={{ minHeight: `${displayHeight}px` }}
            >
              <MovementStayHandle position="top" />
              <MovementStayHandle position="bottom" />
              <div className="relative z-10 flex h-full flex-col justify-between p-3.5 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <Badge tone="signal" className="bg-white/10 text-white/82">
                    {sleepOverlay ? "Sleep" : "Stay"}
                  </Badge>
                  <div className="text-[11px] tracking-[0.16em] text-white/46 sm:text-xs sm:tracking-[0.18em]">
                    {formatDurationLabel(segment.durationSeconds)}
                  </div>
                </div>
                <div className="mt-3 min-w-0 sm:mt-5">
                  <div className="truncate font-display text-[1rem] tracking-normal text-white sm:text-[1.12rem]">
                    {displaySegmentTitle(segment)}
                  </div>
                  {segment.kind === "stay" &&
                  resolveSegmentPlaceLabel(segment) &&
                  !sleepOverlay ? (
                    <div className="mt-2 flex flex-wrap gap-2 sm:mt-3">
                      <Badge className="max-w-full truncate bg-white/[0.08] text-white/76">
                        {resolveSegmentPlaceLabel(segment)}
                      </Badge>
                    </div>
                  ) : sleepOverlay ? (
                    <div className="mt-2 flex flex-wrap gap-2 sm:mt-3">
                      <Badge className={cn("max-w-full truncate", timelineInfoBadgeClassName)}>
                        {segment.subtitle}
                      </Badge>
                    </div>
                  ) : null}
                </div>
                <div className="mt-auto pt-4 sm:pt-8">
                  <div className="font-label text-[9px] uppercase tracking-[0.2em] text-white/34 sm:text-[10px] sm:tracking-[0.22em]">
                    {compactTimeLabel(segment.startedAt)} →{" "}
                    {compactTimeLabel(segment.endedAt)}
                  </div>
                </div>
              </div>
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
