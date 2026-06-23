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

  it("rehydrates shell compact profile collections from canonical root arrays", () => {
    const normalized = normalizeForgeSnapshot({
      meta: {
        apiVersion: "v1",
        transport: "rest+sse",
        generatedAt: "2026-06-08T12:00:00.000Z",
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
        notesSummaryByEntity: {}
      },
      overview: {
        generatedAt: "2026-06-08T12:00:00.000Z",
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
        projects: [],
        activeGoals: [],
        topTasks: [],
        recentEvidence: [],
        achievements: [],
        domainBalance: [],
        neglectedGoals: []
      },
      today: {
        generatedAt: "2026-06-08T12:00:00.000Z",
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
        generatedAt: "2026-06-08T12:00:00.000Z",
        overdueTasks: [],
        blockedTasks: [],
        neglectedGoals: [],
        summary: ""
      },
      users: [
        {
          id: "user_albert",
          kind: "human",
          handle: "albert",
          displayName: "Albert",
          description: "",
          accentColor: "#2563eb",
          createdAt: "2026-06-08T12:00:00.000Z",
          updatedAt: "2026-06-08T12:00:00.000Z"
        },
        {
          id: "user_codex",
          kind: "bot",
          handle: "codex",
          displayName: "Codex",
          description: "",
          accentColor: "#059669",
          createdAt: "2026-06-08T12:00:00.000Z",
          updatedAt: "2026-06-08T12:00:00.000Z"
        }
      ],
      goals: [],
      projects: [],
      tags: [{ id: "tag_shell", label: "Shell", color: "blue" }],
      tasks: [
        {
          id: "task_shell",
          title: "Shell task",
          userId: "user_albert",
          ownerUserId: "user_albert",
          assigneeUserIds: ["user_codex"]
        }
      ],
      habits: [{ id: "habit_shell", title: "Shell habit" }],
      activity: [{ id: "activity_shell", title: "Shell activity" }],
      activeTaskRuns: []
    } as never);

    expect(normalized.tasks[0]?.id).toBe("task_shell");
    expect(normalized.tasks[0]?.user?.displayName).toBe("Albert");
    expect(normalized.tasks[0]?.ownerUser?.displayName).toBe("Albert");
    expect(normalized.tasks[0]?.assignees?.[0]?.displayName).toBe("Codex");
    expect(normalized.dashboard.tasks[0]?.id).toBe("task_shell");
    expect(normalized.dashboard.tasks[0]?.user?.displayName).toBe("Albert");
    expect(normalized.dashboard.habits[0]?.id).toBe("habit_shell");
    expect(normalized.dashboard.tags[0]?.id).toBe("tag_shell");
    expect(normalized.dashboard.recentActivity[0]?.id).toBe("activity_shell");
  });
});
