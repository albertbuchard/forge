import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
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

const LIFE_EVENT_TYPE_LABELS = [
  "Flight",
  "Train",
  "Car trip",
  "Boat",
  "Trip",
  "Travel day",
  "Stay",
  "Lodging",
  "Holiday",
  "Vacation",
  "Visit",
  "Move",
  "Festival",
  "Conference",
  "Retreat",
  "Concert",
  "Cinema",
  "Meal",
  "Party",
  "Ceremony",
  "Date",
  "Friends",
  "Family",
  "Work milestone",
  "Work phase",
  "Thesis milestone",
  "Creative work",
  "Class or course",
  "Exam",
  "Deadline",
  "Medical",
  "Health episode",
  "Therapy",
  "Admin",
  "Legal or financial",
  "Errand",
  "Celebration",
  "Memory",
  "Custom"
] as const;

vi.mock("@tanstack/react-virtual", () => {
  const buildVirtualizer = ({ count }: { count: number }) => ({
    getTotalSize: () => count * 220,
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 6) }, (_, index) => ({
        index,
        key: index,
        start: index * 220,
        size: 220
      })),
    measureElement: vi.fn(),
    scrollToIndex: vi.fn()
  });
  return {
    useVirtualizer: buildVirtualizer,
    useWindowVirtualizer: buildVirtualizer
  };
});

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
  timeline: Omit<LifeEventTimelinePayload, "total" | "hasMore" | "counts"> &
    Partial<Pick<LifeEventTimelinePayload, "total" | "hasMore" | "counts">>,
  initialEntry = "/life-events"
) {
  getLifeEventsTimelineMock.mockImplementation(
    async (input?: { q?: string; limit?: number; offset?: number }) => {
      const needle = input?.q?.trim().toLowerCase() ?? "";
      const events = needle
        ? timeline.events.filter((event) =>
            JSON.stringify(event).toLowerCase().includes(needle)
          )
        : timeline.events;
      const now = Date.parse(timeline.now);
      const counts = events.reduce(
        (current, event) => {
          if (Date.parse(event.endsAt) < now) {
            current.past += 1;
          } else if (Date.parse(event.startsAt) <= now) {
            current.current += 1;
          } else {
            current.upcoming += 1;
          }
          return current;
        },
        { past: 0, current: 0, upcoming: 0 }
      );
      return {
        timeline: {
          ...timeline,
          events,
          offset: input?.offset ?? timeline.offset,
          total: needle
            ? events.length
            : (timeline.total ?? timeline.events.length),
          hasMore: needle ? false : (timeline.hasMore ?? false),
          counts: needle ? counts : (timeline.counts ?? counts)
        }
      };
    }
  );
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

  it("offers every supported type and saves a readable Custom type name", async () => {
    createEntitiesMock.mockResolvedValue({ results: [{ ok: true }] });
    renderPage({
      events: [buildLifeEvent()],
      now: "2026-07-01T12:00:00.000Z",
      nextLifeEventId: "lifeevent_123",
      limit: 500,
      offset: 0
    });

    expect(await screen.findByText("Flight to Paris")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add event/i }));
    const guidedFlow = within(screen.getByTestId("guided-question-flow"));
    for (const label of LIFE_EVENT_TYPE_LABELS) {
      const accessibleName =
        label === "Custom"
          ? /^Custom Write your own shape$/i
          : new RegExp(`^${label}\\b`, "i");
      expect(
        guidedFlow.getByRole("button", { name: accessibleName })
      ).toBeInTheDocument();
    }
    expect(LIFE_EVENT_TYPE_LABELS).toHaveLength(39);

    fireEvent.change(screen.getByLabelText("Custom type name"), {
      target: { value: "Community gathering" }
    });
    fireEvent.change(screen.getByPlaceholderText("Flight to Paris"), {
      target: { value: "Neighborhood assembly" }
    });
    fireEvent.click(
      screen.getByRole("button", { name: /create life event/i })
    );

    await waitFor(() => {
      expect(createEntitiesMock).toHaveBeenCalledWith({
        atomic: true,
        operations: [
          {
            entityType: "life_event",
            data: expect.objectContaining({
              title: "Neighborhood assembly",
              eventType: "custom",
              metadata: { customTypeLabel: "Community gathering" }
            })
          }
        ]
      });
    });
  });

  it("shows and preserves the truthful type name from a legacy Custom event", async () => {
    updateEntitiesMock.mockResolvedValue({ results: [{ ok: true }] });
    renderPage({
      events: [
        buildLifeEvent({
          title: "Legacy community gathering",
          eventType: "custom",
          metadata: {
            importedFrom: "legacy-fixture",
            legacyEventType: "community_hackathon"
          }
        })
      ],
      now: "2026-07-01T12:00:00.000Z",
      nextLifeEventId: "lifeevent_123",
      limit: 500,
      offset: 0
    });

    expect(await screen.findByText("community hackathon")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /legacy community gathering/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const customTypeInput = screen.getByLabelText("Custom type name");
    expect(customTypeInput).toHaveValue("community hackathon");
    fireEvent.change(customTypeInput, {
      target: { value: "Neighborhood assembly" }
    });
    fireEvent.click(screen.getByRole("button", { name: /update life event/i }));

    await waitFor(() => {
      expect(updateEntitiesMock).toHaveBeenCalledWith({
        atomic: true,
        operations: [
          expect.objectContaining({
            entityType: "life_event",
            id: "lifeevent_123",
            patch: expect.objectContaining({
              eventType: "custom",
              metadata: {
                importedFrom: "legacy-fixture",
                legacyEventType: "community_hackathon",
                customTypeLabel: "Neighborhood assembly"
              }
            })
          })
        ]
      });
    });
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

  it("keeps a large chronology bounded and searches beyond the current page", async () => {
    const events = Array.from({ length: 500 }, (_, index) =>
      buildLifeEvent({
        id: `lifeevent_${index}`,
        title: index === 499 ? "Final future milestone" : `Life event ${index}`,
        startsAt: new Date(Date.UTC(2026, 0, 1 + index, 10)).toISOString(),
        endsAt: new Date(Date.UTC(2026, 0, 1 + index, 12)).toISOString()
      })
    );
    const initialTimeline = {
      events,
      now: "2026-07-01T12:00:00.000Z",
      nextLifeEventId: "lifeevent_181",
      limit: 500,
      offset: 0,
      total: 10_000,
      hasMore: true,
      counts: { past: 8_000, current: 3, upcoming: 1_997 }
    } satisfies LifeEventTimelinePayload;
    getLifeEventsTimelineMock.mockImplementation(
      async (input?: { q?: string; limit?: number; offset?: number }) => ({
        timeline: input?.q
          ? {
              events: [
                buildLifeEvent({
                  id: "lifeevent_9999",
                  title: "Final future milestone"
                })
              ],
              now: initialTimeline.now,
              nextLifeEventId: "lifeevent_9999",
              limit: 500,
              offset: 0,
              total: 1,
              hasMore: false,
              counts: { past: 0, current: 0, upcoming: 1 }
            }
          : initialTimeline
      })
    );
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/life-events"]}>
          <LifeEventsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText("Life event 0")).toBeInTheDocument();
    expect(screen.getAllByTestId("life-event-card")).toHaveLength(6);
    expect(screen.getByText("Showing 1-500 of 10000")).toBeInTheDocument();
    expect(screen.getByText("8000 past")).toBeInTheDocument();
    expect(screen.getByText("3 now")).toBeInTheDocument();
    expect(screen.getByText("1997 future")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search events, places/i), {
      target: { value: "Final future milestone" }
    });

    expect(
      await screen.findByText("Final future milestone")
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("life-event-card")).toHaveLength(1);
    expect(getLifeEventsTimelineMock).toHaveBeenLastCalledWith({
      q: "Final future milestone",
      limit: 500,
      offset: 0
    });
  });

  it("pages through large Life Event histories without loading every card", async () => {
    getLifeEventsTimelineMock.mockImplementation(
      async (input?: { q?: string; limit?: number; offset?: number }) => ({
        timeline: {
          events: [
            buildLifeEvent({
              id: input?.offset === 500 ? "lifeevent_500" : "lifeevent_0",
              title: input?.offset === 500 ? "Page two event" : "Page one event"
            })
          ],
          now: "2026-07-01T12:00:00.000Z",
          nextLifeEventId: null,
          limit: 500,
          offset: input?.offset ?? 0,
          total: 1_200,
          hasMore: (input?.offset ?? 0) < 1_000,
          counts: { past: 900, current: 0, upcoming: 300 }
        }
      })
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/life-events"]}>
          <LifeEventsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText("Page one event")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Next Life Events page" })
    );
    expect(await screen.findByText("Page two event")).toBeInTheDocument();
    expect(screen.getByText("Showing 501-501 of 1200")).toBeInTheDocument();
    expect(getLifeEventsTimelineMock).toHaveBeenLastCalledWith({
      q: undefined,
      limit: 500,
      offset: 500
    });

    fireEvent.change(screen.getByPlaceholderText(/search events, places/i), {
      target: { value: "Page one" }
    });
    expect(await screen.findByText("Page one event")).toBeInTheDocument();
    expect(getLifeEventsTimelineMock).toHaveBeenLastCalledWith({
      q: "Page one",
      limit: 500,
      offset: 0
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
