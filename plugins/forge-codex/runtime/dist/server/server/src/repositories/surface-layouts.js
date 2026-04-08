import { getDatabase } from "../db.js";
import { surfaceLayoutPayloadSchema } from "../types.js";
function parseLayout(row) {
    const parsed = JSON.parse(row.payload_json);
    const legacy = "layouts" in parsed ? parsed : null;
    const legacyOrder = Array.isArray(legacy?.layouts?.lg)
        ? [...legacy.layouts.lg]
            .sort((left, right) => {
            const leftY = typeof left.y === "number" ? left.y : 0;
            const rightY = typeof right.y === "number" ? right.y : 0;
            if (leftY !== rightY) {
                return leftY - rightY;
            }
            const leftX = typeof left.x === "number" ? left.x : 0;
            const rightX = typeof right.x === "number" ? right.x : 0;
            return leftX - rightX;
        })
            .map((item) => item.i)
            .filter((item) => typeof item === "string" && item.trim().length > 0)
        : [];
    const widgets = Object.fromEntries(Object.entries(parsed.widgets ?? {}).map(([widgetId, rawValue]) => {
        const value = rawValue && typeof rawValue === "object"
            ? rawValue
            : {};
        const legacyLg = legacy?.layouts?.lg?.find((entry) => entry.i === widgetId);
        return [
            widgetId,
            {
                hidden: value.hidden === true,
                fullWidth: value.fullWidth === true ||
                    (typeof legacyLg?.w === "number" && legacyLg.w >= 10),
                titleVisible: value.titleVisible !== false,
                descriptionVisible: value.descriptionVisible !== false
            }
        ];
    }));
    return surfaceLayoutPayloadSchema.parse({
        ...parsed,
        surfaceId: row.surface_id,
        order: Array.isArray(parsed.order) && parsed.order.length > 0
            ? parsed.order
            : legacyOrder,
        widgets,
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
