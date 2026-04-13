import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskDetailPage } from "@/pages/task-detail-page";

const {
  completeTaskRunMock,
  createTaskTimeboxMock,
  createWorkAdjustmentMock,
  deleteTaskMock,
  getCalendarOverviewMock,
  getLifeForceMock,
  getTaskContextMock,
  patchTaskTimeboxMock,
  patchTaskMock,
  recommendTaskTimeboxesMock,
  releaseTaskRunMock,
  removeActivityLogMock,
  uncompleteTaskMock,
  useForgeShellMock
} = vi.hoisted(() => ({
  completeTaskRunMock: vi.fn(),
  createTaskTimeboxMock: vi.fn(),
  createWorkAdjustmentMock: vi.fn(),
  deleteTaskMock: vi.fn(),
  getCalendarOverviewMock: vi.fn(),
  getLifeForceMock: vi.fn(),
  getTaskContextMock: vi.fn(),
  patchTaskTimeboxMock: vi.fn(),
  patchTaskMock: vi.fn(),
  recommendTaskTimeboxesMock: vi.fn(),
  releaseTaskRunMock: vi.fn(),
  removeActivityLogMock: vi.fn(),
  uncompleteTaskMock: vi.fn(),
  useForgeShellMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  completeTaskRun: completeTaskRunMock,
  createTaskTimebox: createTaskTimeboxMock,
  createWorkAdjustment: createWorkAdjustmentMock,
  deleteTask: deleteTaskMock,
  getCalendarOverview: getCalendarOverviewMock,
  getLifeForce: getLifeForceMock,
  getTaskContext: getTaskContextMock,
  patchTaskTimebox: patchTaskTimeboxMock,
  patchTask: patchTaskMock,
  recommendTaskTimeboxes: recommendTaskTimeboxesMock,
  releaseTaskRun: releaseTaskRunMock,
  removeActivityLog: removeActivityLogMock,
  uncompleteTask: uncompleteTaskMock
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

vi.mock("@/components/experience/surface-skeleton", () => ({
  SurfaceSkeleton: () => <div>Loading…</div>
}));

vi.mock("@/components/calendar/task-scheduling-dialog", () => ({
  TaskSchedulingDialog: () => null
}));

vi.mock("@/components/experience/sheet-scaffold", () => ({
  SheetScaffold: ({ children }: { children: ReactNode }) => <div>{children}</div>
}));

vi.mock("@/components/knowledge-graph/open-in-graph-button", () => ({
  OpenInGraphButton: () => <button type="button">Graph</button>
}));

vi.mock("@/components/notes/note-markdown", () => ({
  NoteMarkdown: ({ markdown }: { markdown: string }) => <div>{markdown}</div>
}));

vi.mock("@/components/notes/entity-notes-surface", () => ({
  EntityNotesSurface: () => <div>Notes surface</div>
}));

vi.mock("@/components/preferences/preference-entity-handoff-button", () => ({
  PreferenceEntityHandoffButton: () => <button type="button">Preference</button>
}));

vi.mock("@/components/task-dialog", () => ({
  TaskDialog: () => null
}));

vi.mock("@/components/work-adjustment-dialog", () => ({
  WorkAdjustmentDialog: () => null
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    titleText,
    description,
    badge,
    actions
  }: {
    titleText: string;
    description: ReactNode;
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

vi.mock("@/components/ui/entity-name", () => ({
  EntityName: ({ label }: { label: string }) => <span>{label}</span>
}));

vi.mock("@/components/ui/user-badge", () => ({
  UserBadge: ({ user }: { user?: { displayName?: string } | null }) =>
    user?.displayName ? <span>{user.displayName}</span> : null
}));

vi.mock("@/components/ui/page-state", () => ({
  ErrorState: ({ error }: { error: Error }) => <div>{error.message}</div>
}));

vi.mock("@/components/ui/info-tooltip", () => ({
  InfoTooltip: () => null
}));

function renderWithProviders() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/tasks/task_1"]}>
        <Routes>
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("TaskDetailPage", () => {
  beforeEach(() => {
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
    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_operator"],
      patchTaskStatus: vi.fn().mockResolvedValue(undefined),
      startTaskNow: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      snapshot: {
        lifeForce: null,
        goals: [],
        tags: [],
        users: [],
        dashboard: {
          projects: []
        }
      }
    });
    getCalendarOverviewMock.mockResolvedValue({
      calendar: {
        generatedAt: "2026-04-11T08:00:00.000Z",
        providers: [],
        connections: [],
        calendars: [],
        events: [],
        workBlockTemplates: [],
        workBlockInstances: [],
        timeboxes: [
          {
            id: "timebox_1",
            taskId: "task_1",
            projectId: null,
            connectionId: null,
            calendarId: null,
            remoteEventId: null,
            linkedTaskRunId: null,
            status: "planned",
            source: "manual",
            title: "Deep work tomorrow morning",
            startsAt: "2026-04-12T09:00:00.000Z",
            endsAt: "2026-04-12T10:00:00.000Z",
            overrideReason: "Protected block",
            actionProfile: null,
            createdAt: "2026-04-11T08:00:00.000Z",
            updatedAt: "2026-04-11T08:00:00.000Z",
            userId: "user_operator",
            user: null
          }
        ]
      }
    });
    createTaskTimeboxMock.mockResolvedValue({
      timebox: {
        id: "timebox_1",
        taskId: "task_1",
        projectId: null,
        connectionId: null,
        calendarId: null,
        remoteEventId: null,
        linkedTaskRunId: null,
        status: "planned",
        source: "manual",
        title: "Deep work writeup",
        startsAt: "2026-04-11T09:00:00.000Z",
        endsAt: "2026-04-11T10:00:00.000Z",
        overrideReason: null,
        actionProfile: null,
        createdAt: "2026-04-11T08:00:00.000Z",
        updatedAt: "2026-04-11T08:00:00.000Z",
        userId: "user_operator",
        user: null
      }
    });
    recommendTaskTimeboxesMock.mockResolvedValue({ timeboxes: [] });
    getLifeForceMock.mockResolvedValue({
      lifeForce: {
        userId: "user_operator",
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
        topTaskIdsNeedingSplit: ["task_1"],
        updatedAt: "2026-04-11T12:00:00.000Z"
      },
      templates: []
    });
    getTaskContextMock.mockResolvedValue({
      task: {
        id: "task_1",
        title: "Deep work writeup",
        description: "Finish the spec and clean up notes.",
        status: "in_progress",
        priority: "p1",
        owner: "Albert",
        goalId: null,
        projectId: null,
        dueDate: null,
        effort: "medium",
        energy: "deep",
        points: 34,
        plannedDurationSeconds: 86400,
        schedulingRules: null,
        sortOrder: 1,
        resolutionKind: null,
        splitParentTaskId: null,
        completedAt: null,
        createdAt: "2026-04-10T09:00:00.000Z",
        updatedAt: "2026-04-11T09:00:00.000Z",
        tagIds: [],
        time: {
          totalCreditedSeconds: 7200,
          todayCreditedSeconds: 3600,
          activeRunCount: 1
        },
        actionPointSummary: {
          costBand: "standard",
          totalCostAp: 100,
          expectedDurationSeconds: 86400,
          sustainRateApPerHour: 4.17,
          spentTodayAp: 4.17,
          spentTotalAp: 8.33,
          remainingAp: 91.67
        },
        splitSuggestion: {
          shouldSplit: true,
          reason: "Projected work exceeds the default healthy threshold.",
          thresholdSeconds: 172800
        },
        userId: "user_operator",
        user: {
          id: "user_operator",
          displayName: "Albert"
        }
      },
      goal: null,
      project: null,
      activeTaskRun: null,
      taskRuns: [],
      activity: [],
      notesSummaryByEntity: {}
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces Action Point accounting and current Life Force context", async () => {
    renderWithProviders();

    expect(await screen.findByText("34 xp · 100 AP")).toBeInTheDocument();
    expect(screen.getByText("Action Point load")).toBeInTheDocument();
    expect(screen.getAllByText("4.2 AP").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4.2 AP/h").length).toBeGreaterThan(0);
    expect(screen.getByText("Split it")).toBeInTheDocument();
    expect(screen.getByText("Today's Life Force context")).toBeInTheDocument();
    expect(screen.getByText("72 AP / 210 AP")).toBeInTheDocument();
    expect(screen.getAllByText("Time Box").length).toBeGreaterThan(0);
    expect(screen.getByText("Scheduled blocks")).toBeInTheDocument();
    expect(screen.getByText("Deep work tomorrow morning")).toBeInTheDocument();
    expect(screen.getByText("Edit task scheduling")).toBeInTheDocument();
    expect(
      screen.getByText(/This task only debits the Action Points you actually worked today/i)
    ).toBeInTheDocument();
  });
});
