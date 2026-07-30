import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HabitsPage } from "@/pages/habits-page";
import { formatLocalDateKey, getRuntimeTimeZone } from "@/lib/date-keys";
import type { Habit } from "@/lib/types";

const {
  createHabitCheckInMock,
  createHabitMock,
  deleteHabitCheckInMock,
  deleteHabitMock,
  getLifeForceMock,
  getPsycheOverviewMock,
  listHabitsMock,
  patchHabitMock,
  useForgeShellMock
} = vi.hoisted(() => ({
  createHabitCheckInMock: vi.fn(),
  createHabitMock: vi.fn(),
  deleteHabitCheckInMock: vi.fn(),
  deleteHabitMock: vi.fn(),
  getLifeForceMock: vi.fn(),
  getPsycheOverviewMock: vi.fn(),
  listHabitsMock: vi.fn(),
  patchHabitMock: vi.fn(),
  useForgeShellMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createHabit: createHabitMock,
  createHabitCheckIn: createHabitCheckInMock,
  deleteHabitCheckIn: deleteHabitCheckInMock,
  deleteHabit: deleteHabitMock,
  getLifeForce: getLifeForceMock,
  getPsycheOverview: getPsycheOverviewMock,
  listHabits: listHabitsMock,
  patchHabit: patchHabitMock
}));

vi.mock("@/components/shell/app-shell", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/shell/app-shell")
  >("@/components/shell/app-shell");
  return {
    ...actual,
    useForgeShell: useForgeShellMock
  };
});

vi.mock("@/components/notes/entity-note-count-link", () => ({
  EntityNoteCountLink: ({ count }: { count: number }) => (
    <div>{count} notes</div>
  )
}));

vi.mock("@/components/notes/note-markdown", () => ({
  NoteMarkdown: ({ markdown }: { markdown: string }) => <div>{markdown}</div>
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    titleText,
    description,
    badge,
    actions
  }: {
    titleText: string;
    description: string;
    badge?: string;
    actions?: ReactNode;
  }) => (
    <div>
      <div>{titleText}</div>
      <div>{description}</div>
      {badge ? <div>{badge}</div> : null}
      {actions}
    </div>
  )
}));

vi.mock("@/components/habit-dialog", () => ({
  HabitDialog: () => null
}));

vi.mock("@/components/ui/entity-name", () => ({
  EntityName: ({ label }: { label: string }) => <span>{label}</span>
}));

vi.mock("@/components/ui/user-badge", () => ({
  UserBadge: ({ user }: { user?: { displayName?: string } | null }) =>
    user?.displayName ? <span>{user.displayName}</span> : null
}));

const habitUser = {
  id: "user_1",
  kind: "human" as const,
  handle: "albert",
  displayName: "Albert",
  description: "",
  accentColor: "#fff",
  createdAt: "2026-04-06T00:00:00.000Z",
  updatedAt: "2026-04-06T00:00:00.000Z"
};

function createHabit(overrides: Partial<Habit> = {}): Habit {
  const base: Habit = {
    id: "habit_1",
    title: "Meditation",
    description: "Ten quiet minutes.",
    status: "active",
    polarity: "positive",
    frequency: "daily",
    timezone: "Europe/Zurich",
    dayBoundaryMode: "fixed",
    effectiveTimezone: "Europe/Zurich",
    currentDateKey: formatLocalDateKey(),
    targetCount: 1,
    weekDays: [],
    linkedGoalIds: [],
    linkedProjectIds: [],
    linkedTaskIds: [],
    linkedValueIds: [],
    linkedPatternIds: [],
    linkedBehaviorIds: [],
    linkedBeliefIds: [],
    linkedModeIds: [],
    linkedReportIds: [],
    linkedBehaviorId: null,
    linkedBehaviorTitle: null,
    linkedBehaviorTitles: [],
    rewardXp: 5,
    penaltyXp: 2,
    generatedHealthEventTemplate: {
      enabled: false,
      workoutType: "",
      title: "",
      durationMinutes: 0,
      xpReward: 0,
      tags: [],
      links: [],
      notesTemplate: ""
    },
    createdAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z",
    lastCheckInAt: null,
    lastCheckInStatus: null,
    streakCount: 0,
    completionRate: 0,
    dueToday: true,
    checkIns: [],
    userId: habitUser.id,
    user: habitUser,
  };
  return {
    ...base,
    ...overrides,
    timezone: overrides.timezone ?? base.timezone,
    dayBoundaryMode: overrides.dayBoundaryMode ?? base.dayBoundaryMode,
    effectiveTimezone: overrides.effectiveTimezone ?? base.effectiveTimezone,
    currentDateKey: overrides.currentDateKey ?? base.currentDateKey
  };
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
}

