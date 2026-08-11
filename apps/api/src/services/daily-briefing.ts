import { Buffer } from "node:buffer";
import { getDatabase } from "../db.js";
import {
  DAILY_BRIEFING_ACTIVITY_WINDOW_MS,
  DAILY_BRIEFING_CALENDAR_STALE_AFTER_SECONDS,
  DAILY_BRIEFING_FUTURE_TOLERANCE_SECONDS,
  DAILY_BRIEFING_LIMITS,
  dailyBriefingSchema,
  type BuildDailyBriefingInput,
  type DailyBriefing,
  type DailyBriefingActivitySource,
  type DailyBriefingActiveRunSource,
  type DailyBriefingCalendarSource,
  type DailyBriefingSection,
  type DailyBriefingStatement,
  type DailyBriefingTaskSource
} from "../daily-briefing-types.js";
import {
  buildDerivedDataProvenance,
  type DerivedDataProvenance
} from "../provenance.js";
import { readPersistedLifeForceSummary } from "./life-force.js";

type DailyBriefingScope = {
  projectIds: string[];
  tagIds: string[];
};

const PRIORITY_WEIGHT = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
} as const;

const STATUS_WEIGHT = {
  backlog: 1,
  focus: 3,
  in_progress: 4,
  blocked: 0,
  done: 0
} as const;

function boundedText(value: string, max = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max
    ? normalized
    : `${normalized.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function readDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second")
  };
}

function dateKey(
  parts: Pick<ReturnType<typeof readDateParts>, "year" | "month" | "day">
) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function zonedMidnightUtc(
  parts: Pick<ReturnType<typeof readDateParts>, "year" | "month" | "day">,
  timeZone: string
) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day);
  let candidate = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const represented = readDateParts(new Date(candidate), timeZone);
    const representedUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second
    );
    const next = candidate - (representedUtc - desired);
    if (next === candidate) break;
    candidate = next;
  }
  return new Date(candidate);
}

export function dailyBriefingDayRange(now: Date, timeZone: string) {
  const current = readDateParts(now, timeZone);
  const nextDayUtc = new Date(
    Date.UTC(current.year, current.month - 1, current.day + 1)
  );
  const next = {
    year: nextDayUtc.getUTCFullYear(),
    month: nextDayUtc.getUTCMonth() + 1,
    day: nextDayUtc.getUTCDate()
  };
  return {
    dateKey: dateKey(current),
    from: zonedMidnightUtc(current, timeZone).toISOString(),
    to: zonedMidnightUtc(next, timeZone).toISOString()
  };
}

function timestampState(
  observedAt: string | null,
  now: Date,
  staleAfterSeconds: number
): "fresh" | "stale" | "future" | "missing" {
  if (!observedAt) return "missing";
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) return "missing";
  const ageSeconds = (now.getTime() - observed) / 1_000;
  if (ageSeconds < -DAILY_BRIEFING_FUTURE_TOLERANCE_SECONDS) return "future";
  if (ageSeconds > staleAfterSeconds) return "stale";
  return "fresh";
}

function statementProvenance(input: {
  now: Date;
  observedAt: string | null;
  staleAfterSeconds: number;
  sourceId: string;
  sourceLabel: string;
  sourceKind?: DerivedDataProvenance["sources"][number]["kind"];
  detailRoute: string | null;
  evidence: DerivedDataProvenance["evidence"];
  completeness?: DerivedDataProvenance["completeness"];
  completenessReason?: string;
}) {
  const completeness = input.completeness ?? "complete";
  return buildDerivedDataProvenance({
    generatedAt: input.now.toISOString(),
    observedAt: input.observedAt,
    staleAfterSeconds: input.staleAfterSeconds,
    sourceSummary: input.sourceLabel,
    completeness,
    completenessReason:
      input.completenessReason ??
      "The cited authorized source was read completely.",
    confidence: {
      level: input.observedAt ? "high" : "unknown",
      reason: input.observedAt
        ? "The statement repeats bounded stored facts and cites their exact record identifiers."
        : "The source has no valid observation time."
    },
    sources: [
      {
        id: input.sourceId,
        label: input.sourceLabel,
        kind: input.sourceKind ?? "record",
        observedAt: input.observedAt,
        detailRoute: input.detailRoute
      }
    ],
    evidence: input.evidence.slice(
      0,
      DAILY_BRIEFING_LIMITS.evidencePerStatement
    )
  });
}

function createStatement(
  input: Omit<DailyBriefingStatement, "provenance" | "freshness"> & {
    provenance: DerivedDataProvenance;
  }
): DailyBriefingStatement {
  return {
    ...input,
    freshness: input.provenance.freshness
  };
}

function taskHref(taskId: string) {
  return `/tasks/${encodeURIComponent(taskId)}`;
}

function activityHref(event: DailyBriefingActivitySource) {
  if (event.entityType === "task") return taskHref(event.entityId);
  if (event.entityType === "project") {
    return `/projects/${encodeURIComponent(event.entityId)}`;
  }
  if (event.entityType === "goal") {
    return `/goals/${encodeURIComponent(event.entityId)}`;
  }
  if (event.entityType === "calendar_event") {
    return `/calendar?eventId=${encodeURIComponent(event.entityId)}`;
  }
  return `/activity?eventId=${encodeURIComponent(event.id)}`;
}

function dueRank(dueDate: string | null) {
  if (!dueDate) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(`${dueDate}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function sortTasks(tasks: DailyBriefingTaskSource[]) {
  return [...tasks].sort((left, right) => {
    const status = STATUS_WEIGHT[right.status] - STATUS_WEIGHT[left.status];
    if (status !== 0) return status;
    const priority =
      PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority];
    if (priority !== 0) return priority;
    const due = dueRank(left.dueDate) - dueRank(right.dueDate);
    if (due !== 0) return due;
    return left.id.localeCompare(right.id);
  });
}

