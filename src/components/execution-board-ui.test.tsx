import { MemoryRouter } from "react-router-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import type { Goal, NotesSummaryByEntity, Tag, Task } from "@/lib/types";
import { ExecutionBoard } from "./execution-board";

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

    render(
      <MemoryRouter>
        <I18nProvider locale="en">
          <ExecutionBoard
            tasks={[task]}
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
    expect(
      screen.getByRole("button", { name: /split split-ready task/i })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /split split-ready task/i })
    );

    expect(onSplitTask).toHaveBeenCalledWith("task_1");
  });
});
