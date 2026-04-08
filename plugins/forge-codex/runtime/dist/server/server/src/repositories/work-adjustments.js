import { randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import { createWorkAdjustmentSchema, workAdjustmentSchema } from "../types.js";
function mapWorkAdjustment(row) {
    return workAdjustmentSchema.parse({
        id: row.id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        requestedDeltaMinutes: row.requested_delta_minutes,
        appliedDeltaMinutes: row.applied_delta_minutes,
        note: row.note,
        actor: row.actor,
        source: row.source,
        createdAt: row.created_at
    });
}
export function createWorkAdjustment(input, activity, now = new Date()) {
    const parsed = createWorkAdjustmentSchema.parse(input);
    const adjustment = workAdjustmentSchema.parse({
        id: `wadj_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        requestedDeltaMinutes: parsed.deltaMinutes,
        appliedDeltaMinutes: input.appliedDeltaMinutes,
        note: parsed.note,
        actor: activity.actor ?? null,
        source: activity.source,
        createdAt: now.toISOString()
    });
    getDatabase()
        .prepare(`INSERT INTO work_adjustments (
         id,
         entity_type,
         entity_id,
         requested_delta_minutes,
         applied_delta_minutes,
         note,
         actor,
         source,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(adjustment.id, adjustment.entityType, adjustment.entityId, adjustment.requestedDeltaMinutes, adjustment.appliedDeltaMinutes, adjustment.note, adjustment.actor, adjustment.source, adjustment.createdAt);
    return adjustment;
}
export function listWorkAdjustmentsForEntity(entityType, entityId, limit = 50) {
    const rows = getDatabase()
        .prepare(`SELECT
         id,
         entity_type,
         entity_id,
         requested_delta_minutes,
         applied_delta_minutes,
         note,
         actor,
         source,
         created_at
       FROM work_adjustments
       WHERE entity_type = ? AND entity_id = ?
       ORDER BY created_at DESC
       LIMIT ?`)
        .all(entityType, entityId, limit);
    return rows.map(mapWorkAdjustment);
}
export function getWorkAdjustmentSecondsByEntity(entityType, entityId) {
    const row = getDatabase()
        .prepare(`SELECT COALESCE(SUM(applied_delta_minutes), 0) AS total_minutes
       FROM work_adjustments
       WHERE entity_type = ? AND entity_id = ?`)
        .get(entityType, entityId);
    return Math.trunc((row?.total_minutes ?? 0) * 60);
}
function getWorkAdjustmentSecondsMap(entityType, entityIds) {
    if (entityIds.length === 0) {
        return new Map();
    }
    const placeholders = entityIds.map(() => "?").join(", ");
    const rows = getDatabase()
        .prepare(`SELECT entity_id, COALESCE(SUM(applied_delta_minutes), 0) AS total_minutes
       FROM work_adjustments
       WHERE entity_type = ? AND entity_id IN (${placeholders})
       GROUP BY entity_id`)
        .all(entityType, ...entityIds);
    return new Map(rows.map((row) => [row.entity_id, Math.trunc(row.total_minutes * 60)]));
}
function listWorkAdjustmentSecondsMap(entityType) {
    const rows = getDatabase()
        .prepare(`SELECT entity_id, COALESCE(SUM(applied_delta_minutes), 0) AS total_minutes
       FROM work_adjustments
       WHERE entity_type = ?
       GROUP BY entity_id`)
        .all(entityType);
    return new Map(rows.map((row) => [row.entity_id, Math.trunc(row.total_minutes * 60)]));
}
export function getTaskWorkAdjustmentSecondsMap(taskIds) {
    return getWorkAdjustmentSecondsMap("task", taskIds);
}
export function getProjectWorkAdjustmentSecondsMap(projectIds) {
    return getWorkAdjustmentSecondsMap("project", projectIds);
}
export function listTaskWorkAdjustmentSecondsMap() {
    return listWorkAdjustmentSecondsMap("task");
}
export function listProjectWorkAdjustmentSecondsMap() {
    return listWorkAdjustmentSecondsMap("project");
}
