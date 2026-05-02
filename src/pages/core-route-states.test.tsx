import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GoalDetailPage } from "@/pages/goal-detail-page";
import { GoalsPage } from "@/pages/goals-page";
import { KanbanPage } from "@/pages/kanban-page";
import { OverviewPage } from "@/pages/overview-page";
import { ProjectDetailPage } from "@/pages/project-detail-page";
import { ProjectsPage } from "@/pages/projects-page";
import { TodayPage } from "@/pages/today-page";
import type { CalendarSchedulingRules, ForgeSnapshot } from "@/lib/types";

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

vi.mock("@/components/task-dialog", () => ({
  TaskDialog: () => null
}));

vi.mock("@/components/work-adjustment-dialog", () => ({
  WorkAdjustmentDialog: () => null
}));

vi.mock("@/components/notes/entity-notes-surface", () => ({
  EntityNotesSurface: () => null
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const EMPTY_RULES: CalendarSchedulingRules = {
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
};

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
      habits: [],
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
      dueHabits: [],
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
      dueHabits: [],
      dailyQuests: [],
      milestoneRewards: [],
      recentHabitRewards: [],
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
  it("shows the overview shell when only gamification metrics exist", async () => {
    useForgeShellMock.mockReturnValue({ snapshot: createSnapshot() });

    renderWithProviders(<OverviewPage />);

    expect(screen.getAllByText("Overview").length).toBeGreaterThan(0);
    expect(screen.getByText("Momentum 0")).toBeInTheDocument();
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
    useQueryMock.mockReturnValue({
      data: {
        calendar: {
          generatedAt: "2026-04-03T08:00:00.000Z",
          providers: [],
          connections: [],
          calendars: [],
          events: [],
          workBlockTemplates: [],
          workBlockInstances: [],
          timeboxes: []
        }
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn()
    });

    renderWithProviders(<TodayPage />);

    expect(screen.getByText("No daily runway yet")).toBeInTheDocument();
    expect(screen.getByText("Open life goals")).toBeInTheDocument();
  });

  it("shows a compact today calendar card when the day has events", async () => {
    const eventStart = new Date();
    eventStart.setHours(9, 0, 0, 0);
    const eventEnd = new Date(eventStart);
    eventEnd.setHours(10, 0, 0, 0);

    useForgeShellMock.mockReturnValue({
      snapshot: createSnapshot(),
      patchTaskStatus: vi.fn()
    });
    useQueryMock.mockReturnValue({
      data: {
        calendar: {
          generatedAt: new Date().toISOString(),
          providers: [],
          connections: [],
          calendars: [],
          events: [
            {
              id: "event_today",
              connectionId: null,
              calendarId: null,
              remoteId: null,
              ownership: "forge",
              originType: "native",
              status: "confirmed",
              title: "Creative sync",
              description: "Sharpen the brief before writing.",
              location: "",
              startAt: eventStart.toISOString(),
              endAt: eventEnd.toISOString(),
              timezone: "UTC",
              isAllDay: false,
              availability: "busy",
              eventType: "focus",
              categories: [],
              sourceMappings: [],
              links: [],
              remoteUpdatedAt: null,
              deletedAt: null,
              createdAt: eventStart.toISOString(),
              updatedAt: eventStart.toISOString()
            }
          ],
          workBlockTemplates: [],
          workBlockInstances: [],
          timeboxes: []
        }
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn()
    });

    renderWithProviders(<TodayPage />);

    expect(screen.getByText("Today's calendar")).toBeInTheDocument();
    expect(screen.getByText("Creative sync")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open calendar/i })).toHaveAttribute("href", "/calendar");
  });

  it("defaults the projects page to active projects and supports tokenized goal search", async () => {
    const base = createSnapshot();
    const tag = {
      id: "tag_execution",
      name: "Execution",
      kind: "execution" as const,
      color: "#5577cc",
      description: "Execution tag"
    };
    const goal = {
      id: "goal_health",
      title: "Deep Health Goal",
      description: "A long-term body goal.",
      horizon: "year" as const,
      status: "active" as const,
      targetPoints: 500,
      themeColor: "#5577cc",
      createdAt: "2026-03-24T08:00:00.000Z",
      updatedAt: "2026-03-24T08:00:00.000Z",
      tagIds: [tag.id]
    };
    const activeProject = {
      id: "project_active",
      goalId: goal.id,
      goalTitle: goal.title,
      title: "Body Rebuild Sprint",
      description: "Active work for health.",
      status: "active" as const,
      workflowStatus: "focus" as const,
      targetPoints: 180,
      themeColor: "#5577cc",
      productRequirementsDocument: "Health sprint PRD",
      createdAt: "2026-03-24T08:00:00.000Z",
      updatedAt: "2026-03-24T08:00:00.000Z",
      schedulingRules: EMPTY_RULES,
      activeTaskCount: 1,
      completedTaskCount: 0,
      totalTasks: 1,
      earnedPoints: 0,
      progress: 0,
      nextTaskId: "task_health",
      nextTaskTitle: "Protect the gym block",
      momentumLabel: "Building momentum",
      time: {
        totalTrackedSeconds: 0,
        totalCreditedSeconds: 0,
        liveTrackedSeconds: 0,
        liveCreditedSeconds: 0,
        manualAdjustedSeconds: 0,
        activeRunCount: 0,
        hasCurrentRun: false,
        currentRunId: null
      }
    };
    const pausedProject = {
      ...activeProject,
      id: "project_paused",
      title: "Paused Writing System",
      description: "Suspended work for writing.",
      status: "paused" as const,
      goalId: "goal_writing",
      goalTitle: "Creative Work Goal",
      nextTaskId: null,
      nextTaskTitle: null
    };
    const snapshot = createSnapshot({
      tags: [tag],
      tasks: [
        {
          id: "task_health",
          title: "Protect the gym block",
          description: "Hold the time window.",
          level: "task",
          status: "focus",
          priority: "medium",
          owner: "Aurel",
          goalId: goal.id,
          projectId: activeProject.id,
          parentWorkItemId: null,
          dueDate: null,
          effort: "deep",
          energy: "steady",
          points: 25,
          plannedDurationSeconds: null,
          schedulingRules: null,
          sortOrder: 0,
          aiInstructions: "Protect the gym block and keep the rhythm durable.",
          executionMode: null,
          acceptanceCriteria: [],
          blockerLinks: [],
          completionReport: null,
          gitRefs: [],
          completedAt: null,
          createdAt: "2026-03-24T08:00:00.000Z",
          updatedAt: "2026-03-24T08:00:00.000Z",
          tagIds: [tag.id],
          assigneeUserIds: [],
          assignees: [],
          time: activeProject.time
        }
      ],
      dashboard: {
        ...base.dashboard,
        goals: [
          {
            ...goal,
            progress: 0,
            totalTasks: 1,
            completedTasks: 0,
            earnedPoints: 0,
            momentumLabel: "Building pace",
            tags: [tag]
          },
          {
            ...goal,
            id: "goal_writing",
            title: "Creative Work Goal",
            description: "Writing direction.",
            tagIds: [],
            progress: 0,
            totalTasks: 0,
            completedTasks: 0,
            earnedPoints: 0,
            momentumLabel: "Needs ignition",
            tags: []
          }
        ],
        projects: [activeProject, pausedProject]
      }
    });

    useForgeShellMock.mockReturnValue({
      snapshot,
      patchProject: vi.fn()
    });

    renderWithProviders(<ProjectsPage />);

    expect(screen.getAllByText("Body Rebuild Sprint").length).toBeGreaterThan(0);
    expect(screen.queryByText("Paused Writing System")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Suspended/i }));
    expect(screen.getAllByText("Paused Writing System").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Body Rebuild Sprint")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /Active/i }));
    fireEvent.change(screen.getByPlaceholderText("Type a project, goal, task, human, bot, user, or tag"), {
      target: { value: "health" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Deep Health Goal/i }));
    expect(screen.getAllByText("Deep Health Goal").length).toBeGreaterThan(1);
    fireEvent.change(screen.getByPlaceholderText("Type a project, goal, task, human, bot, user, or tag"), {
      target: { value: "rebuild" }
    });
    expect(screen.getAllByText("Body Rebuild Sprint").length).toBeGreaterThan(0);
  });

  it("shows restart and delete actions for finished projects on the detail page", async () => {
    const base = createSnapshot();
    const goal = {
      id: "goal_finished",
      title: "Ship the finished project",
      description: "Finished project coverage.",
      horizon: "quarter" as const,
      status: "active" as const,
      targetPoints: 300,
      themeColor: "#5577cc",
      createdAt: "2026-03-24T08:00:00.000Z",
      updatedAt: "2026-03-24T08:00:00.000Z",
      tagIds: []
    };
    const project = {
      id: "project_finished",
      goalId: goal.id,
      goalTitle: goal.title,
      title: "Finished Project",
      description: "A project that is already done.",
      status: "completed" as const,
      workflowStatus: "done" as const,
      targetPoints: 180,
      themeColor: "#5577cc",
      productRequirementsDocument: "Finished project PRD",
      schedulingRules: EMPTY_RULES,
      createdAt: "2026-03-24T08:00:00.000Z",
      updatedAt: "2026-03-24T08:00:00.000Z",
      activeTaskCount: 0,
      completedTaskCount: 2,
      totalTasks: 2,
      earnedPoints: 50,
      progress: 100,
      nextTaskId: null,
      nextTaskTitle: null,
      momentumLabel: "Closing strong",
      time: {
        totalTrackedSeconds: 0,
        totalCreditedSeconds: 0,
        liveTrackedSeconds: 0,
        liveCreditedSeconds: 0,
        manualAdjustedSeconds: 0,
        activeRunCount: 0,
        hasCurrentRun: false,
        currentRunId: null
      }
    };

    useForgeShellMock.mockReturnValue({
      snapshot: createSnapshot({
        ...base,
        goals: [goal],
        dashboard: {
          ...base.dashboard,
          projects: [project],
          goals: [
            {
              ...goal,
              progress: 100,
              totalTasks: 2,
              completedTasks: 2,
              earnedPoints: 50,
              momentumLabel: "Strong momentum",
              tags: []
            }
          ]
        }
      }),
      createTask: vi.fn(),
      patchTaskStatus: vi.fn(),
      patchProject: vi.fn()
    });
    useQueryMock.mockReturnValue({
      data: {
        project,
        goal,
        tasks: [],
        activity: [],
        notesSummaryByEntity: {}
      },
      isError: false,
      error: null,
      refetch: vi.fn()
    });

    renderWithProviders(
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      </Routes>,
      "/projects/project_finished"
    );

    expect(screen.getByRole("button", { name: "Restart" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument();
  });
});
