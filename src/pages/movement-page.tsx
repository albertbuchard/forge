import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Clock3,
  Route,
  Save,
  PencilLine,
  Trash2,
  X
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ErrorState } from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { MovementLifeTimeline } from "@/components/movement/movement-life-timeline";
import {
  createMovementPlace,
  deleteMovementTripPoint,
  getMovementAllTime,
  getMovementDay,
  getMovementMonth,
  getMovementSelectionAggregate,
  getMovementTripDetail,
  getMovementSettings,
  listMovementPlaces,
  patchMovementTripPoint,
  patchMovementPlace,
  patchMovementSettings
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type { MovementKnownPlace, MovementTripPointRecord } from "@/lib/types";

type MovementViewMode = "life" | "day" | "month" | "all_time";
type MonthMetric = "distanceMeters" | "movingSeconds" | "idleSeconds" | "caloriesKcal";
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

function fromLocalDateTimeInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
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
    <Card className="overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(114,204,255,0.18),transparent_44%),linear-gradient(180deg,rgba(6,11,26,0.98),rgba(8,14,28,0.92))] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
              Stylized trajectory
            </div>
            <InfoTooltip content="This graph is a softened trip trace. It emphasizes rhythm, stops, and endpoints instead of raw GPS jitter." />
          </div>
          <div className="mt-2 text-sm text-white/64">
            A softened path that prioritizes rhythm, stops, and landmarks over raw map noise.
          </div>
        </div>
        <Badge tone="signal">{startLabel} → {endLabel}</Badge>
      </div>
      <div className="mt-5 rounded-[26px] border border-white/8 bg-[rgba(255,255,255,0.03)] p-4">
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
            stroke="rgba(255,255,255,0.86)"
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
                fill={index === 0 || index === curve.length - 1 ? "#ffffff" : "rgba(170,229,255,0.96)"}
              />
            </g>
          ))}
        </svg>
        <div className="mt-4 flex flex-wrap gap-2">
          {stopLabels.map((label) => (
            <Badge key={label} tone="default" className="bg-white/[0.06] text-white/74">
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
    <Card className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,13,25,0.95),rgba(10,17,30,0.88))] p-5">
      <div className="flex items-center gap-2">
        <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
          Exact path
        </div>
        <InfoTooltip content="This keeps the recent raw location points. Use it when you want the literal recorded trace instead of the cleaned movement graph." />
      </div>
      <div className="mt-2 text-sm text-white/62">
        Recent raw points preserved by the companion before long-term simplification.
      </div>
      <div className="mt-5 rounded-[24px] border border-white/8 bg-[rgba(255,255,255,0.03)] p-3">
        <svg viewBox="0 0 100 100" className="h-52 w-full">
          <rect
            x="0"
            y="0"
            width="100"
            height="100"
            rx="18"
            fill="rgba(255,255,255,0.02)"
          />
          <path d={path} fill="none" stroke="rgba(92,225,230,0.95)" strokeWidth="1.6" />
          {pathPoints.map((point, index) => (
            <circle
              key={`${point.x}-${point.y}-${index}`}
              cx={point.x}
              cy={point.y}
              r={index === 0 || index === pathPoints.length - 1 ? 2 : 1.1}
              fill={index === 0 || index === pathPoints.length - 1 ? "#ffffff" : "rgba(92,225,230,0.9)"}
            />
          ))}
        </svg>
      </div>
    </Card>
  );
}

