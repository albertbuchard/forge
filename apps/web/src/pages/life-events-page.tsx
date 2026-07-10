import { useEffect, useMemo, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  BedDouble,
  BookOpen,
  BriefcaseBusiness,
  CalendarCheck2,
  CalendarClock,
  Car,
  ChevronDown,
  Clapperboard,
  Clock3,
  FileUp,
  GraduationCap,
  HeartPulse,
  Home,
  Landmark,
  MapPinned,
  MapPin,
  Milestone,
  Music,
  PartyPopper,
  PencilLine,
  Plane,
  Plus,
  Ship,
  Sparkles,
  Tent,
  Train,
  Utensils,
  Users
} from "lucide-react";
import {
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
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
  getLifeEvent,
  getLifeEventTravelStatus,
  getLifeEventsTimeline,
  importLifeEventTicket,
  syncLifeEventCalendar,
  updateEntities,
  uploadArtifact
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { resolveForgeThemeToken } from "@/lib/theme-system";
import { useForgeThemeKey } from "@/hooks/use-forge-theme-key";
import type {
  ArtifactUploadInput,
  LifeEvent,
  LifeEventTimelinePayload,
  LifeEventType
} from "@/lib/types";
import {
  formatDateInTimeZone,
  formatDateTimeInputInTimeZone,
  formatShortDateInTimeZone,
  formatTimeInTimeZone,
  isSameDateInTimeZone,
  parseDateTimeInputInTimeZone
} from "@/lib/timezone-datetime";

type LifeEventDraft = {
  title: string;
  shortDescription: string;
  description: string;
  eventType: LifeEventType;
  spanPreset: "same_day" | "overnight" | "multi_day" | "multi_month" | "custom";
  importance: "ordinary" | "meaningful" | "major" | "life_changing";
  startsAt: string;
  endsAt: string;
  timezone: string;
  placeLabel: string;
  originLabel: string;
  destinationLabel: string;
  transportMode:
    | "plane"
    | "train"
    | "car"
    | "boat"
    | "walking"
    | "public_transit"
    | "other"
    | "";
  calendarProjection: "link_or_create" | "link_existing_only" | "none";
};

type TicketImportDraft = {
  files: File[];
  sourceLabel: string;
  useLlm: boolean;
};

type LifeEventTravelStatusPayload = Awaited<
  ReturnType<typeof getLifeEventTravelStatus>
>["status"];

type RoutePoint = {
  label: string;
  lat: number;
  lon: number;
  code?: string;
};

type RouteLineFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.LineString,
  Record<string, unknown>
>;
type RouteStopFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  Record<string, unknown>
>;

const KNOWN_ROUTE_POINTS: Record<string, RoutePoint> = {
  GVA: { code: "GVA", label: "Geneva Airport", lat: 46.2381, lon: 6.109 },
  ZRH: { code: "ZRH", label: "Zurich Airport", lat: 47.4581, lon: 8.5555 },
  LAX: {
    code: "LAX",
    label: "Los Angeles International",
    lat: 33.9416,
    lon: -118.4085
  },
  BUR: { code: "BUR", label: "Hollywood Burbank", lat: 34.2007, lon: -118.359 },
  RNO: {
    code: "RNO",
    label: "Reno-Tahoe International",
    lat: 39.4991,
    lon: -119.7681
  },
  BRC: { code: "BRC", label: "Black Rock City", lat: 40.7864, lon: -119.2065 },
  "LOS ANGELES": { label: "Los Angeles", lat: 34.0522, lon: -118.2437 },
  RENO: { label: "Reno", lat: 39.5296, lon: -119.8138 },
  GENEVA: { label: "Geneva", lat: 46.2044, lon: 6.1432 },
  ZURICH: { label: "Zurich", lat: 47.3769, lon: 8.5417 }
};

const ROUTE_POINT_ALIASES: Record<string, string> = {
  "GENEVA AIRPORT": "GVA",
  "GENEVA COINTRIN": "GVA",
  "ZURICH AIRPORT": "ZRH",
  "ZUERICH AIRPORT": "ZRH",
  "LOS ANGELES INTERNATIONAL AIRPORT": "LAX",
  "LOS ANGELES INT": "LAX",
  "HOLLYWOOD BURBANK AIRPORT": "BUR",
  "BURBANK AIRPORT": "BUR",
  "RENO-TAHOE INTERNATIONAL AIRPORT": "RNO",
  "RENO TAHOE INTERNATIONAL AIRPORT": "RNO",
  "BLACK ROCK CITY": "BRC"
};

type LifeEventMapPalette = {
  primary: string;
  secondary: string;
  surfaceLow: string;
  surfaceHigh: string;
  ink: string;
  dark: boolean;
};

function getLifeEventMapPalette(): LifeEventMapPalette {
  return {
    primary: resolveForgeThemeToken("--primary", "#2563eb"),
    secondary: resolveForgeThemeToken("--secondary", "#0f8b6d"),
    surfaceLow: resolveForgeThemeToken("--surface-low", "#dbe5ec"),
    surfaceHigh: resolveForgeThemeToken("--surface-high", "#ffffff"),
    ink: resolveForgeThemeToken("--forge-body-text", "#162334"),
    dark:
      typeof document !== "undefined" &&
      document.body.classList.contains("theme-forge-dark")
  };
}

function createDefaultGlobeStyle(palette: LifeEventMapPalette) {
  return {
    version: 8,
    projection: { type: "globe" },
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "OpenStreetMap contributors"
      }
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": palette.surfaceLow }
      },
      {
        id: "osm",
        type: "raster",
        source: "osm",
        paint: {
          "raster-saturation": palette.dark ? -0.55 : -0.25,
          "raster-contrast": palette.dark ? 0.18 : 0.08,
          "raster-brightness-min": palette.dark ? 0.02 : 0.08,
          "raster-brightness-max": palette.dark ? 0.58 : 0.92
        }
      }
    ]
  } as const;
}

type LifeEventTypeOption = {
  value: LifeEventType;
  label: string;
  hint: string;
  icon: typeof Plane;
};

