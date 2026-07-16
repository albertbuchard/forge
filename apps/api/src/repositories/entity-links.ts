import { getDatabase } from "../db.js";

export type EntityLinkInput = {
  entityType: string;
  entityId: string;
  anchorKey?: string | null;
  relationship?: string | null;
};

export type EntityLinkRecord = {
  sourceEntityType: string;
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
  anchorKey: string | null;
  relationship: string;
  createdByActor: string | null;
  createdAt: string;
};

type EntityLinkRow = {
  source_entity_type: string;
  source_entity_id: string;
  target_entity_type: string;
  target_entity_id: string;
  anchor_key: string;
  relationship: string;
  created_by_actor: string | null;
  created_at: string;
};

function mapRow(row: EntityLinkRow): EntityLinkRecord {
  return {
    sourceEntityType: row.source_entity_type,
    sourceEntityId: row.source_entity_id,
    targetEntityType: row.target_entity_type,
    targetEntityId: row.target_entity_id,
    anchorKey: row.anchor_key.trim() || null,
    relationship: row.relationship,
    createdByActor: row.created_by_actor,
    createdAt: row.created_at
  };
}

function normalizeLink(link: EntityLinkInput) {
  return {
    entityType: link.entityType.trim(),
    entityId: link.entityId.trim(),
    anchorKey: link.anchorKey?.trim() ?? "",
    relationship: link.relationship?.trim() || "related"
  };
}

export function normalizeEntityLinks(links: EntityLinkInput[]) {
  const seen = new Set<string>();
  return links
    .map(normalizeLink)
    .filter((link) => link.entityType.length > 0 && link.entityId.length > 0)
    .filter((link) => {
      const key = `${link.entityType}:${link.entityId}:${link.anchorKey}:${link.relationship}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

export function listEntityLinksForSources(
  sourceEntityType: string,
  sourceEntityIds: string[]
): EntityLinkRecord[] {
  if (sourceEntityIds.length === 0) {
    return [];
  }
  const placeholders = sourceEntityIds.map(() => "?").join(", ");
  const rows = getDatabase()
    .prepare(
      `SELECT source_entity_type, source_entity_id, target_entity_type, target_entity_id,
              anchor_key, relationship, created_by_actor, created_at
       FROM entity_links
       WHERE source_entity_type = ?
         AND source_entity_id IN (${placeholders})
       ORDER BY created_at ASC`
    )
    .all(sourceEntityType, ...sourceEntityIds) as EntityLinkRow[];
  return rows.map(mapRow);
}

export function listEntityLinksForEntity(
  entityType: string,
  entityId: string
): EntityLinkRecord[] {
  const rows = getDatabase()
    .prepare(
      `SELECT source_entity_type, source_entity_id, target_entity_type, target_entity_id,
              anchor_key, relationship, created_by_actor, created_at
       FROM entity_links
       WHERE (source_entity_type = ? AND source_entity_id = ?)
          OR (target_entity_type = ? AND target_entity_id = ?)
       ORDER BY created_at ASC`
    )
    .all(entityType, entityId, entityType, entityId) as EntityLinkRow[];
  return rows.map(mapRow);
}

export function deleteEntityLinksForEntity(
  entityType: string,
  entityId: string
) {
  return getDatabase()
    .prepare(
      `DELETE FROM entity_links
       WHERE (source_entity_type = ? AND source_entity_id = ?)
          OR (target_entity_type = ? AND target_entity_id = ?)`
    )
    .run(entityType, entityId, entityType, entityId);
}

export function replaceEntityLinksForSource(input: {
  sourceEntityType: string;
  sourceEntityId: string;
  links: EntityLinkInput[];
  actor?: string | null;
  now?: Date;
}) {
  const createdAt = (input.now ?? new Date()).toISOString();
  const normalized = normalizeEntityLinks(input.links);
  getDatabase()
    .prepare(
      `DELETE FROM entity_links
       WHERE source_entity_type = ?
         AND source_entity_id = ?`
    )
    .run(input.sourceEntityType, input.sourceEntityId);
  const statement = getDatabase().prepare(
    `INSERT OR IGNORE INTO entity_links (
      source_entity_type, source_entity_id, target_entity_type, target_entity_id,
      anchor_key, relationship, created_by_actor, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const link of normalized) {
    statement.run(
      input.sourceEntityType,
      input.sourceEntityId,
      link.entityType,
      link.entityId,
      link.anchorKey,
      link.relationship,
      input.actor ?? null,
      createdAt
    );
  }
}

export function replaceEntityLinksForSourceRelationships(input: {
  sourceEntityType: string;
  sourceEntityId: string;
  relationships: string[];
  links: EntityLinkInput[];
  actor?: string | null;
  now?: Date;
}) {
  const relationships = [
    ...new Set(
      input.relationships
        .map((relationship) => relationship.trim())
        .filter(Boolean)
    )
  ];
  const managedRelationships = new Set(relationships);
  const normalized = normalizeEntityLinks(input.links);
  const unmanagedLink = normalized.find(
    (link) => !managedRelationships.has(link.relationship)
  );
  if (unmanagedLink) {
    throw new Error(
      `Relationship ${unmanagedLink.relationship} is outside this managed replacement set.`
    );
  }

  if (relationships.length > 0) {
    getDatabase()
      .prepare(
        `DELETE FROM entity_links
         WHERE source_entity_type = ?
           AND source_entity_id = ?
           AND relationship IN (${relationships.map(() => "?").join(", ")})`
      )
      .run(input.sourceEntityType, input.sourceEntityId, ...relationships);
  }

  const createdAt = (input.now ?? new Date()).toISOString();
  const statement = getDatabase().prepare(
    `INSERT OR IGNORE INTO entity_links (
      source_entity_type, source_entity_id, target_entity_type, target_entity_id,
      anchor_key, relationship, created_by_actor, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const link of normalized) {
    statement.run(
      input.sourceEntityType,
      input.sourceEntityId,
      link.entityType,
      link.entityId,
      link.anchorKey,
      link.relationship,
      input.actor ?? null,
      createdAt
    );
  }
}
