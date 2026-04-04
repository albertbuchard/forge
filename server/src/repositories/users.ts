import { randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import {
  createUserSchema,
  updateUserSchema,
  userAccessGrantSchema,
  userOwnershipSummarySchema,
  userSummarySchema,
  type CreateUserInput,
  type UserAccessGrant,
  type UpdateUserInput,
  type UserKind,
  type UserOwnershipSummary,
  type UserSummary
} from "../types.js";

type UserRow = {
  id: string;
  kind: UserKind;
  handle: string;
  display_name: string;
  description: string;
  accent_color: string;
  created_at: string;
  updated_at: string;
};

type UserAccessGrantRow = {
  id: string;
  subject_user_id: string;
  target_user_id: string;
  access_level: UserAccessGrant["accessLevel"];
  config_json: string;
  created_at: string;
  updated_at: string;
};

function normalizeHandle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function ensureSystemUsers(): void {
  const database = getDatabase();
  const settingsRow = database
    .prepare(
      `SELECT operator_name
       FROM app_settings
       WHERE id = 1`
    )
    .get() as { operator_name: string } | undefined;
  const operatorDisplayName = settingsRow?.operator_name?.trim() || "Operator";
  const operatorHandle = normalizeHandle(operatorDisplayName) || "operator";
  const now = new Date().toISOString();

  database
    .prepare(
      `INSERT OR IGNORE INTO users (id, kind, handle, display_name, description, accent_color, created_at, updated_at)
       VALUES (?, 'human', ?, ?, 'Primary human Forge operator.', '#f4b97a', ?, ?)`
    )
    .run("user_operator", operatorHandle, operatorDisplayName, now, now);

  database
    .prepare(
      `UPDATE users
       SET handle = ?, display_name = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(operatorHandle, operatorDisplayName, now, "user_operator");

  database
    .prepare(
      `INSERT OR IGNORE INTO users (id, kind, handle, display_name, description, accent_color, created_at, updated_at)
       VALUES (
         'user_forge_bot',
         'bot',
         'forge_bot',
         'Forge Bot',
         'Autonomous or semi-autonomous execution partner inside Forge.',
         '#7dd3fc',
         ?,
         ?
       )`
    )
    .run(now, now);

  database
    .prepare(
      `INSERT OR IGNORE INTO user_access_grants (
         id,
         subject_user_id,
         target_user_id,
         access_level,
         config_json,
         created_at,
         updated_at
       )
       SELECT
         'grant_' || lower(hex(randomblob(8))),
         subject_users.id,
         target_users.id,
         CASE
           WHEN subject_users.id = target_users.id THEN 'manage'
           ELSE 'view'
         END,
         CASE
           WHEN subject_users.id = target_users.id THEN '{"self":true,"mutable":true}'
           ELSE '{"discoverable":true,"linkedEntities":true}'
         END,
         ?,
         ?
       FROM users AS subject_users
       CROSS JOIN users AS target_users`
    )
    .run(now, now);
}

function ensurePermissiveGrantsForUser(userId: string, now: string): void {
  const database = getDatabase();
  const insert = database.prepare(
    `INSERT OR IGNORE INTO user_access_grants (
       id,
       subject_user_id,
       target_user_id,
       access_level,
       config_json,
       created_at,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const existingUsers = listUsers();
  for (const otherUser of existingUsers) {
    const accessLevel = otherUser.id === userId ? "manage" : "view";
    const configJson =
      otherUser.id === userId
        ? '{"self":true,"mutable":true}'
        : '{"discoverable":true,"linkedEntities":true}';
    insert.run(
      `grant_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      userId,
      otherUser.id,
      accessLevel,
      configJson,
      now,
      now
    );
    if (otherUser.id !== userId) {
      insert.run(
        `grant_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        otherUser.id,
        userId,
        "view",
        '{"discoverable":true,"linkedEntities":true}',
        now,
        now
      );
    }
  }
}

function mapUser(row: UserRow): UserSummary {
  return userSummarySchema.parse({
    id: row.id,
    kind: row.kind,
    handle: row.handle,
    displayName: row.display_name,
    description: row.description,
    accentColor: row.accent_color,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function readUserRows(
  whereSql = "",
  params: Array<string | number> = []
): UserRow[] {
  return getDatabase()
    .prepare(
      `SELECT id, kind, handle, display_name, description, accent_color, created_at, updated_at
       FROM users
       ${whereSql}
       ORDER BY CASE kind WHEN 'human' THEN 0 ELSE 1 END, display_name ASC`
    )
    .all(...params) as UserRow[];
}

export function listUsers(filters: { kind?: UserKind } = {}): UserSummary[] {
  const whereClauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.kind) {
    whereClauses.push("kind = ?");
    params.push(filters.kind);
  }
  const whereSql =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  return readUserRows(whereSql, params).map(mapUser);
}

export function listUsersByIds(userIds: string[]): UserSummary[] {
  if (userIds.length === 0) {
    return [];
  }
  const placeholders = userIds.map(() => "?").join(", ");
  return readUserRows(`WHERE id IN (${placeholders})`, [...userIds]).map(
    mapUser
  );
}

export function getUserById(userId: string): UserSummary | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, kind, handle, display_name, description, accent_color, created_at, updated_at
       FROM users
       WHERE id = ?`
    )
    .get(userId) as UserRow | undefined;
  return row ? mapUser(row) : undefined;
}

export function listUserAccessGrants(
  filters: {
    subjectUserId?: string;
    targetUserId?: string;
  } = {}
): UserAccessGrant[] {
  const whereClauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.subjectUserId) {
    whereClauses.push("subject_user_id = ?");
    params.push(filters.subjectUserId);
  }
  if (filters.targetUserId) {
    whereClauses.push("target_user_id = ?");
    params.push(filters.targetUserId);
  }
  const whereSql =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const rows = getDatabase()
    .prepare(
      `SELECT id, subject_user_id, target_user_id, access_level, config_json, created_at, updated_at
       FROM user_access_grants
       ${whereSql}
       ORDER BY subject_user_id ASC, target_user_id ASC`
    )
    .all(...params) as UserAccessGrantRow[];
  const usersById = new Map(
    listUsers().map((user) => [user.id, user] as const)
  );
  return rows.map((row) =>
    userAccessGrantSchema.parse({
      id: row.id,
      subjectUserId: row.subject_user_id,
      targetUserId: row.target_user_id,
      accessLevel: row.access_level,
      config: JSON.parse(row.config_json) as Record<string, unknown>,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      subjectUser: usersById.get(row.subject_user_id) ?? null,
      targetUser: usersById.get(row.target_user_id) ?? null
    })
  );
}

export function listUserOwnershipSummaries(): UserOwnershipSummary[] {
  const rows = getDatabase()
    .prepare(
      `SELECT user_id, entity_type, COUNT(*) AS count
       FROM entity_owners
       GROUP BY user_id, entity_type
       ORDER BY user_id ASC, entity_type ASC`
    )
    .all() as Array<{ user_id: string; entity_type: string; count: number }>;
  const countsByUserId = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const current = countsByUserId.get(row.user_id) ?? {};
    current[row.entity_type] = row.count;
    countsByUserId.set(row.user_id, current);
  }
  return listUsers().map((user) => {
    const entityCounts = countsByUserId.get(user.id) ?? {};
    const totalOwnedEntities = Object.values(entityCounts).reduce(
      (sum, count) => sum + count,
      0
    );
    return userOwnershipSummarySchema.parse({
      userId: user.id,
      totalOwnedEntities,
      entityCounts
    });
  });
}

export function findUserByLabel(label: string): UserSummary | undefined {
  const normalizedLabel = label.trim().toLowerCase();
  if (!normalizedLabel) {
    return undefined;
  }
  const row = getDatabase()
    .prepare(
      `SELECT id, kind, handle, display_name, description, accent_color, created_at, updated_at
       FROM users
       WHERE lower(display_name) = ?
          OR lower(handle) = ?
       ORDER BY CASE kind WHEN 'human' THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1`
    )
    .get(normalizedLabel, normalizeHandle(normalizedLabel)) as
    | UserRow
    | undefined;
  return row ? mapUser(row) : undefined;
}

export function getDefaultUser(): UserSummary {
  return (
    getUserById("user_operator") ??
    listUsers({ kind: "human" })[0] ??
    listUsers()[0] ??
    (() => {
      throw new Error("Forge has no configured users");
    })()
  );
}

export function resolveUserForMutation(
  userId?: string | null,
  fallbackLabel?: string | null
): UserSummary {
  if (userId) {
    const user = getUserById(userId);
    if (!user) {
      throw new Error(`User ${userId} does not exist`);
    }
    return user;
  }
  if (fallbackLabel) {
    const matched = findUserByLabel(fallbackLabel);
    if (matched) {
      return matched;
    }
  }
  return getDefaultUser();
}

export function createUser(input: CreateUserInput): UserSummary {
  const parsed = createUserSchema.parse({
    ...input,
    handle: normalizeHandle(input.handle || input.displayName)
  });
  const now = new Date().toISOString();
  const id = `user_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  getDatabase()
    .prepare(
      `INSERT INTO users (id, kind, handle, display_name, description, accent_color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      parsed.kind,
      parsed.handle,
      parsed.displayName,
      parsed.description,
      parsed.accentColor,
      now,
      now
    );
  ensurePermissiveGrantsForUser(id, now);
  return getUserById(id)!;
}

export function updateUser(
  userId: string,
  patch: UpdateUserInput
): UserSummary | undefined {
  const current = getUserById(userId);
  if (!current) {
    return undefined;
  }
  const parsed = updateUserSchema.parse(patch);
  const next = {
    kind: parsed.kind ?? current.kind,
    handle: normalizeHandle(parsed.handle ?? current.handle),
    displayName: parsed.displayName ?? current.displayName,
    description: parsed.description ?? current.description,
    accentColor: parsed.accentColor ?? current.accentColor,
    updatedAt: new Date().toISOString()
  };
  getDatabase()
    .prepare(
      `UPDATE users
       SET kind = ?, handle = ?, display_name = ?, description = ?, accent_color = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.kind,
      next.handle,
      next.displayName,
      next.description,
      next.accentColor,
      next.updatedAt,
      userId
    );
  return getUserById(userId);
}
