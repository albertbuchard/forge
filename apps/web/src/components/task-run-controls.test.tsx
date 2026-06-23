import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskRunControls } from "@/components/task-run-controls";
import type { Task, TaskRun } from "@/lib/types";

const task: Task = {
  id: "task_1",
  title: "Finish thesis methods section",
  description: "Turn the literature synthesis into a stable chapter draft.",
  level: "task",
  status: "focus",
  priority: "high",
  owner: "Albert",
  goalId: "goal_1",
  projectId: "project_1",
  parentWorkItemId: null,
  dueDate: "2026-03-22",
  effort: "deep",
  energy: "high",
  points: 80,
  plannedDurationSeconds: null,
  schedulingRules: null,
  sortOrder: 1,
  aiInstructions: "Complete the methods section in one focused writing session.",
  executionMode: null,
  acceptanceCriteria: [],
  blockerLinks: [],
  completionReport: null,
  gitRefs: [],
  completedAt: null,
  createdAt: "2026-03-22T09:00:00.000Z",
  updatedAt: "2026-03-22T09:30:00.000Z",
  tagIds: [],
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
  }
};

const activeTaskRun: TaskRun = {
  id: "run_1",
  taskId: "task_1",
  taskTitle: task.title,
  actor: "Albert",
  status: "active",
  timerMode: "planned",
  plannedDurationSeconds: 3600,
  elapsedWallSeconds: 600,
  creditedSeconds: 600,
  remainingSeconds: 3000,
  overtimeSeconds: 0,
  isCurrent: true,
  note: "Writing the discussion bridge.",
  leaseTtlSeconds: 1200,
  claimedAt: "2026-03-22T10:00:00.000Z",
  heartbeatAt: "2026-03-22T10:10:00.000Z",
  leaseExpiresAt: "2026-03-22T10:30:00.000Z",
  completedAt: null,
  releasedAt: null,
  timedOutAt: null,
  overrideReason: null,
  updatedAt: "2026-03-22T10:10:00.000Z"
};

describe("TaskRunControls", () => {
  it("starts a planned task timer with actor, note, and lease duration", async () => {
    const onClaim = vi.fn().mockResolvedValue(undefined);

    render(
      <TaskRunControls
        task={task}
        activeTaskRun={null}
        pending={false}
        errorMessage={null}
        onClaim={onClaim}
        onHeartbeat={vi.fn()}
        onComplete={vi.fn()}
        onRelease={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Actor"), { target: { value: "Aurel" } });
    fireEvent.click(screen.getByRole("button", { name: /planned session/i }));
    fireEvent.change(screen.getByLabelText("Planned minutes"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Heartbeat window"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Session note"), { target: { value: "Drafting the thesis discussion now." } });
    fireEvent.click(screen.getByRole("button", { name: /start timer/i }));

    expect(onClaim).toHaveBeenCalledWith({
      actor: "Aurel",
      timerMode: "planned",
      plannedDurationSeconds: 1800,
      isCurrent: true,
      leaseTtlSeconds: 1200,
      note: "Drafting the thesis discussion now."
    });
  });

  it("surfaces active-run controls and routes completion through the active run id", async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);

    render(
      <TaskRunControls
        task={task}
        activeTaskRun={activeTaskRun}
        pending={false}
        errorMessage={null}
        onClaim={vi.fn()}
        onHeartbeat={vi.fn()}
        onComplete={onComplete}
        onRelease={vi.fn()}
      />
    );

    expect(screen.getByText(/live work session/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /complete task/i }));

    expect(onComplete).toHaveBeenCalledWith("run_1", {
      actor: "Albert",
      note: "Writing the discussion bridge."
    });
  });
});