function buildWorkSection(
  input: BuildDailyBriefingInput
): DailyBriefingSection {
  const now = input.now;
  const activeRuns = [...input.work.activeRuns].sort(
    (left, right) =>
      Date.parse(left.claimedAt) - Date.parse(right.claimedAt) ||
      left.id.localeCompare(right.id)
  );
  const futureRuns = activeRuns.filter(
    (run) => timestampState(run.heartbeatAt, now, 24 * 60 * 60) === "future"
  );
  const staleRuns = activeRuns.filter((run) =>
    ["stale", "missing"].includes(
      timestampState(run.heartbeatAt, now, 24 * 60 * 60)
    )
  );
  const usableRuns = activeRuns.filter(
    (run) => !futureRuns.includes(run) && !staleRuns.includes(run)
  );
  const futureTasks = input.work.tasks.filter(
    (task) =>
      timestampState(task.updatedAt, now, Number.MAX_SAFE_INTEGER) === "future"
  );
  const tasks = sortTasks(
    input.work.tasks.filter(
      (task) =>
        !futureTasks.includes(task) &&
        task.status !== "done" &&
        task.status !== "blocked"
    )
  );
  const inspectedCount = input.work.tasks.length + input.work.activeRuns.length;
  const truncated = input.work.tasksTruncated || input.work.activeRunsTruncated;

  if (usableRuns.length > 1) {
    const observedAt =
      usableRuns
        .map((run) => run.heartbeatAt)
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
    const statement = createStatement({
      id: "work-active-conflict",
      text: `${usableRuns.length} active work sessions are recorded; Forge did not choose one silently.`,
      href: "/today",
      observedAt,
      provenance: statementProvenance({
        now,
        observedAt,
        staleAfterSeconds: 24 * 60 * 60,
        sourceId: "daily-briefing-active-work",
        sourceLabel: "Authorized active work sessions",
        sourceKind: "aggregate",
        detailRoute: "/today",
        evidence: usableRuns.slice(0, 4).map((run) => ({
          label: boundedText(run.taskTitle),
          reference: `task_run:${run.id}`,
          observedAt: run.heartbeatAt
        }))
      })
    });
    return {
      key: "work",
      label: "Current work",
      status: "conflict",
      statements: [statement],
      omissionReason:
        "More than one active work session is current, so the briefing preserves the conflict instead of selecting a winner.",
      inspectedCount,
      availableCount: usableRuns.length + tasks.length
    };
  }

  const activeRun = usableRuns[0];
  const selectedTask = activeRun
    ? (input.work.tasks.find((task) => task.id === activeRun.taskId) ?? null)
    : (tasks[0] ?? null);
  if (activeRun || selectedTask) {
    const title = boundedText(
      activeRun?.taskTitle ?? selectedTask?.title ?? "Current work"
    );
    const observedAt = activeRun?.heartbeatAt ?? now.toISOString();
    const reference = activeRun
      ? `task_run:${activeRun.id}`
      : `task:${selectedTask!.id}`;
    const href = taskHref(activeRun?.taskId ?? selectedTask!.id);
    const statement = createStatement({
      id: "work-current",
      text: activeRun
        ? `Active work: ${title}.`
        : `Highest-ranked current task: ${title}.`,
      href,
      observedAt,
      provenance: statementProvenance({
        now,
        observedAt,
        staleAfterSeconds: activeRun ? 24 * 60 * 60 : 60,
        sourceId: activeRun
          ? `task-run:${activeRun.id}`
          : `task:${selectedTask!.id}`,
        sourceLabel: activeRun
          ? "Active work session"
          : "Authorized current work",
        detailRoute: href,
        evidence: [
          {
            label: title,
            reference,
            observedAt: activeRun?.heartbeatAt ?? selectedTask!.updatedAt
          }
        ],
        completeness: truncated ? "partial" : "complete",
        completenessReason: truncated
          ? "The authorized work envelope reached its published inspection cap."
          : "Every authorized work row inside the published envelope was evaluated."
      })
    });
    const partial =
      truncated ||
      futureRuns.length > 0 ||
      staleRuns.length > 0 ||
      futureTasks.length > 0;
    return {
      key: "work",
      label: "Current work",
      status: partial ? "partial" : "ready",
      statements: [statement],
      omissionReason: partial
        ? "Some work evidence was excluded because it exceeded the published cap or carried a stale, missing, or future timestamp."
        : null,
      inspectedCount,
      availableCount: usableRuns.length + tasks.length
    };
  }

  const staleOnly = staleRuns.length > 0;
  const futureOnly = futureRuns.length > 0 || futureTasks.length > 0;
  return {
    key: "work",
    label: "Current work",
    status: staleOnly
      ? "stale"
      : futureOnly
        ? "future"
        : truncated
          ? "partial"
          : "empty",
    statements: [],
    omissionReason: staleOnly
      ? futureOnly
        ? "Active-work heartbeats are stale or missing, and other work evidence is ahead of the runtime clock; none was used as current work."
        : "Active-work heartbeats are stale or missing and were not used as current work."
      : futureOnly
        ? "Work evidence is ahead of the runtime clock and was not used."
        : truncated
          ? "The authorized work envelope reached its cap without a usable current task."
          : "No authorized active, focused, or backlog task is available.",
    inspectedCount,
    availableCount: 0
  };
}

