import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OverviewPage } from "@/pages/overview-page";
import type { ForgeSnapshot } from "@/lib/types";

const { useForgeShellMock } = vi.hoisted(() => ({
  useForgeShellMock: vi.fn()
}));
const { LifeForceOverviewWorkspaceMock } = vi.hoisted(() => ({
  LifeForceOverviewWorkspaceMock: vi.fn(() => <div>Life Force workspace</div>)
}));
const {
  getSleepViewMock,
  getFitnessViewMock,
  getMovementDayMock,
  getVitalsViewMock
} = vi.hoisted(() => ({
  getSleepViewMock: vi.fn(),
  getFitnessViewMock: vi.fn(),
  getMovementDayMock: vi.fn(),
  getVitalsViewMock: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/lib/api", () => ({
  getSleepView: (...args: unknown[]) => getSleepViewMock(...args),
  getFitnessView: (...args: unknown[]) => getFitnessViewMock(...args),
  getMovementDay: (...args: unknown[]) => getMovementDayMock(...args),
  getVitalsView: (...args: unknown[]) => getVitalsViewMock(...args)
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
  beforeEach(() => {
    getSleepViewMock.mockResolvedValue({
      sleep: {
        summary: {
          totalSleepSeconds: 0,
          averageSleepSeconds: 7.4 * 3600,
          averageTimeInBedSeconds: 8 * 3600,
          averageSleepScore: 84,
          averageRegularityScore: 78,
          averageEfficiency: 0.92,
          averageRestorativeShare: 0.44,
          reflectiveNightCount: 2,
          linkedNightCount: 1,
          averageBedtimeConsistencyMinutes: 28,
          averageWakeConsistencyMinutes: 22,
          latestBedtime: "2026-04-12T22:30:00.000Z",
          latestWakeTime: "2026-04-13T06:45:00.000Z"
        },
        weeklyTrend: [],
        monthlyPattern: [],
        stageAverages: [],
        linkBreakdown: [],
        sessions: []
      }
    });
    getFitnessViewMock.mockResolvedValue({
      fitness: {
        summary: {
          workoutCount: 3,
          weeklyVolumeSeconds: 10_800,
          exerciseMinutes: 185,
          energyBurnedKcal: 1200,
          distanceMeters: 18_000,
          workoutTypes: ["Run", "Ride"],
          averageSessionMinutes: 61.7,
          averageEffort: 7,
          linkedSessionCount: 2,
          plannedSessionCount: 1,
          importedSessionCount: 3,
          habitGeneratedSessionCount: 0,
          reconciledSessionCount: 3,
          topWorkoutType: "Run",
          streakDays: 2
        },
        weeklyTrend: [],
        typeBreakdown: [],
        sessions: []
      }
    });
    getMovementDayMock.mockResolvedValue({
      movement: {
        date: "2026-04-12",
        settings: {
          userId: "user_operator",
          trackingEnabled: true,
          publishMode: "auto_publish",
          retentionMode: "keep_recent_raw",
          locationPermissionStatus: "authorized",
          motionPermissionStatus: "authorized",
          backgroundTrackingReady: true,
          lastCompanionSyncAt: "2026-04-12T10:00:00.000Z",
          metadata: {},
          createdAt: "2026-04-12T10:00:00.000Z",
          updatedAt: "2026-04-12T10:00:00.000Z",
          knownPlaceCount: 2
        },
        summary: {
          totalDistanceMeters: 14_200,
          totalMovingSeconds: 3_600,
          totalIdleSeconds: 0,
          tripCount: 2,
          stayCount: 2,
          missingCount: 0,
          missingDurationSeconds: 0,
          repairedGapCount: 0,
          repairedGapDurationSeconds: 0,
          continuedStayCount: 0,
          continuedStayDurationSeconds: 0,
          knownPlaceCount: 2,
          caloriesKcal: 0,
          estimatedScreenTimeSeconds: 0,
          pickupCount: 0,
          averageSpeedMps: 1.8
        },
        segments: [
          {
            id: "seg_work",
            boxId: "box_work",
            kind: "stay",
            sourceKind: "automatic",
            origin: "recorded",
            editable: false,
            startedAt: "2026-04-12T07:00:00.000Z",
            endedAt: "2026-04-12T18:00:00.000Z",
            trueStartedAt: "2026-04-12T07:00:00.000Z",
            trueEndedAt: "2026-04-12T18:00:00.000Z",
            visibleStartedAt: "2026-04-12T07:00:00.000Z",
            visibleEndedAt: "2026-04-12T18:00:00.000Z",
            durationSeconds: 39_600,
            label: "Work",
            subtitle: "Office",
            distanceMeters: 0,
            averageSpeedMps: 0,
            estimatedScreenTimeSeconds: 0,
            pickupCount: 0,
            colorTone: "blue",
            noteCount: 0,
            overrideCount: 0,
            overriddenAutomaticBoxIds: [],
            overriddenUserBoxIds: [],
            isFullyHidden: false,
            rawStayIds: [],
            rawTripIds: [],
            rawPointCount: 0,
            hasLegacyCorrections: false
          },
          {
            id: "seg_home",
            boxId: "box_home",
            kind: "stay",
            sourceKind: "automatic",
            origin: "recorded",
            editable: false,
            startedAt: "2026-04-12T18:30:00.000Z",
            endedAt: "2026-04-13T00:30:00.000Z",
            trueStartedAt: "2026-04-12T18:30:00.000Z",
            trueEndedAt: "2026-04-13T00:30:00.000Z",
            visibleStartedAt: "2026-04-12T18:30:00.000Z",
            visibleEndedAt: "2026-04-13T00:30:00.000Z",
            durationSeconds: 21_600,
            label: "Home",
            subtitle: "Apartment",
            distanceMeters: 0,
            averageSpeedMps: 0,
            estimatedScreenTimeSeconds: 0,
            pickupCount: 0,
            colorTone: "green",
            noteCount: 0,
            overrideCount: 0,
            overriddenAutomaticBoxIds: [],
            overriddenUserBoxIds: [],
            isFullyHidden: false,
            rawStayIds: [],
            rawTripIds: [],
            rawPointCount: 0,
            hasLegacyCorrections: false
          }
        ],
        stays: [],
        trips: [],
        places: [],
        selectionAggregate: {
          startedAt: "2026-04-12T07:00:00.000Z",
          endedAt: "2026-04-13T00:30:00.000Z",
          durationSeconds: 64_800,
          distanceMeters: 14_200,
          caloriesKcal: 0,
          averageSpeedMps: 1.8,
          stayCount: 2,
          tripCount: 2,
          noteCount: 0,
          taskRunCount: 0,
          trackedWorkSeconds: 0,
          placeLabels: ["Work", "Home"],
          tags: [],
          estimatedScreenTimeSeconds: 0,
          pickupCount: 0,
          notificationCount: 0,
          topApps: [],
          topCategories: []
        }
      }
    });
    getVitalsViewMock.mockResolvedValue({
      vitals: {
        summary: {
          trackedDays: 7,
          metricCount: 4,
          latestDateKey: "2026-04-12",
          latestMetricCount: 4,
          categoryBreakdown: [
            { category: "recovery", metricCount: 2, coverageDays: 7 },
            { category: "cardio", metricCount: 1, coverageDays: 4 },
            { category: "activity", metricCount: 1, coverageDays: 7 }
          ]
        },
        metrics: [
          {
            metric: "restingHeartRate",
            label: "Resting heart rate",
            category: "recovery",
            unit: "bpm",
            aggregation: "discrete",
            latestValue: 54,
            latestDateKey: "2026-04-12",
            baselineValue: 56,
            deltaValue: -2,
            coverageDays: 7,
            days: []
          },
          {
            metric: "heartRateVariabilitySDNN",
            label: "HRV (SDNN)",
            category: "recovery",
            unit: "ms",
            aggregation: "discrete",
            latestValue: 62,
            latestDateKey: "2026-04-12",
            baselineValue: 58,
            deltaValue: 4,
            coverageDays: 7,
            days: []
          }
        ]
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
    expect(screen.getAllByText("Life Force").length).toBeGreaterThan(0);
    expect(screen.getByText("132 / 214 AP")).toBeInTheDocument();
    expect(screen.getByText("Instant")).toBeInTheDocument();
    expect(screen.getAllByText("6.9 AP/h").length).toBeGreaterThan(0);
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

  it("shows live health and movement metrics when those feeds are available", async () => {
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

    expect(
      await screen.findByText("Recovery, training, and vitals")
    ).toBeInTheDocument();
    expect(screen.getByText("Average sleep")).toBeInTheDocument();
    expect(screen.getByText("7.4h")).toBeInTheDocument();
    expect(screen.getByText("185 min")).toBeInTheDocument();
    expect(screen.getByText("Resting heart rate")).toBeInTheDocument();
    expect(screen.getByText("54.0 bpm")).toBeInTheDocument();
    expect(screen.getByText("Today's place balance")).toBeInTheDocument();
    expect(screen.getByText("11h at Work")).toBeInTheDocument();
    expect(screen.getByText("6h at Home")).toBeInTheDocument();
    expect(screen.getAllByText("1h moving").length).toBeGreaterThan(0);
  });
});
