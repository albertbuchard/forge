import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { decorateOwnedEntity, setEntityOwner } from "./entity-ownership.js";
import { filterDeletedEntities, isEntityDeleted } from "./deleted-entities.js";
import { recordActivityEvent } from "./activity-events.js";
import {
  tagSchema,
  updateTagSchema,
  type ActivitySource,
  type CreateTagInput,
  type Tag,
  type UpdateTagInput
} from "../types.js";

type ActivityContext = {
  source: ActivitySource;
  actor?: string | null;
};

function mapTag(row: Record<string, unknown>): Tag {
  return tagSchema.parse(
    decorateOwnedEntity("tag", {
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      kind: row.kind,
      color: String(row.color ?? ""),
      description: String(row.description ?? "")
    })
  );
}

function normalizeTagName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function findTagByNormalizedName(
  name: string,
  excludingTagId?: string
): Record<string, unknown> | undefined {
  const normalizedName = normalizeTagName(name);
  return getDatabase()
    .prepare(
      `SELECT tags.id, tags.name, tags.kind, tags.color, tags.description
       FROM tags
       LEFT JOIN deleted_entities
         ON deleted_entities.entity_type = 'tag'
        AND deleted_entities.entity_id = tags.id
       WHERE forge_tag_key(tags.name) = forge_tag_key(?)
         AND (? IS NULL OR tags.id != ?)
       ORDER BY
         CASE WHEN deleted_entities.entity_id IS NULL THEN 0 ELSE 1 END,
         tags.created_at ASC,
         tags.id ASC
       LIMIT 1`
    )
    .get(normalizedName, excludingTagId ?? null, excludingTagId ?? null) as
    | Record<string, unknown>
    | undefined;
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

export function createTag(
  input: CreateTagInput,
  activity?: ActivityContext
): Tag {
  return runInTransaction(() => {
    const now = new Date().toISOString();
    const normalizedName = normalizeTagName(input.name);
    const existing = findTagByNormalizedName(normalizedName);

    if (existing) {
      const existingTag = mapTag(existing);
      if (isEntityDeleted("tag", existingTag.id)) {
        throw new HttpError(
          409,
          "tag_duplicate_in_bin",
          `A matching tag named '${existingTag.name}' is in the Bin. Restore it instead of creating a duplicate.`,
          { existingId: existingTag.id }
        );
      }
      return existingTag;
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
        description:
          tag.description ||
          `New ${tag.kind} tag added to the operating system.`,
        actor: activity.actor ?? null,
        source: activity.source,
        metadata: {
          kind: tag.kind,
          color: tag.color
        }
      });
    }

    return tag;
  });
}

export function updateTag(
  tagId: string,
  input: UpdateTagInput,
  activity?: ActivityContext
): Tag | undefined {
  return runInTransaction(() => {
    const current = getTagById(tagId);
    if (!current) {
      return undefined;
    }

    const parsed = updateTagSchema.parse(input);
    const nextName = normalizeTagName(parsed.name ?? current.name);
    const duplicate = findTagByNormalizedName(nextName, tagId);
    if (duplicate) {
      throw new HttpError(
        409,
        "tag_conflict",
        `A tag named '${nextName}' already exists`
      );
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
  });
}

export function deleteTag(
  tagId: string,
  activity?: ActivityContext
): Tag | undefined {
  const current = getTagById(tagId);
  if (!current) {
    return undefined;
  }

  getDatabase().prepare(`DELETE FROM tags WHERE id = ?`).run(tagId);

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
