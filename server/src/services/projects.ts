import { listActivityEvents } from "../repositories/activity-events.js";
import { getGoalById, listGoals } from "../repositories/goals.js";
import { getProjectById, listProjects } from "../repositories/projects.js";
import { listTasks } from "../repositories/tasks.js";
import { emptyTaskTimeSummary } from "./work-time.js";
import { projectBoardPayloadSchema, projectSummarySchema, type ProjectBoardPayload, type ProjectListQuery, type ProjectSummary, type Task, type TaskTimeSummary } from "../types.js";

function projectTaskSummary(tasks: Task[]) {
  const completedTasks = tasks.filter((task) => task.status === "done");
  const activeTasks = tasks.filter((task) => task.status !== "done");
  const totalTasks = tasks.length;
  const earnedPoints = completedTasks.reduce((sum, task) => sum + task.points, 0);
  const progress = totalTasks === 0 ? 0 : Math.min(100, Math.round((completedTasks.length / totalTasks) * 100));
  const nextTask =
    activeTasks.find((task) => task.status === "focus" || task.status === "in_progress") ??
    activeTasks.find((task) => task.status === "backlog") ??
    activeTasks[0] ??
    null;
  const momentumLabel =
    completedTasks.length === 0
      ? activeTasks.length > 0
        ? "Building momentum"
        : "Waiting for the first task"
      : activeTasks.some((task) => task.status === "blocked")
        ? "Needs intervention"
        : progress >= 70
          ? "Closing strong"
          : "Making steady progress";

  return {
    activeTaskCount: activeTasks.length,
    completedTaskCount: completedTasks.length,
    totalTasks,
    earnedPoints,
    progress,
    nextTaskId: nextTask?.id ?? null,
    nextTaskTitle: nextTask?.title ?? null,
    momentumLabel,
    time: tasks.reduce<TaskTimeSummary>(
      (summary, task) => ({
        totalTrackedSeconds: summary.totalTrackedSeconds + task.time.totalTrackedSeconds,
        totalCreditedSeconds: Math.round((summary.totalCreditedSeconds + task.time.totalCreditedSeconds) * 100) / 100,
        activeRunCount: summary.activeRunCount + task.time.activeRunCount,
        hasCurrentRun: summary.hasCurrentRun || task.time.hasCurrentRun,
        currentRunId: summary.currentRunId ?? task.time.currentRunId
      }),
      emptyTaskTimeSummary()
    )
  };
}

export function listProjectSummaries(filters: ProjectListQuery = {}): ProjectSummary[] {
  const goals = new Map(listGoals().map((goal) => [goal.id, goal]));
  const tasks = listTasks();

  return listProjects(filters).map((project) => {
    const goal = goals.get(project.goalId);
    const projectTasks = tasks.filter((task) => task.projectId === project.id);
    return projectSummarySchema.parse({
      ...project,
      goalTitle: goal?.title ?? "Unknown life goal",
      ...projectTaskSummary(projectTasks)
    });
  });
}

export function getProjectSummary(projectId: string): ProjectSummary | undefined {
  return listProjectSummaries().find((project) => project.id === projectId);
}

export function getProjectBoard(projectId: string): ProjectBoardPayload | undefined {
  const project = getProjectSummary(projectId);
  if (!project) {
    return undefined;
  }
  const goal = getGoalById(project.goalId);
  if (!goal) {
    return undefined;
  }

  return projectBoardPayloadSchema.parse({
    project,
    goal,
    tasks: listTasks({ projectId }),
    activity: listActivityEvents({ entityType: "project", entityId: projectId, limit: 20 }).concat(
      listActivityEvents({ entityType: "task", limit: 100 }).filter((event) =>
        listTasks({ projectId }).some((task) => task.id === event.entityId)
      ).slice(0, 20)
    )
  });
}
