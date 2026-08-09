import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOverviewXpFallback,
  FORGE_OVERVIEW_GROUPS,
  OverviewPage
} from "@/pages/overview-page";
import type { ForgeSnapshot } from "@/lib/types";

const {
  useForgeShellMock,
  getSleepViewMock,
  getFitnessViewMock,
  getMovementDayMock,
  getVitalsViewMock,
  getAttentionInboxMock,
  useGetForgeDoctorQueryMock,
  useGetXpMetricsQueryMock
} = vi.hoisted(() => ({
  useForgeShellMock: vi.fn(),
  getSleepViewMock: vi.fn(),
  getFitnessViewMock: vi.fn(),
  getMovementDayMock: vi.fn(),
  getVitalsViewMock: vi.fn(),
  getAttentionInboxMock: vi.fn(),
  useGetForgeDoctorQueryMock: vi.fn(),
  useGetXpMetricsQueryMock: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/store/api/forge-api", () => ({
  useGetForgeDoctorQuery: useGetForgeDoctorQueryMock,
  useGetXpMetricsQuery: useGetXpMetricsQueryMock
}));

vi.mock("@/lib/api", () => ({
  getSleepView: (...args: unknown[]) => getSleepViewMock(...args),
  getFitnessView: (...args: unknown[]) => getFitnessViewMock(...args),
  getMovementDay: (...args: unknown[]) => getMovementDayMock(...args),
  getVitalsView: (...args: unknown[]) => getVitalsViewMock(...args),
  getAttentionInbox: (...args: unknown[]) => getAttentionInboxMock(...args)
}));

vi.mock("@/components/create-menu", () => ({
  useForgeCreateActions: () => ({ actions: [], dialogs: null }),
  CreateMenu: () => <button type="button">Create</button>
}));

vi.mock("@/components/customization/ai-surface-workspace", () => ({
  AiSurfaceWorkspace: ({
    baseWidgets
  }: {
    baseWidgets: Array<{
      id: string;
      defaultHidden?: boolean;
      render: (args: { compact: boolean }) => ReactNode;
    }>;
  }) => (
    <main>
      {baseWidgets.map((widget) => (
        <section
          key={widget.id}
          data-testid={`overview-widget-${widget.id}`}
          data-default-hidden={String(Boolean(widget.defaultHidden))}
        >
          {widget.render({ compact: false })}
        </section>
      ))}
    </main>
  )
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description,
    badge,
    actions
  }: {
    title: ReactNode;
    description: ReactNode;
    badge?: ReactNode;
    actions?: ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
      <div>{badge}</div>
      {actions}
    </header>
  )
}));

vi.mock("@/components/gamification/gamification-widgets", () => ({
  GamificationOverviewWidget: () => <div>Forge Smith trophy</div>
}));

vi.mock("@/components/life-force/life-force-workspace", () => ({
  LifeForceOverviewWorkspace: () => <div>Life Force workspace</div>
}));

vi.mock("@/components/customization/utility-widgets", () => ({
  MiniCalendarWidget: () => <div>Mini calendar</div>,
  QuickCaptureWidget: () => <div>Quick capture</div>,
  SpotifyWidget: () => <div>Spotify</div>,
  TimeWidget: () => <div>Time</div>,
  WeatherWidget: () => <div>Weather</div>
}));

function createSnapshot(): ForgeSnapshot {
  return {
    metrics: {
      totalXp: 1800,
      level: 7,
      currentLevelXp: 48,
      nextLevelXp: 100,
      weeklyXp: 126,
      streakDays: 9,
      comboMultiplier: 1.4,
      momentumScore: 82,
      topGoalId: null,
      topGoalTitle: null
    },
    dashboard: { goals: [], projects: [] },
    overview: {
      topTasks: [
        {
          id: "task_focus",
          title: "Finish the Overview",
          description: "Complete the front door.",
          status: "in_progress",
          points: 50
        }
      ],
      dueHabits: [
        {
          id: "habit_sleep",
          title: "Protect sleep",
          description: "Keep the routine.",
          rewardXp: 10
        }
      ],
      recentEvidence: [],
      activeGoals: []
    },
    today: { directive: { task: null, sessionLabel: "Plan today" } },
    risk: { blockedTasks: [], overdueTasks: [] },
    activeTaskRuns: [],
    projects: [{ id: "project_one" }],
    tasks: [{ id: "task_focus" }],
    habits: [{ id: "habit_sleep" }],
    tags: [],
    users: [],
    userScope: {
      selectedUserIds: ["user_operator"],
      selectedUsers: [{ id: "user_operator", displayName: "Albert" }]
    },
    lifeForce: {
      dailyBudgetAp: 214,
      spentTodayAp: 132,
      remainingAp: 82,
      instantFreeApPerHour: 6.9
    }
  } as unknown as ForgeSnapshot;
}

