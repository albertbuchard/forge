import { listActivityEvents } from "../repositories/activity-events.js";
import { listGoals } from "../repositories/goals.js";
import { listTasks } from "../repositories/tasks.js";
import { buildGamificationProfile } from "./gamification.js";
import { weeklyReviewPayloadSchema } from "../types.js";
function startOfWeek(date) {
    const clone = new Date(date);
    const day = clone.getDay();
    const delta = day === 0 ? -6 : 1 - day;
    clone.setDate(clone.getDate() + delta);
    clone.setHours(0, 0, 0, 0);
    return clone;
}
function addDays(date, days) {
    const clone = new Date(date);
    clone.setDate(clone.getDate() + days);
    return clone;
}
function formatRange(start, end) {
    return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
function dailyBuckets(tasks, start) {
    return Array.from({ length: 7 }, (_, index) => {
        const current = addDays(start, index);
        const dayLabel = current.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
        const dayIso = current.toISOString().slice(0, 10);
        const completed = tasks.filter((task) => task.completedAt?.slice(0, 10) === dayIso);
        const totalXp = completed.reduce((sum, task) => sum + task.points, 0);
        return {
            label: dayLabel,
            xp: totalXp,
            focusHours: completed.length * 2 + completed.filter((task) => task.effort !== "light").length
        };
    });
}
export function getWeeklyReviewPayload(now = new Date()) {
    const goals = listGoals();
    const tasks = listTasks();
    const gamification = buildGamificationProfile(goals, tasks, now);
    const weekStart = startOfWeek(now);
    const weekEnd = addDays(weekStart, 6);
    const weekTasks = tasks.filter((task) => task.updatedAt >= weekStart.toISOString() && task.updatedAt <= addDays(weekEnd, 1).toISOString());
    const completedTasks = weekTasks.filter((task) => task.completedAt !== null);
    const buckets = dailyBuckets(tasks, weekStart);
    const totalXp = completedTasks.reduce((sum, task) => sum + task.points, 0);
    const peakBucket = [...buckets].sort((left, right) => right.xp - left.xp)[0] ?? buckets[0];
    const activity = listActivityEvents({ limit: 20 }).slice(0, 4);
    const wins = activity.length > 0
        ? activity.map((event) => ({
            id: event.id,
            title: event.title,
            summary: event.description || "Structured proof of movement.",
            rewardXp: typeof event.metadata.points === "number" ? event.metadata.points : 40
        }))
        : completedTasks.slice(0, 3).map((task) => ({
            id: task.id,
            title: task.title,
            summary: task.description || "Completed work converted into evidence.",
            rewardXp: task.points
        }));
    return weeklyReviewPayloadSchema.parse({
        generatedAt: now.toISOString(),
        windowLabel: formatRange(weekStart, weekEnd),
        momentumSummary: {
            totalXp,
            focusHours: buckets.reduce((sum, bucket) => sum + bucket.focusHours, 0),
            efficiencyScore: Math.min(100, gamification.momentumScore + completedTasks.length * 3),
            peakWindow: peakBucket.label
        },
        chart: buckets,
        wins,
        calibration: goals.slice(0, 3).map((goal, index) => ({
            id: goal.id,
            title: goal.title,
            mode: index === 0 ? "accelerate" : index === 1 ? "maintain" : "recover",
            note: index === 0
                ? "This arc has enough evidence to push harder next cycle."
                : index === 1
                    ? "Keep the current load and prevent drift."
                    : "Reduce friction and re-sequence the next steps."
        })),
        reward: {
            title: "Review Completion Bonus",
            summary: "Finalizing the review locks the current cycle into evidence.",
            rewardXp: 250
        }
    });
}
