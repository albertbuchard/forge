import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { MovementPage } from "@/pages/movement-page";

const {
  useForgeShellMock,
  getLifeForceMock,
  getMovementAllTimeMock,
  getMovementDayMock,
  getMovementMonthMock,
  getMovementSelectionAggregateMock,
  getMovementSettingsMock,
  listMovementPlacesMock,
  patchMovementSettingsMock
} = vi.hoisted(() => ({
  useForgeShellMock: vi.fn(),
  getLifeForceMock: vi.fn(),
  getMovementAllTimeMock: vi.fn(),
  getMovementDayMock: vi.fn(),
  getMovementMonthMock: vi.fn(),
  getMovementSelectionAggregateMock: vi.fn(),
  getMovementSettingsMock: vi.fn(),
  listMovementPlacesMock: vi.fn(),
  patchMovementSettingsMock: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    badge,
    actions
  }: {
    title: string;
    badge?: string;
    actions?: ReactNode;
  }) => (
    <div>
      <div>{title}</div>
      {badge ? <div>{badge}</div> : null}
      {actions}
    </div>
  )
}));

vi.mock("@/components/experience/sheet-scaffold", () => ({
  SheetScaffold: ({ children }: { children: ReactNode }) => <div>{children}</div>
}));

vi.mock("@/components/experience/surface-skeleton", () => ({
  SurfaceSkeleton: () => <div>Loading…</div>
}));

vi.mock("@/components/movement/movement-life-timeline", () => ({
  MovementLifeTimeline: () => <div>Movement life timeline</div>
}));

vi.mock("@/components/search/faceted-token-search", () => ({
  FacetedTokenSearch: () => <div>Point search</div>
}));

vi.mock("@/components/workbench-boxes/movement/movement-boxes", () => ({
  MovementDataBrowserBox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MovementPlacesBox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MovementSelectionBox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MovementSummaryBox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MovementTimelineBox: ({ children }: { children: ReactNode }) => <div>{children}</div>
}));

vi.mock("@/lib/api", () => ({
  createMovementPlace: vi.fn(),
  getLifeForce: getLifeForceMock,
  getMovementAllTime: getMovementAllTimeMock,
  getMovementDay: getMovementDayMock,
  getMovementMonth: getMovementMonthMock,
  getMovementSelectionAggregate: getMovementSelectionAggregateMock,
  getMovementTripDetail: vi.fn(),
  getMovementSettings: getMovementSettingsMock,
  listMovementPlaces: listMovementPlacesMock,
  patchMovementPlace: vi.fn(),
  patchMovementSettings: patchMovementSettingsMock
}));

function renderWithProviders() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MovementPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Movement page Life Force integration", () => {
  beforeEach(() => {
    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_operator"]
    });
    getLifeForceMock.mockResolvedValue({
      lifeForce: {
        userId: "user_operator",
        dateKey: "2026-04-11",
        baselineDailyAp: 200,
        dailyBudgetAp: 220,
        spentTodayAp: 40,
        remainingAp: 180,
        forecastAp: 92,
        plannedRemainingAp: 52,
        targetBandMinAp: 187,
        targetBandMaxAp: 220,
        instantCapacityApPerHour: 10,
        instantFreeApPerHour: 3.4,
        overloadApPerHour: 0,
        currentDrainApPerHour: 4.8,
        fatigueBufferApPerHour: 1.8,
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
        updatedAt: "2026-04-11T12:00:00.000Z"
      },
      templates: []
    });
    getMovementDayMock.mockResolvedValue({
      movement: {
        dateKey: "2026-04-11",
        summary: {
          tripCount: 2,
          stayCount: 3,
          totalDistanceMeters: 4200,
          totalIdleSeconds: 7200,
          estimatedScreenTimeSeconds: 1800,
          knownPlaceCount: 2,
          missingDurationSeconds: 0,
          missingCount: 0,
          repairedGapDurationSeconds: 600,
          repairedGapCount: 1,
          continuedStayDurationSeconds: 1200,
          continuedStayCount: 1
        },
        trips: [
          {
            id: "trip_1",
            label: "Walk to coworking",
            status: "completed",
            travelMode: "walk",
            activityType: "walk",
            startedAt: "2026-04-11T08:00:00.000Z",
            endedAt: "2026-04-11T08:30:00.000Z",
            durationSeconds: 1800,
            distanceMeters: 2200,
            estimatedScreenTimeSeconds: 300,
            pickupCount: 1,
            notificationCount: 2,
            topApps: [],
            topCategories: [],
            expectedMet: 3.2
          },
          {
            id: "trip_2",
            label: "Metro home",
            status: "completed",
            travelMode: "train",
            activityType: "transit",
            startedAt: "2026-04-11T18:00:00.000Z",
            endedAt: "2026-04-11T18:20:00.000Z",
            durationSeconds: 1200,
            distanceMeters: 2000,
            estimatedScreenTimeSeconds: 240,
            pickupCount: 0,
            notificationCount: 0,
            topApps: [],
            topCategories: [],
            expectedMet: 2
          }
        ],
        segments: [],
        stays: [],
        selectionAggregate: {
          durationSeconds: 0,
          distanceMeters: 0,
          trackedWorkSeconds: 0,
          noteCount: 0,
          estimatedScreenTimeSeconds: 0,
          pickupCount: 0,
          notificationCount: 0,
          placeLabels: [],
          topApps: [],
          topCategories: []
        }
      }
    });
    getMovementMonthMock.mockResolvedValue({
      movement: {
        monthKey: "2026-04",
        days: [],
        totals: {
          distanceMeters: 4200,
          movingSeconds: 1800,
          idleSeconds: 7200,
          caloriesKcal: 320
        }
      }
    });
    getMovementAllTimeMock.mockResolvedValue({
      movement: {
        summary: {
          tripCount: 12,
          knownPlaceCount: 4,
          totalDistanceMeters: 50200,
          visitedCountries: 2
        },
        categoryBreakdown: [
          { tag: "work", count: 6 },
          { tag: "travel", count: 3 }
        ],
        recentTrips: [
          {
            id: "trip_recent_1",
            label: "Airport transfer",
            startedAt: "2026-04-10T09:00:00.000Z",
            distanceMeters: 12000,
            activityType: "drive"
          }
        ]
      }
    });
    getMovementSettingsMock.mockResolvedValue({
      settings: {
        trackingEnabled: true,
        publishMode: "workspace_only"
      }
    });
    getMovementSelectionAggregateMock.mockResolvedValue({
      aggregate: {
        durationSeconds: 0,
        distanceMeters: 0,
        trackedWorkSeconds: 0,
        noteCount: 0,
        estimatedScreenTimeSeconds: 0,
        pickupCount: 0,
        notificationCount: 0,
        placeLabels: [],
        topApps: [],
        topCategories: []
      }
    });
    listMovementPlacesMock.mockResolvedValue({ places: [] });
    patchMovementSettingsMock.mockResolvedValue({
      settings: {
        trackingEnabled: true,
        publishMode: "workspace_only"
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows movement AP summaries and keeps AP badges visible in all-time travel cards", async () => {
    renderWithProviders();

    expect(await screen.findByText("Movement AP today")).toBeInTheDocument();
    expect(screen.getByText("Life Force sync")).toBeInTheDocument();
    expect(screen.getByText("40/220 AP")).toBeInTheDocument();
    expect(screen.getByText("Movement life timeline")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All time" }));

    expect(await screen.findByText("Airport transfer")).toBeInTheDocument();
    expect(screen.getAllByText("8 AP/h").length).toBeGreaterThan(0);
  });
});
