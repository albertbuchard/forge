import { getDatabase } from "../db.js";
import {
  activitySourceSchema,
  crudEntityTypeSchema,
  deletedEntityRecordSchema,
  settingsBinPayloadSchema,
  type ActivitySource,
  type CrudEntityType,
  type DeletedEntityRecord,
  type SettingsBinPayload
} from "../types.js";

type DeletionContext = {
  source: ActivitySource;
  actor?: string | null;
};

type DeletedEntityRow = {
  entity_type: string;
  entity_id: string;
  title: string;
  subtitle: string;
  deleted_at: string;
  deleted_by_actor: string | null;
  deleted_source: string;
  delete_reason: string;
  snapshot_json: string;
};

function mapDeletedEntity(row: DeletedEntityRow): DeletedEntityRecord {
  return deletedEntityRecordSchema.parse({
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    subtitle: row.subtitle,
    deletedAt: row.deleted_at,
    deletedByActor: row.deleted_by_actor,
    deletedSource: row.deleted_source,
    deleteReason: row.delete_reason,
    snapshot: JSON.parse(row.snapshot_json) as Record<string, unknown>
  });
}

function listDeletedEntityRows(entityType?: CrudEntityType): DeletedEntityRow[] {
  if (entityType) {
    return getDatabase()
      .prepare(
        `SELECT entity_type, entity_id, title, subtitle, deleted_at, deleted_by_actor, deleted_source, delete_reason, snapshot_json
         FROM deleted_entities
         WHERE entity_type = ?
         ORDER BY deleted_at DESC`
      )
      .all(entityType) as DeletedEntityRow[];
  }

  return getDatabase()
    .prepare(
      `SELECT entity_type, entity_id, title, subtitle, deleted_at, deleted_by_actor, deleted_source, delete_reason, snapshot_json
       FROM deleted_entities
       ORDER BY deleted_at DESC`
    )
    .all() as DeletedEntityRow[];
}

export function getDeletedEntityRecord(entityType: CrudEntityType, entityId: string): DeletedEntityRecord | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT entity_type, entity_id, title, subtitle, deleted_at, deleted_by_actor, deleted_source, delete_reason, snapshot_json
       FROM deleted_entities
       WHERE entity_type = ? AND entity_id = ?`
    )
    .get(entityType, entityId) as DeletedEntityRow | undefined;
  return row ? mapDeletedEntity(row) : undefined;
}

export function listDeletedEntities(): DeletedEntityRecord[] {
  return listDeletedEntityRows().map(mapDeletedEntity);
}

export function getDeletedEntityIdSet(entityType: CrudEntityType): Set<string> {
  const rows = getDatabase()
    .prepare(`SELECT entity_id FROM deleted_entities WHERE entity_type = ?`)
    .all(entityType) as Array<{ entity_id: string }>;
  return new Set(rows.map((row) => row.entity_id));
}

export function isEntityDeleted(entityType: CrudEntityType, entityId: string): boolean {
  const row = getDatabase()
    .prepare(
      `SELECT 1
       FROM deleted_entities
       WHERE entity_type = ? AND entity_id = ?
       LIMIT 1`
    )
    .get(entityType, entityId) as { 1: number } | undefined;
  return Boolean(row);
}

export function filterDeletedEntities<T extends { id: string }>(entityType: CrudEntityType, items: T[]): T[] {
  if (items.length === 0) {
    return items;
  }
  const deletedIds = getDeletedEntityIdSet(entityType);
  if (deletedIds.size === 0) {
    return items;
  }
  return items.filter((item) => !deletedIds.has(item.id));
}

export function filterDeletedIds(entityType: CrudEntityType, ids: string[]): string[] {
  if (ids.length === 0) {
    return ids;
  }
  const deletedIds = getDeletedEntityIdSet(entityType);
  if (deletedIds.size === 0) {
    return ids;
  }
  return ids.filter((id) => !deletedIds.has(id));
}

export function upsertDeletedEntityRecord(input: {
  entityType: CrudEntityType;
  entityId: string;
  title: string;
  subtitle?: string;
  snapshot: Record<string, unknown>;
  deleteReason?: string;
  context: DeletionContext;
}) {
  const entityType = crudEntityTypeSchema.parse(input.entityType);
  const deletedAt = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO deleted_entities (
        entity_type, entity_id, title, subtitle, deleted_at, deleted_by_actor, deleted_source, delete_reason, snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id) DO UPDATE SET
        title = excluded.title,
        subtitle = excluded.subtitle,
        deleted_at = excluded.deleted_at,
        deleted_by_actor = excluded.deleted_by_actor,
        deleted_source = excluded.deleted_source,
        delete_reason = excluded.delete_reason,
        snapshot_json = excluded.snapshot_json`
    )
    .run(
      entityType,
      input.entityId,
      input.title,
      input.subtitle ?? "",
      deletedAt,
      input.context.actor ?? null,
      activitySourceSchema.parse(input.context.source),
      input.deleteReason ?? "",
      JSON.stringify(input.snapshot)
    );
}

