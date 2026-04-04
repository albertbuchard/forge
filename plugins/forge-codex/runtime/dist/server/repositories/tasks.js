import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import { runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { recordActivityEvent } from "./activity-events.js";
import { filterDeletedEntities, filterDeletedIds, isEntityDeleted } from "./deleted-entities.js";
import { getGoalById } from "./goals.js";
import { createLinkedNotes } from "./notes.js";
import { ensureDefaultProjectForGoal, getProjectById } from "./projects.js";
import { pruneLinkedEntityReferences } from "./psyche.js";
import { awardTaskCompletionReward, reverseLatestTaskCompletionReward } from "./rewards.js";
import { assertTaskRelations } from "../services/relations.js";
import { computeWorkTime, emptyTaskTimeSummary } from "../services/work-time.js";
import { calendarSchedulingRulesSchema, taskSchema } from "../types.js";
function readTaskTagIds(taskId) {
    const rows = getDatabase()
        .prepare(`SELECT tag_id FROM task_tags WHERE task_id = ? ORDER BY tag_id`)
        .all(taskId);
    return filterDeletedIds("tag", rows.map((row) => row.tag_id));
}
function mapTask(row, time = emptyTaskTimeSummary()) {
    return taskSchema.parse({
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        owner: row.owner,
        goalId: row.goal_id,
        projectId: row.project_id,
        dueDate: row.due_date,
        effort: row.effort,
        energy: row.energy,
        points: row.points,
        plannedDurationSeconds: row.planned_duration_seconds,
        schedulingRules: row.scheduling_rules_json === null
            ? null
            : calendarSchedulingRulesSchema.parse(JSON.parse(row.scheduling_rules_json)),
        sortOrder: row.sort_order,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        tagIds: readTaskTagIds(row.id),
        time
    });
}
function replaceTaskTags(taskId, tagIds) {
    const database = getDatabase();
    database.prepare(`DELETE FROM task_tags WHERE task_id = ?`).run(taskId);
    const insert = database.prepare(`INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)`);
    for (const tagId of tagIds) {
        insert.run(taskId, tagId);
    }
}
function nextSortOrder(status) {
    const row = getDatabase()
        .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM tasks WHERE status = ?`)
        .get(status);
    return row.max_sort + 1;
}
function normalizeCompletedAt(status, existingCompletedAt) {
    if (status === "done") {
        return existingCompletedAt ?? new Date().toISOString();
    }
    return null;
}
function resolveProjectAndGoalIds(input, current) {
    const currentGoalId = current?.goalId && getGoalById(current.goalId) ? current.goalId : null;
    const currentProject = current?.projectId ? getProjectById(current.projectId) ?? null : null;
    const currentProjectGoalId = currentProject?.goalId && getGoalById(currentProject.goalId) ? currentProject.goalId : null;
    const currentProjectId = currentProject?.id ?? null;
    const requestedGoalId = input.goalId === undefined ? currentGoalId : input.goalId;
    const goalChangedWithoutProjectOverride = current !== undefined && input.goalId !== undefined && input.goalId !== current.goalId && input.projectId === undefined;
    const requestedProjectId = input.projectId === undefined ? (goalChangedWithoutProjectOverride ? null : currentProjectId) : input.projectId;
    if (requestedProjectId) {
        const project = getProjectById(requestedProjectId);
        if (!project) {
            throw new HttpError(404, "project_not_found", `Project ${requestedProjectId} does not exist`);
        }
        const projectGoalId = getGoalById(project.goalId) ? project.goalId : null;
        if (requestedGoalId && projectGoalId && project.goalId !== requestedGoalId) {
            throw new HttpError(409, "project_goal_mismatch", `Project ${requestedProjectId} does not belong to goal ${requestedGoalId}`);
        }
        return {
            goalId: projectGoalId,
            projectId: project.id
        };
    }
    if (requestedGoalId) {
        const defaultProject = ensureDefaultProjectForGoal(requestedGoalId);
        return {
            goalId: requestedGoalId,
            projectId: defaultProject.id
        };
    }
    return {
        goalId: null,
        projectId: null
    };
}
function inferReopenStatus(taskId) {
    const row = getDatabase()
        .prepare(`SELECT metadata_json
       FROM activity_events
       WHERE entity_type = 'task'
         AND entity_id = ?
         AND event_type = 'task_completed'
         AND NOT EXISTS (
           SELECT 1
           FROM activity_event_corrections
           WHERE activity_event_corrections.corrected_event_id = activity_events.id
         )
       ORDER BY created_at DESC
       LIMIT 1`)
        .get(taskId);
    if (!row) {
        return "focus";
    }
    const metadata = JSON.parse(row.metadata_json);
    return metadata.previousStatus && metadata.previousStatus !== "done" ? metadata.previousStatus : "focus";
}
function updateTaskRecord(current, input, activity) {
    const relationState = resolveProjectAndGoalIds(input, current);
    const nextGoalId = relationState.goalId;
    const nextProjectId = relationState.projectId;
    const nextTagIds = input.tagIds ?? current.tagIds;
    assertTaskRelations({ goalId: nextGoalId, tagIds: nextTagIds });
    const nextStatus = input.status ?? current.status;
    const movedColumns = nextStatus !== current.status;
    const nextSort = input.sortOrder ?? (movedColumns ? nextSortOrder(nextStatus) : current.sortOrder);
    const completedAt = normalizeCompletedAt(nextStatus, current.completedAt);
    const updatedAt = new Date().toISOString();
    getDatabase()
        .prepare(`UPDATE tasks
       SET title = ?, description = ?, status = ?, priority = ?, owner = ?, goal_id = ?, due_date = ?, effort = ?,
           energy = ?, points = ?, planned_duration_seconds = ?, scheduling_rules_json = ?, sort_order = ?, completed_at = ?, updated_at = ?, project_id = ?
       WHERE id = ?`)
        .run(input.title ?? current.title, input.description ?? current.description, nextStatus, input.priority ?? current.priority, input.owner ?? current.owner, nextGoalId, input.dueDate === undefined ? current.dueDate : input.dueDate, input.effort ?? current.effort, input.energy ?? current.energy, input.points ?? current.points, input.plannedDurationSeconds === undefined
        ? current.plannedDurationSeconds
        : input.plannedDurationSeconds, input.schedulingRules === undefined
        ? current.schedulingRules === null
            ? null
            : JSON.stringify(current.schedulingRules)
        : input.schedulingRules === null
            ? null
            : JSON.stringify(input.schedulingRules), nextSort, completedAt, updatedAt, nextProjectId, current.id);
    replaceTaskTags(current.id, nextTagIds);
    const updated = getTaskById(current.id);
    if (updated && activity) {
        const statusChanged = current.status !== updated.status;
        const ownerChanged = current.owner !== updated.owner;
        const goalChanged = current.goalId !== updated.goalId;
        const projectChanged = current.projectId !== updated.projectId;
        const pointsChanged = current.points !== updated.points;
        const eventType = statusChanged && updated.status === "done"
            ? "task_completed"
            : statusChanged && current.status === "done"
                ? "task_uncompleted"
                : statusChanged
                    ? "task_status_changed"
                    : "task_updated";
        const title = eventType === "task_completed"
            ? `Task completed: ${updated.title}`
            : eventType === "task_uncompleted"
                ? `Task reopened: ${updated.title}`
                : eventType === "task_status_changed"
                    ? `Task moved to ${updated.status.replaceAll("_", " ")}: ${updated.title}`
                    : `Task updated: ${updated.title}`;
        recordActivityEvent({
            entityType: "task",
            entityId: updated.id,
            eventType,
            title,
            description: goalChanged
                ? `Goal link updated${updated.goalId ? ` to ${updated.goalId}` : ""}.`
                : projectChanged
                    ? `Project link updated${updated.projectId ? ` to ${updated.projectId}` : ""}.`
                    : ownerChanged
                        ? `Ownership changed to ${updated.owner}.`
                        : statusChanged
                            ? `Status changed from ${current.status} to ${updated.status}.`
                            : "Task details were edited.",
            actor: activity.actor ?? null,
            source: activity.source,
            metadata: {
                previousStatus: current.status,
                status: updated.status,
                owner: updated.owner,
                previousOwner: current.owner,
                goalId: updated.goalId,
                previousGoalId: current.goalId,
                projectId: updated.projectId,
                previousProjectId: current.projectId,
                points: updated.points,
                previousPoints: current.points,
                pointsChanged
            }
        });
        if (current.status !== "done" && updated.status === "done") {
            awardTaskCompletionReward(updated, activity);
        }
        else if (current.status === "done" && updated.status !== "done") {
            reverseLatestTaskCompletionReward(updated, activity);
        }
    }
    if (updated) {
        createLinkedNotes(input.notes, { entityType: "task", entityId: updated.id, anchorKey: null }, activity ?? { source: "ui", actor: null });
    }
    return updated;
}
function fingerprintTaskCreate(input) {
    return createHash("sha256")
        .update(JSON.stringify({
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        owner: input.owner,
        goalId: input.goalId,
        projectId: input.projectId,
        dueDate: input.dueDate,
        effort: input.effort,
        energy: input.energy,
        points: input.points,
        plannedDurationSeconds: input.plannedDurationSeconds,
        schedulingRules: input.schedulingRules,
        sortOrder: input.sortOrder ?? null,
        tagIds: input.tagIds,
        notes: input.notes.map((note) => ({
            contentMarkdown: note.contentMarkdown,
            author: note.author,
            links: note.links
        }))
    }))
        .digest("hex");
}
function insertTaskRecord(input, activity) {
    const relationState = resolveProjectAndGoalIds(input);
    assertTaskRelations({ goalId: relationState.goalId, tagIds: input.tagIds });
    if (!relationState.projectId) {
        throw new HttpError(400, "project_required", "Tasks must belong to a project");
    }
    const now = new Date().toISOString();
    const id = `task_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const sortOrder = input.sortOrder ?? nextSortOrder(input.status);
    const completedAt = normalizeCompletedAt(input.status, null);
    getDatabase()
        .prepare(`INSERT INTO tasks (
        id, title, description, status, priority, owner, goal_id, project_id, due_date, effort, energy, points,
        planned_duration_seconds, scheduling_rules_json, sort_order, completed_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.title, input.description, input.status, input.priority, input.owner, relationState.goalId, relationState.projectId, input.dueDate, input.effort, input.energy, input.points, input.plannedDurationSeconds, input.schedulingRules === null ? null : JSON.stringify(input.schedulingRules), sortOrder, completedAt, now, now);
    replaceTaskTags(id, input.tagIds);
    const task = getTaskById(id);
    if (activity) {
        recordActivityEvent({
            entityType: "task",
            entityId: task.id,
            eventType: "task_created",
            title: `Task created: ${task.title}`,
            description: task.goalId ? `Linked to ${task.goalId} and assigned to ${task.owner}.` : `Assigned to ${task.owner}.`,
            actor: activity.actor ?? null,
            source: activity.source,
            metadata: {
                status: task.status,
                owner: task.owner,
                goalId: task.goalId,
                projectId: task.projectId,
                points: task.points
            }
        });
        if (task.status === "done") {
            awardTaskCompletionReward(task, activity);
        }
    }
    createLinkedNotes(input.notes, { entityType: "task", entityId: task.id, anchorKey: null }, activity ?? { source: "ui", actor: null });
    return task;
}
export function listTasks(filters = {}) {
    const whereClauses = [];
    const params = [];
    const todayIso = new Date().toISOString().slice(0, 10);
    const weekIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (filters.status) {
        whereClauses.push("status = ?");
        params.push(filters.status);
    }
    if (filters.owner) {
        whereClauses.push("owner = ?");
        params.push(filters.owner);
    }
    if (filters.goalId) {
        whereClauses.push("goal_id = ?");
        params.push(filters.goalId);
    }
    if (filters.projectId) {
        whereClauses.push("project_id = ?");
        params.push(filters.projectId);
    }
    if (filters.tagId) {
        whereClauses.push("EXISTS (SELECT 1 FROM task_tags WHERE task_tags.task_id = tasks.id AND task_tags.tag_id = ?)");
        params.push(filters.tagId);
    }
    if (filters.due === "overdue") {
        whereClauses.push("status != 'done' AND due_date IS NOT NULL AND due_date < ?");
        params.push(todayIso);
    }
    if (filters.due === "today") {
        whereClauses.push("status != 'done' AND due_date = ?");
        params.push(todayIso);
    }
    if (filters.due === "week") {
        whereClauses.push("status != 'done' AND due_date IS NOT NULL AND due_date >= ? AND due_date <= ?");
        params.push(todayIso, weekIso);
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const limitSql = filters.limit ? "LIMIT ?" : "";
    if (filters.limit) {
        params.push(filters.limit);
    }
    const rows = getDatabase()
        .prepare(`SELECT id, title, description, status, priority, owner, goal_id, project_id, due_date, effort, energy, points,
              planned_duration_seconds, scheduling_rules_json, sort_order,
              completed_at, created_at, updated_at
       FROM tasks
       ${whereSql}
       ORDER BY
         CASE status
           WHEN 'backlog' THEN 0
           WHEN 'focus' THEN 1
           WHEN 'in_progress' THEN 2
           WHEN 'blocked' THEN 3
           ELSE 4
         END,
         sort_order,
         created_at
       ${limitSql}`)
        .all(...params);
    const workTime = computeWorkTime();
    return filterDeletedEntities("task", rows.map((row) => mapTask(row, workTime.taskSummaries.get(row.id) ?? emptyTaskTimeSummary())));
}
export function getTaskById(taskId) {
    if (isEntityDeleted("task", taskId)) {
        return undefined;
    }
    const row = getDatabase()
        .prepare(`SELECT id, title, description, status, priority, owner, goal_id, project_id, due_date, effort, energy, points,
              planned_duration_seconds, scheduling_rules_json, sort_order,
              completed_at, created_at, updated_at
       FROM tasks
       WHERE id = ?`)
        .get(taskId);
    const workTime = computeWorkTime();
    return row ? mapTask(row, workTime.taskSummaries.get(row.id) ?? emptyTaskTimeSummary()) : undefined;
}
export function createTask(input, activity) {
    return runInTransaction(() => insertTaskRecord(input, activity));
}
export function createTaskWithIdempotency(input, idempotencyKey, activity) {
    return runInTransaction(() => {
        const fingerprint = fingerprintTaskCreate(input);
        const existing = getDatabase()
            .prepare(`SELECT task_id, request_fingerprint
         FROM task_create_idempotency
         WHERE idempotency_key = ?`)
            .get(idempotencyKey);
        if (existing) {
            if (existing.request_fingerprint !== fingerprint) {
                throw new HttpError(409, "idempotency_conflict", "Idempotency key was already used for a different task creation payload");
            }
            const task = getTaskById(existing.task_id);
            if (!task) {
                throw new HttpError(500, "idempotency_corruption", `Stored task ${existing.task_id} for idempotency key is missing`);
            }
            return { task, replayed: true };
        }
        const task = insertTaskRecord(input, activity);
        getDatabase()
            .prepare(`INSERT INTO task_create_idempotency (idempotency_key, request_fingerprint, task_id, created_at)
         VALUES (?, ?, ?, ?)`)
            .run(idempotencyKey, fingerprint, task.id, new Date().toISOString());
        return { task, replayed: false };
    });
}
export function updateTask(taskId, input, activity) {
    const current = getTaskById(taskId);
    if (!current) {
        return undefined;
    }
    return runInTransaction(() => updateTaskRecord(current, input, activity));
}
export function updateTaskInTransaction(taskId, input, activity) {
    const current = getTaskById(taskId);
    if (!current) {
        return undefined;
    }
    return updateTaskRecord(current, input, activity);
}
export function uncompleteTask(taskId, activity) {
    const current = getTaskById(taskId);
    if (!current) {
        return undefined;
    }
    if (current.status !== "done") {
        return current;
    }
    return runInTransaction(() => updateTaskRecord(current, { status: inferReopenStatus(taskId) }, activity));
}
export function deleteTask(taskId, activity) {
    const current = getTaskById(taskId);
    if (!current) {
        return undefined;
    }
    return runInTransaction(() => {
        pruneLinkedEntityReferences("task", taskId);
        getDatabase()
            .prepare(`DELETE FROM tasks WHERE id = ?`)
            .run(taskId);
        if (activity) {
            recordActivityEvent({
                entityType: "task",
                entityId: current.id,
                eventType: "task_deleted",
                title: `Task deleted: ${current.title}`,
                description: "Task removed from the system.",
                actor: activity.actor ?? null,
                source: activity.source,
                metadata: {
                    status: current.status,
                    owner: current.owner,
                    goalId: current.goalId,
                    projectId: current.projectId,
                    points: current.points
                }
            });
        }
        return current;
    });
}
