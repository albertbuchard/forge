import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@/lib/i18n";
import { KanbanPage } from "./kanban-page";
import type { ForgeSnapshot, Task } from "@/lib/types";

const { splitTaskMock, useForgeShellMock, useCommandCenterStoreMock } = vi.hoisted(
  () => ({
    splitTaskMock: vi.fn(),
    useForgeShellMock: vi.fn(),
    useCommandCenterStoreMock: vi.fn()
  })
);

vi.mock("@/lib/api", () => ({
  deleteTask: vi.fn(),
  patchTask: vi.fn(),
  splitTask: splitTaskMock,
  uncompleteTask: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/store/use-command-center", () => ({
  useCommandCenterStore: useCommandCenterStoreMock
}));

vi.mock("@/components/execution-board", () => ({
  ExecutionBoard: ({
    tasks,
    onSplitTask
  }: {
    tasks: Task[];
    onSplitTask?: (taskId: string) => void;
  }) => (
    <div>
      <div>Execution board {tasks.length}</div>
      <button type="button" onClick={() => onSplitTask?.(tasks[0]!.id)}>
        Open split modal
      </button>
    </div>
  )
}));

vi.mock("@/components/task-dialog", () => ({
  TaskDialog: () => null
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title }: { title: string }) => <div>{title}</div>
}));

function createSnapshot(task: Task): ForgeSnapshot {
  return {
    meta: {
      apiVersion: "v1",
      transport: "rest+sse",
      generatedAt: "2026-04-11T12:00:00.000Z",
      backend: "node",
      mode: "transitional-node"
    },
    metrics: {
      totalXp: 0,
      level: 1,
      currentLevelXp: 0,
      nextLevelXp: 100,
      weeklyXp: 0,
      streakDays: 0,
      comboMultiplier: 1,
      momentumScore: 0,
      topGoalId: null,
      topGoalTitle: null
    },
    dashboard: {
      stats: {
        totalPoints: 0,
        completedThisWeek: 0,
        activeGoals: 1,
        alignmentScore: 0,
        focusTasks: 1,
        overdueTasks: 0,
        dueThisWeek: 0
      },
      goals: [],
      projects: [
        {
          id: "project_1",
          goalId: "goal_1",
          goalTitle: "Ship Forge",
          title: "Forge Runtime",
          description: "",
          status: "active",
          targetPoints: 120,
          themeColor: "#c0c1ff",
          schedulingRules: {
            allowWorkBlockKinds: [],
            blockWorkBlockKinds: [],
            allowCalendarIds: [],
            blockCalendarIds: [],
            allowEventTypes: [],
            blockEventTypes: [],
            allowEventKeywords: [],
            blockEventKeywords: [],
            allowAvailability: [],
            blockAvailability: []
          },
          createdAt: "2026-04-11T08:00:00.000Z",
          updatedAt: "2026-04-11T08:00:00.000Z",
          userId: "user_operator",
          user: task.user!,
          owner: "Albert"
        }
      ],
      tasks: [task],
      habits: [],
      tags: [],
      suggestedTags: [],
      owners: [],
      executionBuckets: [],
      notesSummaryByEntity: {},
      gamification: {
        quests: [],
        achievements: [],
        topReward: null
      }
    },
    goals: [],
    projects: [],
    tags: [],
    tasks: [task],
    habits: [],
    activity: [],
    activeTaskRuns: [],
    risk: {
      blockedProjects: [],
      overloadedGoals: [],
      neglectedGoals: [],
      summary: ""
    },
    today: {
      timeline: [],
      tasks: [],
      habits: [],
      notePrompts: []
    },
    overview: {
      topTasks: [],
      momentum: [],
      wins: []
    },
    users: [task.user!],
    lifeForce: {
      userId: "user_operator",
      dateKey: "2026-04-11",
      baselineDailyAp: 200,
      dailyBudgetAp: 200,
      spentTodayAp: 80,
      remainingAp: 120,
      forecastAp: 140,
      targetBandMinAp: 170,
      targetBandMaxAp: 200,
      instantCapacityApPerHour: 10,
      instantFreeApPerHour: 2,
      overloadApPerHour: 0,
      currentDrainApPerHour: 4,
      fatigueBufferApPerHour: 1,
      sleepRecoveryMultiplier: 1,
      readinessMultiplier: 1,
      fatigueDebtCarry: 0,
      stats: [],
      currentCurve: [],
      activeDrains: [],
      warnings: [],
      recommendations: [],
      topTaskIdsNeedingSplit: [task.id],
      updatedAt: "2026-04-11T12:00:00.000Z"
    }
  } as unknown as ForgeSnapshot;
}

