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
  getMovementBoxDetailMock,
  createMovementPlaceMock,
  patchMovementStayMock,
  createMovementUserBoxMock,
  preflightMovementUserBoxMock,
  patchMovementUserBoxMock,
  deleteMovementUserBoxMock,
  invalidateAutomaticMovementBoxMock
} = vi.hoisted(() => ({
  getMovementTimelineMock: vi.fn(),
  getMovementBoxDetailMock: vi.fn(),
  createMovementPlaceMock: vi.fn(),
  patchMovementStayMock: vi.fn(),
  createMovementUserBoxMock: vi.fn(),
  preflightMovementUserBoxMock: vi.fn(),
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
  getMovementBoxDetail: (...args: unknown[]) => getMovementBoxDetailMock(...args),
  createMovementPlace: (...args: unknown[]) => createMovementPlaceMock(...args),
  patchMovementStay: (...args: unknown[]) => patchMovementStayMock(...args),
  createMovementUserBox: (...args: unknown[]) => createMovementUserBoxMock(...args),
  preflightMovementUserBox: (...args: unknown[]) => preflightMovementUserBoxMock(...args),
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
    boxId: "segment_auto_stay",
    kind: "stay",
    sourceKind: "automatic",
    origin: "continued_stay",
    editable: false,
    isInvalid: false,
    startedAt: "2026-04-06T08:00:00.000Z",
    endedAt: "2026-04-06T09:00:00.000Z",
    trueStartedAt: "2026-04-06T08:00:00.000Z",
    trueEndedAt: "2026-04-06T09:00:00.000Z",
    visibleStartedAt: "2026-04-06T08:00:00.000Z",
    visibleEndedAt: "2026-04-06T09:00:00.000Z",
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
    overriddenUserBoxIds: [],
    isFullyHidden: false,
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
    createMovementPlaceMock.mockResolvedValue({
      place: {
        id: "place_home",
        externalUid: "place_home",
        userId: "user_operator",
        label: "Home",
        aliases: [],
        latitude: 46.5191,
        longitude: 6.6323,
        radiusMeters: 100,
        categoryTags: ["home"],
        visibility: "shared",
        wikiNoteId: null,
        linkedEntities: [],
        linkedPeople: [],
        metadata: {},
        source: "test",
        createdAt: "2026-04-06T09:00:00.000Z",
        updatedAt: "2026-04-06T09:00:00.000Z",
        wikiNote: null
      }
    });
    patchMovementStayMock.mockResolvedValue({});
    preflightMovementUserBoxMock.mockResolvedValue({
      preflight: {
        overlapsAnything: false,
        visibleRangeStart: "2026-04-06T08:00:00.000Z",
        visibleRangeEnd: "2026-04-06T10:00:00.000Z",
        suggestedStartedAt: null,
        suggestedEndedAt: null,
        nearestMissingStartedAt: null,
        nearestMissingEndedAt: null,
        affectedAutomaticBoxIds: [],
        affectedUserBoxIds: [],
        fullyOverriddenUserBoxIds: [],
        trimmedUserBoxIds: []
      }
    });
    patchMovementUserBoxMock.mockResolvedValue({});
    deleteMovementUserBoxMock.mockResolvedValue({});
    invalidateAutomaticMovementBoxMock.mockResolvedValue({});
    getMovementBoxDetailMock.mockResolvedValue({
      movement: {
        segment: createSegment({
          id: "segment_auto_stay",
          stay: {
            id: "stay_home",
            externalUid: "stay_home",
            pairingSessionId: null,
            userId: "user_operator",
            placeId: null,
            label: "Home",
            status: "completed",
            classification: "stationary",
            startedAt: "2026-04-06T08:00:00.000Z",
            endedAt: "2026-04-06T09:00:00.000Z",
            durationSeconds: 3600,
            centerLatitude: 46.5191,
            centerLongitude: 6.6323,
            radiusMeters: 120,
            sampleCount: 3,
            weather: {},
            metrics: {},
            metadata: {},
            publishedNoteId: null,
            createdAt: "2026-04-06T09:00:00.000Z",
            updatedAt: "2026-04-06T09:00:00.000Z",
            place: null,
            note: null,
            estimatedScreenTimeSeconds: 0,
            pickupCount: 0,
            notificationCount: 0,
            topApps: [],
            topCategories: []
          }
        }),
        rawStays: [],
        rawTrips: [],
        stayDetail: {
          positions: [
            {
              latitude: 46.5191,
              longitude: 6.6323,
              recordedAt: "2026-04-06T08:00:00.000Z",
              label: "Stay 1"
            }
          ],
          averagePosition: {
            latitude: 46.5191,
            longitude: 6.6323,
            recordedAt: null,
            label: "Average position"
          },
          canonicalPlace: null,
          radiusMeters: 120,
          sampleCount: 3
        },
        tripDetail: null
      }
    });
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
      (await screen.findAllByText("User invalidated automatic movement")).length
    ).toBeGreaterThan(0);

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

  it("shows overlap guidance and missing-fit actions in the editor", async () => {
    preflightMovementUserBoxMock.mockResolvedValue({
      preflight: {
        overlapsAnything: true,
        visibleRangeStart: "2026-04-06T08:00:00.000Z",
        visibleRangeEnd: "2026-04-06T10:00:00.000Z",
        suggestedStartedAt: "2026-04-06T08:30:00.000Z",
        suggestedEndedAt: "2026-04-06T09:00:00.000Z",
        nearestMissingStartedAt: "2026-04-06T08:30:00.000Z",
        nearestMissingEndedAt: "2026-04-06T09:00:00.000Z",
        affectedAutomaticBoxIds: ["mba_home"],
        affectedUserBoxIds: ["mbx_existing"],
        fullyOverriddenUserBoxIds: [],
        trimmedUserBoxIds: ["mbx_existing"]
      }
    });

    renderTimeline(<MovementLifeTimeline userIds={["user_operator"]} />);

    expect(await screen.findByText("Movement")).toBeInTheDocument();
    screen.getByText("Add box").closest("button")?.click();
    expect(await screen.findByText("Overlap guidance")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText(
          /This box overlaps 1 automatic and 1 manual boxes\./i
        )
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /Fit Missing Time/i })
    ).toBeEnabled();
  });

  it("opens stay detail and offers canonical place creation for unlinked stays", async () => {
    getMovementTimelineMock.mockResolvedValueOnce({
      movement: {
        segments: [
          createSegment({
            id: "segment_unlinked_stay",
            boxId: "segment_unlinked_stay",
            title: "Home",
            subtitle: "Unlinked stay",
            placeLabel: null,
            rawStayIds: ["stay_home"],
            stay: {
              id: "stay_home",
              externalUid: "stay_home",
              pairingSessionId: null,
              userId: "user_operator",
              placeId: null,
              label: "Home",
              status: "completed",
              classification: "stationary",
              startedAt: "2026-04-06T08:00:00.000Z",
              endedAt: "2026-04-06T09:00:00.000Z",
              durationSeconds: 3600,
              centerLatitude: 46.5191,
              centerLongitude: 6.6323,
              radiusMeters: 120,
              sampleCount: 3,
              weather: {},
              metrics: {},
              metadata: {},
              publishedNoteId: null,
              createdAt: "2026-04-06T09:00:00.000Z",
              updatedAt: "2026-04-06T09:00:00.000Z",
              place: null,
              note: null,
              estimatedScreenTimeSeconds: 0,
              pickupCount: 0,
              notificationCount: 0,
              topApps: [],
              topCategories: []
            }
          })
        ],
        nextCursor: null,
        hasMore: false,
        invalidSegmentCount: 0
      }
    });

    renderTimeline(<MovementLifeTimeline userIds={["user_operator"]} />);

    expect(await screen.findByText("Movement")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Create canonical place/i })).toBeInTheDocument();
    screen.getByRole("button", { name: "Details" }).click();

    expect(await screen.findByText(/Home details/i)).toBeInTheDocument();
    expect(await screen.findByText(/Average position:/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create canonical place/i })).toBeInTheDocument();
  });

  it("shows the known location name directly in the stay box", async () => {
    getMovementTimelineMock.mockResolvedValueOnce({
      movement: {
        segments: [
          createSegment({
            id: "segment_known_place_stay",
            title: "Stay",
            placeLabel: "Lausanne Office",
            stay: {
              id: "stay_office",
              externalUid: "stay_office",
              pairingSessionId: null,
              userId: "user_operator",
              placeId: "place_office",
              label: "Office stay",
              status: "completed",
              classification: "stationary",
              startedAt: "2026-04-06T08:00:00.000Z",
              endedAt: "2026-04-06T09:00:00.000Z",
              durationSeconds: 3600,
              centerLatitude: 46.5191,
              centerLongitude: 6.6323,
              radiusMeters: 120,
              sampleCount: 3,
              weather: {},
              metrics: {},
              metadata: {},
              publishedNoteId: null,
              createdAt: "2026-04-06T09:00:00.000Z",
              updatedAt: "2026-04-06T09:00:00.000Z",
              place: {
                id: "place_office",
                externalUid: "place_office",
                userId: "user_operator",
                label: "Lausanne Office",
                aliases: [],
                latitude: 46.5191,
                longitude: 6.6323,
                radiusMeters: 100,
                categoryTags: ["work"],
                visibility: "shared",
                wikiNoteId: null,
                linkedEntities: [],
                linkedPeople: [],
                metadata: {},
                source: "test",
                createdAt: "2026-04-06T09:00:00.000Z",
                updatedAt: "2026-04-06T09:00:00.000Z",
                wikiNote: null
              },
              note: null,
              estimatedScreenTimeSeconds: 0,
              pickupCount: 0,
              notificationCount: 0,
              topApps: [],
              topCategories: []
            }
          })
        ],
        nextCursor: null,
        hasMore: false,
        invalidSegmentCount: 0
      }
    });

    renderTimeline(<MovementLifeTimeline userIds={["user_operator"]} />);

    expect(await screen.findByRole("button", { name: /Lausanne Office/i })).toBeInTheDocument();
  });
});
