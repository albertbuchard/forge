import { cleanup, render, screen } from "@testing-library/react";
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
  deleteTaskTimeboxMock,
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
  deleteTaskTimeboxMock: vi.fn(),
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
  deleteTaskTimebox: deleteTaskTimeboxMock,
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

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
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
    mockMatchMedia(false);
    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_operator"],
      patchTaskStatus: vi.fn().mockResolvedValue(undefined),
      startTaskNow: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      snapshot: {
        lifeForce: null,
        goals: [],
        tags: [
          {
            id: "tag_ship",
            name: "feature",
            color: "#60a5fa",
            createdAt: "2026-04-10T08:00:00.000Z",
            updatedAt: "2026-04-10T08:00:00.000Z"
          }
        ],
        users: [
          {
            id: "user_operator",
            kind: "human",
            handle: "albert",
            displayName: "Albert",
            description: "",
            accentColor: "#60a5fa",
            createdAt: "2026-04-10T08:00:00.000Z",
            updatedAt: "2026-04-10T08:00:00.000Z"
          },
          {
            id: "user_bot",
            kind: "bot",
            handle: "forge-bot",
            displayName: "Forge Bot",
            description: "",
            accentColor: "#f472b6",
            createdAt: "2026-04-10T08:00:00.000Z",
            updatedAt: "2026-04-10T08:00:00.000Z"
          }
        ],
        tasks: [],
        workItems: [
          {
            id: "issue_1",
            title: "Task architecture",
            description: "Parent issue",
            level: "issue",
            status: "focus",
            priority: "high",
            owner: "Albert",
            goalId: null,
            projectId: null,
            parentWorkItemId: null,
            dueDate: null,
            effort: "deep",
            energy: "high",
            points: 55,
            plannedDurationSeconds: 86400,
            schedulingRules: null,
            sortOrder: 0,
            resolutionKind: null,
            splitParentTaskId: null,
            aiInstructions: "",
            executionMode: "afk",
            acceptanceCriteria: [],
            blockerLinks: [],
            completionReport: null,
            gitRefs: [],
            completedAt: null,
            createdAt: "2026-04-10T09:00:00.000Z",
            updatedAt: "2026-04-11T09:00:00.000Z",
            tagIds: [],
            time: {
              totalTrackedSeconds: 0,
              totalCreditedSeconds: 0,
              todayCreditedSeconds: 0,
              liveTrackedSeconds: 0,
              liveCreditedSeconds: 0,
              manualAdjustedSeconds: 0,
              activeRunCount: 0
            }
          },
          {
            id: "task_1",
            title: "Deep work writeup",
            description: "Finish the spec and clean up notes.",
            level: "task",
            status: "in_progress",
            priority: "high",
            owner: "Albert",
            goalId: null,
            projectId: null,
            parentWorkItemId: "issue_1",
            dueDate: null,
            effort: "deep",
            energy: "high",
            points: 34,
            plannedDurationSeconds: 86400,
            schedulingRules: null,
            sortOrder: 1,
            resolutionKind: null,
            splitParentTaskId: null,
            aiInstructions: "Use the kanban patterns and finish in one focused AI pass.",
            executionMode: "afk",
            acceptanceCriteria: ["Given the task page, when it loads, then the new fields are visible."],
            blockerLinks: [
              {
                entityType: "task",
                entityId: "task_blocker_1",
                label: "Waiting on timer polish"
              }
            ],
            completionReport: {
              workSummary: "Added the task dossier and mobile-safe action rail.",
              modifiedFiles: [
                "src/pages/task-detail-page.tsx",
                "src/pages/task-detail-page.test.tsx"
              ],
              linkedGitRefIds: ["gitref_commit_1"]
            },
            gitRefs: [
              {
                id: "gitref_commit_1",
                workItemId: "task_1",
                refType: "commit",
                provider: "git",
                repository: "forge",
                refValue: "abc1234",
                url: null,
                displayTitle: "task detail redesign",
                createdAt: "2026-04-11T09:30:00.000Z",
                updatedAt: "2026-04-11T09:30:00.000Z"
              },
              {
                id: "gitref_branch_1",
                workItemId: "task_1",
                refType: "branch",
                provider: "git",
                repository: "forge",
                refValue: "main",
                url: "https://example.com/forge/tree/main",
                displayTitle: "main branch",
                createdAt: "2026-04-11T09:30:00.000Z",
                updatedAt: "2026-04-11T09:30:00.000Z"
              }
            ],
            completedAt: null,
            createdAt: "2026-04-10T09:00:00.000Z",
            updatedAt: "2026-04-11T09:00:00.000Z",
            tagIds: ["tag_ship"],
            time: {
              totalTrackedSeconds: 8100,
              totalCreditedSeconds: 7200,
              todayCreditedSeconds: 3600,
              liveTrackedSeconds: 900,
              liveCreditedSeconds: 600,
              manualAdjustedSeconds: 300,
              activeRunCount: 1
            },
            userId: "user_operator",
            user: {
              id: "user_operator",
              kind: "human",
              handle: "albert",
              displayName: "Albert",
              description: "",
              accentColor: "#60a5fa",
              createdAt: "2026-04-10T08:00:00.000Z",
              updatedAt: "2026-04-10T08:00:00.000Z"
            },
            assigneeUserIds: ["user_bot"],
            assignees: [
              {
                id: "user_bot",
                kind: "bot",
                handle: "forge-bot",
                displayName: "Forge Bot",
                description: "",
                accentColor: "#f472b6",
                createdAt: "2026-04-10T08:00:00.000Z",
                updatedAt: "2026-04-10T08:00:00.000Z"
              }
            ],
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
            }
          },
          {
            id: "subtask_1",
            title: "Polish badge layout",
            description: "Child subtask",
            level: "subtask",
            status: "backlog",
            priority: "medium",
            owner: "Albert",
            goalId: null,
            projectId: null,
            parentWorkItemId: "task_1",
            dueDate: null,
            effort: "light",
            energy: "low",
            points: 13,
            plannedDurationSeconds: 3600,
            schedulingRules: null,
            sortOrder: 2,
            resolutionKind: null,
            splitParentTaskId: null,
            aiInstructions: "",
            executionMode: null,
            acceptanceCriteria: [],
            blockerLinks: [],
            completionReport: null,
            gitRefs: [],
            completedAt: null,
            createdAt: "2026-04-10T09:00:00.000Z",
            updatedAt: "2026-04-11T09:00:00.000Z",
            tagIds: [],
            time: {
              totalTrackedSeconds: 0,
              totalCreditedSeconds: 0,
              todayCreditedSeconds: 0,
              liveTrackedSeconds: 0,
              liveCreditedSeconds: 0,
              manualAdjustedSeconds: 0,
              activeRunCount: 0
            }
          }
        ],
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
    deleteTaskTimeboxMock.mockResolvedValue({
      timebox: {
        id: "timebox_1"
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
        level: "task",
        status: "in_progress",
        priority: "high",
        owner: "Albert",
        goalId: null,
        projectId: null,
        parentWorkItemId: "issue_1",
        dueDate: null,
        effort: "deep",
        energy: "high",
        points: 34,
        plannedDurationSeconds: 86400,
        schedulingRules: null,
        sortOrder: 1,
        resolutionKind: null,
        splitParentTaskId: null,
        aiInstructions: "Use the kanban patterns and finish in one focused AI pass.",
        executionMode: "afk",
        acceptanceCriteria: [
          "Given the task page, when it loads, then the new fields are visible."
        ],
        blockerLinks: [
          {
            entityType: "task",
            entityId: "task_blocker_1",
            label: "Waiting on timer polish"
          }
        ],
        completionReport: {
          workSummary: "Added the task dossier and mobile-safe action rail.",
          modifiedFiles: [
            "src/pages/task-detail-page.tsx",
            "src/pages/task-detail-page.test.tsx"
          ],
          linkedGitRefIds: ["gitref_commit_1"]
        },
        gitRefs: [
          {
            id: "gitref_commit_1",
            workItemId: "task_1",
            refType: "commit",
            provider: "git",
            repository: "forge",
            refValue: "abc1234",
            url: null,
            displayTitle: "task detail redesign",
            createdAt: "2026-04-11T09:30:00.000Z",
            updatedAt: "2026-04-11T09:30:00.000Z"
          },
          {
            id: "gitref_branch_1",
            workItemId: "task_1",
            refType: "branch",
            provider: "git",
            repository: "forge",
            refValue: "main",
            url: "https://example.com/forge/tree/main",
            displayTitle: "main branch",
            createdAt: "2026-04-11T09:30:00.000Z",
            updatedAt: "2026-04-11T09:30:00.000Z"
          }
        ],
        completedAt: null,
        createdAt: "2026-04-10T09:00:00.000Z",
        updatedAt: "2026-04-11T09:00:00.000Z",
        tagIds: ["tag_ship"],
        time: {
          totalTrackedSeconds: 8100,
          totalCreditedSeconds: 7200,
          todayCreditedSeconds: 3600,
          liveTrackedSeconds: 900,
          liveCreditedSeconds: 600,
          manualAdjustedSeconds: 300,
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
          kind: "human",
          handle: "albert",
          displayName: "Albert"
        },
        assigneeUserIds: ["user_bot"],
        assignees: [
          {
            id: "user_bot",
            kind: "bot",
            handle: "forge-bot",
            displayName: "Forge Bot",
            description: "",
            accentColor: "#f472b6",
            createdAt: "2026-04-10T08:00:00.000Z",
            updatedAt: "2026-04-10T08:00:00.000Z"
          }
        ]
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
    cleanup();
    vi.clearAllMocks();
  });

  it("surfaces Action Point accounting and current Life Force context", async () => {
    renderWithProviders();

    expect(await screen.findByText("34 xp · 100 AP")).toBeInTheDocument();
    expect(screen.getByText("Execution profile")).toBeInTheDocument();
    expect(screen.getAllByText("AI session task").length).toBeGreaterThan(0);
    expect(screen.getByText("Bot collaboration live")).toBeInTheDocument();
    expect(screen.getByText("feature")).toBeInTheDocument();
    expect(screen.getByText("Waiting on timer polish")).toBeInTheDocument();
    expect(screen.getByText("Added the task dossier and mobile-safe action rail.")).toBeInTheDocument();
    expect(screen.getByText("src/pages/task-detail-page.tsx")).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open ref/i })).toHaveAttribute(
      "href",
      "https://example.com/forge/tree/main"
    );
    expect(screen.getByText("Polish badge layout")).toBeInTheDocument();
    expect(screen.getByText("Action Point load")).toBeInTheDocument();
    expect(screen.getAllByText("4.2 AP").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4.2 AP/h").length).toBeGreaterThan(0);
    expect(screen.getByText("Split it")).toBeInTheDocument();
    expect(screen.getByText("Today's Life Force context")).toBeInTheDocument();
    expect(screen.getByText("72 AP / 210 AP")).toBeInTheDocument();
    expect(screen.getAllByText("Time Box").length).toBeGreaterThan(0);
    expect(screen.getByText("Scheduled blocks")).toBeInTheDocument();
    expect(screen.getByText("Deep work tomorrow morning")).toBeInTheDocument();
    expect(screen.getByText(/Timeboxed ·/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Timeboxed ·/i })
    ).toHaveAttribute("href", "/calendar?timeboxId=timebox_1");
    expect(
      screen.getByRole("link", { name: "Open in calendar" })
    ).toHaveAttribute("href", "/calendar?timeboxId=timebox_1");
    expect(screen.getByText("Edit task scheduling")).toBeInTheDocument();
    expect(
      screen.getByText(/This task only debits the Action Points you actually worked today/i)
    ).toBeInTheDocument();
  });

  it("keeps edit and status controls visible on mobile", async () => {
    mockMatchMedia(true);
    renderWithProviders();

    expect(
      (await screen.findAllByRole("button", { name: /^Edit task$/i })).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /^Change status$/i }).length
    ).toBeGreaterThan(0);
  });
});