function attentionPayload(items = true) {
  return {
    generatedAt: "2026-08-01T12:00:00.000Z",
    state: "active",
    total: items ? 1 : 0,
    offset: 0,
    limit: 6,
    hasMore: false,
    summary: {
      activeCount: items ? 1 : 0,
      snoozedCount: 0,
      dismissedCount: 0,
      blockingCount: 0,
      importantCount: items ? 1 : 0,
      sourceCounts: {
        approval: 0,
        insight: 0,
        task: items ? 1 : 0,
        companion_sync: 0,
        agent_session: 0
      }
    },
    items: items
      ? [
          {
            id: "attention_task",
            source: "task",
            kind: "overdue_work",
            severity: "important",
            state: "active",
            title: "Review the overdue task",
            reason: "It is overdue.",
            detail: "Choose what comes next.",
            target: {
              entityType: "task",
              entityId: "task_overdue",
              label: "Open task",
              href: "/tasks/task_overdue"
            },
            allowedActions: ["open"],
            primaryAction: {
              key: "review_due_work",
              label: "Review due work",
              href: "/tasks/task_overdue",
              sourceRef: "task:task_overdue",
              resolutionCondition:
                "Resolved when the task is complete or no longer overdue."
            },
            createdAt: "2026-08-01T11:00:00.000Z",
            updatedAt: "2026-08-01T11:00:00.000Z",
            sourceUpdatedAt: "2026-08-01T11:00:00.000Z",
            dueAt: null,
            snoozedUntil: null,
            metadata: {}
          }
        ]
      : []
  };
}

function shell(
  snapshot = createSnapshot(),
  profile: "operator" | "standard" = "standard"
) {
  return {
    snapshot,
    operatorSession: { profile },
    selectedUserIds: ["user_operator"],
    refresh: vi.fn(),
    createGoal: vi.fn(),
    createProject: vi.fn(),
    createTask: vi.fn()
  };
}

