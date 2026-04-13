import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LifeForceOverviewWorkspace,
  LifeForceTodayCard
} from "./life-force-workspace";
import type { LifeForcePayload } from "@/lib/types";

const {
  createFatigueSignalMock,
  getLifeForceMock,
  updateLifeForceTemplateMock
} = vi.hoisted(() => ({
  createFatigueSignalMock: vi.fn(),
  getLifeForceMock: vi.fn(),
  updateLifeForceTemplateMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createFatigueSignal: createFatigueSignalMock,
  getLifeForce: getLifeForceMock,
  updateLifeForceTemplate: updateLifeForceTemplateMock
}));

function createLifeForcePayload(): LifeForcePayload {
  return {
    userId: "user_operator",
    dateKey: "2026-04-11",
    baselineDailyAp: 200,
    dailyBudgetAp: 210,
    spentTodayAp: 120,
    remainingAp: 90,
    forecastAp: 188,
    plannedRemainingAp: 68,
    targetBandMinAp: 178.5,
    targetBandMaxAp: 210,
    instantCapacityApPerHour: 10,
    instantFreeApPerHour: 2.5,
    overloadApPerHour: 0,
    currentDrainApPerHour: 5.5,
    fatigueBufferApPerHour: 2,
    sleepRecoveryMultiplier: 1,
    readinessMultiplier: 1,
    fatigueDebtCarry: 0,
    stats: [
      {
        key: "life_force",
        label: "Life Force",
        level: 3,
        xp: 32,
        xpToNextLevel: 300,
        costModifier: 1.09
      },
      {
        key: "activation",
        label: "Activation",
        level: 2,
        xp: 12,
        xpToNextLevel: 200,
        costModifier: 0.96
      },
      {
        key: "focus",
        label: "Focus",
        level: 4,
        xp: 48,
        xpToNextLevel: 400,
        costModifier: 0.92
      },
      {
        key: "vigor",
        label: "Vigor",
        level: 2,
        xp: 8,
        xpToNextLevel: 200,
        costModifier: 0.96
      },
      {
        key: "composure",
        label: "Composure",
        level: 2,
        xp: 9,
        xpToNextLevel: 200,
        costModifier: 0.96
      },
      {
        key: "flow",
        label: "Flow",
        level: 3,
        xp: 18,
        xpToNextLevel: 300,
        costModifier: 0.94
      }
    ],
    currentCurve: [
      { minuteOfDay: 0, rateApPerHour: 0, locked: true },
      { minuteOfDay: 480, rateApPerHour: 8, locked: true },
      { minuteOfDay: 720, rateApPerHour: 12, locked: false },
      { minuteOfDay: 1080, rateApPerHour: 8, locked: false },
      { minuteOfDay: 1440, rateApPerHour: 0, locked: false }
    ],
    activeDrains: [
      {
        id: "task:task_1",
        sourceType: "task",
        sourceId: "task_1",
        title: "Deep work block",
        role: "primary",
        apPerHour: 4.17,
        instantAp: 0,
        why: "Active timed work consumes Action Points proportionally to actual time worked today.",
        startedAt: "2026-04-11T09:00:00.000Z",
        endsAt: "2026-04-11T10:00:00.000Z"
      },
      {
        id: "workout:workout_1",
        sourceType: "workout_session",
        sourceId: "workout_1",
        title: "Mobility",
        role: "secondary",
        apPerHour: 2.5,
        instantAp: 0,
        why: "Workout sessions consume real physical capacity and should affect current load.",
        startedAt: "2026-04-11T11:00:00.000Z",
        endsAt: "2026-04-11T11:30:00.000Z"
      }
    ],
    plannedDrains: [
      {
        id: "timebox:timebox_1",
        sourceType: "task_timebox",
        sourceId: "timebox_1",
        title: "Afternoon planning block",
        role: "secondary",
        apPerHour: 4.17,
        instantAp: 8.34,
        why: "Planned task timeboxes forecast how much Action Point throughput is still booked today.",
        startedAt: "2026-04-11T14:00:00.000Z",
        endsAt: "2026-04-11T16:00:00.000Z"
      }
    ],
    warnings: [
      {
        id: "lf_split",
        tone: "info",
        title: "A task wants to be split",
        detail: "One or more tasks have grown beyond a healthy expected duration."
      }
    ],
    recommendations: ["This is a good moment for deep work."],
    topTaskIdsNeedingSplit: ["task_1"],
    updatedAt: "2026-04-11T12:00:00.000Z"
  };
}

function renderWithQueryClient(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
  );
}