const EVENT_TYPE_GROUPS: Array<{
  label: string;
  description: string;
  items: LifeEventTypeOption[];
}> = [
  {
    label: "Travel and stays",
    description: "Moving, arriving, staying, or being away for a period.",
    items: [
      {
        value: "travel_flight",
        label: "Flight",
        hint: "Plane journey",
        icon: Plane
      },
      {
        value: "travel_train",
        label: "Train",
        hint: "Rail journey",
        icon: Train
      },
      {
        value: "travel_car",
        label: "Car trip",
        hint: "Drive or road trip",
        icon: Car
      },
      {
        value: "travel_boat",
        label: "Boat",
        hint: "Ferry, ship, boat",
        icon: Ship
      },
      {
        value: "travel_trip",
        label: "Trip",
        hint: "Whole journey",
        icon: MapPinned
      },
      {
        value: "travel_day",
        label: "Travel day",
        hint: "Transit day",
        icon: MapPin
      },
      {
        value: "stay",
        label: "Stay",
        hint: "Days or months somewhere",
        icon: Home
      },
      {
        value: "lodging",
        label: "Lodging",
        hint: "Hotel, Airbnb, host",
        icon: BedDouble
      },
      { value: "holiday", label: "Holiday", hint: "Time off", icon: Sparkles },
      {
        value: "vacation",
        label: "Vacation",
        hint: "Leisure trip",
        icon: Tent
      },
      { value: "visit", label: "Visit", hint: "Seeing someone", icon: Users },
      { value: "move", label: "Move", hint: "Changing place", icon: Home }
    ]
  },
  {
    label: "Culture and people",
    description: "Events with people, venues, ceremonies, and shared time.",
    items: [
      {
        value: "festival",
        label: "Festival",
        hint: "Multi-day event",
        icon: Tent
      },
      { value: "concert", label: "Concert", hint: "Music event", icon: Music },
      {
        value: "cinema",
        label: "Cinema",
        hint: "Film or screening",
        icon: Clapperboard
      },
      {
        value: "meal",
        label: "Meal",
        hint: "Dinner, lunch, tasting",
        icon: Utensils
      },
      {
        value: "party",
        label: "Party",
        hint: "Social gathering",
        icon: PartyPopper
      },
      {
        value: "ceremony",
        label: "Ceremony",
        hint: "Formal moment",
        icon: Landmark
      },
      {
        value: "date",
        label: "Date",
        hint: "Romantic or personal",
        icon: Sparkles
      },
      { value: "friends", label: "Friends", hint: "Friend time", icon: Users },
      { value: "family", label: "Family", hint: "Family time", icon: Users },
      {
        value: "celebration",
        label: "Celebration",
        hint: "Milestone moment",
        icon: PartyPopper
      }
    ]
  },
  {
    label: "Work and learning",
    description: "Long phases, deadlines, study periods, and major work.",
    items: [
      {
        value: "work_milestone",
        label: "Work milestone",
        hint: "Launch or decision",
        icon: Milestone
      },
      {
        value: "work_phase",
        label: "Work phase",
        hint: "Important work period",
        icon: BriefcaseBusiness
      },
      {
        value: "thesis_milestone",
        label: "Thesis milestone",
        hint: "Thesis checkpoint",
        icon: GraduationCap
      },
      {
        value: "creative_work",
        label: "Creative work",
        hint: "Making or shipping",
        icon: BookOpen
      },
      {
        value: "class_course",
        label: "Class or course",
        hint: "Learning period",
        icon: GraduationCap
      },
      { value: "exam", label: "Exam", hint: "Assessment", icon: BookOpen },
      {
        value: "deadline",
        label: "Deadline",
        hint: "Due date",
        icon: CalendarClock
      },
      {
        value: "conference",
        label: "Conference",
        hint: "Talks or congress",
        icon: BriefcaseBusiness
      },
      {
        value: "retreat",
        label: "Retreat",
        hint: "Focused time away",
        icon: Tent
      }
    ]
  },
  {
    label: "Care and life admin",
    description: "Health, administration, memory, and custom life records.",
    items: [
      {
        value: "medical",
        label: "Medical",
        hint: "Appointment",
        icon: CalendarClock
      },
      {
        value: "health_episode",
        label: "Health episode",
        hint: "Days or weeks of symptoms",
        icon: HeartPulse
      },
      {
        value: "therapy",
        label: "Therapy",
        hint: "Therapy session or period",
        icon: HeartPulse
      },
      {
        value: "administrative",
        label: "Admin",
        hint: "Paperwork or process",
        icon: CalendarCheck2
      },
      {
        value: "legal_financial",
        label: "Legal or financial",
        hint: "Formal life admin",
        icon: Landmark
      },
      {
        value: "errand",
        label: "Errand",
        hint: "Important practical task",
        icon: CalendarCheck2
      },
      {
        value: "memory",
        label: "Memory",
        hint: "Something to preserve",
        icon: Sparkles
      },
      {
        value: "custom",
        label: "Custom",
        hint: "Write your own shape",
        icon: Milestone
      }
    ]
  }
];

const EVENT_TYPES = EVENT_TYPE_GROUPS.flatMap((group) => group.items);

const defaultDraft = (): LifeEventDraft => {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const now = new Date();
  return {
    title: "",
    shortDescription: "",
    description: "",
    eventType: "custom",
    spanPreset: "same_day",
    importance: "meaningful",
    startsAt: formatDateTimeInputInTimeZone(now.toISOString(), timezone),
    endsAt: formatDateTimeInputInTimeZone(
      addHours(now, 1).toISOString(),
      timezone
    ),
    timezone,
    placeLabel: "",
    originLabel: "",
    destinationLabel: "",
    transportMode: "",
    calendarProjection: "link_or_create"
  };
};

const defaultTicketDraft = (): TicketImportDraft => ({
  files: [],
  sourceLabel: "Ticket upload",
  useLlm: true
});

function draftFromLifeEvent(event: LifeEvent): LifeEventDraft {
  return {
    title: event.title,
    shortDescription: event.shortDescription,
    description: event.description,
    eventType: event.eventType,
    spanPreset: inferSpanPreset(event.startsAt, event.endsAt, event.timezone),
    importance: event.importance,
    startsAt: formatDateTimeInputInTimeZone(event.startsAt, event.timezone),
    endsAt: formatDateTimeInputInTimeZone(event.endsAt, event.timezone),
    timezone: event.timezone,
    placeLabel: event.placeLabel,
    originLabel: event.originLabel,
    destinationLabel: event.destinationLabel,
    transportMode: event.transportMode ?? "",
    calendarProjection: event.primaryCalendarEventId ? "link_or_create" : "none"
  };
}

function addHours(date: Date, hours: number) {
  const next = new Date(date);
  next.setHours(next.getHours() + hours);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function inferSpanPreset(
  startsAt: string,
  endsAt: string,
  timezone?: string
): LifeEventDraft["spanPreset"] {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "custom";
  }
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  if (hours <= 12 && isSameDateInTimeZone(start, end, timezone)) {
    return "same_day";
  }
  if (hours <= 36) {
    return "overnight";
  }
  if (hours <= 24 * 14) {
    return "multi_day";
  }
  if (hours >= 24 * 45) {
    return "multi_month";
  }
  return "custom";
}

