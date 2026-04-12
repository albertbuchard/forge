import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@/lib/i18n";
import { KanbanPage } from "./kanban-page";
import type { ForgeSnapshot, Task, UserSummary } from "@/lib/types";

const { splitTaskMock, useForgeShellMock } = vi.hoisted(
  () => ({
    splitTaskMock: vi.fn(),
    useForgeShellMock: vi.fn()
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
      <div>{tasks.map((task) => task.title).join(" | ")}</div>
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

function createUser(
  id: string,
  displayName: string,
  kind: UserSummary["kind"] = "human"
): UserSummary {
  return {
    id,
    kind,
    handle: displayName.toLowerCase().replace(/\s+/g, "_"),
    displayName,
    description: `${displayName} description`,
    accentColor: kind === "bot" ? "#67e8f9" : "#fcd34d",
    createdAt: "2026-04-11T08:00:00.000Z",
    updatedAt: "2026-04-11T08:00:00.000Z"
  };
}

function createTask({
  id,
  title,
  goalId,
  projectId,
  tagIds,
  user
}: {
  id: string;
  title: string;
  goalId: string;
  projectId: string;
  tagIds: string[];
  user: UserSummary;
}): Task {
  return {
    id,
    title,
    description: `${title} description`,
    status: "focus",
    priority: "high",
    owner: user.displayName,
    goalId,
    projectId,
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
    tagIds,
    userId: user.id,
    user,
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
}

function createSnapshot(tasks: Task[], users: UserSummary[]): ForgeSnapshot {
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
        activeGoals: 2,
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
          user:
            users.find((user) => user.id === "user_operator") ?? users[0]!,
          owner: "Albert"
        },
        {
          id: "project_2",
          goalId: "goal_2",
          goalTitle: "Run Support",
          title: "Hermes Concierge",
          description: "",
          status: "active",
          targetPoints: 80,
          themeColor: "#7dd3fc",
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
          userId: "user_bot",
          user: users.find((user) => user.id === "user_bot") ?? users[0]!,
          owner: "Forge Bot"
        }
      ],
      tasks,
      habits: [],
      tags: [
        {
          id: "tag_focus",
          name: "Focus",
          kind: "execution",
          color: "#facc15",
          description: ""
        },
        {
          id: "tag_ops",
          name: "Ops",
          kind: "execution",
          color: "#22d3ee",
          description: ""
        }
      ],
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
    goals: [
      {
        id: "goal_1",
        title: "Ship Forge",
        description: "",
        horizon: "quarter",
        status: "active",
        targetPoints: 120,
        themeColor: "#c0c1ff",
        createdAt: "2026-04-11T08:00:00.000Z",
        updatedAt: "2026-04-11T08:00:00.000Z",
        tagIds: [],
        userId: "user_operator",
        user: users.find((user) => user.id === "user_operator") ?? users[0]!
      },
      {
        id: "goal_2",
        title: "Run Support",
        description: "",
        horizon: "quarter",
        status: "active",
        targetPoints: 80,
        themeColor: "#7dd3fc",
        createdAt: "2026-04-11T08:00:00.000Z",
        updatedAt: "2026-04-11T08:00:00.000Z",
        tagIds: [],
        userId: "user_bot",
        user: users.find((user) => user.id === "user_bot") ?? users[0]!
      }
    ],
    projects: [],
    tags: [
      {
        id: "tag_focus",
        name: "Focus",
        kind: "execution",
        color: "#facc15",
        description: ""
      },
      {
        id: "tag_ops",
        name: "Ops",
        kind: "execution",
        color: "#22d3ee",
        description: ""
      }
    ],
    tasks,
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
    users,
    lifeForce: {
      userId: "user_operator",
      dateKey: "2026-04-11",
      baselineDailyAp: 200,
      dailyBudgetAp: 200,
      spentTodayAp: 80,
      remainingAp: 120,
      forecastAp: 140,
      plannedRemainingAp: 60,
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
      plannedDrains: [],
      warnings: [],
      recommendations: [],
      topTaskIdsNeedingSplit: tasks.map((task) => task.id),
      updatedAt: "2026-04-11T12:00:00.000Z"
    }
  } as unknown as ForgeSnapshot;
}

describe("KanbanPage split flow", () => {
  const humanUser = createUser("user_operator", "Albert", "human");
  const secondHumanUser = createUser("user_human_2", "Clara", "human");
  const botUser = createUser("user_bot", "Forge Bot", "bot");

  function renderKanban(tasks: Task[]) {
    useForgeShellMock.mockReturnValue({
      snapshot: createSnapshot(tasks, [humanUser, secondHumanUser, botUser]),
      selectedUserIds: ["user_operator"],
      patchTaskStatus: vi.fn(),
      startTaskNow: vi.fn(),
      openStartWork: vi.fn(),
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
  }

  beforeEach(() => {
    vi.clearAllMocks();
    splitTaskMock.mockResolvedValue({ parent: {}, children: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the split modal and submits child names and ratio through splitTask", async () => {
    renderKanban([
      createTask({
        id: "task_1",
        title: "Oversized task",
        goalId: "goal_1",
        projectId: "project_1",
        tagIds: ["tag_focus"],
        user: humanUser
      })
    ]);

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

  it("filters kanban tasks through compact entity chips", async () => {
    renderKanban([
      createTask({
        id: "task_1",
        title: "Ship board polish",
        goalId: "goal_1",
        projectId: "project_1",
        tagIds: ["tag_focus"],
        user: humanUser
      }),
      createTask({
        id: "task_2",
        title: "Run concierge sync",
        goalId: "goal_2",
        projectId: "project_2",
        tagIds: ["tag_ops"],
        user: botUser
      })
    ]);

    expect(screen.getByText("Execution board 2")).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("Filter by goal, project, or tag"),
      {
        target: { value: "Hermes" }
      }
    );
    fireEvent.click(screen.getByRole("button", { name: /Hermes Concierge/i }));

    await waitFor(() => {
      expect(screen.getByText("Execution board 1")).toBeInTheDocument();
      expect(screen.getByText("Run concierge sync")).toBeInTheDocument();
    });
  });

  it("filters owners by kind chips and specific users from the same compact multiselect", async () => {
    renderKanban([
      createTask({
        id: "task_1",
        title: "Human planning pass",
        goalId: "goal_1",
        projectId: "project_1",
        tagIds: ["tag_focus"],
        user: humanUser
      }),
      createTask({
        id: "task_2",
        title: "Bot queue flush",
        goalId: "goal_2",
        projectId: "project_2",
        tagIds: ["tag_ops"],
        user: botUser
      }),
      createTask({
        id: "task_3",
        title: "Human support pass",
        goalId: "goal_1",
        projectId: "project_1",
        tagIds: ["tag_ops"],
        user: secondHumanUser
      })
    ]);

    fireEvent.change(
      screen.getByPlaceholderText(
        "Type Bo for bots, Hu for humans, or a teammate name"
      ),
      {
        target: { value: "Bo" }
      }
    );
    fireEvent.click(screen.getByRole("button", { name: /Bots/i }));

    await waitFor(() => {
      expect(screen.getByText("Execution board 1")).toBeInTheDocument();
      expect(screen.getByText("Bot queue flush")).toBeInTheDocument();
    });

    fireEvent.change(
      screen.getByPlaceholderText(
        "Type Bo for bots, Hu for humans, or a teammate name"
      ),
      {
        target: { value: "Albert" }
      }
    );
    fireEvent.click(screen.getByRole("button", { name: /Albert/i }));

    await waitFor(() => {
      expect(screen.getByText("Execution board 2")).toBeInTheDocument();
      expect(screen.getByText("Human planning pass | Bot queue flush")).toBeInTheDocument();
    });
  });
});
