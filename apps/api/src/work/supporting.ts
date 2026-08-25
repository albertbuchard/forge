import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import type { WorkAccess } from "./access.js";
import { assertScopeAssignment, buildRootScopeClause } from "./access.js";
import { hasMaterialValue } from "./repository-write-helpers.js";
import {
  assertAuthorizedWorkReference,
  appendAuthorizedWorkLinks,
  getAuthorizedRoot,
  listAuthorizedWorkLinks,
  newWorkId,
  nowIso,
  recordWorkActivity,
  registerWorkRoot,
  rootConfig,
  rowToWorkRecord,
  type SqlRow
} from "./repository-helpers.js";
import {
  recordOfferRevision,
  recordSupportingRevision
} from "./supporting-revisions.js";

type SupportingConfig = {
  table: string;
  prefix: string;
  parentField?: string;
  parentEntityType?: "opportunity_campaign" | "job_application";
  ownerField?: string;
  revisioned: boolean;
  privateProjection?: boolean;
};

export const supportingConfigs: Record<string, SupportingConfig> = {
  roleTarget: {
    table: "campaign_role_targets",
    prefix: "crt",
    parentField: "campaign_id",
    parentEntityType: "opportunity_campaign",
    revisioned: true
  },
  organizationTarget: {
    table: "campaign_organization_targets",
    prefix: "cot",
    parentField: "campaign_id",
    parentEntityType: "opportunity_campaign",
    revisioned: true
  },
  positioningProfile: {
    table: "candidate_positioning_profiles",
    prefix: "cprof",
    ownerField: "owner_user_id",
    revisioned: true
  },
  documentSet: {
    table: "candidate_document_sets",
    prefix: "cdoc",
    ownerField: "owner_user_id",
    revisioned: true,
    privateProjection: true
  },
  reusableResponse: {
    table: "application_response_templates",
    prefix: "aresp",
    ownerField: "owner_user_id",
    revisioned: true,
    privateProjection: true
  },
  applicationQuestion: {
    table: "application_questions",
    prefix: "aques",
    parentField: "application_id",
    parentEntityType: "job_application",
    revisioned: true,
    privateProjection: true
  },
  artifactUse: {
    table: "application_artifact_uses",
    prefix: "ause",
    parentField: "application_id",
    parentEntityType: "job_application",
    revisioned: false,
    privateProjection: true
  },
  interview: {
    table: "job_interviews",
    prefix: "jint",
    parentField: "application_id",
    parentEntityType: "job_application",
    revisioned: true,
    privateProjection: true
  },
  offer: {
    table: "job_offers",
    prefix: "joff",
    parentField: "application_id",
    parentEntityType: "job_application",
    revisioned: true,
    privateProjection: true
  },
  searchSource: {
    table: "job_search_sources",
    prefix: "jss",
    parentField: "campaign_id",
    parentEntityType: "opportunity_campaign",
    revisioned: true
  },
  savedQuery: {
    table: "job_saved_queries",
    prefix: "jsq",
    parentField: "campaign_id",
    parentEntityType: "opportunity_campaign",
    revisioned: true
  },
  automationPolicy: {
    table: "job_automation_policies",
    prefix: "japol",
    parentField: "campaign_id",
    parentEntityType: "opportunity_campaign",
    revisioned: true
  },
  outreach: {
    table: "work_outreach",
    prefix: "wout",
    ownerField: "owner_user_id",
    revisioned: true
  }
};

function snake(value: string) {
  return value.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
}

function tableColumns(table: string) {
  return new Set(
    (
      getDatabase()
        .prepare(`SELECT name FROM pragma_table_info(?)`)
        .all(table) as Array<{ name: string }>
    ).map((row) => row.name)
  );
}

function encodeValue(value: unknown) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value) || (value && typeof value === "object"))
    return JSON.stringify(value);
  return value;
}

function normalizedData(
  config: SupportingConfig,
  data: Record<string, unknown>
) {
  const columns = tableColumns(config.table);
  const forbidden = new Set([
    "id",
    "owner_user_id",
    "created_at",
    "updated_at",
    "revision",
    "deleted_at",
    "import_receipt_id",
    config.parentField ?? ""
  ]);
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const base = snake(key);
    const candidate = columns.has(base)
      ? base
      : columns.has(`${base}_json`)
        ? `${base}_json`
        : base;
    if (!columns.has(candidate) || forbidden.has(candidate)) {
      throw new HttpError(
        400,
        "work_supporting_field_invalid",
        `Field ${key} is not valid for ${config.table}.`
      );
    }
    normalized[candidate] = candidate.endsWith("_json")
      ? JSON.stringify(value ?? {})
      : encodeValue(value);
  }
  return normalized;
}

