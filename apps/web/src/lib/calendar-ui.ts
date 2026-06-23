import type { WorkBlockKind } from "@/lib/types";

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

export function buildWeekDays(weekStart: Date) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function formatWeekday(date: Date) {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric"
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
