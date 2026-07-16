import type { LifeForcePayload, Task, TaskRun, TaskTimebox } from "../types.js";
import {
  TODAY_PRIORITY_DEFAULT_CANDIDATE_LIMIT,
  TODAY_PRIORITY_MAX_CANDIDATES,
  todayPriorityDecisionSchema,
  type BuildTodayPriorityDecisionInput,
  type TodayEvidenceState,
  type TodayPriorityDecision,
  type TodayPriorityEvidence,
  type TodayRankedCandidate,
  type TodaySourceState
} from "../today-priority-types.js";

const STALE_AFTER_MS = 30 * 60 * 1_000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1_000;
const MINUTE_MS = 60 * 1_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_ALTERNATIVES = 3;

const PRIORITY_SCORE = {
  low: 10,
  medium: 20,
  high: 30,
  critical: 40
} as const;

const EFFORT_AP_ESTIMATE = {
  light: 12,
  deep: 30,
  marathon: 60
} as const;

interface SourceSignal {
  state: TodayEvidenceState;
  detail: string;
}

interface UserOwnedRecord {
  userId?: string | null;
  ownerUserId?: string | null;
  assigneeUserIds?: readonly string[];
}

function normalizeTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(0);
    return timeZone;
  } catch {
    return "UTC";
  }
}

function formatAge(ageMs: number) {
  const minutes = Math.max(1, Math.round(Math.abs(ageMs) / MINUTE_MS));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.round(minutes / 60);
  return `${hours} hr${hours === 1 ? "" : "s"}`;
}

function sourceSignal(
  label: string,
  timestamp: string | null | undefined,
  now: Date,
  queryState: TodaySourceState = "ready"
): SourceSignal {
  if (queryState === "loading") {
    return {
      state: "loading",
      detail: `${label} is loading and does not affect the current rank yet.`
    };
  }
  if (queryState === "error") {
    return {
      state: "error",
      detail: `${label} could not be refreshed and does not affect the current rank.`
    };
  }
  if (queryState === "partial") {
    return {
      state: "stale",
      detail: `${label} is incomplete; refresh it before relying on this signal.`
    };
  }
  if (!timestamp) {
    return {
      state: "missing",
      detail: `${label} is unavailable; treat the recommendation as limited.`
    };
  }

  const generatedAt = Date.parse(timestamp);
  if (!Number.isFinite(generatedAt)) {
    return {
      state: "missing",
      detail: `${label} has no valid timestamp; treat the recommendation as limited.`
    };
  }

  const ageMs = now.getTime() - generatedAt;
  if (ageMs < -CLOCK_SKEW_TOLERANCE_MS) {
    return {
      state: "stale",
      detail: `${label} is ahead of the server clock; refresh before relying on it.`
    };
  }
  if (ageMs > STALE_AFTER_MS) {
    return {
      state: "stale",
      detail: `${label} is ${formatAge(ageMs)} old; refresh before relying on it.`
    };
  }
  return { state: "fresh", detail: `${label} is current.` };
}

function recordMatchesUserScope(
  record: UserOwnedRecord,
  decisionUserId: string | null
) {
  if (!decisionUserId) return true;
  const explicitUserIds = [
    record.userId,
    record.ownerUserId,
    ...(record.assigneeUserIds ?? [])
  ].filter((value): value is string => Boolean(value));
  // Older pre-scoped snapshots may not carry ownership metadata yet.
  return (
    explicitUserIds.length === 0 || explicitUserIds.includes(decisionUserId)
  );
}

function capacitySourceSignal(input: {
  lifeForce: LifeForcePayload | undefined;
  now: Date;
  timeZone: string;
  queryState: TodaySourceState;
  decisionUserId: string | null;
}): SourceSignal {
  const signal = sourceSignal(
    "Life Force capacity",
    input.lifeForce?.updatedAt,
    input.now,
    input.queryState
  );
  if (signal.state !== "fresh" || !input.lifeForce) return signal;
  if (input.decisionUserId && input.lifeForce.userId !== input.decisionUserId) {
    return {
      state: "error",
      detail:
        "Life Force capacity belongs to a different user and does not affect this decision."
    };
  }

  const currentDateKey = dateKeyInTimeZone(input.now, input.timeZone);
  if (input.lifeForce.dateKey !== currentDateKey) {
    return {
      state: "stale",
      detail: `Life Force capacity is for ${input.lifeForce.dateKey}, not the current local day ${currentDateKey}; refresh before relying on it.`
    };
  }
  return signal;
}

