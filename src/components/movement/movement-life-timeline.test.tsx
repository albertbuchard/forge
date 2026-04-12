import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MovementLifeTimeline } from "@/components/movement/movement-life-timeline";
import type { MovementTimelineSegment } from "@/lib/types";

const {
  getMovementTimelineMock,
  createMovementUserBoxMock,
  patchMovementUserBoxMock,
  deleteMovementUserBoxMock,
  invalidateAutomaticMovementBoxMock
} = vi.hoisted(() => ({
  getMovementTimelineMock: vi.fn(),
  createMovementUserBoxMock: vi.fn(),
  patchMovementUserBoxMock: vi.fn(),
  deleteMovementUserBoxMock: vi.fn(),
  invalidateAutomaticMovementBoxMock: vi.fn()
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 140,
        size: 140
      })),
    getTotalSize: () => count * 140,
    scrollToIndex: vi.fn(),
    measureElement: vi.fn()
  })
}));

vi.mock("@/lib/api", () => ({
  getMovementTimeline: (...args: unknown[]) => getMovementTimelineMock(...args),
  createMovementUserBox: (...args: unknown[]) => createMovementUserBoxMock(...args),
  patchMovementUserBox: (...args: unknown[]) => patchMovementUserBoxMock(...args),
  deleteMovementUserBox: (...args: unknown[]) => deleteMovementUserBoxMock(...args),
  invalidateAutomaticMovementBox: (...args: unknown[]) =>
    invalidateAutomaticMovementBoxMock(...args)
}));

function createSegment(
  overrides: Partial<MovementTimelineSegment>
): MovementTimelineSegment {
  const base: MovementTimelineSegment = {
    id: "segment_auto_stay",
    kind: "stay",
    sourceKind: "automatic",
    origin: "continued_stay",
    editable: false,
    isInvalid: false,
    startedAt: "2026-04-06T08:00:00.000Z",
    endedAt: "2026-04-06T09:00:00.000Z",
    durationSeconds: 3600,
    laneSide: "left",
    connectorFromLane: "left",
    connectorToLane: "left",
    title: "Home",
    subtitle: "Short stationary gap carried forward into one continuous stay.",
    placeLabel: "Home",
    tags: ["continued_stay"],
    syncSource: "automatic",
    cursor: "2026-04-06T09:00:00.000Z::segment_auto_stay",
    overrideCount: 0,
    overriddenAutomaticBoxIds: [],
    rawStayIds: ["stay_home"],
    rawTripIds: [],
    rawPointCount: 0,
    hasLegacyCorrections: false,
    stay: null,
    trip: null
  };
  return {
    ...base,
    ...overrides
  } as MovementTimelineSegment;
}

type SharedMovementFixtureCatalog = {
  scenarios: Array<{
    id: string;
    projectedTimeline: MovementTimelineSegment[];
  }>;
};

function loadSharedMovementFixture(id: string) {
  const fixturePath = path.resolve(
    process.cwd(),
    "test-fixtures/movement-canonical-box-fixtures.json"
  );
  const catalog = JSON.parse(
    readFileSync(fixturePath, "utf8")
  ) as SharedMovementFixtureCatalog;
  const scenario = catalog.scenarios.find((entry) => entry.id === id);
  if (!scenario) {
    throw new Error(`Missing shared movement fixture: ${id}`);
  }
  return scenario;
}

function renderTimeline(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("MovementLifeTimeline", () => {
  beforeEach(() => {
    const fixtureSegments = loadSharedMovementFixture(
      "user_defined_missing_override"
    ).projectedTimeline;
    const segments: MovementTimelineSegment[] = fixtureSegments.map((segment) =>
      createSegment(segment)
    );

    getMovementTimelineMock.mockResolvedValue({
      movement: {
        segments,
        nextCursor: null,
        hasMore: false,
        invalidSegmentCount: 0
      }
    });
    createMovementUserBoxMock.mockResolvedValue({});
    patchMovementUserBoxMock.mockResolvedValue({});
    deleteMovementUserBoxMock.mockResolvedValue({});
    invalidateAutomaticMovementBoxMock.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders canonical user-defined box semantics from the backend timeline", async () => {
    renderTimeline(<MovementLifeTimeline userIds={["user_operator"]} />);

    expect(await screen.findByText("Movement")).toBeInTheDocument();
    screen.getByText("View data").closest("button")?.click();
    expect(await screen.findByText("Canonical boxes")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Automatic boxes are derived from immutable raw phone measurements/i
      )
    ).toBeInTheDocument();
    expect(
      await screen.findByText("User invalidated automatic movement")
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText("User invalidated").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/Raw stays/i).length).toBeGreaterThan(0);
  });

  it("renders explicit canonical missing data from the shared overnight fixture", async () => {
    const fixtureSegments = loadSharedMovementFixture(
      "overnight_gap_before_move"
    ).projectedTimeline;
    getMovementTimelineMock.mockResolvedValue({
      movement: {
        segments: fixtureSegments.map((segment) => createSegment(segment)),
        nextCursor: null,
        hasMore: false,
        invalidSegmentCount: 0
      }
    });

    renderTimeline(<MovementLifeTimeline userIds={["user_operator"]} />);

    expect(await screen.findByText("Movement")).toBeInTheDocument();
    screen.getByText("View data").closest("button")?.click();
    expect(await screen.findByText("Missing data")).toBeInTheDocument();
    expect(screen.getAllByText(/Raw trips 1/i).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getAllByText("Missing").length).toBeGreaterThan(0);
    });
  });
});
