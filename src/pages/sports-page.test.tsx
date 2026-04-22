import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SportsPage } from "@/pages/sports-page";
import type { FitnessViewData } from "@/lib/types";

const {
  useForgeShellMock,
  getFitnessViewMock,
  listPsycheValuesMock,
  listBehaviorPatternsMock,
  listBehaviorsMock,
  listBeliefsMock,
  listTriggerReportsMock,
  patchWorkoutSessionMock
} = vi.hoisted(() => ({
  useForgeShellMock: vi.fn(),
  getFitnessViewMock: vi.fn(),
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
    title,
    description,
    badge
  }: {
    title: string;
    description: string;
    badge?: string;
  }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      {badge ? <div>{badge}</div> : null}
    </div>
  )
}));

vi.mock("@/components/workbench-boxes/health/health-boxes", () => ({
  SportsBrowserBox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SportsCompositionBox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SportsSummaryBox: ({ children }: { children: ReactNode }) => <div>{children}</div>
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
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>
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
      onChange={(event) => onChange?.({ target: { value: event.target.value } })}
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
      onChange={(event) => onChange?.({ target: { value: event.target.value } })}
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
  }) => (open ? <div><div>{title}</div>{children}</div> : null)
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
  listPsycheValues: (...args: unknown[]) => listPsycheValuesMock(...args),
  listBehaviorPatterns: (...args: unknown[]) => listBehaviorPatternsMock(...args),
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
    expect(screen.getByText("Cardio")).toBeInTheDocument();

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
});
