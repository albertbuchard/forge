import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { getDeletedEntityRecord } from "../repositories/deleted-entities.js";
import { filterOwnedEntities } from "../repositories/entity-ownership.js";
import {
  getPreferenceCatalogById,
  getPreferenceProfileById
} from "../repositories/preferences.js";
import { getUserById } from "../repositories/users.js";
import {
  entityNavigationItemSchema,
  entityNavigationPayloadSchema,
  type CrudEntityType,
  type EntityNavigationAvailability,
  type EntityNavigationItem,
  type EntityNavigationPayload
} from "../types.js";
import { getEntityById } from "./entity-crud.js";

const MAX_PIN_ROWS_TO_RESOLVE = 250;
const RECENT_ROW_BATCH_SIZE = 250;
const MAX_RECENT_ROWS_TO_RESOLVE = 1_000;
const MAX_VIEW_COUNT = 2_147_483_647;

type EntityNavigationScope = {
  userIds?: string[];
  projectIds?: string[];
  tagIds?: string[];
};

type EntityNavigationListOptions = EntityNavigationScope & {
  actorKey: string;
  pinnedLimit?: number;
  recentLimit?: number;
};

type EntityPinRow = {
  id: string;
  owner_user_id: string;
  entity_type: CrudEntityType;
  entity_id: string;
  pinned_at: string;
  updated_at: string;
};

type EntityRecentRow = {
  actor_key: string;
  entity_type: CrudEntityType;
  entity_id: string;
  view_count: number;
  first_viewed_at: string;
  last_viewed_at: string;
};

type ResolvedTarget = {
  availability: EntityNavigationAvailability;
  entity: Record<string, unknown> | null;
  title: string;
  detail: string;
  category: string;
  targetPath: string;
};

function newId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
}

export function normalizeEntityNavigationActorKey(
  actorKey: string | null | undefined
) {
  const normalized = actorKey?.trim().toLowerCase().slice(0, 160);
  return normalized || "operator";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0
      )
    : [];
}