function formatEventWindow(
  event: DailyBriefingCalendarSource,
  timeZone: string
) {
  if (event.isAllDay) return "all day";
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone,
    hour: "numeric",
    minute: "2-digit"
  });
  return `${formatter.format(new Date(event.startAt))}–${formatter.format(new Date(event.endAt))}`;
}

function calendarStatement(
  event: DailyBriefingCalendarSource,
  input: BuildDailyBriefingInput
) {
  const title = boundedText(event.title);
  const href = `/calendar?eventId=${encodeURIComponent(event.id)}`;
  return createStatement({
    id: `schedule-${event.id}`,
    text: `${title}, ${formatEventWindow(event, input.timeZone)}.`,
    href,
    observedAt: event.observedAt,
    provenance: statementProvenance({
      now: input.now,
      observedAt: event.observedAt,
      staleAfterSeconds: DAILY_BRIEFING_CALENDAR_STALE_AFTER_SECONDS,
      sourceId: `calendar-event:${event.id}`,
      sourceLabel:
        event.originType === "native" || event.originType === "derived"
          ? "Local calendar record"
          : "Synchronized calendar record",
      detailRoute: href,
      evidence: [
        {
          label: title,
          reference: `calendar_event:${event.id}`,
          observedAt: event.updatedAt
        }
      ]
    })
  });
}

function eventsOverlap(
  left: DailyBriefingCalendarSource,
  right: DailyBriefingCalendarSource
) {
  return (
    Date.parse(left.startAt) < Date.parse(right.endAt) &&
    Date.parse(right.startAt) < Date.parse(left.endAt)
  );
}

