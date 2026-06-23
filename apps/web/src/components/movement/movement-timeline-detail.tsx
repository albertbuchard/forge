import {
  ArrowUpRight,
  Database,
  MapPin,
  MoonStar,
  PencilLine,
  Route,
  X
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isSleepOverlaySegment } from "@/components/movement/movement-sleep-overlay";
import {
  compactTimeLabel,
  displaySegmentTitle,
  distanceLabel,
  formatDateTime,
  formatDurationLabel,
  hasRecordedStay,
  hasRecordedTrip,
  normalizeDetailMapPoints,
  resolveSegmentPlaceLabel,
  resolveTripEndpoint
} from "@/components/movement/movement-life-timeline-model";
import type {
  MovementBoxDetailCoordinate,
  MovementTimelineSegment
} from "@/lib/types";

const detailPanelClassName =
  "rounded-[28px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-modal)] p-5 shadow-[var(--ui-shadow-floating)]";
const detailMetricClassName =
  "rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3";
const detailEyebrowClassName =
  "text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]";
const detailTextClassName = "text-sm leading-6 text-[var(--ui-ink-medium)]";
const subtleBadgeClassName =
  "bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]";
const infoBadgeClassName =
  "bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_78%,var(--ui-ink-strong)_22%)]";
const warningBadgeClassName =
  "bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]";
const accentBadgeClassName =
  "bg-[var(--ui-accent-soft)] text-[var(--primary)]";
const detailCalloutClassName =
  "mt-4 rounded-[18px] border border-[color-mix(in_srgb,var(--info)_22%,transparent)] bg-[var(--ui-info-soft)] p-3";
const detailCalloutEyebrowClassName =
  "text-[11px] uppercase tracking-[0.18em] text-[color-mix(in_srgb,var(--info)_70%,var(--ui-ink-strong)_30%)]";
const detailCalloutTextClassName =
  "mt-2 text-sm leading-6 text-[var(--ui-ink-medium)]";
const detailCalloutButtonClassName =
  "rounded-full border border-[color-mix(in_srgb,var(--info)_28%,transparent)] bg-[var(--ui-info-soft)] px-4 text-[color-mix(in_srgb,var(--info)_72%,var(--ui-ink-strong)_28%)] hover:bg-[color-mix(in_srgb,var(--info)_18%,transparent)]";

