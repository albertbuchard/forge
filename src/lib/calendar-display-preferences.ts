import type { CalendarResource } from "@/lib/types";

export type CalendarDisplayPreferences = {
  useCalendarColors: boolean;
  calendarColors: Record<string, string>;
};

const STORAGE_KEY = "forge.calendar-display-preferences";

export const FORGE_CALENDAR_PALETTE = [
  "#7dd3fc",
  "#34d399",
  "#f59e0b",
  "#fb7185",
  "#60a5fa",
  "#a3e635",
  "#f97316",
  "#22c55e"
] as const;

const DEFAULT_PREFERENCES: CalendarDisplayPreferences = {
  useCalendarColors: true,
  calendarColors: {}
};

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function readCalendarDisplayPreferences(): CalendarDisplayPreferences {
  if (typeof window === "undefined") {
    return DEFAULT_PREFERENCES;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return DEFAULT_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CalendarDisplayPreferences>;
    return {
      useCalendarColors: parsed.useCalendarColors ?? true,
      calendarColors:
        parsed.calendarColors && typeof parsed.calendarColors === "object"
          ? Object.fromEntries(
              Object.entries(parsed.calendarColors).filter((entry): entry is [string, string] => isHexColor(entry[1]))
            )
          : {}
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function writeCalendarDisplayPreferences(preferences: CalendarDisplayPreferences) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

export function getCalendarPaletteColor(index: number) {
  return FORGE_CALENDAR_PALETTE[index % FORGE_CALENDAR_PALETTE.length] ?? "#7dd3fc";
}

export function buildCalendarDisplayColorMap(
  calendars: Array<Pick<CalendarResource, "id">>,
  overrides: Record<string, string>
) {
  return Object.fromEntries(
    calendars.map((calendar, index) => [
      calendar.id,
      isHexColor(overrides[calendar.id]) ? overrides[calendar.id] : getCalendarPaletteColor(index)
    ])
  ) as Record<string, string>;
}

export function getFallbackCalendarColor(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return getCalendarPaletteColor(hash);
}