function buildScheduleSection(
  input: BuildDailyBriefingInput
): DailyBriefingSection {
  if (input.schedule.omissionReason) {
    return {
      key: "schedule",
      label: "Schedule",
      status: "omitted",
      statements: [],
      omissionReason: input.schedule.omissionReason,
      inspectedCount: 0,
      availableCount: 0
    };
  }
  const ordered = [...input.schedule.events].sort(
    (left, right) =>
      Date.parse(left.startAt) - Date.parse(right.startAt) ||
      left.id.localeCompare(right.id)
  );
  const fresh = ordered.filter(
    (event) =>
      timestampState(
        event.observedAt,
        input.now,
        DAILY_BRIEFING_CALENDAR_STALE_AFTER_SECONDS
      ) === "fresh"
  );
  const stale = ordered.filter(
    (event) =>
      timestampState(
        event.observedAt,
        input.now,
        DAILY_BRIEFING_CALENDAR_STALE_AFTER_SECONDS
      ) === "stale"
  );
  const future = ordered.filter(
    (event) =>
      timestampState(
        event.observedAt,
        input.now,
        DAILY_BRIEFING_CALENDAR_STALE_AFTER_SECONDS
      ) === "future"
  );
  const missing = ordered.filter(
    (event) =>
      timestampState(
        event.observedAt,
        input.now,
        DAILY_BRIEFING_CALENDAR_STALE_AFTER_SECONDS
      ) === "missing"
  );
  const conflictPair = fresh
    .flatMap((left, index) =>
      fresh.slice(index + 1).map((right) => [left, right] as const)
    )
    .find(([left, right]) => eventsOverlap(left, right));
  const statements = fresh
    .slice(0, 3)
    .map((event) => calendarStatement(event, input));
  const excluded = stale.length + future.length + missing.length;
  const partial = input.schedule.truncated || excluded > 0;

  if (conflictPair) {
    return {
      key: "schedule",
      label: "Schedule",
      status: "conflict",
      statements,
      omissionReason: `${boundedText(conflictPair[0].title)} overlaps ${boundedText(conflictPair[1].title)}; Forge reports both and does not resolve the conflict.`,
      inspectedCount: ordered.length,
      availableCount: fresh.length
    };
  }
  if (statements.length > 0) {
    return {
      key: "schedule",
      label: "Schedule",
      status: partial ? "partial" : "ready",
      statements,
      omissionReason: partial
        ? "Some schedule evidence was excluded because it was stale, missing, future-dated, or beyond the published cap."
        : null,
      inspectedCount: ordered.length,
      availableCount: fresh.length
    };
  }
  const status =
    future.length > 0
      ? "future"
      : stale.length > 0
        ? "stale"
        : input.schedule.truncated
          ? "partial"
          : "empty";
  return {
    key: "schedule",
    label: "Schedule",
    status,
    statements: [],
    omissionReason:
      status === "future"
        ? "Calendar evidence is ahead of the runtime clock and was not used."
        : status === "stale"
          ? "Calendar evidence is older than six hours and was not used."
          : status === "partial"
            ? "The authorized schedule envelope reached its published cap without current evidence."
            : "No authorized calendar commitment overlaps this local day.",
    inspectedCount: ordered.length,
    availableCount: 0
  };
}