describe("Life Force workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const payload = createLifeForcePayload();
    getLifeForceMock.mockResolvedValue({
      lifeForce: payload,
      templates: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        baselineDailyAp: payload.baselineDailyAp,
        points: payload.currentCurve.map((point) => ({
          ...point,
          locked: weekday === new Date().getDay() ? point.locked : false
        }))
      }))
    });
    createFatigueSignalMock.mockResolvedValue({
      lifeForce: {
        ...payload,
        fatigueBufferApPerHour: payload.fatigueBufferApPerHour + 4
      }
    });
    updateLifeForceTemplateMock.mockResolvedValue({
      weekday: new Date().getDay(),
      points: payload.currentCurve
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders header cards, warnings, drains, and submits tiredness signals", async () => {
    renderWithQueryClient(
      <LifeForceOverviewWorkspace
        selectedUserIds={["user_operator"]}
        fallbackLifeForce={createLifeForcePayload()}
      />
    );

    expect(screen.getByText("Daily AP")).toBeInTheDocument();
    expect(screen.getByText("Current drains")).toBeInTheDocument();
    expect(screen.getByText("Planned drains")).toBeInTheDocument();
    expect(screen.getByText("A task wants to be split")).toBeInTheDocument();
    expect(screen.getByText("Deep work block")).toBeInTheDocument();
    expect(screen.getByText("Afternoon planning block")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /i'm getting tired/i }));

    await waitFor(() => {
      expect(createFatigueSignalMock).toHaveBeenCalledWith(
        { signalType: "tired" },
        ["user_operator"]
      );
    });
    expect(
      await screen.findByText(/Tiredness signal applied/i)
    ).toBeInTheDocument();
  });

  it("saves curve edits through the template mutation", async () => {
    renderWithQueryClient(
      <LifeForceOverviewWorkspace
        selectedUserIds={["user_operator"]}
        fallbackLifeForce={createLifeForcePayload()}
      />
    );

    const turnPoint = screen.getByRole("button", {
      name: /Turn point at 12:00 PM/i
    });
    fireEvent.contextMenu(turnPoint);
    fireEvent.click(await screen.findByText("Remove point"));

    const saveButton = screen.getByRole("button", { name: /save curve/i });
    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(updateLifeForceTemplateMock).toHaveBeenCalled();
    });
  });

  it("supports weekday-specific editing and right-click delete actions", async () => {
    renderWithQueryClient(
      <LifeForceOverviewWorkspace
        selectedUserIds={["user_operator"]}
        fallbackLifeForce={createLifeForcePayload()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Tue" }));

    const turnPoint = screen.getByRole("button", {
      name: /Turn point at 12:00 PM/i
    });
    fireEvent.contextMenu(turnPoint);

    expect(await screen.findByText("Turn point actions")).toBeInTheDocument();
    fireEvent.click(await screen.findByText("Remove point"));

    const saveButton = screen.getByRole("button", { name: /save curve/i });
    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(updateLifeForceTemplateMock).toHaveBeenCalledWith(
        2,
        expect.objectContaining({
          points: expect.any(Array)
        }),
        ["user_operator"]
      );
    });
  });

  it("shows a ghost handle that follows the pointer while dragging a turn point", async () => {
    renderWithQueryClient(
      <LifeForceOverviewWorkspace
        selectedUserIds={["user_operator"]}
        fallbackLifeForce={createLifeForcePayload()}
      />
    );

    const chart = screen.getByRole("img", {
      name: /life force capacity curve editor/i
    });
    Object.defineProperty(chart, "clientWidth", {
      value: 720,
      configurable: true
    });
    Object.defineProperty(chart, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        right: 720,
        bottom: 288,
        width: 720,
        height: 288,
        x: 0,
        y: 0,
        toJSON: () => ({})
      }),
      configurable: true
    });

    const turnPoint = screen.getByRole("button", {
      name: /Turn point at 12:00 PM/i
    });

    fireEvent.pointerDown(turnPoint, {
      pointerId: 7,
      clientX: 360,
      clientY: 132
    });

    const ghostHandle = await screen.findByTestId("life-force-ghost-handle");
    expect(Number(ghostHandle.getAttribute("cx"))).toBeGreaterThan(0);
    expect(Number(ghostHandle.getAttribute("cy"))).toBeGreaterThan(0);

    fireEvent.pointerUp(window, {
      pointerId: 7
    });

    await waitFor(() => {
      expect(screen.queryByTestId("life-force-ghost-handle")).not.toBeInTheDocument();
    });
  });

  it("keeps the rendered chart width equal to the measured editor width on narrow layouts", async () => {
    renderWithQueryClient(
      <LifeForceOverviewWorkspace
        selectedUserIds={["user_operator"]}
        fallbackLifeForce={createLifeForcePayload()}
      />
    );

    const chart = screen.getByRole("img", {
      name: /life force capacity curve editor/i
    });
    Object.defineProperty(chart, "clientWidth", {
      value: 280,
      configurable: true
    });

    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      const svg = chart.querySelector("svg.recharts-surface");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("width")).toBe("280");
    });
  });

  it("shows the compact today state and handles recovery signals", async () => {
    renderWithQueryClient(
      <LifeForceTodayCard
        selectedUserIds={["user_operator"]}
        fallbackLifeForce={createLifeForcePayload()}
      />
    );

    const apSummary = screen.getAllByText(/120 \/ 210 AP used today/i)[0];
    expect(apSummary).toBeInTheDocument();
    expect(screen.getByText("Deep work")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /i'm okay again/i }));

    await waitFor(() => {
      expect(createFatigueSignalMock).toHaveBeenCalledWith(
        { signalType: "okay_again" },
        ["user_operator"]
      );
    });
    expect(
      await screen.findByText(/Recovery signal applied/i)
    ).toBeInTheDocument();
  });
});
