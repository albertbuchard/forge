import type {
  ActionProfile,
  CalendarEvent,
  Habit,
  MovementTripRecord,
  Note,
  TaskTimebox,
  WorkBlockInstance
} from "@/lib/types";

type CalendarActivityPresetKey =
  | "deep_work"
  | "admin"
  | "maintenance"
  | "meeting"
  | "recovery_break"
  | "holiday_leisure"
  | "light_context"
  | "task_inherited";

type CalendarActivityPresetOption = {
  key: CalendarActivityPresetKey;
  label: string;
  description: string;
  defaultRateApPerHour: number;
};

const CALENDAR_ACTIVITY_PRESET_OPTIONS: CalendarActivityPresetOption[] = [
  {
    key: "deep_work",
    label: "Deep work",
    description: "High-focus work, coding, writing, studying, or mentally demanding work.",
    defaultRateApPerHour: 14
  },
  {
    key: "admin",
    label: "Admin",
    description: "Email, coordination, planning, logistics, and fragmented office work.",
    defaultRateApPerHour: 9
  },
  {
    key: "maintenance",
    label: "Maintenance",
    description: "Light chores, errands, upkeep, and low-friction background work.",
    defaultRateApPerHour: 6
  },
  {
    key: "meeting",
    label: "Meeting",
    description: "Busy social or collaborative commitments with real cognitive and social load.",
    defaultRateApPerHour: 13
  },
  {
    key: "recovery_break",
    label: "Rest",
    description: "Lunch, recovery, and decompression are still activities, just lighter ones.",
    defaultRateApPerHour: 3
  },
  {
    key: "holiday_leisure",
    label: "Holiday",
    description: "Leisure, outings, or all-day holiday context that still consumes throughput.",
    defaultRateApPerHour: 4
  },
  {
    key: "light_context",
    label: "Light context",
    description: "Visible low-friction context that still occupies a little capacity.",
    defaultRateApPerHour: 2
  },
  {
    key: "task_inherited",
    label: "Task default",
    description: "Use the task's own Action Point profile for this timebox.",
    defaultRateApPerHour: 100 / 24
  }
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function durationSeconds(startAt: string, endAt: string) {
  return Math.max(0, Math.floor((Date.parse(endAt) - Date.parse(startAt)) / 1000));
}

function roundLoad(rateApPerHour: number, seconds: number) {
  const totalAp = (seconds / 3600) * rateApPerHour;
  return {
    rateApPerHour: Number(rateApPerHour.toFixed(2)),
    totalAp: Number(totalAp.toFixed(2))
  };
}

function getActionProfileRate(profile?: ActionProfile | null) {
  return profile?.sustainRateApPerHour ?? null;
}

function getActivityPresetFallbackRate(key: CalendarActivityPresetKey | null | undefined) {
  return (
    CALENDAR_ACTIVITY_PRESET_OPTIONS.find((preset) => preset.key === key)
      ?.defaultRateApPerHour ?? null
  );
}

function getStoredPresetKey(profile?: ActionProfile | null) {
  return typeof profile?.metadata?.activityPresetKey === "string"
    ? (profile.metadata.activityPresetKey as CalendarActivityPresetKey)
    : null;
}

function getStoredCustomRate(profile?: ActionProfile | null) {
  return typeof profile?.metadata?.customSustainRateApPerHour === "number"
    ? profile.metadata.customSustainRateApPerHour
    : null;
}

export function getCalendarActivityPresetOptions() {
  return CALENDAR_ACTIVITY_PRESET_OPTIONS;
}

export function getCalendarActivityPresetKey(profile?: ActionProfile | null) {
  return getStoredPresetKey(profile);
}

export function getCalendarActivityCustomRate(profile?: ActionProfile | null) {
  return getStoredCustomRate(profile);
}

function formatSafeMetric(
  value: number | null | undefined,
  suffix: "AP" | "AP/h"
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `0 ${suffix}`;
  }
  return `${Number(value.toFixed(1))} ${suffix}`;
}

export function formatLifeForceAp(value: number | null | undefined) {
  return formatSafeMetric(value, "AP");
}

export function formatLifeForceRate(value: number | null | undefined) {
  return formatSafeMetric(value, "AP/h");
}

export function estimateTaskTimeboxActionPointLoad(
  timebox: Pick<TaskTimebox, "startsAt" | "endsAt"> & {
    actionProfile?: ActionProfile | null;
  }
) {
  const rateApPerHour =
    getActionProfileRate(timebox.actionProfile) ?? 100 / 24;
  return roundLoad(rateApPerHour, durationSeconds(timebox.startsAt, timebox.endsAt));
}

