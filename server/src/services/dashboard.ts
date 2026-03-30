import { listGoals } from "../repositories/goals.js";
import { listActivityEvents } from "../repositories/activity-events.js";
import { listHabits } from "../repositories/habits.js";
import { buildNotesSummaryByEntity } from "../repositories/notes.js";
import { listTagsByIds, listTags } from "../repositories/tags.js";
import { listTasks } from "../repositories/tasks.js";
import { buildAchievementSignals, buildGamificationProfile, buildMilestoneRewards } from "./gamification.js";
import { listProjectSummaries } from "./projects.js";
import {
  dashboardExecutionBucketSchema,
  dashboardPayloadSchema,
  dashboardStatsSchema,
  type DashboardExecutionBucket,
  type DashboardGoal,
  type DashboardPayload,
  type Task
} from "../types.js";

function startOfWeek(date: Date): Date {
  const clone = new Date(date);
  const day = clone.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  clone.setDate(clone.getDate() + delta);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

function dateOnlyIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const clone = new Date(date);
  clone.setDate(clone.getDate() + days);
  return clone;
}

function priorityWeight(task: Task): number {
  switch (task.priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function dueDateWeight(task: Task): number {
  return task.dueDate ? Date.parse(`${task.dueDate}T00:00:00.000Z`) : Number.POSITIVE_INFINITY;
}

function takeExecutionSlice(tasks: Task[], limit = 4): Task[] {
  return tasks.slice(0, limit);
}

function buildExecutionBuckets(tasks: Task[], todayIso: string, weekEndIso: string): DashboardExecutionBucket[] {
  const activeTasks = tasks.filter((task) => task.status !== "done");
  const overdue = activeTasks.filter((task) => task.dueDate !== null && task.dueDate < todayIso).sort((left, right) => {
    const dueDelta = dueDateWeight(left) - dueDateWeight(right);
    if (dueDelta !== 0) {
      return dueDelta;
    }
    return priorityWeight(right) - priorityWeight(left);
  });
  const dueSoon = activeTasks
    .filter((task) => task.dueDate !== null && task.dueDate >= todayIso && task.dueDate <= weekEndIso)
    .sort((left, right) => {
      const dueDelta = dueDateWeight(left) - dueDateWeight(right);
      if (dueDelta !== 0) {
        return dueDelta;
      }
      return priorityWeight(right) - priorityWeight(left);
    });
  const focusNow = activeTasks
    .filter((task) => task.status === "focus" || task.status === "in_progress")
    .sort((left, right) => {
      const priorityDelta = priorityWeight(right) - priorityWeight(left);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return dueDateWeight(left) - dueDateWeight(right);
    });
  const recentlyCompleted = tasks
    .filter((task) => task.status === "done" && task.completedAt !== null)
    .sort((left, right) => Date.parse(right.completedAt ?? "") - Date.parse(left.completedAt ?? ""))
    .slice(0, 4);

  return [
    {
      id: "overdue",
      label: "Overdue pressure",
      summary: overdue.length > 0 ? "Clear the oldest slips before they poison momentum." : "Nothing overdue right now.",
      tone: "urgent",
      tasks: takeExecutionSlice(overdue)
    },
    {
      id: "due_soon",
      label: "Due this week",
      summary: dueSoon.length > 0 ? "Short-horizon commitments that need protection now." : "The next seven days look open.",
      tone: "accent",
      tasks: takeExecutionSlice(dueSoon)
    },
    {
      id: "focus_now",
      label: "Focus now",
      summary: focusNow.length > 0 ? "Highest-signal work already in motion." : "No focus lane selected yet.",
      tone: "neutral",
      tasks: takeExecutionSlice(focusNow)
    },
    {
      id: "recently_completed",
      label: "Recent wins",
      summary: recentlyCompleted.length > 0 ? "Completed work that is still feeding momentum." : "No completed work yet.",
      tone: "success",
      tasks: recentlyCompleted
    }
  ].map((bucket) => dashboardExecutionBucketSchema.parse(bucket));
}

function buildGoalSummary(tasks: Task[], goalId: string): Pick<DashboardGoal, "progress" | "totalTasks" | "completedTasks" | "earnedPoints" | "momentumLabel"> {
  const relatedTasks = tasks.filter((task) => task.goalId === goalId);
  const totalTasks = relatedTasks.length;
  const completedTasks = relatedTasks.filter((task) => task.status === "done").length;
  const earnedPoints = relatedTasks
    .filter((task) => task.status === "done")
    .reduce((sum, task) => sum + task.points, 0);
  const progress = totalTasks === 0 ? 0 : Math.min(100, Math.round((completedTasks / totalTasks) * 100));
  const momentumLabel =
    completedTasks === 0 ? "Needs ignition" : completedTasks >= Math.ceil(totalTasks / 2) ? "Strong momentum" : "Building pace";
  return { progress, totalTasks, completedTasks, earnedPoints, momentumLabel };
}

export function getDashboard(): DashboardPayload {
  const goals = listGoals();
  const tasks = listTasks();
  const habits = listHabits();
  const tags = listTags();
  const now = new Date();
  const weekStart = startOfWeek(now).toISOString();
  const todayIso = dateOnlyIso(now);
  const weekEndIso = dateOnlyIso(addDays(now, 7));
  const completedThisWeek = tasks.filter(
    (task) => task.completedAt !== null && task.completedAt >= weekStart
  ).length;
  const totalPoints = tasks
    .filter((task) => task.status === "done")
    .reduce((sum, task) => sum + task.points, 0);
  const focusTasks = tasks.filter((task) => task.status === "focus" || task.status === "in_progress").length;
  const alignedCompletedTasks = tasks.filter(
    (task) => task.status === "done" && task.goalId !== null && task.tagIds.length > 0
  ).length;
  const overdueTasks = tasks.filter((task) => task.status !== "done" && task.dueDate !== null && task.dueDate < todayIso).length;
  const dueThisWeek = tasks.filter(
    (task) => task.status !== "done" && task.dueDate !== null && task.dueDate >= todayIso && task.dueDate <= weekEndIso
  ).length;
  const stats = dashboardStatsSchema.parse({
    totalPoints,
    completedThisWeek,
    activeGoals: goals.filter((goal) => goal.status === "active").length,
    alignmentScore: Math.min(100, alignedCompletedTasks * 14 + focusTasks * 6),
    focusTasks,
    overdueTasks,
    dueThisWeek
  });

  const goalCards = goals.map((goal) => {
    const summary = buildGoalSummary(tasks, goal.id);
    return {
      ...goal,
      ...summary,
      tags: listTagsByIds(goal.tagIds)
    };
  });
  const projects = listProjectSummaries();

  const suggestedTags = tags.filter((tag) => ["value", "execution"].includes(tag.kind)).slice(0, 6);
  const owners = [...new Set(tasks.map((task) => task.owner).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
  const executionBuckets = buildExecutionBuckets(tasks, todayIso, weekEndIso);
  const gamification = buildGamificationProfile(goals, tasks, habits, now);
  const achievements = buildAchievementSignals(goals, tasks, habits, now);
  const milestoneRewards = buildMilestoneRewards(goals, tasks, habits, now);
  const recentActivity = listActivityEvents({ limit: 12 });
  const notesSummaryByEntity = buildNotesSummaryByEntity();
  return dashboardPayloadSchema.parse({
    stats,
    goals: goalCards,
    projects,
    tasks,
    habits,
    tags,
    suggestedTags,
    owners,
    executionBuckets,
    gamification,
    achievements,
    milestoneRewards,
    recentActivity,
    notesSummaryByEntity
  });
}
