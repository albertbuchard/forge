import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { computeWorkTime } from "../services/work-time.js";
import { recordActivityEvent } from "./activity-events.js";
import { recordTaskRunCompletionReward, recordTaskRunProgressRewards, recordTaskRunStartReward } from "./rewards.js";
import { getTaskById, updateTaskInTransaction } from "./tasks.js";
import { taskRunClaimSchema, taskRunSchema } from "../types.js";
function leaseExpiry(now, ttlSeconds) {
    return new Date(now.getTime() + ttlSeconds * 1000).toISOString();
}
function selectClause() {
    return `SELECT
    task_runs.id,
    task_runs.task_id,
    task_runs.actor,
    task_runs.status,
    task_runs.timer_mode,
    task_runs.planned_duration_seconds,
    task_runs.is_current,
    task_runs.note,
    task_runs.lease_ttl_seconds,
    task_runs.claimed_at,
    task_runs.heartbeat_at,
    task_runs.lease_expires_at,
    task_runs.completed_at,
    task_runs.released_at,
    task_runs.timed_out_at,
    task_runs.updated_at,
    tasks.title AS task_title
   FROM task_runs
   INNER JOIN tasks ON tasks.id = task_runs.task_id`;
}
function readExecutionConfig() {
    try {
        const row = getDatabase()
            .prepare(`SELECT max_active_tasks, time_accounting_mode
         FROM app_settings
         WHERE id = 1`)
            .get();
        return {
            maxActiveTasks: Math.max(1, row?.max_active_tasks ?? 2),
            timeAccountingMode: row?.time_accounting_mode ?? "split"
        };
    }
    catch {
        return {
            maxActiveTasks: 2,
            timeAccountingMode: "split"
        };
    }
}
function mapTaskRun(row, now = new Date(), cached = computeWorkTime(now)) {
    const metric = cached.runMetrics.get(row.id);
    return taskRunSchema.parse({
        id: row.id,
        taskId: row.task_id,
        taskTitle: row.task_title,
        actor: row.actor,
        status: row.status,
        timerMode: row.timer_mode,
        plannedDurationSeconds: row.planned_duration_seconds,
        elapsedWallSeconds: metric?.elapsedWallSeconds ?? 0,
        creditedSeconds: metric?.creditedSeconds ?? 0,
        remainingSeconds: metric?.remainingSeconds ?? row.planned_duration_seconds,
        overtimeSeconds: metric?.overtimeSeconds ?? 0,
        isCurrent: metric?.isCurrent ?? false,
        note: row.note,
        leaseTtlSeconds: row.lease_ttl_seconds,
        claimedAt: row.claimed_at,
        heartbeatAt: row.heartbeat_at,
        leaseExpiresAt: row.lease_expires_at,
        completedAt: row.completed_at,
        releasedAt: row.released_at,
        timedOutAt: row.timed_out_at,
        updatedAt: row.updated_at
    });
}
function getTaskRunRowById(taskRunId) {
    return getDatabase()
        .prepare(`${selectClause()}
       WHERE task_runs.id = ?`)
        .get(taskRunId);
}
function listActiveRunRowsByActor(actor, now, excludeRunId) {
    const params = [actor, now.toISOString()];
    const excludeSql = excludeRunId ? "AND task_runs.id != ?" : "";
    if (excludeRunId) {
        params.push(excludeRunId);
    }
    return getDatabase()
        .prepare(`${selectClause()}
       WHERE task_runs.actor = ?
         AND task_runs.status = 'active'
         AND task_runs.lease_expires_at >= ?
         ${excludeSql}
       ORDER BY task_runs.is_current DESC, task_runs.claimed_at DESC`)
        .all(...params);
}
function getActiveTaskRunRow(taskId, now) {
    return getDatabase()
        .prepare(`${selectClause()}
       WHERE task_runs.task_id = ?
         AND task_runs.status = 'active'
         AND task_runs.lease_expires_at >= ?
       ORDER BY task_runs.claimed_at DESC
       LIMIT 1`)
        .get(taskId, now.toISOString());
}
function requireRun(runId) {
    const run = getTaskRunRowById(runId);
    if (!run) {
        throw new HttpError(404, "task_run_not_found", `Task run ${runId} does not exist`);
    }
    return run;
}
function secondsUntilLeaseExpiry(leaseExpiresAt, now) {
    return Math.max(0, Math.ceil((Date.parse(leaseExpiresAt) - now.getTime()) / 1000));
}
function buildTaskRunErrorDetails(run, now, details = {}) {
    const cached = computeWorkTime(now);
    const response = {
        ...details,
        ...(run ? { taskRun: mapTaskRun(run, now, cached) } : {})
    };
    if (run?.status === "active" && response.retryAfterSeconds === undefined) {
        response.retryAfterSeconds = secondsUntilLeaseExpiry(run.lease_expires_at, now);
    }
    return response;
}
function assertActorMatch(run, actualActor, now) {
    if (actualActor && actualActor !== run.actor) {
        throw new HttpError(409, "task_run_actor_conflict", `Task run is owned by ${run.actor}, not ${actualActor}`, buildTaskRunErrorDetails(run, now, { requestedActor: actualActor }));
    }
}
function requireKnownTask(taskId) {
    if (!getTaskById(taskId)) {
        throw new HttpError(404, "task_not_found", `Task ${taskId} does not exist`);
    }
}
function setCurrentRunInTransaction(actor, taskRunId) {
    const db = getDatabase();
    // Two-step update to avoid UNIQUE index violation on
    // idx_task_runs_single_current_per_actor (actor WHERE status='active' AND is_current=1).
    // A single CASE UPDATE can momentarily have two is_current=1 rows which SQLite rejects.
    db.prepare(`UPDATE task_runs SET is_current = 0 WHERE actor = ? AND status = 'active' AND is_current = 1`).run(actor);
    db.prepare(`UPDATE task_runs SET is_current = 1 WHERE id = ? AND actor = ? AND status = 'active'`).run(taskRunId, actor);
}
function ensureCurrentRunExistsInTransaction(actor, now) {
    const current = getDatabase()
        .prepare(`SELECT id
       FROM task_runs
       WHERE actor = ? AND status = 'active' AND lease_expires_at >= ? AND is_current = 1
       LIMIT 1`)
        .get(actor, now.toISOString());
    if (current) {
        return;
    }
    const fallback = getDatabase()
        .prepare(`SELECT id
       FROM task_runs
       WHERE actor = ? AND status = 'active' AND lease_expires_at >= ?
       ORDER BY claimed_at DESC
       LIMIT 1`)
        .get(actor, now.toISOString());
    if (fallback) {
        setCurrentRunInTransaction(actor, fallback.id);
    }
}
function touchTaskInProgress(taskId, actor, source) {
    const task = getTaskById(taskId);
    if (!task || task.status === "done" || task.status === "in_progress") {
        return;
    }
    updateTaskInTransaction(taskId, { status: "in_progress" }, { actor, source });
}
function enforceActiveRunLimit(actor, taskId, now) {
    const config = readExecutionConfig();
    const activeRuns = listActiveRunRowsByActor(actor, now);
    if (activeRuns.length < config.maxActiveTasks) {
        return;
    }
    throw new HttpError(409, "task_run_limit_exceeded", `Cannot start ${taskId} because ${actor} already has ${activeRuns.length} active task timers (limit ${config.maxActiveTasks}).`, {
        activeRuns: activeRuns.map((run) => mapTaskRun(run, now)),
        limit: config.maxActiveTasks,
        timeAccountingMode: config.timeAccountingMode
    });
}
function maybeSetCurrentRun(actor, taskRunId, requestedIsCurrent, now) {
    if (requestedIsCurrent) {
        setCurrentRunInTransaction(actor, taskRunId);
        return;
    }
    ensureCurrentRunExistsInTransaction(actor, now);
}
function promoteFallbackCurrentRun(actor, now) {
    ensureCurrentRunExistsInTransaction(actor, now);
}
function markExpiredRunsTimedOutInTransaction(now, limit) {
    const nowIso = now.toISOString();
    const params = [nowIso];
    const limitSql = limit ? "LIMIT ?" : "";
    if (limit) {
        params.push(limit);
    }
    const expired = getDatabase()
        .prepare(`${selectClause()}
       WHERE task_runs.status = 'active' AND task_runs.lease_expires_at < ?
       ORDER BY task_runs.lease_expires_at
       ${limitSql}`)
        .all(...params);
    if (expired.length === 0) {
        return [];
    }
    const update = getDatabase().prepare(`UPDATE task_runs
     SET status = 'timed_out', timed_out_at = ?, is_current = 0, updated_at = ?
     WHERE id = ?`);
    for (const run of expired) {
        update.run(nowIso, nowIso, run.id);
        recordActivityEvent({
            entityType: "task_run",
            entityId: run.id,
            eventType: "task_run_timed_out",
            title: `Task timer timed out: ${run.task_title}`,
            description: `${run.actor} lost the live timer on ${run.task_title}.`,
            actor: run.actor,
            source: "system",
            metadata: {
                taskId: run.task_id,
                leaseExpiresAt: run.lease_expires_at
            }
        });
        promoteFallbackCurrentRun(run.actor, now);
    }
    const cached = computeWorkTime(now);
    return expired.map((run) => mapTaskRun({
        ...run,
        status: "timed_out",
        is_current: 0,
        timed_out_at: nowIso,
        updated_at: nowIso
    }, now, cached));
}
export function recoverTimedOutTaskRuns(options = {}) {
    return runInTransaction(() => markExpiredRunsTimedOutInTransaction(options.now ?? new Date(), options.limit));
}
export function listTaskRuns(filters = {}, now = new Date()) {
    return runInTransaction(() => {
        markExpiredRunsTimedOutInTransaction(now);
        const whereClauses = [];
        const params = [];
        if (filters.taskId) {
            whereClauses.push("task_runs.task_id = ?");
            params.push(filters.taskId);
        }
        if (filters.active) {
            whereClauses.push("task_runs.status = 'active'");
        }
        else if (filters.status) {
            whereClauses.push("task_runs.status = ?");
            params.push(filters.status);
        }
        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
        const limitSql = filters.limit ? "LIMIT ?" : "";
        if (filters.limit) {
            params.push(filters.limit);
        }
        const rows = getDatabase()
            .prepare(`${selectClause()}
         ${whereSql}
         ORDER BY
           CASE task_runs.status
             WHEN 'active' THEN 0
             WHEN 'timed_out' THEN 1
             WHEN 'released' THEN 2
             ELSE 3
           END,
           task_runs.is_current DESC,
           task_runs.updated_at DESC
         ${limitSql}`)
            .all(...params);
        const cached = computeWorkTime(now);
        return rows.map((row) => mapTaskRun(row, now, cached));
    });
}
export function claimTaskRun(taskId, input, now = new Date(), activity = { source: "ui" }) {
    return runInTransaction(() => {
        const parsedInput = taskRunClaimSchema.parse(input);
        markExpiredRunsTimedOutInTransaction(now);
        requireKnownTask(taskId);
        const existing = getActiveTaskRunRow(taskId, now);
        const nowIso = now.toISOString();
        if (existing) {
            if (existing.actor !== parsedInput.actor) {
                throw new HttpError(409, "task_run_conflict", `Task ${taskId} already has an active timer owned by ${existing.actor}.`, buildTaskRunErrorDetails(existing, now, { requestedActor: parsedInput.actor }));
            }
            const nextExpiry = leaseExpiry(now, parsedInput.leaseTtlSeconds);
            getDatabase()
                .prepare(`UPDATE task_runs
           SET timer_mode = ?, planned_duration_seconds = ?, is_current = ?, heartbeat_at = ?, lease_expires_at = ?, lease_ttl_seconds = ?, note = ?, updated_at = ?
           WHERE id = ?`)
                .run(parsedInput.timerMode, parsedInput.plannedDurationSeconds, existing.is_current, nowIso, nextExpiry, parsedInput.leaseTtlSeconds, parsedInput.note, nowIso, existing.id);
            maybeSetCurrentRun(parsedInput.actor, existing.id, parsedInput.isCurrent, now);
            touchTaskInProgress(taskId, parsedInput.actor, activity.source);
            recordActivityEvent({
                entityType: "task_run",
                entityId: existing.id,
                eventType: "task_run_renewed",
                title: `Task timer renewed: ${existing.task_title}`,
                description: `${parsedInput.actor} refreshed the live timer.`,
                actor: parsedInput.actor,
                source: activity.source,
                metadata: {
                    taskId,
                    leaseTtlSeconds: parsedInput.leaseTtlSeconds,
                    timerMode: parsedInput.timerMode,
                    plannedDurationSeconds: parsedInput.plannedDurationSeconds
                }
            });
            const cached = computeWorkTime(now);
            return {
                run: mapTaskRun(requireRun(existing.id), now, cached),
                replayed: true
            };
        }
        enforceActiveRunLimit(parsedInput.actor, taskId, now);
        const runId = `run_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
        const expiry = leaseExpiry(now, parsedInput.leaseTtlSeconds);
        getDatabase()
            .prepare(`INSERT INTO task_runs (
          id, task_id, actor, status, timer_mode, planned_duration_seconds, is_current, note, lease_ttl_seconds, claimed_at, heartbeat_at, lease_expires_at, updated_at
         )
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(runId, taskId, parsedInput.actor, parsedInput.timerMode, parsedInput.plannedDurationSeconds, 0, parsedInput.note, parsedInput.leaseTtlSeconds, nowIso, nowIso, expiry, nowIso);
        maybeSetCurrentRun(parsedInput.actor, runId, parsedInput.isCurrent, now);
        touchTaskInProgress(taskId, parsedInput.actor, activity.source);
        const run = mapTaskRun(requireRun(runId), now);
        recordActivityEvent({
            entityType: "task_run",
            entityId: run.id,
            eventType: "task_run_claimed",
            title: `Task timer started: ${run.taskTitle}`,
            description: run.timerMode === "planned"
                ? `${run.actor} started a planned work timer.`
                : `${run.actor} started an unlimited work timer.`,
            actor: run.actor,
            source: activity.source,
            metadata: {
                taskId: run.taskId,
                leaseTtlSeconds: run.leaseTtlSeconds,
                timerMode: run.timerMode,
                plannedDurationSeconds: run.plannedDurationSeconds
            }
        });
        recordTaskRunStartReward(run.id, run.taskId, run.actor, activity.source);
        return { run, replayed: false };
    });
}
export function heartbeatTaskRun(taskRunId, input, now = new Date(), activity = { source: "ui" }) {
    return runInTransaction(() => {
        markExpiredRunsTimedOutInTransaction(now);
        const current = requireRun(taskRunId);
        if (current.status !== "active") {
            throw new HttpError(409, "task_run_not_active", `Task run ${taskRunId} is ${current.status} and cannot accept heartbeats`, buildTaskRunErrorDetails(current, now));
        }
        assertActorMatch(current, input.actor, now);
        const nowIso = now.toISOString();
        const nextExpiry = leaseExpiry(now, input.leaseTtlSeconds);
        const note = input.note ?? current.note;
        getDatabase()
            .prepare(`UPDATE task_runs
         SET heartbeat_at = ?, lease_expires_at = ?, lease_ttl_seconds = ?, note = ?, updated_at = ?
         WHERE id = ?`)
            .run(nowIso, nextExpiry, input.leaseTtlSeconds, note, nowIso, taskRunId);
        const run = mapTaskRun({
            ...current,
            heartbeat_at: nowIso,
            lease_expires_at: nextExpiry,
            lease_ttl_seconds: input.leaseTtlSeconds,
            note,
            updated_at: nowIso
        }, now);
        recordActivityEvent({
            entityType: "task_run",
            entityId: run.id,
            eventType: "task_run_heartbeat",
            title: `Task timer heartbeat: ${run.taskTitle}`,
            description: `${run.actor} renewed timer liveness.`,
            actor: run.actor,
            source: activity.source,
            metadata: {
                taskId: run.taskId,
                leaseTtlSeconds: run.leaseTtlSeconds
            }
        });
        recordTaskRunProgressRewards(run.id, run.taskId, input.actor ?? run.actor, activity.source, run.creditedSeconds);
        return run;
    });
}
export function focusTaskRun(taskRunId, input, now = new Date(), activity = { source: "ui" }) {
    return runInTransaction(() => {
        markExpiredRunsTimedOutInTransaction(now);
        const current = requireRun(taskRunId);
        if (current.status !== "active") {
            throw new HttpError(409, "task_run_not_active", `Task run ${taskRunId} is ${current.status} and cannot be focused`, buildTaskRunErrorDetails(current, now));
        }
        assertActorMatch(current, input.actor, now);
        setCurrentRunInTransaction(current.actor, taskRunId);
        const focused = mapTaskRun({ ...current, is_current: 1 }, now);
        recordActivityEvent({
            entityType: "task_run",
            entityId: focused.id,
            eventType: "task_run_focused",
            title: `Task timer focused: ${focused.taskTitle}`,
            description: `${focused.actor} made this the current work timer.`,
            actor: input.actor ?? focused.actor,
            source: activity.source,
            metadata: {
                taskId: focused.taskId
            }
        });
        return focused;
    });
}
function finishTaskRun(taskRunId, nextStatus, timestampColumn, input, now, activity) {
    return runInTransaction(() => {
        markExpiredRunsTimedOutInTransaction(now);
        const current = requireRun(taskRunId);
        if (current.status === nextStatus) {
            assertActorMatch(current, input.actor, now);
            return mapTaskRun(current, now);
        }
        if (current.status !== "active") {
            throw new HttpError(409, "task_run_not_active", `Task run ${taskRunId} is ${current.status} and cannot transition to ${nextStatus}`, buildTaskRunErrorDetails(current, now));
        }
        assertActorMatch(current, input.actor, now);
        const nowIso = now.toISOString();
        const note = input.note.length > 0 ? input.note : current.note;
        getDatabase()
            .prepare(`UPDATE task_runs
         SET status = ?, note = ?, is_current = 0, ${timestampColumn} = ?, updated_at = ?
         WHERE id = ?`)
            .run(nextStatus, note, nowIso, nowIso, taskRunId);
        promoteFallbackCurrentRun(current.actor, now);
        const run = mapTaskRun({
            ...current,
            status: nextStatus,
            note,
            is_current: 0,
            [timestampColumn]: nowIso,
            updated_at: nowIso
        }, now);
        recordActivityEvent({
            entityType: "task_run",
            entityId: run.id,
            eventType: nextStatus === "completed" ? "task_run_completed" : "task_run_released",
            title: `${nextStatus === "completed" ? "Task timer completed" : "Task timer paused"}: ${run.taskTitle}`,
            description: nextStatus === "completed"
                ? `${run.actor} completed the work timer.`
                : `${run.actor} paused the work timer.`,
            actor: run.actor,
            source: activity.source,
            metadata: {
                taskId: run.taskId,
                status: run.status,
                creditedSeconds: run.creditedSeconds
            }
        });
        recordTaskRunProgressRewards(run.id, run.taskId, input.actor ?? run.actor, activity.source, run.creditedSeconds);
        if (nextStatus === "completed") {
            recordTaskRunCompletionReward(run.id, run.taskId, input.actor ?? run.actor, activity.source);
            const task = getTaskById(run.taskId);
            if (task && task.status !== "done") {
                updateTaskInTransaction(run.taskId, { status: "done" }, {
                    source: activity.source,
                    actor: input.actor ?? run.actor
                });
            }
        }
        return run;
    });
}
export function completeTaskRun(taskRunId, input, now = new Date(), activity = { source: "ui" }) {
    return finishTaskRun(taskRunId, "completed", "completed_at", input, now, activity);
}
export function releaseTaskRun(taskRunId, input, now = new Date(), activity = { source: "ui" }) {
    return finishTaskRun(taskRunId, "released", "released_at", input, now, activity);
}
