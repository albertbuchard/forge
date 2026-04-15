import { getDatabase } from "../db.js";
import { listUsersByIds, resolveUserForMutation } from "./users.js";
export function setEntityOwner(entityType, entityId, userId, fallbackLabel) {
    const user = resolveUserForMutation(userId, fallbackLabel);
    const now = new Date().toISOString();
    getDatabase()
        .prepare(`INSERT INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
       VALUES (?, ?, ?, 'owner', ?, ?)
       ON CONFLICT(entity_type, entity_id)
       DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at`)
        .run(entityType, entityId, user.id, now, now);
    return { userId: user.id, user };
}
export function clearEntityOwner(entityType, entityId) {
    getDatabase()
        .prepare(`DELETE FROM entity_owners WHERE entity_type = ? AND entity_id = ?`)
        .run(entityType, entityId);
}
export function getEntityOwnerId(entityType, entityId) {
    const row = getDatabase()
        .prepare(`SELECT user_id
       FROM entity_owners
       WHERE entity_type = ? AND entity_id = ?`)
        .get(entityType, entityId);
    return row?.user_id ?? null;
}
export function getEntityOwner(entityType, entityId) {
    const userId = getEntityOwnerId(entityType, entityId);
    return userId ? (listUsersByIds([userId])[0] ?? null) : null;
}
export function inferFirstOwnedUserId(candidates) {
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
function listOwnerRows(entityType, entityIds) {
    if (entityIds.length === 0) {
        return [];
    }
    const placeholders = entityIds.map(() => "?").join(", ");
    return getDatabase()
        .prepare(`SELECT entity_id, user_id
       FROM entity_owners
       WHERE entity_type = ?
         AND entity_id IN (${placeholders})`)
        .all(entityType, ...entityIds);
}
function listAssignmentRows(entityType, entityIds) {
    if (entityIds.length === 0) {
        return [];
    }
    const placeholders = entityIds.map(() => "?").join(", ");
    return getDatabase()
        .prepare(`SELECT entity_id, user_id, role
       FROM entity_assignments
       WHERE entity_type = ?
         AND entity_id IN (${placeholders})`)
        .all(entityType, ...entityIds);
}
export function replaceEntityAssignees(entityType, entityId, userIds) {
    const normalizedIds = Array.from(new Set((userIds ?? []).map((value) => value.trim()).filter((value) => value.length > 0)));
    const users = normalizedIds.map((userId) => resolveUserForMutation(userId));
    const now = new Date().toISOString();
    const database = getDatabase();
    database
        .prepare(`DELETE FROM entity_assignments
       WHERE entity_type = ?
         AND entity_id = ?
         AND role = 'assignee'`)
        .run(entityType, entityId);
    const insert = database.prepare(`INSERT INTO entity_assignments (entity_type, entity_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, ?, 'assignee', ?, ?)`);
    for (const user of users) {
        insert.run(entityType, entityId, user.id, now, now);
    }
    return users;
}
export function buildEntityOwnerIndex(entityType, entityIds) {
    const rows = listOwnerRows(entityType, entityIds);
    const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
    const usersById = new Map(listUsersByIds(userIds).map((user) => [user.id, user]));
    const index = new Map();
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
export function buildEntityAssigneeIndex(entityType, entityIds) {
    const rows = listAssignmentRows(entityType, entityIds).filter((row) => row.role === "assignee");
    const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
    const usersById = new Map(listUsersByIds(userIds).map((user) => [user.id, user]));
    const index = new Map();
    for (const entityId of entityIds) {
        index.set(entityId, { assigneeUserIds: [], assignees: [] });
    }
    for (const entityId of entityIds) {
        const assigneeIds = rows
            .filter((row) => row.entity_id === entityId)
            .map((row) => row.user_id);
        index.set(entityId, {
            assigneeUserIds: assigneeIds,
            assignees: assigneeIds
                .map((userId) => usersById.get(userId) ?? null)
                .filter((user) => user !== null)
        });
    }
    return index;
}
export function decorateOwnedEntities(entityType, entities) {
    const ownerIndex = buildEntityOwnerIndex(entityType, entities.map((entity) => entity.id));
    const assigneeIndex = buildEntityAssigneeIndex(entityType, entities.map((entity) => entity.id));
    return entities.map((entity) => {
        const owner = ownerIndex.get(entity.id) ?? { userId: null, user: null };
        const assigneeSummary = assigneeIndex.get(entity.id) ?? {
            assigneeUserIds: [],
            assignees: []
        };
        return {
            ...entity,
            userId: owner.userId,
            user: owner.user,
            ownerUserId: owner.userId,
            ownerUser: owner.user,
            assigneeUserIds: assigneeSummary.assigneeUserIds,
            assignees: assigneeSummary.assignees
        };
    });
}
export function decorateOwnedEntity(entityType, entity) {
    return decorateOwnedEntities(entityType, [entity])[0];
}
export function filterOwnedEntities(entityType, entities, userIds) {
    const decorated = decorateOwnedEntities(entityType, entities);
    if (!userIds || userIds.length === 0) {
        return decorated;
    }
    const allowed = new Set(userIds);
    return decorated.filter((entity) => {
        if (entity.userId !== null && allowed.has(entity.userId)) {
            return true;
        }
        if (Array.isArray(entity.assigneeUserIds) &&
            entity.assigneeUserIds.some((userId) => allowed.has(userId))) {
            return true;
        }
        const embeddedUserId = "userId" in entity && typeof entity.userId === "string"
            ? entity.userId
            : null;
        return embeddedUserId !== null && allowed.has(embeddedUserId);
    });
}
