import { createHash, randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import { runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { recordActivityEvent } from "./activity-events.js";
import { decorateOwnedEntity, inferFirstOwnedUserId, replaceEntityAssignees, setEntityOwner } from "./entity-ownership.js";
import { filterDeletedEntities, filterDeletedIds, isEntityDeleted } from "./deleted-entities.js";
import { getGoalById } from "./goals.js";
import { createLinkedNotes } from "./notes.js";
import { ensureDefaultProjectForGoal, getProjectById } from "./projects.js";
import { pruneLinkedEntityReferences } from "./psyche.js";
import { awardTaskCompletionReward, reverseLatestTaskCompletionReward } from "./rewards.js";
import { findUserByLabel, getDefaultUser, getUserById, resolveUserForMutation } from "./users.js";
import { assertTaskRelations } from "../services/relations.js";
import { computeWorkTime, emptyTaskTimeSummary } from "../services/work-time.js";
import { buildTaskLifeForceFields, getTaskCompletionRequirement, upsertTaskActionProfile } from "../services/life-force.js";
import { createWorkAdjustment } from "./work-adjustments.js";
import { calendarSchedulingRulesSchema, createTaskSchema, taskSchema } from "../types.js";
function readTaskTagIds(taskId) {
    const rows = getDatabase()
        .prepare(`SELECT tag_id FROM task_tags WHERE task_id = ? ORDER BY tag_id`)
        .all(taskId);
    return filterDeletedIds("tag", rows.map((row) => row.tag_id));
}
function readWorkItemGitRefs(taskId) {
    const rows = getDatabase()
        .prepare(`SELECT id, work_item_id, ref_type, provider, repository, ref_value, url, display_title, created_at, updated_at
       FROM work_item_git_refs
       WHERE work_item_id = ?
       ORDER BY created_at DESC`)
        .all(taskId);
    return rows.map((row) => ({
        id: row.id,
        workItemId: row.work_item_id,
        refType: row.ref_type === "commit" ||
            row.ref_type === "branch" ||
            row.ref_type === "pull_request"
            ? row.ref_type
            : "commit",
        provider: row.provider,
        repository: row.repository,
        refValue: row.ref_value,
        url: row.url,
        displayTitle: row.display_title,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }));
}
function replaceWorkItemGitRefs(taskId, refs) {
    if (refs === undefined) {
        return readWorkItemGitRefs(taskId);
    }
    const database = getDatabase();
    database
        .prepare(`DELETE FROM work_item_git_refs WHERE work_item_id = ?`)
        .run(taskId);
    const insert = database.prepare(`INSERT INTO work_item_git_refs (
      id, work_item_id, ref_type, provider, repository, ref_value, url, display_title, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const now = new Date().toISOString();
    for (const ref of refs) {
        const id = "id" in ref && typeof ref.id === "string" && ref.id.trim().length > 0
            ? ref.id
            : `gitref_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
        insert.run(id, taskId, ref.refType, ref.provider ?? "git", ref.repository ?? "", ref.refValue, ref.url ?? null, ref.displayTitle ?? "", now, now);
    }
    return readWorkItemGitRefs(taskId);
}
function assertWorkItemHierarchy(options) {
    if (options.parentWorkItemId === options.taskId) {
        throw new HttpError(409, "work_item_parent_cycle", "A work item cannot be its own parent");
    }
    if (options.level === "issue") {
        if (options.parentWorkItemId) {
            throw new HttpError(409, "issue_parent_not_allowed", "Issues must live directly under a project");
        }
        if (!options.projectId) {
            throw new HttpError(400, "issue_project_required", "Issues must belong to a project");
        }
        return;
    }
    if (!options.parentWorkItemId) {
        return;
    }
    const parent = getTaskById(options.parentWorkItemId);
    if (!parent) {
        throw new HttpError(404, "parent_work_item_not_found", `Parent work item ${options.parentWorkItemId} does not exist`);
    }
    if (options.projectId &&
        parent.projectId &&
        parent.projectId !== options.projectId) {
        throw new HttpError(409, "work_item_project_mismatch", "Parent and child work items must belong to the same project");
    }
    if (options.level === "task" && parent.level !== "issue") {
        throw new HttpError(409, "task_parent_invalid", "Tasks can only live under issues");
    }
    if (options.level === "subtask" && parent.level !== "task") {
        throw new HttpError(409, "subtask_parent_invalid", "Subtasks can only live under tasks");
    }
}
function mapTask(row, time = emptyTaskTimeSummary()) {
    const task = taskSchema.parse(decorateOwnedEntity("task", {
        id: row.id,
        title: row.title,
        description: row.description,
        level: row.level === "issue" || row.level === "task" || row.level === "subtask"
            ? row.level
            : "task",
        status: row.status,
        priority: row.priority,
        owner: row.owner,
        goalId: row.goal_id,
        projectId: row.project_id,
        parentWorkItemId: row.parent_task_id,
        dueDate: row.due_date,
        effort: row.effort,
        energy: row.energy,
        points: row.points,
        plannedDurationSeconds: row.planned_duration_seconds,
        schedulingRules: row.scheduling_rules_json === null
            ? null
            : calendarSchedulingRulesSchema.parse(JSON.parse(row.scheduling_rules_json)),
        sortOrder: row.sort_order,
        resolutionKind: row.resolution_kind === "completed" || row.resolution_kind === "split"
            ? row.resolution_kind
            : null,
        splitParentTaskId: row.split_parent_task_id,
        aiInstructions: row.ai_instructions,
        executionMode: row.execution_mode === "afk" || row.execution_mode === "hitl"
            ? row.execution_mode
            : null,
        acceptanceCriteria: JSON.parse(row.acceptance_criteria_json || "[]"),
        blockerLinks: JSON.parse(row.blocker_links_json || "[]"),
        completionReport: row.completion_report_json === null
            ? null
            : JSON.parse(row.completion_report_json),
        gitRefs: readWorkItemGitRefs(row.id),
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        tagIds: readTaskTagIds(row.id),
        time
    }));
    return {
        ...task,
        ...buildTaskLifeForceFields(task, task.userId ?? undefined)
    };
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
function normalizeCompletedAt(status, existingCompletedAt, overrideCompletedAt) {
    if (status === "done") {
        return overrideCompletedAt ?? existingCompletedAt ?? new Date().toISOString();
    }
    return null;
}
function resolveTaskAssignment(input) {
    if (input.userId !== undefined) {
        const user = resolveUserForMutation(input.userId, input.owner ?? undefined);
        return {
            userId: user.id,
            ownerLabel: input.owner?.trim() || user.displayName
        };
    }
    if (input.owner && input.owner.trim().length > 0) {
        const matchedUser = findUserByLabel(input.owner);
        return {
            userId: matchedUser?.id ??
                input.currentUserId ??
                input.inheritedUserId ??
                getDefaultUser().id,
            ownerLabel: matchedUser?.displayName ?? input.owner.trim()
        };
    }
    if (input.currentUserId) {
        const currentUser = getUserById(input.currentUserId);
        if (currentUser) {
            return {
                userId: currentUser.id,
                ownerLabel: currentUser.displayName
            };
        }
    }
    if (input.inheritedUserId) {
        const inheritedUser = getUserById(input.inheritedUserId);
        if (inheritedUser) {
            return {
                userId: inheritedUser.id,
                ownerLabel: inheritedUser.displayName
            };
        }
    }
    const fallbackUser = getDefaultUser();
    return {
        userId: fallbackUser.id,
        ownerLabel: fallbackUser.displayName
    };
}
function resolveProjectAndGoalIds(input, current) {
    const currentGoalId = current?.goalId && getGoalById(current.goalId) ? current.goalId : null;
    const currentProject = current?.projectId
        ? (getProjectById(current.projectId) ?? null)
        : null;
    const currentProjectGoalId = currentProject?.goalId && getGoalById(currentProject.goalId)
        ? currentProject.goalId
        : null;
    const currentProjectId = currentProject?.id ?? null;
    const requestedGoalId = input.goalId === undefined ? currentGoalId : input.goalId;
    const goalChangedWithoutProjectOverride = current !== undefined &&
        input.goalId !== undefined &&
        input.goalId !== current.goalId &&
        input.projectId === undefined;
    const requestedProjectId = input.projectId === undefined
        ? goalChangedWithoutProjectOverride
            ? null
            : currentProjectId
        : input.projectId;
    if (requestedProjectId) {
        const project = getProjectById(requestedProjectId);
        if (!project) {
            throw new HttpError(404, "project_not_found", `Project ${requestedProjectId} does not exist`);
        }
        const projectGoalId = getGoalById(project.goalId) ? project.goalId : null;
        if (requestedGoalId &&
            projectGoalId &&
            project.goalId !== requestedGoalId) {
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
    return metadata.previousStatus && metadata.previousStatus !== "done"
        ? metadata.previousStatus
        : "focus";
}
function updateTaskRecord(current, input, activity) {
    const relationState = resolveProjectAndGoalIds(input, current);
    const nextGoalId = relationState.goalId;
    const nextProjectId = relationState.projectId;
    const nextLevel = input.level ?? current.level;
    const nextParentWorkItemId = input.parentWorkItemId === undefined
        ? current.parentWorkItemId
        : input.parentWorkItemId;
    const nextTagIds = input.tagIds ?? current.tagIds;
    const assignment = resolveTaskAssignment({
        userId: input.userId,
        owner: input.owner,
        currentUserId: current.userId
    });
    assertTaskRelations({ goalId: nextGoalId, tagIds: nextTagIds });
    assertWorkItemHierarchy({
        taskId: current.id,
        level: nextLevel,
        parentWorkItemId: nextParentWorkItemId,
        projectId: nextProjectId
    });
    const nextStatus = input.status ?? current.status;
    const movedColumns = nextStatus !== current.status;
    const nextSort = input.sortOrder ??
        (movedColumns ? nextSortOrder(nextStatus) : current.sortOrder);
    const completionRequirement = nextStatus === "done"
        ? getTaskCompletionRequirement(current, current.userId ?? undefined)
        : null;
    const applyCompletionWorkLogAdjustment = (desiredTodaySeconds, currentTodayCreditedSeconds) => {
        const deltaMinutes = Math.round((desiredTodaySeconds - currentTodayCreditedSeconds) / 60);
        if (deltaMinutes === 0) {
            return;
        }
        const appliedDeltaMinutes = deltaMinutes;
        createWorkAdjustment({
            entityType: "task",
            entityId: current.id,
            deltaMinutes: appliedDeltaMinutes,
            appliedDeltaMinutes,
            note: desiredTodaySeconds <= 0
                ? "Completion log cleared for today"
                : "Completion log adjusted for today"
        }, {
            actor: activity?.actor ?? null,
            source: activity?.source ?? "ui"
        });
    };
    if (current.status !== "done" &&
        nextStatus === "done" &&
        input.resolutionKind !== "split" &&
        completionRequirement) {
        if (input.enforceTodayWorkLog === true &&
            completionRequirement.requiresWorkLog &&
            input.completedTodayWorkSeconds === undefined) {
            throw new HttpError(409, "task_completion_work_log_required", "Log how long you worked on this task today before closing it.", {
                taskId: current.id,
                todayCreditedSeconds: completionRequirement.todayCreditedSeconds
            });
        }
        if (input.completedTodayWorkSeconds !== undefined) {
            const desiredTodaySeconds = Math.max(0, input.completedTodayWorkSeconds);
            applyCompletionWorkLogAdjustment(desiredTodaySeconds, completionRequirement.todayCreditedSeconds);
        }
    }
    else if (nextStatus === "done" &&
        input.completedTodayWorkSeconds !== undefined &&
        completionRequirement) {
        const desiredTodaySeconds = Math.max(0, input.completedTodayWorkSeconds);
        applyCompletionWorkLogAdjustment(desiredTodaySeconds, completionRequirement.todayCreditedSeconds);
    }
    const completedAt = normalizeCompletedAt(nextStatus, current.completedAt, input.completedAt);
    const updatedAt = new Date().toISOString();
    getDatabase()
        .prepare(`UPDATE tasks
       SET title = ?, description = ?, status = ?, priority = ?, owner = ?, goal_id = ?, due_date = ?, effort = ?,
           energy = ?, points = ?, planned_duration_seconds = ?, scheduling_rules_json = ?, sort_order = ?, resolution_kind = ?, split_parent_task_id = ?,
           level = ?, parent_task_id = ?, ai_instructions = ?, execution_mode = ?, acceptance_criteria_json = ?, blocker_links_json = ?, completion_report_json = ?,
           completed_at = ?, updated_at = ?, project_id = ?
       WHERE id = ?`)
        .run(input.title ?? current.title, input.description ?? current.description, nextStatus, input.priority ?? current.priority, assignment.ownerLabel, nextGoalId, input.dueDate === undefined ? current.dueDate : input.dueDate, input.effort ?? current.effort, input.energy ?? current.energy, input.points ?? current.points, input.plannedDurationSeconds === undefined
        ? current.plannedDurationSeconds
        : input.plannedDurationSeconds, input.schedulingRules === undefined
        ? current.schedulingRules === null
            ? null
            : JSON.stringify(current.schedulingRules)
        : input.schedulingRules === null
            ? null
            : JSON.stringify(input.schedulingRules), nextSort, input.resolutionKind === undefined ? current.resolutionKind : input.resolutionKind, input.splitParentTaskId === undefined
        ? current.splitParentTaskId
        : input.splitParentTaskId, nextLevel, nextParentWorkItemId, input.aiInstructions ?? current.aiInstructions, input.executionMode === undefined
        ? current.executionMode
        : input.executionMode, input.acceptanceCriteria === undefined
        ? JSON.stringify(current.acceptanceCriteria)
        : JSON.stringify(input.acceptanceCriteria), input.blockerLinks === undefined
        ? JSON.stringify(current.blockerLinks)
        : JSON.stringify(input.blockerLinks), input.completionReport === undefined
        ? current.completionReport === null
            ? null
            : JSON.stringify(current.completionReport)
        : input.completionReport === null
            ? null
            : JSON.stringify(input.completionReport), completedAt, updatedAt, nextProjectId, current.id);
    replaceTaskTags(current.id, nextTagIds);
    setEntityOwner("task", current.id, assignment.userId);
    if (input.assigneeUserIds !== undefined) {
        replaceEntityAssignees("task", current.id, input.assigneeUserIds);
    }
    replaceWorkItemGitRefs(current.id, input.gitRefs);
    const updated = getTaskById(current.id);
    if (updated &&
        (input.actionCostBand !== undefined ||
            input.plannedDurationSeconds !== undefined ||
            input.title !== undefined)) {
        upsertTaskActionProfile({
            taskId: updated.id,
            title: updated.title,
            plannedDurationSeconds: updated.plannedDurationSeconds,
            actionCostBand: input.actionCostBand ?? updated.actionPointSummary?.costBand ?? "standard"
        });
    }
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
        if (current.status !== "done" &&
            updated.status === "done" &&
            updated.resolutionKind !== "split") {
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
    const parsed = createTaskSchema.parse(input);
    return createHash("sha256")
        .update(JSON.stringify({
        title: parsed.title,
        description: parsed.description,
        level: parsed.level,
        status: parsed.status,
        priority: parsed.priority,
        owner: parsed.owner,
        goalId: parsed.goalId,
        projectId: parsed.projectId,
        parentWorkItemId: parsed.parentWorkItemId,
        dueDate: parsed.dueDate,
        effort: parsed.effort,
        energy: parsed.energy,
        points: parsed.points,
        plannedDurationSeconds: parsed.plannedDurationSeconds,
        schedulingRules: parsed.schedulingRules,
        aiInstructions: parsed.aiInstructions,
        executionMode: parsed.executionMode,
        acceptanceCriteria: parsed.acceptanceCriteria,
        blockerLinks: parsed.blockerLinks,
        completionReport: parsed.completionReport,
        gitRefs: parsed.gitRefs,
        assigneeUserIds: parsed.assigneeUserIds,
        sortOrder: parsed.sortOrder ?? null,
        tagIds: parsed.tagIds,
        notes: parsed.notes.map((note) => ({
            contentMarkdown: note.contentMarkdown,
            author: note.author,
            links: note.links
        }))
    }))
        .digest("hex");
}
function insertTaskRecord(input, activity) {
    const parsed = createTaskSchema.parse(input);
    const relationState = resolveProjectAndGoalIds(parsed);
    const inheritedUserId = inferFirstOwnedUserId([
        { entityType: "project", entityId: relationState.projectId },
        { entityType: "goal", entityId: relationState.goalId }
    ]);
    const assignment = resolveTaskAssignment({
        userId: parsed.userId,
        owner: parsed.owner,
        inheritedUserId
    });
    assertTaskRelations({ goalId: relationState.goalId, tagIds: parsed.tagIds });
    if (!relationState.projectId) {
        throw new HttpError(400, "project_required", "Tasks must belong to a project");
    }
    assertWorkItemHierarchy({
        level: parsed.level,
        parentWorkItemId: parsed.parentWorkItemId,
        projectId: relationState.projectId
    });
    const now = new Date().toISOString();
    const id = `task_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const sortOrder = parsed.sortOrder ?? nextSortOrder(parsed.status);
    const completedAt = normalizeCompletedAt(parsed.status, null);
    getDatabase()
        .prepare(`INSERT INTO tasks (
        id, title, description, status, priority, owner, goal_id, project_id, due_date, effort, energy, points,
        planned_duration_seconds, scheduling_rules_json, sort_order, resolution_kind, split_parent_task_id,
        level, parent_task_id, ai_instructions, execution_mode, acceptance_criteria_json, blocker_links_json, completion_report_json,
        completed_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, parsed.title, parsed.description, parsed.status, parsed.priority, assignment.ownerLabel, relationState.goalId, relationState.projectId, parsed.dueDate, parsed.effort, parsed.energy, parsed.points, parsed.plannedDurationSeconds, parsed.schedulingRules === null
        ? null
        : JSON.stringify(parsed.schedulingRules), sortOrder, parsed.status === "done" ? "completed" : null, null, parsed.level, parsed.parentWorkItemId, parsed.aiInstructions, parsed.executionMode, JSON.stringify(parsed.acceptanceCriteria), JSON.stringify(parsed.blockerLinks), parsed.completionReport === null
        ? null
        : JSON.stringify(parsed.completionReport), completedAt, now, now);
    setEntityOwner("task", id, assignment.userId);
    replaceEntityAssignees("task", id, parsed.assigneeUserIds);
    replaceTaskTags(id, parsed.tagIds);
    replaceWorkItemGitRefs(id, parsed.gitRefs);
    const task = getTaskById(id);
    upsertTaskActionProfile({
        taskId: task.id,
        title: task.title,
        plannedDurationSeconds: task.plannedDurationSeconds,
        actionCostBand: parsed.actionCostBand
    });
    if (activity) {
        recordActivityEvent({
            entityType: "task",
            entityId: task.id,
            eventType: "task_created",
            title: `Task created: ${task.title}`,
            description: task.goalId
                ? `Linked to ${task.goalId} and assigned to ${task.owner}.`
                : `Assigned to ${task.owner}.`,
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
        if (task.status === "done" && task.resolutionKind !== "split") {
            awardTaskCompletionReward(task, activity);
        }
    }
    createLinkedNotes(parsed.notes, { entityType: "task", entityId: task.id, anchorKey: null }, activity ?? { source: "ui", actor: null });
    return task;
}
export function listTasks(filters = {}) {
    const whereClauses = [];
    const params = [];
    const todayIso = new Date().toISOString().slice(0, 10);
    const weekIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    if (filters.status) {
        whereClauses.push("status = ?");
        params.push(filters.status);
    }
    if (filters.levels && filters.levels.length > 0) {
        whereClauses.push(`level IN (${filters.levels.map(() => "?").join(", ")})`);
        params.push(...filters.levels);
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
    if (filters.parentWorkItemId) {
        whereClauses.push("parent_task_id = ?");
        params.push(filters.parentWorkItemId);
    }
    if (filters.tagId) {
        whereClauses.push("EXISTS (SELECT 1 FROM task_tags WHERE task_tags.task_id = tasks.id AND task_tags.tag_id = ?)");
        params.push(filters.tagId);
    }
    if (filters.assigneeIds && filters.assigneeIds.length > 0) {
        whereClauses.push(`EXISTS (
        SELECT 1
        FROM entity_assignments
        WHERE entity_assignments.entity_type = 'task'
          AND entity_assignments.entity_id = tasks.id
          AND entity_assignments.role = 'assignee'
          AND entity_assignments.user_id IN (${filters.assigneeIds
            .map(() => "?")
            .join(", ")})
      )`);
        params.push(...filters.assigneeIds);
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
              planned_duration_seconds, scheduling_rules_json, sort_order, resolution_kind, split_parent_task_id,
              level, parent_task_id, ai_instructions, execution_mode, acceptance_criteria_json, blocker_links_json, completion_report_json,
              completed_at, created_at, updated_at
       FROM tasks
       ${whereSql}
       ORDER BY
         CASE level
           WHEN 'issue' THEN 0
           WHEN 'task' THEN 1
           ELSE 2
         END,
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
              planned_duration_seconds, scheduling_rules_json, sort_order, resolution_kind, split_parent_task_id,
              level, parent_task_id, ai_instructions, execution_mode, acceptance_criteria_json, blocker_links_json, completion_report_json,
              completed_at, created_at, updated_at
       FROM tasks
       WHERE id = ?`)
        .get(taskId);
    const workTime = computeWorkTime();
    return row
        ? mapTask(row, workTime.taskSummaries.get(row.id) ?? emptyTaskTimeSummary())
        : undefined;
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
        getDatabase().prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
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
export function splitTask(taskId, input, activity) {
    const current = getTaskById(taskId);
    if (!current) {
        return undefined;
    }
    return runInTransaction(() => {
        const remainingRatio = clampRatio(input.remainingRatio);
        const remainingExpectedDurationSeconds = Math.max(60, current.actionPointSummary.expectedDurationSeconds -
            current.time.totalCreditedSeconds);
        const remainingAp = Math.max(1, current.actionPointSummary.remainingAp);
        const firstChildDurationSeconds = Math.max(60, Math.round(remainingExpectedDurationSeconds * remainingRatio));
        const secondChildDurationSeconds = Math.max(60, remainingExpectedDurationSeconds - firstChildDurationSeconds);
        const firstChildTotalAp = Math.max(1, Math.round(remainingAp * remainingRatio));
        const secondChildTotalAp = Math.max(1, remainingAp - firstChildTotalAp);
        const parent = updateTaskRecord(current, {
            status: "done",
            resolutionKind: "split"
        }, activity);
        if (!parent) {
            throw new HttpError(500, "task_split_failed", "Could not mark the original task as split.");
        }
        const totalCostPoints = current.points;
        const firstChild = insertTaskRecord({
            title: input.firstTitle,
            description: current.description,
            status: "focus",
            priority: current.priority,
            owner: current.owner,
            userId: current.userId ?? null,
            goalId: current.goalId,
            projectId: current.projectId,
            dueDate: current.dueDate,
            effort: current.effort,
            energy: current.energy,
            points: Math.max(5, Math.round(totalCostPoints * remainingRatio)),
            plannedDurationSeconds: firstChildDurationSeconds,
            schedulingRules: current.schedulingRules,
            actionCostBand: current.actionPointSummary.costBand,
            tagIds: current.tagIds,
            notes: []
        }, activity);
        const secondChild = insertTaskRecord({
            title: input.secondTitle,
            description: current.description,
            status: "focus",
            priority: current.priority,
            owner: current.owner,
            userId: current.userId ?? null,
            goalId: current.goalId,
            projectId: current.projectId,
            dueDate: current.dueDate,
            effort: current.effort,
            energy: current.energy,
            points: Math.max(5, totalCostPoints - firstChild.points),
            plannedDurationSeconds: secondChildDurationSeconds,
            schedulingRules: current.schedulingRules,
            actionCostBand: current.actionPointSummary.costBand,
            tagIds: current.tagIds,
            notes: []
        }, activity);
        upsertTaskActionProfile({
            taskId: firstChild.id,
            title: firstChild.title,
            plannedDurationSeconds: firstChildDurationSeconds,
            actionCostBand: current.actionPointSummary.costBand,
            totalCostAp: firstChildTotalAp
        });
        upsertTaskActionProfile({
            taskId: secondChild.id,
            title: secondChild.title,
            plannedDurationSeconds: secondChildDurationSeconds,
            actionCostBand: current.actionPointSummary.costBand,
            totalCostAp: secondChildTotalAp
        });
        updateTaskRecord(firstChild, { splitParentTaskId: current.id }, activity);
        updateTaskRecord(secondChild, { splitParentTaskId: current.id }, activity);
        if (activity) {
            recordActivityEvent({
                entityType: "task",
                entityId: current.id,
                eventType: "task_split",
                title: `Task split: ${current.title}`,
                description: `Remaining work was split into ${input.firstTitle} and ${input.secondTitle}.`,
                actor: activity.actor ?? null,
                source: activity.source,
                metadata: {
                    firstChildTaskId: firstChild.id,
                    secondChildTaskId: secondChild.id
                }
            });
        }
        return {
            parent: getTaskById(current.id),
            children: [getTaskById(firstChild.id), getTaskById(secondChild.id)]
        };
    });
}
function clampRatio(value) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return 0.5;
    }
    return Math.min(0.9, Math.max(0.1, value));
}