function applySpanPreset(
  draft: LifeEventDraft,
  preset: LifeEventDraft["spanPreset"]
) {
  const start = parseDateTimeInputInTimeZone(draft.startsAt, draft.timezone);
  const startDate = start ? new Date(start) : new Date();
  const endDate =
    preset === "same_day"
      ? addHours(startDate, 1)
      : preset === "overnight"
        ? addDays(startDate, 1)
        : preset === "multi_day"
          ? addDays(startDate, 3)
          : preset === "multi_month"
            ? addMonths(startDate, 1)
            : draft.endsAt
              ? new Date(
                  parseDateTimeInputInTimeZone(draft.endsAt, draft.timezone) ??
                    addHours(startDate, 1)
                )
              : addHours(startDate, 1);
  return {
    spanPreset: preset,
    startsAt: formatDateTimeInputInTimeZone(
      startDate.toISOString(),
      draft.timezone
    ),
    endsAt: formatDateTimeInputInTimeZone(endDate.toISOString(), draft.timezone)
  };
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(
        result.includes(",") ? result.slice(result.indexOf(",") + 1) : result
      );
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function durationParts(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const ms = Math.max(0, end.getTime() - start.getTime());
  const hours = ms / 3_600_000;
  const days = ms / 86_400_000;
  return { start, end, ms, hours, days };
}

function formatDurationLabel(startsAt: string, endsAt: string) {
  const { hours, days } = durationParts(startsAt, endsAt);
  if (hours < 1) {
    return "Under 1 hour";
  }
  if (hours < 24) {
    const roundedHours = Math.max(1, Math.round(hours));
    return `${roundedHours} ${roundedHours === 1 ? "hour" : "hours"}`;
  }
  if (days < 14) {
    const roundedDays = Math.max(1, Math.ceil(days));
    return `${roundedDays} ${roundedDays === 1 ? "day" : "days"}`;
  }
  if (days < 62) {
    const roundedWeeks = Math.max(1, Math.round(days / 7));
    return `${roundedWeeks} ${roundedWeeks === 1 ? "week" : "weeks"}`;
  }
  const roundedMonths = Math.max(1, Math.round(days / 30.4375));
  return `${roundedMonths} ${roundedMonths === 1 ? "month" : "months"}`;
}

function formatSpanSummary(
  startsAt: string,
  endsAt: string,
  timezone?: string
) {
  const { start, end } = durationParts(startsAt, endsAt);
  if (isSameDateInTimeZone(start, end, timezone)) {
    return `${formatDateInTimeZone(startsAt, timezone)} · ${formatTimeInTimeZone(
      startsAt,
      timezone
    )} - ${formatTimeInTimeZone(endsAt, timezone)}`;
  }
  return `${formatShortDateInTimeZone(
    startsAt,
    timezone
  )} - ${formatShortDateInTimeZone(
    endsAt,
    timezone
  )} · ${formatDurationLabel(startsAt, endsAt)}`;
}

function formatSpanDetail(startsAt: string, endsAt: string, timezone?: string) {
  const { start, end } = durationParts(startsAt, endsAt);
  if (isSameDateInTimeZone(start, end, timezone)) {
    return `${formatDateInTimeZone(startsAt, timezone)} from ${formatTimeInTimeZone(
      startsAt,
      timezone
    )} to ${formatTimeInTimeZone(endsAt, timezone)}`;
  }
  return `${formatDateInTimeZone(startsAt, timezone)} ${formatTimeInTimeZone(
    startsAt,
    timezone
  )} to ${formatDateInTimeZone(endsAt, timezone)} ${formatTimeInTimeZone(
    endsAt,
    timezone
  )}`;
}

function eventTimingState(event: LifeEvent) {
  const now = Date.now();
  if (Date.parse(event.startsAt) <= now && Date.parse(event.endsAt) >= now) {
    return "current";
  }
  return Date.parse(event.endsAt) < now ? "past" : "upcoming";
}

function transportModeForEventType(
  eventType: LifeEventType,
  fallback: LifeEventDraft["transportMode"]
): LifeEventDraft["transportMode"] {
  if (eventType === "travel_flight") {
    return "plane";
  }
  if (eventType === "travel_train") {
    return "train";
  }
  if (eventType === "travel_car") {
    return "car";
  }
  if (eventType === "travel_boat") {
    return "boat";
  }
  return fallback;
}

function formatEventType(type: LifeEventType) {
  return (
    EVENT_TYPES.find((entry) => entry.value === type)?.label ??
    type.replaceAll("_", " ")
  );
}

function eventIcon(type: LifeEventType) {
  return EVENT_TYPES.find((entry) => entry.value === type)?.icon ?? Milestone;
}

function timelineStats(timeline: LifeEventTimelinePayload | undefined) {
  const events = timeline?.events ?? [];
  const now = Date.now();
  const past = events.filter((event) => Date.parse(event.endsAt) < now).length;
  const current = events.filter(
    (event) =>
      Date.parse(event.startsAt) <= now && Date.parse(event.endsAt) >= now
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
    event.segments
      .map((segment) => `${segment.carrierCode}${segment.serviceNumber}`)
      .join(" ")
  ]
    .join(" ")
    .toLowerCase();
}

function normalizeRouteKey(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

function inferKnownRouteCode(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = normalizeRouteKey(value ?? "");
    if (!normalized) {
      continue;
    }
    if (KNOWN_ROUTE_POINTS[normalized]) {
      return normalized;
    }
    if (ROUTE_POINT_ALIASES[normalized]) {
      return ROUTE_POINT_ALIASES[normalized];
    }
    if (normalized.includes("GENEVA")) {
      return "GVA";
    }
    if (normalized.includes("ZURICH") || normalized.includes("ZUERICH")) {
      return "ZRH";
    }
    if (
      normalized.includes("LOS ANGELES INTERNATIONAL") ||
      normalized === "LOS ANGELES INT"
    ) {
      return "LAX";
    }
    if (normalized.includes("BURBANK")) {
      return "BUR";
    }
    if (normalized.includes("RENO")) {
      return "RNO";
    }
    if (normalized.includes("BLACK ROCK CITY")) {
      return "BRC";
    }
    if (normalized === "LOS ANGELES") {
      return "LOS ANGELES";
    }
  }
  return null;
}

function routePointFromParts({
  label,
  iata,
  city,
  latitude,
  longitude
}: {
  label: string;
  iata?: string;
  city?: string;
  latitude: number | null;
  longitude: number | null;
}) {
  if (latitude != null && longitude != null) {
    return {
      label: label || iata || city || "Route point",
      lat: latitude,
      lon: longitude,
      code: iata || undefined
    };
  }
  const code = inferKnownRouteCode(iata, label, city);
  if (!code) {
    return null;
  }
  const known = KNOWN_ROUTE_POINTS[code];
  return {
    ...known,
    label: label || known.label,
    code: iata || known.code
  };
}

function sameRoutePoint(a: RoutePoint, b: RoutePoint) {
  if (a.code && b.code && a.code === b.code) {
    return true;
  }
  return Math.abs(a.lat - b.lat) < 0.001 && Math.abs(a.lon - b.lon) < 0.001;
}

function routeStops(event: LifeEvent) {
  const stops: RoutePoint[] = [];
  const addStop = (point: RoutePoint | null) => {
    if (!point) {
      return;
    }
    const last = stops.at(-1);
    if (!last || !sameRoutePoint(last, point)) {
      stops.push(point);
    }
  };

  const segments = [...event.segments].sort(
    (a, b) => a.sequenceIndex - b.sequenceIndex
  );
  for (const segment of segments) {
    addStop(
      routePointFromParts({
        label: segment.originLabel,
        iata: segment.originIata,
        city: segment.originCity,
        latitude: segment.originLatitude,
        longitude: segment.originLongitude
      })
    );
    addStop(
      routePointFromParts({
        label: segment.destinationLabel,
        iata: segment.destinationIata,
        city: segment.destinationCity,
        latitude: segment.destinationLatitude,
        longitude: segment.destinationLongitude
      })
    );
  }

  if (stops.length < 2) {
    addStop(
      routePointFromParts({
        label: event.originLabel,
        city: event.originCity,
        latitude: event.originLatitude,
        longitude: event.originLongitude
      })
    );
    addStop(
      routePointFromParts({
        label: event.destinationLabel,
        city: event.destinationCity,
        latitude: event.destinationLatitude,
        longitude: event.destinationLongitude
      })
    );
  }

  return stops.length >= 2 ? stops : null;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function vectorFromPoint(point: RoutePoint) {
  const lat = toRadians(point.lat);
  const lon = toRadians(point.lon);
  return {
    x: Math.cos(lat) * Math.cos(lon),
    y: Math.cos(lat) * Math.sin(lon),
    z: Math.sin(lat)
  };
}

function pointFromVector(vector: {
  x: number;
  y: number;
  z: number;
}): [number, number] {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  const x = vector.x / length;
  const y = vector.y / length;
  const z = vector.z / length;
  return [toDegrees(Math.atan2(y, x)), toDegrees(Math.asin(z))];
}

function interpolateGreatCircle(from: RoutePoint, to: RoutePoint, steps = 72) {
  const start = vectorFromPoint(from);
  const end = vectorFromPoint(to);
  const dot = Math.max(
    -1,
    Math.min(1, start.x * end.x + start.y * end.y + start.z * end.z)
  );
  const omega = Math.acos(dot);
  if (omega < 0.000001) {
    return [
      [from.lon, from.lat],
      [to.lon, to.lat]
    ] as Array<[number, number]>;
  }
  const sinOmega = Math.sin(omega);
  const coordinates: Array<[number, number]> = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const startWeight = Math.sin((1 - t) * omega) / sinOmega;
    const endWeight = Math.sin(t * omega) / sinOmega;
    coordinates.push(
      pointFromVector({
        x: startWeight * start.x + endWeight * end.x,
        y: startWeight * start.y + endWeight * end.y,
        z: startWeight * start.z + endWeight * end.z
      })
    );
  }
  return coordinates;
}

function routeLineFeatureCollection(
  stops: RoutePoint[]
): RouteLineFeatureCollection {
  return {
    type: "FeatureCollection",
    features: stops.slice(1).map((stop, index) => {
      const from = stops[index]!;
      return {
        type: "Feature",
        properties: {
          from: from.label,
          to: stop.label,
          sequence: index
        },
        geometry: {
          type: "LineString",
          coordinates: interpolateGreatCircle(from, stop)
        }
      };
    })
  };
}

function routeStopFeatureCollection(
  stops: RoutePoint[]
): RouteStopFeatureCollection {
  return {
    type: "FeatureCollection",
    features: stops.map((stop, index) => ({
      type: "Feature",
      properties: {
        label: stop.code || stop.label,
        fullLabel: stop.label,
        sequence: index
      },
      geometry: {
        type: "Point",
        coordinates: [stop.lon, stop.lat]
      }
    }))
  };
}

function fallbackProjection(point: RoutePoint) {
  return {
    x: 70 + ((point.lon + 180) / 360) * 500,
    y: 42 + ((90 - point.lat) / 180) * 216
  };
}

function fallbackArcPath(from: RoutePoint, to: RoutePoint) {
  const start = fallbackProjection(from);
  const end = fallbackProjection(to);
  const lift = Math.min(88, Math.max(34, Math.abs(end.x - start.x) * 0.2));
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${((start.x + end.x) / 2).toFixed(1)} ${(
    Math.min(start.y, end.y) - lift
  ).toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

function LifeEventGlobeFallback({ stops }: { stops: RoutePoint[] }) {
  const first = stops[0]!;
  const last = stops.at(-1)!;
  return (
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_30%,color-mix(in_srgb,var(--surface-high)_96%,transparent),color-mix(in_srgb,var(--surface-panel)_88%,transparent)_34%,color-mix(in_srgb,var(--secondary)_15%,var(--surface-low)_85%)_100%)]">
      <svg
        className="h-full w-full"
        viewBox="0 0 640 300"
        role="img"
        aria-label={`${first.label} to ${last.label}`}
      >
        <defs>
          <radialGradient
            id="life-event-globe-fallback-fill"
            cx="35%"
            cy="26%"
            r="72%"
          >
            <stop
              offset="0%"
              stopColor="var(--surface-high)"
              stopOpacity="0.95"
            />
            <stop
              offset="55%"
              stopColor="var(--surface-panel)"
              stopOpacity="0.95"
            />
            <stop
              offset="100%"
              stopColor="var(--surface-low)"
              stopOpacity="0.78"
            />
          </radialGradient>
        </defs>
        <ellipse
          cx="320"
          cy="150"
          rx="248"
          ry="118"
          fill="url(#life-event-globe-fallback-fill)"
          stroke="var(--ui-border-strong)"
          strokeWidth="1.5"
        />
        {[0, 1, 2, 3].map((line) => (
          <ellipse
            key={`longitude-${line}`}
            cx="320"
            cy="150"
            rx={44 + line * 48}
            ry="118"
            fill="none"
            stroke="var(--primary)"
            strokeDasharray="4 6"
            strokeOpacity="0.22"
          />
        ))}
        {[84, 118, 150, 182, 216].map((y) => (
          <path
            key={`latitude-${y}`}
            d={`M 92 ${y} Q 320 ${y - 24} 548 ${y}`}
            fill="none"
            stroke="var(--primary)"
            strokeDasharray="4 6"
            strokeOpacity="0.22"
          />
        ))}
        {stops.slice(1).map((stop, index) => {
          const from = stops[index]!;
          return (
            <path
              key={`${from.label}-${stop.label}`}
              d={fallbackArcPath(from, stop)}
              fill="none"
              stroke="var(--primary)"
              strokeLinecap="round"
              strokeWidth="3.5"
            />
          );
        })}
        {stops.map((stop, index) => {
          const point = fallbackProjection(stop);
          return (
            <g key={`${stop.label}-${index}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r="6.5"
                fill={
                  index === stops.length - 1
                    ? "var(--secondary)"
                    : "var(--surface-high)"
                }
                stroke="var(--primary)"
                strokeWidth="2"
              />
              <text
                x={point.x}
                y={point.y + 22}
                textAnchor="middle"
                fill="var(--ui-ink-strong)"
                fontSize="12"
                fontWeight="600"
              >
                {stop.code || stop.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function canCreateWebGlContext() {
  if (typeof document === "undefined") {
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}

function LifeEventRoutePreview({
  event,
  expanded,
  themeKey
}: {
  event: LifeEvent;
  expanded: boolean;
  themeKey: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mapStatus, setMapStatus] = useState<"fallback" | "loading" | "ready">(
    "fallback"
  );
  const stops = useMemo(() => routeStops(event), [event]);
  const routeData = useMemo(
    () => (stops ? routeLineFeatureCollection(stops) : null),
    [stops]
  );
  const stopData = useMemo(
    () => (stops ? routeStopFeatureCollection(stops) : null),
    [stops]
  );
  const styleUrl =
    typeof window !== "undefined"
      ? window.localStorage.getItem("forge.maplibre.style-url")?.trim() ||
        window.localStorage.getItem("forge.map.tile-url")?.trim() ||
        ""
      : "";

  useEffect(() => {
    let cancelled = false;
    let map: import("maplibre-gl").Map | null = null;
    if (
      !expanded ||
      !stops ||
      !routeData ||
      !stopData ||
      !containerRef.current
    ) {
      setMapStatus("fallback");
      return undefined;
    }
    if (!canCreateWebGlContext()) {
      setMapStatus("fallback");
      return undefined;
    }
    setMapStatus("loading");
    void import("maplibre-gl")
      .then((maplibre) => {
        if (cancelled || !containerRef.current) {
          return;
        }
        const supportsWebGl =
          "supported" in maplibre && typeof maplibre.supported === "function"
            ? maplibre.supported({ failIfMajorPerformanceCaveat: false })
            : true;
        if (!supportsWebGl) {
          setMapStatus("fallback");
          return;
        }
        const rasterStyle =
          styleUrl.includes("{x}") || styleUrl.includes("{z}");
        const palette = getLifeEventMapPalette();
        const mapStyle = rasterStyle
          ? {
              version: 8,
              projection: { type: "globe" },
              sources: {
                tiles: { type: "raster", tiles: [styleUrl], tileSize: 256 }
              },
              layers: [{ id: "tiles", type: "raster", source: "tiles" }]
            }
          : styleUrl || createDefaultGlobeStyle(palette);
        const first = stops[0]!;
        try {
          map = new maplibre.Map({
            container: containerRef.current,
            style: mapStyle as ConstructorParameters<
              typeof maplibre.Map
            >[0]["style"],
            center: [first.lon, first.lat],
            zoom: 1.45,
            attributionControl: { compact: true }
          });
        } catch {
          setMapStatus("fallback");
          return;
        }
        map.scrollZoom.disable();
        map.dragRotate.disable();
        map.touchZoomRotate.disableRotation();
        map.on("error", () => {
          if (!cancelled) {
            setMapStatus("fallback");
          }
        });
        map.on("load", () => {
          if (!map) {
            return;
          }
          try {
            map.setProjection({ type: "globe" });
            map.addSource("life-event-route", {
              type: "geojson",
              data: routeData
            });
            map.addLayer({
              id: "life-event-route-glow",
              type: "line",
              source: "life-event-route",
              paint: {
                "line-color": palette.primary,
                "line-opacity": 0.22,
                "line-width": 11
              }
            });
            map.addLayer({
              id: "life-event-route",
              type: "line",
              source: "life-event-route",
              paint: {
                "line-color": palette.primary,
                "line-opacity": 0.96,
                "line-width": 4,
                "line-dasharray": [1.6, 0.7]
              }
            });
            map.addSource("life-event-stops", {
              type: "geojson",
              data: stopData
            });
            map.addLayer({
              id: "life-event-stops",
              type: "circle",
              source: "life-event-stops",
              paint: {
                "circle-radius": 6,
                "circle-color": palette.surfaceHigh,
                "circle-stroke-color": palette.primary,
                "circle-stroke-width": 2
              }
            });
            map.addLayer({
              id: "life-event-stop-labels",
              type: "symbol",
              source: "life-event-stops",
              layout: {
                "text-field": ["get", "label"],
                "text-size": 12,
                "text-font": ["Open Sans Semibold"],
                "text-offset": [0, 1.15],
                "text-anchor": "top"
              },
              paint: {
                "text-color": palette.ink,
                "text-halo-color": palette.surfaceHigh,
                "text-halo-width": 1.5
              }
            });
            const bounds = new maplibre.LngLatBounds(
              [first.lon, first.lat],
              [first.lon, first.lat]
            );
            for (const stop of stops.slice(1)) {
              bounds.extend([stop.lon, stop.lat]);
            }
            map.fitBounds(bounds.adjustAntiMeridian(), {
              padding: 52,
              maxZoom: 3.4,
              duration: 0
            });
            setMapStatus("ready");
          } catch {
            setMapStatus("fallback");
          }
        });
      })
      .catch(() => {
        if (!cancelled) {
          setMapStatus("fallback");
        }
      });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [expanded, routeData, stopData, stops, styleUrl, themeKey]);

  if (!stops) {
    return null;
  }

  return (
    <div className="relative min-h-[280px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]">
      <LifeEventGlobeFallback stops={stops} />
      <div
        ref={containerRef}
        className={cn(
          "absolute inset-0 transition-opacity duration-300",
          mapStatus === "ready"
            ? "opacity-100"
            : "pointer-events-none opacity-0"
        )}
      />
      {mapStatus !== "ready" ? (
        <div className="absolute right-3 top-3 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--surface-glass)] px-3 py-1 text-xs font-medium text-[var(--ui-ink-medium)] shadow-[var(--ui-shadow-soft)] backdrop-blur">
          {mapStatus === "loading" ? "Loading globe" : "Route preview"}
        </div>
      ) : null}
    </div>
  );
}

function LifeEventTravelStatusPanel({
  status,
  loading
}: {
  status: LifeEventTravelStatusPayload | null | undefined;
  loading: boolean;
}) {
  const checkedAt = status?.checkedAt ? new Date(status.checkedAt) : null;
  const checkedLabel =
    status && checkedAt && !Number.isNaN(checkedAt.getTime())
      ? `${formatDateInTimeZone(status.checkedAt)} · ${formatTimeInTimeZone(status.checkedAt)}`
      : null;
  return (
    <div className="grid gap-2 rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Clock3 className="size-4 text-[var(--primary)]" />
        <span className="font-medium text-[var(--ui-ink-strong)]">
          Flight status
        </span>
        {status ? (
          <Badge tone={status.providerConfigured ? "signal" : "meta"} size="xs">
            {status.providerConfigured
              ? status.provider || "Live provider"
              : "Scheduled data"}
          </Badge>
        ) : null}
      </div>
      <div className="leading-6 text-[var(--ui-ink-medium)]">
        {loading
          ? "Checking travel status..."
          : (status?.message ?? "No travel status response yet.")}
      </div>
      {status ? (
        <div className="flex flex-wrap gap-2 text-xs text-[var(--ui-ink-soft)]">
          {status.flightNumber ? (
            <Badge tone="meta" size="xs">
              {status.flightNumber}
            </Badge>
          ) : null}
          <span>{status.status.replaceAll("_", " ")}</span>
          {checkedLabel ? <span>Checked {checkedLabel}</span> : null}
          {!status.providerConfigured ? (
            <span>Live provider not configured</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LifeEventCard({
  event,
  next,
  expanded,
  themeKey,
  travelStatus,
  travelStatusLoading,
  onToggle,
  onEdit,
  onSyncCalendar
}: {
  event: LifeEvent;
  next: boolean;
  expanded: boolean;
  themeKey: string;
  travelStatus?: LifeEventTravelStatusPayload | null;
  travelStatusLoading?: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onSyncCalendar: () => void;
}) {
  const Icon = eventIcon(event.eventType);
  const isTravelStatusEvent = event.eventType.startsWith("travel_");
  const hasRoutePreview =
    isTravelStatusEvent ||
    ["move", "vacation", "holiday", "visit", "stay", "travel_trip"].includes(
      event.eventType
    );
  const spanSummary = formatSpanSummary(
    event.startsAt,
    event.endsAt,
    event.timezone
  );
  const spanDetail = formatSpanDetail(
    event.startsAt,
    event.endsAt,
    event.timezone
  );
  const durationLabel = formatDurationLabel(event.startsAt, event.endsAt);
  const timingState = eventTimingState(event);
  const showDurationBadge =
    durationParts(event.startsAt, event.endsAt).hours >= 24;
  const primaryLocation =
    event.placeLabel ||
    [event.destinationLabel, event.destinationCity, event.destinationCountry]
      .filter(Boolean)
      .join(", ") ||
    [event.originLabel, event.originCity, event.originCountry]
      .filter(Boolean)
      .join(", ");

  return (
    <Card
      data-testid="life-event-card"
      className={cn(
        "relative overflow-hidden p-0",
        next &&
          "border-[color-mix(in_srgb,var(--primary)_38%,var(--ui-border-subtle)_62%)]"
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
            {next ? (
              <Badge
                tone={timingState === "current" ? "signal" : "meta"}
                size="xs"
              >
                {timingState === "current" ? "Now" : "Next"}
              </Badge>
            ) : null}
            <Badge tone="meta" size="xs">
              {formatEventType(event.eventType)}
            </Badge>
            {showDurationBadge ? (
              <Badge tone="signal" size="xs">
                {durationLabel}
              </Badge>
            ) : null}
          </span>
          <span className="mt-1 block text-sm text-[var(--ui-ink-soft)]">
            {spanSummary}
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
              <div className="text-xs uppercase tracking-[0.08em] text-[var(--ui-ink-faint)]">
                Span
              </div>
              <div className="mt-1 text-sm text-[var(--ui-ink-strong)]">
                {spanDetail}
              </div>
              <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                {durationLabel}
              </div>
            </div>
            <div className="rounded-[var(--radius-card)] bg-[var(--ui-surface-1)] p-3">
              <div className="text-xs uppercase tracking-[0.08em] text-[var(--ui-ink-faint)]">
                Calendar
              </div>
              <div className="mt-1 text-sm text-[var(--ui-ink-strong)]">
                {event.primaryCalendarEventId
                  ? event.calendarSyncState.replaceAll("_", " ")
                  : "Not linked"}
              </div>
            </div>
            <div className="rounded-[var(--radius-card)] bg-[var(--ui-surface-1)] p-3">
              <div className="text-xs uppercase tracking-[0.08em] text-[var(--ui-ink-faint)]">
                Links
              </div>
              <div className="mt-1 text-sm text-[var(--ui-ink-strong)]">
                {event.links.length}
              </div>
            </div>
          </div>
          {hasRoutePreview ? (
            <LifeEventRoutePreview
              event={event}
              expanded={expanded}
              themeKey={themeKey}
            />
          ) : null}
          {isTravelStatusEvent ? (
            <LifeEventTravelStatusPanel
              status={travelStatus}
              loading={Boolean(travelStatusLoading)}
            />
          ) : null}
          {event.segments.length > 0 ? (
            <div className="grid gap-2">
              {event.segments.map((segment) => (
                <div
                  key={segment.id}
                  className="grid gap-2 rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm md:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--ui-ink-strong)]">
                      {segment.title ||
                        `${segment.originLabel} to ${segment.destinationLabel}`}
                    </div>
                    <div className="mt-1 text-[var(--ui-ink-soft)]">
                      {[
                        segment.originIata || segment.originLabel,
                        segment.destinationIata || segment.destinationLabel
                      ]
                        .filter(Boolean)
                        .join(" -> ")}
                    </div>
                  </div>
                  <Badge tone="meta" size="sm">
                    {segment.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onEdit}
            >
              <PencilLine className="size-4" />
              Edit
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onSyncCalendar}
            >
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
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => inputRef.current?.click()}
        >
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
  const themeKey = useForgeThemeKey();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedEventId = searchParams.get("focus")?.trim() || null;
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(focusedEventId);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<LifeEvent | null>(null);
  const [draft, setDraft] = useState<LifeEventDraft>(() => defaultDraft());
  const [ticketDraft, setTicketDraft] = useState<TicketImportDraft>(() =>
    defaultTicketDraft()
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  const timelineQuery = useQuery({
    queryKey: ["life-events-timeline"],
    queryFn: async () => (await getLifeEventsTimeline({ limit: 500 })).timeline
  });
  const timeline = timelineQuery.data;
  const focusedEventInTimeline = focusedEventId
    ? timeline?.events.find((event) => event.id === focusedEventId)
    : undefined;
  const focusedEventQuery = useQuery({
    queryKey: ["life-event-focus", focusedEventId],
    enabled: Boolean(
      focusedEventId && timelineQuery.isSuccess && !focusedEventInTimeline
    ),
    queryFn: async () => (await getLifeEvent(focusedEventId!)).lifeEvent,
    retry: false
  });
  const timelineEvents = useMemo(() => {
    const events = timeline?.events ?? [];
    const focusedEvent = focusedEventQuery.data;
    if (!focusedEvent || events.some((event) => event.id === focusedEvent.id)) {
      return events;
    }
    return [...events, focusedEvent].sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) ||
        left.createdAt.localeCompare(right.createdAt)
    );
  }, [focusedEventQuery.data, timeline?.events]);
  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return timelineEvents;
    }
    return timelineEvents.filter((event) =>
      buildEventSearchText(event).includes(needle)
    );
  }, [query, timelineEvents]);
  const stats = timelineStats(timeline);

  useEffect(() => {
    if (
      !focusedEventId ||
      !timelineEvents.some((event) => event.id === focusedEventId)
    ) {
      return;
    }
    setQuery("");
    setExpandedId(focusedEventId);
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(
        `forge-life-event-${focusedEventId}`
      );
      if (typeof target?.scrollIntoView === "function") {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedEventId, timelineEvents]);

  function toggleExpandedEvent(eventId: string) {
    const nextId = expandedId === eventId ? null : eventId;
    setExpandedId(nextId);
    const nextSearchParams = new URLSearchParams(searchParams);
    if (nextId) {
      nextSearchParams.set("focus", nextId);
    } else {
      nextSearchParams.delete("focus");
    }
    setSearchParams(nextSearchParams, { replace: true });
  }

  const buildLifeEventPayload = (value: LifeEventDraft) => {
    const startsAt = parseDateTimeInputInTimeZone(
      value.startsAt,
      value.timezone
    );
    const endsAt = parseDateTimeInputInTimeZone(value.endsAt, value.timezone);
    if (!value.title.trim()) {
      throw new Error("Name the Life Event before saving it.");
    }
    if (!startsAt) {
      throw new Error("Add a valid start date and time.");
    }
    if (!endsAt) {
      throw new Error("Add a valid end date and time.");
    }
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw new Error("The Life Event must end after it starts.");
    }
    const data: Record<string, unknown> = {
      title: value.title.trim(),
      shortDescription: value.shortDescription.trim(),
      description: value.description.trim(),
      eventType: value.eventType,
      importance: value.importance,
      startsAt,
      endsAt,
      timezone: value.timezone.trim() || "UTC",
      placeLabel: value.placeLabel.trim(),
      originLabel: value.originLabel.trim(),
      destinationLabel: value.destinationLabel.trim(),
      calendarProjection: value.calendarProjection
    };
    if (value.transportMode) {
      data.transportMode = value.transportMode;
    } else {
      data.transportMode = null;
    }
    return data;
  };

  const createMutation = useMutation({
    mutationFn: async (value: LifeEventDraft) => {
      const data = buildLifeEventPayload(value);
      await createEntities({
        operations: [{ entityType: "life_event", data }],
        atomic: true
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["life-events-timeline"]
      });
      await queryClient.invalidateQueries({ queryKey: ["knowledge-graph"] });
      setDraft(defaultDraft());
      setEventDialogOpen(false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      event,
      value
    }: {
      event: LifeEvent;
      value: LifeEventDraft;
    }) => {
      await updateEntities({
        operations: [
          {
            entityType: "life_event",
            id: event.id,
            patch: buildLifeEventPayload(value)
          }
        ],
        atomic: true
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["life-events-timeline"]
      });
      await queryClient.invalidateQueries({ queryKey: ["knowledge-graph"] });
      setDraft(defaultDraft());
      setEditingEvent(null);
      setEventDialogOpen(false);
    }
  });

  const ticketMutation = useMutation({
    mutationFn: async (value: TicketImportDraft) => {
      if (value.files.length === 0) {
        throw new Error("Choose one or more ticket files.");
      }
      for (const file of value.files) {
        const title = file.name
          .replace(/\.[^.]+$/, "")
          .replace(/[_-]+/g, " ")
          .trim();
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
    mutationFn: (id: string) =>
      syncLifeEventCalendar(id, { projection: "link_or_create" }),
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
          <div className="grid gap-4">
            {EVENT_TYPE_GROUPS.map((group) => (
              <section key={group.label} className="grid gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--ui-ink-strong)]">
                    {group.label}
                  </div>
                  <div className="text-xs leading-5 text-[var(--ui-ink-soft)]">
                    {group.description}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((entry) => {
                    const Icon = entry.icon;
                    const selected = value.eventType === entry.value;
                    return (
                      <button
                        key={entry.value}
                        type="button"
                        className={cn(
                          "flex min-h-20 min-w-0 items-start gap-3 rounded-[var(--radius-card)] border p-3 text-left transition",
                          selected
                            ? "border-[var(--primary)] bg-[var(--ui-accent-soft)]"
                            : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] hover:bg-[var(--ui-surface-hover)]"
                        )}
                        onClick={() =>
                          setValue({
                            eventType: entry.value,
                            transportMode: transportModeForEventType(
                              entry.value,
                              value.transportMode
                            )
                          })
                        }
                      >
                        <Icon className="mt-0.5 size-5 shrink-0 text-[var(--primary)]" />
                        <span className="min-w-0">
                          <span className="block break-words text-sm font-medium text-[var(--ui-ink-strong)]">
                            {entry.label}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-[var(--ui-ink-soft)]">
                            {entry.hint}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
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
              onChange={(event) =>
                setValue({ shortDescription: event.target.value })
              }
              placeholder="Seeing family for the long weekend"
            />
            <Textarea
              value={value.description}
              onChange={(event) =>
                setValue({ description: event.target.value })
              }
              placeholder="What makes this event worth keeping in the life timeline?"
              rows={5}
            />
          </div>
        )
      },
      {
        id: "time-place",
        eyebrow: "When and where",
        title: "Set the span and place.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ["same_day", "Same day", "Hours"],
                ["overnight", "Overnight", "One night"],
                ["multi_day", "Several days", "Stay, visit, festival"],
                ["multi_month", "Month or longer", "Course, phase, long stay"],
                ["custom", "Custom span", "Set exact dates"]
              ].map(([preset, label, hint]) => {
                const selected = value.spanPreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    className={cn(
                      "min-w-0 rounded-[var(--radius-card)] border p-3 text-left transition",
                      selected
                        ? "border-[var(--primary)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                        : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)]"
                    )}
                    onClick={() =>
                      setValue(
                        applySpanPreset(
                          value,
                          preset as LifeEventDraft["spanPreset"]
                        )
                      )
                    }
                  >
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="mt-1 block text-xs text-[var(--ui-ink-soft)]">
                      {hint}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--ui-ink-faint)]">
                  Starts
                </span>
                <Input
                  type="datetime-local"
                  value={value.startsAt}
                  onChange={(event) =>
                    setValue({
                      startsAt: event.target.value,
                      spanPreset: "custom"
                    })
                  }
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--ui-ink-faint)]">
                  Ends
                </span>
                <Input
                  type="datetime-local"
                  value={value.endsAt}
                  onChange={(event) =>
                    setValue({
                      endsAt: event.target.value,
                      spanPreset: "custom"
                    })
                  }
                />
              </label>
              <Input
                value={value.placeLabel}
                onChange={(event) =>
                  setValue({ placeLabel: event.target.value })
                }
                placeholder="Place, venue, city, or region"
              />
              <Input
                value={value.timezone}
                onChange={(event) => setValue({ timezone: event.target.value })}
                placeholder="Timezone"
              />
              <Input
                value={value.originLabel}
                onChange={(event) =>
                  setValue({ originLabel: event.target.value })
                }
                placeholder="Origin, if travel matters"
              />
              <Input
                value={value.destinationLabel}
                onChange={(event) =>
                  setValue({ destinationLabel: event.target.value })
                }
                placeholder="Destination, stay, or arrival place"
              />
            </div>
            {value.startsAt && value.endsAt ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3 text-sm text-[var(--ui-ink-medium)]">
                <span className="font-medium text-[var(--ui-ink-strong)]">
                  {formatDurationLabel(
                    parseDateTimeInputInTimeZone(
                      value.startsAt,
                      value.timezone
                    ) ?? new Date().toISOString(),
                    parseDateTimeInputInTimeZone(
                      value.endsAt,
                      value.timezone
                    ) ?? new Date().toISOString()
                  )}
                </span>{" "}
                in the Life Events timeline
              </div>
            ) : null}
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
                    calendarProjection:
                      projection as LifeEventDraft["calendarProjection"]
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
              onChange={(event) =>
                setValue({ sourceLabel: event.target.value })
              }
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
            <Button
              type="button"
              variant="secondary"
              onClick={() => setTicketDialogOpen(true)}
            >
              <FileUp className="size-4" />
              Import tickets
            </Button>
            <Button
              type="button"
              onClick={() => {
                setEditingEvent(null);
                setDraft(defaultDraft());
                setEventDialogOpen(true);
              }}
            >
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
        <div className="relative grid gap-3">
          <div className="absolute bottom-6 left-4 top-6 w-px bg-[var(--ui-border-subtle)]" />
          {filteredEvents.map((event) => {
            const isNext = event.id === timeline?.nextLifeEventId;
            const isExpanded = expandedId === event.id;
            return (
              <div
                key={event.id}
                id={`forge-life-event-${event.id}`}
                data-life-event-id={event.id}
                className="relative grid grid-cols-[2rem_1fr] gap-3"
              >
                <div className="relative flex justify-center">
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
                  themeKey={themeKey}
                  travelStatus={isExpanded ? statusQuery.data : null}
                  travelStatusLoading={
                    isExpanded ? statusQuery.isFetching : false
                  }
                  onToggle={() => toggleExpandedEvent(event.id)}
                  onEdit={() => {
                    setEditingEvent(event);
                    setDraft(draftFromLifeEvent(event));
                    setEventDialogOpen(true);
                  }}
                  onSyncCalendar={() => syncMutation.mutate(event.id)}
                />
              </div>
            );
          })}
        </div>
      )}

      <QuestionFlowDialog
        open={eventDialogOpen}
        onOpenChange={(open) => {
          setEventDialogOpen(open);
          if (!open) {
            setSubmitError(null);
            setEditingEvent(null);
            setDraft(defaultDraft());
          }
        }}
        eyebrow="Life Event"
        title={editingEvent ? "Edit Life Event" : "Add Life Event"}
        description={
          editingEvent
            ? "Update the event with the same guided structure used for creation."
            : "Capture the event with enough timing, place, meaning, and calendar behavior to keep it useful later."
        }
        value={draft}
        onChange={setDraft}
        steps={steps}
        draftPersistenceKey={
          editingEvent ? `life-event.edit.${editingEvent.id}` : "life-event.new"
        }
        submitLabel={editingEvent ? "Update Life Event" : "Create Life Event"}
        pending={createMutation.isPending || updateMutation.isPending}
        error={submitError}
        onSubmit={async () => {
          setSubmitError(null);
          if (!draft.title.trim()) {
            setSubmitError("Give the event a clear title before saving.");
            return;
          }
          try {
            if (editingEvent) {
              await updateMutation.mutateAsync({
                event: editingEvent,
                value: draft
              });
            } else {
              await createMutation.mutateAsync(draft);
            }
          } catch (error) {
            setSubmitError(
              error instanceof Error
                ? error.message
                : editingEvent
                  ? "Unable to update Life Event."
                  : "Unable to create Life Event."
            );
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
            setSubmitError(
              error instanceof Error
                ? error.message
                : "Unable to import tickets."
            );
          }
        }}
      />
    </div>
  );
}
