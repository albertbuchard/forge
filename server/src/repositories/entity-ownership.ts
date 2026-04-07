import { getDatabase } from "../db.js";
import { listUsersByIds, resolveUserForMutation } from "./users.js";
import type { UserSummary } from "../types.js";

type EntityOwnerRow = {
  entity_id: string;
  user_id: string;
};

type OwnerCandidate = {
  entityType: string;
  entityId: string | null | undefined;
};

export function setEntityOwner(
  entityType: string,
  entityId: string,
  userId?: string | null,
  fallbackLabel?: string | null
): { userId: string; user: UserSummary } {
  const user = resolveUserForMutation(userId, fallbackLabel);
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
       VALUES (?, ?, ?, 'owner', ?, ?)
       ON CONFLICT(entity_type, entity_id)
       DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at`
    )
    .run(entityType, entityId, user.id, now, now);
  return { userId: user.id, user };
}

export function clearEntityOwner(entityType: string, entityId: string): void {
  getDatabase()
    .prepare(
      `DELETE FROM entity_owners WHERE entity_type = ? AND entity_id = ?`
    )
    .run(entityType, entityId);
}

export function getEntityOwnerId(
  entityType: string,
  entityId: string
): string | null {
  const row = getDatabase()
    .prepare(
      `SELECT user_id
       FROM entity_owners
       WHERE entity_type = ? AND entity_id = ?`
    )
    .get(entityType, entityId) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

export function getEntityOwner(
  entityType: string,
  entityId: string
): UserSummary | null {
  const userId = getEntityOwnerId(entityType, entityId);
  return userId ? (listUsersByIds([userId])[0] ?? null) : null;
}

export function inferFirstOwnedUserId(
  candidates: OwnerCandidate[]
): string | null {
  for (const candidate of candidates) {
    if (!candidate.entityId) {
      continue;
    }
    const userId = getEntityOwnerId(candidate.entityType, candidate.entityId);
    if (userId) {
      return userId;
    }
  }
  return null;
}

function listOwnerRows(
  entityType: string,
  entityIds: string[]
): EntityOwnerRow[] {
  if (entityIds.length === 0) {
    return [];
  }
  const placeholders = entityIds.map(() => "?").join(", ");
  return getDatabase()
    .prepare(
      `SELECT entity_id, user_id
       FROM entity_owners
       WHERE entity_type = ?
         AND entity_id IN (${placeholders})`
    )
    .all(entityType, ...entityIds) as EntityOwnerRow[];
}

export function buildEntityOwnerIndex(
  entityType: string,
  entityIds: string[]
): Map<string, { userId: string | null; user: UserSummary | null }> {
  const rows = listOwnerRows(entityType, entityIds);
  const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
  const usersById = new Map(
    listUsersByIds(userIds).map((user) => [user.id, user] as const)
  );
  const index = new Map<
    string,
    { userId: string | null; user: UserSummary | null }
  >();
  for (const entityId of entityIds) {
    index.set(entityId, { userId: null, user: null });
  }
  for (const row of rows) {
    index.set(row.entity_id, {
      userId: row.user_id,
      user: usersById.get(row.user_id) ?? null
    });
  }
  return index;
}

export function decorateOwnedEntities<T extends { id: string }>(
  entityType: string,
  entities: T[]
): Array<T & { userId: string | null; user: UserSummary | null }> {
  const ownerIndex = buildEntityOwnerIndex(
    entityType,
    entities.map((entity) => entity.id)
  );
  return entities.map((entity) => {
    const owner = ownerIndex.get(entity.id) ?? { userId: null, user: null };
    return {
      ...entity,
      userId: owner.userId,
      user: owner.user
    };
  });
}

export function decorateOwnedEntity<T extends { id: string }>(
  entityType: string,
  entity: T
): T & { userId: string | null; user: UserSummary | null } {
  return decorateOwnedEntities(entityType, [entity])[0]!;
}

export function filterOwnedEntities<T extends { id: string }>(
  entityType: string,
  entities: T[],
  userIds?: string[] | null
): Array<T & { userId: string | null; user: UserSummary | null }> {
  const decorated = decorateOwnedEntities(entityType, entities);
  if (!userIds || userIds.length === 0) {
    return decorated;
  }
  const allowed = new Set(userIds);
  return decorated.filter(
    (entity) => {
      if (entity.userId !== null && allowed.has(entity.userId)) {
        return true;
      }
      const embeddedUserId =
        "userId" in entity && typeof entity.userId === "string"
          ? entity.userId
          : null;
      return embeddedUserId !== null && allowed.has(embeddedUserId);
    }
  );
}
