import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  Route,
  PencilLine,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import { FacetedTokenSearch, type FacetedTokenOption } from "@/components/search/faceted-token-search";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { ProvenanceSummary } from "@/components/provenance-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ErrorState } from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { MovementLifeTimeline } from "@/components/movement/movement-life-timeline";
import { MovementPlaceEditorDialog } from "@/components/movement/movement-place-editor-dialog";
import {
  MovementDataBrowserBox,
  MovementPlacesBox,
  MovementSelectionBox,
  MovementSummaryBox,
  MovementTimelineBox
} from "@/components/workbench-boxes/movement/movement-boxes";
import {
  createMovementPlace,
  getLifeForce,
  getMovementAllTime,
  getMovementDay,
  getMovementMonth,
  getMovementSelectionAggregate,
  getMovementTripDetail,
  getMovementSettings,
  listMovementPlaces,
  patchMovementPlace,
  patchMovementSettings
} from "@/lib/api";
import {
  estimateMovementTripActionPointLoad,
  formatLifeForceAp,
  formatLifeForceRate
} from "@/lib/life-force-display";
import { formatLocalDateKey, getRuntimeTimeZone } from "@/lib/date-keys";
import { cn } from "@/lib/utils";
import type { MovementKnownPlace, MovementTripPointRecord } from "@/lib/types";

type MovementViewMode = "life" | "day" | "month" | "all_time";
type MonthMetric = "distanceMeters" | "movingSeconds" | "idleSeconds" | "caloriesKcal";
const DEFAULT_VISIBLE_PLACE_COUNT = 8;

function movementPlaceSourceLabel(source: string) {
  const normalized = source.trim().toLowerCase();
  if (normalized === "companion") {
    return "Companion";
  }
  if (normalized === "user") {
    return "User-defined";
  }
  if (normalized === "system") {
    return "Forge";
  }
  return source
    .trim()
    .replaceAll(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase()) || "Unknown";
}

type MovementPointDraft = {
  recordedAt: string;
  latitude: string;
  longitude: string;
  accuracyMeters: string;
  altitudeMeters: string;
  speedMps: string;
  isStopAnchor: boolean;
};

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(new Date(value));
}

function formatTimeRange(startedAt: string, endedAt: string) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  });
  return `${formatter.format(new Date(startedAt))} - ${formatter.format(new Date(endedAt))}`;
}

function durationLabel(seconds: number) {
  if (seconds >= 3600) {
    return `${(seconds / 3600).toFixed(1)}h`;
  }
  return `${Math.round(seconds / 60)}m`;
}

function distanceLabel(distanceMeters: number) {
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(distanceMeters)} m`;
}

function metricLabel(metric: MonthMetric, value: number) {
  if (metric === "distanceMeters") {
    return distanceLabel(value);
  }
  if (metric === "caloriesKcal") {
    return `${Math.round(value)} kcal`;
  }
  return durationLabel(value);
}

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function pointTimeBucket(recordedAt: string) {
  const hour = new Date(recordedAt).getHours();
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

function formatPointTimestamp(recordedAt: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(recordedAt));
}

function toLocalDateTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function buildPointDraft(point: MovementTripPointRecord): MovementPointDraft {
  return {
    recordedAt: toLocalDateTimeInput(point.recordedAt),
    latitude: String(point.latitude),
    longitude: String(point.longitude),
    accuracyMeters: point.accuracyMeters != null ? String(point.accuracyMeters) : "",
    altitudeMeters: point.altitudeMeters != null ? String(point.altitudeMeters) : "",
    speedMps: point.speedMps != null ? String(point.speedMps) : "",
    isStopAnchor: point.isStopAnchor
  };
}

function buildMovementPointSearchText(point: MovementTripPointRecord) {
  return normalize(
    [
      formatPointTimestamp(point.recordedAt),
      point.externalUid,
      point.isStopAnchor ? "stop anchor stop" : "path trace point",
      point.accuracyMeters != null ? `${Math.round(point.accuracyMeters)} meters accuracy` : "",
      pointTimeBucket(point.recordedAt)
    ].join(" ")
  );
}

function createMovementPointFilterOptions(
  points: MovementTripPointRecord[]
): FacetedTokenOption[] {
  const options = new Map<string, FacetedTokenOption>();
  options.set("anchor:stop", {
    id: "anchor:stop",
    label: "Stop anchors",
    description: "Only the canonical pause anchors",
    badge: <Badge tone="meta">Stop anchors</Badge>
  });
  options.set("anchor:path", {
    id: "anchor:path",
    label: "Path points",
    description: "Non-anchor trace points",
    badge: <Badge tone="meta">Path points</Badge>
  });
  options.set("accuracy:precise", {
    id: "accuracy:precise",
    label: "Precise",
    description: "GPS accuracy below 20m",
    badge: <Badge tone="meta">Precise</Badge>
  });
  options.set("accuracy:loose", {
    id: "accuracy:loose",
    label: "Loose accuracy",
    description: "GPS accuracy at or above 20m",
    badge: <Badge tone="meta">Loose accuracy</Badge>
  });
  points.forEach((point) => {
    const bucket = pointTimeBucket(point.recordedAt);
    if (!options.has(`time:${bucket}`)) {
      options.set(`time:${bucket}`, {
        id: `time:${bucket}`,
        label: bucket,
        description: "Recorded during this time band",
        badge: <Badge tone="meta" className="capitalize">{bucket}</Badge>
      });
    }
  });
  return [...options.values()];
}

function matchesMovementPointFilters(
  point: MovementTripPointRecord,
  selectedFilterIds: string[]
) {
  return selectedFilterIds.every((filterId) => {
    if (filterId === "anchor:stop") {
      return point.isStopAnchor;
    }
    if (filterId === "anchor:path") {
      return !point.isStopAnchor;
    }
    if (filterId === "accuracy:precise") {
      return point.accuracyMeters != null && point.accuracyMeters < 20;
    }
    if (filterId === "accuracy:loose") {
      return point.accuracyMeters == null || point.accuracyMeters >= 20;
    }
    if (filterId.startsWith("time:")) {
      return pointTimeBucket(point.recordedAt) === filterId.slice("time:".length);
    }
    return true;
  });
}

function normalizeExactPath(points: MovementTripPointRecord[]) {
  if (points.length === 0) {
    return [];
  }
  const minLat = Math.min(...points.map((point) => point.latitude));
  const maxLat = Math.max(...points.map((point) => point.latitude));
  const minLng = Math.min(...points.map((point) => point.longitude));
  const maxLng = Math.max(...points.map((point) => point.longitude));
  const latRange = Math.max(maxLat - minLat, 0.0001);
  const lngRange = Math.max(maxLng - minLng, 0.0001);
  return points.map((point) => ({
    x: 12 + ((point.longitude - minLng) / lngRange) * 76,
    y: 12 + (1 - (point.latitude - minLat) / latRange) * 76
  }));
}

function StylizedTripCard({
  curve,
  startLabel,
  endLabel,
  stopLabels
}: {
  curve: Array<{ x: number; y: number }>;
  startLabel: string;
  endLabel: string;
  stopLabels: string[];
}) {
  const path = curve
    .map((point, index) => `${index === 0 ? "M" : "Q"} ${point.x} ${point.y}`)
    .join(" ");

  return (
    <Card className="overflow-hidden rounded-[30px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
              Stylized trajectory
            </div>
            <InfoTooltip content="This graph is a softened trip trace. It emphasizes rhythm, stops, and endpoints instead of raw GPS jitter." />
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-medium)]">
            A softened path that prioritizes rhythm, stops, and landmarks over raw map noise.
          </div>
        </div>
        <Badge tone="signal">{startLabel} → {endLabel}</Badge>
      </div>
      <div className="mt-5 rounded-[26px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
        <svg viewBox="0 0 100 60" className="h-48 w-full">
          <defs>
            <filter id="movementGlow">
              <feGaussianBlur stdDeviation="1.8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <path
            d={path}
            fill="none"
            stroke="var(--ui-ink-medium)"
            strokeWidth="1.5"
            strokeDasharray="2.8 2.8"
            filter="url(#movementGlow)"
          />
          {curve.map((point, index) => (
            <g key={`${point.x}-${point.y}-${index}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r={index === 0 || index === curve.length - 1 ? 2.6 : 1.6}
                fill={index === 0 || index === curve.length - 1 ? "var(--ui-ink-strong)" : "var(--info)"}
              />
            </g>
          ))}
        </svg>
        <div className="mt-4 flex flex-wrap gap-2">
          {stopLabels.map((label) => (
            <Badge key={label} tone="default" className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {label}
            </Badge>
          ))}
        </div>
      </div>
    </Card>
  );
}