function assertParent(
  config: SupportingConfig,
  parentId: string | undefined,
  access: WorkAccess
) {
  if (!config.parentField || !config.parentEntityType) return;
  if (!parentId)
    throw new HttpError(
      400,
      "work_parent_required",
      "This Work record requires its parent identifier."
    );
  getAuthorizedRoot(config.parentEntityType, parentId, access);
}

function assertOwnedRow(
  config: SupportingConfig,
  id: string,
  access: WorkAccess
): SqlRow {
  let row: SqlRow | undefined;
  if (config.ownerField) {
    const columns = tableColumns(config.table);
    const scope =
      columns.has("scope_project_ids_json") && columns.has("scope_tag_ids_json")
        ? buildRootScopeClause(access, config.ownerField)
        : null;
    row = getDatabase()
      .prepare(
        `SELECT * FROM ${config.table}
         WHERE id = ? AND ${
           scope?.sql ??
           `${config.ownerField} IN (${access.ownerUserIds.map(() => "?").join(", ")})`
         }`
      )
      .get(id, ...(scope?.values ?? access.ownerUserIds)) as SqlRow | undefined;
  } else if (config.parentField && config.parentEntityType) {
    row = getDatabase()
      .prepare(`SELECT * FROM ${config.table} WHERE id = ?`)
      .get(id) as SqlRow | undefined;
    if (row)
      getAuthorizedRoot(
        config.parentEntityType,
        String(row[config.parentField]),
        access
      );
  }
  if (!row)
    throw new HttpError(
      404,
      "work_supporting_record_not_found",
      "The requested Work record was not found."
    );
  return row;
}

function assertOwnedSupportingReference(
  table: string,
  id: unknown,
  access: WorkAccess
) {
  if (id === null || id === undefined || id === "") return;
  if (typeof id !== "string") {
    throw new HttpError(
      400,
      "work_supporting_reference_invalid",
      "A Work supporting reference must be a stable string identifier."
    );
  }
  const columns = tableColumns(table);
  const scoped =
    columns.has("scope_project_ids_json") && columns.has("scope_tag_ids_json");
  const scope = scoped ? buildRootScopeClause(access) : null;
  const row = getDatabase()
    .prepare(
      `SELECT owner_user_id FROM ${table}
       WHERE id = ? AND ${scope?.sql ?? "owner_user_id = ?"} LIMIT 1`
    )
    .get(id, ...(scope?.values ?? [access.mutationOwnerUserId])) as
    | { owner_user_id: string }
    | undefined;
  if (!row || row.owner_user_id !== access.mutationOwnerUserId) {
    throw new HttpError(
      404,
      "work_supporting_reference_not_found",
      "A referenced Work profile or document set was not found for this owner."
    );
  }
}

function assertCampaignChildReference(
  table: string,
  id: unknown,
  campaignId: string
) {
  if (id === null || id === undefined || id === "") return;
  if (typeof id !== "string") {
    throw new HttpError(
      400,
      "work_supporting_reference_invalid",
      "A campaign supporting reference must be a stable string identifier."
    );
  }
  const row = getDatabase()
    .prepare(`SELECT campaign_id FROM ${table} WHERE id = ? LIMIT 1`)
    .get(id) as { campaign_id: string } | undefined;
  if (!row || row.campaign_id !== campaignId) {
    throw new HttpError(
      409,
      "work_supporting_campaign_mismatch",
      "A referenced source or criteria version belongs to another Opportunity Campaign."
    );
  }
}