export function restoreDeletedEntityRecord(entityType: CrudEntityType, entityId: string): DeletedEntityRecord | undefined {
  const existing = getDeletedEntityRecord(entityType, entityId);
  if (!existing) {
    return undefined;
  }
  getDatabase()
    .prepare(`DELETE FROM deleted_entities WHERE entity_type = ? AND entity_id = ?`)
    .run(entityType, entityId);
  return existing;
}

export function clearDeletedEntityRecord(entityType: CrudEntityType, entityId: string): void {
  getDatabase()
    .prepare(`DELETE FROM deleted_entities WHERE entity_type = ? AND entity_id = ?`)
    .run(entityType, entityId);
}

export function cascadeSoftDeleteAnchoredCollaboration(
  parentEntityType: Exclude<CrudEntityType, "insight">,
  parentEntityId: string,
  context: DeletionContext,
  deleteReason = ""
) {
  const noteRows = getDatabase()
    .prepare(
      `SELECT DISTINCT
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
         AND deleted_entities.entity_id IS NULL`
    )
    .all(parentEntityType, parentEntityId) as Array<{
      id: string;
      content_markdown: string;
      content_plain: string;
      author: string | null;
      source: string;
      created_at: string;
      updated_at: string;
    }>;
  if (noteRows.length > 0) {
    const placeholders = noteRows.map(() => "?").join(", ");
    const linkRows = getDatabase()
      .prepare(
        `SELECT note_id, entity_type, entity_id, anchor_key
         FROM note_links
         WHERE note_id IN (${placeholders})
         ORDER BY created_at ASC`
      )
      .all(...noteRows.map((row) => row.id)) as Array<{
      note_id: string;
      entity_type: string;
      entity_id: string;
      anchor_key: string;
    }>;
    const linksByNoteId = new Map<string, Array<{ entityType: string; entityId: string; anchorKey: string | null }>>();
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
    .prepare(
      `SELECT id, title, summary, created_at, updated_at
       FROM insights
       WHERE entity_type = ? AND entity_id = ?`
    )
    .all(parentEntityType, parentEntityId) as Array<{
      id: string;
      title: string;
      summary: string;
      created_at: string;
      updated_at: string;
    }>;
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

export function restoreAnchoredCollaboration(parentEntityType: CrudEntityType, parentEntityId: string): void {
  getDatabase()
    .prepare(
      `DELETE FROM deleted_entities
       WHERE entity_type = 'note'
         AND entity_id IN (
           SELECT DISTINCT note_id
           FROM note_links
           WHERE entity_type = ? AND entity_id = ?
         )`
    )
    .run(parentEntityType, parentEntityId);

  getDatabase()
    .prepare(
      `DELETE FROM deleted_entities
       WHERE entity_type = 'insight'
         AND entity_id IN (
           SELECT id
           FROM insights
           WHERE entity_type = ? AND entity_id = ?
         )`
    )
    .run(parentEntityType, parentEntityId);
}

export function buildSettingsBinPayload(): SettingsBinPayload {
  const items = listDeletedEntities();
  const counts = items.reduce<Record<string, number>>((acc, item) => {
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