function titleCase(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function entityTitle(
  entityType: CrudEntityType,
  entity: Record<string, unknown>
) {
  const candidates =
    entityType === "belief_entry"
      ? [entity.statement, entity.title, entity.name]
      : entityType === "flashcard"
        ? [entity.title, entity.message, entity.triggerSentence]
        : [
            entity.title,
            entity.displayName,
            entity.statement,
            entity.name,
            entity.label,
            entity.slug,
            entity.originalFileName
          ];
  return (
    candidates.map(readString).find(Boolean) ??
    `${titleCase(entityType)} ${String(entity.id ?? "")}`
  );
}

function entityDetail(entity: Record<string, unknown>) {
  return (
    [
      entity.shortDescription,
      entity.summary,
      entity.description,
      entity.overview,
      entity.flexibleAlternative,
      entity.originNote,
      entity.endStateDescription,
      entity.whyItMatters,
      entity.valuedDirection,
      entity.triggerSentence,
      entity.triggerSituation,
      entity.contentPlain,
      entity.status,
      entity.kind
    ]
      .map(readString)
      .find(Boolean) ?? ""
  );
}

export function buildEntityNavigationTargetPath(
  entityType: CrudEntityType,
  entityId: string,
  entity: Record<string, unknown>
): string {
  const id = encodeURIComponent(entityId);
  const graphFocus = (type: CrudEntityType) =>
    `/knowledge-graph?focus=${encodeURIComponent(`${type}:${entityId}`)}`;
  const preferenceFocus = (tab: string, focusKey: string) => {
    const parts = [`tab=${encodeURIComponent(tab)}`];
    const domain = readString(entity.domain);
    const userId = readString(entity.userId);
    if (domain) {
      parts.push(`domain=${encodeURIComponent(domain)}`);
    }
    if (userId) {
      parts.push(`userId=${encodeURIComponent(userId)}`);
    }
    parts.push(`${focusKey}=${id}`);
    return `/preferences?${parts.join("&")}`;
  };
  switch (entityType) {
    case "goal":
      return `/goals/${id}`;
    case "project":
      return `/projects/${id}`;
    case "task":
      return `/tasks/${id}`;
    case "strategy":
      return `/strategies/${id}`;
    case "habit":
      return `/habits?focus=${id}`;
    case "note": {
      const slug = readString(entity.slug);
      if (readString(entity.kind) === "wiki" && slug) {
        const spaceId = readString(entity.spaceId);
        return `/wiki/page/${encodeURIComponent(slug)}${
          spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : ""
        }`;
      }
      return `/notes?focus=${id}`;
    }
    case "insight":
      return graphFocus("insight");
    case "calendar_event":
      return `/calendar?focus=${id}&focusType=calendar_event`;
    case "work_block_template":
      return `/calendar?focus=${id}&focusType=work_block_template`;
    case "task_timebox":
      return `/calendar?focus=${id}&focusType=task_timebox`;
    case "life_event":
      return `/life-events?focus=${id}`;
    case "artifact":
      return `/artifacts/${id}`;
    case "psyche_value":
      return `/psyche/values?focus=${id}`;
    case "behavior_pattern":
      return `/psyche/patterns?focus=${id}`;
    case "behavior":
      return `/psyche/behaviors?focus=${id}`;
    case "belief_entry":
      return `/psyche/schemas-beliefs?focus=${id}`;
    case "mode_profile":
      return `/psyche/modes?focus=${id}`;
    case "mode_guide_session":
      return `/psyche/modes/guide?focus=${id}`;
    case "flashcard":
      return `/psyche/flashcards?focus=${id}`;
    case "event_type":
      return graphFocus("event_type");
    case "emotion_definition":
      return graphFocus("emotion_definition");
    case "trigger_report":
      return `/psyche/reports/${id}`;
    case "preference_catalog":
      return preferenceFocus("concepts", "focusCatalog");
    case "preference_catalog_item":
      return preferenceFocus("concepts", "focusCatalogItem");
    case "preference_context":
      return preferenceFocus("contexts", "focusContext");
    case "preference_item":
      return preferenceFocus("table", "focusItem");
    case "questionnaire_instrument":
      return `/psyche/questionnaires/${id}`;
    case "sleep_session":
      return `/sleep?focus=${id}`;
    case "workout_session":
      return `/sports/workouts/${id}`;
    case "tag":
      return graphFocus("tag");
  }
}

function addPreferenceNavigationContext(
  entityType: CrudEntityType,
  entity: Record<string, unknown>
) {
  if (!entityType.startsWith("preference_")) {
    return entity;
  }

  const catalog =
    entityType === "preference_catalog_item" && readString(entity.catalogId)
      ? getPreferenceCatalogById(readString(entity.catalogId)!)
      : null;
  const profileId = readString(entity.profileId) ?? catalog?.profileId ?? null;
  const profile = profileId ? getPreferenceProfileById(profileId) : null;
  return {
    ...entity,
    domain: readString(entity.domain) ?? catalog?.domain ?? profile?.domain ?? null,
    userId: readString(entity.userId) ?? profile?.userId ?? null
  };
}

function entityMatchesScope(
  entityType: CrudEntityType,
  entityId: string,
  entity: Record<string, unknown>,
  scope: EntityNavigationScope
) {
  if (
    scope.userIds?.length &&
    filterOwnedEntities(
      entityType,
      [{ ...entity, id: entityId }],
      scope.userIds
    ).length === 0
  ) {
    return false;
  }

  if (scope.projectIds?.length) {
    const projectIds = new Set([
      ...(entityType === "project" ? [entityId] : []),
      ...(readString(entity.projectId) ? [readString(entity.projectId)!] : []),
      ...readStringArray(entity.projectIds),
      ...readStringArray(entity.targetProjectIds)
    ]);
    if (!scope.projectIds.some((projectId) => projectIds.has(projectId))) {
      return false;
    }
  }

  if (scope.tagIds?.length) {
    const tagIds = new Set(readStringArray(entity.tagIds));
    if (!scope.tagIds.some((tagId) => tagIds.has(tagId))) {
      return false;
    }
  }

  return true;
}

function resolveTarget(
  entityType: CrudEntityType,
  entityId: string,
  scope: EntityNavigationScope
): ResolvedTarget | null {
  const deleted = getDeletedEntityRecord(entityType, entityId);
  if (deleted) {
    if (!entityMatchesScope(entityType, entityId, deleted.snapshot, scope)) {
      return null;
    }
    return {
      availability: "deleted",
      entity: deleted.snapshot,
      title: deleted.title || entityTitle(entityType, deleted.snapshot),
      detail: deleted.subtitle || "This record is in the bin.",
      category: titleCase(entityType),
      targetPath: "/settings/bin"
    };
  }

  const entity = getEntityById(entityType, entityId);
  if (!entity) {
    if (
      scope.userIds?.length ||
      scope.projectIds?.length ||
      scope.tagIds?.length
    ) {
      return null;
    }
    return {
      availability: "missing",
      entity: null,
      title: `${titleCase(entityType)} unavailable`,
      detail: "The original record is no longer available.",
      category: titleCase(entityType),
      targetPath: "/settings/bin"
    };
  }
  if (!entityMatchesScope(entityType, entityId, entity, scope)) {
    return null;
  }
  const navigationEntity = addPreferenceNavigationContext(entityType, entity);
  return {
    availability: "available",
    entity,
    title: entityTitle(entityType, entity),
    detail: entityDetail(entity),
    category: titleCase(entityType),
    targetPath: buildEntityNavigationTargetPath(
      entityType,
      entityId,
      navigationEntity
    )
  };
}

function pinRowToItem(
  row: EntityPinRow,
  scope: EntityNavigationScope
): EntityNavigationItem | null {
  const target = resolveTarget(row.entity_type, row.entity_id, scope);
  if (!target) {
    return null;
  }
  return entityNavigationItemSchema.parse({
    pinId: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: target.title,
    detail: target.detail,
    category: target.category,
    targetPath: target.targetPath,
    ownerUserId: row.owner_user_id || null,
    availability: target.availability,
    pinnedAt: row.pinned_at,
    lastViewedAt: null,
    viewCount: 0
  });
}

function recentRowToItem(
  row: EntityRecentRow,
  scope: EntityNavigationScope
): EntityNavigationItem | null {
  const target = resolveTarget(row.entity_type, row.entity_id, scope);
  if (!target || target.availability !== "available") {
    return null;
  }
  return entityNavigationItemSchema.parse({
    pinId: null,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: target.title,
    detail: target.detail,
    category: target.category,
    targetPath: target.targetPath,
    ownerUserId: null,
    availability: target.availability,
    pinnedAt: null,
    lastViewedAt: row.last_viewed_at,
    viewCount: row.view_count
  });
}

function listPinRows(userIds?: string[]) {
  if (userIds?.length) {
    return getDatabase()
      .prepare(
        `SELECT id, owner_user_id, entity_type, entity_id, pinned_at, updated_at
         FROM entity_pins
         WHERE owner_user_id = ''
            OR owner_user_id IN (${userIds.map(() => "?").join(", ")})
         ORDER BY pinned_at DESC, id
         LIMIT ${MAX_PIN_ROWS_TO_RESOLVE}`
      )
      .all(...userIds) as EntityPinRow[];
  }
  return getDatabase()
    .prepare(
      `SELECT id, owner_user_id, entity_type, entity_id, pinned_at, updated_at
       FROM entity_pins
       ORDER BY pinned_at DESC, id
       LIMIT ${MAX_PIN_ROWS_TO_RESOLVE}`
    )
    .all() as EntityPinRow[];
}

function listRecentRows(actorKey: string, offset: number) {
  return getDatabase()
    .prepare(
      `SELECT actor_key, entity_type, entity_id, view_count,
              first_viewed_at, last_viewed_at
       FROM entity_recent_views
       WHERE actor_key = ?
       ORDER BY last_viewed_at DESC, entity_type, entity_id
       LIMIT ${RECENT_ROW_BATCH_SIZE} OFFSET ?`
    )
    .all(actorKey, offset) as EntityRecentRow[];
}

function listBoundedRecentRows(actorKey: string) {
  const rows: EntityRecentRow[] = [];
  for (
    let offset = 0;
    offset < MAX_RECENT_ROWS_TO_RESOLVE;
    offset += RECENT_ROW_BATCH_SIZE
  ) {
    const batch = listRecentRows(actorKey, offset);
    rows.push(...batch);
    if (batch.length < RECENT_ROW_BATCH_SIZE) {
      break;
    }
  }
  return rows;
}

function countRecentRows(actorKey: string) {
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM entity_recent_views
       WHERE actor_key = ?`
    )
    .get(actorKey) as { count: number };
  return row.count;
}

export function listEntityNavigation(
  options: EntityNavigationListOptions
): EntityNavigationPayload {
  const actorKey = normalizeEntityNavigationActorKey(options.actorKey);
  const pinnedLimit = Math.min(Math.max(options.pinnedLimit ?? 6, 0), 25);
  const recentLimit = Math.min(Math.max(options.recentLimit ?? 6, 0), 25);
  const scope = {
    userIds: options.userIds,
    projectIds: options.projectIds,
    tagIds: options.tagIds
  };

  const resolvedPins = listPinRows(options.userIds)
    .map((row) => pinRowToItem(row, scope))
    .filter((item): item is EntityNavigationItem => item !== null);
  const pinnedTargetKeys = new Set(
    resolvedPins.map((item) => `${item.entityType}:${item.entityId}`)
  );
  const recentRows = listBoundedRecentRows(actorKey);
  const recentRowTotal = countRecentRows(actorKey);
  const resolvedRecents = recentRows
    .map((row) => recentRowToItem(row, scope))
    .filter((item): item is EntityNavigationItem => item !== null)
    .filter(
      (item) => !pinnedTargetKeys.has(`${item.entityType}:${item.entityId}`)
    );

  return entityNavigationPayloadSchema.parse({
    generatedAt: new Date().toISOString(),
    pinnedTotal: resolvedPins.length,
    recentTotal: recentRowTotal,
    hiddenRecentCount: Math.max(0, recentRowTotal - resolvedRecents.length),
    pinned: resolvedPins.slice(0, pinnedLimit),
    recent: resolvedRecents.slice(0, recentLimit)
  });
}

export function pinEntity(input: {
  actorKey: string;
  entityType: CrudEntityType;
  entityId: string;
  ownerUserId?: string | null;
}) {
  const actorKey = normalizeEntityNavigationActorKey(input.actorKey);
  const ownerUserId = input.ownerUserId?.trim() ?? "";
  if (ownerUserId && !getUserById(ownerUserId)) {
    return { status: "user_not_found" as const, item: null };
  }
  const target = resolveTarget(input.entityType, input.entityId, {});
  if (!target || target.availability !== "available") {
    return { status: "entity_not_found" as const, item: null };
  }

  const row = runInTransaction(() => {
    const existing = getDatabase()
      .prepare(
        `SELECT id, owner_user_id, entity_type, entity_id, pinned_at, updated_at
         FROM entity_pins
         WHERE owner_user_id = ? AND entity_type = ? AND entity_id = ?`
      )
      .get(ownerUserId, input.entityType, input.entityId) as
      | EntityPinRow
      | undefined;
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const created: EntityPinRow = {
      id: newId("pin"),
      owner_user_id: ownerUserId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      pinned_at: now,
      updated_at: now
    };
    getDatabase()
      .prepare(
        `INSERT INTO entity_pins (
           id, owner_user_id, entity_type, entity_id, pinned_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        created.id,
        created.owner_user_id,
        created.entity_type,
        created.entity_id,
        created.pinned_at,
        created.updated_at
      );
    getDatabase()
      .prepare(
        `INSERT INTO entity_pin_events (
           id, pin_id, actor_key, event_type, owner_user_id, entity_type,
           entity_id, occurred_at
         ) VALUES (?, ?, ?, 'pinned', ?, ?, ?, ?)`
      )
      .run(
        newId("pinev"),
        created.id,
        actorKey,
        created.owner_user_id,
        created.entity_type,
        created.entity_id,
        now
      );
    return created;
  });

  return {
    status: "ok" as const,
    item: pinRowToItem(row, {})
  };
}