function defaultWorkBlockRate(kind: WorkBlockInstance["kind"]) {
  if (kind === "main_activity") {
    return 14;
  }
  if (kind === "secondary_activity") {
    return 9;
  }
  if (kind === "third_activity" || kind === "custom") {
    return 6;
  }
  if (kind === "holiday") {
    return 4;
  }
  return 3;
}

export function estimateWorkBlockActionPointLoad(
  block: Pick<WorkBlockInstance, "kind" | "startAt" | "endAt"> & {
    actionProfile?: ActionProfile | null;
  }
) {
  const rateApPerHour =
    getActionProfileRate(block.actionProfile) ?? defaultWorkBlockRate(block.kind);
  return roundLoad(rateApPerHour, durationSeconds(block.startAt, block.endAt));
}

export function estimateWorkBlockTemplateActionPointLoad(input: {
  kind: WorkBlockInstance["kind"];
  startMinute: number;
  endMinute: number;
  activityPresetKey?: CalendarActivityPresetKey | null;
  customSustainRateApPerHour?: number | null;
}) {
  const referenceDay = "2026-01-01T00:00:00.000Z";
  const start = new Date(referenceDay);
  start.setUTCMinutes(input.startMinute, 0, 0);
  const end = new Date(referenceDay);
  end.setUTCMinutes(input.endMinute, 0, 0);
  if (end <= start) {
    end.setUTCDate(end.getUTCDate() + 1);
  }
  const fallbackRate =
    input.customSustainRateApPerHour ??
    getActivityPresetFallbackRate(input.activityPresetKey) ??
    defaultWorkBlockRate(input.kind);
  return roundLoad(fallbackRate, durationSeconds(start.toISOString(), end.toISOString()));
}

function defaultCalendarEventRate(
  event: Pick<CalendarEvent, "title" | "availability"> & { eventType?: string | null }
) {
  const title = `${event.title} ${event.eventType ?? ""}`.toLowerCase();
  if (title.includes("lunch") || title.includes("break") || title.includes("rest")) {
    return 3;
  }
  if (title.includes("holiday") || title.includes("vacation")) {
    return 4;
  }
  if (title.includes("meeting") || title.includes("call") || title.includes("interview")) {
    return 13;
  }
  if (title.includes("deep work") || title.includes("focus")) {
    return 14;
  }
  if (title.includes("admin") || title.includes("email") || title.includes("inbox")) {
    return 9;
  }
  return event.availability === "busy" ? 12 : 2;
}

export function estimateCalendarEventActionPointLoad(
  event: Pick<CalendarEvent, "title" | "availability" | "startAt" | "endAt"> & {
    eventType?: string | null;
    actionProfile?: ActionProfile | null;
    activityPresetKey?: CalendarActivityPresetKey | null;
    customSustainRateApPerHour?: number | null;
  }
) {
  const rateApPerHour =
    event.customSustainRateApPerHour ??
    getActionProfileRate(event.actionProfile) ??
    getActivityPresetFallbackRate(event.activityPresetKey ?? getStoredPresetKey(event.actionProfile)) ??
    defaultCalendarEventRate(event);
  return roundLoad(rateApPerHour, durationSeconds(event.startAt, event.endAt));
}

export function estimateMovementTripActionPointLoad(
  trip: Pick<MovementTripRecord, "startedAt" | "endedAt" | "expectedMet">
) {
  const rateApPerHour = clamp((trip.expectedMet ?? 2) * 4, 4, 22);
  return roundLoad(rateApPerHour, durationSeconds(trip.startedAt, trip.endedAt));
}

export function estimateHabitCheckInActionPointLoad(
  _habit: Pick<Habit, "polarity">
) {
  return {
    totalAp: 3,
    rateApPerHour: 0
  };
}

export function estimateHabitGeneratedWorkoutActionPointLoad(
  habit: Pick<Habit, "generatedHealthEventTemplate">
) {
  if (!habit.generatedHealthEventTemplate.enabled) {
    return null;
  }
  const durationMinutes = clamp(
    habit.generatedHealthEventTemplate.durationMinutes || 0,
    0,
    24 * 60
  );
  if (durationMinutes <= 0) {
    return null;
  }
  return roundLoad(24, durationMinutes * 60);
}

export function estimateQuickNoteActionPointLoad(
  _note?: Pick<Note, "createdAt"> | null
) {
  return {
    totalAp: 1,
    rateApPerHour: 0
  };
}
