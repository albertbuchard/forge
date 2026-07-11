import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { formatZoneTrendTooltipValue, SportsPage } from "@/pages/sports-page";
import type { FitnessViewData } from "@/lib/types";

const {
  useForgeShellMock,
  getFitnessViewMock,
  getWorkoutSessionMock,
  listPsycheValuesMock,
  listBehaviorPatternsMock,
  listBehaviorsMock,
  listBeliefsMock,
  listTriggerReportsMock,
  patchWorkoutSessionMock
} = vi.hoisted(() => ({
  useForgeShellMock: vi.fn(),
  getFitnessViewMock: vi.fn(),
  getWorkoutSessionMock: vi.fn(),
  listPsycheValuesMock: vi.fn(),
  listBehaviorPatternsMock: vi.fn(),
  listBehaviorsMock: vi.fn(),
  listBeliefsMock: vi.fn(),
  listTriggerReportsMock: vi.fn(),
  patchWorkoutSessionMock: vi.fn()
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: `row-${index}`,
        start: index * 108,
        size: 108
      })),
    getTotalSize: () => count * 108,
    scrollToIndex: vi.fn(),
    measureElement: vi.fn()
  })
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    eyebrow,
    title,
    description,
    badge
  }: {
    eyebrow?: ReactNode;
    title: string;
    description: string;
    badge?: string;
  }) => (
    <div>
      {eyebrow ? <div>{eyebrow}</div> : null}
      <div>{title}</div>
      <div>{description}</div>
      {badge ? <div>{badge}</div> : null}
    </div>
  )
}));

vi.mock("@/components/workbench-boxes/health/health-boxes", () => ({
  SportsBrowserBox: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SportsCompositionBox: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SportsSummaryBox: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type = "button"
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
  }) => (
    <button type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  )
}));

vi.mock("@/components/experience/surface-skeleton", () => ({
  SurfaceSkeleton: () => <div>Loading sports</div>
}));

vi.mock("@/components/ui/page-state", () => ({
  ErrorState: ({ error }: { error: Error }) => <div>{error.message}</div>
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: ({
    value,
    onChange,
    placeholder
  }: {
    value?: string;
    onChange?: (event: { target: { value: string } }) => void;
    placeholder?: string;
  }) => (
    <textarea
      value={value}
      onChange={(event) =>
        onChange?.({ target: { value: event.target.value } })
      }
      placeholder={placeholder}
    />
  )
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({
    value,
    onChange,
    placeholder,
    type
  }: {
    value?: string;
    onChange?: (event: { target: { value: string } }) => void;
    placeholder?: string;
    type?: string;
  }) => (
    <input
      value={value}
      type={type}
      onChange={(event) =>
        onChange?.({ target: { value: event.target.value } })
      }
      placeholder={placeholder}
    />
  )
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>
}));

vi.mock("@/components/experience/sheet-scaffold", () => ({
  SheetScaffold: ({
    open,
    title,
    children
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
  }) =>
    open ? (
      <div>
        <div>{title}</div>
        {children}
      </div>
    ) : null
}));

vi.mock("@/components/search/faceted-token-search", () => ({
  FacetedTokenSearch: ({
    title,
    resultSummary
  }: {
    title: string;
    resultSummary: string;
  }) => (
    <div>
      <div>{title}</div>
      <div>{resultSummary}</div>
    </div>
  )
}));

vi.mock("@/components/psyche/entity-link-multiselect", () => ({
  EntityLinkMultiSelect: () => <div>Entity link multiselect</div>
}));