function buildCapacitySection(
  input: BuildDailyBriefingInput
): DailyBriefingSection {
  if (input.capacity.omissionReason) {
    return {
      key: "capacity",
      label: "Health and capacity",
      status: "omitted",
      statements: [],
      omissionReason: input.capacity.omissionReason,
      inspectedCount: 0,
      availableCount: 0
    };
  }
  const summary = input.capacity.summary;
  if (!summary) {
    return {
      key: "capacity",
      label: "Health and capacity",
      status: "empty",
      statements: [],
      omissionReason:
        "No persisted Life Force snapshot exists for this owner and local day; Forge did not create one for the briefing.",
      inspectedCount: 0,
      availableCount: 0
    };
  }
  const freshness = summary.provenance.freshness;
  if (freshness !== "fresh") {
    return {
      key: "capacity",
      label: "Health and capacity",
      status:
        freshness === "future"
          ? "future"
          : freshness === "stale"
            ? "stale"
            : "empty",
      statements: [],
      omissionReason:
        freshness === "future"
          ? "The persisted Life Force snapshot is ahead of the runtime clock and was not used."
          : freshness === "stale"
            ? "The persisted Life Force snapshot is older than 30 minutes and was not used."
            : "The persisted Life Force snapshot has no usable observation time.",
      inspectedCount: 1,
      availableCount: 0
    };
  }
  const statement = createStatement({
    id: "capacity-persisted",
    text: `Persisted Life Force: ${summary.spentTodayAp} of ${summary.dailyBudgetAp} AP used; ${summary.remainingAp} AP remain.`,
    href: "/life-force",
    observedAt: summary.provenance.observedAt,
    provenance: summary.provenance
  });
  const partial = summary.provenance.completeness !== "complete";
  return {
    key: "capacity",
    label: "Health and capacity",
    status: partial ? "partial" : "ready",
    statements: [statement],
    omissionReason: partial
      ? "The stored daily budget is available, but no persisted same-day Action Point observation supports a complete capacity statement."
      : null,
    inspectedCount: 1,
    availableCount: 1
  };
}

function buildActivitySection(
  input: BuildDailyBriefingInput
): DailyBriefingSection {
  if (input.recentActivity.omissionReason) {
    return {
      key: "recent_activity",
      label: "Recent activity",
      status: "omitted",
      statements: [],
      omissionReason: input.recentActivity.omissionReason,
      inspectedCount: 0,
      availableCount: 0
    };
  }
  const future = input.recentActivity.events.filter(
    (event) =>
      timestampState(event.createdAt, input.now, 36 * 60 * 60) === "future"
  );
  const current = input.recentActivity.events
    .filter((event) => !future.includes(event))
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.id.localeCompare(right.id)
    );
  const statements = current.slice(0, 3).map((event) => {
    const title = boundedText(event.title);
    const href = activityHref(event);
    return createStatement({
      id: `activity-${event.id}`,
      text: title,
      href,
      observedAt: event.createdAt,
      provenance: statementProvenance({
        now: input.now,
        observedAt: event.createdAt,
        staleAfterSeconds: 36 * 60 * 60,
        sourceId: `activity-event:${event.id}`,
        sourceLabel: "Authorized recent activity",
        detailRoute: href,
        evidence: [
          {
            label: title,
            reference: `activity_event:${event.id}`,
            observedAt: event.createdAt
          }
        ]
      })
    });
  });
  const partial = input.recentActivity.truncated || future.length > 0;
  if (statements.length > 0) {
    return {
      key: "recent_activity",
      label: "Recent activity",
      status: partial ? "partial" : "ready",
      statements,
      omissionReason: partial
        ? "Some recent activity was excluded because it exceeded the published cap or carried a future timestamp."
        : null,
      inspectedCount: input.recentActivity.events.length,
      availableCount: current.length
    };
  }
  return {
    key: "recent_activity",
    label: "Recent activity",
    status:
      future.length > 0
        ? "future"
        : input.recentActivity.truncated
          ? "partial"
          : "empty",
    statements: [],
    omissionReason:
      future.length > 0
        ? "Recent activity evidence is ahead of the runtime clock and was not used."
        : input.recentActivity.truncated
          ? "The authorized activity envelope reached its cap without usable recent evidence."
          : "No authorized activity was recorded in the last 36 hours.",
    inspectedCount: input.recentActivity.events.length,
    availableCount: 0
  };
}