describe("KanbanPage split flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    splitTaskMock.mockResolvedValue({ parent: {}, children: [] });
    useCommandCenterStoreMock.mockReturnValue({
      selectedGoalId: null,
      selectedUserId: null,
      selectedTagIds: [],
      setGoal: vi.fn(),
      setUserId: vi.fn(),
      toggleTag: vi.fn(),
      reset: vi.fn()
    });
  });

  it("opens the split modal and submits child names and ratio through splitTask", async () => {
    const task: Task = {
      id: "task_1",
      title: "Oversized task",
      description: "Needs to be split.",
      status: "focus",
      priority: "high",
      owner: "Albert",
      goalId: "goal_1",
      projectId: "project_1",
      dueDate: null,
      effort: "deep",
      energy: "steady",
      points: 90,
      plannedDurationSeconds: 86_400,
      schedulingRules: null,
      sortOrder: 0,
      resolutionKind: null,
      splitParentTaskId: null,
      completedAt: null,
      createdAt: "2026-04-11T08:00:00.000Z",
      updatedAt: "2026-04-11T08:00:00.000Z",
      tagIds: [],
      userId: "user_operator",
      user: {
        id: "user_operator",
        kind: "human",
        handle: "albert",
        displayName: "Albert",
        description: "",
        accentColor: "#c0c1ff",
        createdAt: "2026-04-11T08:00:00.000Z",
        updatedAt: "2026-04-11T08:00:00.000Z"
      },
      time: {
        totalTrackedSeconds: 0,
        totalCreditedSeconds: 200_000,
        liveTrackedSeconds: 0,
        liveCreditedSeconds: 0,
        manualAdjustedSeconds: 0,
        activeRunCount: 0,
        hasCurrentRun: false,
        currentRunId: null
      },
      actionPointSummary: {
        costBand: "standard",
        totalCostAp: 100,
        expectedDurationSeconds: 86_400,
        sustainRateApPerHour: 100 / 24,
        spentTodayAp: 4,
        spentTotalAp: 24,
        remainingAp: 76
      },
      splitSuggestion: {
        shouldSplit: true,
        reason: "This task has already absorbed more than two expected days of work.",
        thresholdSeconds: 172_800
      }
    };
    useForgeShellMock.mockReturnValue({
      snapshot: createSnapshot(task),
      selectedUserIds: ["user_operator"],
      patchTaskStatus: vi.fn(),
      startTaskNow: vi.fn(),
      createTask: vi.fn(),
      refresh: vi.fn()
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en">
            <KanbanPage />
          </I18nProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Open split modal" }));

    expect(screen.getByText("Split this task")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Oversized task - part 1"), {
      target: { value: "Oversized task - API slice" }
    });
    fireEvent.change(screen.getByDisplayValue("Oversized task - part 2"), {
      target: { value: "Oversized task - UI slice" }
    });
    fireEvent.change(screen.getByRole("slider"), {
      target: { value: "65" }
    });
    fireEvent.click(screen.getByRole("button", { name: /create split tasks/i }));

    await waitFor(() => {
      expect(splitTaskMock).toHaveBeenCalledWith("task_1", {
        firstTitle: "Oversized task - API slice",
        secondTitle: "Oversized task - UI slice",
        remainingRatio: 0.65
      });
    });
  });
});