function renderOverview() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("OverviewPage", () => {
  beforeEach(() => {
    useForgeShellMock.mockReturnValue(shell());
    useGetForgeXpDefaults();
    useGetForgeDoctorQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false
    });
    getAttentionInboxMock.mockResolvedValue(attentionPayload());
    getSleepViewMock.mockResolvedValue({
      sleep: {
        summary: {
          totalSleepSeconds: 25_200,
          averageSleepSeconds: 25_200,
          averageSleepScore: 82
        }
      }
    });
    getFitnessViewMock.mockResolvedValue({
      fitness: { summary: { workoutCount: 3, exerciseMinutes: 150 } }
    });
    getMovementDayMock.mockResolvedValue({
      movement: { summary: { totalMovingSeconds: 3_600 }, segments: [] }
    });
    getVitalsViewMock.mockResolvedValue({
      vitals: { summary: { metricCount: 1 }, metrics: [] }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function useGetForgeXpDefaults() {
    useGetXpMetricsQueryMock.mockReturnValue({
      data: undefined,
      isError: false
    });
  }

  it("builds a contract-complete XP fallback", () => {
    const fallback = buildOverviewXpFallback(createSnapshot());
    expect(fallback.scope.label).toBe("Albert");
    expect(fallback.dailyAmbientCap).toBe(12);
  });

  it("states the page purpose and exposes the five first actions", () => {
    renderOverview();
    expect(
      screen.getByRole("heading", { name: "Overview", level: 1 })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "See what needs attention, continue current work, or open any part of Forge."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Search Forge" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Attention" })).toHaveAttribute(
      "href",
      "/attention"
    );
    expect(screen.getByRole("link", { name: "Continue work" })).toHaveAttribute(
      "href",
      "/workbench"
    );
    expect(screen.getByRole("link", { name: "Explore Forge" })).toHaveAttribute(
      "href",
      "#forge-map"
    );
    expect(
      screen.getByRole("link", { name: /Daily briefing/i })
    ).toHaveAttribute("href", "/today#daily-briefing");
  });

  it("maps every supported production destination and excludes non-entities", () => {
    renderOverview();
    const hrefs = [...document.querySelectorAll("a")].map((link) =>
      link.getAttribute("href")
    );
    const configuredHrefs = FORGE_OVERVIEW_GROUPS.flatMap((group) => [
      ...group.destinations.map((destination) => destination.href),
      ...(group.advanced?.destinations.map((destination) => destination.href) ??
        [])
    ]);
    expect(new Set(configuredHrefs).size).toBe(configuredHrefs.length);
    for (const group of FORGE_OVERVIEW_GROUPS) {
      expect(
        screen.getByRole("heading", { name: group.title, level: 3 })
      ).toBeInTheDocument();
      for (const destination of [
        ...group.destinations,
        ...(group.advanced?.destinations ?? [])
      ]) {
        expect(hrefs).toContain(destination.href);
      }
    }
    expect(hrefs).not.toContain("/settings/mobile/lab");
    expect(hrefs).not.toContain("/campaigns");
  });

  it("uses the scoped Attention contract and links exact items", async () => {
    renderOverview();
    await waitFor(() =>
      expect(getAttentionInboxMock).toHaveBeenCalledWith({
        state: "active",
        limit: 6,
        userIds: ["user_operator"]
      })
    );
    expect(
      await screen.findByRole("link", { name: /Review the overdue task/ })
    ).toHaveAttribute("href", "/tasks/task_overdue");
  });

  it("routes active-run actions to the running task instead of the ranked top task", () => {
    const snapshot = createSnapshot();
    snapshot.activeTaskRuns = [
      {
        id: "run_active",
        taskId: "task_running",
        taskTitle: "Work already in progress"
      } as ForgeSnapshot["activeTaskRuns"][number]
    ];
    useForgeShellMock.mockReturnValue(shell(snapshot));
    renderOverview();

    expect(
      screen.getByRole("link", {
        name: /Current work Work already in progress/
      })
    ).toHaveAttribute("href", "/tasks/task_running");
    expect(
      screen.getByRole("link", {
        name: /Active task run Work already in progress/
      })
    ).toHaveAttribute("href", "/tasks/task_running");
  });

  it("shows truthful empty and permission-limited states", async () => {
    getAttentionInboxMock.mockResolvedValue(attentionPayload(false));
    renderOverview();
    expect(
      await screen.findByText("No items need attention")
    ).toBeInTheDocument();
    expect(screen.getByText("Permission required")).toBeInTheDocument();
    expect(useGetForgeDoctorQueryMock).toHaveBeenCalledWith(undefined, {
      skip: true
    });
  });

  it("names loading states without showing invented counts", () => {
    getAttentionInboxMock.mockReturnValue(new Promise(() => undefined));
    useForgeShellMock.mockReturnValue(shell(createSnapshot(), "operator"));
    useGetForgeDoctorQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false
    });
    renderOverview();
    expect(screen.getByText("Checking current attention")).toBeInTheDocument();
    expect(screen.getByText("Checking…")).toBeInTheDocument();
    expect(
      screen.getByText("System health is being checked")
    ).toBeInTheDocument();
    expect(screen.queryByText("0 active")).not.toBeInTheDocument();
  });

  it("shows the canonical Doctor score for an operator", () => {
    useForgeShellMock.mockReturnValue(shell(createSnapshot(), "operator"));
    useGetForgeDoctorQueryMock.mockReturnValue({
      data: {
        doctor: {
          integrity: {
            score: 96,
            status: "healthy",
            headline: "Forge is healthy"
          }
        }
      },
      isLoading: false,
      isError: false
    });
    renderOverview();
    expect(screen.getByText("96/100")).toBeInTheDocument();
    expect(screen.getByText("Forge is healthy")).toBeInTheDocument();
    expect(useGetForgeDoctorQueryMock).toHaveBeenCalledWith(undefined, {
      skip: false
    });
  });

  it("keeps Settings reachable when the Doctor report fails", () => {
    useForgeShellMock.mockReturnValue(shell(createSnapshot(), "operator"));
    useGetForgeDoctorQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true
    });
    renderOverview();
    expect(
      screen.getByRole("link", { name: /System health Unavailable/ })
    ).toHaveAttribute("href", "/settings");
    expect(
      screen.getByText("Health details could not be loaded")
    ).toBeInTheDocument();
  });

  it("keeps the map available when Attention fails", async () => {
    getAttentionInboxMock.mockRejectedValue(new Error("offline"));
    renderOverview();
    expect(
      await screen.findByText(
        "Attention could not be loaded. Other Forge areas are still available."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Everything in Forge", level: 2 })
    ).toBeInTheDocument();
  });

  it("opens global search through the established keyboard contract", () => {
    let searchEventSeen = false;
    let searchModifierSeen = false;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "k") {
        searchEventSeen = true;
        searchModifierSeen = event.metaKey || event.ctrlKey;
      }
    };
    window.addEventListener("keydown", listener);
    renderOverview();
    fireEvent.click(screen.getByRole("button", { name: "Search Forge" }));
    window.removeEventListener("keydown", listener);
    expect(searchEventSeen).toBe(true);
    expect(searchModifierSeen).toBe(true);
  });

  it("keeps core navigation visible and secondary detail optional", () => {
    renderOverview();
    for (const id of ["hero", "gamification", "what-matters", "forge-map"]) {
      expect(screen.getByTestId(`overview-widget-${id}`)).toHaveAttribute(
        "data-default-hidden",
        "false"
      );
    }
    for (const id of ["summary", "pipeline", "goals", "life-force"]) {
      expect(screen.getByTestId(`overview-widget-${id}`)).toHaveAttribute(
        "data-default-hidden",
        "true"
      );
    }
  });

  it("links every health summary even when a feed is unavailable", async () => {
    getSleepViewMock.mockRejectedValue(new Error("sleep unavailable"));
    renderOverview();
    const sleepLink = await screen.findByRole("link", {
      name: /Sleep Unavailable/
    });
    expect(sleepLink).toHaveAttribute("href", "/sleep");
    for (const [name, href] of [
      [/Sports/, "/sports"],
      [/Vitals/, "/vitals"],
      [/Movement/, "/movement"]
    ] as const) {
      expect(
        screen
          .getAllByRole("link", { name })
          .some((link) => link.getAttribute("href") === href)
      ).toBe(true);
    }
  });
});
