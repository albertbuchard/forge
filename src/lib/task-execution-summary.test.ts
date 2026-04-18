import { describe, expect, it } from "vitest";
import type { Task, TaskRun } from "@/lib/types";
import {
  getTaskExecutionSummary,
  getTaskStepSummary
} from "./task-execution-summary";

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_1",
    title: "Implement board refresh",
    description: "",
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
    plannedDurationSeconds: 7_200,
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
    createdAt: "2026-04-18T08:00:00.000Z",
    updatedAt: "2026-04-18T08:00:00.000Z",
    tagIds: [],
    userId: "user_operator",
    user: {
      id: "user_operator",
      kind: "human",
      handle: "albert",
      displayName: "Albert",
      description: "",
      accentColor: "#c0c1ff",
      createdAt: "2026-04-18T08:00:00.000Z",
      updatedAt: "2026-04-18T08:00:00.000Z"
    },
    ownerUserId: "user_operator",
    ownerUser: null,
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
    actionPointSummary: {
      costBand: "standard",
      totalCostAp: 100,
      expectedDurationSeconds: 7_200,
      sustainRateApPerHour: 50,
      spentTodayAp: 0,
      spentTotalAp: 0,
      remainingAp: 100
    },
    splitSuggestion: {
      shouldSplit: false,
      reason: null,
      thresholdSeconds: 172_800
    },
    ...overrides
  };
}

function buildRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: "run_1",
    taskId: "task_1",
    taskTitle: "Implement board refresh",
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
    claimedAt: "2026-04-18T08:00:00.000Z",
    heartbeatAt: "2026-04-18T08:10:00.000Z",
    leaseExpiresAt: "2026-04-18T08:25:00.000Z",
    completedAt: null,
    releasedAt: null,
    timedOutAt: null,
    overrideReason: null,
    updatedAt: "2026-04-18T08:10:00.000Z",
    userId: "user_bot",
    user: null,
    gitContext: {
      provider: "github",
      repository: "aurel/forge",
      branch: "agent/board-refresh",
      baseBranch: "main",
      branchUrl: "https://github.com/aurel/forge/tree/agent/board-refresh",
      pullRequestUrl: "https://github.com/aurel/forge/pull/42",
      pullRequestNumber: 42,
      compareUrl:
        "https://github.com/aurel/forge/compare/main...agent/board-refresh"
    },
    ...overrides
  };
}

describe("getTaskStepSummary", () => {
  it("prefers acceptance criteria when they exist", () => {
    const summary = getTaskStepSummary(
      buildTask({
        acceptanceCriteria: ["Render grouped in-progress cards", "Show branch chips"]
      })
    );

    expect(summary).toEqual({
      total: 2,
      completed: 0,
      source: "acceptance_criteria",
      items: ["Render grouped in-progress cards", "Show branch chips"]
    });
  });

  it("parses markdown checklist progress from AI instructions", () => {
    const summary = getTaskStepSummary(
      buildTask({
        aiInstructions:
          "- [x] Add task-run git context\n- [ ] Redesign the board lane\n- [ ] Update tests"
      })
    );

    expect(summary?.total).toBe(3);
    expect(summary?.completed).toBe(1);
    expect(summary?.source).toBe("ai_instructions");
  });
});

describe("getTaskExecutionSummary", () => {
  it("prefers active run git context over stored git refs", () => {
    const task = buildTask({
      completionReport: {
        modifiedFiles: ["src/components/execution-board.tsx", "server/src/repositories/task-runs.ts"],
        workSummary: "Updated the board and run tracking.",
        linkedGitRefIds: ["gitref_pr_1"]
      },
      gitRefs: [
        {
          id: "gitref_branch_1",
          workItemId: "task_1",
          refType: "branch",
          provider: "git",
          repository: "legacy/repo",
          refValue: "legacy-branch",
          url: null,
          displayTitle: "Legacy branch",
          createdAt: "2026-04-18T08:00:00.000Z",
          updatedAt: "2026-04-18T08:00:00.000Z"
        },
        {
          id: "gitref_pr_1",
          workItemId: "task_1",
          refType: "pull_request",
          provider: "github",
          repository: "aurel/forge",
          refValue: "42",
          url: "https://github.com/aurel/forge/pull/42",
          displayTitle: "PR #42",
          createdAt: "2026-04-18T08:00:00.000Z",
          updatedAt: "2026-04-18T08:00:00.000Z"
        }
      ]
    });

    const summary = getTaskExecutionSummary(task, buildRun());

    expect(summary.actor).toBe("Forge Bot");
    expect(summary.changedFileCount).toBe(2);
    expect(summary.git.branch).toBe("agent/board-refresh");
    expect(summary.git.repository).toBe("aurel/forge");
    expect(summary.git.pullRequestNumber).toBe(42);
    expect(summary.git.linkedRefCount).toBe(1);
  });
});
