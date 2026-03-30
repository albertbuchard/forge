import { listActivityEvents } from "../repositories/activity-events.js";
import { listInsights } from "../repositories/collaboration.js";
import { listGoals } from "../repositories/goals.js";
import { listHabits } from "../repositories/habits.js";
import { listTasks } from "../repositories/tasks.js";
import { getOverviewContext } from "./context.js";
import { buildGamificationProfile } from "./gamification.js";
import { insightsPayloadSchema, type InsightsHeatmapCell, type InsightsPayload, type Task } from "../types.js";

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const clone = new Date(date);
  clone.setDate(clone.getDate() + days);
  return clone;
}

function buildHeatmap(tasks: Task[], now: Date): InsightsHeatmapCell[] {
  const cells: InsightsHeatmapCell[] = [];
  for (let index = 29; index >= 0; index -= 1) {
    const current = addDays(now, -index);
    const currentKey = dayKey(current);
    const completed = tasks.filter((task) => task.completedAt?.slice(0, 10) === currentKey).length;
    const focus = tasks.filter((task) => task.updatedAt.slice(0, 10) === currentKey && (task.status === "focus" || task.status === "in_progress")).length;
    cells.push({
      id: currentKey,
      label: current.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      completed,
      focus,
      intensity: Math.min(4, completed + focus)
    });
  }
  return cells;
}

export function getInsightsPayload(now = new Date()): InsightsPayload {
  const goals = listGoals();
  const tasks = listTasks();
  const gamification = buildGamificationProfile(goals, tasks, listHabits(), now);
  const overview = getOverviewContext(now);
  const activity = listActivityEvents({ limit: 60 });
  const trends = Array.from({ length: 6 }, (_, offset) => {
    const bucketStart = addDays(now, -(5 - offset) * 5);
    const bucketEnd = addDays(bucketStart, 4);
    const completedTasks = tasks.filter((task) => {
      const completedAt = task.completedAt;
      return completedAt !== null && completedAt >= bucketStart.toISOString() && completedAt <= bucketEnd.toISOString();
    });
    const updatedTasks = tasks.filter((task) => task.updatedAt >= bucketStart.toISOString() && task.updatedAt <= bucketEnd.toISOString());
    return {
      label: bucketStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      xp: completedTasks.reduce((sum, task) => sum + task.points, 0),
      focusScore: Math.min(100, updatedTasks.length * 12 + completedTasks.length * 20)
    };
  });

  const domainBalance = overview.domainBalance.map((domain) => ({
    label: domain.label,
    value: Math.min(100, domain.completedPoints + domain.activeTaskCount * 8),
    color: domain.color,
    note: domain.momentumLabel
  }));

  const hottestGoal = overview.activeGoals[0] ?? null;
  const blockedTasks = tasks.filter((task) => task.status === "blocked").length;
  const overdueTasks = tasks.filter((task) => task.status !== "done" && task.dueDate !== null && task.dueDate < dayKey(now)).length;
  const feed = listInsights({ limit: 8 });

  return insightsPayloadSchema.parse({
    generatedAt: now.toISOString(),
    status: {
      systemStatus: gamification.momentumScore >= 80 ? "Optimal Flow" : gamification.momentumScore >= 60 ? "Stable Build" : "Needs Recovery",
      streakDays: gamification.streakDays,
      momentumScore: gamification.momentumScore
    },
    momentumHeatmap: buildHeatmap(tasks, now),
    executionTrends: trends,
    domainBalance,
    coaching: {
      title: hottestGoal ? `Protect progress on ${hottestGoal.title}` : "Rebuild momentum",
      summary:
        blockedTasks > 0
          ? `${blockedTasks} blocked task${blockedTasks === 1 ? "" : "s"} are slowing active work across Forge right now.`
          : overdueTasks > 0
            ? `${overdueTasks} overdue task${overdueTasks === 1 ? "" : "s"} are creating the biggest execution drag right now.`
            : "Recent evidence shows enough movement to push the next arc more aggressively.",
      recommendation:
        blockedTasks > 0
          ? "Clear one blocked task before adding more new work so the active lane can move again."
          : hottestGoal
            ? `Create or schedule the next concrete move under ${hottestGoal.title}, then protect one deep-work lane to carry it forward this week.`
            : "Pick one life goal, one project, and one task to stabilize the next 24 hours.",
      ctaLabel: "Trigger coaching insight"
    },
    evidenceDigest: activity.slice(0, 5),
    feed,
    openCount: feed.filter((insight) => insight.status === "open").length
  });
}
