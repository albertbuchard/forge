import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OverviewPage } from "@/pages/overview-page";
import type { ForgeSnapshot } from "@/lib/types";

const { useForgeShellMock } = vi.hoisted(() => ({
  useForgeShellMock: vi.fn()
}));
const { LifeForceOverviewWorkspaceMock } = vi.hoisted(() => ({
  LifeForceOverviewWorkspaceMock: vi.fn(() => <div>Life Force workspace</div>)
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/components/customization/ai-surface-workspace", () => ({
  AiSurfaceWorkspace: ({
    baseWidgets
  }: {
    baseWidgets: Array<{ id: string; render: (args: { compact: boolean }) => ReactNode }>;
  }) => (
    <div>
      {baseWidgets.map((widget) => (
        <section key={widget.id}>{widget.render({ compact: false })}</section>
      ))}
    </div>
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
    <div>
      <div>{title}</div>
      <div>{description}</div>
      {badge ? <div>{badge}</div> : null}
      {actions}
    </div>
  )
}));

vi.mock("@/components/life-force/life-force-workspace", () => ({
  LifeForceOverviewWorkspace: LifeForceOverviewWorkspaceMock
}));

vi.mock("@/components/experience/flagship-signal-deck", () => ({
  FlagshipSignalDeck: () => <div>Signals</div>
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
    meta: {
      apiVersion: "v1",
      transport: "rest+sse",
      generatedAt: "2026-04-12T10:00:00.000Z",
      backend: "node",
      mode: "transitional-node"
    },
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
      achievements: [],
      milestoneRewards: [],
      recentActivity: []
    },
    overview: {
      generatedAt: "2026-04-12T10:00:00.000Z",
      strategicHeader: {
        streakDays: 9,
        level: 7,
        totalXp: 1800,
        currentLevelXp: 48,
        nextLevelXp: 100,
        momentumScore: 82,
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
      generatedAt: "2026-04-12T10:00:00.000Z",
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
        streakDays: 9,
        momentumScore: 82,
        recoveryHint: ""
      }
    },
    risk: {
      generatedAt: "2026-04-12T10:00:00.000Z",
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
      dateKey: "2026-04-12",
      baselineDailyAp: 200,
      dailyBudgetAp: 214,
      spentTodayAp: 132,
      remainingAp: 82,
      forecastAp: 198,
      plannedRemainingAp: 66,
      targetBandMinAp: 181.9,
      targetBandMaxAp: 214,
      instantCapacityApPerHour: 11.5,
      instantFreeApPerHour: 6.9,
      overloadApPerHour: 0,
      currentDrainApPerHour: 4.6,
      fatigueBufferApPerHour: 1.2,
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
      updatedAt: "2026-04-12T10:00:00.000Z"
    }
  };
}

describe("OverviewPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("puts Life Force next to XP and momentum in the top hero surface", () => {
    useForgeShellMock.mockReturnValue({
      snapshot: createSnapshot(),
      selectedUserIds: [],
      refresh: vi.fn()
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false }
      }
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByText("Momentum 82")).toBeInTheDocument();
    expect(screen.getByText("Life Force")).toBeInTheDocument();
    expect(screen.getByText("132 / 214 AP")).toBeInTheDocument();
    expect(screen.getByText("Instant")).toBeInTheDocument();
    expect(screen.getByText("6.9 AP/h")).toBeInTheDocument();
    expect(screen.getAllByText("Weekly XP").length).toBeGreaterThan(0);
    expect(screen.getAllByText("126").length).toBeGreaterThan(0);
  });

  it("keeps the momentum summary above the action signals block", () => {
    useForgeShellMock.mockReturnValue({
      snapshot: createSnapshot(),
      selectedUserIds: [],
      refresh: vi.fn()
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false }
      }
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const summaryHeading = screen.getAllByText("Core live metrics")[0]!;
    const signalsHeading = screen.getByText("Signals");
    expect(
      summaryHeading.compareDocumentPosition(signalsHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("renders the overview Life Force surface in compact mode", () => {
    useForgeShellMock.mockReturnValue({
      snapshot: createSnapshot(),
      selectedUserIds: [],
      refresh: vi.fn()
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false }
      }
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(LifeForceOverviewWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ showEditor: false }),
      undefined
    );
  });
});
