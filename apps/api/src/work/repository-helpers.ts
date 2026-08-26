import { createHash, randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import {
  listEntityLinksForEntity,
  replaceEntityLinksForSource,
  type EntityLinkRecord
} from "../repositories/entity-links.js";
import { setEntityOwner } from "../repositories/entity-ownership.js";
import type { WorkAccess } from "./access.js";
import { buildRootScopeClause, projectWorkRecord } from "./access.js";
import type { WorkActor } from "./types.js";

export type SqlRow = Record<string, string | number | null>;

const booleanKeys = new Set([
  "lookingForOpportunities",
  "enabled",
  "isBuiltin",
  "sealed",
  "duplicatePrevention"
]);

function camel(value: string) {
  return value.replace(/_([a-z])/gu, (_match, letter: string) =>
    letter.toUpperCase()
  );
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function rowToWorkRecord(
  row: SqlRow,
  access?: WorkAccess
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(row)) {
    const isJson = rawKey.endsWith("_json");
    const key = camel(isJson ? rawKey.slice(0, -5) : rawKey);
    const value = isJson
      ? parseJson(rawValue, rawKey.includes("ids") ? [] : {})
      : rawValue;
    record[key] =
      booleanKeys.has(key) && typeof value === "number" ? value === 1 : value;
  }
  return access ? projectWorkRecord(record, access) : record;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
}

export function fingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function newWorkId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export type WorkRootConfig = {
  entityType: string;
  table: string;
  idPrefix: string;
  titleColumn: string;
  ownerColumn: string;
  supportsDeleted: boolean;
};

export const WORK_ROOTS: Record<string, WorkRootConfig> = {
  work_organization: {
    entityType: "work_organization",
    table: "work_organizations",
    idPrefix: "worg",
    titleColumn: "name",
    ownerColumn: "owner_user_id",
    supportsDeleted: true
  },
  work_engagement: {
    entityType: "work_engagement",
    table: "work_engagements",
    idPrefix: "weng",
    titleColumn: "title",
    ownerColumn: "owner_user_id",
    supportsDeleted: true
  },
  opportunity_campaign: {
    entityType: "opportunity_campaign",
    table: "opportunity_campaigns",
    idPrefix: "ocamp",
    titleColumn: "title",
    ownerColumn: "owner_user_id",
    supportsDeleted: true
  },
  job_opportunity: {
    entityType: "job_opportunity",
    table: "job_opportunities",
    idPrefix: "jopp",
    titleColumn: "title",
    ownerColumn: "owner_user_id",
    supportsDeleted: true
  },
  job_application: {
    entityType: "job_application",
    table: "job_applications",
    idPrefix: "japp",
    titleColumn: "id",
    ownerColumn: "owner_user_id",
    supportsDeleted: true
  },
  work_outreach: {
    entityType: "work_outreach",
    table: "work_outreach",
    idPrefix: "wout",
    titleColumn: "proposal",
    ownerColumn: "owner_user_id",
    supportsDeleted: false
  }
};

export function rootConfig(entityType: string) {
  const config = WORK_ROOTS[entityType];
  if (!config) {
    throw new HttpError(
      400,
      "work_entity_type_unsupported",
      `Unsupported Work entity type ${entityType}.`
    );
  }
  return config;
}

export function rootScopeSql(
  access: WorkAccess,
  config: WorkRootConfig,
  alias = ""
) {
  const prefix = alias ? `${alias}.` : "";
  return buildRootScopeClause(access, {
    entityType: config.entityType,
    ownerColumn: `${prefix}${config.ownerColumn}`,
    idColumn: `${prefix}id`
  });
}

export function getAuthorizedRoot(
  entityType: string,
  id: string,
  access: WorkAccess,
  options: { includeDeleted?: boolean } = {}
) {
  const config = rootConfig(entityType);
  const scope = rootScopeSql(access, config);
  const row = getDatabase()
    .prepare(
      `SELECT * FROM ${config.table}
       WHERE id = ? AND ${scope.sql}
       ${config.supportsDeleted && !options.includeDeleted ? "AND deleted_at IS NULL" : ""}`
    )
    .get(id, ...scope.values) as SqlRow | undefined;
  if (!row) {
    throw new HttpError(
      404,
      "work_record_not_found",
      "The requested Work record was not found."
    );
  }
  return rowToWorkRecord(row, access);
}

export function registerWorkRoot(
  entityType: string,
  id: string,
  ownerUserId: string,
  access?: WorkAccess,
  scope?: { projectIds: string[]; tagIds: string[] }
) {
  setEntityOwner(entityType, id, ownerUserId);
  if (access && scope) {
    synchronizeWorkScopeLinks({
      sourceEntityType: entityType,
      sourceEntityId: id,
      ownerUserId,
      access,
      scope
    });
  }
}

export function recordWorkActivity(input: {
  entityType: string;
  entityId: string;
  eventType: string;
  title: string;
  description?: string;
  actor: WorkActor;
  metadata?: Record<string, unknown>;
}) {
  const id = newWorkId("actv");
  const createdAt = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO activity_events (
        id, entity_type, entity_id, event_type, title, description,
        actor, source, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.entityType,
      input.entityId,
      input.eventType,
      input.title,
      input.description ?? "",
      input.actor.id,
      input.actor.source,
      JSON.stringify(input.metadata ?? {}),
      createdAt
    );
  return id;
}

export function listWorkActivityHistory(
  entityType: string,
  entityId: string,
  access: WorkAccess,
  limit = 100
) {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const rows = getDatabase()
    .prepare(
      `SELECT id, entity_type, entity_id, event_type, title, description,
              actor, source, metadata_json, created_at
       FROM activity_events
       WHERE entity_type = ? AND entity_id = ?
         AND event_type != 'activity_corrected'
         AND NOT EXISTS (
           SELECT 1 FROM activity_event_corrections
           WHERE activity_event_corrections.corrected_event_id = activity_events.id
         )
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(entityType, entityId, safeLimit) as SqlRow[];
  return rows.map((row) => rowToWorkRecord(row, access));
}

const targetLookup: Record<
  string,
  { table: string; ownerColumn?: string; idColumn?: string }
> = {
  goal: { table: "goals" },
  strategy: { table: "strategies" },
  project: { table: "projects" },
  issue: { table: "tasks" },
  task: { table: "tasks" },
  subtask: { table: "tasks" },
  person: { table: "people", ownerColumn: "user_id" },
  artifact: { table: "artifacts" },
  note: { table: "notes" },
  wiki_page: { table: "notes" },
  calendar_event: { table: "calendar_events" },
  life_event: { table: "life_events" },
  insight: { table: "insights" },
  psyche_value: { table: "psyche_values" },
  sleep_session: { table: "health_sleep_sessions", ownerColumn: "user_id" },
  workout_session: { table: "health_workout_sessions", ownerColumn: "user_id" },
  trigger_report: { table: "trigger_reports" },
  habit: { table: "habits" },
  movement_place: { table: "movement_places", ownerColumn: "user_id" },
  tag: { table: "tags" },
  work_organization: {
    table: "work_organizations",
    ownerColumn: "owner_user_id"
  },
  work_engagement: { table: "work_engagements", ownerColumn: "owner_user_id" },
  work_metric_observation: {
    table: "work_metric_observations",
    ownerColumn: "owner_user_id"
  },
  opportunity_campaign: {
    table: "opportunity_campaigns",
    ownerColumn: "owner_user_id"
  },
  job_opportunity: { table: "job_opportunities", ownerColumn: "owner_user_id" },
  job_application: { table: "job_applications", ownerColumn: "owner_user_id" },
  job_interview: { table: "job_interviews" },
  job_offer: { table: "job_offers" },
  work_outreach: { table: "work_outreach", ownerColumn: "owner_user_id" }
};

function targetOwner(entityType: string, entityId: string): string | null {
  if (entityType === "job_interview" || entityType === "job_offer") {
    const table =
      entityType === "job_interview" ? "job_interviews" : "job_offers";
    const row = getDatabase()
      .prepare(
        `SELECT application.owner_user_id AS owner
         FROM ${table} child
         JOIN job_applications application ON application.id = child.application_id
         WHERE child.id = ? LIMIT 1`
      )
      .get(entityId) as { owner: string } | undefined;
    return row?.owner ?? null;
  }
  const lookup = targetLookup[entityType];
  if (!lookup) return null;
  const ownerColumn = lookup.ownerColumn;
  if (ownerColumn) {
    const row = getDatabase()
      .prepare(
        `SELECT ${ownerColumn} AS owner FROM ${lookup.table} WHERE id = ? LIMIT 1`
      )
      .get(entityId) as { owner: string } | undefined;
    return row?.owner ?? null;
  }
  const canonicalOwnerType =
    (
      { issue: "task", subtask: "task", wiki_page: "note" } as Record<
        string,
        string
      >
    )[entityType] ?? entityType;
  const owner = getDatabase()
    .prepare(
      `SELECT user_id FROM entity_owners WHERE entity_type = ? AND entity_id = ? LIMIT 1`
    )
    .get(canonicalOwnerType, entityId) as { user_id: string } | undefined;
  if (owner) return owner.user_id;
  const exists = getDatabase()
    .prepare(`SELECT 1 AS present FROM ${lookup.table} WHERE id = ? LIMIT 1`)
    .get(entityId) as { present: number } | undefined;
  return exists ? "shared" : null;
}

function validateAuthorizedWorkLink(input: {
  ownerUserId: string;
  access: WorkAccess;
  targetEntityType: string;
  targetEntityId: string;
}) {
  const owner = targetOwner(input.targetEntityType, input.targetEntityId);
  if (!owner) {
    throw new HttpError(
      404,
      "work_link_target_not_found",
      "A requested Work relationship target was not found.",
      {
        entityType: input.targetEntityType,
        entityId: input.targetEntityId
      }
    );
  }
  if (owner !== "shared" && owner !== input.ownerUserId) {
    throw new HttpError(
      403,
      "work_link_owner_mismatch",
      "Work relationships cannot cross Forge owners."
    );
  }
  if (
    input.targetEntityType === "project" &&
    input.access.projectIds.length > 0 &&
    !input.access.projectIds.includes(input.targetEntityId)
  ) {
    throw new HttpError(
      403,
      "work_project_scope_forbidden",
      "The linked Project is outside this credential's scope."
    );
  }
  if (
    input.targetEntityType === "tag" &&
    input.access.tagIds.length > 0 &&
    !input.access.tagIds.includes(input.targetEntityId)
  ) {
    throw new HttpError(
      403,
      "work_tag_scope_forbidden",
      "The linked tag is outside this credential's scope."
    );
  }
}

export const WORK_SCOPE_ANCHOR_KEY = "work_scope";

export function synchronizeWorkScopeLinks(input: {
  sourceEntityType: string;
  sourceEntityId: string;
  ownerUserId: string;
  access: WorkAccess;
  scope: { projectIds: string[]; tagIds: string[] };
}) {
  const targets = [
    ...input.scope.projectIds.map((entityId) => ({
      entityType: "project" as const,
      entityId,
      relationship: "project_context"
    })),
    ...input.scope.tagIds.map((entityId) => ({
      entityType: "tag" as const,
      entityId,
      relationship: "tag_context"
    }))
  ];
  for (const target of targets) {
    validateAuthorizedWorkLink({
      ownerUserId: input.ownerUserId,
      access: input.access,
      targetEntityType: target.entityType,
      targetEntityId: target.entityId
    });
  }
  getDatabase()
    .prepare(
      `DELETE FROM entity_links
       WHERE source_entity_type = ? AND source_entity_id = ?
         AND anchor_key = ? AND target_entity_type IN ('project', 'tag')`
    )
    .run(input.sourceEntityType, input.sourceEntityId, WORK_SCOPE_ANCHOR_KEY);
  const insert = getDatabase().prepare(
    `INSERT OR IGNORE INTO entity_links (
      source_entity_type, source_entity_id, target_entity_type, target_entity_id,
      anchor_key, relationship, created_by_actor, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const createdAt = nowIso();
  for (const target of targets) {
    insert.run(
      input.sourceEntityType,
      input.sourceEntityId,
      target.entityType,
      target.entityId,
      WORK_SCOPE_ANCHOR_KEY,
      target.relationship,
      input.access.actor.id,
      createdAt
    );
  }
}

export function assertAuthorizedWorkReference(input: {
  access: WorkAccess;
  entityType: string;
  entityId: string | null | undefined;
}) {
  if (!input.entityId) return;
  validateAuthorizedWorkLink({
    ownerUserId: input.access.mutationOwnerUserId,
    access: input.access,
    targetEntityType: input.entityType,
    targetEntityId: input.entityId
  });
}

function authorizedWorkEntityOwner(
  entityType: string,
  entityId: string,
  access: WorkAccess
) {
  if (WORK_ROOTS[entityType]) {
    return String(getAuthorizedRoot(entityType, entityId, access).ownerUserId);
  }
  if (entityType === "work_metric_observation") {
    const row = getDatabase()
      .prepare(
        `SELECT engagement_id AS parentId
         FROM work_metric_observations WHERE id = ? LIMIT 1`
      )
      .get(entityId) as { parentId: string } | undefined;
    if (!row) {
      throw new HttpError(
        404,
        "work_record_not_found",
        "The requested Work metric observation was not found."
      );
    }
    return String(
      getAuthorizedRoot("work_engagement", row.parentId, access).ownerUserId
    );
  }
  if (entityType === "job_interview" || entityType === "job_offer") {
    const table =
      entityType === "job_interview" ? "job_interviews" : "job_offers";
    const row = getDatabase()
      .prepare(
        `SELECT application_id AS parentId FROM ${table} WHERE id = ? LIMIT 1`
      )
      .get(entityId) as { parentId: string } | undefined;
    if (!row) {
      throw new HttpError(
        404,
        "work_record_not_found",
        "The requested Work application record was not found."
      );
    }
    return String(
      getAuthorizedRoot("job_application", row.parentId, access).ownerUserId
    );
  }
  throw new HttpError(
    400,
    "work_entity_type_unsupported",
    `Unsupported Work entity type ${entityType}.`
  );
}

export function replaceAuthorizedWorkLinks(input: {
  sourceEntityType: string;
  sourceEntityId: string;
  access: WorkAccess;
  expectedRevision?: number;
  links: Array<{
    targetEntityType: string;
    targetEntityId: string;
    relationship: string;
    anchorKey: string;
  }>;
}) {
  if (input.links.some((link) => link.anchorKey === WORK_SCOPE_ANCHOR_KEY)) {
    throw new HttpError(
      400,
      "work_scope_anchor_reserved",
      "Update Project and tag scope through the Work record, not the generic relationship editor."
    );
  }
  const ownerUserId = authorizedWorkEntityOwner(
    input.sourceEntityType,
    input.sourceEntityId,
    input.access
  );
  for (const link of input.links) {
    validateAuthorizedWorkLink({
      ownerUserId,
      access: input.access,
      targetEntityType: link.targetEntityType,
      targetEntityId: link.targetEntityId
    });
  }
  const revisionTable =
    WORK_ROOTS[input.sourceEntityType]?.table ??
    (input.sourceEntityType === "job_interview"
      ? "job_interviews"
      : input.sourceEntityType === "job_offer"
        ? "job_offers"
        : null);
  if (revisionTable && input.expectedRevision === undefined) {
    throw new HttpError(
      400,
      "work_expected_revision_required",
      "Replacing relationships on this Work record requires expectedRevision."
    );
  }
  if (!revisionTable && input.expectedRevision !== undefined) {
    throw new HttpError(
      400,
      "work_relationship_revision_unsupported",
      "This immutable Work observation does not have a revision counter."
    );
  }
  return runInTransaction(() => {
    if (revisionTable) {
      const result = getDatabase()
        .prepare(
          `UPDATE ${revisionTable}
           SET revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`
        )
        .run(nowIso(), input.sourceEntityId, Number(input.expectedRevision));
      if (Number(result.changes) !== 1) {
        throw new HttpError(
          409,
          "work_revision_conflict",
          "This Work record changed after its relationships were opened."
        );
      }
    }
    const preservedScopeLinks = listEntityLinksForEntity(
      input.sourceEntityType,
      input.sourceEntityId
    ).filter(
      (link) =>
        link.sourceEntityType === input.sourceEntityType &&
        link.sourceEntityId === input.sourceEntityId &&
        link.anchorKey === WORK_SCOPE_ANCHOR_KEY
    );
    replaceEntityLinksForSource({
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      links: [
        ...preservedScopeLinks.map((link) => ({
          entityType: link.targetEntityType,
          entityId: link.targetEntityId,
          relationship: link.relationship,
          anchorKey: link.anchorKey
        })),
        ...input.links.map((link) => ({
          entityType: link.targetEntityType,
          entityId: link.targetEntityId,
          relationship: link.relationship,
          anchorKey: link.anchorKey
        }))
      ],
      actor: input.access.actor.id
    });
    recordWorkActivity({
      entityType: input.sourceEntityType,
      entityId: input.sourceEntityId,
      eventType: "work_relationships_replaced",
      title: "Work relationships updated",
      actor: input.access.actor,
      metadata: { relationshipCount: input.links.length }
    });
    return listAuthorizedWorkLinks(
      input.sourceEntityType,
      input.sourceEntityId,
      input.access
    );
  });
}

export function appendAuthorizedWorkLinks(input: {
  sourceEntityType: string;
  sourceEntityId: string;
  access: WorkAccess;
  links: Array<{
    targetEntityType: string;
    targetEntityId: string;
    relationship: string;
    anchorKey: string;
  }>;
}) {
  const ownerUserId = authorizedWorkEntityOwner(
    input.sourceEntityType,
    input.sourceEntityId,
    input.access
  );
  const insert = getDatabase().prepare(
    `INSERT OR IGNORE INTO entity_links (
      source_entity_type, source_entity_id, target_entity_type, target_entity_id,
      anchor_key, relationship, created_by_actor, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const created: Array<Record<string, unknown>> = [];
  for (const link of input.links) {
    validateAuthorizedWorkLink({
      ownerUserId,
      access: input.access,
      targetEntityType: link.targetEntityType,
      targetEntityId: link.targetEntityId
    });
    if (
      input.sourceEntityType === link.targetEntityType &&
      input.sourceEntityId === link.targetEntityId
    ) {
      throw new HttpError(
        400,
        "entity_link_self_reference",
        "A Forge record cannot link to itself."
      );
    }
    const createdAt = nowIso();
    const result = insert.run(
      input.sourceEntityType,
      input.sourceEntityId,
      link.targetEntityType,
      link.targetEntityId,
      link.anchorKey,
      link.relationship,
      input.access.actor.id,
      createdAt
    );
    if (Number(result.changes) === 1) {
      created.push({
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        targetEntityType: link.targetEntityType,
        targetEntityId: link.targetEntityId,
        anchorKey: link.anchorKey,
        relationship: link.relationship,
        createdByActor: input.access.actor.id,
        createdAt
      });
    }
  }
  return {
    created,
    links: listAuthorizedWorkLinks(
      input.sourceEntityType,
      input.sourceEntityId,
      input.access
    )
  };
}

export function listAuthorizedWorkLinks(
  entityType: string,
  entityId: string,
  access: WorkAccess
): EntityLinkRecord[] {
  const ownerUserId = authorizedWorkEntityOwner(entityType, entityId, access);
  return listEntityLinksForEntity(entityType, entityId).filter((link) => {
    const otherType =
      link.sourceEntityType === entityType && link.sourceEntityId === entityId
        ? link.targetEntityType
        : link.sourceEntityType;
    const otherId =
      link.sourceEntityType === entityType && link.sourceEntityId === entityId
        ? link.targetEntityId
        : link.sourceEntityId;
    const owner = targetOwner(otherType, otherId);
    if (owner !== "shared" && owner !== ownerUserId) return false;
    if (
      otherType === "project" &&
      access.projectIds.length > 0 &&
      !access.projectIds.includes(otherId)
    )
      return false;
    if (
      otherType === "tag" &&
      access.tagIds.length > 0 &&
      !access.tagIds.includes(otherId)
    )
      return false;
    return true;
  });
}

function humanReadableWorkSummaryValue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  const words = value.trim().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function summarizeAuthorizedWorkLinks(
  entityType: string,
  entityId: string,
  access: WorkAccess,
  limit = 100
) {
  return listAuthorizedWorkLinks(entityType, entityId, access)
    .slice(0, Math.min(Math.max(limit, 1), 100))
    .flatMap((link) => {
      const outbound =
        link.sourceEntityType === entityType &&
        link.sourceEntityId === entityId;
      const relatedEntityType = outbound
        ? link.targetEntityType
        : link.sourceEntityType;
      const relatedEntityId = outbound
        ? link.targetEntityId
        : link.sourceEntityId;
      const lookup = targetLookup[relatedEntityType];
      if (!lookup) return [];
      const row = getDatabase()
        .prepare(
          `SELECT * FROM ${lookup.table} WHERE ${lookup.idColumn ?? "id"} = ? LIMIT 1`
        )
        .get(relatedEntityId) as SqlRow | undefined;
      if (!row) return [];
      const record = rowToWorkRecord(row, access);
      if (record.deletedAt) return [];
      const explicitTitle = [
        record.title,
        record.name,
        record.displayName,
        record.label,
        record.roleFunction,
        record.proposal,
        record.exactQuestion
      ].find((value) => typeof value === "string" && value.trim());
      const codedTitle = [
        record.stage,
        record.eventType,
        record.status,
        record.canonicalKey
      ].find((value) => typeof value === "string" && value.trim());
      const title =
        explicitTitle ??
        (humanReadableWorkSummaryValue(codedTitle) ||
          humanReadableWorkSummaryValue(relatedEntityType) ||
          "Related record");
      const detail = [
        record.description,
        record.domain,
        record.roleFunction,
        record.status
      ].find((value) => typeof value === "string" && value.trim());
      return [
        {
          entityType: relatedEntityType,
          entityId: relatedEntityId,
          relationship: link.relationship,
          anchorKey: link.anchorKey,
          direction: outbound ? "outbound" : "inbound",
          title,
          detail: detail ?? ""
        }
      ];
    });
}

export function getOperationReceipt(input: {
  ownerUserId: string;
  operationKind: string;
  idempotencyKey: string;
  requestFingerprint: string;
  access?: WorkAccess;
}) {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM work_operation_receipts
       WHERE owner_user_id = ? AND operation_kind = ? AND idempotency_key = ?`
    )
    .get(input.ownerUserId, input.operationKind, input.idempotencyKey) as
    | SqlRow
    | undefined;
  if (!row) return null;
  if (row.request_fingerprint !== input.requestFingerprint) {
    throw new HttpError(
      409,
      "work_idempotency_conflict",
      "This idempotency key was already used for a different Work operation."
    );
  }
  return rowToWorkRecord(row, input.access);
}

export function storeOperationReceipt(input: {
  id?: string;
  ownerUserId: string;
  operationKind: string;
  idempotencyKey: string;
  requestFingerprint: string;
  responseStatus?: number;
  response: unknown;
  createdRecords?: unknown[];
  rollbackClassification?: Record<string, unknown>;
  dependencyFingerprint?: string;
}) {
  const id = input.id ?? newWorkId("wrec");
  const createdAt = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO work_operation_receipts (
        id, owner_user_id, operation_kind, idempotency_key, request_fingerprint,
        response_status, response_json, created_records_json, rollback_classification_json,
        dependency_fingerprint, status, rollback_tombstone_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', '{}', ?, ?)`
    )
    .run(
      id,
      input.ownerUserId,
      input.operationKind,
      input.idempotencyKey,
      input.requestFingerprint,
      input.responseStatus ?? 200,
      JSON.stringify(input.response),
      JSON.stringify(input.createdRecords ?? []),
      JSON.stringify(input.rollbackClassification ?? {}),
      input.dependencyFingerprint ?? "",
      createdAt,
      createdAt
    );
  return rowToWorkRecord(
    getDatabase()
      .prepare("SELECT * FROM work_operation_receipts WHERE id = ?")
      .get(id) as SqlRow
  );
}