export function unpinEntity(input: { actorKey: string; pinId: string }) {
  const actorKey = normalizeEntityNavigationActorKey(input.actorKey);
  return runInTransaction(() => {
    const row = getDatabase()
      .prepare(
        `SELECT id, owner_user_id, entity_type, entity_id, pinned_at, updated_at
         FROM entity_pins WHERE id = ?`
      )
      .get(input.pinId) as EntityPinRow | undefined;
    if (!row) {
      return false;
    }
    const now = new Date().toISOString();
    getDatabase().prepare("DELETE FROM entity_pins WHERE id = ?").run(row.id);
    getDatabase()
      .prepare(
        `INSERT INTO entity_pin_events (
           id, pin_id, actor_key, event_type, owner_user_id, entity_type,
           entity_id, occurred_at
         ) VALUES (?, ?, ?, 'unpinned', ?, ?, ?, ?)`
      )
      .run(
        newId("pinev"),
        row.id,
        actorKey,
        row.owner_user_id,
        row.entity_type,
        row.entity_id,
        now
      );
    return true;
  });
}

export function touchEntityNavigation(input: {
  actorKey: string;
  entityType: CrudEntityType;
  entityId: string;
  scope?: EntityNavigationScope;
}) {
  const actorKey = normalizeEntityNavigationActorKey(input.actorKey);
  const target = resolveTarget(
    input.entityType,
    input.entityId,
    input.scope ?? {}
  );
  if (!target || target.availability !== "available") {
    return null;
  }
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO entity_recent_views (
         actor_key, entity_type, entity_id, view_count,
         first_viewed_at, last_viewed_at
       ) VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(actor_key, entity_type, entity_id) DO UPDATE SET
         view_count = MIN(entity_recent_views.view_count + 1, ?),
         last_viewed_at = excluded.last_viewed_at`
    )
    .run(actorKey, input.entityType, input.entityId, now, now, MAX_VIEW_COUNT);
  const row = getDatabase()
    .prepare(
      `SELECT actor_key, entity_type, entity_id, view_count,
              first_viewed_at, last_viewed_at
       FROM entity_recent_views
       WHERE actor_key = ? AND entity_type = ? AND entity_id = ?`
    )
    .get(actorKey, input.entityType, input.entityId) as EntityRecentRow;
  return entityNavigationItemSchema.parse({
    pinId: null,
    entityType: input.entityType,
    entityId: input.entityId,
    title: target.title,
    detail: target.detail,
    category: target.category,
    targetPath: target.targetPath,
    ownerUserId: null,
    availability: "available",
    pinnedAt: null,
    lastViewedAt: row.last_viewed_at,
    viewCount: row.view_count
  });
}
