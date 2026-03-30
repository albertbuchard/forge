import { randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import {
  createWorkAdjustmentSchema,
  workAdjustmentSchema,
  type ActivitySource,
  type CreateWorkAdjustmentInput,
  type WorkAdjustment,
  type WorkAdjustmentEntityType
} from "../types.js";

type WorkAdjustmentRow = {
  id: string;
  entity_type: WorkAdjustmentEntityType;
  entity_id: string;
  requested_delta_minutes: number;
  applied_delta_minutes: number;
  note: string;
  actor: string | null;
  source: ActivitySource;
  created_at: string;
};

function mapWorkAdjustment(row: WorkAdjustmentRow): WorkAdjustment {
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

export function createWorkAdjustment(
  input: CreateWorkAdjustmentInput & { appliedDeltaMinutes: number },
  activity: { actor?: string | null; source: ActivitySource },
  now = new Date()
): WorkAdjustment {
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
    .prepare(
      `INSERT INTO work_adjustments (
         id,
         entity_type,
         entity_id,
         requested_delta_minutes,
         applied_delta_minutes,
         note,
         actor,
         source,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      adjustment.id,
      adjustment.entityType,
      adjustment.entityId,
      adjustment.requestedDeltaMinutes,
      adjustment.appliedDeltaMinutes,
      adjustment.note,
      adjustment.actor,
      adjustment.source,
      adjustment.createdAt
    );

  return adjustment;
}

export function listWorkAdjustmentsForEntity(
  entityType: WorkAdjustmentEntityType,
  entityId: string,
  limit = 50
): WorkAdjustment[] {
  const rows = getDatabase()
    .prepare(
      `SELECT
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
       LIMIT ?`
    )
    .all(entityType, entityId, limit) as WorkAdjustmentRow[];

  return rows.map(mapWorkAdjustment);
}

export function getWorkAdjustmentSecondsByEntity(entityType: WorkAdjustmentEntityType, entityId: string): number {
  const row = getDatabase()
    .prepare(
      `SELECT COALESCE(SUM(applied_delta_minutes), 0) AS total_minutes
       FROM work_adjustments
       WHERE entity_type = ? AND entity_id = ?`
    )
    .get(entityType, entityId) as { total_minutes: number } | undefined;

  return Math.trunc((row?.total_minutes ?? 0) * 60);
}

function getWorkAdjustmentSecondsMap(entityType: WorkAdjustmentEntityType, entityIds: string[]): Map<string, number> {
  if (entityIds.length === 0) {
    return new Map();
  }

  const placeholders = entityIds.map(() => "?").join(", ");
  const rows = getDatabase()
    .prepare(
      `SELECT entity_id, COALESCE(SUM(applied_delta_minutes), 0) AS total_minutes
       FROM work_adjustments
       WHERE entity_type = ? AND entity_id IN (${placeholders})
       GROUP BY entity_id`
    )
    .all(entityType, ...entityIds) as Array<{ entity_id: string; total_minutes: number }>;

  return new Map(rows.map((row) => [row.entity_id, Math.trunc(row.total_minutes * 60)]));
}

function listWorkAdjustmentSecondsMap(entityType: WorkAdjustmentEntityType): Map<string, number> {
  const rows = getDatabase()
    .prepare(
      `SELECT entity_id, COALESCE(SUM(applied_delta_minutes), 0) AS total_minutes
       FROM work_adjustments
       WHERE entity_type = ?
       GROUP BY entity_id`
    )
    .all(entityType) as Array<{ entity_id: string; total_minutes: number }>;

  return new Map(rows.map((row) => [row.entity_id, Math.trunc(row.total_minutes * 60)]));
}

export function getTaskWorkAdjustmentSecondsMap(taskIds: string[]): Map<string, number> {
  return getWorkAdjustmentSecondsMap("task", taskIds);
}

export function getProjectWorkAdjustmentSecondsMap(projectIds: string[]): Map<string, number> {
  return getWorkAdjustmentSecondsMap("project", projectIds);
}

export function listTaskWorkAdjustmentSecondsMap(): Map<string, number> {
  return listWorkAdjustmentSecondsMap("task");
}

export function listProjectWorkAdjustmentSecondsMap(): Map<string, number> {
  return listWorkAdjustmentSecondsMap("project");
}