export function buildDailyBriefing(
  input: BuildDailyBriefingInput
): DailyBriefing {
  const sections = [
    buildWorkSection(input),
    buildScheduleSection(input),
    buildCapacitySection(input),
    buildActivitySection(input)
  ] as const;
  const work = sections[0];
  const schedule = sections[1];
  const headline =
    work.statements[0]?.text ??
    schedule.statements[0]?.text ??
    "No current statement is available from the authorized evidence.";
  const statementCount = sections.reduce(
    (total, section) => total + section.statements.length,
    0
  );
  const status: DailyBriefing["status"] = sections.some(
    (section) => section.status === "conflict"
  )
    ? "conflict"
    : statementCount === 0
      ? "empty"
      : sections.some((section) => section.status !== "ready")
        ? "partial"
        : "ready";
  const briefing = dailyBriefingSchema.parse({
    contractVersion: 1,
    generatedAt: input.now.toISOString(),
    dateKey: dailyBriefingDayRange(input.now, input.timeZone).dateKey,
    timeZone: input.timeZone,
    ownerUserId: input.ownerUserId,
    status,
    headline,
    sections
  });
  const responseBytes = Buffer.byteLength(JSON.stringify({ briefing }), "utf8");
  if (responseBytes > DAILY_BRIEFING_LIMITS.responseBytes) {
    throw new Error(
      `Daily briefing response exceeds ${DAILY_BRIEFING_LIMITS.responseBytes} bytes.`
    );
  }
  return briefing;
}

