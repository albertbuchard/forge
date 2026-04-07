import { getDatabase } from "../db.js";
import {
  surfaceLayoutPayloadSchema,
  type SurfaceLayoutPayload,
  type WriteSurfaceLayoutInput
} from "../types.js";

type SurfaceLayoutRow = {
  surface_id: string;
  payload_json: string;
  updated_at: string;
};

function parseLayout(row: SurfaceLayoutRow): SurfaceLayoutPayload {
  const parsed = JSON.parse(row.payload_json) as SurfaceLayoutPayload;
  return surfaceLayoutPayloadSchema.parse({
    ...parsed,
    surfaceId: row.surface_id,
    updatedAt: row.updated_at
  });
}

export function getSurfaceLayout(surfaceId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT surface_id, payload_json, updated_at
       FROM surface_layouts
       WHERE surface_id = ?`
    )
    .get(surfaceId) as SurfaceLayoutRow | undefined;
  return row ? parseLayout(row) : null;
}

export function saveSurfaceLayout(
  surfaceId: string,
  payload: WriteSurfaceLayoutInput
) {
  const now = new Date().toISOString();
  const next = surfaceLayoutPayloadSchema.parse({
    surfaceId,
    updatedAt: now,
    ...payload
  });
  getDatabase()
    .prepare(
      `INSERT INTO surface_layouts (surface_id, payload_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(surface_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`
    )
    .run(surfaceId, JSON.stringify(next), now);
  return getSurfaceLayout(surfaceId)!;
}

export function resetSurfaceLayout(surfaceId: string) {
  getDatabase()
    .prepare(`DELETE FROM surface_layouts WHERE surface_id = ?`)
    .run(surfaceId);
  return null;
}
