import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { recordActivityEvent } from "./activity-events.js";
import { filterDeletedEntities, filterDeletedIds, isEntityDeleted } from "./deleted-entities.js";
import { assertGoalRelations } from "../services/relations.js";
import { pruneLinkedEntityReferences } from "./psyche.js";
import { goalSchema } from "../types.js";
function readGoalTagIds(goalId) {
    const rows = getDatabase()
        .prepare(`SELECT tag_id FROM goal_tags WHERE goal_id = ? ORDER BY tag_id`)
        .all(goalId);
    return filterDeletedIds("tag", rows.map((row) => row.tag_id));
}
function mapGoal(row) {
    return goalSchema.parse({
        id: row.id,
        title: row.title,
        description: row.description,
        horizon: row.horizon,
        status: row.status,
        targetPoints: row.target_points,
        themeColor: row.theme_color,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        tagIds: readGoalTagIds(row.id)
    });
}
function replaceGoalTags(goalId, tagIds) {
    const database = getDatabase();
    database.prepare(`DELETE FROM goal_tags WHERE goal_id = ?`).run(goalId);
    const insert = database.prepare(`INSERT INTO goal_tags (goal_id, tag_id) VALUES (?, ?)`);
    for (const tagId of tagIds) {
        insert.run(goalId, tagId);
    }
}
export function listGoals() {
    const rows = getDatabase()
        .prepare(`SELECT id, title, description, horizon, status, target_points, theme_color, created_at, updated_at
       FROM goals
       ORDER BY created_at`)
        .all();
    return filterDeletedEntities("goal", rows.map(mapGoal));
}
export function createGoal(input, activity) {
    return runInTransaction(() => {
        assertGoalRelations(input);
        const now = new Date().toISOString();
        const id = `goal_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
        getDatabase()
            .prepare(`INSERT INTO goals (id, title, description, horizon, status, target_points, theme_color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, input.title, input.description, input.horizon, input.status, input.targetPoints, input.themeColor, now, now);
        replaceGoalTags(id, input.tagIds);
        const goal = getGoalById(id);
        if (activity) {
            recordActivityEvent({
                entityType: "goal",
                entityId: goal.id,
                eventType: "goal_created",
                title: `Goal created: ${goal.title}`,
                description: `Target set to ${goal.targetPoints} points.`,
                actor: activity.actor ?? null,
                source: activity.source,
                metadata: {
                    horizon: goal.horizon,
                    status: goal.status,
                    targetPoints: goal.targetPoints
                }
            });
        }
        return goal;
    });
}
export function updateGoal(goalId, input, activity) {
    const current = getGoalById(goalId);
    if (!current) {
        return undefined;
    }
    return runInTransaction(() => {
        const next = {
            ...current,
            ...input,
            updatedAt: new Date().toISOString(),
            tagIds: input.tagIds ?? current.tagIds
        };
        assertGoalRelations(next);
        getDatabase()
            .prepare(`UPDATE goals
         SET title = ?, description = ?, horizon = ?, status = ?, target_points = ?, theme_color = ?, updated_at = ?
         WHERE id = ?`)
            .run(next.title, next.description, next.horizon, next.status, next.targetPoints, next.themeColor, next.updatedAt, goalId);
        replaceGoalTags(goalId, next.tagIds);
        const goal = getGoalById(goalId);
        if (goal && activity) {
            const statusChanged = current.status !== goal.status;
            recordActivityEvent({
                entityType: "goal",
                entityId: goal.id,
                eventType: statusChanged ? "goal_status_changed" : "goal_updated",
                title: statusChanged ? `Goal ${goal.status}: ${goal.title}` : `Goal updated: ${goal.title}`,
                description: statusChanged ? `Goal status moved from ${current.status} to ${goal.status}.` : "Goal details were edited.",
                actor: activity.actor ?? null,
                source: activity.source,
                metadata: {
                    previousStatus: current.status,
                    status: goal.status,
                    targetPoints: goal.targetPoints,
                    previousTargetPoints: current.targetPoints
                }
            });
        }
        return goal;
    });
}
export function getGoalById(goalId) {
    if (isEntityDeleted("goal", goalId)) {
        return undefined;
    }
    const row = getDatabase()
        .prepare(`SELECT id, title, description, horizon, status, target_points, theme_color, created_at, updated_at
       FROM goals
       WHERE id = ?`)
        .get(goalId);
    return row ? mapGoal(row) : undefined;
}
export function deleteGoal(goalId, activity) {
    const current = getGoalById(goalId);
    if (!current) {
        return undefined;
    }
    return runInTransaction(() => {
        pruneLinkedEntityReferences("goal", goalId);
        getDatabase()
            .prepare(`DELETE FROM entity_comments
         WHERE entity_type = 'goal'
           AND entity_id = ?`)
            .run(goalId);
        getDatabase()
            .prepare(`DELETE FROM goals WHERE id = ?`)
            .run(goalId);
        if (activity) {
            recordActivityEvent({
                entityType: "goal",
                entityId: current.id,
                eventType: "goal_deleted",
                title: `Goal deleted: ${current.title}`,
                description: "Goal removed from the system.",
                actor: activity.actor ?? null,
                source: activity.source,
                metadata: {
                    horizon: current.horizon,
                    status: current.status,
                    targetPoints: current.targetPoints
                }
            });
        }
        return current;
    });
}
