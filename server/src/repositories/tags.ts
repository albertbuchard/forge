import { randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import { HttpError } from "../errors.js";
import { decorateOwnedEntity, setEntityOwner } from "./entity-ownership.js";
import { filterDeletedEntities, isEntityDeleted } from "./deleted-entities.js";
import { recordActivityEvent } from "./activity-events.js";
import { tagSchema, updateTagSchema, type ActivitySource, type CreateTagInput, type Tag, type UpdateTagInput } from "../types.js";

type ActivityContext = {
  source: ActivitySource;
  actor?: string | null;
};

function mapTag(row: Record<string, unknown>): Tag {
  return tagSchema.parse(decorateOwnedEntity("tag", {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    kind: row.kind,
    color: String(row.color ?? ""),
    description: String(row.description ?? "")
  }));
}

export function listTags(): Tag[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, name, kind, color, description
       FROM tags
       ORDER BY
         CASE kind WHEN 'value' THEN 0 WHEN 'category' THEN 1 ELSE 2 END,
         name`
    )
    .all() as Array<Record<string, unknown>>;
  return filterDeletedEntities("tag", rows.map(mapTag));
}

export function getTagById(tagId: string): Tag | undefined {
  if (isEntityDeleted("tag", tagId)) {
    return undefined;
  }
  const row = getDatabase()
    .prepare(
      `SELECT id, name, kind, color, description
       FROM tags
       WHERE id = ?`
    )
    .get(tagId) as Record<string, unknown> | undefined;
  return row ? mapTag(row) : undefined;
}

export function createTag(input: CreateTagInput, activity?: ActivityContext): Tag {
  const now = new Date().toISOString();
  const normalizedName = input.name.trim();
  const existing = getDatabase()
    .prepare(
      `SELECT id, name, kind, color, description
       FROM tags
       WHERE lower(name) = lower(?)`
    )
    .get(normalizedName) as Record<string, unknown> | undefined;

  if (existing) {
    return mapTag(existing);
  }

  const tag: Tag = tagSchema.parse({
    id: `tag_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    name: normalizedName,
    kind: input.kind,
    color: input.color,
    description: input.description
  });

  getDatabase()
    .prepare(
      `INSERT INTO tags (id, name, kind, color, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(tag.id, tag.name, tag.kind, tag.color, tag.description, now);
  setEntityOwner("tag", tag.id, input.userId);

  if (activity) {
    recordActivityEvent({
      entityType: "tag",
      entityId: tag.id,
      eventType: "tag_created",
      title: `Tag created: ${tag.name}`,
      description: tag.description || `New ${tag.kind} tag added to the operating system.`,
      actor: activity.actor ?? null,
      source: activity.source,
      metadata: {
        kind: tag.kind,
        color: tag.color
      }
    });
  }

  return tag;
}

export function updateTag(tagId: string, input: UpdateTagInput, activity?: ActivityContext): Tag | undefined {
  const current = getTagById(tagId);
  if (!current) {
    return undefined;
  }

  const parsed = updateTagSchema.parse(input);
  const nextName = parsed.name ?? current.name;
  const duplicate = getDatabase()
    .prepare(
      `SELECT id
       FROM tags
       WHERE lower(name) = lower(?)
         AND id != ?`
    )
    .get(nextName, tagId) as { id: string } | undefined;
  if (duplicate) {
    throw new HttpError(409, "tag_conflict", `A tag named '${nextName}' already exists`);
  }

  const tag = tagSchema.parse({
    id: current.id,
    name: nextName,
    kind: parsed.kind ?? current.kind,
    color: parsed.color ?? current.color,
    description: parsed.description ?? current.description
  });

  getDatabase()
    .prepare(
      `UPDATE tags
       SET name = ?, kind = ?, color = ?, description = ?
       WHERE id = ?`
    )
    .run(tag.name, tag.kind, tag.color, tag.description, tagId);
  if (parsed.userId !== undefined) {
    setEntityOwner("tag", tagId, parsed.userId);
  }

  if (activity) {
    recordActivityEvent({
      entityType: "tag",
      entityId: tag.id,
      eventType: "tag_updated",
      title: `Tag updated: ${tag.name}`,
      description: tag.description || "Tag details were updated.",
      actor: activity.actor ?? null,
      source: activity.source,
      metadata: {
        previousName: current.name,
        kind: tag.kind,
        previousKind: current.kind,
        color: tag.color,
        previousColor: current.color
      }
    });
  }

  return tag;
}

export function deleteTag(tagId: string, activity?: ActivityContext): Tag | undefined {
  const current = getTagById(tagId);
  if (!current) {
    return undefined;
  }

  getDatabase()
    .prepare(`DELETE FROM tags WHERE id = ?`)
    .run(tagId);

  if (activity) {
    recordActivityEvent({
      entityType: "tag",
      entityId: current.id,
      eventType: "tag_deleted",
      title: `Tag deleted: ${current.name}`,
      description: current.description || "Tag removed from the system.",
      actor: activity.actor ?? null,
      source: activity.source,
      metadata: {
        kind: current.kind,
        color: current.color
      }
    });
  }

  return current;
}

export function listTagsByIds(tagIds: string[]): Tag[] {
  if (tagIds.length === 0) {
    return [];
  }
  const placeholders = tagIds.map(() => "?").join(", ");
  const rows = getDatabase()
    .prepare(
      `SELECT id, name, kind, color, description
       FROM tags
       WHERE id IN (${placeholders})`
    )
    .all(...tagIds) as Array<Record<string, unknown>>;
  return filterDeletedEntities("tag", rows.map(mapTag));
}
