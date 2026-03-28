import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GoalDetailPage } from "@/pages/goal-detail-page";
import { GoalsPage } from "@/pages/goals-page";
import { KanbanPage } from "@/pages/kanban-page";
import { OverviewPage } from "@/pages/overview-page";
import { TodayPage } from "@/pages/today-page";
import type { ForgeSnapshot } from "@/lib/types";

const { useForgeShellMock, useCommandCenterStoreMock, useQueryMock } = vi.hoisted(() => ({
  useForgeShellMock: vi.fn(),
  useCommandCenterStoreMock: vi.fn(),
  useQueryMock: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/store/use-command-center", () => ({
  useCommandCenterStore: useCommandCenterStoreMock
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: useQueryMock
  };
});

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title, description, badge }: { title: string; description: string; badge?: string }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      {badge ? <div>{badge}</div> : null}
    </div>
  )
}));

vi.mock("@/components/goal-studio", () => ({
  GoalStudio: () => <div>Goal studio</div>
}));

vi.mock("@/components/execution-board", () => ({
  ExecutionBoard: ({ tasks }: { tasks: Array<{ id: string }> }) => <div>Execution board {tasks.length}</div>
}));

vi.mock("@/components/daily-runway", () => ({
  DailyRunway: ({ tasks }: { tasks: Array<{ id: string }> }) => <div>Daily runway {tasks.length}</div>
}));

vi.mock("@/components/task-run-controls", () => ({
  TaskRunControls: () => <div>Task run controls</div>
}));

vi.mock("@/components/goal-dialog", () => ({
  GoalDialog: () => null
}));

vi.mock("@/components/project-dialog", () => ({
  ProjectDialog: () => null
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function createSnapshot(overrides: Partial<ForgeSnapshot> = {}): ForgeSnapshot {
  return {
    meta: {
      apiVersion: "v1",
      transport: "rest+sse",
      generatedAt: "2026-03-24T08:00:00.000Z",
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
        activeGoals: 0,
        alignmentScore: 0,
        focusTasks: 0,
        overdueTasks: 0,
        dueThisWeek: 0
      },
      goals: [],
      projects: [],
      tasks: [],
      tags: [],
      suggestedTags: [],
      owners: [],
      executionBuckets: [],
      notesSummaryByEntity: {},
      gamification: {
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
      achievements: [],
      milestoneRewards: [],
      recentActivity: []
    },
    overview: {
      generatedAt: "2026-03-24T08:00:00.000Z",
      strategicHeader: {
        streakDays: 0,
        level: 1,
        totalXp: 0,
        currentLevelXp: 0,
        nextLevelXp: 100,
        momentumScore: 0,
        focusTasks: 0,
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
      generatedAt: "2026-03-24T08:00:00.000Z",
      directive: {
        task: null,
        goalTitle: null,
        rewardXp: 0,
        sessionLabel: "No directive"
      },
      timeline: [],
      dailyQuests: [],
      milestoneRewards: [],
      momentum: {
        streakDays: 0,
        momentumScore: 0,
        recoveryHint: ""
      }
    },
    risk: {
      generatedAt: "2026-03-24T08:00:00.000Z",
      overdueTasks: [],
      blockedTasks: [],
      neglectedGoals: [],
      summary: ""
    },
    goals: [],
    projects: [],
    tags: [],
    tasks: [],
    activity: [],
    activeTaskRuns: [],
    ...overrides
  };
}

function renderWithProviders(element: React.ReactNode, initialEntry = "/") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>{element}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("core route states", () => {
  it("shows the overview empty state when no strategic data exists", async () => {
    useForgeShellMock.mockReturnValue({ snapshot: createSnapshot() });

    renderWithProviders(<OverviewPage />);

    expect(screen.getByText("No overview yet")).toBeInTheDocument();
    expect(screen.getByText("Open life goals")).toBeInTheDocument();
  });

  it("shows the goals empty state when no goals exist yet", async () => {
    useForgeShellMock.mockReturnValue({
      snapshot: createSnapshot(),
      createGoal: vi.fn(),
      patchGoal: vi.fn()
    });

    renderWithProviders(<GoalsPage />);

    expect(screen.getByText("Goal studio")).toBeInTheDocument();
    expect(screen.getByText("No life goals yet")).toBeInTheDocument();
  });

  it("shows a recoverable empty state when the goal route points at a missing goal", async () => {
    useForgeShellMock.mockReturnValue({
      snapshot: createSnapshot({
        dashboard: {
          ...createSnapshot().dashboard,
          goals: [],
          projects: []
        }
      })
    });

    renderWithProviders(
      <Routes>
        <Route path="/goals/:goalId" element={<GoalDetailPage />} />
      </Routes>,
      "/goals/goal_missing"
    );

    expect(screen.getByText("This life goal is not available")).toBeInTheDocument();
    expect(screen.getByText("Back to goals")).toBeInTheDocument();
  });

  it("shows the kanban empty state when no tasks exist", async () => {
    useForgeShellMock.mockReturnValue({
      snapshot: createSnapshot(),
      patchTaskStatus: vi.fn()
    });
    useCommandCenterStoreMock.mockReturnValue({
      selectedGoalId: null,
      selectedOwner: null,
      selectedTagIds: [],
      setGoal: vi.fn(),
      setOwner: vi.fn(),
      toggleTag: vi.fn(),
      reset: vi.fn()
    });
    useQueryMock.mockReturnValue({
      data: undefined,
      isError: false,
      error: null,
      refetch: vi.fn()
    });

    renderWithProviders(<KanbanPage />);

    expect(screen.getByText("No board yet")).toBeInTheDocument();
    expect(screen.getByText("Open life goals")).toBeInTheDocument();
  });

  it("shows the today empty state when no directive, tasks, or rewards exist", async () => {
    useForgeShellMock.mockReturnValue({
      snapshot: createSnapshot(),
      patchTaskStatus: vi.fn()
    });

    renderWithProviders(<TodayPage />);

    expect(screen.getByText("No daily runway yet")).toBeInTheDocument();
    expect(screen.getByText("Open life goals")).toBeInTheDocument();
  });
});
