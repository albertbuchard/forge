import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTodayPriorityDecisionInputSchema,
  TODAY_PRIORITY_DEFAULT_CANDIDATE_LIMIT,
  TODAY_PRIORITY_MAX_CANDIDATES,
  todayPriorityDecisionSchema
} from "./today-priority-types.js";
import {
  lifeForcePayloadSchema,
  taskRunSchema,
  taskSchema,
  taskTimeboxSchema,
  type LifeForcePayload,
  type Task,
  type TaskRun,
  type TaskTimebox
} from "./types.js";
import { buildTodayPriorityDecision } from "./services/today-priority.js";

const NOW = new Date("2026-07-15T10:00:00.000Z");
const FRESH = "2026-07-15T09:55:00.000Z";

function makeTask(id: string, overrides: Partial<Task> = {}) {
  return taskSchema.parse({
    id,
    title: id,
    description: `${id} description`,
    status: "backlog",
    priority: "medium",
    owner: "Albert",
    goalId: null,
    projectId: null,
    dueDate: null,
    effort: "light",
    energy: "steady",
    points: 10,
    sortOrder: 0,
    completedAt: null,
    createdAt: FRESH,
    updatedAt: FRESH,
    actionPointSummary: {
      costBand: "light",
      totalCostAp: 10,
      expectedDurationSeconds: 1_800,
      sustainRateApPerHour: 8,
      spentTodayAp: 0,
      spentTotalAp: 0,
      remainingAp: 10
    },
    ...overrides
  });
}

function makeLifeForce(overrides: Partial<LifeForcePayload> = {}) {
  return lifeForcePayloadSchema.parse({
    userId: "user_albert",
    dateKey: "2026-07-15",
    baselineDailyAp: 100,
    dailyBudgetAp: 100,
    spentTodayAp: 20,
    remainingAp: 80,
    forecastAp: 70,
    plannedRemainingAp: 60,
    targetBandMinAp: 10,
    targetBandMaxAp: 30,
    instantCapacityApPerHour: 20,
    instantFreeApPerHour: 12,
    overloadApPerHour: 0,
    currentDrainApPerHour: 8,
    fatigueBufferApPerHour: 2,
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
    updatedAt: FRESH,
    ...overrides
  });
}

function makeTimebox(taskId: string, overrides: Partial<TaskTimebox> = {}) {
  return taskTimeboxSchema.parse({
    id: `timebox_${taskId}`,
    taskId,
    projectId: null,
    connectionId: null,
    calendarId: null,
    remoteEventId: null,
    linkedTaskRunId: null,
    status: "planned",
    source: "manual",
    title: `${taskId} timebox`,
    startsAt: "2026-07-15T10:00:00.000Z",
    endsAt: "2026-07-15T11:00:00.000Z",
    overrideReason: null,
    createdAt: FRESH,
    updatedAt: FRESH,
    ...overrides
  });
}

function makeActiveRun(taskId: string, overrides: Partial<TaskRun> = {}) {
  return taskRunSchema.parse({
    id: `run_${taskId}`,
    taskId,
    taskTitle: taskId,
    actor: "Albert",
    status: "active",
    timerMode: "planned",
    plannedDurationSeconds: 1_800,
    elapsedWallSeconds: 300,
    creditedSeconds: 300,
    remainingSeconds: 1_500,
    overtimeSeconds: 0,
    isCurrent: true,
    note: "",
    leaseTtlSeconds: 300,
    claimedAt: FRESH,
    heartbeatAt: FRESH,
    leaseExpiresAt: "2026-07-15T10:05:00.000Z",
    completedAt: null,
    releasedAt: null,
    timedOutAt: null,
    updatedAt: FRESH,
    ...overrides
  });
}

