import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { createGeneratedWorkoutFromHabit, parseGeneratedHealthEventTemplate } from "../health.js";
import { decorateOwnedEntity, inferFirstOwnedUserId, setEntityOwner } from "./entity-ownership.js";
import { getGoalById } from "./goals.js";
import { getProjectById } from "./projects.js";
import { getBehaviorById, getBehaviorPatternById, getBeliefEntryById, getModeProfileById, getPsycheValueById, getTriggerReportById } from "./psyche.js";
import { getTaskById } from "./tasks.js";
import { recordActivityEvent } from "./activity-events.js";
import { filterDeletedEntities, filterDeletedIds, isEntityDeleted } from "./deleted-entities.js";
import { recordHabitCheckInReward, reverseLatestHabitCheckInReward } from "./rewards.js";
import { createHabitCheckInSchema, createHabitSchema, habitCheckInSchema, habitSchema, updateHabitSchema } from "../types.js";
function todayKey(now = new Date()) {
    return now.toISOString().slice(0, 10);
}
function parseWeekDays(raw) {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
        ? parsed.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
        : [];
}
function parseIdList(raw) {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
        ? parsed.filter((value) => typeof value === "string" && value.trim().length > 0)
        : [];
}
function uniqueIds(values) {
    return [
        ...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))
    ];
}
function normalizeLinkedBehaviorIds(input) {
    const fromArray = Array.isArray(input.linkedBehaviorIds)
        ? input.linkedBehaviorIds
        : [];
    return uniqueIds([...fromArray, input.linkedBehaviorId ?? null]);
}
function validateExistingIds(ids, getById, code, label) {
    for (const id of ids) {
        if (!getById(id)) {
            throw new HttpError(404, code, `${label} ${id} does not exist`);
        }
    }
}
function mapCheckIn(row) {
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
function listCheckInsForHabit(habitId, limit = 14) {
    const rows = getDatabase()
        .prepare(`SELECT id, habit_id, date_key, status, note, delta_xp, created_at, updated_at
       FROM habit_check_ins
       WHERE habit_id = ?
       ORDER BY date_key DESC, created_at DESC
       LIMIT ?`)
        .all(habitId, limit);
    return rows.map(mapCheckIn);
}
function isAligned(habit, checkIn) {
    return ((habit.polarity === "positive" && checkIn.status === "done") ||
        (habit.polarity === "negative" && checkIn.status === "missed"));
}
function calculateCompletionRate(habit, checkIns) {
    if (checkIns.length === 0) {
        return 0;
    }
    const aligned = checkIns.filter((checkIn) => isAligned(habit, checkIn)).length;
    return Math.round((aligned / checkIns.length) * 100);
}
function calculateStreak(habit, checkIns) {
    let streak = 0;
    for (const checkIn of checkIns) {
        if (!isAligned(habit, checkIn)) {
            break;
        }
        streak += 1;
    }
    return streak;
}
function isHabitDueToday(habit, latestCheckIn, now = new Date()) {
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
function mapHabit(row, checkIns = listCheckInsForHabit(row.id)) {
    const latestCheckIn = checkIns[0] ?? null;
    const linkedBehaviorIds = normalizeLinkedBehaviorIds({
        linkedBehaviorIds: parseIdList(row.linked_behavior_ids_json),
        linkedBehaviorId: row.linked_behavior_id
    });
    const linkedBehaviors = linkedBehaviorIds
        .map((behaviorId) => getBehaviorById(behaviorId))
        .filter((behavior) => behavior !== undefined);
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
        linkedProjectIds: filterDeletedIds("project", parseIdList(row.linked_project_ids_json)),
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
        generatedHealthEventTemplate: parseGeneratedHealthEventTemplate(row.generated_health_event_template_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastCheckInAt: latestCheckIn?.createdAt ?? null,
        lastCheckInStatus: latestCheckIn?.status ?? null,
        streakCount: calculateStreak({ polarity: row.polarity }, checkIns),
        completionRate: calculateCompletionRate({ polarity: row.polarity }, checkIns),
        dueToday: false,
        checkIns
    };
    draft.dueToday = isHabitDueToday({
        status: draft.status,
        frequency: draft.frequency,
        weekDays: draft.weekDays
    }, latestCheckIn);
    return habitSchema.parse(decorateOwnedEntity("habit", draft));
}
function getHabitRow(habitId) {
    return getDatabase()
        .prepare(`SELECT
         id, title, description, status, polarity, frequency, target_count, week_days_json,
         linked_goal_ids_json, linked_project_ids_json, linked_task_ids_json,
         linked_value_ids_json, linked_pattern_ids_json, linked_behavior_ids_json,
         linked_belief_ids_json, linked_mode_ids_json, linked_report_ids_json,
         linked_behavior_id, reward_xp, penalty_xp, generated_health_event_template_json, created_at, updated_at
       FROM habits
       WHERE id = ?`)
        .get(habitId);
}
export function listHabits(filters = {}) {
    const parsed = filters;
    const whereClauses = [];
    const params = [];
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
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const rows = getDatabase()
        .prepare(`SELECT
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
       ${limitSql}`)
        .all(...params);
    const habits = filterDeletedEntities("habit", rows.map((row) => mapHabit(row)));
    return parsed.dueToday ? habits.filter((habit) => habit.dueToday) : habits;
}
export function getHabitById(habitId) {
    if (isEntityDeleted("habit", habitId)) {
        return undefined;
    }
    const row = getHabitRow(habitId);
    return row ? mapHabit(row) : undefined;
}
export function createHabit(input, activity) {
    const parsed = createHabitSchema.parse(input);
    const linkedBehaviorIds = normalizeLinkedBehaviorIds(parsed);
    validateExistingIds(parsed.linkedGoalIds, getGoalById, "goal_not_found", "Goal");
    validateExistingIds(parsed.linkedProjectIds, getProjectById, "project_not_found", "Project");
    validateExistingIds(parsed.linkedTaskIds, getTaskById, "task_not_found", "Task");
    validateExistingIds(parsed.linkedValueIds, getPsycheValueById, "value_not_found", "Value");
    validateExistingIds(parsed.linkedPatternIds, getBehaviorPatternById, "pattern_not_found", "Pattern");
    validateExistingIds(linkedBehaviorIds, getBehaviorById, "behavior_not_found", "Behavior");
    validateExistingIds(parsed.linkedBeliefIds, getBeliefEntryById, "belief_not_found", "Belief");
    validateExistingIds(parsed.linkedModeIds, getModeProfileById, "mode_not_found", "Mode");
    validateExistingIds(parsed.linkedReportIds, getTriggerReportById, "report_not_found", "Report");
    return runInTransaction(() => {
        const now = new Date().toISOString();
        const id = `habit_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
        getDatabase()
            .prepare(`INSERT INTO habits (
          id, title, description, status, polarity, frequency, target_count, week_days_json,
          linked_goal_ids_json, linked_project_ids_json, linked_task_ids_json,
          linked_value_ids_json, linked_pattern_ids_json, linked_behavior_ids_json,
          linked_belief_ids_json, linked_mode_ids_json, linked_report_ids_json,
          linked_behavior_id, reward_xp, penalty_xp, generated_health_event_template_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, parsed.title, parsed.description, parsed.status, parsed.polarity, parsed.frequency, parsed.targetCount, JSON.stringify(parsed.weekDays), JSON.stringify(parsed.linkedGoalIds), JSON.stringify(parsed.linkedProjectIds), JSON.stringify(parsed.linkedTaskIds), JSON.stringify(parsed.linkedValueIds), JSON.stringify(parsed.linkedPatternIds), JSON.stringify(linkedBehaviorIds), JSON.stringify(parsed.linkedBeliefIds), JSON.stringify(parsed.linkedModeIds), JSON.stringify(parsed.linkedReportIds), linkedBehaviorIds[0] ?? null, parsed.rewardXp, parsed.penaltyXp, JSON.stringify(parsed.generatedHealthEventTemplate), now, now);
        setEntityOwner("habit", id, parsed.userId ??
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
            ]));
        const habit = getHabitById(id);
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
export function updateHabit(habitId, input, activity) {
    const current = getHabitById(habitId);
    if (!current) {
        return undefined;
    }
    const parsed = updateHabitSchema.parse(input);
    const nextLinkedBehaviorIds = parsed.linkedBehaviorIds !== undefined ||
        parsed.linkedBehaviorId !== undefined
        ? normalizeLinkedBehaviorIds({
            linkedBehaviorIds: parsed.linkedBehaviorIds ?? current.linkedBehaviorIds,
            linkedBehaviorId: parsed.linkedBehaviorId === undefined
                ? current.linkedBehaviorId
                : parsed.linkedBehaviorId
        })
        : current.linkedBehaviorIds;
    validateExistingIds(parsed.linkedGoalIds ?? current.linkedGoalIds, getGoalById, "goal_not_found", "Goal");
    validateExistingIds(parsed.linkedProjectIds ?? current.linkedProjectIds, getProjectById, "project_not_found", "Project");
    validateExistingIds(parsed.linkedTaskIds ?? current.linkedTaskIds, getTaskById, "task_not_found", "Task");
    validateExistingIds(parsed.linkedValueIds ?? current.linkedValueIds, getPsycheValueById, "value_not_found", "Value");
    validateExistingIds(parsed.linkedPatternIds ?? current.linkedPatternIds, getBehaviorPatternById, "pattern_not_found", "Pattern");
    validateExistingIds(nextLinkedBehaviorIds, getBehaviorById, "behavior_not_found", "Behavior");
    validateExistingIds(parsed.linkedBeliefIds ?? current.linkedBeliefIds, getBeliefEntryById, "belief_not_found", "Belief");
    validateExistingIds(parsed.linkedModeIds ?? current.linkedModeIds, getModeProfileById, "mode_not_found", "Mode");
    validateExistingIds(parsed.linkedReportIds ?? current.linkedReportIds, getTriggerReportById, "report_not_found", "Report");
    return runInTransaction(() => {
        const updatedAt = new Date().toISOString();
        getDatabase()
            .prepare(`UPDATE habits
         SET title = ?, description = ?, status = ?, polarity = ?, frequency = ?, target_count = ?,
             week_days_json = ?, linked_goal_ids_json = ?, linked_project_ids_json = ?, linked_task_ids_json = ?,
             linked_value_ids_json = ?, linked_pattern_ids_json = ?, linked_behavior_ids_json = ?,
             linked_belief_ids_json = ?, linked_mode_ids_json = ?, linked_report_ids_json = ?,
             linked_behavior_id = ?, reward_xp = ?, penalty_xp = ?, generated_health_event_template_json = ?, updated_at = ?
         WHERE id = ?`)
            .run(parsed.title ?? current.title, parsed.description ?? current.description, parsed.status ?? current.status, parsed.polarity ?? current.polarity, parsed.frequency ?? current.frequency, parsed.targetCount ?? current.targetCount, JSON.stringify(parsed.weekDays ?? current.weekDays), JSON.stringify(parsed.linkedGoalIds ?? current.linkedGoalIds), JSON.stringify(parsed.linkedProjectIds ?? current.linkedProjectIds), JSON.stringify(parsed.linkedTaskIds ?? current.linkedTaskIds), JSON.stringify(parsed.linkedValueIds ?? current.linkedValueIds), JSON.stringify(parsed.linkedPatternIds ?? current.linkedPatternIds), JSON.stringify(nextLinkedBehaviorIds), JSON.stringify(parsed.linkedBeliefIds ?? current.linkedBeliefIds), JSON.stringify(parsed.linkedModeIds ?? current.linkedModeIds), JSON.stringify(parsed.linkedReportIds ?? current.linkedReportIds), nextLinkedBehaviorIds[0] ?? null, parsed.rewardXp ?? current.rewardXp, parsed.penaltyXp ?? current.penaltyXp, JSON.stringify(parsed.generatedHealthEventTemplate ??
            current.generatedHealthEventTemplate), updatedAt, habitId);
        if (parsed.userId !== undefined) {
            setEntityOwner("habit", habitId, parsed.userId);
        }
        const habit = getHabitById(habitId);
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
export function deleteHabit(habitId, activity) {
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
export function createHabitCheckIn(habitId, input, activity) {
    const habit = getHabitById(habitId);
    if (!habit) {
        return undefined;
    }
    const parsed = createHabitCheckInSchema.parse(input);
    return runInTransaction(() => {
        const existing = getDatabase()
            .prepare(`SELECT id, habit_id, date_key, status, note, delta_xp, created_at, updated_at
         FROM habit_check_ins
         WHERE habit_id = ? AND date_key = ?`)
            .get(habitId, parsed.dateKey);
        const reward = recordHabitCheckInReward(habit, parsed.status, parsed.dateKey, activity ?? { source: "ui", actor: null });
        const now = new Date().toISOString();
        if (existing) {
            getDatabase()
                .prepare(`UPDATE habit_check_ins
           SET status = ?, note = ?, delta_xp = ?, updated_at = ?
           WHERE id = ?`)
                .run(parsed.status, parsed.note, reward.deltaXp, now, existing.id);
        }
        else {
            getDatabase()
                .prepare(`INSERT INTO habit_check_ins (id, habit_id, date_key, status, note, delta_xp, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(`hci_${randomUUID().replaceAll("-", "").slice(0, 10)}`, habitId, parsed.dateKey, parsed.status, parsed.note, reward.deltaXp, now, now);
        }
        recordActivityEvent({
            entityType: "habit",
            entityId: habit.id,
            eventType: parsed.status === "done" ? "habit_done" : "habit_missed",
            title: `${parsed.status === "done" ? "Habit completed" : "Habit missed"}: ${habit.title}`,
            description: habit.polarity === "positive"
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
                deltaXp: reward.deltaXp
            }
        });
        if (parsed.status === "done") {
            const checkInId = existing?.id
                ? existing.id
                : getDatabase()
                    .prepare(`SELECT id FROM habit_check_ins WHERE habit_id = ? AND date_key = ?`)
                    .get(habitId, parsed.dateKey)?.id;
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
export function deleteHabitCheckIn(habitId, dateKey, activity) {
    const habit = getHabitById(habitId);
    if (!habit) {
        return undefined;
    }
    return runInTransaction(() => {
        const existing = getDatabase()
            .prepare(`SELECT id, habit_id, date_key, status, note, delta_xp, created_at, updated_at
         FROM habit_check_ins
         WHERE habit_id = ? AND date_key = ?`)
            .get(habitId, dateKey);
        if (!existing) {
            return getHabitById(habitId);
        }
        getDatabase()
            .prepare(`DELETE FROM habit_check_ins WHERE id = ?`)
            .run(existing.id);
        reverseLatestHabitCheckInReward(habit, dateKey, activity ?? { source: "ui", actor: null });
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
