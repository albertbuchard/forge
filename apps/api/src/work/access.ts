import type { AuthContext } from "../managers/contracts.js";
import { getDatabase } from "../db.js";
import { HttpError } from "../errors.js";
import { getDefaultUser, listUsers } from "../repositories/users.js";
import type { WorkActor } from "./types.js";

export type WorkAccess = {
  ownerUserIds: string[];
  mutationOwnerUserId: string;
  projectIds: string[];
  tagIds: string[];
  operator: boolean;
  canCompensation: boolean;
  canPrivateApplication: boolean;
  canTransmit: boolean;
  principal: {
    agentId: string | null;
    tokenId: string | null;
    clientIdentity: string;
  };
  actor: WorkActor;
};

function parseRequestedUserIds(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return Array.from(
    new Set(
      values.flatMap((entry) =>
        typeof entry === "string" && entry.trim() ? [entry.trim()] : []
      )
    )
  );
}

function hasScope(auth: AuthContext, scope: string) {
  return Boolean(
    auth.session ||
    auth.token?.scopes.includes("*") ||
    auth.token?.scopes.includes(scope)
  );
}

export function resolveWorkAccess(
  auth: AuthContext,
  query: Record<string, unknown> = {},
  options: { mutation?: boolean } = {}
): WorkAccess {
  const knownUsers = new Set(listUsers().map((user) => user.id));
  const requested = parseRequestedUserIds(query.userIds ?? query.userId);
  const tokenOwners = auth.token?.scopePolicy.userIds ?? [];
  const defaultOwner = getDefaultUser().id;
  const ownerUserIds =
    tokenOwners.length > 0
      ? requested.length > 0
        ? requested.filter((id) => tokenOwners.includes(id))
        : [...tokenOwners]
      : requested.length > 0
        ? requested
        : [defaultOwner];

  if (requested.length > 0 && ownerUserIds.length === 0) {
    throw new HttpError(
      403,
      "work_user_scope_forbidden",
      "The requested Work user is outside this credential's allowed user scope."
    );
  }
  const validOwners = ownerUserIds.filter((id) => knownUsers.has(id));
  if (validOwners.length !== ownerUserIds.length) {
    throw new HttpError(
      404,
      "work_user_not_found",
      "One or more selected Forge users do not exist."
    );
  }
  if (options.mutation && validOwners.length !== 1) {
    throw new HttpError(
      400,
      "work_user_selection_required",
      "A Work mutation requires exactly one selected Forge user."
    );
  }

  const operator = Boolean(auth.session);
  const actorId =
    auth.token?.agentId ?? auth.actor ?? validOwners[0] ?? defaultOwner;
  const actorKind: WorkActor["kind"] = auth.token?.agentId
    ? "agent"
    : operator
      ? "human_user"
      : "system";
  return {
    ownerUserIds: validOwners,
    mutationOwnerUserId: validOwners[0] ?? defaultOwner,
    projectIds: auth.token?.scopePolicy.projectIds ?? [],
    tagIds: auth.token?.scopePolicy.tagIds ?? [],
    operator,
    canCompensation: operator || hasScope(auth, "work.compensation.read"),
    canPrivateApplication: operator || hasScope(auth, "work.transmit"),
    canTransmit: operator || hasScope(auth, "work.transmit"),
    principal: {
      agentId: auth.token?.agentId ?? null,
      tokenId: auth.token?.id ?? null,
      clientIdentity: auth.session?.id ?? auth.token?.id ?? "local-operator"
    },
    actor: {
      kind: actorKind,
      id: String(actorId),
      label:
        auth.token?.agentLabel ??
        auth.session?.actorLabel ??
        auth.actor ??
        "Forge",
      source: auth.source
    }
  };
}

export function buildRootScopeClause(
  access: WorkAccess,
  input: {
    entityType: string;
    ownerColumn?: string;
    idColumn?: string;
  }
): { sql: string; values: string[] } {
  const ownerColumn = input.ownerColumn ?? "owner_user_id";
  const idColumn = input.idColumn ?? "id";
  if (access.ownerUserIds.length === 0) return { sql: "0 = 1", values: [] };
  const values: string[] = [...access.ownerUserIds];
  const clauses = [
    `${ownerColumn} IN (${access.ownerUserIds.map(() => "?").join(", ")})`
  ];
  if (access.projectIds.length > 0) {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM entity_links work_project_scope
        WHERE work_project_scope.source_entity_type = ?
          AND work_project_scope.source_entity_id = ${idColumn}
          AND work_project_scope.target_entity_type = 'project'
          AND work_project_scope.target_entity_id IN (${access.projectIds.map(() => "?").join(", ")})
      )`
    );
    values.push(input.entityType, ...access.projectIds);
  }
  if (access.tagIds.length > 0) {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM entity_links work_tag_scope
        WHERE work_tag_scope.source_entity_type = ?
          AND work_tag_scope.source_entity_id = ${idColumn}
          AND work_tag_scope.target_entity_type = 'tag'
          AND work_tag_scope.target_entity_id IN (${access.tagIds.map(() => "?").join(", ")})
      )`
    );
    values.push(input.entityType, ...access.tagIds);
  }
  return { sql: clauses.join(" AND "), values };
}

