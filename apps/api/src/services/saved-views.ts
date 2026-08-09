import { randomUUID } from "node:crypto";

import { getDatabase } from "../db.js";
import { getUserById, listUsers } from "../repositories/users.js";
import {
  actionBarFilterIdSchema,
  currentSavedViewSchemaVersion,
  savedViewSchema,
  type ActionBarFilterId,
  type SavedView,
  type SavedViewCreateInput
} from "../types.js";

type SavedViewRow = {
  id: string;
  owner_user_id: string;
  name: string;
  query_text: string;
  filter_ids_json: string;
  scope_mode: "all" | "selected";
  scope_user_ids_json: string;
  schema_version: number;
  created_at: string;
  updated_at: string;
};

type SavedViewCreateResult =
  | { status: "created"; view: SavedView }
  | { status: "owner_not_found"; view: null }
  | { status: "scope_user_not_found"; view: null; userIds: string[] }
  | { status: "name_conflict"; view: null }
  | { status: "limit_reached"; view: null };

export const maxSavedViewsPerOwner = 20;

function newId() {
  return `svw_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function readStringArray(value: string) {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? Array.from(
        new Set(
          parsed.filter(
            (entry): entry is string =>
              typeof entry === "string" && entry.trim().length > 0
          )
        )
      )
    : [];
}

function mapSavedView(row: SavedViewRow): SavedView {
  const compatibility =
    row.schema_version === currentSavedViewSchemaVersion
      ? "ready"
      : "unsupported";
  const storedFilterIds = readStringArray(row.filter_ids_json);
  const filterIds: ActionBarFilterId[] = [];
  const unavailableFilterIds: string[] = [];
  for (const filterId of storedFilterIds) {
    const parsed = actionBarFilterIdSchema.safeParse(filterId);
    if (parsed.success) filterIds.push(parsed.data);
    else unavailableFilterIds.push(filterId);
  }

  const availableUserIds = new Set(listUsers().map((user) => user.id));
  const storedScopeUserIds = readStringArray(row.scope_user_ids_json);
  const scopeUserIds = storedScopeUserIds.filter((id) =>
    availableUserIds.has(id)
  );
  const unavailableScopeUserIds = storedScopeUserIds.filter(
    (id) => !availableUserIds.has(id)
  );

  return savedViewSchema.parse({
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    query: row.query_text,
    filterIds,
    scopeMode: row.scope_mode,
    scopeUserIds,
    unavailableFilterIds,
    unavailableScopeUserIds,
    compatibility,
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

export function listSavedViews(
  ownerUserId: string,
  limit = maxSavedViewsPerOwner
) {
  return (
    getDatabase()
      .prepare(
        `SELECT id, owner_user_id, name, query_text, filter_ids_json, scope_mode,
                scope_user_ids_json, schema_version, created_at, updated_at
         FROM saved_views
         WHERE owner_user_id = ?
         ORDER BY updated_at DESC, name COLLATE NOCASE, id
         LIMIT ?`
      )
      .all(
        ownerUserId,
        Math.min(Math.max(limit, 1), maxSavedViewsPerOwner)
      ) as SavedViewRow[]
  ).map(mapSavedView);
}

export function createSavedView(
  input: SavedViewCreateInput
): SavedViewCreateResult {
  if (!getUserById(input.ownerUserId)) {
    return { status: "owner_not_found", view: null };
  }
  const missingScopeUserIds = input.scopeUserIds.filter(
    (userId) => !getUserById(userId)
  );
  if (missingScopeUserIds.length > 0) {
    return {
      status: "scope_user_not_found",
      view: null,
      userIds: missingScopeUserIds
    };
  }
  const duplicate = getDatabase()
    .prepare(
      `SELECT id
       FROM saved_views
       WHERE owner_user_id = ? AND lower(name) = lower(?)
       LIMIT 1`
    )
    .get(input.ownerUserId, input.name) as { id: string } | undefined;
  if (duplicate) {
    return { status: "name_conflict", view: null };
  }
  const existingCount = getDatabase()
    .prepare(
      "SELECT count(*) AS count FROM saved_views WHERE owner_user_id = ?"
    )
    .get(input.ownerUserId) as { count: number };
  if (existingCount.count >= maxSavedViewsPerOwner) {
    return { status: "limit_reached", view: null };
  }

  const now = new Date().toISOString();
  const row: SavedViewRow = {
    id: newId(),
    owner_user_id: input.ownerUserId,
    name: input.name,
    query_text: input.query,
    filter_ids_json: JSON.stringify(input.filterIds),
    scope_mode: input.scopeMode,
    scope_user_ids_json: JSON.stringify(input.scopeUserIds),
    schema_version: currentSavedViewSchemaVersion,
    created_at: now,
    updated_at: now
  };
  getDatabase()
    .prepare(
      `INSERT INTO saved_views (
         id, owner_user_id, name, query_text, filter_ids_json,
         scope_mode, scope_user_ids_json, schema_version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.owner_user_id,
      row.name,
      row.query_text,
      row.filter_ids_json,
      row.scope_mode,
      row.scope_user_ids_json,
      row.schema_version,
      row.created_at,
      row.updated_at
    );
  return { status: "created", view: mapSavedView(row) };
}

export function deleteSavedView(input: { id: string; ownerUserId: string }) {
  return (
    getDatabase()
      .prepare("DELETE FROM saved_views WHERE id = ? AND owner_user_id = ?")
      .run(input.id, input.ownerUserId).changes > 0
  );
}
