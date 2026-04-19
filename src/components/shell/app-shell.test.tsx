import { describe, expect, it, vi } from "vitest";

import {
  buildSidebarMetrics,
  buildStartTaskNowInput,
  sanitizeSelectedUserIds
} from "@/components/shell/app-shell";
import type { ForgeSnapshot } from "@/lib/types";

function createSnapshot(): ForgeSnapshot {
  return {
    meta: {
      apiVersion: "v1",
      transport: "rest+sse",
      generatedAt: "2026-04-13T10:00:00.000Z",
      backend: "node",
      mode: "transitional-node"
    },
    metrics: {
      totalXp: 749,
      level: 7,
      currentLevelXp: 29,
      nextLevelXp: 120,
      weeklyXp: 0,
      streakDays: 0,
      comboMultiplier: 1,
      momentumScore: 4,
      topGoalId: null,
      topGoalTitle: null
    },
    dashboard: {
      stats: {
        totalPoints: 0,
        completedThisWeek: 0,
        activeGoals: 0,
        alignmentScore: 0,
        focusTasks: 0,
        overdueTasks: 0,
        dueThisWeek: 0
      },
      goals: [],
      projects: [],
      tasks: [],
      habits: [],
      tags: [],
      suggestedTags: [],
      owners: [],
      executionBuckets: [],
      notesSummaryByEntity: {},
      gamification: {
        totalXp: 749,
        level: 7,
        currentLevelXp: 29,
        nextLevelXp: 120,
        weeklyXp: 0,
        streakDays: 0,
        comboMultiplier: 1,
        momentumScore: 4,
        topGoalId: null,
        topGoalTitle: null
      },
      achievements: [],
      milestoneRewards: [],
      recentActivity: []
    },
    overview: {
      generatedAt: "2026-04-13T10:00:00.000Z",
      strategicHeader: {
        streakDays: 0,
        level: 7,
        totalXp: 749,
        currentLevelXp: 29,
        nextLevelXp: 120,
        momentumScore: 4,
        focusTasks: 0,
        overdueTasks: 0
      },
      projects: [],
      activeGoals: [],
      topTasks: [],
      dueHabits: [],
      recentEvidence: [],
      achievements: [],
      domainBalance: [],
      neglectedGoals: []
    },
    today: {
      generatedAt: "2026-04-13T10:00:00.000Z",
      directive: {
        task: null,
        goalTitle: null,
        rewardXp: 0,
        sessionLabel: "No directive"
      },
      timeline: [],
      dueHabits: [],
      dailyQuests: [],
      milestoneRewards: [],
      recentHabitRewards: [],
      momentum: {
        streakDays: 0,
        momentumScore: 4,
        recoveryHint: ""
      }
    },
    risk: {
      generatedAt: "2026-04-13T10:00:00.000Z",
      overdueTasks: [],
      blockedTasks: [],
      neglectedGoals: [],
      summary: ""
    },
    users: [],
    strategies: [],
    userScope: {
      selectedUserIds: [],
      selectedUsers: []
    },
    goals: [],
    projects: [],
    tags: [],
    tasks: [],
    habits: [],
    activity: [],
    activeTaskRuns: [],
    lifeForce: {
      userId: "user_operator",
      dateKey: "2026-04-13",
      baselineDailyAp: 200,
      dailyBudgetAp: 200,
      spentTodayAp: 17,
      remainingAp: 183,
      forecastAp: 32,
      plannedRemainingAp: 15,
      targetBandMinAp: 170,
      targetBandMaxAp: 200,
      instantCapacityApPerHour: 3.4,
      instantFreeApPerHour: 1.7,
      overloadApPerHour: 0,
      currentDrainApPerHour: 1.7,
      fatigueBufferApPerHour: 0,
      sleepRecoveryMultiplier: 1,
      readinessMultiplier: 1,
      fatigueDebtCarry: 0,
      stats: [],
      currentCurve: [],
      activeDrains: [],
      plannedDrains: [],
      warnings: [],
      recommendations: [],
      topTaskIdsNeedingSplit: [],
      updatedAt: "2026-04-13T10:00:00.000Z"
    }
  };
}

describe("buildSidebarMetrics", () => {
  it("includes instant AP/h with the sidebar live metrics", () => {
    const t = vi.fn((key: string, values?: { count?: number }) => {
      if (key === "common.shell.momentum.streak") {
        return "Streak";
      }
      if (key === "common.shell.momentum.xp") {
        return "XP";
      }
      if (key === "common.shell.momentum.momentum") {
        return "Momentum";
      }
      if (key === "common.shell.momentum.liveMomentum") {
        return `${values?.count ?? 0}% momentum`;
      }
      if (key === "common.shell.momentum.streakBadgeOne") {
        return "1 day streak";
      }
      if (key === "common.shell.momentum.streakBadgeOther") {
        return `${values?.count ?? 0} day streak`;
      }
      return key;
    });

    const metrics = buildSidebarMetrics(createSnapshot(), t);

    expect(metrics.map((metric) => metric.id)).toEqual([
      "ap",
      "instant-ap",
      "streak",
      "xp",
      "momentum"
    ]);
    expect(metrics[1]).toMatchObject({
      label: "Instant AP/h",
      compactValue: "1.7",
      expandedValue: "1.7 AP/h"
    });
  });
});

describe("sanitizeSelectedUserIds", () => {
  it("drops stale persisted user filters that no longer exist in the snapshot", () => {
    expect(
      sanitizeSelectedUserIds(
        ["user_missing", "user_operator"],
        [
          {
            id: "user_operator",
            kind: "human",
            handle: "albert",
            displayName: "Albert",
            description: "",
            accentColor: "#60a5fa",
            createdAt: "2026-04-10T08:00:00.000Z",
            updatedAt: "2026-04-10T08:00:00.000Z"
          }
        ]
      )
    ).toEqual(["user_operator"]);
  });
});

describe("buildStartTaskNowInput", () => {
  it("starts quick-launch work in unlimited mode unless a planned timer is requested", () => {
    expect(buildStartTaskNowInput("Albert")).toMatchObject({
      actor: "Albert",
      timerMode: "unlimited",
      plannedDurationSeconds: null,
      leaseTtlSeconds: 1800
    });
    expect(
      buildStartTaskNowInput("Albert", { timerMode: "planned" })
    ).toMatchObject({
      actor: "Albert",
      timerMode: "planned",
      plannedDurationSeconds: 1200
    });
  });
});
