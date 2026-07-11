import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  describeWorkoutTileSource,
  WorkoutDetailPage
} from "@/pages/workout-detail-page";
import type {
  WorkoutRoutePointRecord,
  WorkoutSessionDetailPayload,
  WorkoutTimeSeriesSampleRecord,
  WorkoutZoneDuration
} from "@/lib/types";

const { getWorkoutDetailMock, patchWorkoutSessionMock } = vi.hoisted(() => ({
  getWorkoutDetailMock: vi.fn(),
  patchWorkoutSessionMock: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: () => ({ selectedUserIds: ["user_private"] })
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description,
    actions
  }: {
    title: ReactNode;
    description: ReactNode;
    actions?: ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      <div>{description}</div>
      {actions}
    </header>
  )
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  )
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    pending: _pending,
    pendingLabel: _pendingLabel,
    ...props
  }: ComponentProps<"button"> & {
    pending?: boolean;
    pendingLabel?: string;
  }) => <button {...props}>{children}</button>
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />
}));

vi.mock("@/components/experience/surface-skeleton", () => ({
  SurfaceSkeleton: ({ title }: { title: string }) => <div>{title}</div>
}));

vi.mock("@/components/ui/page-state", () => ({
  ErrorState: ({ error }: { error: Error }) => <div>{error.message}</div>
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AreaChart: () => <div data-testid="hr-chart" />,
  BarChart: () => <div data-testid="zone-chart" />,
  Area: () => null,
  Bar: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null
}));

vi.mock("@/lib/api", () => ({
  getWorkoutDetail: (...args: unknown[]) => getWorkoutDetailMock(...args),
  patchWorkoutSession: (...args: unknown[]) => patchWorkoutSessionMock(...args)
}));

const emptyZones: WorkoutZoneDuration[] = [
  ["below_z1", "Below Z1"],
  ["zone_1", "Zone 1"],
  ["zone_2", "Zone 2"],
  ["zone_3", "Zone 3"],
  ["zone_4", "Zone 4"],
  ["zone_5", "Zone 5"]
].map(([key, label]) => ({ key, label, seconds: 0, percentage: 0 }));

function sample(index: number): WorkoutTimeSeriesSampleRecord {
  const startedAt = new Date(
    Date.parse("2026-06-01T08:00:00.000Z") + index * 5_000
  ).toISOString();
  return {
    id: `sample-${index}`,
    sourceSampleUid: `sample-uid-${index}`,
    seriesIndex: index,
    metricKey: "heart_rate",
    label: "Heart rate",
    category: "heart",
    unit: "bpm",
    value: 110 + (index % 60),
    startedAt,
    endedAt: startedAt,
    sourceDevice: "Apple Watch",
    sourceBundleIdentifier: null,
    sourceProductType: null,
    captureMethod: "associated_workout",
    qualityFlags: [],
    metadata: {},
    provenance: {}
  };
}

function routePoint(index: number): WorkoutRoutePointRecord {
  return {
    id: `route-${index}`,
    sourceRouteUid: "route-1",
    pointIndex: index,
    recordedAt: new Date(
      Date.parse("2026-06-01T08:00:00.000Z") + index * 5_000
    ).toISOString(),
    latitude: 46.45 + index / 100_000,
    longitude: 6.09 + index / 100_000,
    altitudeMeters: null,
    horizontalAccuracyMeters: null,
    verticalAccuracyMeters: null,
    speedMps: null,
    courseDegrees: null,
    metadata: {},
    provenance: {}
  };
}

