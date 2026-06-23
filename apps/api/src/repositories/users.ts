import { randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import {
  createUserSchema,
  updateUserSchema,
  userAccessGrantSchema,
  userAccessRightsSchema,
  userOwnershipSummarySchema,
  userXpSummarySchema,
  updateUserAccessGrantSchema,
  userSummarySchema,
  type CreateUserInput,
  type UserAccessGrant,
  type UserAccessGrantConfig,
  type UserAccessRights,
  type UpdateUserInput,
  type UpdateUserAccessGrantInput,
  type UserKind,
  type UserOwnershipSummary,
  type UserXpSummary,
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

type RewardOwnershipRow = {
  entity_type: string;
  entity_id: string;
  actor: string | null;
  delta_xp: number;
  created_at: string;
};

function startOfWeek(date: Date): Date {
  const clone = new Date(date);
  const day = clone.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  clone.setDate(clone.getDate() + delta);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

function normalizeHandle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function buildDefaultRights(self = false): UserAccessRights {
  return userAccessRightsSchema.parse({
    discoverable: true,
    canListUsers: true,
    canReadProfile: true,
    canReadEntities: true,
    canSearchEntities: true,
    canLinkEntities: true,
    canCoordinate: true,
    canAffectEntities: true,
    canManageStrategies: true,
    canCreateOnBehalf: true,
    canViewMetrics: true,
    canViewActivity: true,
    ...(self ? { discoverable: true } : {})
  });
}

function buildGrantConfig(self = false): UserAccessGrantConfig {
  return {
    self,
    mutable: self,
    linkedEntities: true,
    rights: buildDefaultRights(self)
  };
}

function normalizeGrantConfig(
  value: unknown,
  options: { self?: boolean } = {}
): UserAccessGrantConfig {
  const current =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const defaultConfig = buildGrantConfig(options.self ?? false);
  return {
    self: typeof current.self === "boolean" ? current.self : defaultConfig.self,
    mutable:
      typeof current.mutable === "boolean"
        ? current.mutable
        : defaultConfig.mutable,
    linkedEntities:
      typeof current.linkedEntities === "boolean"
        ? current.linkedEntities
        : defaultConfig.linkedEntities,
    rights: userAccessRightsSchema.parse({
      ...defaultConfig.rights,
      ...(current.rights &&
      typeof current.rights === "object" &&
      !Array.isArray(current.rights)
        ? current.rights
        : current)
    })
  };
}

function deriveAccessLevel(
  config: UserAccessGrantConfig
): UserAccessGrant["accessLevel"] {
  return config.self ||
    config.mutable ||
    config.rights.canAffectEntities ||
    config.rights.canCreateOnBehalf ||
    config.rights.canManageStrategies
    ? "manage"
    : "view";
}

function upsertRelationshipGrant(
  subjectUserId: string,
  targetUserId: string,
  now: string
): void {
  const database = getDatabase();
  const self = subjectUserId === targetUserId;
  const config = buildGrantConfig(self);
  const accessLevel = deriveAccessLevel(config);
  const existing = database
    .prepare(
      `SELECT id
       FROM user_access_grants
       WHERE subject_user_id = ?
         AND target_user_id = ?
       ORDER BY CASE access_level WHEN 'manage' THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1`
    )
    .get(subjectUserId, targetUserId) as { id: string } | undefined;

  if (existing) {
    database
      .prepare(
        `UPDATE user_access_grants
         SET access_level = ?, config_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(accessLevel, JSON.stringify(config), now, existing.id);
    database
      .prepare(
        `DELETE FROM user_access_grants
         WHERE subject_user_id = ?
           AND target_user_id = ?
           AND id != ?`
      )
      .run(subjectUserId, targetUserId, existing.id);
    return;
  }

  database
    .prepare(
      `INSERT INTO user_access_grants (
         id,
         subject_user_id,
         target_user_id,
         access_level,
         config_json,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `grant_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      subjectUserId,
      targetUserId,
      accessLevel,
      JSON.stringify(config),
      now,
      now
    );
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
  const users = listUsers();
  for (const subjectUser of users) {
    for (const targetUser of users) {
      upsertRelationshipGrant(subjectUser.id, targetUser.id, now);
    }
  }
}

export function ensureBotUser(input: {
  id: string;
  handle: string;
  displayName: string;
  description: string;
  accentColor: string;
}): UserSummary {
  const parsed = createUserSchema.parse({
    kind: "bot",
    handle: normalizeHandle(input.handle),
    displayName: input.displayName,
    description: input.description,
    accentColor: input.accentColor
  });
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO users (id, kind, handle, display_name, description, accent_color, created_at, updated_at)
       VALUES (?, 'bot', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = 'bot',
         handle = excluded.handle,
         display_name = excluded.display_name,
         description = excluded.description,
         accent_color = excluded.accent_color,
         updated_at = excluded.updated_at`
    )
    .run(
      input.id,
      parsed.handle,
      parsed.displayName,
      parsed.description,
      parsed.accentColor,
      now,
      now
    );
  ensurePermissiveGrantsForUser(input.id, now);
  return getUserById(input.id)!;
}

function ensurePermissiveGrantsForUser(userId: string, now: string): void {
  const existingUsers = listUsers();
  for (const otherUser of existingUsers) {
    upsertRelationshipGrant(userId, otherUser.id, now);
    if (otherUser.id !== userId) {
      upsertRelationshipGrant(otherUser.id, userId, now);
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
      config: normalizeGrantConfig(JSON.parse(row.config_json), {
        self: row.subject_user_id === row.target_user_id
      }),
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

export function listUserXpSummaries(): UserXpSummary[] {
  const users = listUsers();
  const summaries = new Map<
    string,
    {
      userId: string;
      totalXp: number;
      weeklyXp: number;
      rewardEventCount: number;
      lastRewardAt: string | null;
    }
  >(
    users.map((user) => [
      user.id,
      {
        userId: user.id,
        totalXp: 0,
        weeklyXp: 0,
        rewardEventCount: 0,
        lastRewardAt: null
      }
    ])
  );
  const ownerRows = getDatabase()
    .prepare(
      `SELECT entity_type, entity_id, user_id
       FROM entity_owners`
    )
    .all() as Array<{
    entity_type: string;
    entity_id: string;
    user_id: string;
  }>;
  const ownerByEntityKey = new Map(
    ownerRows.map(
      (row) => [`${row.entity_type}:${row.entity_id}`, row.user_id] as const
    )
  );
  const usersByLabel = new Map<string, string>();
  for (const user of users) {
    usersByLabel.set(user.displayName.trim().toLowerCase(), user.id);
    usersByLabel.set(user.handle.trim().toLowerCase(), user.id);
  }
  const weekStartIso = startOfWeek(new Date()).toISOString();
  const rewardRows = getDatabase()
    .prepare(
      `SELECT entity_type, entity_id, actor, delta_xp, created_at
       FROM reward_ledger
       ORDER BY created_at ASC`
    )
    .all() as RewardOwnershipRow[];

  for (const row of rewardRows) {
    const ownedUserId =
      row.entity_type === "system"
        ? row.actor
          ? (usersByLabel.get(row.actor.trim().toLowerCase()) ?? null)
          : null
        : (ownerByEntityKey.get(`${row.entity_type}:${row.entity_id}`) ?? null);
    if (!ownedUserId) {
      continue;
    }
    const summary = summaries.get(ownedUserId);
    if (!summary) {
      continue;
    }
    summary.totalXp += row.delta_xp;
    if (row.created_at >= weekStartIso) {
      summary.weeklyXp += row.delta_xp;
    }
    summary.rewardEventCount += 1;
    summary.lastRewardAt = row.created_at;
  }

  return users.map((user) =>
    userXpSummarySchema.parse(
      summaries.get(user.id) ?? {
        userId: user.id,
        totalXp: 0,
        weeklyXp: 0,
        rewardEventCount: 0,
        lastRewardAt: null
      }
    )
  );
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

export function updateUserAccessGrant(
  grantId: string,
  patch: UpdateUserAccessGrantInput
): UserAccessGrant | undefined {
  const current = listUserAccessGrants().find((grant) => grant.id === grantId);
  if (!current) {
    return undefined;
  }
  const parsed = updateUserAccessGrantSchema.parse(patch);
  const nextConfig = normalizeGrantConfig(
    {
      ...current.config,
      rights: {
        ...current.config.rights,
        ...(parsed.rights ?? {})
      }
    },
    { self: current.subjectUserId === current.targetUserId }
  );
  const nextAccessLevel = parsed.accessLevel ?? deriveAccessLevel(nextConfig);
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE user_access_grants
       SET access_level = ?, config_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(nextAccessLevel, JSON.stringify(nextConfig), now, grantId);
  return listUserAccessGrants().find((grant) => grant.id === grantId);
}
