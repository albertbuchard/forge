import { useEffect, useMemo, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CalendarCheck2,
  CalendarClock,
  Car,
  ChevronDown,
  Clapperboard,
  Clock3,
  FileUp,
  MapPin,
  Milestone,
  Music,
  Plane,
  Plus,
  Ship,
  Sparkles,
  Train,
  Users
} from "lucide-react";
import { QuestionFlowDialog, type QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page-state";
import { Input } from "@/components/ui/input";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  createEntities,
  getLifeEventTravelStatus,
  getLifeEventsTimeline,
  importLifeEventTicket,
  syncLifeEventCalendar,
  uploadArtifact
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  ArtifactUploadInput,
  LifeEvent,
  LifeEventTimelinePayload,
  LifeEventType
} from "@/lib/types";

type LifeEventDraft = {
  title: string;
  shortDescription: string;
  description: string;
  eventType: LifeEventType;
  importance: "ordinary" | "meaningful" | "major" | "life_changing";
  startsAt: string;
  endsAt: string;
  timezone: string;
  placeLabel: string;
  originLabel: string;
  destinationLabel: string;
  transportMode: "plane" | "train" | "car" | "boat" | "walking" | "public_transit" | "other" | "";
  calendarProjection: "link_or_create" | "link_existing_only" | "none";
};

type TicketImportDraft = {
  files: File[];
  sourceLabel: string;
  useLlm: boolean;
};

const EVENT_TYPES: Array<{
  value: LifeEventType;
  label: string;
  icon: typeof Plane;
}> = [
  { value: "travel_flight", label: "Flight", icon: Plane },
  { value: "travel_train", label: "Train", icon: Train },
  { value: "travel_car", label: "Car trip", icon: Car },
  { value: "travel_boat", label: "Boat", icon: Ship },
  { value: "travel_trip", label: "Trip", icon: MapPin },
  { value: "concert", label: "Concert", icon: Music },
  { value: "cinema", label: "Cinema", icon: Clapperboard },
  { value: "date", label: "Date", icon: Sparkles },
  { value: "friends", label: "Friends", icon: Users },
  { value: "family", label: "Family", icon: Users },
  { value: "work_milestone", label: "Work", icon: Milestone },
  { value: "thesis_milestone", label: "Thesis", icon: Milestone },
  { value: "medical", label: "Medical", icon: CalendarClock },
  { value: "administrative", label: "Admin", icon: CalendarCheck2 },
  { value: "celebration", label: "Celebration", icon: Sparkles },
  { value: "custom", label: "Custom", icon: Milestone }
];

const defaultDraft = (): LifeEventDraft => ({
  title: "",
  shortDescription: "",
  description: "",
  eventType: "custom",
  importance: "meaningful",
  startsAt: toLocalDateTimeInput(new Date().toISOString()),
  endsAt: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  placeLabel: "",
  originLabel: "",
  destinationLabel: "",
  transportMode: "",
  calendarProjection: "link_or_create"
});

const defaultTicketDraft = (): TicketImportDraft => ({
  files: [],
  sourceLabel: "Ticket upload",
  useLlm: true
});

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

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatEventType(type: LifeEventType) {
  return EVENT_TYPES.find((entry) => entry.value === type)?.label ?? type.replaceAll("_", " ");
}

function eventIcon(type: LifeEventType) {
  return EVENT_TYPES.find((entry) => entry.value === type)?.icon ?? Milestone;
}

function timelineStats(timeline: LifeEventTimelinePayload | undefined) {
  const events = timeline?.events ?? [];
  const now = Date.now();
  const past = events.filter((event) => Date.parse(event.endsAt) < now).length;
  const current = events.filter(
    (event) => Date.parse(event.startsAt) <= now && Date.parse(event.endsAt) >= now
  ).length;
  const upcoming = events.length - past - current;
  return { past, current, upcoming };
}

function buildEventSearchText(event: LifeEvent) {
  return [
    event.title,
    event.shortDescription,
    event.description,
    event.eventType,
    event.status,
    event.placeLabel,
    event.originLabel,
    event.destinationLabel,
    event.originCity,
    event.destinationCity,
    event.segments.map((segment) => `${segment.carrierCode}${segment.serviceNumber}`).join(" ")
  ]
    .join(" ")
    .toLowerCase();
}

