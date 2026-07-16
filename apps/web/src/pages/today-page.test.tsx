import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LifeForcePayload,
  Task,
  TaskTimebox,
  TodayPriorityDecision,
  TodayPriorityEvidence,
  TodayRankedCandidate
} from "@/lib/types";
import { TodayPage } from "@/pages/today-page";

const { useForgeShellMock, useQueryMock } = vi.hoisted(() => ({
  useForgeShellMock: vi.fn(),
  useQueryMock: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query"
  );
  return { ...actual, useQuery: useQueryMock };
});

vi.mock("@/components/customization/ai-surface-workspace", () => ({
  AiSurfaceWorkspace: ({
    baseWidgets
  }: {
    baseWidgets: Array<{
      id: string;
      render: (input: {
        compact: boolean;
        width: number;
        editing: boolean;
        preferences: {
          hidden: boolean;
          fullWidth: boolean;
          titleVisible: boolean;
          descriptionVisible: boolean;
        };
      }) => React.ReactNode;
    }>;
  }) => (
    <div>
      {baseWidgets
        .filter((widget) =>
          ["priority", "runway", "calendar"].includes(widget.id)
        )
        .map((widget) => (
          <div key={widget.id} data-testid={`widget-${widget.id}`}>
            {widget.render({
              compact: false,
              width: 12,
              editing: false,
              preferences: {
                hidden: false,
                fullWidth: false,
                titleVisible: true,
                descriptionVisible: true
              }
            })}
          </div>
        ))}
    </div>
  )
}));

vi.mock("@/components/workbench-boxes/today/today-boxes", () => ({
  TodayHeroBox: ({ children }: { children: React.ReactNode }) => children,
  TodayMetricsBox: ({ children }: { children: React.ReactNode }) => children,
  TodayRunwayBox: ({ children }: { children: React.ReactNode }) => children,
  TodayCalendarBox: ({ children }: { children: React.ReactNode }) => children,
  TodayFocusBox: ({ children }: { children: React.ReactNode }) => children
}));

vi.mock("@/components/daily-runway", () => ({
  DailyRunway: ({
    tasks,
    selectedTaskId
  }: {
    tasks: Task[];
    selectedTaskId: string | null;
  }) => (
    <div>
      <div>Runway order: {tasks.map((task) => task.title).join(", ")}</div>
      <div>Selected task: {selectedTaskId ?? "none"}</div>
    </div>
  )
}));

const NOW = new Date();
const FRESH = NOW.toISOString();

afterEach(cleanup);

function dateKey(date: Date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function offsetDateKey(days: number) {
  const date = new Date(NOW);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: `${id} description`,
    level: "task",
    status: "backlog",
    priority: "medium",
    owner: "Albert",
    goalId: null,
    projectId: null,
    parentWorkItemId: null,
    dueDate: null,
    effort: "light",
    energy: "steady",
    points: 10,
    plannedDurationSeconds: 1_800,
    schedulingRules: null,
    sortOrder: 0,
    aiInstructions: "",
    executionMode: null,
    acceptanceCriteria: [],
    blockerLinks: [],
    completionReport: null,
    gitRefs: [],
    completedAt: null,
    createdAt: FRESH,
    updatedAt: FRESH,
    tagIds: [],
    time: {
      totalTrackedSeconds: 0,
      totalCreditedSeconds: 0,
      liveTrackedSeconds: 0,
      liveCreditedSeconds: 0,
      manualAdjustedSeconds: 0,
      activeRunCount: 0,
      hasCurrentRun: false,
      currentRunId: null
    },
    ...overrides
  };
}

function makeLifeForce(): LifeForcePayload {
  return {
    userId: "user_albert",
    dateKey: dateKey(NOW),
    baselineDailyAp: 100,
    dailyBudgetAp: 100,
    spentTodayAp: 20,
    remainingAp: 60,
    forecastAp: 55,
    plannedRemainingAp: 50,
    targetBandMinAp: 10,
    targetBandMaxAp: 30,
    instantCapacityApPerHour: 20,
    instantFreeApPerHour: 12,
    overloadApPerHour: 0,
    currentDrainApPerHour: 8,
    fatigueBufferApPerHour: 2,
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
    updatedAt: FRESH
  };
}

