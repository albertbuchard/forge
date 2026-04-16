import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import {
  createGeneratedWorkoutFromHabit,
  parseGeneratedHealthEventTemplate
} from "../health.js";
import {
  decorateOwnedEntity,
  inferFirstOwnedUserId,
  setEntityOwner
} from "./entity-ownership.js";
import { getGoalById } from "./goals.js";
import { getProjectById } from "./projects.js";
import {
  getBehaviorById,
  getBehaviorPatternById,
  getBeliefEntryById,
  getModeProfileById,
  getPsycheValueById,
  getTriggerReportById
} from "./psyche.js";
import { getTaskById } from "./tasks.js";
import { recordActivityEvent } from "./activity-events.js";
import {
  filterDeletedEntities,
  filterDeletedIds,
  isEntityDeleted
} from "./deleted-entities.js";
import {
  recordHabitCheckInReward,
  reverseLatestHabitCheckInReward
} from "./rewards.js";
import {
  createHabitCheckInSchema,
  createHabitSchema,
  habitCheckInSchema,
  habitSchema,
  updateHabitSchema,
  type ActivitySource,
  type CreateHabitCheckInInput,
  type CreateHabitInput,
  type Habit,
  type HabitCheckIn,
  type HabitListQuery,
  type UpdateHabitInput
} from "../types.js";

type HabitRow = {
  id: string;
  title: string;
  description: string;
  status: Habit["status"];
  polarity: Habit["polarity"];
  frequency: Habit["frequency"];
  target_count: number;
  week_days_json: string;
  linked_goal_ids_json: string;
  linked_project_ids_json: string;
  linked_task_ids_json: string;
  linked_value_ids_json: string;
  linked_pattern_ids_json: string;
  linked_behavior_ids_json: string;
  linked_belief_ids_json: string;
  linked_mode_ids_json: string;
  linked_report_ids_json: string;
  linked_behavior_id: string | null;
  reward_xp: number;
  penalty_xp: number;
  generated_health_event_template_json: string;
  created_at: string;
  updated_at: string;
};

type HabitCheckInRow = {
  id: string;
  habit_id: string;
  date_key: string;
  status: HabitCheckIn["status"];
  note: string;
  delta_xp: number;
  created_at: string;
  updated_at: string;
};

type ActivityContext = {
  source: ActivitySource;
  actor?: string | null;
};

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function parseWeekDays(raw: string): number[] {
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter(
        (value): value is number =>
          Number.isInteger(value) && value >= 0 && value <= 6
      )
    : [];
}

function parseIdList(raw: string): string[] {
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0
      )
    : [];
}

function uniqueIds(values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0
      )
    )
  ];
}

function normalizeLinkedBehaviorIds(input: {
  linkedBehaviorIds?: string[] | null;
  linkedBehaviorId?: string | null;
}) {
  const fromArray = Array.isArray(input.linkedBehaviorIds)
    ? input.linkedBehaviorIds
    : [];
  return uniqueIds([...fromArray, input.linkedBehaviorId ?? null]);
}

function validateExistingIds(
  ids: string[],
  getById: (id: string) => unknown,
  code: string,
  label: string
) {
  for (const id of ids) {
    if (!getById(id)) {
      throw new HttpError(404, code, `${label} ${id} does not exist`);
    }
  }
}

