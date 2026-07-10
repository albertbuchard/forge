import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LifeEventsPage } from "@/pages/life-events-page";
import type { LifeEvent, LifeEventTimelinePayload } from "@/lib/types";

const {
  getLifeEventsTimelineMock,
  getLifeEventMock,
  createEntitiesMock,
  updateEntitiesMock,
  syncLifeEventCalendarMock,
  getLifeEventTravelStatusMock,
  uploadArtifactMock,
  importLifeEventTicketMock
} = vi.hoisted(() => ({
  getLifeEventsTimelineMock: vi.fn(),
  getLifeEventMock: vi.fn(),
  createEntitiesMock: vi.fn(),
  updateEntitiesMock: vi.fn(),
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

vi.mock("maplibre-gl", () => {
  class MockMap {
    scrollZoom = { disable: vi.fn() };
    dragRotate = { disable: vi.fn() };
    touchZoomRotate = { disableRotation: vi.fn() };
    on(event: string, callback: () => void) {
      if (event === "load") {
        callback();
      }
      return this;
    }
    setProjection = vi.fn();
    addSource = vi.fn();
    addLayer = vi.fn();
    fitBounds = vi.fn();
    remove = vi.fn();
  }
  class MockLngLatBounds {
    extend = vi.fn(() => this);
    adjustAntiMeridian = vi.fn(() => this);
  }
  return {
    Map: MockMap,
    LngLatBounds: MockLngLatBounds,
    default: { Map: MockMap, LngLatBounds: MockLngLatBounds }
  };
});

vi.mock("@/components/flows/question-flow-dialog", () => ({
  QuestionFlowDialog: ({
    open,
    title,
    description,
    submitLabel,
    value,
    onChange,
    steps,
    onSubmit,
    children
  }: {
    open: boolean;
    title: string;
    description: string;
    submitLabel: string;
    value: Record<string, unknown>;
    onChange: (value: Record<string, unknown>) => void;
    steps: Array<{
      id: string;
      title: string;
      render: (
        value: Record<string, unknown>,
        setValue: (patch: Record<string, unknown>) => void
      ) => ReactNode;
    }>;
    onSubmit: () => Promise<void>;
    children?: ReactNode;
  }) =>
    open ? (
      <div data-testid="guided-question-flow">
        <h2>{title}</h2>
        <p>{description}</p>
        {steps?.map((step) => (
          <section key={step.id}>
            <h3>{step.title}</h3>
            {step.render(value, (patch) => onChange({ ...value, ...patch }))}
          </section>
        ))}
        {children}
        <button type="button" onClick={() => void onSubmit()}>
          {submitLabel}
        </button>
      </div>
    ) : null
}));

vi.mock("@/lib/api", () => ({
  createEntities: createEntitiesMock,
  updateEntities: updateEntitiesMock,
  getLifeEvent: getLifeEventMock,
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

function renderPage(
  timeline: LifeEventTimelinePayload,
  initialEntry = "/life-events"
) {
  getLifeEventsTimelineMock.mockResolvedValue({ timeline });
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LifeEventsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("LifeEventsPage", () => {
  beforeEach(() => {
    getLifeEventMock.mockResolvedValue({
      lifeEvent: buildLifeEvent({
        id: "lifeevent_outside_window",
        title: "Future family stay",
        startsAt: "2027-01-01T10:00:00.000Z",
        endsAt: "2027-01-01T12:00:00.000Z"
      })
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens the exact Life Event from a navigation focus link", async () => {
    renderPage(
      {
        events: [buildLifeEvent()],
        now: "2026-07-01T12:00:00.000Z",
        nextLifeEventId: "lifeevent_123",
        limit: 500,
        offset: 0
      },
      "/life-events?focus=lifeevent_123"
    );

    expect(
      await screen.findByRole("button", { name: /^edit$/i })
    ).toBeInTheDocument();
    expect(getLifeEventTravelStatusMock).toHaveBeenCalledWith("lifeevent_123");
  });

  it("loads a focused Life Event outside the bounded timeline window", async () => {
    renderPage(
      {
        events: [buildLifeEvent()],
        now: "2026-07-01T12:00:00.000Z",
        nextLifeEventId: "lifeevent_123",
        limit: 500,
        offset: 0
      },
      "/life-events?focus=lifeevent_outside_window"
    );

    expect(await screen.findByText("Future family stay")).toBeInTheDocument();
    expect(getLifeEventMock).toHaveBeenCalledWith("lifeevent_outside_window");
    expect(getLifeEventTravelStatusMock).toHaveBeenCalledWith(
      "lifeevent_outside_window"
    );
    expect(
      screen.getAllByTestId("life-event-card").map((card) => card.textContent)
    ).toEqual([
      expect.stringContaining("Flight to Paris"),
      expect.stringContaining("Future family stay")
    ]);
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
    expect(screen.getByText("Travel and stays")).toBeInTheDocument();
    expect(screen.getByText("Festival")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /month or longer/i })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /import tickets/i }));
    expect(
      screen.getAllByTestId("guided-question-flow").at(-1)
    ).toHaveTextContent("Import tickets");
  });

  it("keeps the timeline searchable without loading nonmatching cards", async () => {
    renderPage({
      events: [
        buildLifeEvent(),
        buildLifeEvent({
          id: "lifeevent_456",
          title: "Summer festival stay",
          eventType: "festival",
          startsAt: "2026-06-01T10:00:00.000Z",
          endsAt: "2026-09-01T09:00:00.000Z",
          destinationLabel: "",
          placeLabel: "Lisbon"
        })
      ],
      now: "2026-07-01T12:00:00.000Z",
      nextLifeEventId: "lifeevent_123",
      limit: 500,
      offset: 0
    });

    expect(await screen.findByText("Flight to Paris")).toBeInTheDocument();
    expect(screen.getByText("Summer festival stay")).toBeInTheDocument();
    expect(screen.getByText("3 months")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search events, places/i), {
      target: { value: "festival" }
    });

    await waitFor(() => {
      expect(screen.queryByText("Flight to Paris")).not.toBeInTheDocument();
      expect(screen.getByText("Summer festival stay")).toBeInTheDocument();
    });
  });

  it("opens a guided edit flow and updates through batch life_event CRUD", async () => {
    createEntitiesMock.mockResolvedValue({ results: [] });
    updateEntitiesMock.mockResolvedValue({ results: [{ ok: true }] });
    renderPage({
      events: [buildLifeEvent()],
      now: "2026-07-01T12:00:00.000Z",
      nextLifeEventId: "lifeevent_123",
      limit: 500,
      offset: 0
    });

    fireEvent.click(
      await screen.findByRole("button", { name: /flight to paris/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

    expect(screen.getByTestId("guided-question-flow")).toHaveTextContent(
      "Edit Life Event"
    );

    fireEvent.click(screen.getByRole("button", { name: /update life event/i }));

    await waitFor(() => {
      expect(updateEntitiesMock).toHaveBeenCalledWith({
        atomic: true,
        operations: [
          expect.objectContaining({
            entityType: "life_event",
            id: "lifeevent_123",
            patch: expect.objectContaining({
              title: "Flight to Paris",
              eventType: "travel_flight",
              calendarProjection: "none"
            })
          })
        ]
      });
    });
  });

  it("renders and edits flight times in the event timezone", async () => {
    updateEntitiesMock.mockResolvedValue({ results: [{ ok: true }] });
    renderPage({
      events: [
        buildLifeEvent({
          id: "lifeevent_lax_gva",
          title: "Fly Los Angeles to Geneva",
          startsAt: "2026-09-13T02:35:00.000Z",
          endsAt: "2026-09-13T15:55:00.000Z",
          timezone: "America/Los_Angeles",
          originLabel: "LAX",
          originCity: "Los Angeles",
          destinationLabel: "GVA",
          destinationCity: "Geneva"
        })
      ],
      now: "2026-07-01T12:00:00.000Z",
      nextLifeEventId: "lifeevent_lax_gva",
      limit: 500,
      offset: 0
    });

    fireEvent.click(
      await screen.findByRole("button", { name: /fly los angeles to geneva/i })
    );
    expect(screen.getAllByText(/2026/)[0]).toHaveTextContent(/12/);
    expect(screen.getByText(/19:35/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByDisplayValue("2026-09-12T19:35")).toBeInTheDocument();
    expect(screen.getByDisplayValue("America/Los_Angeles")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /update life event/i }));

    await waitFor(() => {
      expect(updateEntitiesMock).toHaveBeenCalledWith({
        atomic: true,
        operations: [
          expect.objectContaining({
            entityType: "life_event",
            id: "lifeevent_lax_gva",
            patch: expect.objectContaining({
              startsAt: "2026-09-13T02:35:00.000Z",
              endsAt: "2026-09-13T15:55:00.000Z",
              timezone: "America/Los_Angeles"
            })
          })
        ]
      });
    });
  });
});