function makeSnapshot(tasks: Task[]) {
  return {
    meta: { generatedAt: FRESH },
    metrics: {
      totalXp: 0,
      weeklyXp: 0,
      level: 1,
      currentLevelXp: 0,
      nextLevelXp: 100,
      momentumScore: 0,
      streakDays: 0
    },
    dashboard: { notesSummaryByEntity: {} },
    overview: { topTasks: tasks },
    today: {
      directive: { task: null },
      timeline: [],
      dueHabits: [],
      dailyQuests: [],
      milestoneRewards: []
    },
    risk: { blockedTasks: [], overdueTasks: [] },
    tasks,
    activeTaskRuns: [],
    goals: [],
    tags: [],
    users: []
  };
}

function calendarResult(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      calendar: {
        generatedAt: FRESH,
        providers: [],
        connections: [],
        calendars: [],
        events: [],
        workBlockTemplates: [],
        workBlockInstances: [],
        timeboxes: [] as TaskTimebox[]
      }
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function lifeForceResult(overrides: Record<string, unknown> = {}) {
  return {
    data: { lifeForce: makeLifeForce(), templates: [] },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

const priorityEvidence: TodayPriorityEvidence[] = [
  {
    key: "urgency",
    label: "Urgency",
    state: "fresh",
    detail: "Urgency is current."
  },
  {
    key: "schedule",
    label: "Schedule",
    state: "fresh",
    detail: "Schedule is current."
  },
  {
    key: "capacity",
    label: "Capacity",
    state: "fresh",
    detail: "Capacity is current."
  },
  {
    key: "active-context",
    label: "Active context",
    state: "fresh",
    detail: "Active context is current."
  }
];

function makePriorityCandidate(
  task: Task,
  score: number,
  reason = "It is the strongest current candidate."
): TodayRankedCandidate {
  return {
    task,
    score,
    urgencyScore: score,
    scheduleScore: 0,
    capacityScore: 0,
    activeContextScore: 0,
    hasActiveRun: false,
    capacityFit: true,
    requiredAp: 12,
    requiredApEstimated: true,
    timebox: null,
    evidence: priorityEvidence,
    reason
  };
}

function makePriorityDecision(
  tasks: Task[],
  overrides: Partial<TodayPriorityDecision> = {}
): TodayPriorityDecision {
  const candidates = tasks.map((task, index) =>
    makePriorityCandidate(task, 100 - index)
  );
  const selectedCandidate = candidates[0] ?? null;
  return {
    contractVersion: 1,
    generatedAt: FRESH,
    mode: selectedCandidate ? "ready" : "no-work",
    confidence: "full",
    decisionUserId: "user_albert",
    task: selectedCandidate?.task ?? null,
    activeRun: null,
    activeRunCount: 0,
    summary: selectedCandidate
      ? "The current signals agree on one next task."
      : "No open, startable work is available.",
    rankedCandidates: candidates,
    selectedCandidate,
    alternatives: candidates.slice(1, 4),
    evidence: priorityEvidence,
    blockedTaskCount: 0,
    needsRefresh: false,
    isLoading: false,
    ...overrides
  };
}

function priorityResult(
  decision: TodayPriorityDecision | null,
  overrides: Record<string, unknown> = {}
) {
  return {
    data: decision ? { decision } : undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function queryResultFor(
  queryKey: string[],
  input: {
    calendar?: ReturnType<typeof calendarResult>;
    lifeForce?: ReturnType<typeof lifeForceResult>;
    priority: ReturnType<typeof priorityResult>;
  }
) {
  if (queryKey[0] === "forge-calendar-overview") {
    return input.calendar ?? calendarResult();
  }
  if (queryKey[0] === "forge-life-force") {
    return input.lifeForce ?? lifeForceResult();
  }
  return input.priority;
}

describe("TodayPage priority integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the server decision for both the recommendation and runway", () => {
    const oversized = makeTask("oversized", {
      title: "Oversized task",
      priority: "critical",
      dueDate: offsetDateKey(-1),
      actionPointSummary: {
        costBand: "brutal",
        totalCostAp: 100,
        expectedDurationSeconds: 7_200,
        sustainRateApPerHour: 30,
        spentTodayAp: 0,
        spentTotalAp: 0,
        remainingAp: 100
      }
    });
    const scheduled = makeTask("scheduled", {
      title: "Scheduled task",
      status: "focus",
      priority: "high",
      dueDate: offsetDateKey(1),
      actionPointSummary: {
        costBand: "light",
        totalCostAp: 10,
        expectedDurationSeconds: 1_800,
        sustainRateApPerHour: 8,
        spentTodayAp: 0,
        spentTotalAp: 0,
        remainingAp: 10
      }
    });
    const decision = makePriorityDecision([scheduled, oversized]);
    decision.selectedCandidate!.reason = "Its task timebox is active now.";

    useForgeShellMock.mockReturnValue({
      snapshot: makeSnapshot([oversized, scheduled]),
      selectedUserIds: ["user_albert"],
      startTaskNow: vi.fn().mockResolvedValue(undefined),
      patchTaskStatus: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined)
    });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) =>
      queryResultFor(queryKey, { priority: priorityResult(decision) })
    );

    render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Scheduled task")).toBeInTheDocument();
    expect(
      screen.getByText("Runway order: Scheduled task, Oversized task")
    ).toBeInTheDocument();
    expect(screen.getByText("Selected task: scheduled")).toBeInTheDocument();
    expect(screen.getByText(/task timebox is active now/i)).toBeInTheDocument();
  });

  it("does not fabricate a client ranking while the server decision loads", () => {
    const task = makeTask("available", { title: "Available task" });
    useForgeShellMock.mockReturnValue({
      snapshot: makeSnapshot([task]),
      selectedUserIds: ["user_albert"],
      startTaskNow: vi.fn().mockResolvedValue(undefined),
      patchTaskStatus: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined)
    });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) =>
      queryResultFor(queryKey, {
        calendar: calendarResult({ data: undefined, isLoading: true }),
        lifeForce: lifeForceResult({ data: undefined, isLoading: true }),
        priority: priorityResult(null, { isLoading: true })
      })
    );

    render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Loading next useful work")).toBeInTheDocument();
    expect(screen.getByText("Loading today's calendar.")).toBeInTheDocument();
    expect(screen.getByText("Runway order:")).toBeInTheDocument();
    expect(screen.queryByText("Available task")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Loading next useful work" })
    ).toHaveAttribute("aria-busy", "true");
  });

  it("shows a calendar retry without suppressing urgency-based ranking", () => {
    const task = makeTask("offline-calendar", {
      title: "Urgent offline-calendar task",
      priority: "critical",
      dueDate: offsetDateKey(0)
    });
    useForgeShellMock.mockReturnValue({
      snapshot: makeSnapshot([task]),
      selectedUserIds: ["user_albert"],
      startTaskNow: vi.fn().mockResolvedValue(undefined),
      patchTaskStatus: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined)
    });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) =>
      queryResultFor(queryKey, {
        calendar: calendarResult({ data: undefined, isError: true }),
        priority: priorityResult(makePriorityDecision([task]))
      })
    );

    render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>
    );

    expect(
      screen.getByText("Urgent offline-calendar task")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry calendar" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Today decision still uses saved task timeboxes/i)
    ).toBeInTheDocument();
  });

  it("withholds runway start controls when no open task fits capacity", () => {
    const task = makeTask("too-large", {
      title: "Task too large for today",
      actionPointSummary: {
        costBand: "heavy",
        totalCostAp: 80,
        expectedDurationSeconds: 7_200,
        sustainRateApPerHour: 20,
        spentTodayAp: 0,
        spentTotalAp: 0,
        remainingAp: 80
      }
    });
    useForgeShellMock.mockReturnValue({
      snapshot: makeSnapshot([task]),
      selectedUserIds: ["user_albert"],
      startTaskNow: vi.fn().mockResolvedValue(undefined),
      patchTaskStatus: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined)
    });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) =>
      queryResultFor(queryKey, {
        lifeForce: lifeForceResult({
          data: {
            lifeForce: {
              ...makeLifeForce(),
              remainingAp: 20,
              plannedRemainingAp: 20
            },
            templates: []
          }
        }),
        priority: priorityResult(
          makePriorityDecision([task], {
            mode: "capacity-limited",
            task: null,
            selectedCandidate: null,
            alternatives: [makePriorityCandidate(task, 50)],
            summary: "No open task fits the remaining AP budget."
          })
        )
      })
    );

    render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>
    );

    expect(screen.getByText("No task fits capacity")).toBeInTheDocument();
    expect(screen.getByText("Runway order:")).toBeInTheDocument();
    expect(screen.getByText("Selected task: none")).toBeInTheDocument();
  });
});