function dateKeyInTimeZone(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${read("year")}-${read("month")}-${read("day")}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function dateKeyEpoch(dateKey: string | null) {
  if (!dateKey) {
    return Number.POSITIVE_INFINITY;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return Number.POSITIVE_INFINITY;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const epoch = Date.UTC(year, month - 1, day);
  const parsed = new Date(epoch);
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? epoch
    : Number.POSITIVE_INFINITY;
}

function dueDayDelta(dueDate: string | null, now: Date, timeZone: string) {
  const dueEpoch = dateKeyEpoch(dueDate);
  const todayEpoch = dateKeyEpoch(dateKeyInTimeZone(now, timeZone));
  if (!Number.isFinite(dueEpoch) || !Number.isFinite(todayEpoch)) {
    return null;
  }
  return Math.round((dueEpoch - todayEpoch) / DAY_MS);
}

function urgencyForTask(task: Task, now: Date, timeZone: string) {
  const dayDelta = dueDayDelta(task.dueDate, now, timeZone);
  let dueScore = 0;
  let dueDetail = "No due date adds pressure.";

  if (dayDelta !== null) {
    if (dayDelta < 0) {
      const overdueDays = Math.abs(dayDelta);
      dueScore = 50 + Math.min(overdueDays, 10);
      dueDetail = `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue.`;
    } else if (dayDelta === 0) {
      dueScore = 45;
      dueDetail = "Due today.";
    } else if (dayDelta === 1) {
      dueScore = 28;
      dueDetail = "Due tomorrow.";
    } else if (dayDelta <= 3) {
      dueScore = 18;
      dueDetail = `Due in ${dayDelta} days.`;
    } else if (dayDelta <= 7) {
      dueScore = 10;
      dueDetail = `Due in ${dayDelta} days.`;
    } else {
      dueDetail = `Due in ${dayDelta} days.`;
    }
  }

  return {
    score: PRIORITY_SCORE[task.priority] + dueScore,
    detail: `${task.priority[0]?.toUpperCase()}${task.priority.slice(1)} priority. ${dueDetail}`
  };
}

function validTime(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function timeboxForTask(
  taskId: string,
  timeboxes: TaskTimebox[],
  now: Date,
  timeZone: string
) {
  const nowMs = now.getTime();
  const dayKey = dateKeyInTimeZone(now, timeZone);

  return (
    timeboxes
      .filter((timebox) => {
        if (
          timebox.taskId !== taskId ||
          (timebox.status !== "planned" && timebox.status !== "active")
        ) {
          return false;
        }
        const startsAt = validTime(timebox.startsAt);
        const endsAt = validTime(timebox.endsAt);
        return (
          startsAt !== null &&
          endsAt !== null &&
          endsAt > startsAt &&
          dateKeyInTimeZone(new Date(startsAt), timeZone) <= dayKey &&
          dateKeyInTimeZone(new Date(endsAt - 1), timeZone) >= dayKey
        );
      })
      .sort((left, right) => {
        const leftStart = validTime(left.startsAt) ?? Number.POSITIVE_INFINITY;
        const leftEnd = validTime(left.endsAt) ?? Number.NEGATIVE_INFINITY;
        const rightStart =
          validTime(right.startsAt) ?? Number.POSITIVE_INFINITY;
        const rightEnd = validTime(right.endsAt) ?? Number.NEGATIVE_INFINITY;
        const phase = (start: number, end: number) =>
          start <= nowMs && end > nowMs ? 0 : start > nowMs ? 1 : 2;
        const leftPhase = phase(leftStart, leftEnd);
        const rightPhase = phase(rightStart, rightEnd);
        if (leftPhase !== rightPhase) {
          return leftPhase - rightPhase;
        }
        if (leftPhase === 2 && leftEnd !== rightEnd) {
          return rightEnd - leftEnd;
        }
        if (leftStart !== rightStart) {
          return leftStart - rightStart;
        }
        return stableStringCompare(left.id, right.id);
      })[0] ?? null
  );
}

function scheduleForTask(
  timebox: TaskTimebox | null,
  now: Date,
  timeZone: string
) {
  if (!timebox) {
    return { score: 0, detail: "No task timebox is scheduled today." };
  }
  const startsAt = validTime(timebox.startsAt);
  const endsAt = validTime(timebox.endsAt);
  if (startsAt === null || endsAt === null || endsAt <= startsAt) {
    return { score: 0, detail: "The task timebox has an invalid time." };
  }

  const nowMs = now.getTime();
  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit"
  });
  if (startsAt <= nowMs && endsAt > nowMs) {
    return { score: 50, detail: "Its task timebox is active now." };
  }
  if (startsAt > nowMs) {
    const minutesUntil = Math.max(
      1,
      Math.round((startsAt - nowMs) / MINUTE_MS)
    );
    return {
      score: minutesUntil <= 90 ? 40 : 25,
      detail: `Timeboxed for ${formatter.format(new Date(startsAt))}${
        minutesUntil <= 90 ? `, in ${minutesUntil} min` : ""
      }.`
    };
  }
  return { score: 8, detail: "Its task timebox elapsed earlier today." };
}

function taskRequiredAp(task: Task) {
  const measured = task.actionPointSummary?.remainingAp;
  if (typeof measured === "number" && Number.isFinite(measured)) {
    return { value: Math.max(0, measured), estimated: false };
  }
  return { value: EFFORT_AP_ESTIMATE[task.effort], estimated: true };
}

function availableCapacity(lifeForce: LifeForcePayload) {
  const values = [lifeForce.remainingAp, lifeForce.plannedRemainingAp].filter(
    (value) => Number.isFinite(value)
  );
  return values.length > 0 ? Math.max(0, Math.min(...values)) : 0;
}

function capacityForTask(
  task: Task,
  lifeForce: LifeForcePayload | undefined,
  capacitySignal: SourceSignal
) {
  const required = taskRequiredAp(task);
  if (!lifeForce || capacitySignal.state !== "fresh") {
    return {
      score: 0,
      fit: null,
      requiredAp: required.value,
      requiredApEstimated: required.estimated,
      detail: capacitySignal.detail
    };
  }

  const available = availableCapacity(lifeForce);
  const fits = required.value <= available;
  const estimateLabel = required.estimated ? "estimated " : "";
  const instantHeadroom =
    lifeForce.instantFreeApPerHour <= 0 || lifeForce.overloadApPerHour > 0
      ? " Current work rate has no free headroom."
      : "";
  return {
    score: fits ? 20 : -40,
    fit: fits,
    requiredAp: required.value,
    requiredApEstimated: required.estimated,
    detail: `${required.value} ${estimateLabel}AP required; ${available} AP remain after planned load. ${
      fits ? "Fits the current budget." : "Does not fit the current budget."
    }${instantHeadroom}`
  };
}

function activeContextForTask(input: {
  task: Task;
  activeTaskIds: Set<string>;
  directiveTaskId: string | null;
  source: SourceSignal;
}) {
  if (input.activeTaskIds.has(input.task.id)) {
    return {
      score: 70,
      hasActiveRun: true,
      detail:
        input.source.state === "fresh"
          ? "A live task run is active now."
          : `A live task run was supplied, but its surrounding task snapshot is ${input.source.state}; verify or release the run before starting other work.`
    };
  }
  if (input.source.state !== "fresh") {
    return { score: 0, hasActiveRun: false, detail: input.source.detail };
  }
  if (input.task.status === "in_progress") {
    return {
      score: 40,
      hasActiveRun: false,
      detail: "Already in progress, with no live run reported."
    };
  }
  if (input.directiveTaskId === input.task.id) {
    return {
      score: 25,
      hasActiveRun: false,
      detail: "The current Today snapshot selected this task."
    };
  }
  if (input.task.status === "focus") {
    return {
      score: 18,
      hasActiveRun: false,
      detail: "Already placed in the focus lane."
    };
  }
  return {
    score: 0,
    hasActiveRun: false,
    detail: "No active run or focus context is attached."
  };
}

function stableStringCompare(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function activeRunPrecedes(left: TaskRun, right: TaskRun) {
  if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
  const leftHeartbeat = validTime(left.heartbeatAt) ?? Number.NEGATIVE_INFINITY;
  const rightHeartbeat =
    validTime(right.heartbeatAt) ?? Number.NEGATIVE_INFINITY;
  if (leftHeartbeat !== rightHeartbeat) return rightHeartbeat - leftHeartbeat;
  const leftClaimedAt = validTime(left.claimedAt) ?? Number.NEGATIVE_INFINITY;
  const rightClaimedAt = validTime(right.claimedAt) ?? Number.NEGATIVE_INFINITY;
  return leftClaimedAt !== rightClaimedAt
    ? rightClaimedAt - leftClaimedAt
    : stableStringCompare(left.id, right.id);
}

function candidatePrecedes(
  left: TodayRankedCandidate,
  right: TodayRankedCandidate
) {
  if (left.hasActiveRun !== right.hasActiveRun) {
    return left.hasActiveRun ? -1 : 1;
  }
  const fitRank = (value: boolean | null) =>
    value === true ? 0 : value === null ? 1 : 2;
  if (fitRank(left.capacityFit) !== fitRank(right.capacityFit)) {
    return fitRank(left.capacityFit) - fitRank(right.capacityFit);
  }
  if (left.score !== right.score) return right.score - left.score;
  if (left.activeContextScore !== right.activeContextScore)
    return right.activeContextScore - left.activeContextScore;
  if (left.scheduleScore !== right.scheduleScore)
    return right.scheduleScore - left.scheduleScore;
  if (left.urgencyScore !== right.urgencyScore)
    return right.urgencyScore - left.urgencyScore;
  const leftDue = dateKeyEpoch(left.task.dueDate);
  const rightDue = dateKeyEpoch(right.task.dueDate);
  if (leftDue !== rightDue) return leftDue - rightDue;
  if (left.task.sortOrder !== right.task.sortOrder)
    return left.task.sortOrder - right.task.sortOrder;
  const titleDelta = stableStringCompare(
    left.task.title.toLowerCase(),
    right.task.title.toLowerCase()
  );
  return titleDelta !== 0
    ? titleDelta
    : stableStringCompare(left.task.id, right.task.id);
}

function buildReason(input: {
  active: ReturnType<typeof activeContextForTask>;
  urgency: ReturnType<typeof urgencyForTask>;
  schedule: ReturnType<typeof scheduleForTask>;
  capacity: ReturnType<typeof capacityForTask>;
}) {
  if (input.active.hasActiveRun) {
    return "A live run is already active, so finishing or releasing it comes before starting something else.";
  }
  const reasons: string[] = [];
  if (input.schedule.score >= 40)
    reasons.push(input.schedule.detail.replace(/\.$/, ""));
  if (input.urgency.score >= 55)
    reasons.push(input.urgency.detail.replace(/\.$/, ""));
  if (input.active.score >= 18)
    reasons.push(input.active.detail.replace(/\.$/, ""));
  if (input.capacity.fit === true)
    reasons.push("it fits the current AP budget");
  return reasons.length === 0
    ? "It has the strongest combined urgency, schedule, capacity, and current-work signal."
    : `${reasons.slice(0, 3).join("; ")}.`;
}

function dedupeTasks(tasks: Task[]) {
  const byId = new Map<string, Task>();
  for (const task of tasks) {
    if (task?.id && !byId.has(task.id)) byId.set(task.id, task);
  }
  return [...byId.values()];
}

function isOverloaded(lifeForce: LifeForcePayload | undefined) {
  return Boolean(
    lifeForce &&
    (lifeForce.remainingAp <= 0 ||
      lifeForce.plannedRemainingAp < 0 ||
      lifeForce.instantFreeApPerHour <= 0 ||
      lifeForce.overloadApPerHour > 0)
  );
}

export function buildTodayPriorityDecision({
  tasks,
  activeTaskRuns,
  userId = null,
  directiveTaskId = null,
  lifeForce,
  timeboxes = [],
  snapshotGeneratedAt,
  calendarGeneratedAt,
  calendarState = "ready",
  capacityState = "ready",
  candidateLimit = TODAY_PRIORITY_DEFAULT_CANDIDATE_LIMIT,
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}: BuildTodayPriorityDecisionInput): TodayPriorityDecision {
  const effectiveTimeZone = normalizeTimeZone(timeZone);
  const decisionUserId = userId?.trim() || null;
  const workSignal = sourceSignal(
    "Task and active-work context",
    snapshotGeneratedAt,
    now
  );
  const scheduleSignal = sourceSignal(
    "Task-timebox schedule",
    calendarGeneratedAt,
    now,
    calendarState
  );
  const capacitySignal = capacitySourceSignal({
    lifeForce,
    now,
    timeZone: effectiveTimeZone,
    queryState: capacityState,
    decisionUserId
  });
  const uniqueTasks = dedupeTasks(tasks).filter((task) =>
    recordMatchesUserScope(task, decisionUserId)
  );
  const taskById = new Map(uniqueTasks.map((task) => [task.id, task]));
  const liveRuns = activeTaskRuns
    .filter(
      (run) =>
        run.status === "active" && recordMatchesUserScope(run, decisionUserId)
    )
    .sort(activeRunPrecedes);
  const activeRun = liveRuns[0] ?? null;
  const activeTaskIds = new Set(liveRuns.map((run) => run.taskId));
  const blockedTaskCount = uniqueTasks.filter(
    (task) => task.status === "blocked"
  ).length;
  const actionableTasks = uniqueTasks.filter(
    (task) =>
      task.status === "backlog" ||
      task.status === "focus" ||
      task.status === "in_progress"
  );
  const candidateTasks = dedupeTasks([
    ...actionableTasks,
    ...liveRuns
      .map((run) => taskById.get(run.taskId))
      .filter((task): task is Task => Boolean(task))
  ]);
  const scopedTaskIds = new Set(uniqueTasks.map((task) => task.id));
  const scopedTimeboxes = timeboxes.filter(
    (timebox) =>
      scopedTaskIds.has(timebox.taskId) &&
      recordMatchesUserScope(timebox, decisionUserId)
  );

  const rankedCandidates = candidateTasks
    .map<TodayRankedCandidate>((task) => {
      const urgency = urgencyForTask(task, now, effectiveTimeZone);
      const timebox = timeboxForTask(
        task.id,
        scopedTimeboxes,
        now,
        effectiveTimeZone
      );
      const schedule =
        scheduleSignal.state === "fresh"
          ? scheduleForTask(timebox, now, effectiveTimeZone)
          : { score: 0, detail: scheduleSignal.detail };
      const capacity = capacityForTask(task, lifeForce, capacitySignal);
      const active = activeContextForTask({
        task,
        activeTaskIds,
        directiveTaskId,
        source: workSignal
      });
      const evidence: TodayPriorityEvidence[] = [
        {
          key: "urgency",
          label: "Urgency",
          state: workSignal.state,
          detail:
            workSignal.state === "fresh" ? urgency.detail : workSignal.detail
        },
        {
          key: "schedule",
          label: "Schedule",
          state: scheduleSignal.state,
          detail: schedule.detail
        },
        {
          key: "capacity",
          label: "Capacity",
          state: capacitySignal.state,
          detail: capacity.detail
        },
        {
          key: "active-context",
          label: "Active context",
          state: workSignal.state,
          detail: active.detail
        }
      ];
      return {
        task,
        score: urgency.score + schedule.score + capacity.score + active.score,
        urgencyScore: urgency.score,
        scheduleScore: schedule.score,
        capacityScore: capacity.score,
        activeContextScore: active.score,
        hasActiveRun: active.hasActiveRun,
        capacityFit: capacity.fit,
        requiredAp: capacity.requiredAp,
        requiredApEstimated: capacity.requiredApEstimated,
        timebox,
        evidence,
        reason: buildReason({ active, urgency, schedule, capacity })
      };
    })
    .sort(candidatePrecedes)
    .slice(
      0,
      Math.min(
        Math.max(Math.trunc(candidateLimit), 1),
        TODAY_PRIORITY_MAX_CANDIDATES
      )
    );

  const sourceEvidence: TodayPriorityEvidence[] = [
    {
      key: "urgency",
      label: "Urgency",
      state: workSignal.state,
      detail: workSignal.detail
    },
    {
      key: "schedule",
      label: "Schedule",
      state: scheduleSignal.state,
      detail: scheduleSignal.detail
    },
    {
      key: "capacity",
      label: "Capacity",
      state: capacitySignal.state,
      detail: capacitySignal.detail
    },
    {
      key: "active-context",
      label: "Active context",
      state: workSignal.state,
      detail: workSignal.detail
    }
  ];
  const allSignals = [workSignal, scheduleSignal, capacitySignal];
  const confidence: TodayPriorityDecision["confidence"] = allSignals.every(
    (signal) => signal.state === "fresh"
  )
    ? "full"
    : "limited";
  const needsRefresh = allSignals.some(
    (signal) =>
      signal.state === "stale" ||
      signal.state === "missing" ||
      signal.state === "error"
  );
  const isLoading = allSignals.some((signal) => signal.state === "loading");
  const base = {
    contractVersion: 1 as const,
    generatedAt: now.toISOString(),
    confidence,
    decisionUserId,
    activeRun,
    activeRunCount: liveRuns.length,
    rankedCandidates,
    blockedTaskCount,
    needsRefresh,
    isLoading
  };

  const activeTask = activeRun
    ? (taskById.get(activeRun.taskId) ?? null)
    : null;
  const activeCandidate = activeRun
    ? (rankedCandidates.find(
        (candidate) => candidate.task.id === activeRun.taskId
      ) ?? null)
    : null;
  const activeStateIsUnresolved = Boolean(
    activeRun &&
    (liveRuns.length > 1 ||
      !activeTask ||
      activeTask.status === "blocked" ||
      activeTask.status === "done")
  );

  if (activeStateIsUnresolved && activeRun) {
    let summary =
      "A live task run has no matching task in this decision scope. Verify or release it before starting other work.";
    if (liveRuns.length > 1) {
      summary = `${liveRuns.length} live task runs were supplied. Resolve the active-run conflict before starting other work.`;
    } else if (activeTask?.status === "blocked") {
      summary =
        "A live run belongs to a blocked task. Resolve the blocker or release the run before starting other work.";
    } else if (activeTask?.status === "done") {
      summary =
        "A live run belongs to a completed task. Verify completion or release the run before starting other work.";
    }
    return todayPriorityDecisionSchema.parse({
      ...base,
      mode: "unresolved-active",
      task: activeTask,
      summary,
      selectedCandidate: activeCandidate,
      alternatives: rankedCandidates
        .filter((candidate) => candidate.task.id !== activeRun.taskId)
        .slice(0, MAX_ALTERNATIVES),
      evidence: activeCandidate?.evidence ?? sourceEvidence
    });
  }

  if (rankedCandidates.length === 0) {
    return todayPriorityDecisionSchema.parse({
      ...base,
      mode: "no-work",
      task: null,
      summary:
        blockedTaskCount > 0
          ? `${blockedTaskCount} blocked task${blockedTaskCount === 1 ? " is" : "s are"} visible, but none can be started honestly.`
          : "There is no open, startable work in the selected user scope.",
      selectedCandidate: null,
      alternatives: [],
      evidence: sourceEvidence
    });
  }

  const overloadConfirmed =
    capacitySignal.state === "fresh" && isOverloaded(lifeForce);
  if (activeCandidate) {
    return todayPriorityDecisionSchema.parse({
      ...base,
      mode: "continue-active",
      task: activeCandidate.task,
      summary: overloadConfirmed
        ? "Capacity is overloaded while work is active. Finish or release the live run before adding work."
        : "One task already has a live run. Continue or release it before starting another task.",
      selectedCandidate: activeCandidate,
      alternatives: rankedCandidates
        .filter((candidate) => candidate.task.id !== activeCandidate.task.id)
        .slice(0, MAX_ALTERNATIVES),
      evidence: activeCandidate.evidence
    });
  }

  if (overloadConfirmed) {
    return todayPriorityDecisionSchema.parse({
      ...base,
      mode: "overloaded",
      task: null,
      summary:
        "Life Force reports no safe headroom for new work. Recover or revise the plan before starting another task.",
      selectedCandidate: null,
      alternatives: rankedCandidates.slice(0, MAX_ALTERNATIVES),
      evidence: rankedCandidates[0]?.evidence ?? sourceEvidence
    });
  }

  if (
    capacitySignal.state === "fresh" &&
    rankedCandidates.every((candidate) => candidate.capacityFit === false)
  ) {
    return todayPriorityDecisionSchema.parse({
      ...base,
      mode: "capacity-limited",
      task: null,
      summary:
        "No open task fits the remaining AP budget. Split a task, reduce planned load, or recover before starting.",
      selectedCandidate: null,
      alternatives: rankedCandidates.slice(0, MAX_ALTERNATIVES),
      evidence: rankedCandidates[0]?.evidence ?? sourceEvidence
    });
  }

  const selectedCandidate = rankedCandidates[0] ?? null;
  return todayPriorityDecisionSchema.parse({
    ...base,
    mode: "ready",
    task: selectedCandidate?.task ?? null,
    summary:
      confidence === "full"
        ? "The current signals agree on one next task."
        : "This is the best candidate from available data; check the limited inputs before starting.",
    selectedCandidate,
    alternatives: rankedCandidates.slice(1, MAX_ALTERNATIVES + 1),
    evidence: selectedCandidate?.evidence ?? sourceEvidence
  });
}
