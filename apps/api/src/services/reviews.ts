import { listActivityEvents } from "../repositories/activity-events.js";
import { listGoals } from "../repositories/goals.js";
import { listHabits } from "../repositories/habits.js";
import { listTasks } from "../repositories/tasks.js";
import { getWeeklyReviewClosure } from "../repositories/weekly-reviews.js";
import { buildGamificationProfile } from "./gamification.js";
import {
  weeklyReviewPayloadSchema,
  type Task,
  type WeeklyReviewPayload
} from "../types.js";

function resolveTimeZone(timeZone?: string): string {
  const candidate = timeZone?.trim();
  if (!candidate) {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return "UTC";
  }
}

function toTimeZoneDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function toTimeZoneDateStartIso(dateKey: string, timeZone: string): string {
  const target = new Date(`${dateKey}T00:00:00.000Z`).getTime();
  let candidate = target;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .map((part) => [part.type, part.value])
    );
    const observedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const adjustment = target - observedAsUtc;
    candidate += adjustment;
    if (adjustment === 0) {
      break;
    }
  }

  const result = new Date(candidate);
  if (toTimeZoneDateKey(result, timeZone) !== dateKey) {
    throw new Error(`Unable to resolve ${dateKey} in ${timeZone}`);
  }
  return result.toISOString();
}

function addDateKeyDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDateKey(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function formatRange(startDateKey: string, endDateKey: string) {
  return `${formatDateKey(startDateKey)} - ${formatDateKey(endDateKey)}`;
}

export function getWeeklyReviewDateRange(now: Date, timeZone?: string) {
  const resolvedTimeZone = resolveTimeZone(timeZone);
  const localDateKey = toTimeZoneDateKey(now, resolvedTimeZone);
  const localDay = new Date(`${localDateKey}T12:00:00.000Z`).getUTCDay();
  const daysSinceMonday = localDay === 0 ? 6 : localDay - 1;
  const weekStartDate = addDateKeyDays(localDateKey, -daysSinceMonday);
  return {
    timeZone: resolvedTimeZone,
    weekStartDate,
    weekEndDate: addDateKeyDays(weekStartDate, 6)
  };
}

function dailyBuckets(tasks: Task[], startDateKey: string, timeZone: string) {
  const labels = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  return Array.from({ length: 7 }, (_, index) => {
    const dayIso = addDateKeyDays(startDateKey, index);
    const completed = tasks.filter(
      (task) =>
        task.completedAt !== null &&
        toTimeZoneDateKey(new Date(task.completedAt), timeZone) === dayIso
    );
    const totalXp = completed.reduce((sum, task) => sum + task.points, 0);
    return {
      label: labels[index]!,
      xp: totalXp,
      focusHours:
        completed.length * 2 +
        completed.filter((task) => task.effort !== "light").length
    };
  });
}

export function getWeeklyReviewPayload(
  now = new Date(),
  timeZone?: string
): WeeklyReviewPayload {
  const goals = listGoals();
  const tasks = listTasks();
  const gamification = buildGamificationProfile(
    goals,
    tasks,
    listHabits(),
    now
  );
  const range = getWeeklyReviewDateRange(now, timeZone);
  const weekKey = range.weekStartDate;
  const closure = getWeeklyReviewClosure(weekKey);
  const completedTasks = tasks.filter((task) => {
    if (task.completedAt === null) {
      return false;
    }
    const completedDateKey = toTimeZoneDateKey(
      new Date(task.completedAt),
      range.timeZone
    );
    return (
      completedDateKey >= range.weekStartDate &&
      completedDateKey <= range.weekEndDate
    );
  });
  const buckets = dailyBuckets(tasks, range.weekStartDate, range.timeZone);
  const totalXp = completedTasks.reduce((sum, task) => sum + task.points, 0);
  const peakBucket =
    [...buckets].sort((left, right) => right.xp - left.xp)[0] ?? buckets[0]!;
  const activity = listActivityEvents({
    from: toTimeZoneDateStartIso(range.weekStartDate, range.timeZone),
    to: toTimeZoneDateStartIso(
      addDateKeyDays(range.weekEndDate, 1),
      range.timeZone
    ),
    limit: 4
  });
  const wins =
    activity.length > 0
      ? activity.map((event) => ({
          id: event.id,
          title: event.title,
          summary: event.description || "Structured proof of movement.",
          rewardXp:
            typeof event.metadata.points === "number"
              ? event.metadata.points
              : 40
        }))
      : completedTasks.slice(0, 3).map((task) => ({
          id: task.id,
          title: task.title,
          summary:
            task.description || "Completed work converted into evidence.",
          rewardXp: task.points
        }));

  return weeklyReviewPayloadSchema.parse({
    generatedAt: now.toISOString(),
    windowLabel: formatRange(range.weekStartDate, range.weekEndDate),
    weekKey,
    weekStartDate: range.weekStartDate,
    weekEndDate: range.weekEndDate,
    momentumSummary: {
      totalXp,
      focusHours: buckets.reduce((sum, bucket) => sum + bucket.focusHours, 0),
      efficiencyScore: Math.min(
        100,
        gamification.momentumScore + completedTasks.length * 3
      ),
      peakWindow: peakBucket.label
    },
    chart: buckets,
    wins,
    calibration: goals.slice(0, 3).map((goal, index) => ({
      id: goal.id,
      title: goal.title,
      mode: index === 0 ? "accelerate" : index === 1 ? "maintain" : "recover",
      note:
        index === 0
          ? "This arc has enough evidence to push harder next cycle."
          : index === 1
            ? "Keep the current load and prevent drift."
            : "Reduce friction and re-sequence the next steps."
    })),
    reward: {
      title: "Review Completion Bonus",
      summary: "Finalizing the review locks the current cycle into evidence.",
      rewardXp: 250
    },
    completion: {
      finalized: closure !== null,
      finalizedAt: closure?.createdAt ?? null,
      finalizedBy: closure?.actor ?? null
    }
  });
}
