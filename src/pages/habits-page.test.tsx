import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HabitsPage } from "@/pages/habits-page";
import type { Habit } from "@/lib/types";

const {
  createHabitCheckInMock,
  createHabitMock,
  deleteHabitCheckInMock,
  deleteHabitMock,
  getPsycheOverviewMock,
  listHabitsMock,
  patchHabitMock,
  useForgeShellMock
} = vi.hoisted(() => ({
  createHabitCheckInMock: vi.fn(),
  createHabitMock: vi.fn(),
  deleteHabitCheckInMock: vi.fn(),
  deleteHabitMock: vi.fn(),
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
  getPsycheOverview: getPsycheOverviewMock,
  listHabits: listHabitsMock,
  patchHabit: patchHabitMock
}));

vi.mock("@/components/shell/app-shell", async () => {
  const actual =
    await vi.importActual<typeof import("@/components/shell/app-shell")>(
      "@/components/shell/app-shell"
    );
  return {
    ...actual,
    useForgeShell: useForgeShellMock
  };
});

vi.mock("@/components/notes/entity-note-count-link", () => ({
  EntityNoteCountLink: ({ count }: { count: number }) => <div>{count} notes</div>
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
    actions?: React.ReactNode;
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
  return {
    id: "habit_1",
    title: "Meditation",
    description: "Ten quiet minutes.",
    status: "active",
    polarity: "positive",
    frequency: "daily",
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
    ...overrides
  };
}

function renderWithProviders() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

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
    vi.clearAllMocks();
  });

  it("opens a delete confirmation dialog and removes the habit after confirm", async () => {
    let currentHabits = [createHabit()];
    listHabitsMock.mockImplementation(async () => ({ habits: currentHabits }));
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
      await screen.findByRole("button", { name: "Delete habit" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Meditation" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete habit" }));

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
      orderBy: "name"
    });

    fireEvent.click(screen.getByRole("button", { name: /name a-z/i }));
    fireEvent.click(screen.getByRole("option", { name: /needs attention/i }));

    await waitFor(() => {
      expect(listHabitsMock).toHaveBeenLastCalledWith({
        userIds: [],
        orderBy: "needs_attention"
      });
    });
  });

  it("treats a resisted negative habit as the green aligned history state", async () => {
    const todayKey = new Date().toISOString().slice(0, 10);
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

    fireEvent.click(
      screen.getAllByRole("button", { name: /log check-in for/i }).at(-1)!
    );

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
        dateKey: undefined,
        note: undefined
      });
    });
  });
});
