import type { WorkBlockKind } from "@/lib/types";
import {
  formatDateTimeInputInTimeZone,
  formatTimeInTimeZone,
  localDateKeyInTimeZone,
  parseDateTimeInputInTimeZone
} from "@/lib/timezone-datetime";

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const WORK_BLOCK_PRESETS: Array<{
  kind: WorkBlockKind;
  label: string;
  title: string;
  startMinute: number;
  endMinute: number;
  color: string;
  blockingState: "allowed" | "blocked";
}> = [
  {
    kind: "main_activity",
    label: "Main activity",
    title: "Main Activity",
    startMinute: 8 * 60,
    endMinute: 12 * 60,
    color: "#f97316",
    blockingState: "blocked"
  },
  {
    kind: "secondary_activity",
    label: "Secondary activity",
    title: "Secondary Activity",
    startMinute: 13 * 60,
    endMinute: 17 * 60,
    color: "#22c55e",
    blockingState: "allowed"
  },
  {
    kind: "third_activity",
    label: "Third activity",
    title: "Third Activity",
    startMinute: 17 * 60,
    endMinute: 21 * 60,
    color: "#38bdf8",
    blockingState: "allowed"
  },
  {
    kind: "rest",
    label: "Rest",
    title: "Rest",
    startMinute: 21 * 60,
    endMinute: 23 * 60,
    color: "#a855f7",
    blockingState: "blocked"
  },
  {
    kind: "holiday",
    label: "Holiday",
    title: "Holiday",
    startMinute: 0,
    endMinute: 24 * 60,
    color: "#14b8a6",
    blockingState: "blocked"
  }
];

export function startOfWeek(input = new Date()) {
  const date = new Date(input);
  const day = date.getUTCDay();
  const distance = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + distance);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKeyDistance(startDateKey: string, endDateKey: string) {
  return Math.round(
    (Date.parse(`${endDateKey}T00:00:00.000Z`) -
      Date.parse(`${startDateKey}T00:00:00.000Z`)) /
      (24 * 60 * 60 * 1000)
  );
}

export function buildDefaultCalendarEventTiming(
  dateKey: string,
  timezone: string
) {
  const startAt = parseDateTimeInputInTimeZone(`${dateKey}T09:00`, timezone);
  const endAt = parseDateTimeInputInTimeZone(`${dateKey}T10:00`, timezone);
  if (!startAt || !endAt) {
    throw new Error("Unable to resolve the selected calendar day.");
  }
  return { startAt, endAt };
}

export function moveCalendarSpanToDate(
  input: {
    startAt: string;
    endAt: string;
    timezone: string;
    isAllDay?: boolean;
  },
  targetDateKey: string
) {
  const sourceStart = new Date(input.startAt);
  const sourceEnd = new Date(input.endAt);
  if (
    Number.isNaN(sourceStart.getTime()) ||
    Number.isNaN(sourceEnd.getTime()) ||
    sourceEnd.getTime() <= sourceStart.getTime()
  ) {
    throw new Error("Calendar items must have a valid positive duration.");
  }

  if (input.isAllDay) {
    const sourceStartKey = localDateKeyInTimeZone(sourceStart, input.timezone);
    const sourceEndKey = localDateKeyInTimeZone(sourceEnd, input.timezone);
    const spanDays = Math.max(1, dateKeyDistance(sourceStartKey, sourceEndKey));
    const startAt = parseDateTimeInputInTimeZone(
      `${targetDateKey}T00:00`,
      input.timezone
    );
    const endAt = parseDateTimeInputInTimeZone(
      `${addDaysToDateKey(targetDateKey, spanDays)}T00:00`,
      input.timezone
    );
    if (!startAt || !endAt) {
      throw new Error("Unable to move the all-day calendar item.");
    }
    return { startAt, endAt };
  }

  const sourceWallTime = formatDateTimeInputInTimeZone(
    input.startAt,
    input.timezone
  ).slice(10);
  const startAt = parseDateTimeInputInTimeZone(
    `${targetDateKey}${sourceWallTime}`,
    input.timezone
  );
  if (!startAt) {
    throw new Error("Unable to move the calendar item.");
  }
  return {
    startAt,
    endAt: new Date(
      Date.parse(startAt) + sourceEnd.getTime() - sourceStart.getTime()
    ).toISOString()
  };
}

export function calendarEventOverlapsDate(
  event: {
    startAt: string;
    endAt: string;
    timezone: string;
    isAllDay?: boolean;
  },
  dateKey: string
) {
  const startKey = localDateKeyInTimeZone(event.startAt, event.timezone);
  const endKey = localDateKeyInTimeZone(event.endAt, event.timezone);
  if (!startKey || !endKey || dateKey < startKey || dateKey > endKey) {
    return false;
  }
  if (event.isAllDay && endKey > startKey) {
    return dateKey < endKey;
  }
  if (
    endKey > startKey &&
    dateKey === endKey &&
    formatTimeInTimeZone(event.endAt, event.timezone) === "00:00"
  ) {
    return false;
  }
  return true;
}

export function calendarEventTimeLabelForDate(
  event: {
    startAt: string;
    endAt: string;
    timezone: string;
    isAllDay?: boolean;
  },
  dateKey: string
) {
  if (event.isAllDay) {
    return "All day";
  }
  const startKey = localDateKeyInTimeZone(event.startAt, event.timezone);
  const endKey = localDateKeyInTimeZone(event.endAt, event.timezone);
  const startTime = formatTimeInTimeZone(event.startAt, event.timezone);
  const endTime = formatTimeInTimeZone(event.endAt, event.timezone);
  if (startKey === endKey) {
    return `${startTime} - ${endTime}`;
  }
  if (dateKey === startKey) {
    return `${startTime} onward`;
  }
  if (dateKey === endKey) {
    return `Until ${endTime}`;
  }
  return "Continues";
}

export function buildWeekDays(weekStart: Date) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function formatWeekday(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(timeZone ? { timeZone } : {})
  }).format(date);
}

export function minutesToLabel(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatHourLabel(hour: number) {
  return `${hour.toString().padStart(2, "0")}:00`;
}