function MovementPointEditor({
  point,
  draft,
  saving,
  deleting,
  onDraftChange,
  onSave,
  onDelete
}: {
  point: MovementTripPointRecord;
  draft: MovementPointDraft;
  saving: boolean;
  deleting: boolean;
  onDraftChange: (patch: Partial<MovementPointDraft>) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="grid gap-4 rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(12,18,32,0.98),rgba(8,13,24,0.98))] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
            Datapoint editor
          </div>
          <div className="mt-2 text-lg text-white">
            {formatPointTimestamp(point.recordedAt)}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Editing here changes the canonical trip path in Forge. Deleting the point also tombstones it so the companion will not re-upload it on the next sync.
          </div>
        </div>
        <Badge tone={point.isStopAnchor ? "signal" : "meta"}>
          {point.isStopAnchor ? "Stop anchor" : "Path point"}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-[0.16em] text-white/40">
            Recorded at
          </div>
          <Input
            type="datetime-local"
            value={draft.recordedAt}
            onChange={(event) => onDraftChange({ recordedAt: event.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-[0.16em] text-white/40">
            Speed (m/s)
          </div>
          <Input
            value={draft.speedMps}
            onChange={(event) => onDraftChange({ speedMps: event.target.value })}
            placeholder="Optional"
          />
        </div>
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-[0.16em] text-white/40">
            Latitude
          </div>
          <Input
            value={draft.latitude}
            onChange={(event) => onDraftChange({ latitude: event.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-[0.16em] text-white/40">
            Longitude
          </div>
          <Input
            value={draft.longitude}
            onChange={(event) => onDraftChange({ longitude: event.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-[0.16em] text-white/40">
            Accuracy (m)
          </div>
          <Input
            value={draft.accuracyMeters}
            onChange={(event) => onDraftChange({ accuracyMeters: event.target.value })}
            placeholder="Optional"
          />
        </div>
        <div className="grid gap-2">
          <div className="text-xs uppercase tracking-[0.16em] text-white/40">
            Altitude (m)
          </div>
          <Input
            value={draft.altitudeMeters}
            onChange={(event) => onDraftChange({ altitudeMeters: event.target.value })}
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
              ? "border-[var(--primary)] bg-[var(--primary)]/16 text-white"
              : "border-white/10 bg-white/[0.04] text-white/64"
          )}
          onClick={() => onDraftChange({ isStopAnchor: !draft.isStopAnchor })}
        >
          <Route className="mr-2 size-4" />
          {draft.isStopAnchor ? "Stop anchor" : "Path point"}
        </Button>
        <div className="text-sm text-white/50">
          External id: <span className="text-white/72">{point.externalUid}</span>
        </div>
      </div>

      <div className="flex flex-wrap justify-between gap-3 border-t border-white/8 pt-4">
        <Button
          variant="ghost"
          className="h-10 rounded-full border border-[rgba(255,122,122,0.26)] bg-[rgba(255,122,122,0.08)] px-4 text-[rgba(255,198,198,0.94)] hover:bg-[rgba(255,122,122,0.14)]"
          onClick={onDelete}
          disabled={deleting || saving}
        >
          <Trash2 className="mr-2 size-4" />
          {deleting ? "Deleting…" : "Delete datapoint"}
        </Button>
        <Button onClick={onSave} disabled={saving || deleting}>
          <Save className="mr-2 size-4" />
          {saving ? "Saving…" : "Save datapoint"}
        </Button>
      </div>
    </Card>
  );
}

function PlaceEditorDialog({
  open,
  onOpenChange,
  place,
  onSave
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  place: MovementKnownPlace | null;
  onSave: (input: {
    id?: string;
    label: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    categoryTags: string[];
  }) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    label: place?.label ?? "",
    latitude: String(place?.latitude ?? ""),
    longitude: String(place?.longitude ?? ""),
    radiusMeters: String(place?.radiusMeters ?? 100),
    categoryTags: (place?.categoryTags ?? []).join(", ")
  });

  useEffect(() => {
    setDraft({
      label: place?.label ?? "",
      latitude: String(place?.latitude ?? ""),
      longitude: String(place?.longitude ?? ""),
      radiusMeters: String(place?.radiusMeters ?? 100),
      categoryTags: (place?.categoryTags ?? []).join(", ")
    });
  }, [place]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(3,7,18,0.74)] backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[8vh] z-50 w-[min(32rem,calc(100vw-1.25rem))] -translate-x-1/2 rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,14,28,0.98),rgba(10,16,30,0.95))] p-5 shadow-[0_32px_90px_rgba(0,0,0,0.45)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="font-display text-[1.3rem] tracking-[-0.05em] text-white">
                {place ? `Edit ${place.label}` : "New known place"}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-white/58">
                Define life landmarks once so the companion and web views can reason about stays and trips consistently.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/64 transition hover:bg-white/[0.08] hover:text-white"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-5 grid gap-3">
            <Input
              value={draft.label}
              onChange={(event) =>
                setDraft((current) => ({ ...current, label: event.target.value }))
              }
              placeholder="Home, Main Office, Riverside path..."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                value={draft.latitude}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    latitude: event.target.value
                  }))
                }
                placeholder="Latitude"
              />
              <Input
                value={draft.longitude}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    longitude: event.target.value
                  }))
                }
                placeholder="Longitude"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <Input
                value={draft.radiusMeters}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    radiusMeters: event.target.value
                  }))
                }
                placeholder="Radius meters"
              />
              <Input
                value={draft.categoryTags}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    categoryTags: event.target.value
                  }))
                }
                placeholder="home, gym, holiday, parents-house"
              />
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="border border-white/10 bg-white/[0.04]"
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                void onSave({
                  id: place?.id,
                  label: draft.label,
                  latitude: Number(draft.latitude),
                  longitude: Number(draft.longitude),
                  radiusMeters: Number(draft.radiusMeters),
                  categoryTags: draft.categoryTags
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                }).then(() => onOpenChange(false))
              }
            >
              Save place
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function MovementPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const [viewMode, setViewMode] = useState<MovementViewMode>("life");
  const [targetDate, setTargetDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
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
  const [monthMetric, setMonthMetric] = useState<MonthMetric>("distanceMeters");
  const pointListRef = useRef<HTMLDivElement | null>(null);

  const movementDayQuery = useQuery({
    queryKey: ["forge-movement-day", targetDate, ...selectedUserIds],
    queryFn: async () =>
      (await getMovementDay({ date: targetDate, userIds: selectedUserIds }))
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
  const movementSettingsQuery = useQuery({
    queryKey: ["forge-movement-settings", ...selectedUserIds],
    queryFn: async () => (await getMovementSettings(selectedUserIds)).settings
  });
  const placesQuery = useQuery({
    queryKey: ["forge-movement-places", ...selectedUserIds],
    queryFn: async () => (await listMovementPlaces(selectedUserIds)).places
  });
  const selectedTripQuery = useQuery({
    queryKey: ["forge-movement-trip", selectedTripId],
    queryFn: async () =>
      selectedTripId ? (await getMovementTripDetail(selectedTripId)).movement : null,
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
    }) => {
      if (input.id) {
        return patchMovementPlace(input.id, input);
      }
      return createMovementPlace(input, selectedUserIds);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-places"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-day"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-all-time"] });
    }
  });

  const pointMutation = useMutation({
    mutationFn: async (input: {
      tripId: string;
      pointId: string;
      patch: Record<string, unknown>;
    }) => patchMovementTripPoint(input.tripId, input.pointId, input.patch),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["forge-movement-trip", variables.tripId]
      });
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-day"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-month"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-all-time"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-selection"] });
    }
  });

  const deletePointMutation = useMutation({
    mutationFn: async (input: { tripId: string; pointId: string }) =>
      deleteMovementTripPoint(input.tripId, input.pointId),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["forge-movement-trip", variables.tripId]
      });
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-day"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-month"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-all-time"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-movement-selection"] });
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
  const movementMonth = movementMonthQuery.data;
  const movementAllTime = movementAllTimeQuery.data;
  const movementSettings = movementSettingsQuery.data;
  const selectionAggregate =
    selectionAggregateQuery.data ?? movementDay.selectionAggregate;

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
                    ? "border-[var(--primary)] bg-[var(--primary)]/16 text-white"
                    : "border-white/10 bg-white/[0.04] text-white/64"
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

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(20rem,0.95fr)]">
        <Card className="overflow-hidden rounded-[30px] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(107,214,255,0.16),transparent_42%),linear-gradient(180deg,rgba(10,18,35,0.98),rgba(9,15,28,0.92))]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
                  Movement operating mode
                </div>
                <InfoTooltip content="This is the passive capture state of the movement system: whether tracking is running, how much is published into Forge, and how aggressive retention is." />
              </div>
              <div className="mt-2 text-[clamp(1.05rem,1.8vw,1.35rem)] text-white">
                Background stays and trips as structured life evidence
              </div>
              <div className="mt-2 max-w-2xl text-sm leading-6 text-white/58">
                The companion samples quietly while stationary, switches to denser trip capture when you move, and keeps only simplified long-term traces.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="signal">
                {movementSettings.trackingEnabled ? "Tracking on" : "Tracking off"}
              </Badge>
              <Badge tone="default" className="bg-white/[0.06] text-white/72">
                {movementSettings.publishMode.replaceAll("_", " ")}
              </Badge>
              <Button
                variant="ghost"
                className="h-9 rounded-full border border-white/10 bg-white/[0.04] px-4"
                onClick={() =>
                  settingsMutation.mutate(!movementSettings.trackingEnabled)
                }
              >
                {movementSettings.trackingEnabled ? "Pause passive capture" : "Enable passive capture"}
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Card className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/40">
                Distance today
              </div>
              <div className="mt-3 font-display text-4xl text-white">
                {distanceLabel(movementDay.summary.totalDistanceMeters)}
              </div>
              <div className="mt-2 text-sm text-white/56">
                Across trips, stops, and linked place changes.
              </div>
            </Card>
            <Card className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/40">
                Idle time
              </div>
              <div className="mt-3 font-display text-4xl text-white">
                {durationLabel(movementDay.summary.totalIdleSeconds)}
              </div>
              <div className="mt-2 text-sm text-white/56">
                Time spent settled enough to count as a real stay.
              </div>
            </Card>
            <Card className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/40">
                Known places
              </div>
              <div className="mt-3 font-display text-4xl text-white">
                {movementDay.summary.knownPlaceCount}
              </div>
              <div className="mt-2 text-sm text-white/56">
                Shared between Forge and the iPhone companion.
              </div>
            </Card>
          </div>
        </Card>

        <Card className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,17,31,0.96),rgba(8,13,24,0.92))] p-5">
          <div className="flex items-center gap-2">
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
              Selection aggregate
            </div>
            <InfoTooltip content="When you select stays or trips, Forge totals their span, distance, work overlap, notes, and places here." />
          </div>
          <div className="mt-2 text-sm text-white/56">
            Select any combination of stays and trips to sum movement, time, and work evidence.
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-white/36">
                Span
              </div>
              <div className="mt-2 text-lg text-white">
                {durationLabel(selectionAggregate.durationSeconds)}
              </div>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-white/36">
                Distance
              </div>
              <div className="mt-2 text-lg text-white">
                {distanceLabel(selectionAggregate.distanceMeters)}
              </div>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-white/36">
                Work overlap
              </div>
              <div className="mt-2 text-lg text-white">
                {durationLabel(selectionAggregate.trackedWorkSeconds)}
              </div>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-white/36">
                Notes
              </div>
              <div className="mt-2 text-lg text-white">
                {selectionAggregate.noteCount}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {selectionAggregate.placeLabels.map((label) => (
              <Badge key={label} tone="default" className="bg-white/[0.06] text-white/74">
                {label}
              </Badge>
            ))}
          </div>
        </Card>
      </section>

      {viewMode === "life" ? (
        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2">
              <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/38">
                Life graph
              </div>
              <InfoTooltip content="This graph shows the movement road of your life: stays are blocks, moves connect them, and the hour/day lines live in the background. Click a segment for details, then use edit when you want to correct it." />
            </div>
          </div>
          <MovementLifeTimeline userIds={selectedUserIds} />
        </section>
      ) : null}

      {viewMode === "day" ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(22rem,1fr)]">
          <Card className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,17,31,0.96),rgba(7,12,22,0.92))] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
                    Day strip
                  </div>
                  <InfoTooltip content="A compressed 24-hour strip. Each segment keeps its true order and duration, but the whole day stays navigable on one line." />
                </div>
                <div className="mt-2 text-sm text-white/58">
                  A single-row timeline from 00:00 to 24:00, always compressed into one navigable strip.
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
              <div className="min-w-[52rem]">
                <div className="mb-3 flex justify-between text-[11px] uppercase tracking-[0.18em] text-white/36">
                  {["00:00", "06:00", "12:00", "18:00", "24:00"].map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                <div className="flex h-28 items-stretch overflow-hidden rounded-[28px] border border-white/10 bg-[rgba(255,255,255,0.03)] p-2">
                  {movementDay.segments.map((segment) => {
                    const width = Math.max(
                      9,
                      (segment.durationSeconds / 86_400) * 100
                    );
                    const active =
                      segment.kind === "stay"
                        ? selectedSegmentIds.stayIds.includes(segment.id)
                        : selectedSegmentIds.tripIds.includes(segment.id);
                    return (
                      <button
                        key={segment.id}
                        type="button"
                        className={cn(
                          "relative flex min-w-[5.5rem] flex-col justify-between rounded-[22px] border px-3 py-2 text-left transition",
                          active
                            ? "border-[rgba(171,232,255,0.5)] bg-[rgba(171,232,255,0.16)]"
                            : "border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] hover:border-white/14 hover:bg-white/[0.08]"
                        )}
                        style={{ width: `${width}%` }}
                        onClick={() => {
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
                            tone={segment.kind === "trip" ? "signal" : "default"}
                            className="bg-white/[0.08] text-white/82"
                          >
                            {segment.kind}
                          </Badge>
                          <span className="text-[11px] text-white/46">
                            {durationLabel(segment.durationSeconds)}
                          </span>
                        </div>
                        <div>
                          <div className="line-clamp-2 text-sm font-semibold text-white">
                            {segment.label}
                          </div>
                          <div className="mt-1 text-[12px] leading-5 text-white/52">
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
              <Badge tone="default" className="bg-white/[0.06] text-white/72">
                {movementDay.summary.tripCount} trips
              </Badge>
              <Badge tone="default" className="bg-white/[0.06] text-white/72">
                {movementDay.summary.stayCount} stays
              </Badge>
            </div>
          </Card>

          <div className="grid gap-4">
            {selectedTripQuery.data ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
                    Selected trip
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      className="h-9 rounded-full border border-white/10 bg-white/[0.04] px-4"
                      onClick={() => setDataModalOpen(true)}
                    >
                      View data
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-9 rounded-full border border-white/10 bg-white/[0.04] px-4"
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
                <Card className="rounded-[28px] border border-white/8 bg-white/[0.04] p-5">
                  <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
                    Trip context
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone="signal">
                      {distanceLabel(selectedTripQuery.data.trip.distanceMeters)}
                    </Badge>
                    <Badge tone="default" className="bg-white/[0.06] text-white/74">
                      {selectedTripQuery.data.trip.activityType || selectedTripQuery.data.trip.travelMode}
                    </Badge>
                    <Badge tone="default" className="bg-white/[0.06] text-white/74">
                      {durationLabel(selectedTripQuery.data.trip.durationSeconds)}
                    </Badge>
                  </div>
                  <div className="mt-4 text-sm leading-6 text-white/58">
                    {formatTimeRange(
                      selectedTripQuery.data.trip.startedAt,
                      selectedTripQuery.data.trip.endedAt
                    )}
                  </div>
                </Card>
              </>
            ) : (
              <Card className="rounded-[30px] border border-dashed border-white/12 bg-white/[0.03] p-6 text-white/58">
                Select a trip segment to open the stylized trajectory card and exact path toggle.
              </Card>
            )}
          </div>
        </section>
      ) : null}

      {viewMode === "month" ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.85fr)]">
          <Card className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(9,15,28,0.97),rgba(8,13,24,0.92))] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
                    Month view
                  </div>
                  <InfoTooltip content="This chart stays quantitative. Switch the metric to compare daily distance, moving time, idle time, or calories across the month." />
                </div>
                <div className="mt-2 text-sm text-white/58">
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
                        ? "border-[var(--primary)] bg-[var(--primary)]/14 text-white"
                        : "border-white/10 bg-white/[0.04] text-white/62"
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
                      <stop offset="0%" stopColor="rgba(110,220,255,0.7)" />
                      <stop offset="100%" stopColor="rgba(110,220,255,0.05)" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis
                    dataKey="dateKey"
                    tick={{ fill: "rgba(255,255,255,0.46)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "rgba(255,255,255,0.46)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(7,12,24,0.94)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 16
                    }}
                    formatter={(value) =>
                      metricLabel(monthMetric, Number(value))
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey={monthMetric}
                    stroke="rgba(126,233,255,0.95)"
                    fill="url(#movementMonthFill)"
                    strokeWidth={2.4}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="rounded-[30px] border border-white/8 bg-white/[0.04] p-5">
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
              Month totals
            </div>
            <div className="mt-5 grid gap-3">
              <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/36">
                  Distance
                </div>
                <div className="mt-2 text-2xl text-white">
                  {distanceLabel(movementMonth.totals.distanceMeters)}
                </div>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/36">
                  Moving time
                </div>
                <div className="mt-2 text-2xl text-white">
                  {durationLabel(movementMonth.totals.movingSeconds)}
                </div>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/36">
                  Settled time
                </div>
                <div className="mt-2 text-2xl text-white">
                  {durationLabel(movementMonth.totals.idleSeconds)}
                </div>
              </div>
            </div>
          </Card>
        </section>
      ) : null}

      {viewMode === "all_time" ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.95fr)]">
          <Card className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,13,25,0.97),rgba(8,13,24,0.92))] p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/36">
                  Trips
                </div>
                <div className="mt-2 text-3xl text-white">
                  {movementAllTime.summary.tripCount}
                </div>
              </Card>
              <Card className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/36">
                  Known places
                </div>
                <div className="mt-2 text-3xl text-white">
                  {movementAllTime.summary.knownPlaceCount}
                </div>
              </Card>
              <Card className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/36">
                  Distance
                </div>
                <div className="mt-2 text-3xl text-white">
                  {distanceLabel(movementAllTime.summary.totalDistanceMeters)}
                </div>
              </Card>
              <Card className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/36">
                  Countries
                </div>
                <div className="mt-2 text-3xl text-white">
                  {movementAllTime.summary.visitedCountries}
                </div>
              </Card>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {movementAllTime.recentTrips.map((trip) => (
                <button
                  key={trip.id}
                  type="button"
                  className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.06]"
                  onClick={() => {
                    setViewMode("day");
                    setSelectedTripId(trip.id);
                  }}
                >
                  <div className="text-xs uppercase tracking-[0.18em] text-white/36">
                    Recent travel
                  </div>
                  <div className="mt-2 text-lg text-white">{trip.label || "Untitled trip"}</div>
                  <div className="mt-1 text-sm text-white/56">
                    {distanceLabel(trip.distanceMeters)} · {trip.activityType || "travel"}
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <Card className="rounded-[30px] border border-white/8 bg-white/[0.04] p-5">
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
              Place categories
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {movementAllTime.categoryBreakdown.map((entry) => (
                <Badge key={entry.tag} tone="default" className="bg-white/[0.06] text-white/74">
                  {entry.tag} · {entry.count}
                </Badge>
              ))}
            </div>
          </Card>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.95fr)]">
        <Card className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,14,28,0.96),rgba(9,15,28,0.92))] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
                  Known places
                </div>
                <InfoTooltip content="Known places turn raw stationary spans into named contexts like home, work, gym, nature, or any custom place tag you want Forge to remember." />
              </div>
              <div className="mt-2 text-sm text-white/58">
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
            {filteredPlaces.map((place) => (
              <button
                key={place.id}
                type="button"
                className="flex items-start justify-between gap-3 rounded-[24px] border border-white/8 bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.06]"
                onClick={() => {
                  setEditingPlace(place);
                  setPlaceEditorOpen(true);
                }}
              >
                <div>
                  <div className="text-lg text-white">{place.label}</div>
                  <div className="mt-1 text-sm text-white/56">
                    {place.latitude.toFixed(4)}, {place.longitude.toFixed(4)} · radius {Math.round(place.radiusMeters)} m
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {place.categoryTags.map((tag) => (
                      <Badge key={tag} tone="default" className="bg-white/[0.06] text-white/74">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
                <PencilLine className="mt-1 size-4 text-white/42" />
              </button>
            ))}
          </div>
        </Card>

        <Card className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,17,31,0.96),rgba(8,13,24,0.92))] p-5">
          <div className="flex items-center gap-2">
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
              Movement help
            </div>
            <InfoTooltip content="Most movement surfaces on this page have help buttons. Use them to understand the graph, the day strip, the month chart, and the place system without keeping a large prose block on screen." />
          </div>
          <div className="mt-3 text-sm leading-6 text-white/58">
            Use the small help icons across this page for graph explanations, timeline semantics, and metric meanings.
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge className="bg-white/[0.06] text-white/74">Life graph</Badge>
            <Badge className="bg-white/[0.06] text-white/74">Day strip</Badge>
            <Badge className="bg-white/[0.06] text-white/74">Month chart</Badge>
            <Badge className="bg-white/[0.06] text-white/74">Known places</Badge>
            <Badge className="bg-white/[0.06] text-white/74">Selection aggregate</Badge>
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
          description="Inspect the raw datapoints behind this trip, search them with time and quality filters, then edit or tombstone them without letting the companion re-upload the stale version."
        >
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
                    <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
                      Raw datapoints
                    </div>
                    <div className="mt-2 text-lg text-white">
                      Open a point to correct or delete it.
                    </div>
                  </div>
                  <Badge tone="meta">{pointResultSummary}</Badge>
                </div>

                <div
                  ref={pointListRef}
                  className="h-[34rem] overflow-y-auto rounded-[24px] border border-white/8 bg-white/[0.03]"
                >
                  {filteredPoints.length === 0 ? (
                    <div className="flex h-full items-center justify-center p-6 text-center text-sm leading-6 text-white/50">
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
                                  ? "border-[rgba(171,232,255,0.34)] bg-[rgba(171,232,255,0.12)]"
                                  : "border-white/8 bg-white/[0.04] hover:bg-white/[0.07]"
                              )}
                              onClick={() => {
                                setSelectedPointId(point.id);
                                setPointDraft(buildPointDraft(point));
                              }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 text-white">
                                    <Clock3 className="size-4 shrink-0 text-[var(--primary)]" />
                                    <span className="truncate text-base font-medium">
                                      {formatPointTimestamp(point.recordedAt)}
                                    </span>
                                  </div>
                                  <div className="mt-2 text-sm text-white/56">
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
                saving={
                  pointMutation.isPending &&
                  pointMutation.variables?.pointId === activePoint.id
                }
                deleting={
                  deletePointMutation.isPending &&
                  deletePointMutation.variables?.pointId === activePoint.id
                }
                onDraftChange={(patch) =>
                  setPointDraft((current) =>
                    current ? { ...current, ...patch } : current
                  )
                }
                onSave={() => {
                  if (!selectedTripId || !pointDraft) {
                    return;
                  }
                  const recordedAt = fromLocalDateTimeInput(pointDraft.recordedAt);
                  if (!recordedAt) {
                    return;
                  }
                  void pointMutation.mutateAsync({
                    tripId: selectedTripId,
                    pointId: activePoint.id,
                    patch: {
                      recordedAt,
                      latitude: Number(pointDraft.latitude),
                      longitude: Number(pointDraft.longitude),
                      accuracyMeters:
                        pointDraft.accuracyMeters.trim().length > 0
                          ? Number(pointDraft.accuracyMeters)
                          : null,
                      altitudeMeters:
                        pointDraft.altitudeMeters.trim().length > 0
                          ? Number(pointDraft.altitudeMeters)
                          : null,
                      speedMps:
                        pointDraft.speedMps.trim().length > 0
                          ? Number(pointDraft.speedMps)
                          : null,
                      isStopAnchor: pointDraft.isStopAnchor
                    }
                  });
                }}
                onDelete={() => {
                  if (!selectedTripId) {
                    return;
                  }
                  const nextPoint =
                    filteredPoints.find((point) => point.id !== activePoint.id) ??
                    selectedTripQuery.data?.trip.points.find(
                      (point) => point.id !== activePoint.id
                    ) ??
                    null;
                  setSelectedPointId(nextPoint?.id ?? null);
                  setPointDraft(nextPoint ? buildPointDraft(nextPoint) : null);
                  void deletePointMutation.mutateAsync({
                    tripId: selectedTripId,
                    pointId: activePoint.id
                  });
                }}
              />
            ) : (
              <Card className="rounded-[28px] border border-dashed border-white/12 bg-white/[0.03] p-6 text-white/56">
                Pick a datapoint to edit or delete it. The canonical change will flow back to the companion on the next sync.
              </Card>
            )}
          </div>
        </SheetScaffold>
      ) : null}

      <PlaceEditorDialog
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