function detailFixture(
  overrides: Partial<WorkoutSessionDetailPayload["evidence"]> = {}
): WorkoutSessionDetailPayload {
  return {
    workout: {
      id: "workout-private",
      externalUid: "healthkit-workout-private",
      pairingSessionId: null,
      userId: "user_private",
      source: "apple_health",
      sourceType: "healthkit_sync",
      sourceSystem: "apple_health",
      workoutType: "walking",
      workoutTypeLabel: "Walking",
      activityFamily: "cardio",
      activityFamilyLabel: "Cardio",
      sourceDevice: "Apple Watch",
      startedAt: "2026-06-01T08:00:00.000Z",
      endedAt: "2026-06-01T09:00:00.000Z",
      durationSeconds: 3_600,
      activeEnergyKcal: 320,
      totalEnergyKcal: 360,
      distanceMeters: 7_000,
      stepCount: 8_000,
      exerciseMinutes: 60,
      averageHeartRate: null,
      maxHeartRate: null,
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
      reconciliationStatus: "standalone",
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-01T09:00:00.000Z"
    },
    analytics: {
      confidence: "unavailable",
      dataQuality: { heartRateSampleCount: 0, sampleCoverage: 0 },
      zoneDurations: emptyZones,
      hrSummary: {},
      load: { trimp: null },
      routeSummary: { hasRoute: false, pointCount: 0 }
    },
    evidence: {
      timeSeries: [],
      routePoints: [],
      summary: {
        resolution: "adaptive",
        timeSeries: {
          totalCount: 0,
          returnedCount: 0,
          truncated: false,
          metricCounts: {}
        },
        routePoints: {
          totalCount: 0,
          returnedCount: 0,
          truncated: false
        }
      },
      ...overrides
    },
    zoneProfile: {
      id: "zone-private",
      userId: "user_private",
      modelVersion: "forge-hrr-v1",
      birthYear: null,
      sexAtBirth: null,
      knownMaxHr: null,
      thresholdHr: null,
      restingHrOverride: null,
      customZones: [],
      inferredMaxHr: null,
      inferredRestingHr: null,
      confidence: "unavailable",
      thresholds: [],
      metadata: {},
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-01T09:00:00.000Z"
    }
  };
}

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/sports/workouts/workout-private"]}>
        <Routes>
          <Route
            path="/sports/workouts/:workoutId"
            element={<WorkoutDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("WorkoutDetailPage", () => {
  beforeEach(() => {
    window.localStorage.removeItem("forge.map.tile-url");
    getWorkoutDetailMock.mockReset();
    patchWorkoutSessionMock.mockReset();
    patchWorkoutSessionMock.mockResolvedValue({ workout: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it("does not present absent HR zones as measured zeroes", async () => {
    getWorkoutDetailMock.mockResolvedValue(detailFixture());
    renderDetail();

    expect(
      await screen.findByText(
        "Zone mix is unavailable because no heart-rate samples were captured."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("No HR evidence")).toBeInTheDocument();
    expect(screen.queryByText("0.0% · 0m")).not.toBeInTheDocument();
    expect(getWorkoutDetailMock).toHaveBeenCalledWith(
      "workout-private",
      "adaptive",
      ["user_private"]
    );
  });

  it("labels bounded dense timelines and long routes without hiding stored evidence", async () => {
    const fixture = detailFixture({
      timeSeries: Array.from({ length: 1_500 }, (_, index) => sample(index)),
      routePoints: Array.from({ length: 1_200 }, (_, index) =>
        routePoint(index)
      ),
      summary: {
        resolution: "adaptive",
        timeSeries: {
          totalCount: 25_000,
          returnedCount: 1_500,
          truncated: true,
          metricCounts: { heart_rate: 25_000 }
        },
        routePoints: {
          totalCount: 22_147,
          returnedCount: 1_200,
          truncated: true
        }
      }
    });
    fixture.analytics.confidence = "high";
    fixture.analytics.dataQuality = {
      heartRateSampleCount: 25_000,
      sampleCoverage: 0.98
    };
    fixture.analytics.zoneDurations = [
      { key: "zone_2", label: "Zone 2", seconds: 2_400, percentage: 0.667 },
      { key: "zone_3", label: "Zone 3", seconds: 1_200, percentage: 0.333 }
    ];
    fixture.analytics.routeSummary = { hasRoute: true, pointCount: 22_147 };
    getWorkoutDetailMock.mockResolvedValue(fixture);
    renderDetail();

    expect(
      await screen.findByText(
        "1,500 of 25,000 stored HR samples shown at adaptive resolution."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "1,200 of 22,147 stored route points shown; the first and final points are preserved."
      )
    ).toBeInTheDocument();
    expect(screen.getByTestId("hr-chart")).toBeInTheDocument();
  });

  it("keeps the route fallback theme-driven and private without a tile source", async () => {
    const fixture = detailFixture({
      routePoints: [routePoint(0), routePoint(1)]
    });
    fixture.analytics.routeSummary = { hasRoute: true, pointCount: 2 };
    getWorkoutDetailMock.mockResolvedValue(fixture);
    const { container } = renderDetail();

    expect(
      await screen.findByText(
        "Private route shape. No map request leaves Forge."
      )
    ).toBeInTheDocument();
    expect(container.querySelector("polyline")).toHaveAttribute(
      "stroke",
      "var(--chart-zone-4)"
    );
  });
});

describe("describeWorkoutTileSource", () => {
  it("distinguishes local map tiles from external route-area disclosure", () => {
    expect(
      describeWorkoutTileSource(
        "http://127.0.0.1:8080/{z}/{x}/{y}.png",
        "http://127.0.0.1:4317"
      )
    ).toContain("Local map tiles");
    expect(
      describeWorkoutTileSource(
        "https://tiles.example.com/{z}/{x}/{y}.png",
        "http://127.0.0.1:4317"
      )
    ).toBe(
      "External tiles from tiles.example.com. Tile requests disclose the viewed route area to that provider."
    );
  });
});
