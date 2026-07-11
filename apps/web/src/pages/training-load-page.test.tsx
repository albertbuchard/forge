import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingLoadPage } from "@/pages/training-load-page";
import type { TrainingLoadViewData } from "@/lib/types";

const { useForgeShellMock, getTrainingLoadViewMock } = vi.hoisted(() => ({
  useForgeShellMock: vi.fn(),
  getTrainingLoadViewMock: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
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
      {actions ? <div>{actions}</div> : null}
    </div>
  )
}));

vi.mock("@/components/experience/surface-skeleton", () => ({
  SurfaceSkeleton: () => <div>Loading training load</div>
}));

vi.mock("@/components/ui/page-state", () => ({
  ErrorState: ({ error }: { error: Error }) => <div>{error.message}</div>
}));

vi.mock("@/lib/api", () => ({
  getTrainingLoadView: (...args: unknown[]) => getTrainingLoadViewMock(...args)
}));

vi.mock("recharts", () => {
  const Chart = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  const Primitive = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Area: Primitive,
    AreaChart: Chart,
    Bar: Primitive,
    BarChart: Chart,
    CartesianGrid: Primitive,
    Cell: Primitive,
    ComposedChart: Chart,
    Line: Primitive,
    PolarAngleAxis: Primitive,
    PolarGrid: Primitive,
    Radar: Primitive,
    RadarChart: Chart,
    ResponsiveContainer: Chart,
    Tooltip: Primitive,
    XAxis: Primitive,
    YAxis: Primitive
  };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TrainingLoadPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function createTrainingLoad(): TrainingLoadViewData {
  return {
    summary: {
      sessionCount: 12,
      reliableSessionCount: 9,
      totalHours: 18.4,
      totalTrainingLoad: 1020,
      acuteLoad7d: 280,
      chronicWeeklyLoad28d: 240,
      acuteChronicRatio: 1.17,
      monotony7d: 1.2,
      strain7d: 336,
      highIntensityMinutes7d: 52,
      thresholdMinutes7d: 95,
      easyMinutes7d: 130,
      hardDayCount7d: 2,
      averageHeartRateCoverage: 0.94,
      vo2MaxLatest: 40.4,
      vo2MaxDelta: 2.1,
      latestRestingHeartRate: 59,
      readiness: "productive"
    },
    zoneTotals: [
      { key: "below_z1", label: "Below Z1", seconds: 3600, percentage: 0.2 },
      { key: "zone_1", label: "Zone 1", seconds: 1800, percentage: 0.1 },
      { key: "zone_2", label: "Zone 2", seconds: 3600, percentage: 0.2 },
      { key: "zone_3", label: "Zone 3", seconds: 3600, percentage: 0.2 },
      { key: "zone_4", label: "Zone 4", seconds: 2700, percentage: 0.15 },
      { key: "zone_5", label: "Zone 5", seconds: 2700, percentage: 0.15 }
    ],
    recentZoneTotals: [
      { key: "below_z1", label: "Below Z1", seconds: 1800, percentage: 0.15 },
      { key: "zone_1", label: "Zone 1", seconds: 1200, percentage: 0.1 },
      { key: "zone_2", label: "Zone 2", seconds: 2400, percentage: 0.2 },
      { key: "zone_3", label: "Zone 3", seconds: 2400, percentage: 0.2 },
      { key: "zone_4", label: "Zone 4", seconds: 2400, percentage: 0.2 },
      { key: "zone_5", label: "Zone 5", seconds: 1800, percentage: 0.15 }
    ],
    intensityDistribution: [
      {
        key: "low",
        label: "Low / base",
        seconds: 5400,
        percentage: 0.3,
        targetRange: [0.7, 0.85]
      },
      {
        key: "moderate",
        label: "Tempo / threshold",
        seconds: 7200,
        percentage: 0.4,
        targetRange: [0.05, 0.2]
      },
      {
        key: "high",
        label: "Severe / HIIT",
        seconds: 5400,
        percentage: 0.3,
        targetRange: [0.08, 0.18]
      }
    ],
    recentIntensityDistribution: [
      {
        key: "low",
        label: "Low / base",
        seconds: 3000,
        percentage: 0.25,
        targetRange: [0.7, 0.85]
      },
      {
        key: "moderate",
        label: "Tempo / threshold",
        seconds: 4800,
        percentage: 0.4,
        targetRange: [0.05, 0.2]
      },
      {
        key: "high",
        label: "Severe / HIIT",
        seconds: 4200,
        percentage: 0.35,
        targetRange: [0.08, 0.18]
      }
    ],
    dailyLoad: [
      {
        dateKey: "2026-05-20",
        sessionCount: 1,
        durationSeconds: 3600,
        durationMinutes: 60,
        trainingLoad: 80,
        highIntensitySeconds: 900,
        highIntensityMinutes: 15,
        moderateIntensitySeconds: 1500,
        moderateIntensityMinutes: 25,
        lowIntensitySeconds: 1200,
        lowIntensityMinutes: 20
      }
    ],
    weeklyLoad: [
      {
        weekKey: "2026-W21",
        startDate: "2026-05-18",
        endDate: "2026-05-24",
        sessionCount: 3,
        durationSeconds: 10_800,
        durationHours: 3,
        trainingLoad: 280,
        loadPerHour: 93.3,
        highIntensitySeconds: 3600,
        highIntensityMinutes: 60,
        moderateIntensitySeconds: 3600,
        lowIntensitySeconds: 3600,
        lowPercentage: 0.33,
        moderatePercentage: 0.33,
        highPercentage: 0.34
      }
    ],
    zoneTimeSeries: {
      daily: [
        {
          bucketKey: "2026-05-20",
          startDate: "2026-05-20",
          endDate: "2026-05-20",
          sessionCount: 1,
          durationSeconds: 3600,
          durationMinutes: 60,
          hrCoveredSeconds: 3600,
          trainingLoad: 80,
          loadPerHour: 80,
          loadPerMinute: 1.33,
          baselineLoadRatio: null,
          baselineIntensityRatio: null,
          zoneSeconds: {
            below_z1: 300,
            zone_1: 600,
            zone_2: 1200,
            zone_3: 600,
            zone_4: 600,
            zone_5: 300
          },
          zoneMinutes: {
            below_z1: 5,
            zone_1: 10,
            zone_2: 20,
            zone_3: 10,
            zone_4: 10,
            zone_5: 5
          },
          zonePercentages: {
            below_z1: 0.0833,
            zone_1: 0.1667,
            zone_2: 0.3333,
            zone_3: 0.1667,
            zone_4: 0.1667,
            zone_5: 0.0833
          },
          domainSeconds: { low: 900, moderate: 1800, high: 900 },
          domainMinutes: { low: 15, moderate: 30, high: 15 },
          domainPercentages: { low: 0.25, moderate: 0.5, high: 0.25 },
          hardDayCount: 1,
          averageHrCoverage: 0.94,
          heartRateSampleCount: 480,
          confidence: "high"
        }
      ],
      weekly: [
        {
          bucketKey: "2026-W21",
          startDate: "2026-05-18",
          endDate: "2026-05-24",
          sessionCount: 3,
          durationSeconds: 10_800,
          durationMinutes: 180,
          hrCoveredSeconds: 10_800,
          trainingLoad: 280,
          loadPerHour: 93.3,
          loadPerMinute: 1.56,
          baselineLoadRatio: 1.12,
          baselineIntensityRatio: 1.04,
          zoneSeconds: {
            below_z1: 1200,
            zone_1: 2400,
            zone_2: 3000,
            zone_3: 2400,
            zone_4: 1200,
            zone_5: 600
          },
          zoneMinutes: {
            below_z1: 20,
            zone_1: 40,
            zone_2: 50,
            zone_3: 40,
            zone_4: 20,
            zone_5: 10
          },
          zonePercentages: {
            below_z1: 0.1111,
            zone_1: 0.2222,
            zone_2: 0.2778,
            zone_3: 0.2222,
            zone_4: 0.1111,
            zone_5: 0.0556
          },
          domainSeconds: { low: 3600, moderate: 5400, high: 1800 },
          domainMinutes: { low: 60, moderate: 90, high: 30 },
          domainPercentages: { low: 0.3333, moderate: 0.5, high: 0.1667 },
          hardDayCount: 2,
          averageHrCoverage: 0.94,
          heartRateSampleCount: 1440,
          confidence: "high"
        }
      ],
      monthly: []
    },
    trainingIntelligence: {
      defaultMode: "combat_readiness",
      modes: [
        {
          key: "combat_readiness",
          label: "Combat readiness",
          score: 82,
          status: "on_target",
          confidence: "high",
          summary: "Combat readiness is mostly aligned.",
          drivers: ["Acute load is close to chronic base."],
          limitingFactors: ["Low/base work needs support."],
          loadBalance: {
            status: "maintain",
            acuteLoad7d: 280,
            chronicWeeklyLoad28d: 240,
            acuteChronicRatio: 1.17,
            monotony7d: 1.2,
            strain7d: 336,
            latestWeekLoad: 280,
            latestWeekLoadPerMinute: 1.56,
            latestWeekBaselineLoadRatio: 1.12,
            latestWeekBaselineIntensityRatio: 1.04
          },
          nextWeekTargets: {
            totalMinutesRange: [170, 195],
            zoneMinuteTargets: {
              below_z1: 42,
              zone_1: 78,
              zone_2: 28,
              zone_3: 15,
              zone_4: 14,
              zone_5: 5
            },
            domainMinuteTargets: {
              low: [112, 140],
              moderate: [18, 40],
              high: [11, 29]
            },
            maxHardSessions: 2,
            minimumEasyMinutes: 112,
            warning: null
          },
          nextWorkout: {
            recommendedType: "zone_2_base",
            intensityCeiling: "Z3",
            durationMinutesRange: [45, 75],
            fourByFourAppropriate: false,
            reason: "Base session fits the current distribution better."
          },
          methodologyNotes: ["ACWR is a monitoring flag, not a diagnosis."]
        }
      ]
    },
    activityBreakdown: [
      {
        workoutType: "kickboxing",
        workoutTypeLabel: "Kickboxing",
        activityFamily: "combat",
        activityFamilyLabel: "Combat",
        sessionCount: 8,
        durationHours: 10,
        trainingLoad: 700,
        loadPerHour: 70,
        highPercentage: 0.36,
        averageHrCoverage: 0.98
      }
    ],
    vitalsTrend: [
      { dateKey: "2026-05-19", restingHeartRate: 64, vo2Max: 41.2 }
    ],
    sessionSignals: [
      {
        id: "workout_1",
        dateKey: "2026-05-20",
        startedAt: "2026-05-20T17:00:00.000Z",
        workoutType: "kickboxing",
        workoutTypeLabel: "Kickboxing",
        durationMinutes: 64,
        trainingLoad: 84,
        intensity: 0.77,
        averageHr: 156,
        maxHr: 185,
        highIntensityPercentage: 0.5,
        highIntensityMinutes: 32,
        heartRateCoverage: 0.99,
        heartRateSampleCount: 770,
        confidence: "medium",
        detailRoute: "/api/v1/health/workouts/workout_1/detail"
      }
    ],
    targetModel: {
      model: "forge-training-load-v1",
      lowIntensityTarget: "70-85% of total endurance time",
      moderateIntensityTarget: "5-20% depending on phase and sport specificity",
      highIntensityTarget: "8-18% unless in a short peaking block",
      monitoringNotes: [
        "Use Forge TRIMP as a trend.",
        "Prefer easy base when hard work is already high."
      ]
    }
  };
}

describe("TrainingLoadPage", () => {
  beforeEach(() => {
    useForgeShellMock.mockReturnValue({ selectedUserIds: ["user_operator"] });
    getTrainingLoadViewMock.mockResolvedValue({
      trainingLoad: createTrainingLoad()
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders cardiovascular load targets and session evidence", async () => {
    renderPage();

    expect(await screen.findByText("Training Load")).toBeInTheDocument();
    expect(
      screen.getByText(/Forge estimates cardiovascular training stress/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Productive")).toBeInTheDocument();
    expect(screen.getByTestId("training-load-summary-grid")).toHaveClass(
      "grid-cols-2"
    );
    expect(screen.getByText("Zone intelligence")).toBeInTheDocument();
    expect(screen.getByText("Combat readiness")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explain Acute load" }));
    expect(
      screen.getByText(/Acute load is the last seven days/i)
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Explain smart training modes" })
    );
    expect(
      screen.getByText(/Smart modes do not change the underlying data/i)
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Explain next training targets" })
    );
    expect(
      screen.getByText(/Next targets translate the selected mode/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Next week: 170-195 min/i)).toBeInTheDocument();
    expect(screen.getByText(/Zone 2 \/ base/i)).toBeInTheDocument();
    expect(screen.getByText("Intensity target")).toBeInTheDocument();
    expect(screen.getAllByText("Kickboxing").length).toBeGreaterThan(0);
    expect(getTrainingLoadViewMock).toHaveBeenCalledWith(["user_operator"]);
  });
});