function assertApplicationArtifactUse(
  data: Record<string, unknown>,
  access: WorkAccess
) {
  if (!data.artifactId) return;
  assertAuthorizedWorkReference({
    access,
    entityType: "artifact",
    entityId: String(data.artifactId)
  });
  const versionId =
    typeof data.artifactVersionId === "string" && data.artifactVersionId
      ? data.artifactVersionId
      : null;
  const expectedSha = String(data.contentSha256 ?? "");
  const row = versionId
    ? (getDatabase()
        .prepare(
          `SELECT artifact_id, content_sha256 FROM artifact_versions
           WHERE id = ? AND artifact_id = ? LIMIT 1`
        )
        .get(versionId, String(data.artifactId)) as
        | { artifact_id: string; content_sha256: string }
        | undefined)
    : (getDatabase()
        .prepare(
          "SELECT id AS artifact_id, content_sha256 FROM artifacts WHERE id = ?"
        )
        .get(String(data.artifactId)) as
        | { artifact_id: string; content_sha256: string }
        | undefined);
  if (!row || row.content_sha256 !== expectedSha) {
    throw new HttpError(
      409,
      "work_application_artifact_integrity",
      "The selected Artifact version does not match its declared checksum."
    );
  }
}

function assertSupportingScope(
  access: WorkAccess,
  data: Record<string, unknown>
) {
  assertScopeAssignment(access, {
    projectIds: Array.isArray(data.scopeProjectIds)
      ? data.scopeProjectIds.map(String)
      : [],
    tagIds: Array.isArray(data.scopeTagIds) ? data.scopeTagIds.map(String) : []
  });
}

function assertEvidenceLinks(access: WorkAccess, value: unknown) {
  for (const link of Array.isArray(value) ? value : []) {
    if (!link || typeof link !== "object") continue;
    const evidence = link as Record<string, unknown>;
    assertAuthorizedWorkReference({
      access,
      entityType: String(evidence.entityType ?? ""),
      entityId: typeof evidence.entityId === "string" ? evidence.entityId : null
    });
  }
}

function validatePositioningProfileReferences(
  access: WorkAccess,
  data: Record<string, unknown>
) {
  assertSupportingScope(access, data);
  assertAuthorizedWorkReference({
    access,
    entityType: "artifact",
    entityId:
      typeof data.preferredDefaultArtifactId === "string"
        ? data.preferredDefaultArtifactId
        : null
  });
  const claims = [
    ...(Array.isArray(data.evidenceClaims) ? data.evidenceClaims : []),
    ...(Array.isArray(data.accomplishments) ? data.accomplishments : [])
  ];
  for (const claim of claims) {
    if (claim && typeof claim === "object") {
      assertEvidenceLinks(
        access,
        (claim as { evidenceLinks?: unknown }).evidenceLinks
      );
    }
  }
}

function validateDocumentSetReferences(
  access: WorkAccess,
  data: Record<string, unknown>
) {
  assertSupportingScope(access, data);
  assertOwnedSupportingReference(
    "candidate_positioning_profiles",
    data.profileId,
    access
  );
  for (const artifact of Array.isArray(data.artifactVersions)
    ? data.artifactVersions
    : []) {
    if (artifact && typeof artifact === "object") {
      assertApplicationArtifactUse(artifact as Record<string, unknown>, access);
    }
  }
}

function validateSearchPolicyReferences(input: {
  kind: string;
  parentId?: string;
  data: Record<string, unknown>;
  access: WorkAccess;
}) {
  const { kind, parentId, data, access } = input;
  if ((kind === "savedQuery" || kind === "automationPolicy") && parentId) {
    assertCampaignChildReference(
      "campaign_criteria_versions",
      data.criteriaVersionId,
      parentId
    );
  }
  if (kind === "savedQuery" && parentId) {
    assertCampaignChildReference("job_search_sources", data.sourceId, parentId);
  }
  if (kind === "automationPolicy") {
    assertOwnedSupportingReference(
      "candidate_positioning_profiles",
      data.defaultProfileId,
      access
    );
    assertOwnedSupportingReference(
      "candidate_document_sets",
      data.defaultDocumentSetId,
      access
    );
    if (hasMaterialValue(data.compensationGates) && !access.canCompensation) {
      throw new HttpError(
        403,
        "work_compensation_scope_required",
        "Writing compensation automation gates requires Work compensation authority."
      );
    }
    if (
      hasMaterialValue(data.legalAnswerGates) &&
      !access.canPrivateApplication
    ) {
      throw new HttpError(
        403,
        "work_private_application_scope_required",
        "Writing legal-answer automation gates requires private application authority."
      );
    }
  }
}

