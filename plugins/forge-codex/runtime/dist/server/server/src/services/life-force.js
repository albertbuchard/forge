import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { getDefaultUser, getUserById } from "../repositories/users.js";
import { actionProfileSchema, fatigueSignalCreateSchema, lifeForcePayloadSchema, lifeForceProfilePatchSchema, lifeForceTemplateUpdateSchema } from "../types.js";
import { DEFAULT_TASK_TOTAL_AP, LIFE_FORCE_BASELINE_DAILY_AP, buildDefaultTaskActionProfile, buildTaskActionPointSummary, buildTaskSplitSuggestion, clamp, interpolateCurveRate, normalizeCurveToBudget, resolveBandTotalCostAp, resolveTaskExpectedDurationSeconds } from "./life-force-model.js";
import { computeWorkTime } from "./work-time.js";
const DEFAULT_TEMPLATE_POINTS = [
    { minuteOfDay: 0, rateApPerHour: 0 },
    { minuteOfDay: 7 * 60, rateApPerHour: 0 },
    { minuteOfDay: 8 * 60, rateApPerHour: 8 },
    { minuteOfDay: 10 * 60, rateApPerHour: 13 },
    { minuteOfDay: 13 * 60, rateApPerHour: 9 },
    { minuteOfDay: 14 * 60, rateApPerHour: 11 },
    { minuteOfDay: 19 * 60, rateApPerHour: 7 },
    { minuteOfDay: 23 * 60, rateApPerHour: 0 },
    { minuteOfDay: 24 * 60, rateApPerHour: 0 }
];
const LIFE_FORCE_STAT_LABELS = {
    life_force: "Life Force",
    activation: "Activation",
    focus: "Focus",
    vigor: "Vigor",
    composure: "Composure",
    flow: "Flow"
};
function nowIso() {
    return new Date().toISOString();
}
function toDateKey(date) {
    return date.toISOString().slice(0, 10);
}
function startOfUtcDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
function buildDayRange(date) {
    const start = startOfUtcDay(date);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return {
        startMs: start.getTime(),
        endMs: end.getTime(),
        dateKey: toDateKey(start),
        from: start.toISOString(),
        to: end.toISOString()
    };
}
function parseCurvePoints(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .filter((value) => !!value &&
            typeof value === "object" &&
            typeof value.minuteOfDay === "number" &&
            typeof value.rateApPerHour === "number")
            .map((point) => ({
            minuteOfDay: Math.round(point.minuteOfDay),
            rateApPerHour: point.rateApPerHour,
            locked: point.locked
        }))
            .sort((left, right) => left.minuteOfDay - right.minuteOfDay);
    }
    catch {
        return [];
    }
}
function defaultTemplatePoints() {
    return normalizeCurveToBudget(DEFAULT_TEMPLATE_POINTS, LIFE_FORCE_BASELINE_DAILY_AP);
}
function seededActionProfiles() {
    const now = nowIso();
    const taskDefault = buildDefaultTaskActionProfile({});
    return [
        taskDefault,
        actionProfileSchema.parse({
            id: "profile_note_quick",
            profileKey: "note_quick",
            title: "Quick note",
            entityType: "note",
            mode: "impulse",
            startupAp: 1,
            totalCostAp: 1,
            expectedDurationSeconds: null,
            sustainRateApPerHour: 0,
            demandWeights: {
                activation: 0.15,
                focus: 0.5,
                vigor: 0,
                composure: 0,
                flow: 0.35
            },
            doubleCountPolicy: "primary_only",
            sourceMethod: "seeded",
            costBand: "tiny",
            recoveryEffect: 0,
            metadata: {},
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_habit_default",
            profileKey: "habit_default",
            title: "Habit check-in",
            entityType: "habit",
            mode: "impulse",
            startupAp: 3,
            totalCostAp: 3,
            expectedDurationSeconds: null,
            sustainRateApPerHour: 0,
            demandWeights: {
                activation: 0.4,
                focus: 0.1,
                vigor: 0.15,
                composure: 0.05,
                flow: 0.3
            },
            doubleCountPolicy: "primary_only",
            sourceMethod: "seeded",
            costBand: "light",
            recoveryEffect: 0,
            metadata: {},
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_workout_default",
            profileKey: "workout_default",
            title: "Workout",
            entityType: "workout_session",
            mode: "rate",
            startupAp: 1,
            totalCostAp: 24,
            expectedDurationSeconds: 3_600,
            sustainRateApPerHour: 24,
            demandWeights: {
                activation: 0.1,
                focus: 0.05,
                vigor: 0.75,
                composure: 0,
                flow: 0.1
            },
            doubleCountPolicy: "primary_only",
            sourceMethod: "seeded",
            costBand: "standard",
            recoveryEffect: 0,
            metadata: {},
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_calendar_default",
            profileKey: "calendar_event_default",
            title: "Calendar event",
            entityType: "calendar_event",
            mode: "container",
            startupAp: 0,
            totalCostAp: 12,
            expectedDurationSeconds: 3_600,
            sustainRateApPerHour: 12,
            demandWeights: {
                activation: 0.05,
                focus: 0.35,
                vigor: 0.05,
                composure: 0.35,
                flow: 0.2
            },
            doubleCountPolicy: "container_only",
            sourceMethod: "seeded",
            costBand: "light",
            recoveryEffect: 0,
            metadata: {},
            createdAt: now,
            updatedAt: now
        }),
        actionProfileSchema.parse({
            id: "profile_recovery_break",
            profileKey: "recovery_break",
            title: "Recovery break",
            entityType: "system",
            mode: "recovery",
            startupAp: 0,
            totalCostAp: 0,
            expectedDurationSeconds: null,
            sustainRateApPerHour: 0,
            demandWeights: {
                activation: 0,
                focus: 0,
                vigor: 0,
                composure: 0,
                flow: 0
            },
            doubleCountPolicy: "primary_only",
            sourceMethod: "seeded",
            costBand: "tiny",
            recoveryEffect: 6,
            metadata: {},
            createdAt: now,
            updatedAt: now
        })
    ];
}
function mapTemplateProfileRow(row) {
    return actionProfileSchema.parse({
        id: row.id,
        profileKey: row.profile_key,
        entityType: row.entity_type,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...JSON.parse(row.profile_json)
    });
}
function mapEntityProfileRow(row, fallback) {
    return actionProfileSchema.parse({
        id: row.id,
        profileKey: fallback.profileKey,
        title: fallback.title,
        entityType: fallback.entityType,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...JSON.parse(row.profile_json)
    });
}
function ensureActionProfileTemplates() {
    const database = getDatabase();
    const insert = database.prepare(`INSERT OR IGNORE INTO action_profile_templates (
       id,
       profile_key,
       entity_type,
       title,
       profile_json,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const profile of seededActionProfiles()) {
        insert.run(profile.id, profile.profileKey, profile.entityType, profile.title, JSON.stringify({
            mode: profile.mode,
            startupAp: profile.startupAp,
            totalCostAp: profile.totalCostAp,
            expectedDurationSeconds: profile.expectedDurationSeconds,
            sustainRateApPerHour: profile.sustainRateApPerHour,
            demandWeights: profile.demandWeights,
            doubleCountPolicy: profile.doubleCountPolicy,
            sourceMethod: profile.sourceMethod,
            costBand: profile.costBand,
            recoveryEffect: profile.recoveryEffect,
            metadata: profile.metadata
        }), profile.createdAt, profile.updatedAt);
    }
}
export function upsertTaskActionProfile(input) {
    const now = nowIso();
    const profile = buildDefaultTaskActionProfile({
        id: `profile_task_${input.taskId}`,
        profileKey: `task_${input.taskId}`,
        title: input.title || "Task",
        expectedDurationSeconds: input.plannedDurationSeconds,
        totalCostAp: input.totalCostAp ?? resolveBandTotalCostAp(input.actionCostBand ?? "standard"),
        costBand: input.actionCostBand ?? "standard",
        sourceMethod: "manual"
    });
    getDatabase()
        .prepare(`INSERT INTO entity_action_profiles (
         id,
         entity_type,
         entity_id,
         profile_json,
         created_at,
         updated_at
       ) VALUES (?, 'task', ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
         profile_json = excluded.profile_json,
         updated_at = excluded.updated_at`)
        .run(profile.id, input.taskId, JSON.stringify({
        profileKey: profile.profileKey,
        title: profile.title,
        entityType: profile.entityType,
        mode: profile.mode,
        startupAp: profile.startupAp,
        totalCostAp: profile.totalCostAp,
        expectedDurationSeconds: profile.expectedDurationSeconds,
        sustainRateApPerHour: profile.sustainRateApPerHour,
        demandWeights: profile.demandWeights,
        doubleCountPolicy: profile.doubleCountPolicy,
        sourceMethod: profile.sourceMethod,
        costBand: profile.costBand,
        recoveryEffect: profile.recoveryEffect,
        metadata: profile.metadata
    }), now, now);
}
function ensureLifeForceProfile(userId) {
    const database = getDatabase();
    const existing = database
        .prepare(`SELECT *
       FROM life_force_profiles
       WHERE user_id = ?`)
        .get(userId);
    if (existing) {
        return existing;
    }
    const now = nowIso();
    database
        .prepare(`INSERT INTO life_force_profiles (
         user_id,
         base_daily_ap,
         readiness_multiplier,
         life_force_level,
         activation_level,
         focus_level,
         vigor_level,
         composure_level,
         flow_level,
         created_at,
         updated_at
       ) VALUES (?, 200, 1.0, 1, 1, 1, 1, 1, 1, ?, ?)`)
        .run(userId, now, now);
    return database
        .prepare(`SELECT *
       FROM life_force_profiles
       WHERE user_id = ?`)
        .get(userId);
}
function ensureWeekdayTemplates(userId) {
    const database = getDatabase();
    const insert = database.prepare(`INSERT OR IGNORE INTO life_force_weekday_templates (
       id,
       user_id,
       weekday,
       baseline_daily_ap,
       points_json,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const now = nowIso();
    const defaultPoints = JSON.stringify(defaultTemplatePoints());
    for (let weekday = 0; weekday < 7; weekday += 1) {
        insert.run(`lf_template_${userId}_${weekday}`, userId, weekday, LIFE_FORCE_BASELINE_DAILY_AP, defaultPoints, now, now);
    }
}
function readWeekdayTemplate(userId, weekday) {
    ensureWeekdayTemplates(userId);
    return getDatabase()
        .prepare(`SELECT *
       FROM life_force_weekday_templates
       WHERE user_id = ? AND weekday = ?`)
        .get(userId, weekday);
}
function readTaskRunRows(range, userId) {
    return getDatabase()
        .prepare(`SELECT
         task_runs.id,
         task_runs.task_id,
         task_runs.actor,
         task_runs.status,
         task_runs.is_current,
         task_runs.claimed_at,
         task_runs.heartbeat_at,
         task_runs.lease_expires_at,
         task_runs.completed_at,
         task_runs.released_at,
         task_runs.timed_out_at,
         task_runs.updated_at,
         tasks.title AS task_title,
         task_runs.planned_duration_seconds,
         tasks.planned_duration_seconds AS task_expected_duration_seconds
       FROM task_runs
       INNER JOIN tasks ON tasks.id = task_runs.task_id
       INNER JOIN entity_owners
         ON entity_owners.entity_type = 'task'
        AND entity_owners.entity_id = tasks.id
        AND entity_owners.role = 'owner'
       WHERE entity_owners.user_id = ?
         AND task_runs.claimed_at < ?
         AND COALESCE(task_runs.completed_at, task_runs.released_at, task_runs.timed_out_at, task_runs.updated_at, task_runs.lease_expires_at, task_runs.heartbeat_at) >= ?`)
        .all(userId, range.to, range.from);
}
function terminalRunMs(row, now) {
    if (row.status === "active") {
        return Math.max(Date.parse(row.claimed_at), Math.min(now.getTime(), Date.parse(row.lease_expires_at)));
    }
    const terminal = row.completed_at ??
        row.released_at ??
        row.timed_out_at ??
        row.updated_at ??
        row.lease_expires_at ??
        row.heartbeat_at;
    return Math.max(Date.parse(row.claimed_at), Date.parse(terminal));
}
function overlapSeconds(range, row, now) {
    const start = Math.max(range.startMs, Date.parse(row.claimed_at));
    const end = Math.min(range.endMs, terminalRunMs(row, now));
    return Math.max(0, Math.floor((end - start) / 1000));
}
function readStatXpByKey(userId) {
    const rows = getDatabase()
        .prepare(`SELECT stat_key, COALESCE(SUM(delta_xp), 0) AS xp
       FROM stat_xp_events
       WHERE user_id = ?
       GROUP BY stat_key`)
        .all(userId);
    return new Map(rows.map((row) => [row.stat_key, row.xp]));
}
function buildStats(profile, userId) {
    const xpByKey = readStatXpByKey(userId);
    const levelByKey = {
        life_force: profile.life_force_level,
        activation: profile.activation_level,
        focus: profile.focus_level,
        vigor: profile.vigor_level,
        composure: profile.composure_level,
        flow: profile.flow_level
    };
    return Object.keys(levelByKey).map((key) => {
        const level = levelByKey[key];
        return {
            key,
            label: LIFE_FORCE_STAT_LABELS[key],
            level,
            xp: xpByKey.get(key) ?? 0,
            xpToNextLevel: level * 100,
            costModifier: key === "life_force"
                ? 1 + level * 0.03
                : Math.max(0.55, Number((1 - level * 0.02).toFixed(3)))
        };
    });
}
function computeLifeForceMultiplier(profile) {
    return 1 + (profile.life_force_level - 1) * 0.03;
}
function computeSleepRecoveryMultiplier() {
    return 1;
}
function computeFatigueDebtCarry(userId, date) {
    const previous = new Date(date);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const previousKey = toDateKey(previous);
    const snapshot = getDatabase()
        .prepare(`SELECT daily_budget_ap
       FROM life_force_day_snapshots
       WHERE user_id = ? AND date_key = ?`)
        .get(userId, previousKey);
    if (!snapshot) {
        return 0;
    }
    const spent = getDatabase()
        .prepare(`SELECT COALESCE(SUM(total_ap), 0) AS total_ap
       FROM ap_ledger_events
       WHERE user_id = ? AND date_key = ?`)
        .get(userId, previousKey);
    return Math.max(0, Number((spent.total_ap - snapshot.daily_budget_ap).toFixed(2)));
}
function getOrCreateDaySnapshot(userId, date) {
    const range = buildDayRange(date);
    const existing = getDatabase()
        .prepare(`SELECT *
       FROM life_force_day_snapshots
       WHERE user_id = ? AND date_key = ?`)
        .get(userId, range.dateKey);
    if (existing) {
        return existing;
    }
    const profile = ensureLifeForceProfile(userId);
    const template = readWeekdayTemplate(userId, date.getUTCDay());
    const sleepRecoveryMultiplier = computeSleepRecoveryMultiplier();
    const fatigueDebtCarry = computeFatigueDebtCarry(userId, date);
    const readinessMultiplier = profile.readiness_multiplier;
    const dailyBudgetAp = Math.max(40, Math.round(profile.base_daily_ap *
        computeLifeForceMultiplier(profile) *
        sleepRecoveryMultiplier *
        readinessMultiplier) - fatigueDebtCarry);
    const points = normalizeCurveToBudget(parseCurvePoints(template.points_json), dailyBudgetAp);
    const now = nowIso();
    const id = `lf_day_${userId}_${range.dateKey}`;
    getDatabase()
        .prepare(`INSERT INTO life_force_day_snapshots (
         id,
         user_id,
         date_key,
         daily_budget_ap,
         sleep_recovery_multiplier,
         readiness_multiplier,
         fatigue_debt_carry,
         points_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, userId, range.dateKey, dailyBudgetAp, sleepRecoveryMultiplier, readinessMultiplier, fatigueDebtCarry, JSON.stringify(points), now, now);
    return getDatabase()
        .prepare(`SELECT *
       FROM life_force_day_snapshots
       WHERE id = ?`)
        .get(id);
}
function resolveTaskActionProfile(task) {
    const row = getDatabase()
        .prepare(`SELECT id, entity_type, entity_id, profile_json, created_at, updated_at
       FROM entity_action_profiles
       WHERE entity_type = 'task' AND entity_id = ?`)
        .get(task.id);
    if (!row) {
        return buildDefaultTaskActionProfile({
            id: `profile_task_${task.id}`,
            expectedDurationSeconds: task.plannedDurationSeconds
        });
    }
    const profile = mapEntityProfileRow(row, {
        profileKey: `task_${task.id}`,
        title: "Task",
        entityType: "task"
    });
    return {
        ...profile,
        expectedDurationSeconds: resolveTaskExpectedDurationSeconds(profile.expectedDurationSeconds ?? task.plannedDurationSeconds)
    };
}
function readTodayAdjustmentRows(userId, range) {
    return getDatabase()
        .prepare(`SELECT
         work_adjustments.id,
         work_adjustments.entity_type,
         work_adjustments.entity_id,
         work_adjustments.applied_delta_minutes,
         work_adjustments.note,
         work_adjustments.created_at,
         tasks.planned_duration_seconds
       FROM work_adjustments
       LEFT JOIN tasks
         ON work_adjustments.entity_type = 'task'
        AND tasks.id = work_adjustments.entity_id
       INNER JOIN entity_owners
         ON entity_owners.entity_type = work_adjustments.entity_type
        AND entity_owners.entity_id = work_adjustments.entity_id
        AND entity_owners.role = 'owner'
       WHERE entity_owners.user_id = ?
         AND work_adjustments.created_at >= ?
         AND work_adjustments.created_at < ?`)
        .all(userId, range.from, range.to);
}
function readTodayAdjustmentApByTaskId(userId, range) {
    const rows = readTodayAdjustmentRows(userId, range);
    const totals = new Map();
    for (const row of rows) {
        if (row.entity_type !== "task") {
            continue;
        }
        const expectedDurationSeconds = resolveTaskExpectedDurationSeconds(row.planned_duration_seconds);
        const deltaAp = (DEFAULT_TASK_TOTAL_AP / expectedDurationSeconds) *
            row.applied_delta_minutes *
            60;
        totals.set(row.entity_id, (totals.get(row.entity_id) ?? 0) + deltaAp);
    }
    return totals;
}
function readTodayAdjustmentSecondsByTaskId(userId, range) {
    const rows = readTodayAdjustmentRows(userId, range);
    const totals = new Map();
    for (const row of rows) {
        if (row.entity_type !== "task") {
            continue;
        }
        totals.set(row.entity_id, (totals.get(row.entity_id) ?? 0) + row.applied_delta_minutes * 60);
    }
    return totals;
}
function readActiveTaskRunProjectionRows(taskId) {
    return getDatabase()
        .prepare(`SELECT
         id,
         task_id,
         timer_mode,
         planned_duration_seconds,
         claimed_at,
         lease_expires_at,
         status
       FROM task_runs
       WHERE task_id = ?
         AND status = 'active'`)
        .all(taskId);
}
function computeProjectedRemainingSeconds(row, now) {
    if (row.timer_mode !== "planned" || row.planned_duration_seconds === null) {
        return 0;
    }
    const endMs = Math.min(now.getTime(), Date.parse(row.lease_expires_at));
    const elapsedWallSeconds = Math.max(0, Math.floor((endMs - Date.parse(row.claimed_at)) / 1000));
    return Math.max(0, row.planned_duration_seconds - elapsedWallSeconds);
}
function buildTaskLifeForceRuntime(task, userId, now = new Date()) {
    const range = buildDayRange(now);
    const profile = resolveTaskActionProfile(task);
    const todayRunSeconds = readTaskRunRows(range, userId)
        .filter((row) => row.task_id === task.id)
        .reduce((sum, row) => sum + overlapSeconds(range, row, now), 0);
    const todayAdjustmentSeconds = readTodayAdjustmentSecondsByTaskId(userId, range).get(task.id) ?? 0;
    const todayCreditedSeconds = todayRunSeconds + todayAdjustmentSeconds;
    const spentTodayAp = (todayCreditedSeconds / 3600) * profile.sustainRateApPerHour;
    const spentTotalAp = (task.time.totalCreditedSeconds / 3600) * profile.sustainRateApPerHour;
    const projectedTotalSeconds = task.time.totalCreditedSeconds +
        readActiveTaskRunProjectionRows(task.id).reduce((sum, row) => sum + computeProjectedRemainingSeconds(row, now), 0);
    return {
        taskId: task.id,
        profile,
        todayRunSeconds,
        todayAdjustmentSeconds,
        todayCreditedSeconds,
        spentTodayAp,
        spentTotalAp,
        projectedTotalSeconds
    };
}
function readTaskRunWindowsByTaskId(userId, range, now) {
    const windows = new Map();
    for (const row of readTaskRunRows(range, userId)) {
        const startMs = Math.max(range.startMs, Date.parse(row.claimed_at));
        const endMs = Math.min(range.endMs, terminalRunMs(row, now));
        if (endMs <= startMs) {
            continue;
        }
        const list = windows.get(row.task_id) ?? [];
        list.push({ startMs, endMs });
        windows.set(row.task_id, list);
    }
    return windows;
}
function buildWorkAdjustmentContributions(userId, range) {
    return readTodayAdjustmentRows(userId, range)
        .filter((row) => row.entity_type === "task")
        .map((row) => {
        const expectedDurationSeconds = resolveTaskExpectedDurationSeconds(row.planned_duration_seconds);
        const totalAp = (DEFAULT_TASK_TOTAL_AP / expectedDurationSeconds) *
            row.applied_delta_minutes *
            60;
        return {
            entityType: "task",
            entityId: row.entity_id,
            eventKind: "work_adjustment",
            sourceKind: "work_adjustment",
            totalAp,
            rateApPerHour: null,
            title: row.note?.trim() || "Manual work adjustment",
            why: "Manual time adjustments count toward today's Action Point spend.",
            startsAt: row.created_at,
            endsAt: row.created_at,
            role: "background",
            metadata: {
                adjustmentId: row.id,
                appliedDeltaMinutes: row.applied_delta_minutes
            }
        };
    });
}
function buildTaskRunContributions(userId, range, now) {
    const contributions = [];
    const totalsByTaskId = new Map();
    const activeDrains = [];
    for (const row of readTaskRunRows(range, userId)) {
        const seconds = overlapSeconds(range, row, now);
        if (seconds <= 0) {
            continue;
        }
        const profile = resolveTaskActionProfile({
            id: row.task_id,
            plannedDurationSeconds: row.task_expected_duration_seconds ?? row.planned_duration_seconds
        });
        const totalAp = (seconds / 3600) * profile.sustainRateApPerHour;
        const startsAt = new Date(Math.max(range.startMs, Date.parse(row.claimed_at))).toISOString();
        const endsAt = new Date(Math.min(range.endMs, terminalRunMs(row, now))).toISOString();
        const contribution = {
            entityType: "task",
            entityId: row.task_id,
            eventKind: "task_run",
            sourceKind: "task_run",
            totalAp,
            rateApPerHour: profile.sustainRateApPerHour,
            title: row.task_title,
            why: "Active timed work consumes Action Points proportionally to actual time worked today.",
            startsAt,
            endsAt,
            role: row.is_current === 1 ? "primary" : "secondary",
            metadata: { taskRunId: row.id }
        };
        contributions.push(contribution);
        const existing = totalsByTaskId.get(row.task_id) ?? { todayAp: 0, totalAp: 0 };
        existing.todayAp += totalAp;
        existing.totalAp += totalAp;
        totalsByTaskId.set(row.task_id, existing);
        if (row.status === "active" && Date.parse(row.lease_expires_at) > now.getTime()) {
            activeDrains.push({
                ...contribution,
                totalAp: 0
            });
        }
    }
    return { contributions, totalsByTaskId, activeDrains };
}
function buildNoteContributions(userId, range, now) {
    try {
        const taskRunWindowsByTaskId = readTaskRunWindowsByTaskId(userId, range, now);
        const rows = getDatabase()
            .prepare(`SELECT
           notes.id,
           notes.title,
           notes.created_at,
           GROUP_CONCAT(
             CASE
               WHEN note_links.entity_type = 'task' THEN note_links.entity_id
               ELSE NULL
             END
           ) AS linked_task_ids
         FROM notes
         LEFT JOIN note_links ON note_links.note_id = notes.id
         INNER JOIN entity_owners
           ON entity_owners.entity_type = 'note'
          AND entity_owners.entity_id = notes.id
          AND entity_owners.role = 'owner'
         WHERE entity_owners.user_id = ?
           AND notes.created_at >= ?
           AND notes.created_at < ?
         GROUP BY notes.id, notes.title, notes.created_at`)
            .all(userId, range.from, range.to);
        return rows
            .filter((row) => {
            const createdAtMs = Date.parse(row.created_at);
            const linkedTaskIds = (row.linked_task_ids ?? "")
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean);
            return !linkedTaskIds.some((taskId) => (taskRunWindowsByTaskId.get(taskId) ?? []).some((window) => createdAtMs >= window.startMs && createdAtMs <= window.endMs));
        })
            .map((row) => ({
            entityType: "note",
            entityId: row.id,
            eventKind: "note_created",
            sourceKind: "note",
            totalAp: 1,
            rateApPerHour: null,
            title: row.title || "Note",
            why: "Standalone capture takes a small impulse of activation and focus.",
            startsAt: row.created_at,
            endsAt: row.created_at,
            role: "background"
        }));
    }
    catch {
        return [];
    }
}
function buildHabitContributions(userId, range) {
    try {
        const rows = getDatabase()
            .prepare(`SELECT
           habits.id,
           habits.title,
           habit_check_ins.created_at,
           health_workout_sessions.id AS generated_workout_id
         FROM habit_check_ins
         INNER JOIN habits ON habits.id = habit_check_ins.habit_id
         LEFT JOIN health_workout_sessions
           ON health_workout_sessions.generated_from_check_in_id = habit_check_ins.id
         INNER JOIN entity_owners
           ON entity_owners.entity_type = 'habit'
          AND entity_owners.entity_id = habits.id
          AND entity_owners.role = 'owner'
         WHERE entity_owners.user_id = ?
           AND habit_check_ins.created_at >= ?
           AND habit_check_ins.created_at < ?`)
            .all(userId, range.from, range.to);
        return rows
            .filter((row) => row.generated_workout_id === null)
            .map((row) => ({
            entityType: "habit",
            entityId: row.id,
            eventKind: "habit_check_in",
            sourceKind: "habit",
            totalAp: 3,
            rateApPerHour: null,
            title: row.title,
            why: "Habit execution still costs activation even when the action is short.",
            startsAt: row.created_at,
            endsAt: row.created_at,
            role: "background"
        }));
    }
    catch {
        return [];
    }
}
function buildWorkoutContributions(userId, range, now) {
    let rows = [];
    try {
        rows = getDatabase()
            .prepare(`SELECT id, workout_type, started_at, ended_at, duration_seconds, subjective_effort
         FROM health_workout_sessions
         WHERE user_id = ?
           AND started_at < ?
           AND ended_at >= ?`)
            .all(userId, range.to, range.from);
    }
    catch {
        rows = [];
    }
    const contributions = [];
    const activeDrains = [];
    for (const row of rows) {
        const startMs = Math.max(range.startMs, Date.parse(row.started_at));
        const endMs = Math.min(range.endMs, Date.parse(row.ended_at));
        const seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
        if (seconds <= 0) {
            continue;
        }
        const effortMultiplier = row.subjective_effort
            ? clamp(row.subjective_effort / 6, 0.8, 1.6)
            : 1;
        const rateApPerHour = 24 * effortMultiplier;
        const contribution = {
            entityType: "workout_session",
            entityId: row.id,
            eventKind: "workout_session",
            sourceKind: "workout",
            totalAp: (seconds / 3600) * rateApPerHour,
            rateApPerHour,
            title: row.workout_type,
            why: "Workout sessions consume real physical capacity and should affect current load.",
            startsAt: new Date(startMs).toISOString(),
            endsAt: new Date(endMs).toISOString(),
            role: "secondary"
        };
        contributions.push(contribution);
        if (Date.parse(row.ended_at) > now.getTime()) {
            activeDrains.push({ ...contribution, totalAp: 0 });
        }
    }
    return { contributions, activeDrains };
}
function buildCalendarDrains(userId, now) {
    const nowIsoValue = now.toISOString();
    try {
        const rows = getDatabase()
            .prepare(`SELECT calendar_events.id, calendar_events.title, calendar_events.start_at, calendar_events.end_at
         FROM calendar_events
         INNER JOIN calendar_event_links
           ON calendar_event_links.forge_event_id = calendar_events.id
         INNER JOIN entity_owners
           ON entity_owners.entity_type = calendar_event_links.entity_type
          AND entity_owners.entity_id = calendar_event_links.entity_id
          AND entity_owners.role = 'owner'
         WHERE entity_owners.user_id = ?
           AND calendar_events.deleted_at IS NULL
           AND calendar_events.start_at <= ?
           AND calendar_events.end_at > ?
         GROUP BY calendar_events.id, calendar_events.title, calendar_events.start_at, calendar_events.end_at`)
            .all(userId, nowIsoValue, nowIsoValue);
        return rows.map((row) => ({
            entityType: "calendar_event",
            entityId: row.id,
            eventKind: "calendar_context",
            sourceKind: "calendar",
            totalAp: 0,
            rateApPerHour: 12,
            title: row.title,
            why: "Calendar context occupies mental and social capacity even before task work is logged.",
            startsAt: row.start_at,
            endsAt: row.end_at,
            role: "background"
        }));
    }
    catch {
        return [];
    }
}
function syncApLedger(userId, range, contributions) {
    runInTransaction(() => {
        const database = getDatabase();
        database
            .prepare(`DELETE FROM ap_ledger_events
         WHERE user_id = ? AND date_key = ?`)
            .run(userId, range.dateKey);
        const insert = database.prepare(`INSERT INTO ap_ledger_events (
         id,
         user_id,
         date_key,
         entity_type,
         entity_id,
         event_kind,
         source_kind,
         starts_at,
         ends_at,
         total_ap,
         rate_ap_per_hour,
         metadata_json,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const createdAt = nowIso();
        for (const contribution of contributions) {
            insert.run(`ap_${randomUUID().replaceAll("-", "").slice(0, 12)}`, userId, range.dateKey, contribution.entityType, contribution.entityId, contribution.eventKind, contribution.sourceKind, contribution.startsAt, contribution.endsAt, Number(contribution.totalAp.toFixed(4)), contribution.rateApPerHour, JSON.stringify({
                title: contribution.title,
                why: contribution.why,
                role: contribution.role,
                ...(contribution.metadata ?? {})
            }), createdAt);
        }
    });
}
function syncStatXpEvents(userId, dateKey, contributions) {
    const totals = new Map();
    for (const contribution of contributions) {
        if (contribution.totalAp <= 0) {
            continue;
        }
        const weights = contribution.profile?.demandWeights ?? {
            activation: 0.2,
            focus: 0.25,
            vigor: 0.2,
            composure: 0.15,
            flow: 0.2
        };
        for (const [key, weight] of Object.entries(weights)) {
            totals.set(key, Number(((totals.get(key) ?? 0) + contribution.totalAp * weight).toFixed(4)));
        }
        totals.set("life_force", Number(((totals.get("life_force") ?? 0) + contribution.totalAp * 0.35).toFixed(4)));
    }
    runInTransaction(() => {
        const database = getDatabase();
        database
            .prepare(`DELETE FROM stat_xp_events
         WHERE user_id = ?
           AND json_extract(metadata_json, '$.dateKey') = ?`)
            .run(userId, dateKey);
        const insert = database.prepare(`INSERT INTO stat_xp_events (
         id,
         user_id,
         stat_key,
         delta_xp,
         entity_type,
         entity_id,
         metadata_json,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        const createdAt = nowIso();
        for (const [statKey, deltaXp] of totals.entries()) {
            insert.run(`statxp_${userId}_${dateKey}_${statKey}`, userId, statKey, deltaXp, "system", dateKey, JSON.stringify({
                source: "life_force_daily_rollup",
                dateKey
            }), createdAt);
        }
    });
}
function readTodayLedger(userId, dateKey) {
    return getDatabase()
        .prepare(`SELECT *
       FROM ap_ledger_events
       WHERE user_id = ? AND date_key = ?
       ORDER BY created_at ASC`)
        .all(userId, dateKey);
}
function readTodayFatigueSignals(userId, dateKey) {
    return getDatabase()
        .prepare(`SELECT signal_type, delta
       FROM fatigue_signals
       WHERE user_id = ? AND date_key = ?`)
        .all(userId, dateKey);
}
function buildWarnings(input) {
    const warnings = [];
    if (input.isOverloadedNow) {
        warnings.push({
            id: "lf_overload",
            tone: "danger",
            title: "You are overloaded right now",
            detail: "Current concurrent work is draining more than the available instant capacity."
        });
    }
    if (input.spentTodayAp > input.dailyBudgetAp) {
        warnings.push({
            id: "lf_overspent",
            tone: "warning",
            title: "Daily AP is in debt",
            detail: "Today has already exceeded the calibrated Action Point budget."
        });
    }
    if (input.topTaskIdsNeedingSplit.length > 0) {
        warnings.push({
            id: "lf_split",
            tone: "info",
            title: "A task wants to be split",
            detail: "One or more tasks have grown beyond a healthy expected duration."
        });
    }
    if (warnings.length === 0) {
        warnings.push({
            id: "lf_stable",
            tone: "success",
            title: "Life Force is stable",
            detail: "Today is still inside a healthy capacity band."
        });
    }
    return warnings;
}
export function resolveLifeForceUser(userIds) {
    if (userIds && userIds.length > 0) {
        return getUserById(userIds[0]) ?? getDefaultUser();
    }
    return getDefaultUser();
}
export function buildLifeForcePayload(now = new Date(), userIds) {
    ensureActionProfileTemplates();
    const user = resolveLifeForceUser(userIds);
    const profile = ensureLifeForceProfile(user.id);
    const snapshot = getOrCreateDaySnapshot(user.id, now);
    const range = buildDayRange(now);
    const taskRuns = buildTaskRunContributions(user.id, range, now);
    const notes = buildNoteContributions(user.id, range, now);
    const habits = buildHabitContributions(user.id, range);
    const workouts = buildWorkoutContributions(user.id, range, now);
    const adjustments = buildWorkAdjustmentContributions(user.id, range);
    const contributions = [
        ...taskRuns.contributions,
        ...adjustments,
        ...notes,
        ...habits,
        ...workouts.contributions
    ];
    const seededProfilesByKey = new Map(seededActionProfiles().map((entry) => [entry.profileKey, entry]));
    const taskDurationRows = getDatabase()
        .prepare(`SELECT id, planned_duration_seconds
       FROM tasks`)
        .all();
    const taskDurationById = new Map(taskDurationRows.map((row) => [row.id, row.planned_duration_seconds]));
    const profileLookup = new Map();
    for (const contribution of contributions) {
        if (contribution.entityType === "task") {
            profileLookup.set(`${contribution.entityType}:${contribution.entityId}`, resolveTaskActionProfile({
                id: contribution.entityId,
                plannedDurationSeconds: taskDurationById.get(contribution.entityId) ?? null
            }));
            continue;
        }
        if (contribution.entityType === "note") {
            profileLookup.set(`${contribution.entityType}:${contribution.entityId}`, seededProfilesByKey.get("note_quick") ?? null);
            continue;
        }
        if (contribution.entityType === "habit") {
            profileLookup.set(`${contribution.entityType}:${contribution.entityId}`, seededProfilesByKey.get("habit_default") ?? null);
            continue;
        }
        if (contribution.entityType === "workout_session") {
            profileLookup.set(`${contribution.entityType}:${contribution.entityId}`, seededProfilesByKey.get("workout_default") ?? null);
        }
    }
    const adjustmentApByTaskId = readTodayAdjustmentApByTaskId(user.id, range);
    for (const [taskId, adjustmentAp] of adjustmentApByTaskId.entries()) {
        const existing = taskRuns.totalsByTaskId.get(taskId) ?? { todayAp: 0, totalAp: 0 };
        existing.todayAp += adjustmentAp;
        existing.totalAp += adjustmentAp;
        taskRuns.totalsByTaskId.set(taskId, existing);
    }
    syncApLedger(user.id, range, contributions);
    syncStatXpEvents(user.id, range.dateKey, contributions.map((contribution) => ({
        ...contribution,
        profile: profileLookup.get(`${contribution.entityType}:${contribution.entityId}`) ?? null
    })));
    const ledger = readTodayLedger(user.id, range.dateKey);
    const spentTodayAp = ledger.reduce((sum, row) => sum + row.total_ap, 0);
    const currentCurve = parseCurvePoints(snapshot.points_json);
    const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
    const instantCapacityApPerHour = interpolateCurveRate(currentCurve, minuteOfDay);
    const activeDrains = [
        ...taskRuns.activeDrains,
        ...workouts.activeDrains,
        ...(taskRuns.activeDrains.length === 0 && workouts.activeDrains.length === 0
            ? buildCalendarDrains(user.id, now)
            : [])
    ]
        .sort((left, right) => (right.rateApPerHour ?? 0) - (left.rateApPerHour ?? 0))
        .map((entry, index) => ({
        id: `${entry.sourceKind}:${entry.entityId}`,
        sourceType: entry.entityType,
        sourceId: entry.entityId,
        title: entry.title,
        role: index === 0 ? "primary" : entry.role,
        apPerHour: Number((entry.rateApPerHour ?? 0).toFixed(2)),
        instantAp: Number((entry.totalAp ?? 0).toFixed(2)),
        why: entry.why,
        startedAt: entry.startsAt,
        endsAt: entry.endsAt
    }));
    const sortedRates = activeDrains
        .map((entry) => entry.apPerHour)
        .sort((left, right) => right - left);
    const currentDrainApPerHour = (sortedRates[0] ?? 0) +
        (sortedRates[1] ?? 0) * 0.6 +
        (sortedRates[2] ?? 0) * 0.35 +
        sortedRates.slice(3).reduce((sum, value) => sum + value * 0.2, 0);
    const fatigueFromSignals = readTodayFatigueSignals(user.id, range.dateKey).reduce((sum, signal) => sum + signal.delta, 0);
    const fatigueBufferApPerHour = Math.max(0, Number((fatigueFromSignals + Math.max(0, activeDrains.length - 1) * 1.5).toFixed(2)));
    const rawInstantFreeApPerHour = Number((instantCapacityApPerHour - currentDrainApPerHour - fatigueBufferApPerHour).toFixed(2));
    const instantFreeApPerHour = Math.max(0, rawInstantFreeApPerHour);
    const overloadApPerHour = Math.max(0, Number((-rawInstantFreeApPerHour).toFixed(2)));
    const remainingAp = Number((snapshot.daily_budget_ap - spentTodayAp).toFixed(2));
    const forecastAp = Number((spentTodayAp + currentDrainApPerHour * 2).toFixed(2));
    const targetBandMinAp = Number((snapshot.daily_budget_ap * 0.85).toFixed(2));
    const targetBandMaxAp = Number(snapshot.daily_budget_ap.toFixed(2));
    const workTime = computeWorkTime(now);
    const topTaskIdsNeedingSplit = getDatabase()
        .prepare(`SELECT tasks.id, tasks.planned_duration_seconds
       FROM tasks
       INNER JOIN entity_owners
         ON entity_owners.entity_type = 'task'
        AND entity_owners.entity_id = tasks.id
        AND entity_owners.role = 'owner'
       WHERE entity_owners.user_id = ?`)
        .all(user.id)
        .map((row) => row)
        .filter((row) => {
        const time = workTime.taskSummaries.get(row.id);
        return buildTaskSplitSuggestion({
            plannedDurationSeconds: row.planned_duration_seconds,
            totalTrackedSeconds: time?.totalCreditedSeconds ?? 0,
            projectedTotalSeconds: (time?.totalCreditedSeconds ?? 0) +
                readActiveTaskRunProjectionRows(row.id).reduce((sum, activeRow) => sum + computeProjectedRemainingSeconds(activeRow, now), 0)
        }).shouldSplit;
    })
        .map((row) => row.id)
        .slice(0, 3);
    return lifeForcePayloadSchema.parse({
        userId: user.id,
        dateKey: range.dateKey,
        baselineDailyAp: profile.base_daily_ap,
        dailyBudgetAp: Number(snapshot.daily_budget_ap.toFixed(2)),
        spentTodayAp: Number(spentTodayAp.toFixed(2)),
        remainingAp,
        forecastAp,
        targetBandMinAp,
        targetBandMaxAp,
        instantCapacityApPerHour: Number(instantCapacityApPerHour.toFixed(2)),
        instantFreeApPerHour,
        overloadApPerHour,
        currentDrainApPerHour: Number(currentDrainApPerHour.toFixed(2)),
        fatigueBufferApPerHour,
        sleepRecoveryMultiplier: snapshot.sleep_recovery_multiplier,
        readinessMultiplier: snapshot.readiness_multiplier,
        fatigueDebtCarry: snapshot.fatigue_debt_carry,
        stats: buildStats(profile, user.id),
        currentCurve: currentCurve.map((point) => ({
            ...point,
            locked: point.minuteOfDay <= minuteOfDay
        })),
        activeDrains,
        warnings: buildWarnings({
            spentTodayAp,
            dailyBudgetAp: snapshot.daily_budget_ap,
            isOverloadedNow: rawInstantFreeApPerHour < 0,
            topTaskIdsNeedingSplit
        }),
        recommendations: [
            instantFreeApPerHour <= 0
                ? "Reduce overlap or take a recovery action before starting something new."
                : instantCapacityApPerHour > currentDrainApPerHour + 4
                    ? "This is a good moment for deep work."
                    : "Favor lower-friction admin or recovery until headroom increases."
        ],
        topTaskIdsNeedingSplit,
        updatedAt: now.toISOString()
    });
}
export function buildTaskLifeForceFields(task, userId) {
    const effectiveUserId = userId ?? task.userId ?? getDefaultUser().id;
    const runtime = buildTaskLifeForceRuntime(task, effectiveUserId);
    return {
        actionPointSummary: buildTaskActionPointSummary({
            plannedDurationSeconds: task.plannedDurationSeconds,
            totalCostAp: runtime.profile.totalCostAp,
            spentTodayAp: runtime.spentTodayAp,
            spentTotalAp: runtime.spentTotalAp
        }),
        splitSuggestion: buildTaskSplitSuggestion({
            plannedDurationSeconds: task.plannedDurationSeconds,
            totalTrackedSeconds: task.time.totalCreditedSeconds,
            projectedTotalSeconds: runtime.projectedTotalSeconds
        })
    };
}
export function getTaskCompletionRequirement(task, userId) {
    const effectiveUserId = userId ?? task.userId ?? getDefaultUser().id;
    const runtime = buildTaskLifeForceRuntime(task, effectiveUserId);
    return {
        todayCreditedSeconds: runtime.todayCreditedSeconds,
        requiresWorkLog: runtime.todayCreditedSeconds <= 0
    };
}
export function updateLifeForceProfile(userId, patch) {
    const parsed = lifeForceProfilePatchSchema.parse(patch);
    const current = ensureLifeForceProfile(userId);
    const next = {
        base_daily_ap: parsed.baseDailyAp ?? current.base_daily_ap,
        readiness_multiplier: parsed.readinessMultiplier ?? current.readiness_multiplier,
        life_force_level: parsed.stats?.life_force ?? current.life_force_level,
        activation_level: parsed.stats?.activation ?? current.activation_level,
        focus_level: parsed.stats?.focus ?? current.focus_level,
        vigor_level: parsed.stats?.vigor ?? current.vigor_level,
        composure_level: parsed.stats?.composure ?? current.composure_level,
        flow_level: parsed.stats?.flow ?? current.flow_level
    };
    getDatabase()
        .prepare(`UPDATE life_force_profiles
       SET base_daily_ap = ?,
           readiness_multiplier = ?,
           life_force_level = ?,
           activation_level = ?,
           focus_level = ?,
           vigor_level = ?,
           composure_level = ?,
           flow_level = ?,
           updated_at = ?
       WHERE user_id = ?`)
        .run(next.base_daily_ap, next.readiness_multiplier, next.life_force_level, next.activation_level, next.focus_level, next.vigor_level, next.composure_level, next.flow_level, nowIso(), userId);
    const todayKey = toDateKey(new Date());
    getDatabase()
        .prepare(`DELETE FROM life_force_day_snapshots
       WHERE user_id = ? AND date_key = ?`)
        .run(userId, todayKey);
    return buildLifeForcePayload(new Date(), [userId]);
}
export function updateLifeForceTemplate(userId, weekday, input) {
    const parsed = lifeForceTemplateUpdateSchema.parse(input);
    ensureWeekdayTemplates(userId);
    const normalized = normalizeCurveToBudget([...parsed.points].sort((left, right) => left.minuteOfDay - right.minuteOfDay), LIFE_FORCE_BASELINE_DAILY_AP);
    getDatabase()
        .prepare(`UPDATE life_force_weekday_templates
       SET points_json = ?, updated_at = ?
       WHERE user_id = ? AND weekday = ?`)
        .run(JSON.stringify(normalized), nowIso(), userId, weekday);
    return normalized;
}
export function createFatigueSignal(userId, input) {
    const parsed = fatigueSignalCreateSchema.parse(input);
    const observedAt = parsed.observedAt ?? nowIso();
    const dateKey = observedAt.slice(0, 10);
    const delta = parsed.signalType === "tired" ? 4 : -4;
    getDatabase()
        .prepare(`INSERT INTO fatigue_signals (
         id,
         user_id,
         date_key,
         signal_type,
         observed_at,
         note,
         delta,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`fatigue_${randomUUID().replaceAll("-", "").slice(0, 12)}`, userId, dateKey, parsed.signalType, observedAt, parsed.note ?? "", delta, nowIso());
    return buildLifeForcePayload(new Date(observedAt), [userId]);
}
export function listLifeForceTemplates(userId) {
    ensureWeekdayTemplates(userId);
    return getDatabase()
        .prepare(`SELECT *
       FROM life_force_weekday_templates
       WHERE user_id = ?
       ORDER BY weekday ASC`)
        .all(userId)
        .map((row) => row)
        .map((row) => ({
        weekday: row.weekday,
        baselineDailyAp: row.baseline_daily_ap,
        points: parseCurvePoints(row.points_json)
    }));
}
