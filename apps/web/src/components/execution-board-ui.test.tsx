import { MemoryRouter } from "react-router-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import type { Goal, NotesSummaryByEntity, Tag, Task, TaskRun } from "@/lib/types";
import {
  buildExecutionBoardTaskMenuItems,
  ExecutionBoard
} from "./execution-board";

describe("ExecutionBoard card surface", () => {
  it("renders AP badges and opens the split action from the card", () => {
    const task: Task = {
      id: "task_1",
      title: "Split-ready task",
      description: "A task that has outgrown its shape.",
      level: "task",
      status: "focus",
      priority: "high",
      owner: "Albert",
      goalId: "goal_1",
      projectId: "project_1",
      parentWorkItemId: null,
      dueDate: null,
      effort: "deep",
      energy: "steady",
      points: 90,
      plannedDurationSeconds: 86_400,
      schedulingRules: null,
      sortOrder: 0,
      resolutionKind: null,
      splitParentTaskId: null,
      aiInstructions: "Split this work into execution-ready steps.",
      executionMode: null,
      acceptanceCriteria: [],
      blockerLinks: [],
      completionReport: null,
      gitRefs: [],
      completedAt: null,
      createdAt: "2026-04-11T08:00:00.000Z",
      updatedAt: "2026-04-11T08:00:00.000Z",
      tagIds: ["tag_1"],
      userId: "user_operator",
      user: {
        id: "user_operator",
        kind: "human",
        handle: "albert",
        displayName: "Albert",
        description: "",
        accentColor: "#c0c1ff",
        createdAt: "2026-04-11T08:00:00.000Z",
        updatedAt: "2026-04-11T08:00:00.000Z"
      },
      assigneeUserIds: [],
      assignees: [],
      time: {
        totalTrackedSeconds: 0,
        totalCreditedSeconds: 9_000,
        liveTrackedSeconds: 0,
        liveCreditedSeconds: 0,
        manualAdjustedSeconds: 0,
        activeRunCount: 0,
        hasCurrentRun: false,
        currentRunId: null
      },
      actionPointSummary: {
        costBand: "standard",
        totalCostAp: 100,
        expectedDurationSeconds: 86_400,
        sustainRateApPerHour: 100 / 24,
        spentTodayAp: 10,
        spentTotalAp: 24,
        remainingAp: 76
      },
      splitSuggestion: {
        shouldSplit: true,
        reason: "The current live plan would push this task beyond twice its expected duration.",
        thresholdSeconds: 172_800
      }
    };
    const goal = {
      id: "goal_1",
      title: "Ship Forge",
      description: "",
      status: "active",
      horizon: "lifetime",
      targetPoints: 120,
      themeColor: "#c0c1ff",
      createdAt: "2026-04-11T08:00:00.000Z",
      updatedAt: "2026-04-11T08:00:00.000Z",
      tagIds: [],
      owner: "Albert",
      userId: "user_operator",
      user: task.user
    } as unknown as Goal;
    const tag = {
      id: "tag_1",
      name: "Deep work",
      color: "#7dd3fc",
      kind: "execution",
      description: ""
    } as unknown as Tag;
    const notesSummaryByEntity: NotesSummaryByEntity = {};
    const onSplitTask = vi.fn();
    const activeRun: TaskRun = {
      id: "run_1",
      taskId: task.id,
      taskTitle: task.title,
      actor: "Forge Bot",
      status: "active",
      timerMode: "planned",
      plannedDurationSeconds: 3_600,
      elapsedWallSeconds: 600,
      creditedSeconds: 600,
      remainingSeconds: 3_000,
      overtimeSeconds: 0,
      isCurrent: true,
      note: "",
      leaseTtlSeconds: 900,
      claimedAt: "2026-04-11T08:00:00.000Z",
      heartbeatAt: "2026-04-11T08:10:00.000Z",
      leaseExpiresAt: "2026-04-11T08:25:00.000Z",
      completedAt: null,
      releasedAt: null,
      timedOutAt: null,
      overrideReason: null,
      updatedAt: "2026-04-11T08:10:00.000Z",
      userId: "user_operator",
      user: task.user,
      gitContext: {
        provider: "github",
        repository: "aurel/forge",
        branch: "agent/split-ready-task",
        baseBranch: "main",
        branchUrl: "https://github.com/aurel/forge/tree/agent/split-ready-task",
        pullRequestUrl: null,
        pullRequestNumber: null,
        compareUrl:
          "https://github.com/aurel/forge/compare/main...agent/split-ready-task"
      }
    };

    render(
      <MemoryRouter>
        <I18nProvider locale="en">
          <ExecutionBoard
            tasks={[task]}
            activeRuns={[activeRun]}
            goals={[goal]}
            tags={[tag]}
            selectedTaskId={task.id}
            onMove={vi.fn(async () => {})}
            onSelectTask={vi.fn()}
            onSplitTask={onSplitTask}
            notesSummaryByEntity={notesSummaryByEntity}
          />
        </I18nProvider>
      </MemoryRouter>
    );

    expect(screen.getByText("100 AP")).toBeInTheDocument();
    expect(screen.getByText("24 h target")).toBeInTheDocument();
    expect(screen.getByText("Forge Bot")).toBeInTheDocument();
    expect(screen.getByText("agent/split-ready-task")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /split split-ready task/i })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /split split-ready task/i })
    );

    expect(onSplitTask).toHaveBeenCalledWith("task_1");
  });

  it("shows a stop control for tasks with an active run and releases that run", () => {
    const task: Task = {
      id: "task_2",
      title: "Live task",
      description: "Currently active in the run bar.",
      level: "task",
      status: "in_progress",
      priority: "high",
      owner: "Albert",
      goalId: "goal_1",
      projectId: "project_1",
      parentWorkItemId: null,
      dueDate: null,
      effort: "deep",
      energy: "steady",
      points: 60,
      plannedDurationSeconds: 3_600,
      schedulingRules: null,
      sortOrder: 0,
      resolutionKind: null,
      splitParentTaskId: null,
      aiInstructions: "",
      executionMode: null,
      acceptanceCriteria: [],
      blockerLinks: [],
      completionReport: null,
      gitRefs: [],
      completedAt: null,
      createdAt: "2026-04-11T08:00:00.000Z",
      updatedAt: "2026-04-11T08:00:00.000Z",
      tagIds: [],
      userId: "user_operator",
      user: {
        id: "user_operator",
        kind: "human",
        handle: "albert",
        displayName: "Albert",
        description: "",
        accentColor: "#c0c1ff",
        createdAt: "2026-04-11T08:00:00.000Z",
        updatedAt: "2026-04-11T08:00:00.000Z"
      },
      assigneeUserIds: [],
      assignees: [],
      time: {
        totalTrackedSeconds: 0,
        totalCreditedSeconds: 1_200,
        liveTrackedSeconds: 1_200,
        liveCreditedSeconds: 1_200,
        manualAdjustedSeconds: 0,
        activeRunCount: 1,
        hasCurrentRun: true,
        currentRunId: "run_2"
      },
      actionPointSummary: undefined,
      splitSuggestion: undefined
    };
    const goal = {
      id: "goal_1",
      title: "Ship Forge",
      description: "",
      status: "active",
      horizon: "lifetime",
      targetPoints: 120,
      themeColor: "#c0c1ff",
      createdAt: "2026-04-11T08:00:00.000Z",
      updatedAt: "2026-04-11T08:00:00.000Z",
      tagIds: [],
      owner: "Albert",
      userId: "user_operator",
      user: task.user
    } as unknown as Goal;
    const activeRun: TaskRun = {
      id: "run_2",
      taskId: task.id,
      taskTitle: task.title,
      actor: "Albert",
      status: "active",
      timerMode: "planned",
      plannedDurationSeconds: 3_600,
      elapsedWallSeconds: 1_200,
      creditedSeconds: 1_200,
      remainingSeconds: 2_400,
      overtimeSeconds: 0,
      isCurrent: true,
      note: "",
      leaseTtlSeconds: 900,
      claimedAt: "2026-04-11T08:00:00.000Z",
      heartbeatAt: "2026-04-11T08:20:00.000Z",
      leaseExpiresAt: "2026-04-11T08:35:00.000Z",
      completedAt: null,
      releasedAt: null,
      timedOutAt: null,
      overrideReason: null,
      updatedAt: "2026-04-11T08:20:00.000Z",
      userId: "user_operator",
      user: task.user,
      gitContext: null
    };
    const onStopTask = vi.fn(async () => {});

    render(
      <MemoryRouter>
        <I18nProvider locale="en">
          <ExecutionBoard
            tasks={[task]}
            activeRuns={[activeRun]}
            goals={[goal]}
            tags={[]}
            selectedTaskId={task.id}
            onMove={vi.fn(async () => {})}
            onSelectTask={vi.fn()}
            onStopTask={onStopTask}
          />
        </I18nProvider>
      </MemoryRouter>
    );

    expect(
      screen.getByRole("button", { name: /stop work on live task/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /start work on live task/i })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /stop work on live task/i })
    );

    expect(onStopTask).toHaveBeenCalledWith(activeRun);
  });

  it("includes a delete action in the task menu contract", () => {
    const task: Task = {
      id: "task_3",
      title: "Menu deletable task",
      description: "Should be deletable from the kanban actions menu.",
      level: "task",
      status: "focus",
      priority: "medium",
      owner: "Albert",
      goalId: "goal_1",
      projectId: "project_1",
      parentWorkItemId: null,
      dueDate: null,
      effort: "light",
      energy: "steady",
      points: 30,
      plannedDurationSeconds: 1_800,
      schedulingRules: null,
      sortOrder: 0,
      resolutionKind: null,
      splitParentTaskId: null,
      aiInstructions: "",
      executionMode: null,
      acceptanceCriteria: [],
      blockerLinks: [],
      completionReport: null,
      gitRefs: [],
      completedAt: null,
      createdAt: "2026-04-11T08:00:00.000Z",
      updatedAt: "2026-04-11T08:00:00.000Z",
      tagIds: [],
      userId: "user_operator",
      user: {
        id: "user_operator",
        kind: "human",
        handle: "albert",
        displayName: "Albert",
        description: "",
        accentColor: "#c0c1ff",
        createdAt: "2026-04-11T08:00:00.000Z",
        updatedAt: "2026-04-11T08:00:00.000Z"
      },
      assigneeUserIds: [],
      assignees: [],
      time: {
        totalTrackedSeconds: 0,
        totalCreditedSeconds: 0,
        liveTrackedSeconds: 0,
        liveCreditedSeconds: 0,
        manualAdjustedSeconds: 0,
        activeRunCount: 0,
        hasCurrentRun: false,
        currentRunId: null
      },
      actionPointSummary: undefined,
      splitSuggestion: undefined
    };
    const goal = {
      id: "goal_1",
      title: "Ship Forge",
      description: "",
      status: "active",
      horizon: "lifetime",
      targetPoints: 120,
      themeColor: "#c0c1ff",
      createdAt: "2026-04-11T08:00:00.000Z",
      updatedAt: "2026-04-11T08:00:00.000Z",
      tagIds: [],
      owner: "Albert",
      userId: "user_operator",
      user: task.user
    } as unknown as Goal;
    const onRequestDelete = vi.fn();
    const items = buildExecutionBoardTaskMenuItems({
      task,
      onMove: vi.fn(),
      onDeleteTask: vi.fn(async () => {}),
      deletePendingTaskId: null,
      onRequestDelete
    });
    const deleteItem = items.find((item) => item.id === "delete-task");

    expect(deleteItem?.label).toBe("Delete task");
    deleteItem?.onSelect();
    expect(onRequestDelete).toHaveBeenCalledWith(task);
  });
});