export function MovementTimelineDetailCard({
  segment,
  onEdit,
  onOpenDetail,
  onDefinePlace,
  onClose
}: {
  segment: MovementTimelineSegment;
  onEdit: () => void;
  onOpenDetail: () => void;
  onDefinePlace: () => void;
  onClose?: () => void;
}) {
  const sleepOverlay = isSleepOverlaySegment(segment);
  const placeLabel = resolveSegmentPlaceLabel(segment);
  return (
    <Card className={detailPanelClassName}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-faint)]">
            {sleepOverlay
              ? "Sleep overlay"
              : segment.kind === "stay"
                ? "Stay detail"
                : segment.kind === "trip"
                  ? "Move detail"
                  : "Missing data"}
          </div>
          <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
            {displaySegmentTitle(segment)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge
              className={
                sleepOverlay
                  ? infoBadgeClassName
                  : segment.sourceKind === "user_defined"
                    ? accentBadgeClassName
                    : subtleBadgeClassName
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
              <Badge className={warningBadgeClassName}>
                Overrides {segment.overrideCount} automatic box
                {segment.overrideCount === 1 ? "" : "es"}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={onOpenDetail}
            variant="ghost"
            className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
            disabled={sleepOverlay}
          >
            Details
          </Button>
          <Button
            onClick={onEdit}
            variant="ghost"
            className="size-9 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
            aria-label="Edit movement segment"
            disabled={sleepOverlay || segment.kind === "missing" || !segment.editable}
          >
            <PencilLine className="size-4" />
          </Button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-2 text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
              aria-label="Close movement segment actions"
            >
              <X className="size-4" />
            </button>
          ) : null}
          <ArrowUpRight className="size-4 text-[var(--ui-ink-faint)]" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className={detailMetricClassName}>
          <div className={detailEyebrowClassName}>Started</div>
          <div className="mt-2 text-sm text-[var(--ui-ink-strong)]">
            {formatDateTime(segment.startedAt)}
          </div>
        </div>
        <div className={detailMetricClassName}>
          <div className={detailEyebrowClassName}>Ended</div>
          <div className="mt-2 text-sm text-[var(--ui-ink-strong)]">
            {formatDateTime(segment.endedAt)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone="signal">{formatDurationLabel(segment.durationSeconds)}</Badge>
        {hasRecordedTrip(segment) ? (
          <>
            <Badge className={subtleBadgeClassName}>
              {distanceLabel(segment.trip.distanceMeters)}
            </Badge>
            {segment.trip.stops.length > 0 ? (
              <Badge className={subtleBadgeClassName}>
                {segment.trip.stops.length} stop
                {segment.trip.stops.length === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </>
        ) : null}
        {sleepOverlay ? (
          <Badge className={infoBadgeClassName}>
            {segment.subtitle}
          </Badge>
        ) : placeLabel ? (
          <Badge className={subtleBadgeClassName}>{placeLabel}</Badge>
        ) : null}
      </div>

      {hasRecordedStay(segment) && !sleepOverlay ? (
        <div className={detailCalloutClassName}>
          <div className={detailCalloutEyebrowClassName}>
            Location label
          </div>
          <div className={detailCalloutTextClassName}>
            {segment.stay.place
              ? `This stay is currently linked to ${segment.stay.place.label}. Search saved places or relabel it from this stay center.`
              : "Search saved places for this stay, or create a new one from the stay center so later matching stays inherit it automatically."}
          </div>
          <div className="mt-3">
            <Button
              onClick={onDefinePlace}
              variant="ghost"
              className={detailCalloutButtonClassName}
            >
              Label location
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3">
        <div className={detailMetricClassName}>
          <div className={detailEyebrowClassName}>Timeline summary</div>
          <div className={`mt-2 ${detailTextClassName}`}>
            {segment.kind === "stay"
              ? sleepOverlay
                ? `Sleep overlay from ${compactTimeLabel(segment.startedAt)} to ${compactTimeLabel(segment.endedAt)}. Underlying movement boxes are sliced virtually while this overlay is visible.`
                : `Stay block from ${compactTimeLabel(segment.startedAt)} to ${compactTimeLabel(segment.endedAt)}.`
              : segment.kind === "trip"
                ? `Connector from ${resolveTripEndpoint(segment, "start").label} to ${resolveTripEndpoint(segment, "end").label}.`
                : `No reliable movement signal reached Forge from ${compactTimeLabel(segment.startedAt)} to ${compactTimeLabel(segment.endedAt)}.`}
          </div>
        </div>
        <div className={detailMetricClassName}>
          <div className={detailEyebrowClassName}>Projection model</div>
          <div className={`mt-2 ${detailTextClassName}`}>
            {sleepOverlay
              ? "This sleep layer is visual only. Forge does not persist these split boxes; it temporarily slices the visible movement boxes around each sleep interval."
              : "Raw phone measurements stay immutable. Forge derives automatic boxes from that raw movement evidence, then overlays user-defined boxes on top without mutating the imported raw data."}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge className={subtleBadgeClassName}>
              Raw stays {segment.rawStayIds.length}
            </Badge>
            <Badge className={subtleBadgeClassName}>
              Raw trips {segment.rawTripIds.length}
            </Badge>
            <Badge className={subtleBadgeClassName}>
              Raw points {segment.rawPointCount}
            </Badge>
            {segment.hasLegacyCorrections ? (
              <Badge className={warningBadgeClassName}>
                Legacy corrections present
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-[var(--ui-ink-soft)]">
        {sleepOverlay ? (
          <>
            <MoonStar className="size-4 text-[var(--info)]" />
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
            <Database className="size-4 text-[var(--ui-ink-soft)]" />
            Missing intervals are synthesized from long signal gaps instead of inventing fake travel.
          </>
        )}
      </div>
    </Card>
  );
}

export function MovementDetailMap({
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
    <Card className="rounded-[30px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5">
      <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-faint)]">
        {title}
      </div>
      <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
        Relative coordinates normalized into one view so we can inspect the actual captured stay or trip geometry in one glance.
      </div>
      <div className="mt-5 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
        <svg viewBox="0 0 100 100" className="h-52 w-full">
          <rect
            x="0"
            y="0"
            width="100"
            height="100"
            rx="18"
            fill="var(--ui-surface-1)"
          />
          {pathPoints.length > 1 ? (
            <path
              d={path}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="1.6"
            />
          ) : null}
          {pathPoints.map((point, index) => (
            <circle
              key={point.id}
              cx={point.x}
              cy={point.y}
              r={index === 0 || index === pathPoints.length - 1 ? 2.2 : 1.4}
              fill={
                index === 0 || index === pathPoints.length - 1
                  ? "var(--ui-ink-strong)"
                  : "var(--primary)"
              }
            />
          ))}
          {average ? (
            <g className="text-[var(--warning)]">
              <circle cx={average.x} cy={average.y} r={3} fill="currentColor" />
              <circle
                cx={average.x}
                cy={average.y}
                r={6}
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity={0.48}
              />
            </g>
          ) : null}
        </svg>
      </div>
    </Card>
  );
}
