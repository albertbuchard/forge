import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LifeEventsPage } from "@/pages/life-events-page";
import type { LifeEvent, LifeEventTimelinePayload } from "@/lib/types";

const {
  getLifeEventsTimelineMock,
  createEntitiesMock,
  syncLifeEventCalendarMock,
  getLifeEventTravelStatusMock,
  uploadArtifactMock,
  importLifeEventTicketMock
} = vi.hoisted(() => ({
  getLifeEventsTimelineMock: vi.fn(),
  createEntitiesMock: vi.fn(),
  syncLifeEventCalendarMock: vi.fn(),
  getLifeEventTravelStatusMock: vi.fn(),
  uploadArtifactMock: vi.fn(),
  importLifeEventTicketMock: vi.fn()
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 220,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 220,
        size: 220
      })),
    measureElement: vi.fn()
  })
}));

vi.mock("@/components/flows/question-flow-dialog", () => ({
  QuestionFlowDialog: ({
    open,
    title,
    description,
    children
  }: {
    open: boolean;
    title: string;
    description: string;
    children?: ReactNode;
  }) =>
    open ? (
      <div data-testid="guided-question-flow">
        <h2>{title}</h2>
        <p>{description}</p>
        {children}
      </div>
    ) : null
}));

vi.mock("@/lib/api", () => ({
  createEntities: createEntitiesMock,
  getLifeEventTravelStatus: getLifeEventTravelStatusMock,
  getLifeEventsTimeline: getLifeEventsTimelineMock,
  importLifeEventTicket: importLifeEventTicketMock,
  syncLifeEventCalendar: syncLifeEventCalendarMock,
  uploadArtifact: uploadArtifactMock
}));

function buildLifeEvent(overrides: Partial<LifeEvent> = {}): LifeEvent {
  return {
    id: "lifeevent_123",
    title: "Flight to Paris",
    shortDescription: "Seeing family",
    description: "Going to see grandmother in Paris.",
    eventType: "travel_flight",
    status: "planned",
    importance: "major",
    startsAt: "2026-08-01T07:30:00.000Z",
    endsAt: "2026-08-01T09:10:00.000Z",
    timezone: "Europe/Zurich",
    isAllDay: false,
    placeLabel: "Paris",
    placeAddress: "",
    placeTimezone: "Europe/Paris",
    placeLatitude: null,
    placeLongitude: null,
    originLabel: "ZRH",
    originCity: "Zurich",
    originCountry: "Switzerland",
    originLatitude: 47.458,
    originLongitude: 8.555,
    destinationLabel: "CDG",
    destinationCity: "Paris",
    destinationCountry: "France",
    destinationLatitude: 49.0097,
    destinationLongitude: 2.5479,
    transportMode: "plane",
    primaryCalendarEventId: null,
    calendarSyncState: "not_synced",
    calendarMatchConfidence: null,
    sourceKind: "manual",
    sourceArtifactId: null,
    extractionStatus: "none",
    extractionSummary: {},
    travelDetails: {},
    displayStyle: {},
    metadata: {},
    segments: [],
    links: [],
    deletedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    userId: null,
    user: null,
    ownerUserId: null,
    ownerUser: null,
    assigneeUserIds: [],
    assignees: [],
    ...overrides
  };
}

function renderPage(timeline: LifeEventTimelinePayload) {
  getLifeEventsTimelineMock.mockResolvedValue({ timeline });
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={client}>
      <LifeEventsPage />
    </QueryClientProvider>
  );
}

describe("LifeEventsPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the virtualized chronology and opens guided modal flows", async () => {
    renderPage({
      events: [buildLifeEvent()],
      now: "2026-07-01T12:00:00.000Z",
      nextLifeEventId: "lifeevent_123",
      limit: 500,
      offset: 0
    });

    expect(await screen.findByText("Flight to Paris")).toBeInTheDocument();
    expect(screen.getByTestId("life-event-card")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add event/i }));
    expect(screen.getByTestId("guided-question-flow")).toHaveTextContent(
      "Add Life Event"
    );

    fireEvent.click(screen.getByRole("button", { name: /import tickets/i }));
    expect(screen.getAllByTestId("guided-question-flow").at(-1)).toHaveTextContent(
      "Import tickets"
    );
  });

  it("keeps the timeline searchable without loading nonmatching cards", async () => {
    renderPage({
      events: [
        buildLifeEvent(),
        buildLifeEvent({
          id: "lifeevent_456",
          title: "Cinema night",
          eventType: "cinema",
          startsAt: "2026-08-03T18:00:00.000Z",
          endsAt: "2026-08-03T20:00:00.000Z",
          destinationLabel: ""
        })
      ],
      now: "2026-07-01T12:00:00.000Z",
      nextLifeEventId: "lifeevent_123",
      limit: 500,
      offset: 0
    });

    expect(await screen.findByText("Flight to Paris")).toBeInTheDocument();
    expect(screen.getByText("Cinema night")).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText(/search events, places/i),
      { target: { value: "cinema" } }
    );

    await waitFor(() => {
      expect(screen.queryByText("Flight to Paris")).not.toBeInTheDocument();
      expect(screen.getByText("Cinema night")).toBeInTheDocument();
    });
  });
});
