import { useEffect, useMemo, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, PencilLine, Save, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SurfacePanel } from "@/components/ui/surface";
import type {
  MovementBoxDetailData,
  MovementKnownPlace,
  MovementTimelineSegment,
  MovementUserBoxPreflight
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  MovementDetailMap,
  MovementTimelineDetailCard
} from "@/components/movement/movement-timeline-detail";
import {
  buildMovementPlaceSearchText,
  displaySegmentTitle,
  distanceBetweenCoordinates,
  distanceLabel,
  exactLatLngLabel,
  formatDateTime,
  formatDurationLabel,
  formatDurationMinutes,
  movementPlaceSeedFromSegment,
  normalizeSearchText,
  resolveSegmentPlaceLabel,
  type TimelineDraft
} from "@/components/movement/movement-life-timeline-model";

const dialogContentClass =
  "fixed left-1/2 z-50 -translate-x-1/2 overflow-y-auto border border-[var(--ui-border-subtle)] bg-[var(--card-gradient)] text-[var(--ui-ink)] shadow-[var(--card-shadow)] backdrop-blur-xl outline-none";

const iconButtonClass =
  "rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]";

const subtleButtonClass =
  "border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]";

export type MovementTimelineActionMenuItem = {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  onSelect: () => void;
};

export function MovementTimelineActionMenu({
  open,
  anchor,
  items,
  onClose
}: {
  open: boolean;
  anchor: { top: number; right: number } | null;
  items: MovementTimelineActionMenuItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const onPointerDown = () => onClose();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose, open]);

  if (!open || !anchor || typeof document === "undefined") {
    return null;
  }

  const menuTop = Math.max(12, Math.min(anchor.top, window.innerHeight - 360));
  const menuMaxHeight = Math.max(220, window.innerHeight - menuTop - 96);
  const menuWidth = Math.min(368, window.innerWidth - 24);
  const menuRight = Math.max(
    12,
    Math.min(anchor.right, window.innerWidth - menuWidth - 12)
  );

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[70]">
      <div
        className="pointer-events-auto fixed z-[71] overflow-y-auto overscroll-contain rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--card-gradient)] p-2 shadow-[var(--card-shadow)] backdrop-blur-xl"
        style={{
          top: `${menuTop}px`,
          right: `${menuRight}px`,
          width: `${menuWidth}px`,
          maxHeight: `${menuMaxHeight}px`
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <SurfacePanel className="rounded-[22px] px-4 py-3">
          <div className="font-label text-[10px] uppercase tracking-[0.2em] text-[var(--ui-ink-faint)]">
            Movement actions
          </div>
          <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
            Add boxes, inspect raw data, and adjust timeline overlays.
          </div>
        </SurfacePanel>
        <div className="mt-2 grid gap-1">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-start gap-3 rounded-[20px] bg-[var(--ui-surface-1)] px-4 py-3 text-left text-[var(--ui-ink-medium)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                onClick={() => {
                  item.onSelect();
                  onClose();
                }}
              >
                <span className="rounded-[14px] bg-[var(--ui-accent-soft)] p-2 text-[var(--primary)]">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--ui-ink-faint)]">
                    {item.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function MovementTimelineDetailDialog({
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
        <Dialog.Overlay className="surface-overlay fixed inset-0 z-50 backdrop-blur-xl" />
        <Dialog.Content
          className={cn(
            dialogContentClass,
            "top-[6vh] max-h-[88vh] w-[min(60rem,calc(100vw-1.25rem))] rounded-[30px] p-5"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="font-display text-[1.3rem] tracking-[-0.03em] text-[var(--ui-ink-strong)]">
                {activeSegment
                  ? `${displaySegmentTitle(activeSegment)} details`
                  : "Movement details"}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                Inspect the canonical box, the raw movement evidence behind it, and the exact coordinates Forge used to assemble this stay or trip.
              </Dialog.Description>
            </div>
            <div className="flex items-center gap-2">
              {activeSegment ? (
                <Button
                  onClick={onEdit}
                  variant="ghost"
                  className={cn("rounded-full px-3", subtleButtonClass)}
                  disabled={!activeSegment.editable || activeSegment.kind === "missing"}
                >
                  <PencilLine className="size-4" />
                  Edit
                </Button>
              ) : null}
              <Dialog.Close asChild>
                <button type="button" className={cn(iconButtonClass, "p-2")}>
                  <ArrowUpRight className="size-4 rotate-45" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {loading ? (
            <SurfacePanel className="mt-6 text-sm text-[var(--ui-ink-soft)]">
              Loading the canonical box detail and raw movement evidence...
            </SurfacePanel>
          ) : activeSegment ? (
            <div className="mt-6 grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MovementStatCard label="Started" value={formatDateTime(activeSegment.startedAt)} />
                <MovementStatCard label="Ended" value={formatDateTime(activeSegment.endedAt)} />
                <MovementStatCard label="Duration" value={formatDurationLabel(activeSegment.durationSeconds)} />
                <MovementStatCard
                  label="Raw coverage"
                  value={`${activeSegment.rawStayIds.length} stays · ${activeSegment.rawTripIds.length} trips · ${activeSegment.rawPointCount} points`}
                />
              </div>

              {stayDetail ? (
                <>
                  <SurfacePanel className="border-[var(--primary)]/20 bg-[var(--ui-accent-soft)]">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--primary)]">
                      Location label
                    </div>
                    <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-strong)]">
                      {stayDetail.canonicalPlace
                        ? `This stay is linked to ${stayDetail.canonicalPlace.label}. Search a different saved place or relabel it from the stay center.`
                        : "This stay has no saved place yet. Search known locations first, or create a new place directly from the stay center."}
                    </div>
                    <div className="mt-3">
                      <Button onClick={onDefinePlace} variant="ghost" className={cn("rounded-full px-4", subtleButtonClass)}>
                        Label location
                      </Button>
                    </div>
                  </SurfacePanel>
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                    <MovementDetailMap
                      title="Stay positions"
                      points={stayDetail.positions}
                      averagePoint={stayDetail.averagePosition}
                    />
                    <Card className="rounded-[28px] p-5">
                      <MovementMetricList
                        title="Stay metrics"
                        rows={[
                          ["Canonical place", stayDetail.canonicalPlace?.label ?? "Not linked yet"],
                          [
                            "Average position",
                            stayDetail.averagePosition
                              ? exactLatLngLabel(stayDetail.averagePosition.latitude, stayDetail.averagePosition.longitude)
                              : "Unavailable"
                          ],
                          [
                            "Radius",
                            stayDetail.radiusMeters != null
                              ? distanceLabel(stayDetail.radiusMeters)
                              : "Unavailable"
                          ],
                          ["Samples", String(stayDetail.sampleCount)]
                        ]}
                      />
                      <SurfacePanel muted className="mt-4 rounded-[18px] p-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                          Exact positions
                        </div>
                        <div className="mt-3 grid gap-2">
                          {stayDetail.positions.map((position, index) => (
                            <div
                              key={`${position.recordedAt ?? "stay"}-${index}`}
                              className="text-sm text-[var(--ui-ink-medium)]"
                            >
                              {position.label ?? `Position ${index + 1}`}:{" "}
                              {exactLatLngLabel(position.latitude, position.longitude)}
                            </div>
                          ))}
                        </div>
                      </SurfacePanel>
                    </Card>
                  </div>
                </>
              ) : null}

              {tripDetail ? (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                  <MovementDetailMap title="Travel map" points={tripDetail.positions} />
                  <Card className="rounded-[28px] p-5">
                    <MovementMetricList
                      title="Trip metrics"
                      rows={[
                        [
                          "Start position",
                          tripDetail.startPosition
                            ? exactLatLngLabel(tripDetail.startPosition.latitude, tripDetail.startPosition.longitude)
                            : "Unavailable"
                        ],
                        [
                          "End position",
                          tripDetail.endPosition
                            ? exactLatLngLabel(tripDetail.endPosition.latitude, tripDetail.endPosition.longitude)
                            : "Unavailable"
                        ],
                        ["Distance", distanceLabel(tripDetail.totalDistanceMeters)],
                        ["Moving time", formatDurationMinutes(tripDetail.movingSeconds)],
                        ["Idle time", formatDurationMinutes(tripDetail.idleSeconds)],
                        [
                          "Average speed",
                          tripDetail.averageSpeedMps != null
                            ? `${tripDetail.averageSpeedMps.toFixed(2)} m/s`
                            : "Unavailable"
                        ],
                        [
                          "Max speed",
                          tripDetail.maxSpeedMps != null
                            ? `${tripDetail.maxSpeedMps.toFixed(2)} m/s`
                            : "Unavailable"
                        ],
                        ["Stops", String(tripDetail.stopCount)]
                      ]}
                    />
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

export function MovementTimelineSelectionDialog({
  open,
  segment,
  onOpenChange,
  onEdit,
  onOpenDetail,
  onDefinePlace
}: {
  open: boolean;
  segment: MovementTimelineSegment | null;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onOpenDetail: () => void;
  onDefinePlace: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="surface-overlay fixed inset-0 z-50 backdrop-blur-xl" />
        <Dialog.Content className="fixed left-1/2 top-[6vh] z-50 max-h-[88vh] w-[min(36rem,calc(100vw-1.25rem))] -translate-x-1/2 overflow-y-auto rounded-[30px] outline-none">
          <Dialog.Title className="sr-only">
            {segment ? `${displaySegmentTitle(segment)} actions` : "Movement actions"}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            Inspect, edit, or label the selected movement box.
          </Dialog.Description>
          {segment ? (
            <MovementTimelineDetailCard
              segment={segment}
              onEdit={onEdit}
              onOpenDetail={onOpenDetail}
              onDefinePlace={onDefinePlace}
              onClose={() => onOpenChange(false)}
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function MovementStayPlaceLabelDialog({
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
        <Dialog.Overlay className="surface-overlay fixed inset-0 z-50 backdrop-blur-xl" />
        <Dialog.Content
          className={cn(
            dialogContentClass,
            "top-[8vh] max-h-[84vh] w-[min(38rem,calc(100vw-1.25rem))] rounded-[30px] p-5"
          )}
        >
          <DialogHeader
            title="Label stay location"
            description="Search saved locations by name first. If this stay is new, create a location from the stay center with latitude and longitude already filled in."
            closeLabel="Close location label dialog"
          />

          {seed ? (
            <SurfacePanel className="mt-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="signal">Stay center</Badge>
                {currentLabel ? <Badge tone="meta">{currentLabel}</Badge> : null}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <MovementStatCard label="Latitude" value={seed.latitude.toFixed(6)} />
                <MovementStatCard label="Longitude" value={seed.longitude.toFixed(6)} />
              </div>
            </SurfacePanel>
          ) : (
            <SurfacePanel className="mt-5 border-[var(--warning)]/20 text-sm text-[var(--ui-ink-soft)]">
              Forge can only label stays that already have a recorded stay center.
            </SurfacePanel>
          )}

          <div className="mt-5 grid gap-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type a location name or create a new one"
            />
            <SurfacePanel>
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-faint)]">
                Known places
              </div>
              {loading ? (
                <div className="mt-3 text-sm text-[var(--ui-ink-soft)]">Loading saved places...</div>
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
                        className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-left transition hover:border-[var(--primary)]/40 hover:bg-[var(--ui-surface-hover)]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm text-[var(--ui-ink-strong)]">{place.label}</div>
                          {radialDistance != null ? (
                            <Badge tone="meta">{distanceLabel(radialDistance)} away</Badge>
                          ) : null}
                        </div>
                        {place.aliases.length > 0 || place.categoryTags.length > 0 ? (
                          <div className="mt-1 text-xs text-[var(--ui-ink-faint)]">
                            {[...place.aliases, ...place.categoryTags].join(" · ")}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 text-sm text-[var(--ui-ink-soft)]">
                  No saved place matches this stay yet.
                </div>
              )}
            </SurfacePanel>
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className={subtleButtonClass}>
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

export function MovementTimelineEditDialog({
  open,
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
        <Dialog.Overlay className="surface-overlay fixed inset-0 z-50 backdrop-blur-xl" />
        <Dialog.Content
          className={cn(
            dialogContentClass,
            "top-[8vh] w-[min(34rem,calc(100vw-1.25rem))] rounded-[30px] p-5"
          )}
        >
          <DialogHeader
            title={creating ? "Create movement box" : "Edit movement box"}
            description={
              draft
                ? creating
                  ? "Create a canonical user-defined stay, move, or missing-data box without mutating raw phone measurements."
                  : `Adjust this user-defined ${draft.kind} box. Automatic boxes stay immutable and can only be invalidated.`
                : "No segment selected."
            }
          />

          {draft ? (
            <div className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm text-[var(--ui-ink-medium)]">
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
                        subtleButtonClass,
                        draft.kind === kind
                          ? "ring-1 ring-[color-mix(in_srgb,var(--primary)_42%,transparent)]"
                          : ""
                      )}
                      onClick={() => onDraftChange({ ...draft, kind })}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </label>
              <DraftInput label="Label" value={draft.label} onChange={(label) => onDraftChange({ ...draft, label })} />
              {draft.kind !== "trip" ? (
                <DraftInput
                  label="Place"
                  value={draft.placeLabel}
                  placeholder="Home, Office, Riverside path..."
                  onChange={(placeLabel) => onDraftChange({ ...draft, placeLabel })}
                />
              ) : null}
              <DraftInput
                label="Tags"
                value={draft.tagsInput}
                placeholder="movement, social, errand"
                onChange={(tagsInput) => onDraftChange({ ...draft, tagsInput })}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <DraftInput
                  label="Started"
                  type="datetime-local"
                  value={draft.startedAtInput}
                  onChange={(startedAtInput) => onDraftChange({ ...draft, startedAtInput })}
                />
                <DraftInput
                  label="Ended"
                  type="datetime-local"
                  value={draft.endedAtInput}
                  onChange={(endedAtInput) => onDraftChange({ ...draft, endedAtInput })}
                />
              </div>
              <SurfacePanel>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                    Overlap guidance
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className={subtleButtonClass}
                    onClick={onFitMissing}
                    disabled={
                      !preflight?.nearestMissingStartedAt ||
                      !preflight?.nearestMissingEndedAt
                    }
                  >
                    Fit Missing Time
                  </Button>
                </div>
                <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                  {preflightLoading
                    ? "Checking visible overlaps and missing windows..."
                    : preflight?.overlapsAnything
                      ? `This box overlaps ${preflight.affectedAutomaticBoxIds.length} automatic and ${preflight.affectedUserBoxIds.length} manual boxes. Saving will fully override ${preflight.fullyOverriddenUserBoxIds.length} manual boxes and trim ${preflight.trimmedUserBoxIds.length}.`
                      : "No overlap in the currently visible timeline window."}
                </div>
                <div className="mt-3 grid gap-1 text-xs text-[var(--ui-ink-faint)]">
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
              </SurfacePanel>
            </div>
          ) : null}

          <div className="mt-6 flex items-center justify-end gap-3">
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" className={subtleButtonClass}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button onClick={onSave} disabled={!draft || saving}>
              <Save className="size-4" />
              {saving ? "Saving..." : creating ? "Create box" : "Save changes"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DialogHeader({
  title,
  description,
  closeLabel
}: {
  title: string;
  description: string;
  closeLabel?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <Dialog.Title className="font-display text-[1.3rem] tracking-[-0.03em] text-[var(--ui-ink-strong)]">
          {title}
        </Dialog.Title>
        <Dialog.Description className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
          {description}
        </Dialog.Description>
      </div>
      <Dialog.Close asChild>
        <button type="button" className={cn(iconButtonClass, "p-2")} aria-label={closeLabel}>
          {closeLabel ? <X className="size-4" /> : <ArrowUpRight className="size-4 rotate-45" />}
        </button>
      </Dialog.Close>
    </div>
  );
}

function MovementStatCard({ label, value }: { label: string; value: string }) {
  return (
    <SurfacePanel className="rounded-[18px] p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
        {label}
      </div>
      <div className="mt-2 text-sm text-[var(--ui-ink-strong)]">{value}</div>
    </SurfacePanel>
  );
}

function MovementMetricList({
  title,
  rows
}: {
  title: string;
  rows: Array<[string, string]>;
}) {
  return (
    <>
      <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-faint)]">
        {title}
      </div>
      <div className="mt-4 grid gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="text-sm text-[var(--ui-ink-medium)]">
            <span className="text-[var(--ui-ink-faint)]">{label}: </span>
            {value}
          </div>
        ))}
      </div>
    </>
  );
}

function DraftInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="grid gap-2 text-sm text-[var(--ui-ink-medium)]">
      {label}
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