function mapCheckIn(row: HabitCheckInRow): HabitCheckIn {
  return habitCheckInSchema.parse({
    id: row.id,
    habitId: row.habit_id,
    dateKey: row.date_key,
    status: row.status,
    note: row.note,
    deltaXp: row.delta_xp,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function listCheckInsForHabit(habitId: string, limit = 14): HabitCheckIn[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, habit_id, date_key, status, note, delta_xp, created_at, updated_at
       FROM habit_check_ins
       WHERE habit_id = ?
       ORDER BY date_key DESC, created_at DESC
       LIMIT ?`
    )
    .all(habitId, limit) as HabitCheckInRow[];
  return rows.map(mapCheckIn);
}

function isAligned(
  habit: Pick<Habit, "polarity">,
  checkIn: Pick<HabitCheckIn, "status">
) {
  return (
    (habit.polarity === "positive" && checkIn.status === "done") ||
    (habit.polarity === "negative" && checkIn.status === "missed")
  );
}

function calculateCompletionRate(
  habit: Pick<Habit, "polarity">,
  checkIns: HabitCheckIn[]
) {
  if (checkIns.length === 0) {
    return 0;
  }
  const aligned = checkIns.filter((checkIn) =>
    isAligned(habit, checkIn)
  ).length;
  return Math.round((aligned / checkIns.length) * 100);
}

function calculateStreak(
  habit: Pick<Habit, "polarity" | "frequency" | "weekDays" | "targetCount">,
  checkIns: HabitCheckIn[],
  now = new Date()
) {
  if (habit.frequency === "weekly" && habit.weekDays.length === 0) {
    return 0;
  }

  const statusByDate = new Map<string, HabitCheckIn["status"]>();
  for (const checkIn of checkIns) {
    if (!statusByDate.has(checkIn.dateKey)) {
      statusByDate.set(checkIn.dateKey, checkIn.status);
    }
  }

  const isScheduledOn = (date: Date) =>
    habit.frequency === "daily" || habit.weekDays.includes(date.getUTCDay());
  const toDateKey = (date: Date) => date.toISOString().slice(0, 10);
  const atUtcDayStart = (date: Date) =>
    new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
  const previousScheduledDate = (date: Date) => {
    const cursor = atUtcDayStart(date);
    do {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    } while (!isScheduledOn(cursor));
    return cursor;
  };
  const startOfUtcWeek = (date: Date) => {
    const start = atUtcDayStart(date);
    const offset = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - offset);
    return start;
  };
  const previousUtcWeek = (date: Date) => {
    const start = startOfUtcWeek(date);
    start.setUTCDate(start.getUTCDate() - 7);
    return start;
  };
  const alignedStatusOn = (date: Date) => {
    const status = statusByDate.get(toDateKey(date));
    return status ? isAligned(habit, { status }) : false;
  };

  if (habit.frequency === "daily") {
    const today = atUtcDayStart(now);
    let cursor =
      isScheduledOn(today) && !statusByDate.has(toDateKey(today))
        ? previousScheduledDate(today)
        : today;

    let streak = 0;
    while (alignedStatusOn(cursor)) {
      streak += 1;
      cursor = previousScheduledDate(cursor);
    }
    return streak;
  }

  const alignedCountForWeek = (weekStart: Date) => {
    let count = 0;
    for (let offset = 0; offset < 7; offset += 1) {
      const day = new Date(weekStart);
      day.setUTCDate(weekStart.getUTCDate() + offset);
      if (isScheduledOn(day) && alignedStatusOn(day)) {
        count += 1;
      }
    }
    return count;
  };

  const currentWeekStart = startOfUtcWeek(now);
  let cursor =
    alignedCountForWeek(currentWeekStart) >= habit.targetCount
      ? currentWeekStart
      : previousUtcWeek(currentWeekStart);
  let streak = 0;

  while (alignedCountForWeek(cursor) >= habit.targetCount) {
    streak += 1;
    cursor = previousUtcWeek(cursor);
  }

  return streak;
}

function isHabitDueToday(
  habit: Pick<Habit, "status" | "frequency" | "weekDays">,
  latestCheckIn: HabitCheckIn | null,
  now = new Date()
) {
  if (habit.status !== "active") {
    return false;
  }
  const key = todayKey(now);
  if (latestCheckIn?.dateKey === key) {
    return false;
  }
  if (habit.frequency === "daily") {
    return true;
  }
  return habit.weekDays.includes(now.getUTCDay());
}

function mapHabit(
  row: HabitRow,
  checkIns = listCheckInsForHabit(row.id)
): Habit {
  const latestCheckIn = checkIns[0] ?? null;
  const linkedBehaviorIds = normalizeLinkedBehaviorIds({
    linkedBehaviorIds: parseIdList(row.linked_behavior_ids_json),
    linkedBehaviorId: row.linked_behavior_id
  });
  const linkedBehaviors = linkedBehaviorIds
    .map((behaviorId) => getBehaviorById(behaviorId))
    .filter(
      (behavior): behavior is NonNullable<typeof behavior> =>
        behavior !== undefined
    );
  const draft = {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    polarity: row.polarity,
    frequency: row.frequency,
    targetCount: row.target_count,
    weekDays: parseWeekDays(row.week_days_json),
    linkedGoalIds: filterDeletedIds("goal", parseIdList(row.linked_goal_ids_json)),
    linkedProjectIds: filterDeletedIds(
      "project",
      parseIdList(row.linked_project_ids_json)
    ),
    linkedTaskIds: filterDeletedIds("task", parseIdList(row.linked_task_ids_json)),
    linkedValueIds: parseIdList(row.linked_value_ids_json),
    linkedPatternIds: parseIdList(row.linked_pattern_ids_json),
    linkedBehaviorIds,
    linkedBeliefIds: parseIdList(row.linked_belief_ids_json),
    linkedModeIds: parseIdList(row.linked_mode_ids_json),
    linkedReportIds: parseIdList(row.linked_report_ids_json),
    linkedBehaviorId: linkedBehaviorIds[0] ?? null,
    linkedBehaviorTitle: linkedBehaviors[0]?.title ?? null,
    linkedBehaviorTitles: linkedBehaviors.map((behavior) => behavior.title),
    rewardXp: row.reward_xp,
    penaltyXp: row.penalty_xp,
    generatedHealthEventTemplate: parseGeneratedHealthEventTemplate(
      row.generated_health_event_template_json
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckInAt: latestCheckIn?.createdAt ?? null,
    lastCheckInStatus: latestCheckIn?.status ?? null,
    streakCount: calculateStreak(
      {
        polarity: row.polarity,
        frequency: row.frequency,
        targetCount: row.target_count,
        weekDays: parseWeekDays(row.week_days_json)
      },
      checkIns
    ),
    completionRate: calculateCompletionRate(
      { polarity: row.polarity },
      checkIns
    ),
    dueToday: false,
    checkIns
  };

  draft.dueToday = isHabitDueToday(
    {
      status: draft.status,
      frequency: draft.frequency,
      weekDays: draft.weekDays
    },
    latestCheckIn
  );
  return habitSchema.parse(decorateOwnedEntity("habit", draft));
}

function getHabitRow(habitId: string): HabitRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT
         id, title, description, status, polarity, frequency, target_count, week_days_json,
         linked_goal_ids_json, linked_project_ids_json, linked_task_ids_json,
         linked_value_ids_json, linked_pattern_ids_json, linked_behavior_ids_json,
         linked_belief_ids_json, linked_mode_ids_json, linked_report_ids_json,
         linked_behavior_id, reward_xp, penalty_xp, generated_health_event_template_json, created_at, updated_at
       FROM habits
       WHERE id = ?`
    )
    .get(habitId) as HabitRow | undefined;
}

function compareDateDesc(left: string | null, right: string | null) {
  return new Date(right ?? 0).getTime() - new Date(left ?? 0).getTime();
}

function compareDateAsc(left: string | null, right: string | null) {
  return new Date(left ?? 0).getTime() - new Date(right ?? 0).getTime();
}

function sortHabits(habits: Habit[], orderBy: HabitListQuery["orderBy"]) {
  const nextHabits = [...habits];

  nextHabits.sort((left, right) => {
    if (orderBy === "name") {
      return (
        left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) ||
        compareDateDesc(left.createdAt, right.createdAt)
      );
    }

    if (orderBy === "streak") {
      return (
        right.streakCount - left.streakCount ||
        Number(right.dueToday) - Number(left.dueToday) ||
        left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
      );
    }

    if (orderBy === "created_at") {
      return (
        compareDateDesc(left.createdAt, right.createdAt) ||
        left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
      );
    }

    if (orderBy === "updated_at") {
      return (
        compareDateDesc(left.updatedAt, right.updatedAt) ||
        left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
      );
    }

    return (
      Number(right.dueToday) - Number(left.dueToday) ||
      compareDateAsc(left.lastCheckInAt, right.lastCheckInAt) ||
      compareDateDesc(left.updatedAt, right.updatedAt) ||
      left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
    );
  });

  return nextHabits;
}

export function listHabits(filters: HabitListQuery = {}): Habit[] {
  const parsed = filters;
  const whereClauses: string[] = [];
  const params: Array<string | number> = [];
  if (parsed.status) {
    whereClauses.push("status = ?");
    params.push(parsed.status);
  }
  if (parsed.polarity) {
    whereClauses.push("polarity = ?");
    params.push(parsed.polarity);
  }
  const limitSql = parsed.limit ? "LIMIT ?" : "";
  if (parsed.limit) {
    params.push(parsed.limit);
  }
  const whereSql =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const rows = getDatabase()
    .prepare(
      `SELECT
         id, title, description, status, polarity, frequency, target_count, week_days_json,
         linked_goal_ids_json, linked_project_ids_json, linked_task_ids_json,
         linked_value_ids_json, linked_pattern_ids_json, linked_behavior_ids_json,
         linked_belief_ids_json, linked_mode_ids_json, linked_report_ids_json,
         linked_behavior_id, reward_xp, penalty_xp, generated_health_event_template_json, created_at, updated_at
       FROM habits
       ${whereSql}
       ORDER BY
         CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
         updated_at DESC
       ${limitSql}`
    )
    .all(...params) as HabitRow[];
  const habits = filterDeletedEntities(
    "habit",
    rows.map((row) => mapHabit(row))
  );
  const filteredHabits = parsed.dueToday
    ? habits.filter((habit) => habit.dueToday)
    : habits;
  return sortHabits(filteredHabits, parsed.orderBy);
}

export function getHabitById(habitId: string): Habit | undefined {
  if (isEntityDeleted("habit", habitId)) {
    return undefined;
  }
  const row = getHabitRow(habitId);
  return row ? mapHabit(row) : undefined;
}

export function createHabit(
  input: CreateHabitInput,
  activity?: ActivityContext
): Habit {
  const parsed = createHabitSchema.parse(input);
  const linkedBehaviorIds = normalizeLinkedBehaviorIds(parsed);
  validateExistingIds(
    parsed.linkedGoalIds,
    getGoalById,
    "goal_not_found",
    "Goal"
  );
  validateExistingIds(
    parsed.linkedProjectIds,
    getProjectById,
    "project_not_found",
    "Project"
  );
  validateExistingIds(
    parsed.linkedTaskIds,
    getTaskById,
    "task_not_found",
    "Task"
  );
  validateExistingIds(
    parsed.linkedValueIds,
    getPsycheValueById,
    "value_not_found",
    "Value"
  );
  validateExistingIds(
    parsed.linkedPatternIds,
    getBehaviorPatternById,
    "pattern_not_found",
    "Pattern"
  );
  validateExistingIds(
    linkedBehaviorIds,
    getBehaviorById,
    "behavior_not_found",
    "Behavior"
  );
  validateExistingIds(
    parsed.linkedBeliefIds,
    getBeliefEntryById,
    "belief_not_found",
    "Belief"
  );
  validateExistingIds(
    parsed.linkedModeIds,
    getModeProfileById,
    "mode_not_found",
    "Mode"
  );
  validateExistingIds(
    parsed.linkedReportIds,
    getTriggerReportById,
    "report_not_found",
    "Report"
  );
  return runInTransaction(() => {
    const now = new Date().toISOString();
    const id = `habit_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
      .prepare(
        `INSERT INTO habits (
          id, title, description, status, polarity, frequency, target_count, week_days_json,
          linked_goal_ids_json, linked_project_ids_json, linked_task_ids_json,
          linked_value_ids_json, linked_pattern_ids_json, linked_behavior_ids_json,
          linked_belief_ids_json, linked_mode_ids_json, linked_report_ids_json,
          linked_behavior_id, reward_xp, penalty_xp, generated_health_event_template_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        parsed.title,
        parsed.description,
        parsed.status,
        parsed.polarity,
        parsed.frequency,
        parsed.targetCount,
        JSON.stringify(parsed.weekDays),
        JSON.stringify(parsed.linkedGoalIds),
        JSON.stringify(parsed.linkedProjectIds),
        JSON.stringify(parsed.linkedTaskIds),
        JSON.stringify(parsed.linkedValueIds),
        JSON.stringify(parsed.linkedPatternIds),
        JSON.stringify(linkedBehaviorIds),
        JSON.stringify(parsed.linkedBeliefIds),
        JSON.stringify(parsed.linkedModeIds),
        JSON.stringify(parsed.linkedReportIds),
        linkedBehaviorIds[0] ?? null,
        parsed.rewardXp,
        parsed.penaltyXp,
        JSON.stringify(parsed.generatedHealthEventTemplate),
        now,
        now
      );
    setEntityOwner(
      "habit",
      id,
      parsed.userId ??
        inferFirstOwnedUserId([
          ...parsed.linkedProjectIds.map((entityId) => ({
            entityType: "project",
            entityId
          })),
          ...parsed.linkedGoalIds.map((entityId) => ({
            entityType: "goal",
            entityId
          })),
          ...parsed.linkedTaskIds.map((entityId) => ({
            entityType: "task",
            entityId
          }))
        ])
    );
    const habit = getHabitById(id)!;
    if (activity) {
      recordActivityEvent({
        entityType: "habit",
        entityId: habit.id,
        eventType: "habit_created",
        title: `Habit created: ${habit.title}`,
        description: `${habit.frequency === "daily" ? "Daily" : "Weekly"} ${habit.polarity} habit added to Forge.`,
        actor: activity.actor ?? null,
        source: activity.source,
        metadata: {
          polarity: habit.polarity,
          frequency: habit.frequency,
          targetCount: habit.targetCount
        }
      });
    }
    return habit;
  });
}

export function updateHabit(
  habitId: string,
  input: UpdateHabitInput,
  activity?: ActivityContext
): Habit | undefined {
  const current = getHabitById(habitId);
  if (!current) {
    return undefined;
  }
  const parsed = updateHabitSchema.parse(input);
  const nextLinkedBehaviorIds =
    parsed.linkedBehaviorIds !== undefined ||
    parsed.linkedBehaviorId !== undefined
      ? normalizeLinkedBehaviorIds({
          linkedBehaviorIds:
            parsed.linkedBehaviorIds ?? current.linkedBehaviorIds,
          linkedBehaviorId:
            parsed.linkedBehaviorId === undefined
              ? current.linkedBehaviorId
              : parsed.linkedBehaviorId
        })
      : current.linkedBehaviorIds;
  validateExistingIds(
    parsed.linkedGoalIds ?? current.linkedGoalIds,
    getGoalById,
    "goal_not_found",
    "Goal"
  );
  validateExistingIds(
    parsed.linkedProjectIds ?? current.linkedProjectIds,
    getProjectById,
    "project_not_found",
    "Project"
  );
  validateExistingIds(
    parsed.linkedTaskIds ?? current.linkedTaskIds,
    getTaskById,
    "task_not_found",
    "Task"
  );
  validateExistingIds(
    parsed.linkedValueIds ?? current.linkedValueIds,
    getPsycheValueById,
    "value_not_found",
    "Value"
  );
  validateExistingIds(
    parsed.linkedPatternIds ?? current.linkedPatternIds,
    getBehaviorPatternById,
    "pattern_not_found",
    "Pattern"
  );
  validateExistingIds(
    nextLinkedBehaviorIds,
    getBehaviorById,
    "behavior_not_found",
    "Behavior"
  );
  validateExistingIds(
    parsed.linkedBeliefIds ?? current.linkedBeliefIds,
    getBeliefEntryById,
    "belief_not_found",
    "Belief"
  );
  validateExistingIds(
    parsed.linkedModeIds ?? current.linkedModeIds,
    getModeProfileById,
    "mode_not_found",
    "Mode"
  );
  validateExistingIds(
    parsed.linkedReportIds ?? current.linkedReportIds,
    getTriggerReportById,
    "report_not_found",
    "Report"
  );
  return runInTransaction(() => {
    const updatedAt = new Date().toISOString();
    getDatabase()
      .prepare(
        `UPDATE habits
         SET title = ?, description = ?, status = ?, polarity = ?, frequency = ?, target_count = ?,
             week_days_json = ?, linked_goal_ids_json = ?, linked_project_ids_json = ?, linked_task_ids_json = ?,
             linked_value_ids_json = ?, linked_pattern_ids_json = ?, linked_behavior_ids_json = ?,
             linked_belief_ids_json = ?, linked_mode_ids_json = ?, linked_report_ids_json = ?,
             linked_behavior_id = ?, reward_xp = ?, penalty_xp = ?, generated_health_event_template_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        parsed.title ?? current.title,
        parsed.description ?? current.description,
        parsed.status ?? current.status,
        parsed.polarity ?? current.polarity,
        parsed.frequency ?? current.frequency,
        parsed.targetCount ?? current.targetCount,
        JSON.stringify(parsed.weekDays ?? current.weekDays),
        JSON.stringify(parsed.linkedGoalIds ?? current.linkedGoalIds),
        JSON.stringify(parsed.linkedProjectIds ?? current.linkedProjectIds),
        JSON.stringify(parsed.linkedTaskIds ?? current.linkedTaskIds),
        JSON.stringify(parsed.linkedValueIds ?? current.linkedValueIds),
        JSON.stringify(parsed.linkedPatternIds ?? current.linkedPatternIds),
        JSON.stringify(nextLinkedBehaviorIds),
        JSON.stringify(parsed.linkedBeliefIds ?? current.linkedBeliefIds),
        JSON.stringify(parsed.linkedModeIds ?? current.linkedModeIds),
        JSON.stringify(parsed.linkedReportIds ?? current.linkedReportIds),
        nextLinkedBehaviorIds[0] ?? null,
        parsed.rewardXp ?? current.rewardXp,
        parsed.penaltyXp ?? current.penaltyXp,
        JSON.stringify(
          parsed.generatedHealthEventTemplate ??
            current.generatedHealthEventTemplate
        ),
        updatedAt,
        habitId
      );
    if (parsed.userId !== undefined) {
      setEntityOwner("habit", habitId, parsed.userId);
    }
    const habit = getHabitById(habitId)!;
    if (activity) {
      recordActivityEvent({
        entityType: "habit",
        entityId: habit.id,
        eventType: "habit_updated",
        title: `Habit updated: ${habit.title}`,
        description: "Habit settings and recurrence were updated.",
        actor: activity.actor ?? null,
        source: activity.source,
        metadata: {
          polarity: habit.polarity,
          frequency: habit.frequency,
          targetCount: habit.targetCount
        }
      });
    }
    return habit;
  });
}

export function deleteHabit(
  habitId: string,
  activity?: ActivityContext
): Habit | undefined {
  const current = getHabitById(habitId);
  if (!current) {
    return undefined;
  }
  return runInTransaction(() => {
    getDatabase().prepare(`DELETE FROM habits WHERE id = ?`).run(habitId);
    if (activity) {
      recordActivityEvent({
        entityType: "habit",
        entityId: current.id,
        eventType: "habit_deleted",
        title: `Habit deleted: ${current.title}`,
        description: "Habit removed from Forge.",
        actor: activity.actor ?? null,
        source: activity.source,
        metadata: {
          polarity: current.polarity,
          frequency: current.frequency
        }
      });
    }
    return current;
  });
}

export function createHabitCheckIn(
  habitId: string,
  input: CreateHabitCheckInInput,
  activity?: ActivityContext
): Habit | undefined {
  const habit = getHabitById(habitId);
  if (!habit) {
    return undefined;
  }
  const parsed = createHabitCheckInSchema.parse(input);
  return runInTransaction(() => {
    const existing = getDatabase()
      .prepare(
        `SELECT id, habit_id, date_key, status, note, delta_xp, created_at, updated_at
         FROM habit_check_ins
         WHERE habit_id = ? AND date_key = ?`
      )
      .get(habitId, parsed.dateKey) as HabitCheckInRow | undefined;
    const reward = recordHabitCheckInReward(
      habit,
      parsed.status,
      parsed.dateKey,
      activity ?? { source: "ui", actor: null }
    );
    const now = new Date().toISOString();

    if (existing) {
      getDatabase()
        .prepare(
          `UPDATE habit_check_ins
           SET status = ?, note = ?, delta_xp = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(parsed.status, parsed.note, reward.deltaXp, now, existing.id);
    } else {
      getDatabase()
        .prepare(
          `INSERT INTO habit_check_ins (id, habit_id, date_key, status, note, delta_xp, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          `hci_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
          habitId,
          parsed.dateKey,
          parsed.status,
          parsed.note,
          reward.deltaXp,
          now,
          now
        );
    }

    if (parsed.description !== undefined) {
      getDatabase()
        .prepare(
          `UPDATE habits
           SET description = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(parsed.description, now, habitId);
    }

    recordActivityEvent({
      entityType: "habit",
      entityId: habit.id,
      eventType: parsed.status === "done" ? "habit_done" : "habit_missed",
      title: `${parsed.status === "done" ? "Habit completed" : "Habit missed"}: ${habit.title}`,
      description:
        habit.polarity === "positive"
          ? parsed.status === "done"
            ? "Positive habit logged as completed."
            : "Positive habit logged as missed."
          : parsed.status === "done"
            ? "Negative habit logged as performed."
            : "Negative habit logged as resisted.",
      actor: activity?.actor ?? null,
      source: activity?.source ?? "ui",
      metadata: {
        dateKey: parsed.dateKey,
        status: parsed.status,
        polarity: habit.polarity,
        deltaXp: reward.deltaXp,
        descriptionReplaced: parsed.description !== undefined
      }
    });

    if (parsed.status === "done") {
      const checkInId = existing?.id
        ? existing.id
        : (
            getDatabase()
              .prepare(
                `SELECT id FROM habit_check_ins WHERE habit_id = ? AND date_key = ?`
              )
              .get(habitId, parsed.dateKey) as { id: string } | undefined
          )?.id;
      if (checkInId) {
        createGeneratedWorkoutFromHabit({
          habitId: habit.id,
          checkInId,
          habitTitle: habit.title,
          userId: habit.userId ?? "user_operator",
          dateKey: parsed.dateKey,
          template: habit.generatedHealthEventTemplate,
          linkedEntities: [
            ...habit.linkedGoalIds.map((entityId) => ({
              entityType: "goal",
              entityId,
              relationshipType: "habit_context"
            })),
            ...habit.linkedProjectIds.map((entityId) => ({
              entityType: "project",
              entityId,
              relationshipType: "habit_context"
            })),
            ...habit.linkedTaskIds.map((entityId) => ({
              entityType: "task",
              entityId,
              relationshipType: "habit_context"
            }))
          ]
        });
      }
    }

    return getHabitById(habitId);
  });
}

export function deleteHabitCheckIn(
  habitId: string,
  dateKey: string,
  activity?: ActivityContext
): Habit | undefined {
  const habit = getHabitById(habitId);
  if (!habit) {
    return undefined;
  }

  return runInTransaction(() => {
    const existing = getDatabase()
      .prepare(
        `SELECT id, habit_id, date_key, status, note, delta_xp, created_at, updated_at
         FROM habit_check_ins
         WHERE habit_id = ? AND date_key = ?`
      )
      .get(habitId, dateKey) as HabitCheckInRow | undefined;

    if (!existing) {
      return getHabitById(habitId);
    }

    getDatabase()
      .prepare(`DELETE FROM habit_check_ins WHERE id = ?`)
      .run(existing.id);

    reverseLatestHabitCheckInReward(
      habit,
      dateKey,
      activity ?? { source: "ui", actor: null }
    );

    recordActivityEvent({
      entityType: "habit",
      entityId: habit.id,
      eventType: "habit_check_in_deleted",
      title: `Habit entry removed: ${habit.title}`,
      description: "Habit check-in removed from the timeline.",
      actor: activity?.actor ?? null,
      source: activity?.source ?? "ui",
      metadata: {
        dateKey,
        status: existing.status,
        polarity: habit.polarity,
        deltaXp: existing.delta_xp
      }
    });

    return getHabitById(habitId);
  });
}
