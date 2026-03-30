import { listActivityEvents } from "../repositories/activity-events.js";
import { listGoals } from "../repositories/goals.js";
import { listHabits } from "../repositories/habits.js";
import { listRewardLedger } from "../repositories/rewards.js";
import { listTags, listTagsByIds } from "../repositories/tags.js";
import { listTasks } from "../repositories/tasks.js";
import { getDashboard } from "./dashboard.js";
import { buildAchievementSignals, buildGamificationProfile, buildMilestoneRewards } from "./gamification.js";
import { overviewContextSchema, riskContextSchema, todayContextSchema } from "../types.js";
function priorityWeight(task) {
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
function dueWeight(task) {
    return task.dueDate ? Date.parse(`${task.dueDate}T00:00:00.000Z`) : Number.POSITIVE_INFINITY;
}
function taskSignalRank(task) {
    const statusBoost = task.status === "in_progress" ? 30 : task.status === "focus" ? 20 : 0;
    const dueBoost = task.dueDate ? Math.max(0, 20 - Math.floor((dueWeight(task) - Date.now()) / 86_400_000)) : 0;
    return priorityWeight(task) * 20 + statusBoost + dueBoost + task.points;
}
function sortStrategicTasks(tasks) {
    return [...tasks].sort((left, right) => {
        const signalDelta = taskSignalRank(right) - taskSignalRank(left);
        if (signalDelta !== 0) {
            return signalDelta;
        }
        return dueWeight(left) - dueWeight(right);
    });
}
function latestGoalActivity(goal, tasks) {
    const goalTasks = tasks.filter((task) => task.goalId === goal.id);
    const timestamps = goalTasks
        .flatMap((task) => [task.updatedAt, task.completedAt].filter((value) => value !== null))
        .sort((left, right) => Date.parse(right) - Date.parse(left));
    return timestamps[0] ?? null;
}
function buildNeglectedGoals(goals, tasks, now) {
    return goals
        .filter((goal) => goal.status === "active")
        .map((goal) => {
        const relatedTasks = tasks.filter((task) => task.goalId === goal.id);
        const completedCount = relatedTasks.filter((task) => task.status === "done").length;
        const activeCount = relatedTasks.filter((task) => task.status !== "done").length;
        const latestActivity = latestGoalActivity(goal, tasks);
        const ageDays = latestActivity ? Math.floor((now.getTime() - Date.parse(latestActivity)) / 86_400_000) : 999;
        const risk = activeCount === 0 || ageDays >= 7 ? "high" : ageDays >= 4 || completedCount === 0 ? "medium" : "low";
        const summary = activeCount === 0
            ? "No active projects are attached right now."
            : ageDays >= 7
                ? `No meaningful movement in ${ageDays} days.`
                : ageDays >= 4
                    ? `Momentum is cooling after ${ageDays} quiet days.`
                    : "Still receiving enough activity to stay alive.";
        return {
            goalId: goal.id,
            title: goal.title,
            summary,
            risk
        };
    })
        .sort((left, right) => {
        const riskWeight = { high: 3, medium: 2, low: 1 };
        return riskWeight[right.risk] - riskWeight[left.risk];
    })
        .slice(0, 4);
}
function chooseDomainTag(goal, tagsById) {
    const tags = listTagsByIds(goal.tagIds);
    return tags.find((tag) => tag.kind === "value") ?? tags.find((tag) => tag.kind === "category") ?? tagsById.get(goal.tagIds[0] ?? "") ?? null;
}
function buildDomainBalance(goals, tasks) {
    const allTags = listTags();
    const tagsById = new Map(allTags.map((tag) => [tag.id, tag]));
    const domainRows = new Map();
    for (const goal of goals) {
        const domainTag = chooseDomainTag(goal, tagsById);
        if (!domainTag) {
            continue;
        }
        const relatedTasks = tasks.filter((task) => task.goalId === goal.id);
        const activeTaskCount = relatedTasks.filter((task) => task.status !== "done").length;
        const completedPoints = relatedTasks
            .filter((task) => task.status === "done")
            .reduce((sum, task) => sum + task.points, 0);
        const existing = domainRows.get(domainTag.id);
        const nextGoalCount = (existing?.goalCount ?? 0) + 1;
        const nextActiveCount = (existing?.activeTaskCount ?? 0) + activeTaskCount;
        const nextCompletedPoints = (existing?.completedPoints ?? 0) + completedPoints;
        domainRows.set(domainTag.id, {
            tagId: domainTag.id,
            label: domainTag.name,
            color: domainTag.color,
            goalCount: nextGoalCount,
            activeTaskCount: nextActiveCount,
            completedPoints: nextCompletedPoints,
            momentumLabel: nextCompletedPoints >= 120 ? "Hot" : nextActiveCount >= 3 ? "Loaded" : nextCompletedPoints > 0 ? "Alive" : "Cold"
        });
    }
    return [...domainRows.values()].sort((left, right) => right.completedPoints - left.completedPoints);
}
export function getOverviewContext(now = new Date()) {
    const dashboard = getDashboard();
    const focusTasks = dashboard.tasks.filter((task) => task.status === "focus" || task.status === "in_progress").length;
    const overdueTasks = dashboard.tasks.filter((task) => task.status !== "done" && task.dueDate !== null && task.dueDate < now.toISOString().slice(0, 10)).length;
    const dueHabits = dashboard.habits.filter((habit) => habit.dueToday).slice(0, 6);
    return overviewContextSchema.parse({
        generatedAt: now.toISOString(),
        strategicHeader: {
            streakDays: dashboard.gamification.streakDays,
            level: dashboard.gamification.level,
            totalXp: dashboard.gamification.totalXp,
            currentLevelXp: dashboard.gamification.currentLevelXp,
            nextLevelXp: dashboard.gamification.nextLevelXp,
            momentumScore: dashboard.gamification.momentumScore,
            focusTasks,
            overdueTasks
        },
        projects: dashboard.projects.slice(0, 5),
        activeGoals: dashboard.goals.filter((goal) => goal.status === "active").slice(0, 6),
        topTasks: sortStrategicTasks(dashboard.tasks.filter((task) => task.status !== "done")).slice(0, 6),
        dueHabits,
        recentEvidence: listActivityEvents({ limit: 12 }),
        achievements: buildAchievementSignals(listGoals(), listTasks(), listHabits(), now),
        domainBalance: buildDomainBalance(listGoals(), listTasks()),
        neglectedGoals: buildNeglectedGoals(listGoals(), listTasks(), now)
    });
}
export function getTodayContext(now = new Date()) {
    const goals = listGoals();
    const tasks = listTasks();
    const habits = listHabits();
    const gamification = buildGamificationProfile(goals, tasks, habits, now);
    const inProgressTasks = sortStrategicTasks(tasks.filter((task) => task.status === "in_progress")).slice(0, 4);
    const readyTasks = sortStrategicTasks(tasks.filter((task) => task.status === "focus" || task.status === "backlog")).slice(0, 4);
    const deferredTasks = sortStrategicTasks(tasks.filter((task) => task.status === "blocked")).slice(0, 4);
    const dueHabits = habits.filter((habit) => habit.dueToday).slice(0, 6);
    const completedTasks = [...tasks]
        .filter((task) => task.status === "done" && task.completedAt !== null)
        .sort((left, right) => Date.parse(right.completedAt ?? "") - Date.parse(left.completedAt ?? ""))
        .slice(0, 4);
    const directiveTask = inProgressTasks[0] ?? readyTasks[0] ?? null;
    const goalTitle = directiveTask?.goalId ? goals.find((goal) => goal.id === directiveTask.goalId)?.title ?? null : null;
    const overdueCount = tasks.filter((task) => task.status !== "done" && task.dueDate !== null && task.dueDate < now.toISOString().slice(0, 10)).length;
    const completedToday = completedTasks.filter((task) => task.completedAt?.slice(0, 10) === now.toISOString().slice(0, 10)).length;
    return todayContextSchema.parse({
        generatedAt: now.toISOString(),
        directive: {
            task: directiveTask,
            goalTitle,
            rewardXp: directiveTask?.points ?? 0,
            sessionLabel: directiveTask ? `${directiveTask.effort} effort · ${directiveTask.energy} energy` : "No active directive selected"
        },
        timeline: [
            { id: "in_progress", label: "In progress", tasks: inProgressTasks },
            { id: "ready", label: "Ready to start", tasks: readyTasks },
            { id: "blocked", label: "Blocked", tasks: deferredTasks },
            { id: "done", label: "Done", tasks: completedTasks }
        ],
        dailyQuests: [
            {
                id: "quest-major-3",
                title: "Complete 3 meaningful tasks",
                summary: "Push enough mass today that the day feels consequential.",
                rewardXp: 90,
                progressLabel: `${completedToday}/3 complete`,
                completed: completedToday >= 3
            },
            {
                id: "quest-focus-lane",
                title: "Keep one focus lane alive",
                summary: "Protect at least one in-progress or focus task from stalling.",
                rewardXp: 60,
                progressLabel: `${inProgressTasks.length > 0 || readyTasks.length > 0 ? 1 : 0}/1 active tasks`,
                completed: inProgressTasks.length > 0 || readyTasks.length > 0
            },
            {
                id: "quest-recovery",
                title: "Run one recovery action",
                summary: "Touch a neglected or blocked arc before it drifts further.",
                rewardXp: 75,
                progressLabel: `${deferredTasks.length > 0 ? 1 : 0}/1 rescue opportunities found`,
                completed: false
            }
        ],
        dueHabits,
        milestoneRewards: buildMilestoneRewards(goals, tasks, habits, now),
        recentHabitRewards: listRewardLedger({ entityType: "habit", limit: 8 }),
        momentum: {
            streakDays: gamification.streakDays,
            momentumScore: gamification.momentumScore,
            recoveryHint: dueHabits.length > 0
                ? `${dueHabits.length} habit${dueHabits.length === 1 ? "" : "s"} still need a check-in today. Closing one will keep momentum honest.`
                : overdueCount > 0
                    ? `Clear ${overdueCount} overdue task${overdueCount === 1 ? "" : "s"} to keep momentum from decaying.`
                    : "No overdue drag right now. Preserve the rhythm with one decisive completion."
        }
    });
}
export function getRiskContext(now = new Date()) {
    const tasks = listTasks();
    const goals = listGoals();
    const overdueTasks = sortStrategicTasks(tasks.filter((task) => task.status !== "done" && task.dueDate !== null && task.dueDate < now.toISOString().slice(0, 10))).slice(0, 8);
    const blockedTasks = sortStrategicTasks(tasks.filter((task) => task.status === "blocked")).slice(0, 8);
    const neglectedGoals = buildNeglectedGoals(goals, tasks, now);
    const summary = overdueTasks.length === 0 && blockedTasks.length === 0
        ? "No acute risk signals are spiking. The main job is maintaining momentum."
        : `${overdueTasks.length} overdue and ${blockedTasks.length} blocked tasks are the main drag vectors right now.`;
    return riskContextSchema.parse({
        generatedAt: now.toISOString(),
        overdueTasks,
        blockedTasks,
        neglectedGoals,
        summary
    });
}