function build(
  overrides: Partial<Parameters<typeof buildTodayPriorityDecision>[0]> = {}
) {
  return buildTodayPriorityDecision({
    tasks: [],
    activeTaskRuns: [],
    lifeForce: makeLifeForce(),
    timeboxes: [],
    snapshotGeneratedAt: FRESH,
    calendarGeneratedAt: FRESH,
    now: NOW,
    timeZone: "UTC",
    ...overrides
  });
}

describe("buildTodayPriorityDecision", () => {
  it("keeps an active run ahead of a more urgent task", () => {
    const active = makeTask("active", {
      status: "in_progress",
      priority: "low"
    });
    const overdue = makeTask("overdue", {
      priority: "critical",
      dueDate: "2026-07-14"
    });

    const decision = build({
      tasks: [overdue, active],
      activeTaskRuns: [makeActiveRun(active.id)]
    });

    assert.equal(decision.contractVersion, 1);
    assert.equal(decision.mode, "continue-active");
    assert.equal(decision.task?.id, active.id);
    assert.match(
      decision.selectedCandidate?.reason ?? "",
      /live run is already active/i
    );
  });

  it("preserves a supplied active run when the work snapshot is stale", () => {
    const task = makeTask("stale-active", { status: "in_progress" });
    const run = makeActiveRun(task.id);

    const decision = build({
      tasks: [task],
      activeTaskRuns: [run],
      snapshotGeneratedAt: "2026-07-15T08:00:00.000Z"
    });

    assert.equal(decision.mode, "continue-active");
    assert.equal(decision.confidence, "limited");
    assert.equal(decision.task?.id, task.id);
    assert.equal(decision.activeRun?.id, run.id);
    assert.equal(decision.activeRunCount, 1);
    assert.equal(decision.selectedCandidate?.hasActiveRun, true);
    assert.equal(
      decision.selectedCandidate?.evidence.find(
        (entry) => entry.key === "active-context"
      )?.state,
      "stale"
    );
  });

  it("preserves a supplied active run when work evidence is missing", () => {
    const task = makeTask("missing-evidence-active", {
      status: "in_progress"
    });

    const decision = build({
      tasks: [task],
      activeTaskRuns: [makeActiveRun(task.id)],
      snapshotGeneratedAt: null
    });

    assert.equal(decision.mode, "continue-active");
    assert.equal(decision.needsRefresh, true);
    assert.equal(decision.selectedCandidate?.hasActiveRun, true);
    assert.equal(
      decision.selectedCandidate?.evidence.find(
        (entry) => entry.key === "active-context"
      )?.state,
      "missing"
    );
  });

  for (const status of ["blocked", "done"] as const) {
    it(`returns an unresolved active state when the run task is ${status}`, () => {
      const task = makeTask(`${status}-active`, { status });
      const run = makeActiveRun(task.id);

      const decision = build({ tasks: [task], activeTaskRuns: [run] });

      assert.equal(decision.mode, "unresolved-active");
      assert.equal(decision.task?.id, task.id);
      assert.equal(decision.activeRun?.id, run.id);
      assert.equal(decision.selectedCandidate?.hasActiveRun, true);
      assert.match(
        decision.summary,
        status === "done" ? /completed task/i : /blocked task/i
      );
    });
  }

  it("returns an unresolved active state when the run task is missing", () => {
    const run = makeActiveRun("missing-task");

    const decision = build({ activeTaskRuns: [run] });

    assert.equal(decision.mode, "unresolved-active");
    assert.equal(decision.task, null);
    assert.equal(decision.selectedCandidate, null);
    assert.equal(decision.activeRun?.id, run.id);
    assert.equal(decision.activeRunCount, 1);
    assert.match(decision.summary, /no matching task/i);
  });

  it("resolves conflicting active runs deterministically", () => {
    const alpha = makeTask("active-alpha", { status: "in_progress" });
    const beta = makeTask("active-beta", { status: "in_progress" });
    const runAlpha = makeActiveRun(alpha.id, { id: "run_alpha" });
    const runBeta = makeActiveRun(beta.id, { id: "run_beta" });

    const first = build({
      tasks: [beta, alpha],
      activeTaskRuns: [runBeta, runAlpha]
    });
    const second = build({
      tasks: [alpha, beta],
      activeTaskRuns: [runAlpha, runBeta]
    });

    assert.equal(first.mode, "unresolved-active");
    assert.equal(first.activeRunCount, 2);
    assert.equal(first.activeRun?.id, "run_alpha");
    assert.equal(second.activeRun?.id, first.activeRun?.id);
    assert.match(first.summary, /2 live task runs/i);
  });

  it("isolates explicitly owned active-run evidence to the decision user", () => {
    const task = makeTask("scoped-task", {
      userId: "user_albert",
      ownerUserId: "user_albert"
    });

    const decision = build({
      userId: "user_albert",
      tasks: [
        task,
        makeTask("foreign-task", {
          userId: "user_other",
          ownerUserId: "user_other"
        })
      ],
      activeTaskRuns: [
        makeActiveRun(task.id, {
          userId: "user_other",
          ownerUserId: "user_other"
        })
      ]
    });

    assert.equal(decision.mode, "ready");
    assert.equal(decision.decisionUserId, "user_albert");
    assert.equal(decision.activeRun, null);
    assert.equal(decision.activeRunCount, 0);
    assert.equal(decision.selectedCandidate?.hasActiveRun, false);
    assert.deepEqual(
      decision.rankedCandidates.map((candidate) => candidate.task.id),
      [task.id]
    );
  });

  it("uses the schedule and AP budget instead of urgency alone", () => {
    const oversized = makeTask("oversized", {
      priority: "critical",
      dueDate: "2026-07-14",
      actionPointSummary: {
        costBand: "brutal",
        totalCostAp: 100,
        expectedDurationSeconds: 10_800,
        sustainRateApPerHour: 30,
        spentTodayAp: 0,
        spentTotalAp: 0,
        remainingAp: 100
      }
    });
    const scheduled = makeTask("scheduled", {
      status: "focus",
      priority: "high",
      dueDate: "2026-07-16",
      actionPointSummary: {
        costBand: "light",
        totalCostAp: 10,
        expectedDurationSeconds: 1_800,
        sustainRateApPerHour: 8,
        spentTodayAp: 0,
        spentTotalAp: 0,
        remainingAp: 10
      }
    });

    const decision = build({
      tasks: [oversized, scheduled],
      timeboxes: [makeTimebox(scheduled.id)]
    });

    assert.equal(decision.mode, "ready");
    assert.equal(decision.task?.id, scheduled.id);
    assert.equal(decision.selectedCandidate?.scheduleScore, 50);
    assert.equal(decision.selectedCandidate?.capacityFit, true);
  });

  it("uses the supplied timezone for due-day semantics", () => {
    const nearMidnight = new Date("2026-07-15T23:30:00.000Z");
    const task = makeTask("zurich-due", { dueDate: "2026-07-16" });

    const decision = build({
      tasks: [task],
      now: nearMidnight,
      snapshotGeneratedAt: "2026-07-15T23:29:00.000Z",
      calendarGeneratedAt: "2026-07-15T23:29:00.000Z",
      lifeForce: makeLifeForce({ updatedAt: "2026-07-15T23:29:00.000Z" }),
      timeZone: "Europe/Zurich"
    });

    assert.match(
      decision.rankedCandidates[0]?.evidence.find(
        (entry) => entry.key === "urgency"
      )?.detail ?? "",
      /due today/i
    );
  });

  it("rejects a fresh timestamp whose Life Force date is not the current local day", () => {
    const afterLocalMidnight = new Date("2026-07-15T22:30:00.000Z");
    const task = makeTask("local-day-capacity");

    const decision = build({
      userId: "user_albert",
      tasks: [task],
      now: afterLocalMidnight,
      snapshotGeneratedAt: "2026-07-15T22:29:00.000Z",
      calendarGeneratedAt: "2026-07-15T22:29:00.000Z",
      lifeForce: makeLifeForce({
        dateKey: "2026-07-15",
        updatedAt: "2026-07-15T22:29:00.000Z",
        remainingAp: 0,
        plannedRemainingAp: -10,
        instantFreeApPerHour: 0,
        overloadApPerHour: 5
      }),
      timeZone: "Europe/Zurich"
    });

    assert.equal(decision.mode, "ready");
    assert.equal(decision.selectedCandidate?.capacityFit, null);
    assert.equal(
      decision.evidence.find((entry) => entry.key === "capacity")?.state,
      "stale"
    );
    assert.match(
      decision.evidence.find((entry) => entry.key === "capacity")?.detail ?? "",
      /current local day 2026-07-16/i
    );
  });

  it("accepts the correct local Life Force day across the DST spring transition", () => {
    const afterDstJump = new Date("2026-03-29T01:15:00.000Z");
    const task = makeTask("dst-capacity");

    const decision = build({
      userId: "user_albert",
      tasks: [task],
      now: afterDstJump,
      snapshotGeneratedAt: "2026-03-29T01:14:00.000Z",
      calendarGeneratedAt: "2026-03-29T01:14:00.000Z",
      lifeForce: makeLifeForce({
        dateKey: "2026-03-29",
        updatedAt: "2026-03-29T01:14:00.000Z"
      }),
      timeZone: "Europe/Zurich"
    });

    assert.equal(decision.confidence, "full");
    assert.equal(decision.selectedCandidate?.capacityFit, true);
    assert.equal(
      decision.evidence.find((entry) => entry.key === "capacity")?.state,
      "fresh"
    );
  });

  it("rejects Life Force capacity from a different decision user", () => {
    const decision = build({
      userId: "user_other",
      tasks: [
        makeTask("owned-task", {
          userId: "user_other",
          ownerUserId: "user_other"
        })
      ]
    });

    assert.equal(decision.mode, "ready");
    assert.equal(decision.selectedCandidate?.capacityFit, null);
    assert.equal(
      decision.evidence.find((entry) => entry.key === "capacity")?.state,
      "error"
    );
    assert.match(
      decision.evidence.find((entry) => entry.key === "capacity")?.detail ?? "",
      /different user/i
    );
  });

  it("selects a timebox by the supplied local day across UTC midnight", () => {
    const now = new Date("2026-07-15T22:30:00.000Z");
    const task = makeTask("late-local-timebox", {
      actionPointSummary: {
        costBand: "light",
        totalCostAp: 10,
        expectedDurationSeconds: 1_800,
        sustainRateApPerHour: 8,
        spentTodayAp: 0,
        spentTotalAp: 0,
        remainingAp: 10
      }
    });
    const decision = build({
      tasks: [task],
      now,
      snapshotGeneratedAt: "2026-07-15T22:29:00.000Z",
      calendarGeneratedAt: "2026-07-15T22:29:00.000Z",
      lifeForce: makeLifeForce({ updatedAt: "2026-07-15T22:29:00.000Z" }),
      timeboxes: [
        makeTimebox(task.id, {
          startsAt: "2026-07-15T22:00:00.000Z",
          endsAt: "2026-07-15T23:00:00.000Z"
        })
      ],
      timeZone: "Europe/Zurich"
    });

    assert.equal(decision.selectedCandidate?.scheduleScore, 50);
    assert.match(
      decision.selectedCandidate?.evidence.find(
        (entry) => entry.key === "schedule"
      )?.detail ?? "",
      /active now/i
    );
  });

  it("rejects timeboxes whose end is not after their start", () => {
    const task = makeTask("invalid-timebox");
    const decision = build({
      tasks: [task],
      timeboxes: [
        makeTimebox(task.id, {
          id: "reverse",
          startsAt: "2026-07-15T11:00:00.000Z",
          endsAt: "2026-07-15T10:00:00.000Z"
        }),
        makeTimebox(task.id, {
          id: "zero-duration",
          startsAt: "2026-07-15T11:00:00.000Z",
          endsAt: "2026-07-15T11:00:00.000Z"
        })
      ]
    });

    assert.equal(decision.selectedCandidate?.timebox, null);
    assert.equal(decision.selectedCandidate?.scheduleScore, 0);
  });

  it("prefers the nearest upcoming timebox over elapsed ones", () => {
    const task = makeTask("ordered-timebox");
    const decision = build({
      tasks: [task],
      timeboxes: [
        makeTimebox(task.id, {
          id: "elapsed",
          startsAt: "2026-07-15T06:00:00.000Z",
          endsAt: "2026-07-15T09:30:00.000Z"
        }),
        makeTimebox(task.id, {
          id: "upcoming-later",
          startsAt: "2026-07-15T12:00:00.000Z",
          endsAt: "2026-07-15T13:00:00.000Z"
        }),
        makeTimebox(task.id, {
          id: "upcoming-nearest",
          startsAt: "2026-07-15T10:30:00.000Z",
          endsAt: "2026-07-15T11:00:00.000Z"
        })
      ]
    });

    assert.equal(decision.selectedCandidate?.timebox?.id, "upcoming-nearest");
    assert.equal(decision.selectedCandidate?.scheduleScore, 40);
  });

  it("chooses the most recently elapsed timebox when no current or upcoming one exists", () => {
    const task = makeTask("elapsed-timebox");
    const decision = build({
      tasks: [task],
      timeboxes: [
        makeTimebox(task.id, {
          id: "elapsed-earlier",
          startsAt: "2026-07-15T06:00:00.000Z",
          endsAt: "2026-07-15T08:00:00.000Z"
        }),
        makeTimebox(task.id, {
          id: "elapsed-recent",
          startsAt: "2026-07-15T08:30:00.000Z",
          endsAt: "2026-07-15T09:45:00.000Z"
        })
      ]
    });

    assert.equal(decision.selectedCandidate?.timebox?.id, "elapsed-recent");
    assert.equal(decision.selectedCandidate?.scheduleScore, 8);
  });

  it("keeps a multi-day current timebox ahead across a DST boundary", () => {
    const now = new Date("2026-03-29T01:15:00.000Z");
    const task = makeTask("dst-timebox");
    const decision = build({
      tasks: [task],
      now,
      snapshotGeneratedAt: "2026-03-29T01:14:00.000Z",
      calendarGeneratedAt: "2026-03-29T01:14:00.000Z",
      lifeForce: makeLifeForce({
        dateKey: "2026-03-29",
        updatedAt: "2026-03-29T01:14:00.000Z"
      }),
      timeboxes: [
        makeTimebox(task.id, {
          id: "elapsed-before-jump",
          startsAt: "2026-03-28T23:00:00.000Z",
          endsAt: "2026-03-29T00:45:00.000Z"
        }),
        makeTimebox(task.id, {
          id: "multi-day-current",
          startsAt: "2026-03-28T20:00:00.000Z",
          endsAt: "2026-03-29T02:00:00.000Z"
        }),
        makeTimebox(task.id, {
          id: "upcoming-after-jump",
          startsAt: "2026-03-29T03:00:00.000Z",
          endsAt: "2026-03-29T04:00:00.000Z"
        })
      ],
      timeZone: "Europe/Zurich"
    });

    assert.equal(decision.selectedCandidate?.timebox?.id, "multi-day-current");
    assert.equal(decision.selectedCandidate?.scheduleScore, 50);
  });

  it("ignores a timebox explicitly owned by a different decision user", () => {
    const task = makeTask("scoped-timebox", {
      userId: "user_albert",
      ownerUserId: "user_albert"
    });
    const decision = build({
      userId: "user_albert",
      tasks: [task],
      timeboxes: [
        makeTimebox(task.id, {
          userId: "user_other",
          ownerUserId: "user_other"
        })
      ]
    });

    assert.equal(decision.selectedCandidate?.timebox, null);
    assert.equal(decision.selectedCandidate?.scheduleScore, 0);
  });

  it("falls back safely when a caller supplies an invalid timezone", () => {
    const decision = build({
      tasks: [makeTask("invalid-timezone")],
      timeboxes: [makeTimebox("invalid-timezone")],
      timeZone: "Mars/Olympus_Mons"
    });

    assert.equal(decision.rankedCandidates.length, 1);
    assert.equal(decision.rankedCandidates[0]?.scheduleScore, 50);
  });

  it("returns an overload state without proposing a start action", () => {
    const decision = build({
      tasks: [makeTask("next")],
      lifeForce: makeLifeForce({
        remainingAp: 0,
        plannedRemainingAp: -12,
        instantFreeApPerHour: 0,
        overloadApPerHour: 6
      })
    });

    assert.equal(decision.mode, "overloaded");
    assert.equal(decision.task, null);
    assert.deepEqual(
      decision.alternatives.map((candidate) => candidate.task.id),
      ["next"]
    );
  });

  it("is deterministic across task input order", () => {
    const alpha = makeTask("task_b", { title: "Alpha" });
    const alphaSecond = makeTask("task_c", { title: "Alpha" });
    const beta = makeTask("task_a", { title: "Beta" });

    const first = build({ tasks: [beta, alphaSecond, alpha] });
    const second = build({ tasks: [alpha, beta, alphaSecond] });

    assert.deepEqual(
      first.rankedCandidates.map((candidate) => candidate.task.id),
      ["task_b", "task_c", "task_a"]
    );
    assert.deepEqual(
      second.rankedCandidates.map((candidate) => candidate.task.id),
      first.rankedCandidates.map((candidate) => candidate.task.id)
    );
  });

  it("bounds ranked candidates while preserving a stable response contract", () => {
    const tasks = Array.from({ length: 140 }, (_, index) =>
      makeTask(`task_${String(index).padStart(3, "0")}`, {
        sortOrder: index
      })
    );

    const defaultDecision = build({ tasks });
    const clampedDecision = build({ tasks, candidateLimit: 10_000 });

    assert.equal(
      defaultDecision.rankedCandidates.length,
      TODAY_PRIORITY_DEFAULT_CANDIDATE_LIMIT
    );
    assert.equal(
      clampedDecision.rankedCandidates.length,
      TODAY_PRIORITY_MAX_CANDIDATES
    );
    assert.doesNotThrow(() =>
      todayPriorityDecisionSchema.parse(defaultDecision)
    );
    assert.equal(
      buildTodayPriorityDecisionInputSchema.parse({
        tasks: [],
        activeTaskRuns: []
      }).candidateLimit,
      TODAY_PRIORITY_DEFAULT_CANDIDATE_LIMIT
    );
  });

  it("keeps a limited candidate visible while naming stale and missing evidence", () => {
    const decision = build({
      tasks: [makeTask("limited")],
      snapshotGeneratedAt: "2026-07-15T08:00:00.000Z",
      calendarState: "error",
      lifeForce: undefined
    });

    assert.equal(decision.mode, "ready");
    assert.equal(decision.confidence, "limited");
    assert.equal(decision.needsRefresh, true);
    assert.deepEqual(
      decision.evidence.map((entry) => entry.state),
      ["stale", "error", "missing", "stale"]
    );
  });

  it("distinguishes blocked-only work from an empty scope", () => {
    const blocked = build({
      tasks: [makeTask("blocked", { status: "blocked" })]
    });
    const empty = build();

    assert.equal(blocked.mode, "no-work");
    assert.equal(blocked.blockedTaskCount, 1);
    assert.match(blocked.summary, /blocked task/i);
    assert.match(empty.summary, /no open, startable work/i);
  });
});