function ExactTripCard({ points }: { points: MovementTripPointRecord[] }) {
  const pathPoints = normalizeExactPath(points);
  const path = pathPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  return (
    <Card className="rounded-[30px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-5">
      <div className="flex items-center gap-2">
        <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
          Exact path
        </div>
        <InfoTooltip content="This keeps the recent raw location points. Use it when you want the literal recorded trace instead of the cleaned movement graph." />
      </div>
      <div className="mt-2 text-sm text-[var(--ui-ink-medium)]">
        Recent raw points preserved by the companion before long-term simplification.
      </div>
      <div className="mt-5 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
        <svg viewBox="0 0 100 100" className="h-52 w-full">
          <rect
            x="0"
            y="0"
            width="100"
            height="100"
            rx="18"
            fill="var(--ui-surface-2)"
          />
          <path d={path} fill="none" stroke="var(--info)" strokeWidth="1.6" />
          {pathPoints.map((point, index) => (
            <circle
              key={`${point.x}-${point.y}-${index}`}
              cx={point.x}
              cy={point.y}
              r={index === 0 || index === pathPoints.length - 1 ? 2 : 1.1}
              fill={index === 0 || index === pathPoints.length - 1 ? "var(--ui-ink-strong)" : "var(--info)"}
            />
          ))}
        </svg>
      </div>
    </Card>
  );
}

function MovementPointEditor({
  point,
  draft
}: {
  point: MovementTripPointRecord;
  draft: MovementPointDraft;
}) {
  return (
    <Card className="grid gap-4 rounded-[28px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
            Raw datapoint
          </div>
          <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
            {formatPointTimestamp(point.recordedAt)}
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-muted)]">
            Raw phone measurements are immutable in product UI. To change the visible movement story, create or edit user-defined boxes in the Life Timeline instead.
          </div>
        </div>
        <Badge tone={point.isStopAnchor ? "signal" : "meta"}>
          {point.isStopAnchor ? "Stop anchor" : "Path point"}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
            Recorded at
          </div>
          <Input
            type="datetime-local"
            value={draft.recordedAt}
            disabled
          />
        </div>
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
            Speed (m/s)
          </div>
          <Input
            value={draft.speedMps}
            disabled
            placeholder="Optional"
          />
        </div>
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
            Latitude
          </div>
          <Input
            value={draft.latitude}
            disabled
          />
        </div>
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
            Longitude
          </div>
          <Input
            value={draft.longitude}
            disabled
          />
        </div>
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
            Accuracy (m)
          </div>
          <Input
            value={draft.accuracyMeters}
            disabled
            placeholder="Optional"
          />
        </div>
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
            Altitude (m)
          </div>
          <Input
            value={draft.altitudeMeters}
            disabled
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          className={cn(
            "h-10 rounded-full border px-4",
            draft.isStopAnchor
              ? "border-[var(--primary)] bg-[var(--primary)]/16 text-[var(--ui-ink-strong)]"
              : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
          )}
          disabled
        >
          <Route className="mr-2 size-4" />
          {draft.isStopAnchor ? "Stop anchor" : "Path point"}
        </Button>
        <div className="text-sm text-[var(--ui-ink-muted)]">
          External id: <span className="text-[var(--ui-ink-medium)]">{point.externalUid}</span>
        </div>
      </div>

      <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-muted)]">
        This browser is read-only now. Raw points stay immutable so the web app and iPhone can both project the same repaired canonical boxes from the backend.
      </div>
    </Card>
  );
}