function validateOfferReferences(input: {
  parentId?: string;
  data: Record<string, unknown>;
  access: WorkAccess;
}) {
  const { parentId, data, access } = input;
  if (parentId && data.criteriaVersionId) {
    const application = getAuthorizedRoot("job_application", parentId, access);
    assertCampaignChildReference(
      "campaign_criteria_versions",
      data.criteriaVersionId,
      String(application.primaryCampaignId)
    );
  }
  if (hasMaterialValue(data.privateCompensation) && !access.canCompensation) {
    throw new HttpError(
      403,
      "work_compensation_scope_required",
      "Writing private offer compensation requires Work compensation authority."
    );
  }
  assertAuthorizedWorkReference({
    access,
    entityType: "work_engagement",
    entityId:
      typeof data.plannedEngagementId === "string"
        ? data.plannedEngagementId
        : null
  });
  for (const artifactId of Array.isArray(data.artifactIds)
    ? data.artifactIds
    : []) {
    assertAuthorizedWorkReference({
      access,
      entityType: "artifact",
      entityId: typeof artifactId === "string" ? artifactId : null
    });
  }
}

function assertGenericOfferMutationBoundary(input: {
  kind: string;
  data: Record<string, unknown>;
  current?: Record<string, unknown>;
}) {
  if (input.kind !== "offer") return;
  const currentStatus = String(input.current?.status ?? "");
  const nextStatus = String(input.data.status ?? (currentStatus || "received"));
  const currentEngagementId = input.current?.plannedEngagementId ?? null;
  const nextEngagementId = Object.prototype.hasOwnProperty.call(
    input.data,
    "plannedEngagementId"
  )
    ? input.data.plannedEngagementId
    : currentEngagementId;
  if (nextStatus === "accepted" && currentStatus !== "accepted") {
    throw new HttpError(
      409,
      "work_offer_acceptance_route_required",
      "Use the dedicated accepted-offer action so Forge creates and links the planned Work Engagement atomically."
    );
  }
  if (currentStatus === "accepted" && nextStatus !== "accepted") {
    throw new HttpError(
      409,
      "work_offer_acceptance_immutable",
      "An accepted offer cannot be moved back through the generic editor; record a correction without breaking its planned Work Engagement."
    );
  }
  if (String(nextEngagementId ?? "") !== String(currentEngagementId ?? "")) {
    throw new HttpError(
      409,
      "work_offer_engagement_link_immutable",
      "The planned Work Engagement link is managed only by the dedicated accepted-offer action."
    );
  }
}

function validateOutreachReferences(
  access: WorkAccess,
  data: Record<string, unknown>
) {
  assertSupportingScope(access, data);
  for (const [entityType, key] of [
    ["opportunity_campaign", "campaignId"],
    ["work_organization", "organizationId"],
    ["person", "personId"],
    ["artifact", "messageArtifactId"]
  ] as const) {
    assertAuthorizedWorkReference({
      access,
      entityType,
      entityId: typeof data[key] === "string" ? data[key] : null
    });
  }
  if (
    ["sent", "replied", "follow_up", "closed"].includes(
      String(data.status ?? "")
    ) &&
    !data.sentAt
  ) {
    throw new HttpError(
      409,
      "work_outreach_sent_time_required",
      "Sent or post-send outreach requires its factual sent time."
    );
  }
}

function validateSupportingReferences(input: {
  kind: string;
  data: Record<string, unknown>;
  parentId?: string;
  access: WorkAccess;
}) {
  const { kind, data, parentId, access } = input;
  if (kind === "organizationTarget") {
    assertAuthorizedWorkReference({
      access,
      entityType: "work_organization",
      entityId:
        typeof data.organizationId === "string" ? data.organizationId : null
    });
  }
  if (kind === "positioningProfile")
    validatePositioningProfileReferences(access, data);
  if (kind === "documentSet") validateDocumentSetReferences(access, data);
  if (kind === "reusableResponse") assertSupportingScope(access, data);
  if (kind === "reusableResponse" || kind === "applicationQuestion")
    assertEvidenceLinks(access, data.evidenceLinks);
  if (kind === "applicationQuestion")
    assertOwnedSupportingReference(
      "application_response_templates",
      data.reusableResponseId,
      access
    );
  if (kind === "artifactUse") assertApplicationArtifactUse(data, access);
  if (kind === "interview") {
    assertAuthorizedWorkReference({
      access,
      entityType: "artifact",
      entityId:
        typeof data.preparationArtifactId === "string"
          ? data.preparationArtifactId
          : null
    });
    for (const participant of Array.isArray(data.participantLinks)
      ? data.participantLinks
      : []) {
      if (!participant || typeof participant !== "object") continue;
      const personId = (participant as Record<string, unknown>).personId;
      if (typeof personId !== "string" || !personId.trim()) {
        throw new HttpError(
          400,
          "work_interview_participant_person_required",
          "Each interview participant must link to an existing Forge Person."
        );
      }
      assertAuthorizedWorkReference({
        access,
        entityType: "person",
        entityId: personId
      });
    }
  }
  validateSearchPolicyReferences({ kind, parentId, data, access });
  if (kind === "offer") validateOfferReferences({ parentId, data, access });
  if (kind === "outreach") validateOutreachReferences(access, data);
}

