import { describe, expect, it } from "vitest";
import { normalizeForgeSnapshot } from "./snapshot-normalizer";

describe("normalizeForgeSnapshot", () => {
  it("maps legacy campaign fields into project arrays and fills task defaults", () => {
    const normalized = normalizeForgeSnapshot({
      meta: {
        apiVersion: "v1",
        transport: "rest+sse",
        generatedAt: "2026-03-22T20:00:00.000Z",
        backend: "forge-node-runtime",
        mode: "transitional-node"
      },
      metrics: {
        totalXp: 100,
        level: 2,
        currentLevelXp: 10,
        nextLevelXp: 120,
        weeklyXp: 40,
        streakDays: 2,
        comboMultiplier: 1.1,
        momentumScore: 50,
        topGoalId: null,
        topGoalTitle: null
      },
      dashboard: {
        stats: {
          totalPoints: 0,
          completedThisWeek: 0,
          activeGoals: 1,
          alignmentScore: 80,
          focusTasks: 1,
          overdueTasks: 0,
          dueThisWeek: 0
        },
        goals: [],
        campaigns: [
          {
            id: "campaign_1",
            goalId: "goal_1",
            goalTitle: "Health",
            title: "Core Path",
            summary: "Legacy project summary",
            status: "active",
            activeTaskCount: 1,
            completedTaskCount: 0,
            totalTasks: 1,
            totalPoints: 80,
            nextTaskId: null,
            nextTaskTitle: null,
            derived: true
          }
        ],
        tasks: [],
        tags: [],
        suggestedTags: [],
        owners: [],
        executionBuckets: [],
        gamification: {
          totalXp: 100,
          level: 2,
          currentLevelXp: 10,
          nextLevelXp: 120,
          weeklyXp: 40,
          streakDays: 2,
          comboMultiplier: 1.1,
          momentumScore: 50,
          topGoalId: null,
          topGoalTitle: null
        },
        achievements: [],
        milestoneRewards: [],
        recentActivity: []
      },
      overview: {
        generatedAt: "2026-03-22T20:00:00.000Z",
        strategicHeader: {
          streakDays: 2,
          level: 2,
          totalXp: 100,
          currentLevelXp: 10,
          nextLevelXp: 120,
          momentumScore: 50,
          focusTasks: 1,
          overdueTasks: 0
        },
        campaigns: [],
        activeGoals: [],
        topTasks: [{ id: "task_1", title: "Task from old payload" }],
        recentEvidence: [],
        achievements: [],
        domainBalance: [],
        neglectedGoals: []
      },
      today: {
        generatedAt: "2026-03-22T20:00:00.000Z",
        directive: {
          task: null,
          goalTitle: null,
          rewardXp: 0,
          sessionLabel: "Session"
        },
        timeline: [],
        dailyQuests: [],
        milestoneRewards: [],
        momentum: {
          streakDays: 2,
          momentumScore: 50,
          recoveryHint: "Recover"
        }
      },
      risk: {
        generatedAt: "2026-03-22T20:00:00.000Z",
        overdueTasks: [],
        blockedTasks: [],
        neglectedGoals: [],
        summary: ""
      },
      goals: [],
      tags: [],
      tasks: [],
      activity: [],
      activeTaskRuns: []
    } as never);

    expect(normalized.dashboard.projects).toHaveLength(1);
    expect(normalized.dashboard.projects[0]?.title).toBe("Core Path");
    expect(normalized.overview.topTasks[0]?.projectId).toBeNull();
  });
});