function routePoints(event: LifeEvent) {
  const origin =
    event.originLatitude != null && event.originLongitude != null
      ? { label: event.originLabel || event.originCity || "Origin", lat: event.originLatitude, lon: event.originLongitude }
      : null;
  const destination =
    event.destinationLatitude != null && event.destinationLongitude != null
      ? {
          label: event.destinationLabel || event.destinationCity || "Destination",
          lat: event.destinationLatitude,
          lon: event.destinationLongitude
        }
      : null;
  return origin && destination ? { origin, destination } : null;
}

function LifeEventRoutePreview({ event, expanded }: { event: LifeEvent; expanded: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mapStatus, setMapStatus] = useState<"fallback" | "loading" | "ready">("fallback");
  const points = routePoints(event);
  const styleUrl =
    typeof window !== "undefined"
      ? window.localStorage.getItem("forge.maplibre.style-url")?.trim() ||
        window.localStorage.getItem("forge.map.tile-url")?.trim() ||
        ""
      : "";

  useEffect(() => {
    let cancelled = false;
    let map: import("maplibre-gl").Map | null = null;
    if (!expanded || !points || !styleUrl || !containerRef.current) {
      setMapStatus("fallback");
      return undefined;
    }
    setMapStatus("loading");
    void import("maplibre-gl").then((maplibre) => {
      if (cancelled || !containerRef.current) {
        return;
      }
      const rasterStyle = styleUrl.includes("{x}") || styleUrl.includes("{z}");
      map = new maplibre.Map({
        container: containerRef.current,
        style: rasterStyle
          ? {
              version: 8,
              sources: {
                tiles: { type: "raster", tiles: [styleUrl], tileSize: 256 }
              },
              layers: [{ id: "tiles", type: "raster", source: "tiles" }]
            }
          : styleUrl,
        center: [points.origin.lon, points.origin.lat],
        zoom: 3,
        attributionControl: false
      });
      map.on("load", () => {
        if (!map) {
          return;
        }
        const coordinates = [
          [points.origin.lon, points.origin.lat],
          [points.destination.lon, points.destination.lat]
        ];
        map.addSource("life-event-route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates }
          }
        });
        map.addLayer({
          id: "life-event-route",
          type: "line",
          source: "life-event-route",
          paint: {
            "line-color": "#0f766e",
            "line-width": 4,
            "line-dasharray": [1.5, 1]
          }
        });
        const bounds = new maplibre.LngLatBounds(
          coordinates[0] as [number, number],
          coordinates[1] as [number, number]
        );
        map.fitBounds(bounds, { padding: 56, maxZoom: 8 });
        setMapStatus("ready");
      });
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [expanded, points, styleUrl]);

  return (
    <div className="relative min-h-[190px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]">
      <div ref={containerRef} className={cn("absolute inset-0", mapStatus !== "ready" && "hidden")} />
      {mapStatus !== "ready" ? (
        <div className="absolute inset-0 grid place-items-center p-4">
          <div className="relative h-28 w-full max-w-xl">
            <div className="absolute left-[12%] top-1/2 h-px w-[76%] -translate-y-1/2 border-t border-dashed border-[var(--primary)]/55" />
            <div className="absolute left-[10%] top-1/2 size-4 -translate-y-1/2 rounded-full border border-[var(--primary)] bg-[var(--ui-surface-1)]" />
            <div className="absolute right-[10%] top-1/2 size-4 -translate-y-1/2 rounded-full border border-[var(--success)] bg-[var(--ui-surface-1)]" />
            <Plane className="absolute left-1/2 top-[38%] size-6 -translate-x-1/2 text-[var(--primary)]" />
            <div className="absolute left-0 top-[calc(50%+1.25rem)] max-w-[42%] text-xs text-[var(--ui-ink-soft)]">
              {event.originLabel || event.originCity || "Origin"}
            </div>
            <div className="absolute right-0 top-[calc(50%+1.25rem)] max-w-[42%] text-right text-xs text-[var(--ui-ink-soft)]">
              {event.destinationLabel || event.destinationCity || "Destination"}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LifeEventCard({
  event,
  next,
  expanded,
  onToggle,
  onSyncCalendar
}: {
  event: LifeEvent;
  next: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSyncCalendar: () => void;
}) {
  const Icon = eventIcon(event.eventType);
  const isTravel = event.eventType.startsWith("travel_");
  const timeRange = `${formatTime(event.startsAt)} - ${formatTime(event.endsAt)}`;
  const primaryLocation =
    event.placeLabel ||
    [event.destinationLabel, event.destinationCity, event.destinationCountry]
      .filter(Boolean)
      .join(", ") ||
    [event.originLabel, event.originCity, event.originCountry].filter(Boolean).join(", ");

  return (
    <Card
      data-testid="life-event-card"
      className={cn(
        "relative overflow-hidden p-0",
        next && "border-[color-mix(in_srgb,var(--primary)_38%,var(--ui-border-subtle)_62%)]"
      )}
    >
      <button
        type="button"
        className="grid w-full min-w-0 grid-cols-[auto_1fr_auto] items-start gap-3 p-4 text-left"
        onClick={onToggle}
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-control)] bg-[var(--ui-surface-2)] text-[var(--primary)]">
          <Icon className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 break-words text-base font-semibold text-[var(--ui-ink-strong)]">
              {event.title}
            </span>
            {next ? <Badge tone="signal" size="xs">Next</Badge> : null}
            <Badge tone="meta" size="xs">{formatEventType(event.eventType)}</Badge>
          </span>
          <span className="mt-1 block text-sm text-[var(--ui-ink-soft)]">
            {formatDate(event.startsAt)} · {timeRange}
          </span>
          {primaryLocation ? (
            <span className="mt-2 flex min-w-0 items-center gap-1 text-sm text-[var(--ui-ink-medium)]">
              <MapPin className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{primaryLocation}</span>
            </span>
          ) : null}
          {event.shortDescription || event.description ? (
            <span className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--ui-ink-medium)]">
              {event.shortDescription || event.description}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "mt-1 size-4 shrink-0 text-[var(--ui-ink-soft)] transition",
            expanded && "rotate-180"
          )}
        />
      </button>
      {expanded ? (
        <div className="grid gap-4 border-t border-[var(--ui-border-subtle)] p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[var(--radius-card)] bg-[var(--ui-surface-1)] p-3">
              <div className="text-xs uppercase tracking-[0.08em] text-[var(--ui-ink-faint)]">When</div>
              <div className="mt-1 text-sm text-[var(--ui-ink-strong)]">{timeRange}</div>
            </div>
            <div className="rounded-[var(--radius-card)] bg-[var(--ui-surface-1)] p-3">
              <div className="text-xs uppercase tracking-[0.08em] text-[var(--ui-ink-faint)]">Calendar</div>
              <div className="mt-1 text-sm text-[var(--ui-ink-strong)]">
                {event.primaryCalendarEventId ? event.calendarSyncState.replaceAll("_", " ") : "Not linked"}
              </div>
            </div>
            <div className="rounded-[var(--radius-card)] bg-[var(--ui-surface-1)] p-3">
              <div className="text-xs uppercase tracking-[0.08em] text-[var(--ui-ink-faint)]">Links</div>
              <div className="mt-1 text-sm text-[var(--ui-ink-strong)]">{event.links.length}</div>
            </div>
          </div>
          {isTravel ? <LifeEventRoutePreview event={event} expanded={expanded} /> : null}
          {event.segments.length > 0 ? (
            <div className="grid gap-2">
              {event.segments.map((segment) => (
                <div
                  key={segment.id}
                  className="grid gap-2 rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm md:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--ui-ink-strong)]">
                      {segment.title || `${segment.originLabel} to ${segment.destinationLabel}`}
                    </div>
                    <div className="mt-1 text-[var(--ui-ink-soft)]">
                      {[segment.originIata || segment.originLabel, segment.destinationIata || segment.destinationLabel]
                        .filter(Boolean)
                        .join(" -> ")}
                    </div>
                  </div>
                  <Badge tone="meta" size="sm">{segment.status}</Badge>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onSyncCalendar}>
              <CalendarCheck2 className="size-4" />
              Sync calendar
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function FileDropZone({
  files,
  onFiles
}: {
  files: File[];
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div
      className="grid min-h-40 place-items-center rounded-[var(--radius-card)] border border-dashed border-[var(--ui-border-strong)] bg-[var(--ui-surface-1)] p-5 text-center"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onFiles([...files, ...Array.from(event.dataTransfer.files)]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          onFiles([...files, ...Array.from(event.currentTarget.files ?? [])]);
          event.currentTarget.value = "";
        }}
      />
      <div className="grid gap-3">
        <FileUp className="mx-auto size-8 text-[var(--primary)]" />
        <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
          Drop tickets or confirmations here
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
        {files.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-2">
            {files.map((file, index) => (
              <Badge key={`${file.name}-${index}`} tone="meta" size="sm" wrap>
                {file.name}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function LifeEventsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [draft, setDraft] = useState<LifeEventDraft>(() => defaultDraft());
  const [ticketDraft, setTicketDraft] = useState<TicketImportDraft>(() => defaultTicketDraft());
  const [submitError, setSubmitError] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement | null>(null);

  const timelineQuery = useQuery({
    queryKey: ["life-events-timeline"],
    queryFn: async () => (await getLifeEventsTimeline({ limit: 500 })).timeline
  });
  const timeline = timelineQuery.data;
  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const events = timeline?.events ?? [];
    if (!needle) {
      return events;
    }
    return events.filter((event) => buildEventSearchText(event).includes(needle));
  }, [query, timeline?.events]);
  const stats = timelineStats(timeline);
  const rowVirtualizer = useVirtualizer({
    count: filteredEvents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 212,
    overscan: 8
  });

  const createMutation = useMutation({
    mutationFn: async (value: LifeEventDraft) => {
      const startsAt = fromLocalDateTimeInput(value.startsAt);
      const endsAt = fromLocalDateTimeInput(value.endsAt);
      if (!startsAt) {
        throw new Error("Add a valid start date and time.");
      }
      const data: Record<string, unknown> = {
        title: value.title.trim(),
        shortDescription: value.shortDescription.trim(),
        description: value.description.trim(),
        eventType: value.eventType,
        importance: value.importance,
        startsAt,
        timezone: value.timezone.trim() || "UTC",
        placeLabel: value.placeLabel.trim(),
        originLabel: value.originLabel.trim(),
        destinationLabel: value.destinationLabel.trim(),
        calendarProjection: value.calendarProjection
      };
      if (endsAt) {
        data.endsAt = endsAt;
      }
      if (value.transportMode) {
        data.transportMode = value.transportMode;
      }
      await createEntities({
        operations: [{ entityType: "life_event", data }],
        atomic: true
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["life-events-timeline"] });
      await queryClient.invalidateQueries({ queryKey: ["knowledge-graph"] });
      setDraft(defaultDraft());
      setEventDialogOpen(false);
    }
  });

  const ticketMutation = useMutation({
    mutationFn: async (value: TicketImportDraft) => {
      if (value.files.length === 0) {
        throw new Error("Choose one or more ticket files.");
      }
      for (const file of value.files) {
        const title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
        const input: ArtifactUploadInput = {
          title,
          shortDescription: "Ticket or travel confirmation",
          description: "Uploaded from the Life Events ticket flow.",
          originalFileName: file.name,
          declaredMimeType: file.type,
          contentBase64: await fileToBase64(file),
          sourceKind: "upload",
          sourceLabel: value.sourceLabel,
          useLlmEnrichment: value.useLlm
        };
        const { artifact } = await uploadArtifact(input);
        await importLifeEventTicket({
          artifactId: artifact.id,
          createDraft: true,
          useLlm: value.useLlm
        });
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["life-events-timeline"] }),
        queryClient.invalidateQueries({ queryKey: ["artifacts"] }),
        queryClient.invalidateQueries({ queryKey: ["knowledge-graph"] })
      ]);
      setTicketDraft(defaultTicketDraft());
      setTicketDialogOpen(false);
    }
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => syncLifeEventCalendar(id, { projection: "link_or_create" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["life-events-timeline"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] })
      ]);
    }
  });

  const statusQuery = useQuery({
    queryKey: ["life-event-travel-status", expandedId],
    queryFn: async () =>
      expandedId ? (await getLifeEventTravelStatus(expandedId)).status : null,
    enabled: Boolean(expandedId)
  });

  const steps = useMemo<Array<QuestionFlowStep<LifeEventDraft>>>(
    () => [
      {
        id: "shape",
        eyebrow: "Kind",
        title: "What kind of event is this?",
        render: (value, setValue) => (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {EVENT_TYPES.map((entry) => {
              const Icon = entry.icon;
              const selected = value.eventType === entry.value;
              return (
                <button
                  key={entry.value}
                  type="button"
                  className={cn(
                    "flex min-h-20 min-w-0 items-center gap-3 rounded-[var(--radius-card)] border p-3 text-left transition",
                    selected
                      ? "border-[var(--primary)] bg-[var(--ui-accent-soft)]"
                      : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] hover:bg-[var(--ui-surface-hover)]"
                  )}
                  onClick={() =>
                    setValue({
                      eventType: entry.value,
                      transportMode:
                        entry.value === "travel_flight"
                          ? "plane"
                          : entry.value === "travel_train"
                            ? "train"
                            : entry.value === "travel_car"
                              ? "car"
                              : entry.value === "travel_boat"
                                ? "boat"
                                : value.transportMode
                    })
                  }
                >
                  <Icon className="size-5 shrink-0 text-[var(--primary)]" />
                  <span className="min-w-0 break-words text-sm font-medium">
                    {entry.label}
                  </span>
                </button>
              );
            })}
          </div>
        )
      },
      {
        id: "name",
        eyebrow: "Meaning",
        title: "Name the event clearly.",
        render: (value, setValue) => (
          <div className="grid gap-3">
            <Input
              value={value.title}
              onChange={(event) => setValue({ title: event.target.value })}
              placeholder="Flight to Paris"
            />
            <Input
              value={value.shortDescription}
              onChange={(event) => setValue({ shortDescription: event.target.value })}
              placeholder="Seeing family for the long weekend"
            />
            <Textarea
              value={value.description}
              onChange={(event) => setValue({ description: event.target.value })}
              placeholder="What makes this event worth keeping in the life timeline?"
              rows={5}
            />
          </div>
        )
      },
      {
        id: "time-place",
        eyebrow: "When and where",
        title: "Set the time and place.",
        render: (value, setValue) => (
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              type="datetime-local"
              value={value.startsAt}
              onChange={(event) => setValue({ startsAt: event.target.value })}
            />
            <Input
              type="datetime-local"
              value={value.endsAt}
              onChange={(event) => setValue({ endsAt: event.target.value })}
            />
            <Input
              value={value.placeLabel}
              onChange={(event) => setValue({ placeLabel: event.target.value })}
              placeholder="Place or city"
            />
            <Input
              value={value.timezone}
              onChange={(event) => setValue({ timezone: event.target.value })}
              placeholder="Timezone"
            />
            <Input
              value={value.originLabel}
              onChange={(event) => setValue({ originLabel: event.target.value })}
              placeholder="Origin"
            />
            <Input
              value={value.destinationLabel}
              onChange={(event) => setValue({ destinationLabel: event.target.value })}
              placeholder="Destination"
            />
          </div>
        )
      },
      {
        id: "calendar",
        eyebrow: "Calendar",
        title: "Choose the calendar behavior.",
        render: (value, setValue) => (
          <div className="grid gap-3">
            {[
              ["link_or_create", "Find or create the calendar event"],
              ["link_existing_only", "Only link if Forge finds a match"],
              ["none", "Keep it only in Life Events"]
            ].map(([projection, label]) => (
              <button
                key={projection}
                type="button"
                className={cn(
                  "rounded-[var(--radius-card)] border p-4 text-left text-sm",
                  value.calendarProjection === projection
                    ? "border-[var(--primary)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                    : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]"
                )}
                onClick={() =>
                  setValue({
                    calendarProjection: projection as LifeEventDraft["calendarProjection"]
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
        )
      }
    ],
    []
  );

  const ticketSteps = useMemo<Array<QuestionFlowStep<TicketImportDraft>>>(
    () => [
      {
        id: "files",
        eyebrow: "Tickets",
        title: "Add one or more ticket files.",
        render: (value, setValue) => (
          <FileDropZone
            files={value.files}
            onFiles={(files) => setValue({ files })}
          />
        )
      },
      {
        id: "details",
        eyebrow: "Extraction",
        title: "Set provenance and extraction.",
        render: (value, setValue) => (
          <div className="grid gap-3">
            <Input
              value={value.sourceLabel}
              onChange={(event) => setValue({ sourceLabel: event.target.value })}
              placeholder="Airline email, booking site, exported PDF"
            />
            <label className="flex items-center gap-3 rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-sm">
              <input
                type="checkbox"
                checked={value.useLlm}
                onChange={(event) => setValue({ useLlm: event.target.checked })}
              />
              <span>Use configured LLM extraction when available</span>
            </label>
          </div>
        )
      }
    ],
    []
  );

  if (timelineQuery.isLoading) {
    return <SurfaceSkeleton title="Loading Life Events" />;
  }

  if (timelineQuery.isError) {
    return (
      <ErrorState
        eyebrow="Life Events"
        error={timelineQuery.error}
        onRetry={() => void timelineQuery.refetch()}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <PageHero
        title="Life Events"
        titleText="Life Events"
        description="A chronological timeline for the important events that should stay connected to calendar, artifacts, and the rest of Forge."
        badge={`${stats.upcoming} upcoming`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setTicketDialogOpen(true)}>
              <FileUp className="size-4" />
              Import tickets
            </Button>
            <Button type="button" onClick={() => setEventDialogOpen(true)}>
              <Plus className="size-4" />
              Add event
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search events, places, flight numbers, people, or milestones"
        />
        <div className="flex flex-wrap gap-2">
          <Badge tone="meta">{stats.past} past</Badge>
          <Badge tone="signal">{stats.current} now</Badge>
          <Badge tone="meta">{stats.upcoming} future</Badge>
        </div>
      </div>

      {filteredEvents.length === 0 ? (
        <Card className="grid min-h-56 place-items-center text-center">
          <div className="grid gap-3">
            <Milestone className="mx-auto size-9 text-[var(--primary)]" />
            <div className="text-base font-semibold text-[var(--ui-ink-strong)]">
              No Life Events match this view
            </div>
          </div>
        </Card>
      ) : (
        <div
          ref={parentRef}
          className="h-[min(72vh,760px)] overflow-auto rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3"
        >
          <div
            className="relative w-full"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const event = filteredEvents[virtualRow.index]!;
              const isNext = event.id === timeline?.nextLifeEventId;
              const isExpanded = expandedId === event.id;
              return (
                <div
                  key={event.id}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 w-full pb-3"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className="grid grid-cols-[2rem_1fr] gap-3">
                    <div className="relative flex justify-center">
                      <div className="absolute bottom-0 top-0 w-px bg-[var(--ui-border-subtle)]" />
                      <div
                        className={cn(
                          "z-10 mt-5 size-3 rounded-full border bg-[var(--ui-surface-1)]",
                          isNext
                            ? "border-[var(--primary)] shadow-[0_0_0_5px_color-mix(in_srgb,var(--primary)_16%,transparent)]"
                            : "border-[var(--ui-border-strong)]"
                        )}
                      />
                    </div>
                    <LifeEventCard
                      event={event}
                      next={isNext}
                      expanded={isExpanded}
                      onToggle={() => setExpandedId(isExpanded ? null : event.id)}
                      onSyncCalendar={() => syncMutation.mutate(event.id)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {expandedId && statusQuery.data ? (
        <div className="flex items-center gap-2 text-sm text-[var(--ui-ink-soft)]">
          <Clock3 className="size-4" />
          <span>{statusQuery.data.message}</span>
        </div>
      ) : null}

      <QuestionFlowDialog
        open={eventDialogOpen}
        onOpenChange={(open) => {
          setEventDialogOpen(open);
          if (!open) {
            setSubmitError(null);
          }
        }}
        eyebrow="Life Event"
        title="Add Life Event"
        description="Capture the event with enough timing, place, meaning, and calendar behavior to keep it useful later."
        value={draft}
        onChange={setDraft}
        steps={steps}
        draftPersistenceKey="life-event.new"
        submitLabel="Create Life Event"
        pending={createMutation.isPending}
        error={submitError}
        onSubmit={async () => {
          setSubmitError(null);
          if (!draft.title.trim()) {
            setSubmitError("Give the event a clear title before saving.");
            return;
          }
          try {
            await createMutation.mutateAsync(draft);
          } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "Unable to create Life Event.");
          }
        }}
      />

      <QuestionFlowDialog
        open={ticketDialogOpen}
        onOpenChange={(open) => {
          setTicketDialogOpen(open);
          if (!open) {
            setSubmitError(null);
          }
        }}
        eyebrow="Life Event tickets"
        title="Import tickets"
        description="Tickets are stored as artifacts, scanned, linked, and used to draft travel Life Events."
        value={ticketDraft}
        onChange={setTicketDraft}
        steps={ticketSteps}
        submitLabel="Import tickets"
        pending={ticketMutation.isPending}
        pendingLabel="Importing"
        error={submitError}
        onSubmit={async () => {
          setSubmitError(null);
          try {
            await ticketMutation.mutateAsync(ticketDraft);
          } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "Unable to import tickets.");
          }
        }}
      />
    </div>
  );
}