export function getSupportingRecord(input: {
  kind: string;
  id: string;
  access: WorkAccess;
}) {
  const config = supportingConfigs[input.kind];
  if (!config) {
    throw new HttpError(
      400,
      "work_supporting_kind_invalid",
      "Unsupported Work supporting record kind."
    );
  }
  if (config.privateProjection && !input.access.canPrivateApplication) {
    throw new HttpError(
      403,
      "work_private_application_scope_required",
      "This operation requires private application authority."
    );
  }
  const current = rowToWorkRecord(
    assertOwnedRow(config, input.id, input.access),
    input.access
  );
  const linkEntityType =
    input.kind === "interview"
      ? "job_interview"
      : input.kind === "offer"
        ? "job_offer"
        : input.kind === "outreach"
          ? "work_outreach"
          : null;
  const linkedCurrent = linkEntityType
    ? {
        ...current,
        links: listAuthorizedWorkLinks(linkEntityType, input.id, input.access)
      }
    : current;
  if (!config.revisioned) return linkedCurrent;
  const snapshots = getDatabase()
    .prepare(
      `SELECT version, data_json, actor_json, provenance_json, created_at
       FROM work_supporting_revisions
       WHERE record_kind = ? AND record_id = ?
       ORDER BY version DESC LIMIT 100`
    )
    .all(input.kind, input.id) as SqlRow[];
  const revisionHistory = snapshots.map((snapshot) => {
    const raw = JSON.parse(String(snapshot.data_json)) as SqlRow;
    return {
      version: Number(snapshot.version),
      record: rowToWorkRecord(raw, input.access),
      actor: JSON.parse(String(snapshot.actor_json)),
      provenance: JSON.parse(String(snapshot.provenance_json)),
      createdAt: snapshot.created_at
    };
  });
  if (input.kind !== "offer") return { ...linkedCurrent, revisionHistory };
  const offerRevisions = (
    getDatabase()
      .prepare(
        "SELECT * FROM job_offer_revisions WHERE offer_id = ? ORDER BY version DESC LIMIT 100"
      )
      .all(input.id) as SqlRow[]
  ).map((row) => rowToWorkRecord(row, input.access));
  return { ...linkedCurrent, revisionHistory, offerRevisions };
}

function appendSupportingRecordLinks(input: {
  kind: string;
  id: string;
  parentId?: string;
  data: Record<string, unknown>;
  access: WorkAccess;
}) {
  if (input.kind === "interview" || input.kind === "offer") {
    appendAuthorizedWorkLinks({
      sourceEntityType:
        input.kind === "interview" ? "job_interview" : "job_offer",
      sourceEntityId: input.id,
      access: input.access,
      links: [
        {
          targetEntityType: "job_application",
          targetEntityId: String(input.parentId),
          relationship: "belongs_to_application",
          anchorKey: "application"
        }
      ]
    });
    return;
  }
  if (input.kind !== "outreach") return;
  getDatabase()
    .prepare(
      `DELETE FROM entity_links
       WHERE source_entity_type = 'work_outreach'
         AND source_entity_id = ?
         AND anchor_key IN ('campaign', 'organization', 'person', 'message')`
    )
    .run(input.id);
  const links = [
    [
      "opportunity_campaign",
      input.data.campaignId,
      "supports_campaign",
      "campaign"
    ],
    [
      "work_organization",
      input.data.organizationId,
      "targets_organization",
      "organization"
    ],
    ["person", input.data.personId, "addresses_person", "person"],
    [
      "artifact",
      input.data.messageArtifactId,
      "uses_message_artifact",
      "message"
    ]
  ]
    .filter(
      (entry): entry is [string, string, string, string] =>
        typeof entry[1] === "string" && entry[1].length > 0
    )
    .map(([targetEntityType, targetEntityId, relationship, anchorKey]) => ({
      targetEntityType,
      targetEntityId,
      relationship,
      anchorKey
    }));
  if (links.length > 0) {
    appendAuthorizedWorkLinks({
      sourceEntityType: "work_outreach",
      sourceEntityId: input.id,
      access: input.access,
      links
    });
  }
}

