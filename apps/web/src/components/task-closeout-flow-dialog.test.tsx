import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTaskCloseoutDraft,
  buildTaskCloseoutEvidencePayload,
  buildTaskCloseoutSubmission,
  getModifiedFileValidationError,
  TaskCloseoutFlowDialog,
  type TaskCloseoutDraft
} from "@/components/task-closeout-flow-dialog";
import type { Task, TaskRun } from "@/lib/types";

vi.mock("@/lib/note-link-options", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/note-link-options")
  >("@/lib/note-link-options");
  return {
    ...actual,
    searchNoteLinkOptions: vi.fn(async () => [])
  };
});

const task: Task = {
  id: "task_1",
  title: "Ship the task closeout",
  description: "Keep the completion record inspectable.",
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
  points: 80,
  plannedDurationSeconds: null,
  schedulingRules: null,
  sortOrder: 1,
  aiInstructions: "",
  executionMode: null,
  acceptanceCriteria: [],
  blockerLinks: [],
  completionReport: null,
  closeoutState: "not_applicable",
  gitRefs: [],
  completedAt: null,
  createdAt: "2026-07-16T08:00:00.000Z",
  updatedAt: "2026-07-16T08:00:00.000Z",
  tagIds: [],
  assigneeUserIds: [],
  assignees: [],
  time: {
    totalTrackedSeconds: 0,
    totalCreditedSeconds: 0,
    liveTrackedSeconds: 0,
    liveCreditedSeconds: 0,
    manualAdjustedSeconds: 0,
    activeRunCount: 1,
    hasCurrentRun: true,
    currentRunId: "run_1"
  }
};

const activeTaskRun: TaskRun = {
  id: "run_1",
  taskId: task.id,
  taskTitle: task.title,
  actor: "Albert",
  status: "active",
  timerMode: "planned",
  plannedDurationSeconds: 3_600,
  elapsedWallSeconds: 1_200,
  creditedSeconds: 1_080,
  remainingSeconds: 2_400,
  overtimeSeconds: 0,
  isCurrent: true,
  note: "Finishing the closeout flow.",
  leaseTtlSeconds: 900,
  claimedAt: "2026-07-16T08:00:00.000Z",
  heartbeatAt: "2026-07-16T08:15:00.000Z",
  leaseExpiresAt: "2026-07-16T08:30:00.000Z",
  completedAt: null,
  releasedAt: null,
  timedOutAt: null,
  overrideReason: null,
  updatedAt: "2026-07-16T08:15:00.000Z"
};

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(max-width: 1023px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("task closeout model", () => {
  it("rejects unsafe or non-relative modified-file evidence", () => {
    expect(getModifiedFileValidationError("apps/web/src/a.tsx")).toBeNull();
    expect(getModifiedFileValidationError("../secrets.txt")).toMatch(
      /repository-relative/i
    );
    expect(getModifiedFileValidationError("C:\\secrets.txt")).toMatch(
      /backslashes/i
    );
  });

  it("builds an atomic evidence submission with durable generic links", () => {
    const draft: TaskCloseoutDraft = {
      ...buildTaskCloseoutDraft(task, activeTaskRun, true),
      workSummary: "  The closeout now preserves evidence.  ",
      modifiedFilesText: "apps/web/a.tsx\napps/web/a.tsx\napps/api/b.ts",
      gitRefs: [
        {
          id: "gitref_1",
          workItemId: task.id,
          refType: "commit",
          provider: "github",
          repository: "owner/repo",
          refValue: "abc123",
          url: "https://github.com/owner/repo/commit/abc123",
          displayTitle: "abc123"
        }
      ],
      noteMode: "create",
      noteContentMarkdown: "  Verification and handoff.  ",
      noteAuthor: " Albert ",
      linkedValues: ["artifact:artifact_1", "invalid"],
      completedTodayMinutes: "45"
    };

    expect(buildTaskCloseoutSubmission(task.id, draft, true)).toEqual({
      mode: "capture_now",
      completionReport: {
        modifiedFiles: ["apps/web/a.tsx", "apps/api/b.ts"],
        workSummary: "The closeout now preserves evidence.",
        linkedGitRefIds: ["gitref_1"]
      },
      gitRefs: draft.gitRefs,
      closeoutNote: {
        contentMarkdown: "Verification and handoff.",
        author: "Albert",
        links: [
          { entityType: "task", entityId: task.id, anchorKey: null },
          {
            entityType: "artifact",
            entityId: "artifact_1",
            anchorKey: null
          }
        ]
      },
      completedTodayWorkSeconds: 2_700
    });
  });

  it("makes deferred evidence explicit and omits stale closeout fields", () => {
    const draft: TaskCloseoutDraft = {
      ...buildTaskCloseoutDraft(task, activeTaskRun, false),
      mode: "defer",
      workSummary: "A stale draft that must not be submitted",
      completedTodayMinutes: "0"
    };

    expect(buildTaskCloseoutSubmission(task.id, draft, false)).toEqual({
      mode: "defer",
      completedTodayWorkSeconds: undefined
    });
    expect(
      buildTaskCloseoutEvidencePayload(
        buildTaskCloseoutSubmission(task.id, draft, false)
      )
    ).toEqual({
      completionReport: {
        modifiedFiles: [],
        workSummary: "",
        linkedGitRefIds: []
      },
      gitRefs: []
    });
  });
});

describe("TaskCloseoutFlowDialog", () => {
  it("blocks an evidence closeout until the result is stated", () => {
    render(
      <TaskCloseoutFlowDialog
        open
        task={task}
        activeTaskRun={activeTaskRun}
        selectedUserIds={["user_1"]}
        requireWorkTime={false}
        pending={false}
        error={null}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Write the completed result"
    );
  });

  it("can deliberately defer evidence and close the active run", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskCloseoutFlowDialog
        open
        task={task}
        activeTaskRun={activeTaskRun}
        selectedUserIds={["user_1"]}
        requireWorkTime={false}
        pending={false}
        error={null}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /finish and defer evidence/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /complete task/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        mode: "defer",
        completedTodayWorkSeconds: undefined
      });
    });
  });
});
