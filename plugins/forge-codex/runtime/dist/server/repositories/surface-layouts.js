import { getDatabase } from "../db.js";
import { surfaceLayoutPayloadSchema } from "../types.js";
function parseLayout(row) {
    const parsed = JSON.parse(row.payload_json);
    return surfaceLayoutPayloadSchema.parse({
        ...parsed,
        surfaceId: row.surface_id,
        updatedAt: row.updated_at
    });
}
export function getSurfaceLayout(surfaceId) {
    const row = getDatabase()
        .prepare(`SELECT surface_id, payload_json, updated_at
       FROM surface_layouts
       WHERE surface_id = ?`)
        .get(surfaceId);
    return row ? parseLayout(row) : null;
}
export function saveSurfaceLayout(surfaceId, payload) {
    const now = new Date().toISOString();
    const next = surfaceLayoutPayloadSchema.parse({
        surfaceId,
        updatedAt: now,
        ...payload
    });
    getDatabase()
        .prepare(`INSERT INTO surface_layouts (surface_id, payload_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(surface_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`)
        .run(surfaceId, JSON.stringify(next), now);
    return getSurfaceLayout(surfaceId);
}
export function resetSurfaceLayout(surfaceId) {
    getDatabase()
        .prepare(`DELETE FROM surface_layouts WHERE surface_id = ?`)
        .run(surfaceId);
    return null;
}