function renderWithProviders(client = createTestQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/habits"]}>
        <Routes>
          <Route path="/habits" element={<HabitsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("HabitsPage", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function primeSharedMocks() {
    getPsycheOverviewMock.mockResolvedValue({
      overview: {
        values: [],
        patterns: [],
        behaviors: [],
        beliefs: [],
        modes: [],
        reports: []
      }
    });
    getLifeForceMock.mockResolvedValue({
      lifeForce: {
        userId: "user_1",
        dateKey: "2026-04-11",
        baselineDailyAp: 200,
        dailyBudgetAp: 210,
        spentTodayAp: 72,
        remainingAp: 138,
        forecastAp: 126,
        plannedRemainingAp: 20,
        targetBandMinAp: 178.5,
        targetBandMaxAp: 210,
        instantCapacityApPerHour: 10,
        instantFreeApPerHour: 4.2,
        overloadApPerHour: 0,
        currentDrainApPerHour: 4.8,
        fatigueBufferApPerHour: 1,
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
  }

  it("opens a delete confirmation dialog and removes the habit after confirm", async () => {
    let currentHabits = [createHabit()];
    listHabitsMock.mockImplementation(async () => ({ habits: currentHabits }));
    primeSharedMocks();
    deleteHabitMock.mockImplementation(async () => {
      currentHabits = [];
      return { habit: null };
    });
    useForgeShellMock.mockReturnValue({
      selectedUserIds: [],
      refresh: vi.fn().mockResolvedValue(undefined),
      snapshot: {
        goals: [],
        tasks: [],
        users: [habitUser],
        dashboard: {
          goals: [],
          projects: [],
          notesSummaryByEntity: {}
        }
      }
    });

    renderWithProviders();

    expect(await screen.findByText("Meditation")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete Meditation" }));

    expect(
      await screen.findByRole("button", { name: "Move to bin" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Move "Meditation" to the bin/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Move to bin" }));

    await waitFor(() => {
      expect(deleteHabitMock).toHaveBeenCalledWith("habit_1");
    });
    await waitFor(() => {
      expect(screen.queryByText("Meditation")).not.toBeInTheDocument();
    });
  });

  it("loads habits ordered by name by default and allows changing the order", async () => {
    listHabitsMock.mockResolvedValue({
      habits: [
        createHabit({ id: "habit_b", title: "Breathing" }),
        createHabit({ id: "habit_a", title: "Meditation" })
      ]
    });
    primeSharedMocks();
    useForgeShellMock.mockReturnValue({
      selectedUserIds: [],
      refresh: vi.fn().mockResolvedValue(undefined),
      snapshot: {
        goals: [],
        tasks: [],
        users: [habitUser],
        dashboard: {
          goals: [],
          projects: [],
          notesSummaryByEntity: {}
        }
      }
    });

    renderWithProviders();

    await screen.findByText("Breathing");

    expect(listHabitsMock).toHaveBeenCalledWith({
      userIds: [],
      orderBy: "name",
      timezone: getRuntimeTimeZone()
    });

    fireEvent.click(screen.getByRole("button", { name: /name a-z/i }));
    fireEvent.click(screen.getByRole("option", { name: /needs attention/i }));

    await waitFor(() => {
      expect(listHabitsMock).toHaveBeenLastCalledWith({
        userIds: [],
        orderBy: "needs_attention",
        timezone: getRuntimeTimeZone()
      });
    });
  });

  it("survives partial cached Psyche collections and restores linked labels", async () => {
    listHabitsMock.mockResolvedValue({
      habits: [
        createHabit({
          linkedValueIds: ["value_1"],
          linkedPatternIds: ["pattern_1"],
          linkedBeliefIds: ["belief_1"],
          linkedModeIds: ["mode_1"],
          linkedReportIds: ["report_1"]
        })
      ]
    });
    getLifeForceMock.mockResolvedValue({
      lifeForce: {
        userId: "user_1",
        dateKey: "2026-04-11",
        baselineDailyAp: 200,
        dailyBudgetAp: 210,
        spentTodayAp: 72,
        remainingAp: 138,
        forecastAp: 126,
        plannedRemainingAp: 20,
        targetBandMinAp: 178.5,
        targetBandMaxAp: 210,
        instantCapacityApPerHour: 10,
        instantFreeApPerHour: 4.2,
        overloadApPerHour: 0,
        currentDrainApPerHour: 4.8,
        fatigueBufferApPerHour: 1,
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
    useForgeShellMock.mockReturnValue({
      selectedUserIds: [],
      refresh: vi.fn().mockResolvedValue(undefined),
      snapshot: {
        goals: [],
        tasks: [],
        users: [habitUser],
        dashboard: {
          goals: [],
          projects: [],
          notesSummaryByEntity: {}
        }
      }
    });

    let resolveOverview:
      | ((value: Awaited<ReturnType<typeof getPsycheOverviewMock>>) => void)
      | undefined;
    getPsycheOverviewMock.mockReturnValue(
      new Promise((resolve) => {
        resolveOverview = resolve;
      })
    );
    const client = createTestQueryClient();
    client.setQueryData(["forge-psyche-overview"], {
      overview: {
        values: [],
        patterns: [],
        behaviors: [],
        beliefs: [],
        modes: [],
        reports: []
      }
    });
    client.setQueryData(
      ["forge-psyche-overview", "entity-collections"],
      {}
    );

    renderWithProviders(client);

    expect(await screen.findByText("Meditation")).toBeInTheDocument();

    resolveOverview?.({
      overview: {
        values: [{ id: "value_1", title: "Presence" }],
        patterns: [{ id: "pattern_1", title: "Avoidance loop" }],
        behaviors: [],
        beliefs: [{ id: "belief_1", statement: "I must not fail" }],
        modes: [{ id: "mode_1", title: "Healthy adult" }],
        reports: [{ id: "report_1", title: "Weekly reflection" }]
      }
    });

    expect(await screen.findByText("Value · Presence")).toBeInTheDocument();
    expect(screen.getByText("Pattern · Avoidance loop")).toBeInTheDocument();
    expect(screen.getByText("Belief · I must not fail")).toBeInTheDocument();
    expect(screen.getByText("Mode · Healthy adult")).toBeInTheDocument();
    expect(screen.getByText("Report · Weekly reflection")).toBeInTheDocument();
  });

  it("treats a resisted negative habit as the green aligned history state", async () => {
    const todayKey = formatLocalDateKey(new Date());
    const [year, month, day] = todayKey.split("-").map(Number);
    const todayLabel = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric"
    }).format(new Date(year, month - 1, day));
    listHabitsMock.mockResolvedValue({
      habits: [
        createHabit({
          id: "habit_negative",
          title: "Late-night doomscrolling",
          polarity: "negative",
          dueToday: false,
          lastCheckInAt: `${todayKey}T09:00:00.000Z`,
          lastCheckInStatus: "missed",
          checkIns: [
            {
              id: "checkin_1",
              habitId: "habit_negative",
              dateKey: todayKey,
              status: "missed",
              note: "Closed the phone and went to sleep.",
              deltaXp: 5,
              createdAt: `${todayKey}T09:00:00.000Z`,
              updatedAt: `${todayKey}T09:00:00.000Z`
            }
          ]
        })
      ]
    });
    primeSharedMocks();
    useForgeShellMock.mockReturnValue({
      selectedUserIds: [],
      refresh: vi.fn().mockResolvedValue(undefined),
      snapshot: {
        goals: [],
        tasks: [],
        users: [habitUser],
        dashboard: {
          goals: [],
          projects: [],
          notesSummaryByEntity: {}
        }
      }
    });

    renderWithProviders();

    await screen.findByText("Late-night doomscrolling");

    const rightmostHistoryButton = screen
      .getAllByRole("button", { name: /log check-in for/i })
      .at(-1)!;
    expect(rightmostHistoryButton).toHaveAttribute(
      "aria-label",
      `Log check-in for ${todayLabel}`
    );
    fireEvent.click(rightmostHistoryButton);

    const dialog = await screen.findByRole("dialog");
    const dialogScreen = within(dialog);

    const resistedButton = await dialogScreen.findByRole("button", {
      name: /Resisted/i
    });
    const performedButton = dialogScreen.getByRole("button", {
      name: /Performed/i
    });

    expect(resistedButton).toHaveAttribute("aria-pressed", "true");
    expect(performedButton).toHaveAttribute("aria-pressed", "false");
  });

  it("saves resisted for a negative habit as the aligned missed status", async () => {
    const todayKey = formatLocalDateKey(new Date());
    createHabitCheckInMock.mockResolvedValue({
      habit: createHabit({
        id: "habit_negative",
        polarity: "negative",
        dueToday: false,
        lastCheckInAt: "2026-04-11T09:00:00.000Z",
        lastCheckInStatus: "missed",
        checkIns: []
      })
    });
    listHabitsMock.mockResolvedValue({
      habits: [
        createHabit({
          id: "habit_negative",
          title: "Late-night doomscrolling",
          polarity: "negative",
          dueToday: true,
          checkIns: []
        })
      ]
    });
    primeSharedMocks();
    useForgeShellMock.mockReturnValue({
      selectedUserIds: [],
      refresh: vi.fn().mockResolvedValue(undefined),
      snapshot: {
        goals: [],
        tasks: [],
        users: [habitUser],
        dashboard: {
          goals: [],
          projects: [],
          notesSummaryByEntity: {}
        }
      }
    });

    renderWithProviders();

    await screen.findAllByText("Late-night doomscrolling");
    fireEvent.click(await screen.findByRole("button", { name: /^Resisted$/i }));

    await waitFor(() => {
      expect(createHabitCheckInMock).toHaveBeenCalledWith("habit_negative", {
        status: "missed",
        dateKey: todayKey,
        note: undefined,
        timezone: getRuntimeTimeZone()
      });
    });
  });

  it("surfaces habit AP cost and workout-linked AP in the habits UI", async () => {
    listHabitsMock.mockResolvedValue({
      habits: [
        createHabit({
          generatedHealthEventTemplate: {
            enabled: true,
            workoutType: "mobility",
            title: "Mobility flow",
            durationMinutes: 45,
            xpReward: 0,
            tags: [],
            links: [],
            notesTemplate: ""
          }
        })
      ]
    });
    primeSharedMocks();
    useForgeShellMock.mockReturnValue({
      selectedUserIds: [],
      refresh: vi.fn().mockResolvedValue(undefined),
      snapshot: {
        goals: [],
        tasks: [],
        users: [habitUser],
        dashboard: {
          goals: [],
          projects: [],
          notesSummaryByEntity: {}
        }
      }
    });

    renderWithProviders();

    expect((await screen.findAllByText("Habit AP due")).length).toBeGreaterThan(
      0
    );
    expect(
      (await screen.findAllByText("Life Force sync")).length
    ).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText("3 AP check-in")).length
    ).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText("18 AP workout")).length
    ).toBeGreaterThan(0);
    expect((await screen.findAllByText("24 AP/h")).length).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText("72 AP / 210 AP")).length
    ).toBeGreaterThan(0);
  });

  it("uses the resolved travel day and only negative-habit outcome copy", async () => {
    const travelDateKey = "2026-07-10";
    createHabitCheckInMock.mockResolvedValue({
      habit: createHabit({ polarity: "negative" })
    });
    listHabitsMock.mockResolvedValue({
      habits: [
        createHabit({
          id: "habit_travel_negative",
          title: "Compulsive checking",
          polarity: "negative",
          timezone: "America/Los_Angeles",
          dayBoundaryMode: "travel",
          effectiveTimezone: "Pacific/Auckland",
          currentDateKey: travelDateKey
        })
      ]
    });
    primeSharedMocks();
    useForgeShellMock.mockReturnValue({
      selectedUserIds: [habitUser.id],
      refresh: vi.fn().mockResolvedValue(undefined),
      snapshot: {
        goals: [],
        tasks: [],
        users: [habitUser],
        dashboard: {
          goals: [],
          projects: [],
          notesSummaryByEntity: {}
        }
      }
    });

    renderWithProviders();

    expect(
      await screen.findByText("Travel · Pacific/Auckland")
    ).toBeInTheDocument();
    const habitTitle = screen.getAllByText("Compulsive checking").at(-1)!;
    const habitCard = habitTitle.closest(
      "[data-psyche-focus-id]"
    ) as HTMLElement;
    expect(
      within(habitCard).getByRole("button", { name: "Resisted" })
    ).toBeInTheDocument();
    expect(
      within(habitCard).getByRole("button", { name: "Performed" })
    ).toBeInTheDocument();
    fireEvent.click(
      within(habitCard).getByRole("button", { name: "Resisted" })
    );
    await waitFor(() => {
      expect(createHabitCheckInMock).toHaveBeenCalledWith(
        "habit_travel_negative",
        {
          status: "missed",
          dateKey: travelDateKey,
          note: undefined,
          timezone: getRuntimeTimeZone()
        }
      );
    });
    expect(listHabitsMock).toHaveBeenCalledWith({
      userIds: [habitUser.id],
      orderBy: "name",
      timezone: getRuntimeTimeZone()
    });
  });
});
