import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkBlockFlowDialog } from "@/components/calendar/work-block-flow-dialog";
import { TimeboxPlanningDialog } from "@/components/calendar/timebox-planning-dialog";
import { CalendarEventFlowDialog } from "@/components/calendar/calendar-event-flow-dialog";
import { I18nProvider } from "@/lib/i18n";
import type { Task } from "@/lib/types";

const { getCalendarOverviewMock, recommendTaskTimeboxesMock } = vi.hoisted(() => ({
  getCalendarOverviewMock: vi.fn(),
  recommendTaskTimeboxesMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  getCalendarOverview: getCalendarOverviewMock,
  recommendTaskTimeboxes: recommendTaskTimeboxesMock
}));

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(max-width: 1023px)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">{node}</I18nProvider>
    </QueryClientProvider>
  );
}

describe("Life Force calendar flows", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    installMatchMedia();
    getCalendarOverviewMock.mockReset();
    recommendTaskTimeboxesMock.mockReset();
    getCalendarOverviewMock.mockResolvedValue({
      calendar: {
        generatedAt: "2026-04-13T06:00:00.000Z",
        providers: [],
        connections: [],
        calendars: [],
        events: [],
        workBlockTemplates: [],
        workBlockInstances: [],
        timeboxes: []
      }
    });
  });

  it("shows the default Life Force drain when shaping a recurring work block", async () => {
    renderWithProviders(
      <WorkBlockFlowDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn(async () => {})}
      />
    );

    expect(await screen.findByText("14 AP/h")).toBeInTheDocument();
    expect(screen.getByText("56 AP / block")).toBeInTheDocument();
    expect(
      screen.getByText(/default Life Force container drain/i)
    ).toBeInTheDocument();
  });

  it("lets the user override work block AP per hour with a custom value", async () => {
    renderWithProviders(
      <WorkBlockFlowDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn(async () => {})}
      />
    );

    const customInput = await screen.findByPlaceholderText(
      /leave empty to use the activity default/i
    );
    fireEvent.change(customInput, { target: { value: "7.5" } });

    expect(await screen.findByText("7.5 AP/h")).toBeInTheDocument();
    expect(screen.getByText("30 AP / block")).toBeInTheDocument();
  });

  it("shows AP load on suggested timeboxes before scheduling", async () => {
    recommendTaskTimeboxesMock.mockResolvedValue({
      timeboxes: [
        {
          id: "timebox_focus",
          taskId: "task_1",
          projectId: null,
          title: "Deep work slot",
          startsAt: "2026-04-13T09:00:00.000Z",
          endsAt: "2026-04-13T11:00:00.000Z",
          source: "suggested"
        }
      ]
    });

    const tasks = [
      {
        id: "task_1",
        title: "Draft the Life Force review",
        status: "focus",
        priority: "medium",
        owner: "Albert",
        goalId: null,
        projectId: null,
        dueDate: null,
        effort: "steady",
        energy: "steady",
        points: 50,
        plannedDurationSeconds: 7200,
        schedulingRules: null,
        sortOrder: 1,
        completedAt: null,
        createdAt: "2026-04-12T08:00:00.000Z",
        updatedAt: "2026-04-12T08:00:00.000Z",
        tagIds: []
      }
    ] as unknown as Task[];

    renderWithProviders(
      <TimeboxPlanningDialog
        open
        onOpenChange={vi.fn()}
        tasks={tasks}
        from="2026-04-13T00:00:00.000Z"
        to="2026-04-20T00:00:00.000Z"
        onCreateTimebox={vi.fn(async () => {})}
      />
    );

    expect(await screen.findByText("8.3 AP target load")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("4.2 AP/h")).toBeInTheDocument();
    expect(screen.getByText("8.3 AP")).toBeInTheDocument();
  });

  it("lets the user switch to manual planning after reviewing the day", async () => {
    recommendTaskTimeboxesMock.mockResolvedValue({
      timeboxes: []
    });
    getCalendarOverviewMock.mockResolvedValue({
      calendar: {
        generatedAt: "2026-04-13T06:00:00.000Z",
        providers: [],
        connections: [],
        calendars: [],
        events: [
          {
            id: "event_1",
            connectionId: null,
            calendarId: null,
            remoteId: null,
            ownership: "external",
            originType: "provider",
            status: "confirmed",
            title: "Clinic",
            description: "",
            location: "",
            place: {
              label: "",
              address: "",
              timezone: "",
              latitude: null,
              longitude: null,
              source: "",
              externalPlaceId: ""
            },
            startAt: "2026-04-13T08:00:00.000Z",
            endAt: "2026-04-13T10:00:00.000Z",
            timezone: "Europe/Zurich",
            isAllDay: false,
            availability: "busy",
            eventType: "",
            categories: [],
            sourceMappings: [],
            links: [],
            actionProfile: null,
            remoteUpdatedAt: null,
            deletedAt: null,
            createdAt: "2026-04-12T08:00:00.000Z",
            updatedAt: "2026-04-12T08:00:00.000Z"
          }
        ],
        workBlockTemplates: [],
        workBlockInstances: [],
        timeboxes: []
      }
    });

    const tasks = [
      {
        id: "task_1",
        title: "Draft the Life Force review",
        status: "focus",
        priority: "medium",
        owner: "Albert",
        goalId: null,
        projectId: null,
        dueDate: null,
        effort: "steady",
        energy: "steady",
        points: 50,
        plannedDurationSeconds: 7200,
        schedulingRules: null,
        sortOrder: 1,
        completedAt: null,
        createdAt: "2026-04-12T08:00:00.000Z",
        updatedAt: "2026-04-12T08:00:00.000Z",
        tagIds: []
      }
    ] as unknown as Task[];

    renderWithProviders(
      <TimeboxPlanningDialog
        open
        onOpenChange={vi.fn()}
        tasks={tasks}
        from="2026-04-13T00:00:00.000Z"
        to="2026-04-20T00:00:00.000Z"
        onCreateTimebox={vi.fn(async () => {})}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Provider events")).toBeInTheDocument();
    expect(await screen.findByText(/Clinic/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Set it manually/i })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Set the exact timebox yourself")).toBeInTheDocument();
    expect(screen.getByText("Override reason")).toBeInTheDocument();
    expect(screen.getByText("manual")).toBeInTheDocument();
  });

  it("defaults task-view timeboxing to a future day and submits an explicit day plus hour range", async () => {
    const onCreateTimebox = vi.fn(async () => {});
    recommendTaskTimeboxesMock.mockResolvedValue({ timeboxes: [] });
    const tasks = [
      {
        id: "task_1",
        title: "Draft the Life Force review",
        status: "focus",
        priority: "medium",
        owner: "Albert",
        goalId: null,
        projectId: null,
        dueDate: null,
        effort: "steady",
        energy: "steady",
        points: 50,
        plannedDurationSeconds: 7200,
        schedulingRules: null,
        sortOrder: 1,
        completedAt: null,
        createdAt: "2026-04-12T08:00:00.000Z",
        updatedAt: "2026-04-12T08:00:00.000Z",
        tagIds: []
      }
    ] as unknown as Task[];

    renderWithProviders(
      <TimeboxPlanningDialog
        open
        onOpenChange={vi.fn()}
        tasks={tasks}
        from="2026-04-13T00:00:00.000Z"
        to="2026-04-20T00:00:00.000Z"
        onCreateTimebox={onCreateTimebox}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const dayInput = await screen.findByDisplayValue("2026-04-14");
    expect(dayInput).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Set it manually/i })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByText("Set the exact timebox yourself")
    ).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("2026-04-14"), {
      target: { value: "2026-04-15" }
    });
    fireEvent.change(screen.getByDisplayValue("09:00"), {
      target: { value: "13:00" }
    });
    fireEvent.change(screen.getByDisplayValue("11:00"), {
      target: { value: "15:30" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Schedule timebox" }));

    expect(onCreateTimebox).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task_1",
        startsAt: "2026-04-15T11:00:00.000Z",
        endsAt: "2026-04-15T13:30:00.000Z",
        source: "manual"
      })
    );
  });

  it("updates an existing timebox through the same guided modal", async () => {
    const onUpdateTimebox = vi.fn(async () => {});
    recommendTaskTimeboxesMock.mockResolvedValue({ timeboxes: [] });
    const tasks = [
      {
        id: "task_1",
        title: "Draft the Life Force review",
        status: "focus",
        priority: "medium",
        owner: "Albert",
        goalId: null,
        projectId: null,
        dueDate: null,
        effort: "steady",
        energy: "steady",
        points: 50,
        plannedDurationSeconds: 7200,
        schedulingRules: null,
        sortOrder: 1,
        completedAt: null,
        createdAt: "2026-04-12T08:00:00.000Z",
        updatedAt: "2026-04-12T08:00:00.000Z",
        tagIds: []
      }
    ] as unknown as Task[];

    renderWithProviders(
      <TimeboxPlanningDialog
        open
        onOpenChange={vi.fn()}
        tasks={tasks}
        from="2026-04-13T00:00:00.000Z"
        to="2026-04-20T00:00:00.000Z"
        editingTimebox={{
          id: "timebox_1",
          taskId: "task_1",
          projectId: null,
          connectionId: null,
          calendarId: null,
          remoteEventId: null,
          linkedTaskRunId: null,
          status: "planned",
          source: "manual",
          title: "Existing block",
          startsAt: "2026-04-16T14:00:00.000Z",
          endsAt: "2026-04-16T15:00:00.000Z",
          overrideReason: "Keep the afternoon clear",
          actionProfile: null,
          createdAt: "2026-04-12T08:00:00.000Z",
          updatedAt: "2026-04-12T08:00:00.000Z",
          userId: "user_operator",
          user: null
        }}
        onCreateTimebox={vi.fn(async () => {})}
        onUpdateTimebox={onUpdateTimebox}
      />
    );

    expect(await screen.findByText("Edit timebox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByText("Set the exact timebox yourself")
    ).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("16:00"), {
      target: { value: "15:00" }
    });
    fireEvent.change(screen.getByDisplayValue("17:00"), {
      target: { value: "16:30" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save timebox" }));

    expect(onUpdateTimebox).toHaveBeenCalledWith(
      "timebox_1",
      expect.objectContaining({
        title: "Existing block",
        startsAt: "2026-04-16T13:00:00.000Z",
        endsAt: "2026-04-16T14:30:00.000Z"
      })
    );
  });

  it("previews event AP drain before saving a busy calendar event", async () => {
    renderWithProviders(
      <CalendarEventFlowDialog
        open
        onOpenChange={vi.fn()}
        writableCalendars={[]}
        linkOptions={[]}
        seed={{
          title: "Research meeting",
          startAt: "2026-04-14T13:00:00.000Z",
          endAt: "2026-04-14T14:00:00.000Z",
          timezone: "Europe/Zurich",
          availability: "busy",
          categories: [],
          links: []
        }}
        onSubmit={vi.fn(async () => {})}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("13 AP/h")).toBeInTheDocument();
    expect(screen.getByText("13 AP")).toBeInTheDocument();
    expect(
      screen.getByText(/availability controls whether the event blocks planning/i)
    ).toBeInTheDocument();
  });

  it("lets the user set a custom AP rate on an event preview", async () => {
    renderWithProviders(
      <CalendarEventFlowDialog
        open
        onOpenChange={vi.fn()}
        writableCalendars={[]}
        linkOptions={[]}
        seed={{
          title: "Recovery lunch",
          startAt: "2026-04-14T12:00:00.000Z",
          endAt: "2026-04-14T13:00:00.000Z",
          timezone: "Europe/Zurich",
          availability: "free",
          categories: [],
          links: []
        }}
        onSubmit={vi.fn(async () => {})}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const customInput = await screen.findByPlaceholderText(
      /leave empty to use the activity default/i
    );
    fireEvent.change(customInput, { target: { value: "5.5" } });
    expect(await screen.findByText("5.5 AP/h")).toBeInTheDocument();
    expect(screen.getByText("5.5 AP")).toBeInTheDocument();
  });
});