export function MovementPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const movementTimeZone = useMemo(() => getRuntimeTimeZone(), []);
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const [viewMode, setViewMode] = useState<MovementViewMode>("life");
  const [targetDate, setTargetDate] = useState(() => formatLocalDateKey());
  const [targetMonth, setTargetMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [showExactPath, setShowExactPath] = useState(false);
  const [dataModalOpen, setDataModalOpen] = useState(false);
  const [pointQuery, setPointQuery] = useState("");
  const [selectedPointFilterIds, setSelectedPointFilterIds] = useState<string[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [pointDraft, setPointDraft] = useState<MovementPointDraft | null>(null);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<{
    stayIds: string[];
    tripIds: string[];
  }>({ stayIds: [], tripIds: [] });
  const [placeEditorOpen, setPlaceEditorOpen] = useState(false);
  const [editingPlace, setEditingPlace] = useState<MovementKnownPlace | null>(null);
  const [placeSearch, setPlaceSearch] = useState("");
  const [showAllPlaces, setShowAllPlaces] = useState(false);
  const [monthMetric, setMonthMetric] = useState<MonthMetric>("distanceMeters");
  const pointListRef = useRef<HTMLDivElement | null>(null);

  const movementDayQuery = useQuery({
    queryKey: [
      "forge-movement-day",
      targetDate,
      movementTimeZone,
      ...selectedUserIds
    ],
    queryFn: async () =>
      (await getMovementDay({
        date: targetDate,
        timeZone: movementTimeZone,
        userIds: selectedUserIds
      }))
        .movement
  });
  const movementMonthQuery = useQuery({
    queryKey: ["forge-movement-month", targetMonth, ...selectedUserIds],
    queryFn: async () =>
      (await getMovementMonth({ month: targetMonth, userIds: selectedUserIds }))
        .movement
  });
  const movementAllTimeQuery = useQuery({
    queryKey: ["forge-movement-all-time", ...selectedUserIds],
    queryFn: async () => (await getMovementAllTime(selectedUserIds)).movement
  });
  const lifeForceQuery = useQuery({
    queryKey: ["forge-life-force", ...selectedUserIds],
    queryFn: async () => (await getLifeForce(selectedUserIds)).lifeForce
  });
  const movementSettingsQuery = useQuery({
    queryKey: ["forge-movement-settings", ...selectedUserIds],
    queryFn: async () => (await getMovementSettings(selectedUserIds)).settings
  });
  const placesQuery = useQuery({
    queryKey: ["forge-movement-places", ...selectedUserIds],
    queryFn: async () => (await listMovementPlaces(selectedUserIds)).places
  });
  const selectedTripQuery = useQuery({
    queryKey: ["forge-movement-trip", selectedTripId, ...selectedUserIds],
    queryFn: async () =>
      selectedTripId
        ? (await getMovementTripDetail(selectedTripId, selectedUserIds)).movement
        : null,
    enabled: Boolean(selectedTripId)
  });
  const selectionAggregateQuery = useQuery({
    queryKey: [
      "forge-movement-selection",
      targetDate,
      selectedSegmentIds.stayIds.join(","),
      selectedSegmentIds.tripIds.join(","),
      ...selectedUserIds
    ],
    queryFn: async () =>
      (
        await getMovementSelectionAggregate({
          ...selectedSegmentIds,
          userIds: selectedUserIds
        })
      ).movement,
    enabled:
      selectedSegmentIds.stayIds.length > 0 || selectedSegmentIds.tripIds.length > 0
  });

  const settingsMutation = useMutation({
    mutationFn: async (trackingEnabled: boolean) =>
      patchMovementSettings({ trackingEnabled }, selectedUserIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-day"] });
    }
  });
  const placeMutation = useMutation({
    mutationFn: async (input: {
      id?: string;
      label: string;
      latitude: number;
      longitude: number;
      radiusMeters: number;
      categoryTags: string[];
      visibility: "personal" | "shared";
    }) => {
      if (input.id) {
        return patchMovementPlace(input.id, input, selectedUserIds);
      }
      return createMovementPlace(input, selectedUserIds);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-places"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-day"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-all-time"] });
    }
  });

  const filteredPlaces = useMemo(() => {
    const items = placesQuery.data ?? [];
    const normalizedSearch = placeSearch.trim().toLowerCase();
    if (!normalizedSearch) {
      return items;
    }
    return items.filter((place) => {
      const haystack = [
        place.label,
        ...place.aliases,
        ...place.categoryTags
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [placeSearch, placesQuery.data]);

  const visiblePlaces =
    showAllPlaces || placeSearch.trim().length > 0
      ? filteredPlaces
      : filteredPlaces.slice(0, DEFAULT_VISIBLE_PLACE_COUNT);

  const pointFilterOptions = useMemo(
    () =>
      createMovementPointFilterOptions(selectedTripQuery.data?.trip.points ?? []),
    [selectedTripQuery.data?.trip.points]
  );
  const filteredPoints = useMemo(() => {
    const points = selectedTripQuery.data?.trip.points ?? [];
    const normalizedQuery = normalize(pointQuery);
    return [...points]
      .sort(
        (left, right) =>
          new Date(right.recordedAt).getTime() -
          new Date(left.recordedAt).getTime()
      )
      .filter((point) => {
        const matchesQuery =
          normalizedQuery.length === 0 ||
          buildMovementPointSearchText(point).includes(normalizedQuery);
        return (
          matchesQuery &&
          matchesMovementPointFilters(point, selectedPointFilterIds)
        );
      });
  }, [pointQuery, selectedPointFilterIds, selectedTripQuery.data?.trip.points]);
  const pointResultSummary = useMemo(() => {
    const total = selectedTripQuery.data?.trip.points.length ?? 0;
    if (total === 0) {
      return "No raw datapoints on this trip yet.";
    }
    if (filteredPoints.length === total && pointQuery.trim().length === 0 && selectedPointFilterIds.length === 0) {
      return `${total} datapoints visible`;
    }
    return `${filteredPoints.length} of ${total} datapoints visible`;
  }, [filteredPoints.length, pointQuery, selectedPointFilterIds.length, selectedTripQuery.data?.trip.points.length]);

  const rowVirtualizer = useVirtualizer({
    count: filteredPoints.length,
    getScrollElement: () => pointListRef.current,
    estimateSize: () => 96,
    overscan: 8
  });

  const activePoint =
    filteredPoints.find((point) => point.id === selectedPointId) ??
    selectedTripQuery.data?.trip.points.find((point) => point.id === selectedPointId) ??
    filteredPoints[0] ??
    selectedTripQuery.data?.trip.points[0] ??
    null;

  useEffect(() => {
    if (!dataModalOpen) {
      return;
    }
    if (!activePoint) {
      setSelectedPointId(null);
      setPointDraft(null);
      return;
    }
    setSelectedPointId(activePoint.id);
    setPointDraft(buildPointDraft(activePoint));
  }, [activePoint, dataModalOpen]);

  useEffect(() => {
    setPointQuery("");
    setSelectedPointFilterIds([]);
    setSelectedPointId(null);
    setPointDraft(null);
    setDataModalOpen(false);
  }, [selectedTripId]);

  if (
    movementDayQuery.isLoading ||
    movementMonthQuery.isLoading ||
    movementAllTimeQuery.isLoading ||
    movementSettingsQuery.isLoading ||
    placesQuery.isLoading
  ) {
    return (
      <SurfaceSkeleton
        eyebrow="Movement"
        title="Loading movement workspace"
        description="Reconstructing stays, trips, and place intelligence across Forge."
        columns={2}
        blocks={8}
      />
    );
  }

  if (
    movementDayQuery.isError ||
    movementMonthQuery.isError ||
    movementAllTimeQuery.isError ||
    movementSettingsQuery.isError ||
    placesQuery.isError ||
    !movementDayQuery.data ||
    !movementMonthQuery.data ||
    !movementAllTimeQuery.data ||
    !movementSettingsQuery.data
  ) {
    return (
      <ErrorState
        eyebrow="Movement"
        error={
          movementDayQuery.error ??
          movementMonthQuery.error ??
          movementAllTimeQuery.error ??
          movementSettingsQuery.error ??
          placesQuery.error ??
          new Error("Movement data unavailable")
        }
        onRetry={() => {
          void movementDayQuery.refetch();
          void movementMonthQuery.refetch();
          void movementAllTimeQuery.refetch();
          void movementSettingsQuery.refetch();
          void placesQuery.refetch();
        }}
      />
    );
  }

  const movementDay = movementDayQuery.data;
  const movementDayDurationSeconds =
    movementDay.dayDurationSeconds ?? 24 * 60 * 60;
  const movementDayTimeZone = movementDay.timeZone || movementTimeZone;
  const movementMonth = movementMonthQuery.data;
  const movementAllTime = movementAllTimeQuery.data;
  const movementSettings = movementSettingsQuery.data;
  const activeProvenance =
    viewMode === "month"
      ? movementMonth.provenance
      : viewMode === "all_time"
        ? movementAllTime.provenance
        : movementDay.provenance;
  const movementDaySegments = movementDay.segments.filter((segment, index, segments) => {
    const key = `${segment.kind}:${segment.id}:${segment.startedAt}:${segment.endedAt}`;
    return (
      segments.findIndex((candidate) =>
        `${candidate.kind}:${candidate.id}:${candidate.startedAt}:${candidate.endedAt}` === key
      ) === index
    );
  });
  const selectionAggregate =
    selectionAggregateQuery.data ?? movementDay.selectionAggregate;
  const fullyAttributedDayTrips = movementDay.trips.filter(
    (trip) =>
      Date.parse(trip.startedAt) >= Date.parse(movementDay.dayStartAt) &&
      Date.parse(trip.endedAt) <= Date.parse(movementDay.dayEndAt)
  );
  const movementDayAp = fullyAttributedDayTrips.reduce(
    (sum, trip) => sum + estimateMovementTripActionPointLoad(trip).totalAp,
    0
  );

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="project"
        title="Movement"
        description="Turn passive place and travel signals into a real Forge domain: day rhythm, travel arcs, known landmarks, linked work, and reflective evidence."
        badge={`${movementDay.summary.tripCount} trips today`}
        actions={
          <div className="flex flex-wrap gap-2">
            {(["life", "day", "month", "all_time"] as const).map((mode) => (
              <Button
                key={mode}
                variant="ghost"
                className={cn(
                  "h-9 rounded-full border px-4 text-sm",
                  viewMode === mode
                    ? "border-[var(--primary)] bg-[var(--primary)]/16 text-[var(--ui-ink-strong)]"
                    : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                )}
                onClick={() => setViewMode(mode)}
              >
                {mode === "all_time"
                  ? "All time"
                  : mode === "life"
                    ? "Life"
                    : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Button>
            ))}
          </div>
        }
      />

      {activeProvenance ? (
        <ProvenanceSummary provenance={activeProvenance} />
      ) : null}

      <Card
        className="grid grid-cols-2 gap-3 rounded-[28px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-3 sm:p-4 md:grid-cols-3"
        data-testid="movement-life-force-summary"
      >
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-muted)] sm:text-[11px] sm:tracking-[0.18em]">
            Movement AP today
          </div>
          <div className="mt-2 text-2xl font-semibold text-[var(--ui-ink-strong)] sm:text-3xl">
            {formatLifeForceAp(movementDayAp)}
          </div>
          <div className="mt-2 hidden text-sm text-[var(--ui-ink-muted)] sm:block">
            {movementDay.summary.boundaryCrossingTripCount > 0
              ? `${movementDay.summary.boundaryCrossingTripCount} boundary-crossing trip estimate excluded because Forge cannot divide the stored aggregate exactly.`
              : "Trips and transitions now contribute to the same Action Point ledger as work, habits, and notes."}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-muted)] sm:text-[11px] sm:tracking-[0.18em]">
            Typical trip drain
          </div>
          <div className="mt-2 text-xl font-semibold text-[var(--primary)] sm:text-2xl">
            {fullyAttributedDayTrips[0]
              ? formatLifeForceRate(
                  estimateMovementTripActionPointLoad(fullyAttributedDayTrips[0]).rateApPerHour
                )
              : "0 AP/h"}
          </div>
          <div className="mt-2 hidden text-sm text-[var(--ui-ink-muted)] sm:block">
            Movement uses a MET-like drain under the hood, translated into Forge Action Points.
          </div>
        </div>
        <div className="col-span-2 border-t border-[var(--ui-border-subtle)] pt-3 md:col-span-1 md:border-0 md:pt-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-muted)] sm:text-[11px] sm:tracking-[0.18em]">
            Life Force sync
          </div>
          <div className="mt-1 text-xl font-semibold text-[var(--ui-ink-strong)] sm:mt-2 sm:text-2xl">
            {lifeForceQuery.data
              ? `${Math.round(lifeForceQuery.data.spentTodayAp ?? 0)}/${Math.round(lifeForceQuery.data.dailyBudgetAp ?? 0)} AP`
              : "Loading..."}
          </div>
          <div className="mt-1 text-xs text-[var(--ui-ink-muted)] sm:mt-2 sm:text-sm">
            {lifeForceQuery.data
              ? `${formatLifeForceRate(lifeForceQuery.data.instantFreeApPerHour)} free right now`
              : "Movement can now be read against today’s live capacity."}
          </div>
        </div>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(20rem,0.95fr)]">
        <MovementSummaryBox>
          <Card className="overflow-hidden rounded-[30px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
                  Movement operating mode
                </div>
                <InfoTooltip content="This is the passive capture state of the movement system: whether tracking is running, how much is published into Forge, and how aggressive retention is." />
              </div>
              <div className="mt-2 text-[clamp(1.05rem,1.8vw,1.35rem)] text-[var(--ui-ink-strong)]">
                Background stays and trips as structured life evidence
              </div>
              <div className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ui-ink-muted)]">
                The companion samples quietly while stationary, switches to denser trip capture when you move, and keeps only simplified long-term traces.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="signal">
                {movementSettings.trackingEnabled ? "Tracking on" : "Tracking off"}
              </Badge>
              <Badge tone="default" className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                {movementSettings.publishMode.replaceAll("_", " ")}
              </Badge>
              <Button
                variant="ghost"
                className="h-9 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4"
                onClick={() =>
                  settingsMutation.mutate(!movementSettings.trackingEnabled)
                }
              >
                {movementSettings.trackingEnabled ? "Pause passive capture" : "Enable passive capture"}
              </Button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
                Distance today
              </div>
              <div className="mt-3 font-display text-2xl text-[var(--ui-ink-strong)] sm:text-4xl">
                {distanceLabel(movementDay.summary.totalDistanceMeters)}
              </div>
              <div className="mt-2 hidden text-sm text-[var(--ui-ink-muted)] sm:block">
                {movementDay.summary.boundaryCrossingTripCount > 0
                  ? "Boundary-crossing trip distance is excluded because the stored aggregate cannot be split exactly."
                  : "Across trips, stops, and linked place changes."}
              </div>
            </Card>
            <Card className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
                Idle time
              </div>
              <div className="mt-3 font-display text-2xl text-[var(--ui-ink-strong)] sm:text-4xl">
                {durationLabel(movementDay.summary.totalIdleSeconds)}
              </div>
              <div className="mt-2 hidden text-sm text-[var(--ui-ink-muted)] sm:block">
                Time spent settled enough to count as a real stay.
              </div>
            </Card>
            <Card className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
                Estimated phone time
              </div>
              <div className="mt-3 font-display text-2xl text-[var(--ui-ink-strong)] sm:text-4xl">
                {durationLabel(movementDay.summary.estimatedScreenTimeSeconds)}
              </div>
              <div className="mt-2 hidden text-sm text-[var(--ui-ink-muted)] sm:block">
                Estimated from hourly Screen Time bins, not exact foreground traces.
              </div>
            </Card>
            <Card className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
                Known places
              </div>
              <div className="mt-3 font-display text-2xl text-[var(--ui-ink-strong)] sm:text-4xl">
                {movementDay.summary.knownPlaceCount}
              </div>
              <div className="mt-2 hidden text-sm text-[var(--ui-ink-muted)] sm:block">
                Shared between Forge and the iPhone companion.
              </div>
            </Card>
            <Card className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
                Missing data
              </div>
              <div className="mt-3 font-display text-2xl text-[var(--ui-ink-strong)] sm:text-4xl">
                {durationLabel(movementDay.summary.missingDurationSeconds)}
              </div>
              <div className="mt-2 hidden text-sm text-[var(--ui-ink-muted)] sm:block">
                {movementDay.summary.missingCount} grey gap{movementDay.summary.missingCount === 1 ? "" : "s"} where Forge had over one hour without enough movement signal.
              </div>
            </Card>
            <Card className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
                Repaired gaps
              </div>
              <div className="mt-3 font-display text-2xl text-[var(--ui-ink-strong)] sm:text-4xl">
                {durationLabel(movementDay.summary.repairedGapDurationSeconds)}
              </div>
              <div className="mt-2 hidden text-sm text-[var(--ui-ink-muted)] sm:block">
                {movementDay.summary.repairedGapCount} inferred span{movementDay.summary.repairedGapCount === 1 ? "" : "s"} classified as stay or move instead of leaving blank holes in the day.
              </div>
            </Card>
            <Card className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
                Continued stays
              </div>
              <div className="mt-3 font-display text-2xl text-[var(--ui-ink-strong)] sm:text-4xl">
                {durationLabel(movementDay.summary.continuedStayDurationSeconds)}
              </div>
              <div className="mt-2 hidden text-sm text-[var(--ui-ink-muted)] sm:block">
                {movementDay.summary.continuedStayCount} short stationary span{movementDay.summary.continuedStayCount === 1 ? "" : "s"} carried forward so quiet home time stays continuous instead of disappearing.
              </div>
            </Card>
          </div>
          </Card>
        </MovementSummaryBox>

        <MovementSelectionBox>
          <Card className="rounded-[30px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-5">
          <div className="flex items-center gap-2">
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
              Selection aggregate
            </div>
            <InfoTooltip content="When you select stays or trips, Forge totals their span, distance, work overlap, notes, and places here." />
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-muted)]">
            Select any combination of stays and trips to sum movement, time, and work evidence.
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                Span
              </div>
              <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                {durationLabel(selectionAggregate.durationSeconds)}
              </div>
            </div>
            <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                Distance
              </div>
              <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                {distanceLabel(selectionAggregate.distanceMeters)}
              </div>
            </div>
            <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                Work overlap
              </div>
              <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                {durationLabel(selectionAggregate.trackedWorkSeconds)}
              </div>
            </div>
            <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                Notes
              </div>
              <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                {selectionAggregate.noteCount}
              </div>
            </div>
            <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                Estimated phone time
              </div>
              <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                {durationLabel(selectionAggregate.estimatedScreenTimeSeconds)}
              </div>
            </div>
            <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                Pickups
              </div>
              <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                {selectionAggregate.pickupCount}
              </div>
            </div>
            <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                Notifications
              </div>
              <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                {selectionAggregate.notificationCount}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {selectionAggregate.placeLabels.map((label) => (
              <Badge key={label} tone="default" className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                {label}
              </Badge>
            ))}
          </div>
          {selectionAggregate.topApps.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {selectionAggregate.topApps.map((app) => (
                <Badge key={app.id} tone="default" className="bg-[var(--ui-info-soft)] text-[var(--ui-ink-medium)]">
                  {(app.displayName || app.bundleIdentifier) + " · " + durationLabel(app.totalActivitySeconds)}
                </Badge>
              ))}
            </div>
          ) : null}
          {selectionAggregate.topCategories.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {selectionAggregate.topCategories.map((category) => (
                <Badge key={category.id} tone="default" className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                  {category.categoryLabel}
                </Badge>
              ))}
            </div>
          ) : null}
          </Card>
        </MovementSelectionBox>
      </section>

      {viewMode === "life" ? (
        <MovementTimelineBox>
          <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
                Life graph
              </div>
              <InfoTooltip content="This graph shows the movement road of your life: stays are blocks, moves connect them, and the hour/day lines live in the background. Click a segment for details, then use edit when you want to correct it." />
            </div>
          </div>
          <MovementLifeTimeline userIds={selectedUserIds} />
          </section>
        </MovementTimelineBox>
      ) : null}

      {viewMode === "day" ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(22rem,1fr)]">
          <Card className="rounded-[30px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
                    Day strip
                  </div>
                  <InfoTooltip content="A compressed local-day strip. Each segment keeps its true elapsed duration across daylight-saving changes, while the whole calendar day stays navigable on one line." />
                </div>
                <div className="mt-2 text-sm text-[var(--ui-ink-muted)]">
                  Local midnight to next midnight in {movementDayTimeZone}. This date spans {movementDayDurationSeconds / 3_600} elapsed hours.
                </div>
              </div>
              <Input
                type="date"
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
                className="w-[11rem]"
              />
            </div>
            <div className="mt-6 overflow-x-auto pb-2">
              <div className="w-full min-w-full sm:min-w-[52rem]">
                <div className="mb-3 flex justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                  <span>00:00</span>
                  <span>{movementDayDurationSeconds / 3_600} elapsed hours</span>
                  <span>Next 00:00</span>
                </div>
                <div className="flex h-28 items-stretch overflow-hidden rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-2">
                  {movementDaySegments.map((segment, index) => {
                    const width = Math.max(
                      9,
                      (segment.durationSeconds / movementDayDurationSeconds) * 100
                    );
                    const active =
                      segment.kind === "stay"
                        ? selectedSegmentIds.stayIds.includes(segment.id)
                        : segment.kind === "trip"
                          ? selectedSegmentIds.tripIds.includes(segment.id)
                          : false;
                    return (
                      <button
                        key={`${segment.kind}:${segment.id}:${segment.startedAt}:${segment.endedAt}:${index}`}
                        type="button"
                        className={cn(
                          "relative flex min-w-0 flex-col justify-between rounded-[22px] border px-3 py-2 text-left transition sm:min-w-[5.5rem]",
                          segment.kind === "missing"
                            ? "border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-3)]"
                            : active
                              ? "border-[color-mix(in_srgb,var(--info)_34%,transparent)] bg-[var(--ui-info-soft)]"
                              : "border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-3)]"
                        )}
                        style={{ width: `${width}%` }}
                        onClick={() => {
                          if (segment.kind === "missing") {
                            return;
                          }
                          setSelectedSegmentIds((current) => {
                            const stayIds = new Set(current.stayIds);
                            const tripIds = new Set(current.tripIds);
                            if (segment.kind === "stay") {
                              if (stayIds.has(segment.id)) {
                                stayIds.delete(segment.id);
                              } else {
                                stayIds.add(segment.id);
                              }
                            } else {
                              if (tripIds.has(segment.id)) {
                                tripIds.delete(segment.id);
                              } else {
                                tripIds.add(segment.id);
                                setSelectedTripId(segment.id);
                              }
                            }
                            return {
                              stayIds: [...stayIds],
                              tripIds: [...tripIds]
                            };
                          });
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge
                            tone={
                              segment.kind === "trip"
                                ? "signal"
                                : segment.kind === "missing"
                                  ? "meta"
                                  : "default"
                            }
                            className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                          >
                            {segment.kind === "missing" ? "gap" : segment.kind}
                          </Badge>
                          <span className="text-[11px] text-[var(--ui-ink-muted)]">
                            {durationLabel(segment.durationSeconds)}
                          </span>
                        </div>
                        <div>
                          <div className="line-clamp-2 text-sm font-semibold text-[var(--ui-ink-strong)]">
                            {segment.label}
                          </div>
                          <div className="mt-1 text-[12px] leading-5 text-[var(--ui-ink-muted)]">
                            {segment.subtitle}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone="signal">{formatDateLabel(targetDate)}</Badge>
              <Badge tone="default" className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                {movementDay.summary.tripCount} trips
              </Badge>
              <Badge tone="default" className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                {movementDay.summary.stayCount} stays
              </Badge>
              <Badge tone="meta">
                {movementDay.summary.missingCount} gaps
              </Badge>
            </div>
          </Card>

          <div className="grid gap-4">
            {selectedTripQuery.data ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
                    Selected trip
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      className="h-9 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4"
                      onClick={() => setShowExactPath((current) => !current)}
                    >
                      {showExactPath ? "Stylized graph" : "Exact path"}
                    </Button>
                  </div>
                </div>
                {showExactPath ? (
                  <ExactTripCard points={selectedTripQuery.data.trip.points} />
                ) : (
                  <StylizedTripCard
                    curve={selectedTripQuery.data.stylizedPath.curve}
                    startLabel={selectedTripQuery.data.stylizedPath.startLabel}
                    endLabel={selectedTripQuery.data.stylizedPath.endLabel}
                    stopLabels={selectedTripQuery.data.stylizedPath.stops.map((stop) => stop.label)}
                  />
                )}
                <Card className="rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-5">
                  <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
                    Trip context
                  </div>
                  {(() => {
                    const apLoad = estimateMovementTripActionPointLoad(selectedTripQuery.data.trip);
                    return (
                      <>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge tone="signal">
                            {distanceLabel(selectedTripQuery.data.trip.distanceMeters)}
                          </Badge>
                          <Badge tone="default" className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                            {selectedTripQuery.data.trip.activityType || selectedTripQuery.data.trip.travelMode}
                          </Badge>
                          <Badge tone="default" className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                            {durationLabel(selectedTripQuery.data.trip.durationSeconds)}
                          </Badge>
                          <Badge tone="default" className="bg-[var(--primary)]/14 text-[var(--primary)]">
                            {formatLifeForceRate(apLoad.rateApPerHour)}
                          </Badge>
                          <Badge tone="default" className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                            {formatLifeForceAp(apLoad.totalAp)}
                          </Badge>
                        </div>
                      </>
                    );
                  })()}
                  <div className="mt-4 text-sm leading-6 text-[var(--ui-ink-muted)]">
                    {formatTimeRange(
                      selectedTripQuery.data.trip.startedAt,
                      selectedTripQuery.data.trip.endedAt
                    )}
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                        Hourly estimate
                      </div>
                      <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                        {durationLabel(selectedTripQuery.data.trip.estimatedScreenTimeSeconds)}
                      </div>
                    </div>
                    <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                        Pickups
                      </div>
                      <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                        {selectedTripQuery.data.trip.pickupCount}
                      </div>
                    </div>
                    <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                        Notifications
                      </div>
                      <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                        {selectedTripQuery.data.trip.notificationCount}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs leading-5 text-[var(--ui-ink-muted)]">
                    Derived from Screen Time hourly bins, not exact foreground traces.
                  </div>
                  {selectedTripQuery.data.trip.topApps.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedTripQuery.data.trip.topApps.map((app) => (
                        <Badge key={app.id} tone="default" className="bg-[var(--ui-info-soft)] text-[var(--ui-ink-medium)]">
                          {(app.displayName || app.bundleIdentifier) + " · " + durationLabel(app.totalActivitySeconds)}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {selectedTripQuery.data.trip.topCategories.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedTripQuery.data.trip.topCategories.map((category) => (
                        <Badge key={category.id} tone="default" className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                          {category.categoryLabel}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </Card>
              </>
            ) : (
              <Card className="rounded-[30px] border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-6 text-[var(--ui-ink-muted)]">
                Select a trip segment to open the stylized trajectory card and exact path toggle.
              </Card>
            )}
          </div>
        </section>
      ) : null}

      {viewMode === "month" ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.85fr)]">
          <Card className="rounded-[30px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
                    Month view
                  </div>
                  <InfoTooltip content="This chart stays quantitative. Switch the metric to compare daily distance, moving time, idle time, or calories across the month." />
                </div>
                <div className="mt-2 text-sm text-[var(--ui-ink-muted)]">
                  Switch the Y-axis between motion, idle time, and energy without losing the same monthly frame.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Input
                  type="month"
                  value={targetMonth}
                  onChange={(event) => setTargetMonth(event.target.value)}
                  className="w-[10.5rem]"
                />
                {(["distanceMeters", "movingSeconds", "idleSeconds", "caloriesKcal"] as const).map((metric) => (
                  <Button
                    key={metric}
                    variant="ghost"
                    className={cn(
                      "h-9 rounded-full border px-4 text-sm",
                      monthMetric === metric
                        ? "border-[var(--primary)] bg-[var(--primary)]/14 text-[var(--ui-ink-strong)]"
                        : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                    )}
                    onClick={() => setMonthMetric(metric)}
                  >
                    {metric === "distanceMeters"
                      ? "Distance"
                      : metric === "movingSeconds"
                        ? "Moving"
                        : metric === "idleSeconds"
                          ? "Idle"
                          : "Calories"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="mt-6 h-[24rem]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={movementMonth.days}>
                  <defs>
                    <linearGradient id="movementMonthFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="var(--info)" stopOpacity={0.7} />
                      <stop offset="100%" stopColor="var(--info)" stopOpacity={0.08} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--ui-border-subtle)" vertical={false} />
                  <XAxis
                    dataKey="dateKey"
                    tick={{ fill: "var(--ui-ink-muted)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "var(--ui-ink-muted)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--ui-surface-modal)",
                      border: "1px solid var(--ui-border-subtle)",
                      borderRadius: 16
                    }}
                    itemStyle={{ color: "var(--ui-ink-strong)" }}
                    labelStyle={{ color: "var(--ui-ink-medium)" }}
                    formatter={(value) =>
                      metricLabel(monthMetric, Number(value))
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey={monthMetric}
                    stroke="var(--info)"
                    fill="url(#movementMonthFill)"
                    strokeWidth={2.4}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="rounded-[30px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-5">
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
              Month totals
            </div>
            <div className="mt-5 grid gap-3">
              <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                  Distance
                </div>
                <div className="mt-2 text-2xl text-[var(--ui-ink-strong)]">
                  {distanceLabel(movementMonth.totals.distanceMeters)}
                </div>
              </div>
              <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                  Moving time
                </div>
                <div className="mt-2 text-2xl text-[var(--ui-ink-strong)]">
                  {durationLabel(movementMonth.totals.movingSeconds)}
                </div>
              </div>
              <div className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                  Settled time
                </div>
                <div className="mt-2 text-2xl text-[var(--ui-ink-strong)]">
                  {durationLabel(movementMonth.totals.idleSeconds)}
                </div>
              </div>
            </div>
          </Card>
        </section>
      ) : null}

      {viewMode === "all_time" ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.95fr)]">
          <Card className="rounded-[30px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                  Trips
                </div>
                <div className="mt-2 text-3xl text-[var(--ui-ink-strong)]">
                  {movementAllTime.summary.tripCount}
                </div>
              </Card>
              <Card className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                  Known places
                </div>
                <div className="mt-2 text-3xl text-[var(--ui-ink-strong)]">
                  {movementAllTime.summary.knownPlaceCount}
                </div>
              </Card>
              <Card className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                  Distance
                </div>
                <div className="mt-2 text-3xl text-[var(--ui-ink-strong)]">
                  {distanceLabel(movementAllTime.summary.totalDistanceMeters)}
                </div>
              </Card>
              <Card className="rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                  Countries
                </div>
                <div className="mt-2 text-3xl text-[var(--ui-ink-strong)]">
                  {movementAllTime.summary.visitedCountries}
                </div>
              </Card>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {movementAllTime.recentTrips.map((trip) => (
                <button
                  key={trip.id}
                  type="button"
                  className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 text-left transition hover:bg-[var(--ui-surface-3)]"
                  onClick={() => {
                    setViewMode("day");
                    setSelectedTripId(trip.id);
                  }}
                >
                  {(() => {
                    const apLoad = estimateMovementTripActionPointLoad({
                      startedAt: trip.startedAt,
                      endedAt: new Date(new Date(trip.startedAt).getTime() + 60 * 60 * 1000).toISOString(),
                      expectedMet: 2
                    });
                    return (
                      <>
                        <div className="text-xs uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                          Recent travel
                        </div>
                        <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">{trip.label || "Untitled trip"}</div>
                        <div className="mt-1 text-sm text-[var(--ui-ink-muted)]">
                          {distanceLabel(trip.distanceMeters)} · {trip.activityType || "travel"}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge tone="default" className="bg-[var(--primary)]/14 text-[var(--primary)]">
                            {formatLifeForceRate(apLoad.rateApPerHour)}
                          </Badge>
                        </div>
                      </>
                    );
                  })()}
                </button>
              ))}
            </div>
          </Card>

          <Card className="rounded-[30px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-5">
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
              Place categories
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {movementAllTime.categoryBreakdown.map((entry) => (
                <Badge key={entry.tag} tone="default" className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                  {entry.tag} · {entry.count}
                </Badge>
              ))}
            </div>
          </Card>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.95fr)]">
        <MovementPlacesBox>
          <Card className="rounded-[30px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
                  Known places
                </div>
                <InfoTooltip content="Known places turn raw stationary spans into named contexts like home, work, gym, nature, or any custom place tag you want Forge to remember." />
              </div>
              <div className="mt-2 text-sm text-[var(--ui-ink-muted)]">
                These landmarks anchor stays, travel XP, and contextual reasoning in both Forge and the companion. Seeded tags like home, workplace, gym, holiday, grocery, or nature matter for downstream calculations, but place tags stay open-ended.
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                value={placeSearch}
                onChange={(event) => setPlaceSearch(event.target.value)}
                placeholder="Search places"
                className="w-[11rem]"
              />
              <Button
                onClick={() => {
                  setEditingPlace(null);
                  setPlaceEditorOpen(true);
                }}
              >
                Add place
              </Button>
            </div>
          </div>
          <div className="mt-5 grid gap-3">
            {visiblePlaces.map((place) => (
              <button
                key={place.id}
                type="button"
                className="flex items-start justify-between gap-3 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 text-left transition hover:bg-[var(--ui-surface-3)]"
                onClick={() => {
                  setEditingPlace(place);
                  setPlaceEditorOpen(true);
                }}
              >
                <div>
                  <div className="text-lg text-[var(--ui-ink-strong)]">{place.label}</div>
                  <div className="mt-1 text-sm text-[var(--ui-ink-muted)]">
                    {place.visibility === "personal"
                      ? "Exact coordinates hidden in overview"
                      : `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`} · radius {Math.round(place.radiusMeters)} m
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone="default" className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                      {place.visibility === "personal"
                        ? "Personal location"
                        : "Shared location"}
                    </Badge>
                    <Badge tone="default" className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                      Source: {movementPlaceSourceLabel(place.source)}
                    </Badge>
                    {place.categoryTags.map((tag) => (
                      <Badge key={tag} tone="default" className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
                <PencilLine className="mt-1 size-4 text-[var(--ui-ink-muted)]" />
              </button>
            ))}
            {placeSearch.trim().length === 0 &&
            filteredPlaces.length > DEFAULT_VISIBLE_PLACE_COUNT ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => setShowAllPlaces((current) => !current)}
              >
                {showAllPlaces ? (
                  <ChevronUp className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
                {showAllPlaces
                  ? "Show fewer places"
                  : `Show ${filteredPlaces.length - DEFAULT_VISIBLE_PLACE_COUNT} more places`}
              </Button>
            ) : null}
          </div>
          </Card>
        </MovementPlacesBox>

        <Card className="rounded-[30px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] p-5">
          <div className="flex items-center gap-2">
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
              Movement help
            </div>
            <InfoTooltip content="Most movement surfaces on this page have help buttons. Use them to understand the graph, the day strip, the month chart, and the place system without keeping a large prose block on screen." />
          </div>
          <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-muted)]">
            Use the small help icons across this page for graph explanations, timeline semantics, and metric meanings.
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">Life graph</Badge>
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">Day strip</Badge>
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">Month chart</Badge>
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">Known places</Badge>
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">Selection aggregate</Badge>
          </div>
        </Card>
      </section>

      {selectedTripQuery.data ? (
        <SheetScaffold
          open={dataModalOpen}
          onOpenChange={(open) => {
            setDataModalOpen(open);
            if (!open) {
              setPointQuery("");
              setSelectedPointFilterIds([]);
              setSelectedPointId(null);
              setPointDraft(null);
            }
          }}
          eyebrow="Movement data"
          title={selectedTripQuery.data.trip.label || "Trip datapoints"}
          description="Inspect the raw datapoints behind this trip. Raw measurements are read-only here; visible movement corrections now happen through canonical user-defined boxes."
        >
          <MovementDataBrowserBox>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
            <div className="grid gap-4">
              <FacetedTokenSearch
                title="Datapoint browser"
                description="Search raw points by time band, anchor status, or accuracy before opening the point editor."
                query={pointQuery}
                onQueryChange={setPointQuery}
                options={pointFilterOptions}
                selectedOptionIds={selectedPointFilterIds}
                onSelectedOptionIdsChange={setSelectedPointFilterIds}
                resultSummary={pointResultSummary}
                placeholder="Search timestamps, accuracy, point ids, or filter chips"
                emptyStateMessage="Keep typing or pick a time/quality chip to narrow the trip datapoints."
              />

              <Card className="grid gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                      Raw datapoints
                    </div>
                    <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                      Open a point to correct or delete it.
                    </div>
                  </div>
                  <Badge tone="meta">{pointResultSummary}</Badge>
                </div>

                <div
                  ref={pointListRef}
                  className="h-[34rem] overflow-y-auto rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]"
                >
                  {filteredPoints.length === 0 ? (
                    <div className="flex h-full items-center justify-center p-6 text-center text-sm leading-6 text-[var(--ui-ink-muted)]">
                      No datapoint matches the current search. Clear some filters or search by time, anchor type, or accuracy.
                    </div>
                  ) : (
                    <div
                      className="relative w-full"
                      style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                    >
                      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const point = filteredPoints[virtualRow.index]!;
                        return (
                          <div
                            key={point.id}
                            className="absolute left-0 top-0 w-full px-3 py-2"
                            style={{
                              transform: `translateY(${virtualRow.start}px)`
                            }}
                          >
                            <button
                              type="button"
                              className={cn(
                                "grid w-full gap-3 rounded-[20px] border px-4 py-3 text-left transition",
                                selectedPointId === point.id
                                  ? "border-[color-mix(in_srgb,var(--info)_34%,transparent)] bg-[var(--ui-info-soft)]"
                                  : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] hover:bg-[var(--ui-surface-3)]"
                              )}
                              onClick={() => {
                                setSelectedPointId(point.id);
                                setPointDraft(buildPointDraft(point));
                              }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 text-[var(--ui-ink-strong)]">
                                    <Clock3 className="size-4 shrink-0 text-[var(--primary)]" />
                                    <span className="truncate text-base font-medium">
                                      {formatPointTimestamp(point.recordedAt)}
                                    </span>
                                  </div>
                                  <div className="mt-2 text-sm text-[var(--ui-ink-muted)]">
                                    {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
                                  </div>
                                </div>
                                <Badge tone={point.isStopAnchor ? "signal" : "meta"}>
                                  {point.isStopAnchor ? "Stop anchor" : "Path point"}
                                </Badge>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Badge tone="meta" className="capitalize">
                                  {pointTimeBucket(point.recordedAt)}
                                </Badge>
                                {point.accuracyMeters != null ? (
                                  <Badge tone="meta">
                                    {Math.round(point.accuracyMeters)} m accuracy
                                  </Badge>
                                ) : null}
                                {point.speedMps != null ? (
                                  <Badge tone="meta">
                                    {point.speedMps.toFixed(1)} m/s
                                  </Badge>
                                ) : null}
                              </div>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {activePoint && pointDraft ? (
              <MovementPointEditor
                point={activePoint}
                draft={pointDraft}
              />
            ) : (
              <Card className="rounded-[28px] border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-6 text-[var(--ui-ink-muted)]">
                Pick a datapoint to inspect its raw measurement details. To correct what the user sees, use canonical user-defined movement boxes in the Life Timeline.
              </Card>
            )}
            </div>
          </MovementDataBrowserBox>
        </SheetScaffold>
      ) : null}

      <MovementPlaceEditorDialog
        open={placeEditorOpen}
        onOpenChange={setPlaceEditorOpen}
        place={editingPlace}
        onSave={async (input) => {
          await placeMutation.mutateAsync(input);
        }}
      />
    </div>
  );
}
