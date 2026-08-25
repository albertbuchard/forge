import { getDatabase } from "../db.js";
import { HttpError } from "../errors.js";
import type { WorkAccess } from "./access.js";
import { nowIso } from "./repository-helpers.js";

export function json(value: unknown) {
  return JSON.stringify(value ?? null);
}

export function hasMaterialValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "" || value === false)
    return false;
  if (typeof value === "string" && value.trim().toLowerCase() === "unknown")
    return false;
  if (Array.isArray(value)) return value.some(hasMaterialValue);
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "unknown")
      .some(([, entry]) => hasMaterialValue(entry));
  }
  return true;
}

export function assertCompensationWrite(
  access: WorkAccess,
  values: unknown[],
  message = "Writing Work compensation or benefits requires Work compensation authority."
) {
  if (!access.canCompensation && values.some(hasMaterialValue)) {
    throw new HttpError(403, "work_compensation_scope_required", message);
  }
}

export function criteriaContainCompensation(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const criteria = (value as { criteria?: unknown }).criteria;
  return (
    Array.isArray(criteria) &&
    criteria.some(
      (criterion) =>
        criterion &&
        typeof criterion === "object" &&
        (criterion as { section?: unknown }).section === "compensation"
    )
  );
}

export function insertRow(table: string, data: Record<string, unknown>) {
  const columns = Object.keys(data);
  getDatabase()
    .prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    )
    .run(...columns.map((column) => data[column] as never));
}

export function updateRevisionedRow(input: {
  table: string;
  id: string;
  expectedRevision: number;
  data: Record<string, unknown>;
}) {
  const entries = Object.entries(input.data);
  if (entries.length === 0) {
    throw new HttpError(
      400,
      "work_update_empty",
      "A Work update must change at least one field."
    );
  }
  const result = getDatabase()
    .prepare(
      `UPDATE ${input.table}
       SET ${entries.map(([column]) => `${column} = ?`).join(", ")},
           revision = revision + 1,
           updated_at = ?
       WHERE id = ? AND revision = ?`
    )
    .run(
      ...entries.map(([, value]) => value as never),
      nowIso(),
      input.id,
      input.expectedRevision
    );
  if (Number(result.changes) !== 1) {
    throw new HttpError(
      409,
      "work_revision_conflict",
      "This Work record changed after it was opened. Reload it before saving."
    );
  }
}

export function scopeColumns(scope: {
  projectIds: string[];
  tagIds: string[];
}) {
  return {
    scope_project_ids_json: json(scope.projectIds),
    scope_tag_ids_json: json(scope.tagIds)
  };
}