export function listSupportingRecords(input: {
  kind: string;
  access: WorkAccess;
  parentId?: string;
  limit?: number;
  offset?: number;
}) {
  const config = supportingConfigs[input.kind];
  if (!config)
    throw new HttpError(
      400,
      "work_supporting_kind_invalid",
      "Unsupported Work supporting record kind."
    );
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const offset = Math.max(input.offset ?? 0, 0);
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (config.ownerField) {
    if (input.access.ownerUserIds.length === 0) {
      return { items: [], total: 0, limit, offset, hasMore: false };
    }
    const columns = tableColumns(config.table);
    if (
      columns.has("scope_project_ids_json") &&
      columns.has("scope_tag_ids_json")
    ) {
      const scope = buildRootScopeClause(input.access, config.ownerField);
      clauses.push(scope.sql);
      values.push(...scope.values);
    } else {
      clauses.push(
        `${config.ownerField} IN (${input.access.ownerUserIds.map(() => "?").join(", ")})`
      );
      values.push(...input.access.ownerUserIds);
    }
  }
  if (config.parentField) {
    if (input.parentId) {
      assertParent(config, input.parentId, input.access);
      clauses.push(`${config.parentField} = ?`);
      values.push(input.parentId);
    } else if (config.parentEntityType) {
      const parent = rootConfig(config.parentEntityType);
      const parentScope = buildRootScopeClause(
        input.access,
        `work_parent.${parent.ownerColumn}`,
        "work_parent.scope_project_ids_json",
        "work_parent.scope_tag_ids_json"
      );
      clauses.push(
        `EXISTS (
          SELECT 1 FROM ${parent.table} work_parent
          WHERE work_parent.id = ${config.table}.${config.parentField}
            AND work_parent.deleted_at IS NULL
            AND ${parentScope.sql}
        )`
      );
      values.push(...parentScope.values);
    }
  }
  if (config.privateProjection && !input.access.canPrivateApplication) {
    return {
      items: [],
      total: 0,
      limit,
      offset,
      hasMore: false,
      redacted: true
    };
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = (
    getDatabase()
      .prepare(`SELECT COUNT(*) AS count FROM ${config.table} ${where}`)
      .get(...values) as { count: number }
  ).count;
  const columns = tableColumns(config.table);
  const orderColumn = columns.has("updated_at") ? "updated_at" : "created_at";
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM ${config.table} ${where} ORDER BY ${orderColumn} DESC, id ASC LIMIT ? OFFSET ?`
    )
    .all(...values, limit, offset) as SqlRow[];
  return {
    items: rows.map((row) => rowToWorkRecord(row, input.access)),
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total
  };
}

export function createSupportingRecord(input: {
  kind: string;
  access: WorkAccess;
  parentId?: string;
  data: Record<string, unknown>;
}) {
  const config = supportingConfigs[input.kind];
  if (!config)
    throw new HttpError(
      400,
      "work_supporting_kind_invalid",
      "Unsupported Work supporting record kind."
    );
  assertGenericOfferMutationBoundary({ kind: input.kind, data: input.data });
  assertParent(config, input.parentId, input.access);
  if (config.privateProjection && !input.access.canPrivateApplication) {
    throw new HttpError(
      403,
      "work_private_application_scope_required",
      "This operation requires private application authority."
    );
  }
  validateSupportingReferences(input);
  const now = nowIso();
  const id = newWorkId(config.prefix);
  const data: Record<string, unknown> = {
    id,
    ...(config.ownerField
      ? { [config.ownerField]: input.access.mutationOwnerUserId }
      : {}),
    ...(config.parentField ? { [config.parentField]: input.parentId } : {}),
    ...normalizedData(config, input.data),
    ...(config.revisioned ? { revision: 1 } : {}),
    created_at: now,
    ...(tableColumns(config.table).has("updated_at")
      ? { updated_at: now }
      : {}),
    ...(tableColumns(config.table).has("import_receipt_id")
      ? { import_receipt_id: null }
      : {})
  };
  return runInTransaction(() => {
    const columns = Object.keys(data);
    getDatabase()
      .prepare(
        `INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
      )
      .run(...columns.map((column) => data[column] as never));
    if (input.kind === "outreach") {
      registerWorkRoot("work_outreach", id, input.access.mutationOwnerUserId);
    }
    appendSupportingRecordLinks({
      kind: input.kind,
      id,
      parentId: input.parentId,
      data: input.data,
      access: input.access
    });
    const stored = assertOwnedRow(config, id, input.access);
    if (config.revisioned) {
      recordSupportingRevision({
        kind: input.kind,
        row: stored,
        access: input.access,
        createdAt: now
      });
      if (input.kind === "offer") {
        recordOfferRevision(stored, input.access, now);
      }
    }
    recordWorkActivity({
      entityType:
        input.kind === "outreach"
          ? "work_outreach"
          : (config.parentEntityType ?? input.kind),
      entityId: input.kind === "outreach" ? id : String(input.parentId ?? id),
      eventType: `work_${input.kind}_created`,
      title: `${input.kind.replace(/([A-Z])/gu, " $1").trim()} added`,
      actor: input.access.actor
    });
    return rowToWorkRecord(stored, input.access);
  });
}

