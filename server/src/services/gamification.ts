import {
  achievementSignalSchema,
  gamificationOverviewSchema,
  gamificationProfileSchema,
  milestoneRewardSchema,
  type AchievementSignal,
  type GamificationOverview,
  type GamificationProfile,
  type Goal,
  type MilestoneReward,
  type Task,
  type XpMomentumPulse
} from "../types.js";
import { getTotalXp, getWeeklyXp } from "../repositories/rewards.js";

const XP_PER_LEVEL = 120;

function startOfWeek(date: Date): Date {
  const clone = new Date(date);
  const day = clone.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  clone.setDate(clone.getDate() + delta);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

function dayKey(isoDate: string): string {
  return isoDate.slice(0, 10);
}

function calculateStreak(tasks: Task[], now: Date): number {
  const completedDays = new Set(
    tasks
      .flatMap((task) => (task.status === "done" && task.completedAt !== null ? [dayKey(task.completedAt)] : []))
  );

  if (completedDays.size === 0) {
    return 0;
  }

  let streak = 0;
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);

  while (completedDays.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function calculateLevel(totalXp: number): { level: number; currentLevelXp: number; nextLevelXp: number } {
  const level = Math.floor(totalXp / XP_PER_LEVEL) + 1;
  const currentLevelFloor = (level - 1) * XP_PER_LEVEL;
  return {
    level,
    currentLevelXp: totalXp - currentLevelFloor,
    nextLevelXp: XP_PER_LEVEL
  };
}

function latestCompletionForTasks(tasks: Task[]): string | null {
  return tasks
    .flatMap((task) => (task.completedAt ? [task.completedAt] : []))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

export function buildGamificationProfile(goals: Goal[], tasks: Task[], now = new Date()): GamificationProfile {
  const weekStart = startOfWeek(now).toISOString();
  const doneTasks = tasks.filter((task) => task.status === "done");
  const totalXp = getTotalXp();
  const weeklyXp = getWeeklyXp(weekStart);
  const focusTasks = tasks.filter((task) => task.status === "focus" || task.status === "in_progress").length;
  const overdueTasks = tasks.filter(
    (task) => task.status !== "done" && task.dueDate !== null && task.dueDate < now.toISOString().slice(0, 10)
  ).length;
  const alignedDonePoints = doneTasks
    .filter((task) => task.goalId !== null && task.tagIds.length > 0)
    .reduce((sum, task) => sum + task.points, 0);
  const streakDays = calculateStreak(tasks, now);
  const levelState = calculateLevel(totalXp);

  const goalScores = goals
    .map((goal) => ({
      goalId: goal.id,
      goalTitle: goal.title,
      earnedXp: doneTasks.filter((task) => task.goalId === goal.id).reduce((sum, task) => sum + task.points, 0)
    }))
    .sort((left, right) => right.earnedXp - left.earnedXp);
  const topGoal = goalScores.find((goal) => goal.earnedXp > 0) ?? null;

  return gamificationProfileSchema.parse({
    totalXp,
    level: levelState.level,
    currentLevelXp: levelState.currentLevelXp,
    nextLevelXp: levelState.nextLevelXp,
    weeklyXp,
    streakDays,
    comboMultiplier: Number((1 + Math.min(0.75, streakDays * 0.05)).toFixed(2)),
    momentumScore: Math.max(
      0,
      Math.min(100, Math.round(weeklyXp / 6 + alignedDonePoints / 20 + focusTasks * 5 - overdueTasks * 9))
    ),
    topGoalId: topGoal?.goalId ?? null,
    topGoalTitle: topGoal?.goalTitle ?? null
  });
}

export function buildAchievementSignals(goals: Goal[], tasks: Task[], now = new Date()): AchievementSignal[] {
  const profile = buildGamificationProfile(goals, tasks, now);
  const doneTasks = tasks.filter((task) => task.status === "done");
  const alignedDoneTasks = doneTasks.filter((task) => task.goalId !== null && task.tagIds.length > 0);
  const focusTasks = tasks.filter((task) => task.status === "focus" || task.status === "in_progress");
  const highValueGoals = goals.filter((goal) => doneTasks.some((task) => task.goalId === goal.id));

  return [
    {
      id: "streak-operator",
      title: "Streak Operator",
      summary: "Maintain consecutive days of meaningful completions.",
      tier: profile.streakDays >= 7 ? "gold" : "silver",
      progressLabel: `${Math.min(profile.streakDays, 7)}/7 days`,
      unlocked: profile.streakDays >= 7,
      unlockedAt: profile.streakDays >= 7 ? latestCompletionForTasks(doneTasks) : null
    },
    {
      id: "aligned-maker",
      title: "Aligned Maker",
      summary: "Complete work that is explicitly tied to a goal and tagged context.",
      tier: alignedDoneTasks.length >= 5 ? "gold" : "bronze",
      progressLabel: `${Math.min(alignedDoneTasks.length, 5)}/5 aligned completions`,
      unlocked: alignedDoneTasks.length >= 5,
      unlockedAt: alignedDoneTasks.length >= 5 ? latestCompletionForTasks(alignedDoneTasks) : null
    },
    {
      id: "momentum-engine",
      title: "Momentum Engine",
      summary: "Push weekly XP high enough that momentum becomes visible.",
      tier: profile.weeklyXp >= 240 ? "gold" : profile.weeklyXp >= 120 ? "silver" : "bronze",
      progressLabel: `${Math.min(profile.weeklyXp, 240)}/240 weekly xp`,
      unlocked: profile.weeklyXp >= 240,
      unlockedAt: profile.weeklyXp >= 240 ? latestCompletionForTasks(doneTasks) : null
    },
    {
      id: "path-keeper",
      title: "Path Keeper",
      summary: "Keep multiple life arcs alive instead of overfitting one lane.",
      tier: highValueGoals.length >= 3 ? "platinum" : "silver",
      progressLabel: `${Math.min(highValueGoals.length, 3)}/3 active arcs with wins`,
      unlocked: highValueGoals.length >= 3,
      unlockedAt: highValueGoals.length >= 3 ? latestCompletionForTasks(doneTasks) : null
    },
    {
      id: "focus-lane",
      title: "Focus Lane Live",
      summary: "Sustain a protected execution lane instead of browsing a backlog.",
      tier: focusTasks.length > 0 ? "silver" : "bronze",
      progressLabel: `${Math.min(focusTasks.length, 1)}/1 live directives`,
      unlocked: focusTasks.length > 0,
      unlockedAt: focusTasks.length > 0 ? now.toISOString() : null
    }
  ].map((achievement) => achievementSignalSchema.parse(achievement));
}

export function buildMilestoneRewards(goals: Goal[], tasks: Task[], now = new Date()): MilestoneReward[] {
  const profile = buildGamificationProfile(goals, tasks, now);
  const doneTasks = tasks.filter((task) => task.status === "done");
  const topGoal = profile.topGoalId ? goals.find((goal) => goal.id === profile.topGoalId) ?? null : null;
  const topGoalXp = topGoal ? doneTasks.filter((task) => task.goalId === topGoal.id).reduce((sum, task) => sum + task.points, 0) : 0;
  const completedToday = doneTasks.filter((task) => task.completedAt?.slice(0, 10) === now.toISOString().slice(0, 10)).length;

  return [
    {
      id: "next-level",
      title: "Next level threshold",
      summary: "Keep pushing until the next level unlocks a stronger sense of ascent.",
      rewardLabel: `Level ${profile.level + 1}`,
      progressLabel: `${profile.currentLevelXp}/${profile.nextLevelXp} xp`,
      current: profile.currentLevelXp,
      target: profile.nextLevelXp,
      completed: profile.currentLevelXp >= profile.nextLevelXp
    },
    {
      id: "weekly-sprint",
      title: "Weekly sprint heat",
      summary: "Cross the weekly XP line that keeps the system feeling alive.",
      rewardLabel: "Momentum bonus",
      progressLabel: `${Math.min(profile.weeklyXp, 240)}/240 weekly xp`,
      current: profile.weeklyXp,
      target: 240,
      completed: profile.weeklyXp >= 240
    },
    {
      id: "daily-mass",
      title: "Daily mass threshold",
      summary: "Make the day feel consequential with multiple completed tasks.",
      rewardLabel: "Quest chest +90 xp",
      progressLabel: `${Math.min(completedToday, 3)}/3 completions today`,
      current: completedToday,
      target: 3,
      completed: completedToday >= 3
    },
    {
      id: "goal-project",
      title: "Project reward track",
      summary: topGoal ? `Keep advancing the leading life goal through a concrete project path.` : "No leading life goal is established yet.",
      rewardLabel: topGoal ? `${topGoal.title} milestone` : "Establish a lead goal",
      progressLabel: topGoal ? `${Math.min(topGoalXp, topGoal.targetPoints)}/${topGoal.targetPoints} goal xp` : "0/1 lead arcs",
      current: topGoal ? topGoalXp : 0,
      target: topGoal ? topGoal.targetPoints : 1,
      completed: topGoal ? topGoalXp >= topGoal.targetPoints : false
    }
  ].map((reward) => milestoneRewardSchema.parse(reward));
}

export function buildXpMomentumPulse(goals: Goal[], tasks: Task[], now = new Date()): XpMomentumPulse {
  const profile = buildGamificationProfile(goals, tasks, now);
  const achievements = buildAchievementSignals(goals, tasks, now);
  const milestoneRewards = buildMilestoneRewards(goals, tasks, now);
  const nextMilestone = milestoneRewards.find((reward) => !reward.completed) ?? milestoneRewards[0] ?? null;
  const unlockedAchievements = achievements.filter((achievement) => achievement.unlocked).length;

  const status: XpMomentumPulse["status"] =
    profile.momentumScore >= 80 ? "surging" : profile.momentumScore >= 60 ? "steady" : "recovering";

  const headline =
    status === "surging"
      ? `${profile.streakDays}-day streak online. Forge is compounding.`
      : status === "steady"
        ? `Momentum is stable. One sharp push keeps the engine hot.`
        : `Recovery window open. A small real win will restart the climb.`;

  const detail =
    nextMilestone !== null
      ? `${nextMilestone.title} is the clean next unlock. ${nextMilestone.progressLabel}.`
      : `Level ${profile.level} is active with ${profile.weeklyXp} weekly XP already recorded.`;

  const celebrationLabel =
    unlockedAchievements > 0
      ? `${unlockedAchievements} achievement${unlockedAchievements === 1 ? "" : "s"} unlocked`
      : profile.weeklyXp >= 120
        ? `Weekly sprint heat is building`
        : `Next celebration comes from a real completion or repair`;

  return {
    status,
    headline,
    detail,
    celebrationLabel,
    nextMilestoneId: nextMilestone?.id ?? null,
    nextMilestoneLabel: nextMilestone?.rewardLabel ?? "Keep building visible momentum"
  };
}

export function buildGamificationOverview(goals: Goal[], tasks: Task[], now = new Date()): GamificationOverview {
  return gamificationOverviewSchema.parse({
    profile: buildGamificationProfile(goals, tasks, now),
    achievements: buildAchievementSignals(goals, tasks, now),
    milestoneRewards: buildMilestoneRewards(goals, tasks, now)
  });
}