function assertScopeTargetExists(
  access: WorkAccess,
  entityType: "project" | "tag",
  entityId: string
) {
  const table = entityType === "project" ? "projects" : "tags";
  const exists = getDatabase()
    .prepare(`SELECT 1 AS present FROM ${table} WHERE id = ? LIMIT 1`)
    .get(entityId) as { present: number } | undefined;
  if (!exists) {
    throw new HttpError(
      404,
      "work_scope_target_not_found",
      `The selected ${entityType === "project" ? "Project" : "tag"} does not exist.`
    );
  }
  const owner = getDatabase()
    .prepare(
      `SELECT user_id FROM entity_owners
       WHERE entity_type = ? AND entity_id = ? LIMIT 1`
    )
    .get(entityType, entityId) as { user_id: string } | undefined;
  if (owner && owner.user_id !== access.mutationOwnerUserId) {
    throw new HttpError(
      403,
      "work_scope_owner_mismatch",
      "A Work scope cannot reference another Forge owner's record."
    );
  }
}

export function assertScopeAssignment(
  access: WorkAccess,
  scope: { projectIds: string[]; tagIds: string[] }
) {
  if (
    access.projectIds.length > 0 &&
    !scope.projectIds.some((id) => access.projectIds.includes(id))
  ) {
    throw new HttpError(
      403,
      "work_project_scope_forbidden",
      "This credential requires at least one directly linked allowed Project."
    );
  }
  if (
    access.tagIds.length > 0 &&
    !scope.tagIds.some((id) => access.tagIds.includes(id))
  ) {
    throw new HttpError(
      403,
      "work_tag_scope_forbidden",
      "This credential requires at least one directly linked allowed tag."
    );
  }
  for (const projectId of scope.projectIds) {
    if (
      access.projectIds.length > 0 &&
      !access.projectIds.includes(projectId)
    ) {
      throw new HttpError(
        403,
        "work_project_scope_forbidden",
        "The Work record cannot be linked to a Project outside this credential's scope."
      );
    }
    assertScopeTargetExists(access, "project", projectId);
  }
  for (const tagId of scope.tagIds) {
    if (access.tagIds.length > 0 && !access.tagIds.includes(tagId)) {
      throw new HttpError(
        403,
        "work_tag_scope_forbidden",
        "The Work record cannot be linked to a tag outside this credential's scope."
      );
    }
    assertScopeTargetExists(access, "tag", tagId);
  }
}

const privateApplicationFields = new Set([
  "accountReference",
  "applicationRoute",
  "privateContacts",
  "representations",
  "unresolvedUserFacts",
  "employerReason",
  "inferredExplanation",
  "lessons",
  "exactQuestion",
  "approvedAnswer",
  "answer",
  "privateLocationOrLink",
  "artifactVersions",
  "contentSha256",
  "confirmationReceipt",
  "trackingIdentifier",
  "reapplicationReason",
  "reapplicationReviewedAt",
  "authorizationIdentity",
  "authorizedPrincipal",
  "completionEvidence",
  "destination",
  "fields",
  "answers",
  "unresolvedGates",
  "guardContext",
  "previewDigest",
  "requestingAgentId",
  "requestingTokenId",
  "requestingClientIdentity",
  "approvalRequestId",
  "agentActionId",
  "legalAnswerGates"
]);

const compensationFields = new Set([
  "compensation",
  "compensationGates",
  "benefits",
  "privateCompensation",
  "salaryExpectation",
  "baseSalary",
  "totalCompensation",
  "hourlyRate",
  "dailyRate",
  "bonus",
  "commission",
  "equity",
  "pension"
]);

function nestedFieldName(record: Record<string, unknown>) {
  return [record.field, record.key, record.section, record.category].find(
    (value) => typeof value === "string"
  ) as string | undefined;
}

function fieldMatchesSensitiveSet(
  field: string | undefined,
  sensitive: Set<string>
) {
  if (!field) return false;
  const normalized = field.replaceAll(/[^a-z0-9]/giu, "").toLowerCase();
  return [...sensitive].some((candidate) => {
    const normalizedCandidate = candidate.toLowerCase();
    return (
      normalized === normalizedCandidate ||
      normalized.startsWith(normalizedCandidate)
    );
  });
}

function redactedNestedField(record: Record<string, unknown>) {
  return {
    ...(typeof record.field === "string" ? { field: record.field } : {}),
    ...(typeof record.key === "string" ? { key: record.key } : {}),
    ...(typeof record.section === "string" ? { section: record.section } : {}),
    ...(typeof record.category === "string"
      ? { category: record.category }
      : {}),
    redacted: true
  };
}

function projectNestedValue(value: unknown, access: WorkAccess): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => projectNestedValue(entry, access));
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const field = nestedFieldName(record);
  if (
    !access.canCompensation &&
    fieldMatchesSensitiveSet(field, compensationFields)
  ) {
    return redactedNestedField(record);
  }
  if (
    !access.canPrivateApplication &&
    fieldMatchesSensitiveSet(field, privateApplicationFields)
  ) {
    return redactedNestedField(record);
  }
  const projected: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (!access.canCompensation && compensationFields.has(key)) continue;
    if (!access.canPrivateApplication && privateApplicationFields.has(key))
      continue;
    projected[key] = projectNestedValue(entry, access);
  }
  return projected;
}

export function projectWorkRecord(
  value: Record<string, unknown>,
  access: WorkAccess
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!access.canCompensation && compensationFields.has(key)) continue;
    if (!access.canPrivateApplication && privateApplicationFields.has(key))
      continue;
    projected[key] = projectNestedValue(entry, access);
  }
  return projected;
}