function scopedTaskWhere(
  scope: DailyBriefingScope,
  params: Array<string | number>
) {
  const clauses: string[] = [];
  if (scope.projectIds.length > 0) {
    clauses.push(
      `tasks.project_id IN (${scope.projectIds.map(() => "?").join(", ")})`
    );
    params.push(...scope.projectIds);
  }
  if (scope.tagIds.length > 0) {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM task_tags
        WHERE task_tags.task_id = tasks.id
          AND task_tags.tag_id IN (${scope.tagIds.map(() => "?").join(", ")})
      )`
    );
    params.push(...scope.tagIds);
  }
  return clauses;
}

function readTasks(userId: string, scope: DailyBriefingScope) {
  const params: Array<string | number> = [userId, userId];
  const scopeClauses = scopedTaskWhere(scope, params);
  params.push(DAILY_BRIEFING_LIMITS.tasksInspected);
  const rows = getDatabase()
    .prepare(
      `SELECT tasks.id, tasks.title, tasks.status, tasks.priority,
              tasks.due_date, tasks.project_id, tasks.updated_at
       FROM tasks
       WHERE tasks.status != 'done'
         AND NOT EXISTS (
           SELECT 1 FROM deleted_entities
           WHERE deleted_entities.entity_type = 'task'
             AND deleted_entities.entity_id = tasks.id
         )
         AND (
           EXISTS (
             SELECT 1 FROM entity_owners
             WHERE entity_owners.entity_type = 'task'
               AND entity_owners.entity_id = tasks.id
               AND entity_owners.user_id = ?
           ) OR EXISTS (
             SELECT 1 FROM entity_assignments
             WHERE entity_assignments.entity_type = 'task'
               AND entity_assignments.entity_id = tasks.id
               AND entity_assignments.role = 'assignee'
               AND entity_assignments.user_id = ?
           )
         )
         ${scopeClauses.map((clause) => `AND ${clause}`).join("\n")}
       ORDER BY
         CASE tasks.status
           WHEN 'in_progress' THEN 0
           WHEN 'focus' THEN 1
           WHEN 'backlog' THEN 2
           ELSE 3
         END,
         CASE tasks.priority
           WHEN 'critical' THEN 0
           WHEN 'high' THEN 1
           WHEN 'medium' THEN 2
           ELSE 3
         END,
         CASE WHEN tasks.due_date IS NULL THEN 1 ELSE 0 END,
         tasks.due_date ASC,
         tasks.id ASC
       LIMIT ?`
    )
    .all(...params) as Array<{
    id: string;
    title: string;
    status: DailyBriefingTaskSource["status"];
    priority: DailyBriefingTaskSource["priority"];
    due_date: string | null;
    project_id: string | null;
    updated_at: string;
  }>;
  return {
    records: rows.slice(0, DAILY_BRIEFING_LIMITS.tasksPublished).map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      dueDate: row.due_date,
      projectId: row.project_id,
      updatedAt: row.updated_at
    })),
    truncated: rows.length > DAILY_BRIEFING_LIMITS.tasksPublished
  };
}

function readActiveRuns(userId: string, scope: DailyBriefingScope) {
  const params: Array<string | number> = [userId, userId];
  const scopeClauses = scopedTaskWhere(scope, params);
  params.push(DAILY_BRIEFING_LIMITS.activeRunsInspected);
  const rows = getDatabase()
    .prepare(
      `SELECT task_runs.id, task_runs.task_id, tasks.title,
              task_runs.claimed_at, task_runs.heartbeat_at
       FROM task_runs
       INNER JOIN tasks ON tasks.id = task_runs.task_id
       WHERE task_runs.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM deleted_entities
           WHERE deleted_entities.entity_type = 'task'
             AND deleted_entities.entity_id = tasks.id
         )
         AND (
           EXISTS (
             SELECT 1 FROM entity_owners
             WHERE entity_owners.entity_type = 'task'
               AND entity_owners.entity_id = tasks.id
               AND entity_owners.user_id = ?
           ) OR EXISTS (
             SELECT 1 FROM entity_assignments
             WHERE entity_assignments.entity_type = 'task'
               AND entity_assignments.entity_id = tasks.id
               AND entity_assignments.role = 'assignee'
               AND entity_assignments.user_id = ?
           )
         )
         ${scopeClauses.map((clause) => `AND ${clause}`).join("\n")}
       ORDER BY task_runs.claimed_at ASC, task_runs.id ASC
       LIMIT ?`
    )
    .all(...params) as Array<{
    id: string;
    task_id: string;
    title: string;
    claimed_at: string;
    heartbeat_at: string;
  }>;
  return {
    records: rows
      .slice(0, DAILY_BRIEFING_LIMITS.activeRunsPublished)
      .map<DailyBriefingActiveRunSource>((row) => ({
        id: row.id,
        taskId: row.task_id,
        taskTitle: row.title,
        claimedAt: row.claimed_at,
        heartbeatAt: row.heartbeat_at
      })),
    truncated: rows.length > DAILY_BRIEFING_LIMITS.activeRunsPublished
  };
}

function readSchedule(
  userId: string,
  range: ReturnType<typeof dailyBriefingDayRange>,
  now: Date
) {
  const rows = getDatabase()
    .prepare(
      `SELECT forge_events.id, forge_events.title, forge_events.start_at,
              forge_events.end_at, forge_events.is_all_day,
              forge_events.origin_type, forge_events.updated_at,
              (
                SELECT MAX(forge_event_sources.last_synced_at)
                FROM forge_event_sources
                WHERE forge_event_sources.forge_event_id = forge_events.id
              ) AS remote_observed_at
       FROM forge_events
       WHERE forge_events.deleted_at IS NULL
         AND forge_events.status != 'cancelled'
         AND forge_events.end_at > ?
         AND forge_events.start_at < ?
         AND (
           EXISTS (
             SELECT 1 FROM entity_owners
             WHERE entity_owners.entity_type = 'calendar_event'
               AND entity_owners.entity_id = forge_events.id
               AND entity_owners.user_id = ?
           ) OR EXISTS (
             SELECT 1 FROM entity_assignments
             WHERE entity_assignments.entity_type = 'calendar_event'
               AND entity_assignments.entity_id = forge_events.id
               AND entity_assignments.role = 'assignee'
               AND entity_assignments.user_id = ?
           )
         )
       ORDER BY forge_events.start_at ASC, forge_events.id ASC
       LIMIT ?`
    )
    .all(
      range.from,
      range.to,
      userId,
      userId,
      DAILY_BRIEFING_LIMITS.calendarInspected
    ) as Array<{
    id: string;
    title: string;
    start_at: string;
    end_at: string;
    is_all_day: number;
    origin_type: string;
    updated_at: string;
    remote_observed_at: string | null;
  }>;
  return {
    records: rows
      .slice(0, DAILY_BRIEFING_LIMITS.calendarPublished)
      .map<DailyBriefingCalendarSource>((row) => ({
        id: row.id,
        title: row.title,
        startAt: row.start_at,
        endAt: row.end_at,
        isAllDay: row.is_all_day === 1,
        originType: row.origin_type,
        updatedAt: row.updated_at,
        observedAt:
          row.origin_type === "native" || row.origin_type === "derived"
            ? now.toISOString()
            : row.remote_observed_at
      })),
    truncated: rows.length > DAILY_BRIEFING_LIMITS.calendarPublished
  };
}

function readRecentActivity(userId: string, now: Date) {
  const from = new Date(
    now.getTime() - DAILY_BRIEFING_ACTIVITY_WINDOW_MS
  ).toISOString();
  const futureBound = new Date(now.getTime() + 60 * 60 * 1_000).toISOString();
  const rows = getDatabase()
    .prepare(
      `SELECT activity_events.id, activity_events.entity_type,
              activity_events.entity_id, activity_events.title,
              activity_events.created_at
       FROM activity_events
       WHERE activity_events.created_at >= ?
         AND activity_events.created_at <= ?
         AND activity_events.event_type != 'activity_corrected'
         AND activity_events.entity_type != 'system'
         AND NOT EXISTS (
           SELECT 1 FROM activity_event_corrections
           WHERE activity_event_corrections.corrected_event_id = activity_events.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM deleted_entities
           WHERE deleted_entities.entity_type = activity_events.entity_type
             AND deleted_entities.entity_id = activity_events.entity_id
         )
         AND (
           EXISTS (
             SELECT 1 FROM entity_owners
             WHERE entity_owners.entity_type = activity_events.entity_type
               AND entity_owners.entity_id = activity_events.entity_id
               AND entity_owners.user_id = ?
           ) OR EXISTS (
             SELECT 1 FROM entity_assignments
             WHERE entity_assignments.entity_type = activity_events.entity_type
               AND entity_assignments.entity_id = activity_events.entity_id
               AND entity_assignments.role = 'assignee'
               AND entity_assignments.user_id = ?
           ) OR (
             activity_events.entity_type = 'task_run'
             AND EXISTS (
               SELECT 1
               FROM task_runs
               INNER JOIN entity_owners
                 ON entity_owners.entity_type = 'task'
                AND entity_owners.entity_id = task_runs.task_id
                AND entity_owners.user_id = ?
               WHERE task_runs.id = activity_events.entity_id
             )
           )
         )
       ORDER BY activity_events.created_at DESC, activity_events.id ASC
       LIMIT ?`
    )
    .all(
      from,
      futureBound,
      userId,
      userId,
      userId,
      DAILY_BRIEFING_LIMITS.activityInspected
    ) as Array<{
    id: string;
    entity_type: string;
    entity_id: string;
    title: string;
    created_at: string;
  }>;
  return {
    records: rows
      .slice(0, DAILY_BRIEFING_LIMITS.activityPublished)
      .map<DailyBriefingActivitySource>((row) => ({
        id: row.id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        title: row.title,
        createdAt: row.created_at
      })),
    truncated: rows.length > DAILY_BRIEFING_LIMITS.activityPublished
  };
}

export function readDailyBriefing(input: {
  ownerUserId: string;
  timeZone: string;
  now?: Date;
  scope?: DailyBriefingScope;
}) {
  const now = input.now ?? new Date();
  const scope = input.scope ?? { projectIds: [], tagIds: [] };
  const range = dailyBriefingDayRange(now, input.timeZone);
  const tasks = readTasks(input.ownerUserId, scope);
  const activeRuns = readActiveRuns(input.ownerUserId, scope);
  const userWideSourcesOmitted =
    scope.projectIds.length > 0 || scope.tagIds.length > 0;
  const schedule = userWideSourcesOmitted
    ? { records: [], truncated: false }
    : readSchedule(input.ownerUserId, range, now);
  const activity = userWideSourcesOmitted
    ? { records: [], truncated: false }
    : readRecentActivity(input.ownerUserId, now);
  const capacity = userWideSourcesOmitted
    ? null
    : readPersistedLifeForceSummary({
        userId: input.ownerUserId,
        dateKey: range.dateKey,
        now
      });
  const scopedOmission = userWideSourcesOmitted
    ? "This token is restricted to project or tag records, so Forge omitted user-wide schedule, capacity, and activity evidence."
    : null;

  return buildDailyBriefing({
    ownerUserId: input.ownerUserId,
    now,
    timeZone: input.timeZone,
    work: {
      tasks: tasks.records,
      activeRuns: activeRuns.records,
      tasksTruncated: tasks.truncated,
      activeRunsTruncated: activeRuns.truncated
    },
    schedule: {
      events: schedule.records,
      truncated: schedule.truncated,
      omissionReason: scopedOmission
    },
    capacity: {
      summary: capacity,
      omissionReason: scopedOmission
    },
    recentActivity: {
      events: activity.records,
      truncated: activity.truncated,
      omissionReason: scopedOmission
    }
  });
}