vi.mock("@/lib/api", () => ({
  getFitnessView: (...args: unknown[]) => getFitnessViewMock(...args),
  getWorkoutSession: (...args: unknown[]) => getWorkoutSessionMock(...args),
  listPsycheValues: (...args: unknown[]) => listPsycheValuesMock(...args),
  listBehaviorPatterns: (...args: unknown[]) =>
    listBehaviorPatternsMock(...args),
  listBehaviors: (...args: unknown[]) => listBehaviorsMock(...args),
  listBeliefs: (...args: unknown[]) => listBeliefsMock(...args),
  listTriggerReports: (...args: unknown[]) => listTriggerReportsMock(...args),
  patchWorkoutSession: (...args: unknown[]) => patchWorkoutSessionMock(...args)
}));

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SportsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SportsPage", () => {
  let fitnessFixture: FitnessViewData;

  beforeEach(() => {
    const fitness: FitnessViewData = {
      summary: {
        workoutCount: 1,
        weeklyVolumeSeconds: 45 * 60,
        exerciseMinutes: 45,
        energyBurnedKcal: 230,
        distanceMeters: 3800,
        workoutTypes: ["walking"],
        averageSessionMinutes: 45,
        averageEffort: 0,
        linkedSessionCount: 0,
        plannedSessionCount: 0,
        importedSessionCount: 1,
        habitGeneratedSessionCount: 0,
        reconciledSessionCount: 1,
        topWorkoutType: "walking",
        topWorkoutTypeLabel: "Walking",
        streakDays: 1
      },
      weeklyTrend: [
        {
          id: "trend_1",
          dateKey: "2026-04-07",
          workoutType: "walking",
          workoutTypeLabel: "Walking",
          activityFamily: "cardio",
          activityFamilyLabel: "Cardio",
          durationMinutes: 45,
          energyKcal: 230
        }
      ],
      typeBreakdown: [
        {
          workoutType: "walking",
          workoutTypeLabel: "Walking",
          activityFamily: "cardio",
          activityFamilyLabel: "Cardio",
          sessionCount: 1,
          totalMinutes: 45,
          energyKcal: 230
        }
      ],
      sportComparison: {
        modelVersion: "forge-sport-comparison-v1",
        generatedAt: "2026-04-07T08:05:00.000Z",
        periods: [
          {
            key: "all",
            label: "All time",
            requestedDays: null,
            startedAt: "2026-04-07T07:15:00.000Z",
            endedAt: "2026-04-07T08:05:00.000Z",
            totals: {
              sessionCount: 1,
              sportCount: 1,
              activeDayCount: 1,
              totalDurationSeconds: 45 * 60,
              totalEnergyKcal: 230,
              energyCoverage: 1,
              totalDistanceMeters: 3800,
              distanceCoverage: 1,
              totalTrainingLoad: null,
              trainingLoadCoverage: 0,
              oldestStartedAt: "2026-04-07T07:15:00.000Z",
              newestStartedAt: "2026-04-07T07:15:00.000Z"
            },
            sports: [
              {
                workoutType: "walking",
                workoutTypeLabel: "Walking",
                activityFamily: "cardio",
                activityFamilyLabel: "Cardio",
                sessionCount: 1,
                sessionShare: 1,
                activeDayCount: 1,
                totalDurationSeconds: 45 * 60,
                durationShare: 1,
                averageSessionMinutes: 45,
                totalEnergyKcal: 230,
                energyShare: 1,
                energyCoverage: 1,
                energyKcalPerHour: 306.7,
                distanceMeters: 3800,
                distanceShare: 1,
                distanceCoverage: 1,
                averageSpeedKph: 5.1,
                totalTrainingLoad: null,
                trainingLoadShare: 0,
                trainingLoadCoverage: 0,
                trainingLoadPerHour: null,
                averageHeartRateCoverage: null,
                firstStartedAt: "2026-04-07T07:15:00.000Z",
                lastStartedAt: "2026-04-07T07:15:00.000Z"
              }
            ]
          },
          {
            key: "365d",
            label: "12 months",
            requestedDays: 365,
            startedAt: "2025-04-07T08:05:00.000Z",
            endedAt: "2026-04-07T08:05:00.000Z",
            totals: {
              sessionCount: 1,
              sportCount: 1,
              activeDayCount: 1,
              totalDurationSeconds: 45 * 60,
              totalEnergyKcal: 230,
              energyCoverage: 1,
              totalDistanceMeters: 3800,
              distanceCoverage: 1,
              totalTrainingLoad: null,
              trainingLoadCoverage: 0,
              oldestStartedAt: "2026-04-07T07:15:00.000Z",
              newestStartedAt: "2026-04-07T07:15:00.000Z"
            },
            sports: []
          },
          {
            key: "90d",
            label: "90 days",
            requestedDays: 90,
            startedAt: "2026-01-07T08:05:00.000Z",
            endedAt: "2026-04-07T08:05:00.000Z",
            totals: {
              sessionCount: 1,
              sportCount: 1,
              activeDayCount: 1,
              totalDurationSeconds: 45 * 60,
              totalEnergyKcal: 230,
              energyCoverage: 1,
              totalDistanceMeters: 3800,
              distanceCoverage: 1,
              totalTrainingLoad: null,
              trainingLoadCoverage: 0,
              oldestStartedAt: "2026-04-07T07:15:00.000Z",
              newestStartedAt: "2026-04-07T07:15:00.000Z"
            },
            sports: []
          }
        ]
      },
      vitalsTrend: [],
      analysisSessions: [],
      sessions: [
        {
          id: "workout_1",
          externalUid: "hk-workout-1",
          pairingSessionId: "pair_1",
          userId: "user_operator",
          source: "apple_health",
          sourceType: "healthkit_sync",
          sourceSystem: "apple_health",
          sourceBundleIdentifier: "com.apple.health",
          sourceProductType: "Watch7,5",
          workoutType: "walking",
          workoutTypeLabel: "Walking",
          activityFamily: "cardio",
          activityFamilyLabel: "Cardio",
          activity: {
            sourceSystem: "apple_health",
            providerActivityType: "hk_workout_activity_type",
            providerRawValue: 52,
            canonicalKey: "walking",
            canonicalLabel: "Walking",
            familyKey: "cardio",
            familyLabel: "Cardio",
            isFallback: false
          },
          details: {
            sourceSystem: "apple_health",
            metrics: [
              {
                key: "average_speed",
                label: "Average speed",
                category: "cardio",
                unit: "km/h",
                statistic: "average",
                value: 5.1,
                startedAt: null,
                endedAt: null
              }
            ],
            events: [
              {
                type: "pause",
                label: "Pause",
                startedAt: "2026-04-07T07:33:00.000Z",
                endedAt: "2026-04-07T07:35:00.000Z",
                durationSeconds: 120,
                metadata: {}
              }
            ],
            components: [
              {
                externalUid: "component_1",
                startedAt: "2026-04-07T07:50:00.000Z",
                endedAt: "2026-04-07T08:00:00.000Z",
                durationSeconds: 600,
                activity: {
                  sourceSystem: "apple_health",
                  providerActivityType: "hk_workout_activity_type",
                  providerRawValue: 80,
                  canonicalKey: "cooldown",
                  canonicalLabel: "Cooldown",
                  familyKey: "mobility",
                  familyLabel: "Mobility",
                  isFallback: false
                },
                metrics: [],
                metadata: {}
              }
            ],
            metadata: {
              indoorWorkout: false
            }
          },
          sourceDevice: "Apple Watch",
          startedAt: "2026-04-07T07:15:00.000Z",
          endedAt: "2026-04-07T08:00:00.000Z",
          durationSeconds: 45 * 60,
          activeEnergyKcal: 210,
          totalEnergyKcal: 230,
          distanceMeters: 3800,
          stepCount: 4800,
          exerciseMinutes: 45,
          averageHeartRate: 116,
          maxHeartRate: 138,
          subjectiveEffort: null,
          moodBefore: "",
          moodAfter: "",
          meaningText: "",
          plannedContext: "",
          socialContext: "",
          links: [],
          tags: [],
          annotations: {},
          provenance: {},
          derived: {},
          generatedFromHabitId: null,
          generatedFromCheckInId: null,
          reconciliationStatus: "reconciled",
          createdAt: "2026-04-07T08:05:00.000Z",
          updatedAt: "2026-04-07T08:05:00.000Z"
        }
      ]
    };
    fitnessFixture = fitness;

    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_operator"],
      snapshot: {
        dashboard: {
          goals: [],
          projects: [],
          tasks: [],
          habits: []
        }
      }
    });
    getFitnessViewMock.mockResolvedValue({ fitness });
    getWorkoutSessionMock.mockResolvedValue({ workout: fitness.sessions[0] });
    listPsycheValuesMock.mockResolvedValue({ values: [] });
    listBehaviorPatternsMock.mockResolvedValue({ patterns: [] });
    listBehaviorsMock.mockResolvedValue({ behaviors: [] });
    listBeliefsMock.mockResolvedValue({ beliefs: [] });
    listTriggerReportsMock.mockResolvedValue({ reports: [] });
    patchWorkoutSessionMock.mockResolvedValue({ workout: fitness.sessions[0] });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders normalized workout labels and exposes captured adapter data in the editor", async () => {
    renderWithProviders();

    expect(await screen.findAllByText("Walking")).not.toHaveLength(0);
    expect(screen.getByText("Health")).toBeInTheDocument();
    expect(screen.queryByText("Project")).not.toBeInTheDocument();
    expect(screen.getByText("HR zone analysis")).toBeInTheDocument();
    expect(screen.getByText("Average zones")).toBeInTheDocument();
    expect(screen.getByText("Zone drift")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stacked" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lines" })).toBeInTheDocument();
    expect(screen.getByText("Cardio")).toBeInTheDocument();
    expect(screen.getByText("Sport comparison")).toBeInTheDocument();
    expect(screen.getAllByText("Energy / h").length).toBeGreaterThan(0);
    expect(getFitnessViewMock).toHaveBeenCalledWith(["user_operator"], {
      sessionDetail: "summary",
      analysisDetail: "compact"
    });

    const comparison = within(screen.getByTestId("sport-comparison-panel"));
    fireEvent.click(comparison.getByRole("button", { name: "90 days" }));
    fireEvent.click(comparison.getByRole("button", { name: "Energy / h" }));
    expect(comparison.getByRole("button", { name: "90 days" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      comparison.getByRole("button", { name: "Energy / h" })
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Lines" }));
    expect(screen.getByText("Expanding zone lines")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /walking/i })[0]!);

    expect(await screen.findByText("Captured data")).toBeInTheDocument();
    expect(screen.getByText("Apple Watch")).toBeInTheDocument();
    expect(screen.getByText("Average speed")).toBeInTheDocument();
    expect(screen.getByText("5.1 km/h")).toBeInTheDocument();
    expect(screen.getByText("Workout events")).toBeInTheDocument();
    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("Workout phases")).toBeInTheDocument();
    expect(screen.getByText("Cooldown")).toBeInTheDocument();
    expect(screen.getByText("Apple Health")).toBeInTheDocument();
  });

  it("shows the stored workout total instead of the bounded browser slice", async () => {
    fitnessFixture.summary.storedWorkoutCount = 2_084;

    renderWithProviders();

    expect(await screen.findByText("2084 sessions")).toBeInTheDocument();
  });

  it("keeps the primary comparison ahead of specialist analysis in a dense mobile summary", async () => {
    renderWithProviders();

    const summaryGrid = await screen.findByTestId("sports-summary-grid");
    const comparison = screen.getByTestId("sport-comparison-panel");
    const zoneAnalysis = screen.getByText("HR zone analysis");

    expect(summaryGrid).toHaveClass("grid-cols-2");
    expect(
      comparison.compareDocumentPosition(zoneAnalysis) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("opens workout detail from the top after browsing deep history", async () => {
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    renderWithProviders();

    const history = await screen.findByTestId("virtual-workout-history");
    fireEvent.click(within(history).getByRole("link", { name: "Walking" }));

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, left: 0 });
  });

  it("renders provider events with duplicate timestamps without React key collisions", async () => {
    const session = fitnessFixture.sessions[0]!;
    if (!("details" in session)) {
      throw new Error("Expected a complete workout session fixture");
    }
    const details = session.details!;
    const sharedStart = "2026-04-07T07:33:00.000Z";
    details.events = [
      {
        type: "segment",
        label: "First segment",
        startedAt: sharedStart,
        endedAt: "2026-04-07T07:35:00.000Z",
        durationSeconds: 120,
        metadata: {}
      },
      {
        type: "segment",
        label: "Second segment",
        startedAt: sharedStart,
        endedAt: "2026-04-07T07:37:00.000Z",
        durationSeconds: 240,
        metadata: {}
      }
    ];
    getWorkoutSessionMock.mockResolvedValueOnce({ workout: session });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      renderWithProviders();
      fireEvent.click(
        (await screen.findAllByRole("button", { name: /walking/i }))[0]!
      );

      expect(await screen.findByText("First segment")).toBeInTheDocument();
      expect(screen.getByText("Second segment")).toBeInTheDocument();
      expect(
        consoleErrorSpy.mock.calls.filter(([message]) =>
          String(message).includes("children with the same key")
        )
      ).toHaveLength(0);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("formats zone-trend tooltip units for zones and physiological overlays", () => {
    expect(
      formatZoneTrendTooltipValue(74, "Resting HR", {
        dataKey: "restingHeartRate"
      })
    ).toEqual(["74 bpm", "Resting HR"]);
    expect(
      formatZoneTrendTooltipValue(37.6, "VO2max", { dataKey: "vo2Max" })
    ).toEqual(["37.6 ml/kg/min", "VO2max"]);
    expect(
      formatZoneTrendTooltipValue(59, "Zone 3", { dataKey: "zone_3" })
    ).toEqual(["59%", "Zone 3"]);
  });

  it("keeps the Sports page available during a rolling API upgrade", async () => {
    const legacyFitness = { ...fitnessFixture };
    delete legacyFitness.sportComparison;
    getFitnessViewMock.mockResolvedValueOnce({ fitness: legacyFitness });

    renderWithProviders();

    expect(await screen.findByText("Weekly volume")).toBeInTheDocument();
    expect(screen.queryByText("Sport comparison")).not.toBeInTheDocument();
    expect(screen.getByText("Activity history")).toBeInTheDocument();
  });

  it("keeps the guided editor open and recoverable when detail loading fails", async () => {
    getWorkoutSessionMock.mockRejectedValueOnce(
      new Error("Workout detail unavailable")
    );
    renderWithProviders();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Edit Walking reflection"
      })
    );

    expect(
      await screen.findByText("Workout details could not be loaded")
    ).toBeInTheDocument();
    getWorkoutSessionMock.mockResolvedValueOnce({
      workout: fitnessFixture.sessions[0]
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Captured data")).toBeInTheDocument();
  });

  it("does not plot missing energy-rate evidence as a zero value", async () => {
    const allTime = fitnessFixture.sportComparison?.periods.find(
      (period) => period.key === "all"
    );
    if (!allTime?.sports[0]) {
      throw new Error("Expected an all-time sport comparison fixture");
    }
    allTime.sports[0].totalEnergyKcal = null;
    allTime.sports[0].energyKcalPerHour = null;

    renderWithProviders();

    const comparison = within(
      await screen.findByTestId("sport-comparison-panel")
    );
    fireEvent.click(comparison.getByRole("button", { name: "Energy / h" }));

    expect(
      comparison.getByText(
        "No energy rate data is available for this period."
      )
    ).toBeInTheDocument();
  });
});