export function updateSupportingRecord(input: {
  kind: string;
  id: string;
  access: WorkAccess;
  expectedRevision: number;
  data: Record<string, unknown>;
}) {
  const config = supportingConfigs[input.kind];
  if (!config || !config.revisioned)
    throw new HttpError(
      400,
      "work_supporting_update_invalid",
      "This supporting Work record is not revision-updatable."
    );
  const current = assertOwnedRow(config, input.id, input.access);
  const currentRecord = rowToWorkRecord(current, input.access);
  assertGenericOfferMutationBoundary({
    kind: input.kind,
    data: input.data,
    current: currentRecord
  });
  if (config.privateProjection && !input.access.canPrivateApplication) {
    throw new HttpError(
      403,
      "work_private_application_scope_required",
      "This operation requires private application authority."
    );
  }
  validateSupportingReferences({
    kind: input.kind,
    access: input.access,
    data: {
      ...currentRecord,
      ...input.data
    },
    parentId: config.parentField
      ? String(current[config.parentField])
      : undefined
  });
  const data = normalizedData(config, input.data);
  const entries = Object.entries(data);
  if (entries.length === 0) {
    throw new HttpError(
      400,
      "work_supporting_update_empty",
      "A Work supporting update must change at least one field."
    );
  }
  return runInTransaction(() => {
    const updatedAt = nowIso();
    const result = getDatabase()
      .prepare(
        `UPDATE ${config.table}
         SET ${entries.map(([column]) => `${column} = ?`).join(", ")}${entries.length > 0 ? "," : ""}
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`
      )
      .run(
        ...entries.map(([, value]) => value as never),
        updatedAt,
        input.id,
        input.expectedRevision
      );
    if (Number(result.changes) !== 1) {
      throw new HttpError(
        409,
        "work_revision_conflict",
        "This Work record changed after it was opened."
      );
    }
    const stored = assertOwnedRow(config, input.id, input.access);
    recordSupportingRevision({
      kind: input.kind,
      row: stored,
      access: input.access,
      createdAt: updatedAt
    });
    if (input.kind === "offer") {
      recordOfferRevision(stored, input.access, updatedAt);
    }
    if (input.kind === "outreach") {
      appendSupportingRecordLinks({
        kind: input.kind,
        id: input.id,
        data: rowToWorkRecord(stored, input.access),
        access: input.access
      });
    }
    recordWorkActivity({
      entityType:
        input.kind === "outreach"
          ? "work_outreach"
          : (config.parentEntityType ?? input.kind),
      entityId:
        input.kind === "outreach"
          ? input.id
          : String(config.parentField ? current[config.parentField] : input.id),
      eventType: `work_${input.kind}_updated`,
      title: `${input.kind.replace(/([A-Z])/gu, " $1").trim()} updated`,
      actor: input.access.actor
    });
    return rowToWorkRecord(stored, input.access);
  });
}

export {
  getSearchRunDetail,
  listSearchRuns,
  recordSearchRun
} from "./search-run-repository.js";
export { acceptOfferAsPlannedEngagement } from "./offer-conversion.js";
