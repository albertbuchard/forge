import { getDatabase } from "../db.js";
import { activitySourceSchema, crudEntityTypeSchema, deletedEntityRecordSchema, settingsBinPayloadSchema } from "../types.js";
function mapDeletedEntity(row) {
    return deletedEntityRecordSchema.parse({
        entityType: row.entity_type,
        entityId: row.entity_id,
        title: row.title,
        subtitle: row.subtitle,
        deletedAt: row.deleted_at,
        deletedByActor: row.deleted_by_actor,
        deletedSource: row.deleted_source,
        deleteReason: row.delete_reason,
        snapshot: JSON.parse(row.snapshot_json)
    });
}
function listDeletedEntityRows(entityType) {
    if (entityType) {
        return getDatabase()
            .prepare(`SELECT entity_type, entity_id, title, subtitle, deleted_at, deleted_by_actor, deleted_source, delete_reason, snapshot_json
         FROM deleted_entities
         WHERE entity_type = ?
         ORDER BY deleted_at DESC`)
            .all(entityType);
    }
    return getDatabase()
        .prepare(`SELECT entity_type, entity_id, title, subtitle, deleted_at, deleted_by_actor, deleted_source, delete_reason, snapshot_json
       FROM deleted_entities
       ORDER BY deleted_at DESC`)
        .all();
}
export function getDeletedEntityRecord(entityType, entityId) {
    const row = getDatabase()
        .prepare(`SELECT entity_type, entity_id, title, subtitle, deleted_at, deleted_by_actor, deleted_source, delete_reason, snapshot_json
       FROM deleted_entities
       WHERE entity_type = ? AND entity_id = ?`)
        .get(entityType, entityId);
    return row ? mapDeletedEntity(row) : undefined;
}
export function listDeletedEntities() {
    return listDeletedEntityRows().map(mapDeletedEntity);
}
export function getDeletedEntityIdSet(entityType) {
    const rows = getDatabase()
        .prepare(`SELECT entity_id FROM deleted_entities WHERE entity_type = ?`)
        .all(entityType);
    return new Set(rows.map((row) => row.entity_id));
}
export function isEntityDeleted(entityType, entityId) {
    const row = getDatabase()
        .prepare(`SELECT 1
       FROM deleted_entities
       WHERE entity_type = ? AND entity_id = ?
       LIMIT 1`)
        .get(entityType, entityId);
    return Boolean(row);
}
export function filterDeletedEntities(entityType, items) {
    if (items.length === 0) {
        return items;
    }
    const deletedIds = getDeletedEntityIdSet(entityType);
    if (deletedIds.size === 0) {
        return items;
    }
    return items.filter((item) => !deletedIds.has(item.id));
}
export function filterDeletedIds(entityType, ids) {
    if (ids.length === 0) {
        return ids;
    }
    const deletedIds = getDeletedEntityIdSet(entityType);
    if (deletedIds.size === 0) {
        return ids;
    }
    return ids.filter((id) => !deletedIds.has(id));
}
export function upsertDeletedEntityRecord(input) {
    const entityType = crudEntityTypeSchema.parse(input.entityType);
    const deletedAt = new Date().toISOString();
    getDatabase()
        .prepare(`INSERT INTO deleted_entities (
        entity_type, entity_id, title, subtitle, deleted_at, deleted_by_actor, deleted_source, delete_reason, snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id) DO UPDATE SET
        title = excluded.title,
        subtitle = excluded.subtitle,
        deleted_at = excluded.deleted_at,
        deleted_by_actor = excluded.deleted_by_actor,
        deleted_source = excluded.deleted_source,
        delete_reason = excluded.delete_reason,
        snapshot_json = excluded.snapshot_json`)
        .run(entityType, input.entityId, input.title, input.subtitle ?? "", deletedAt, input.context.actor ?? null, activitySourceSchema.parse(input.context.source), input.deleteReason ?? "", JSON.stringify(input.snapshot));
}
export function restoreDeletedEntityRecord(entityType, entityId) {
    const existing = getDeletedEntityRecord(entityType, entityId);
    if (!existing) {
        return undefined;
    }
    getDatabase()
        .prepare(`DELETE FROM deleted_entities WHERE entity_type = ? AND entity_id = ?`)
        .run(entityType, entityId);
    return existing;
}
export function clearDeletedEntityRecord(entityType, entityId) {
    getDatabase()
        .prepare(`DELETE FROM deleted_entities WHERE entity_type = ? AND entity_id = ?`)
        .run(entityType, entityId);
}
export function cascadeSoftDeleteAnchoredCollaboration(parentEntityType, parentEntityId, context, deleteReason = "") {
    const noteRows = getDatabase()
        .prepare(`SELECT DISTINCT
         notes.id AS id,
         notes.content_markdown AS content_markdown,
         notes.content_plain AS content_plain,
         notes.author AS author,
         notes.source AS source,
         notes.created_at AS created_at,
         notes.updated_at AS updated_at
       FROM notes
       INNER JOIN note_links
         ON note_links.note_id = notes.id
       LEFT JOIN deleted_entities
         ON deleted_entities.entity_type = 'note'
        AND deleted_entities.entity_id = notes.id
       WHERE note_links.entity_type = ?
         AND note_links.entity_id = ?
         AND deleted_entities.entity_id IS NULL`)
        .all(parentEntityType, parentEntityId);
    if (noteRows.length > 0) {
        const placeholders = noteRows.map(() => "?").join(", ");
        const linkRows = getDatabase()
            .prepare(`SELECT note_id, entity_type, entity_id, anchor_key
         FROM note_links
         WHERE note_id IN (${placeholders})
         ORDER BY created_at ASC`)
            .all(...noteRows.map((row) => row.id));
        const linksByNoteId = new Map();
        for (const link of linkRows) {
            const current = linksByNoteId.get(link.note_id) ?? [];
            current.push({
                entityType: link.entity_type,
                entityId: link.entity_id,
                anchorKey: link.anchor_key.trim().length > 0 ? link.anchor_key : null
            });
            linksByNoteId.set(link.note_id, current);
        }
        for (const row of noteRows) {
            const compact = (row.content_plain || row.content_markdown).replace(/\s+/g, " ").trim();
            upsertDeletedEntityRecord({
                entityType: "note",
                entityId: row.id,
                title: compact.slice(0, 72) || "Note",
                subtitle: compact.length > 72 ? compact.slice(72, 168).trim() : `Linked to ${parentEntityType.replaceAll("_", " ")}`,
                snapshot: {
                    id: row.id,
                    contentMarkdown: row.content_markdown,
                    contentPlain: row.content_plain,
                    author: row.author,
                    source: row.source,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at,
                    links: linksByNoteId.get(row.id) ?? []
                },
                deleteReason,
                context
            });
        }
    }
    const insightRows = getDatabase()
        .prepare(`SELECT id, title, summary, created_at, updated_at
       FROM insights
       WHERE entity_type = ? AND entity_id = ?`)
        .all(parentEntityType, parentEntityId);
    for (const row of insightRows) {
        upsertDeletedEntityRecord({
            entityType: "insight",
            entityId: row.id,
            title: row.title,
            subtitle: row.summary,
            snapshot: {
                id: row.id,
                entityType: parentEntityType,
                entityId: parentEntityId,
                title: row.title,
                summary: row.summary,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            },
            deleteReason,
            context
        });
    }
}
export function restoreAnchoredCollaboration(parentEntityType, parentEntityId) {
    getDatabase()
        .prepare(`DELETE FROM deleted_entities
       WHERE entity_type = 'note'
         AND entity_id IN (
           SELECT DISTINCT note_id
           FROM note_links
           WHERE entity_type = ? AND entity_id = ?
         )`)
        .run(parentEntityType, parentEntityId);
    getDatabase()
        .prepare(`DELETE FROM deleted_entities
       WHERE entity_type = 'insight'
         AND entity_id IN (
           SELECT id
           FROM insights
           WHERE entity_type = ? AND entity_id = ?
         )`)
        .run(parentEntityType, parentEntityId);
}
export function buildSettingsBinPayload() {
    const items = listDeletedEntities();
    const counts = items.reduce((acc, item) => {
        acc[item.entityType] = (acc[item.entityType] ?? 0) + 1;
        return acc;
    }, {});
    return settingsBinPayloadSchema.parse({
        generatedAt: new Date().toISOString(),
        totalCount: items.length,
        countsByEntityType: counts,
        records: items
    });
}
