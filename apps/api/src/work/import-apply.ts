import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import type { WorkAccess } from "./access.js";
import {
  appendAuthorizedWorkLinks,
  fingerprint,
  getOperationReceipt,
  newWorkId,
  nowIso,
  storeOperationReceipt
} from "./repository-helpers.js";
import {
  createCampaignCriteriaVersion,
  createJobApplication,
  createOpportunityCampaign,
  createWorkEngagement,
  createWorkOrganization,
  upsertJobOpportunity
} from "./repository.js";
import { createSupportingRecord } from "./supporting.js";
import {
  CLOSED_APPLICATION_STATUSES,
  WORK_IMPORT_ROLLBACK_CLASSIFICATION,
  orderedApplicationEvents,
  previewWorkImport,
  rowFingerprint,
  type InventoryRecord
} from "./import.js";
import type { WorkImportManifest } from "./types-operations.js";

function buildResolutionMap(
  preview: ReturnType<typeof previewWorkImport>,
  manifest: WorkImportManifest
) {
  const map = new Map<string, string>();
  for (const resolution of Object.values(preview.resolutions).flat()) {
    if (resolution.existingId) map.set(resolution.ref, resolution.existingId);
  }
  for (const reference of manifest.artifactReferences) {
    map.set(reference.ref, reference.artifactId);
  }
  return map;
}

function resolveRef(
  map: Map<string, string>,
  value: string | null | undefined
) {
  if (!value) return value ?? null;
  return map.get(value) ?? value;
}

function requireCreatedRecordId(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(
      500,
      "work_import_created_record_invalid",
      `${label} was created without a readable record response.`
    );
  }
  const id = (value as Record<string, unknown>).id;
  if (typeof id !== "string" || !id.trim()) {
    throw new HttpError(
      500,
      "work_import_created_record_id_missing",
      `${label} was created without a stable identifier.`
    );
  }
  return id;
}

function resolveProvenanceArtifact(
  map: Map<string, string>,
  provenance: WorkImportManifest["applications"][number]["provenance"]
) {
  return {
    ...provenance,
    sourceArtifactId: provenance.sourceArtifactId
      ? String(resolveRef(map, provenance.sourceArtifactId))
      : ""
  };
}

function insertImportedApplicationEvent(input: {
  applicationId: string;
  event: WorkImportManifest["applicationEvents"][number];
  map: Map<string, string>;
}) {
  const id = newWorkId("jaevt");
  getDatabase()
    .prepare(
      `INSERT INTO application_events (
        id, application_id, event_type, prior_status, new_status, occurred_at,
        actor_json, source_artifact_id, factual_description, outcome, next_action,
        due_at, confidence, provenance_json, created_at, import_receipt_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      id,
      input.applicationId,
      input.event.eventType,
      input.event.priorStatus,
      input.event.newStatus,
      input.event.occurredAt,
      JSON.stringify(input.event.actor),
      resolveRef(input.map, input.event.sourceArtifactId),
      input.event.factualDescription,
      input.event.outcome,
      input.event.nextAction,
      input.event.dueAt ?? null,
      input.event.confidence,
      JSON.stringify(
        resolveProvenanceArtifact(input.map, input.event.provenance)
      ),
      nowIso()
    );
  return id;
}

function insertArtifactUse(input: {
  applicationId: string;
  reference: WorkImportManifest["artifactReferences"][number];
  map: Map<string, string>;
}) {
  const id = newWorkId("ause");
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO application_artifact_uses (
        id, application_id, artifact_id, artifact_version_id, content_sha256,
        use_kind, approval_state, used_at, transmission_preview_id,
        provenance_json, created_at, import_receipt_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`
    )
    .run(
      id,
      input.applicationId,
      input.reference.artifactId,
      input.reference.artifactVersionId,
      input.reference.contentSha256,
      input.reference.useKind,
      input.reference.approvalState,
      input.reference.usedAt ?? now,
      JSON.stringify(
        resolveProvenanceArtifact(input.map, input.reference.provenance)
      ),
      now
    );
  return id;
}

function addInventory(
  inventory: InventoryRecord[],
  table: string,
  id: string,
  classification = WORK_IMPORT_ROLLBACK_CLASSIFICATION[table]
) {
  if (!classification) {
    throw new HttpError(
      500,
      "work_import_rollback_classification_missing",
      `Importable table ${table} has no rollback classification.`
    );
  }
  if (inventory.some((entry) => entry.table === table && entry.id === id))
    return;
  const currentFingerprint = rowFingerprint(table, id);
  if (!currentFingerprint) {
    throw new HttpError(
      500,
      "work_import_inventory_missing",
      `The import-created ${table} record ${id} could not be inventoried.`
    );
  }
  inventory.push({
    table,
    id,
    classification,
    fingerprint: currentFingerprint
  });
}

function tagInventoryRows(
  rows: Array<{ table: string; id: string }>,
  receiptId: string
) {
  const rootTables = new Set([
    "work_organizations",
    "work_engagements",
    "opportunity_campaigns",
    "job_opportunities",
    "candidate_positioning_profiles",
    "job_applications"
  ]);
  const now = nowIso();
  for (const { table, id } of rows) {
    const columns = new Set(
      (
        getDatabase()
          .prepare(`SELECT name FROM pragma_table_info(?)`)
          .all(table) as Array<{ name: string }>
      ).map((column) => column.name)
    );
    if (!columns.has("import_receipt_id")) continue;
    const primaryKey = table === "work_settings" ? "owner_user_id" : "id";
    const assignments = ["import_receipt_id = ?"];
    const values: Array<string | number> = [receiptId];
    if (rootTables.has(table)) assignments.push("revision = revision + 1");
    if (columns.has("updated_at")) {
      assignments.push("updated_at = ?");
      values.push(now);
    }
    getDatabase()
      .prepare(
        `UPDATE ${table} SET ${assignments.join(", ")} WHERE ${primaryKey} = ?`
      )
      .run(...values, id);
  }
}

function inventoryCreatedMetadata(input: {
  inventory: InventoryRecord[];
  rootRecords: Array<{ entityType: string; entityId: string }>;
  importedAt: string;
  actorId: string;
}) {
  for (const root of input.rootRecords) {
    const activities = getDatabase()
      .prepare(
        `SELECT id FROM activity_events
         WHERE entity_type = ? AND entity_id = ? AND actor = ? AND created_at >= ?`
      )
      .all(
        root.entityType,
        root.entityId,
        input.actorId,
        input.importedAt
      ) as Array<{ id: string }>;
    for (const activity of activities) {
      addInventory(input.inventory, "activity_events", activity.id);
    }
    const owner = getDatabase()
      .prepare(
        `SELECT entity_type || ':' || entity_id AS identity
         FROM entity_owners
         WHERE entity_type = ? AND entity_id = ?`
      )
      .get(root.entityType, root.entityId) as { identity: string } | undefined;
    if (owner) {
      input.inventory.push({
        table: "entity_owners",
        id: owner.identity,
        classification: "reference_only",
        fingerprint: fingerprint(owner)
      });
    }
  }
}

function snapshotLink(link: Record<string, unknown>): InventoryRecord {
  const identity = {
    sourceEntityType: link.sourceEntityType,
    sourceEntityId: link.sourceEntityId,
    targetEntityType: link.targetEntityType,
    targetEntityId: link.targetEntityId,
    anchorKey: link.anchorKey,
    relationship: link.relationship
  };
  return {
    table: "entity_links",
    id: fingerprint(identity),
    classification: "physical_delete_receipt_row",
    fingerprint: fingerprint(link),
    identity
  };
}

function inventoryReservedScopeLinks(state: ApplyImportState) {
  const select = getDatabase().prepare(
    `SELECT source_entity_type AS sourceEntityType,
            source_entity_id AS sourceEntityId,
            target_entity_type AS targetEntityType,
            target_entity_id AS targetEntityId,
            anchor_key AS anchorKey,
            relationship,
            created_by_actor AS createdByActor,
            created_at AS createdAt
     FROM entity_links
     WHERE source_entity_type = ? AND source_entity_id = ?
       AND anchor_key = 'work_scope'
       AND target_entity_type IN ('project', 'tag')`
  );
  for (const root of state.rootRecords) {
    const links = select.all(root.entityType, root.entityId) as Array<
      Record<string, unknown>
    >;
    for (const link of links) {
      const snapshot = snapshotLink(link);
      if (
        !state.importedLinks.some(
          (existing) =>
            existing.table === snapshot.table && existing.id === snapshot.id
        )
      ) {
        state.importedLinks.push(snapshot);
      }
    }
  }
}

type ApplyWorkImportInput = {
  access: WorkAccess;
  manifest: WorkImportManifest;
  expectedPreviewDigest: string;
  idempotencyKey: string;
};

type ApplyImportState = {
  input: ApplyWorkImportInput;
  preview: ReturnType<typeof previewWorkImport>;
  importedAt: string;
  receiptId: string;
  map: Map<string, string>;
  inventory: InventoryRecord[];
  rootRecords: Array<{ entityType: string; entityId: string }>;
  rawCreated: Array<{ table: string; id: string }>;
  importedLinks: InventoryRecord[];
};

function addRawImportRecord(
  state: ApplyImportState,
  table: string,
  id: string
) {
  state.rawCreated.push({ table, id });
  return id;
}

function importSettingsAndRoots(state: ApplyImportState) {
  const { input, preview, map, importedAt } = state;
  const existingSettings = getDatabase()
    .prepare("SELECT 1 AS present FROM work_settings WHERE owner_user_id = ?")
    .get(input.manifest.ownerUserId);
  if (
    input.manifest.lookingForOpportunities !== undefined &&
    !existingSettings
  ) {
    getDatabase()
      .prepare(
        `INSERT INTO work_settings (
        owner_user_id, looking_for_opportunities, revision, provenance_json,
        created_at, updated_at, import_receipt_id
      ) VALUES (?, ?, 1, ?, ?, ?, NULL)`
      )
      .run(
        input.manifest.ownerUserId,
        input.manifest.lookingForOpportunities ? 1 : 0,
        JSON.stringify({
          sourceKind: "import",
          sourceLabel: input.manifest.source.label,
          sourceDigest: input.manifest.source.digest
        }),
        importedAt,
        importedAt
      );
    addRawImportRecord(state, "work_settings", input.manifest.ownerUserId);
  }
  input.manifest.organizations.forEach((organization, index) => {
    const resolution = preview.resolutions.organizations[index];
    if (resolution.action === "reference") return;
    const id = requireCreatedRecordId(
      createWorkOrganization(input.access, {
        ...organization,
        provenance: resolveProvenanceArtifact(map, organization.provenance)
      }),
      "Work Organization"
    );
    map.set(resolution.ref, id);
    addRawImportRecord(state, "work_organizations", id);
    state.rootRecords.push({ entityType: "work_organization", entityId: id });
  });
  input.manifest.engagements.forEach((engagement, index) => {
    const resolution = preview.resolutions.engagements[index];
    if (resolution.action === "reference") return;
    const id = requireCreatedRecordId(
      createWorkEngagement(input.access, {
        ...engagement,
        organizationId: resolveRef(map, engagement.organizationId),
        provenance: resolveProvenanceArtifact(map, engagement.provenance)
      }),
      "Work Engagement"
    );
    map.set(resolution.ref, id);
    addRawImportRecord(state, "work_engagements", id);
    state.rootRecords.push({ entityType: "work_engagement", entityId: id });
    const events = getDatabase()
      .prepare("SELECT id FROM work_engagement_events WHERE engagement_id = ?")
      .all(id) as Array<{ id: string }>;
    events.forEach((event) =>
      addRawImportRecord(state, "work_engagement_events", event.id)
    );
  });
  input.manifest.campaigns.forEach((campaign, index) => {
    const resolution = preview.resolutions.campaigns[index];
    if (resolution.action === "reference") return;
    const id = requireCreatedRecordId(
      createOpportunityCampaign(input.access, {
        ...campaign,
        sourceEngagementId: resolveRef(map, campaign.sourceEngagementId),
        provenance: resolveProvenanceArtifact(map, campaign.provenance)
      }),
      "Opportunity Campaign"
    );
    map.set(resolution.ref, id);
    addRawImportRecord(state, "opportunity_campaigns", id);
    state.rootRecords.push({
      entityType: "opportunity_campaign",
      entityId: id
    });
    const criteria = getDatabase()
      .prepare(
        "SELECT id FROM campaign_criteria_versions WHERE campaign_id = ?"
      )
      .all(id) as Array<{ id: string }>;
    criteria.forEach((entry) =>
      addRawImportRecord(state, "campaign_criteria_versions", entry.id)
    );
  });
}

function importCampaignChildren(state: ApplyImportState) {
  const { input, map } = state;
  for (const entry of input.manifest.criteriaVersions) {
    const created = createCampaignCriteriaVersion(
      input.access,
      String(resolveRef(map, entry.campaignRef)),
      {
        ...entry.value,
        provenance: resolveProvenanceArtifact(map, entry.value.provenance)
      }
    );
    map.set(entry.ref, String(created.id));
    addRawImportRecord(state, "campaign_criteria_versions", String(created.id));
  }
  const importTarget = (
    kind: "roleTarget" | "organizationTarget",
    entry:
      | WorkImportManifest["roleTargets"][number]
      | WorkImportManifest["organizationTargets"][number]
  ) => {
    const targetData: Record<string, unknown> = { ...entry.value };
    delete targetData.id;
    delete targetData.expectedRevision;
    if (kind === "organizationTarget") {
      targetData.organizationId = resolveRef(
        map,
        (entry.value as { organizationId?: string | null }).organizationId
      );
    }
    const created = createSupportingRecord({
      kind,
      access: input.access,
      parentId: String(resolveRef(map, entry.campaignRef)),
      data: targetData
    });
    addRawImportRecord(
      state,
      kind === "roleTarget"
        ? "campaign_role_targets"
        : "campaign_organization_targets",
      String(created.id)
    );
    const revisions = getDatabase()
      .prepare(
        "SELECT id FROM work_supporting_revisions WHERE record_kind = ? AND record_id = ?"
      )
      .all(kind, String(created.id)) as Array<{ id: string }>;
    revisions.forEach((revision) =>
      addRawImportRecord(state, "work_supporting_revisions", revision.id)
    );
  };
  for (const entry of input.manifest.roleTargets)
    importTarget("roleTarget", entry);
  for (const entry of input.manifest.organizationTargets)
    importTarget("organizationTarget", entry);
}

function importOpportunityAndApplicationRoots(state: ApplyImportState) {
  const { input, preview, map } = state;
  input.manifest.opportunities.forEach((opportunity, index) => {
    const resolution = preview.resolutions.opportunities[index];
    if (resolution.action === "reference") return;
    const created = upsertJobOpportunity(
      input.access,
      {
        ...opportunity,
        organizationId: resolveRef(map, opportunity.organizationId),
        sourceSnapshotArtifactId: resolveRef(
          map,
          opportunity.sourceSnapshotArtifactId
        ),
        claimEvidence: opportunity.claimEvidence.map((claim) => ({
          ...claim,
          provenance: resolveProvenanceArtifact(map, claim.provenance)
        })),
        provenance: resolveProvenanceArtifact(map, opportunity.provenance)
      },
      { insertOnly: true, recordReceipt: false, recordActivity: false }
    );
    const id = String(created.opportunity.id);
    map.set(resolution.ref, id);
    for (const record of created.createdRecords ?? [])
      addRawImportRecord(state, String(record.table), String(record.id));
    state.rootRecords.push({ entityType: "job_opportunity", entityId: id });
  });
  input.manifest.applications.forEach((application, index) => {
    const resolution = preview.resolutions.applications[index];
    if (resolution.action === "reference") return;
    const events = orderedApplicationEvents(input.manifest, resolution.ref);
    const statusEvents = events.filter((event) => event.newStatus !== null);
    const createStatus = "planned";
    const created = createJobApplication(input.access, {
      ...application,
      opportunityId: String(resolveRef(map, application.opportunityId)),
      primaryCampaignId: String(resolveRef(map, application.primaryCampaignId)),
      criteriaVersionId: application.criteriaVersionId
        ? String(resolveRef(map, application.criteriaVersionId))
        : null,
      status: createStatus,
      provenance: resolveProvenanceArtifact(map, application.provenance)
    });
    const id = requireCreatedRecordId(created, "Job Application");
    map.set(resolution.ref, id);
    addRawImportRecord(state, "job_applications", id);
    state.rootRecords.push({ entityType: "job_application", entityId: id });

    if (statusEvents.length > 0) {
      getDatabase()
        .prepare(
          "DELETE FROM application_events WHERE application_id = ? AND event_type = 'created'"
        )
        .run(id);
    } else if (application.status !== "planned") {
      getDatabase()
        .prepare(
          `UPDATE application_events
           SET event_type = 'imported_status_snapshot', new_status = ?,
               occurred_at = ?, factual_description = ?, provenance_json = ?
           WHERE application_id = ? AND event_type = 'created'`
        )
        .run(
          application.status,
          input.manifest.source.observedAt,
          `Current status recorded from reviewed import source ${input.manifest.source.label}; no intermediate lifecycle stages were inferred.`,
          JSON.stringify(
            resolveProvenanceArtifact(map, application.provenance)
          ),
          id
        );
    }
    for (const event of events) {
      insertImportedApplicationEvent({ applicationId: id, event, map });
    }

    const firstStartedEvent = statusEvents.find(
      (event) => event.newStatus === "preparing"
    );
    const submittedEvent = statusEvents.find(
      (event) => event.newStatus === "submitted"
    );
    const acknowledgedEvent = statusEvents.find(
      (event) => event.newStatus === "acknowledged"
    );
    const closedEvent = [...statusEvents]
      .reverse()
      .find(
        (event) =>
          event.newStatus !== null &&
          CLOSED_APPLICATION_STATUSES.has(event.newStatus)
      );
    const contactEventTypes = new Set([
      "email",
      "acknowledgement",
      "call",
      "interview",
      "information_request",
      "follow_up",
      "offer",
      "rejection"
    ]);
    const lastContactEvent = [...events]
      .reverse()
      .find((event) => contactEventTypes.has(event.eventType));
    const outcomeEvent = [...events]
      .reverse()
      .find((event) => event.outcome.trim());
    getDatabase()
      .prepare(
        `UPDATE job_applications
         SET status = ?,
             started_at = COALESCE(started_at, ?),
             submitted_at = COALESCE(submitted_at, ?),
             acknowledged_at = COALESCE(acknowledged_at, ?),
             last_contact_at = COALESCE(last_contact_at, ?),
             closed_at = COALESCE(closed_at, ?),
             outcome = CASE WHEN ? <> '' THEN ? ELSE outcome END,
             revision = revision + 1,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        application.status,
        firstStartedEvent?.occurredAt ?? null,
        submittedEvent?.occurredAt ?? null,
        acknowledgedEvent?.occurredAt ?? null,
        lastContactEvent?.occurredAt ?? null,
        closedEvent?.occurredAt ?? null,
        outcomeEvent?.outcome ?? "",
        outcomeEvent?.outcome ?? "",
        state.importedAt,
        id
      );
    const importedEvents = getDatabase()
      .prepare("SELECT id FROM application_events WHERE application_id = ?")
      .all(id) as Array<{ id: string }>;
    importedEvents.forEach((event) =>
      addRawImportRecord(state, "application_events", event.id)
    );
  });
}

function importEvidenceAndLinks(state: ApplyImportState) {
  const { input, map } = state;
  for (const reference of input.manifest.artifactReferences) {
    if (!reference.applicationRef) continue;
    addRawImportRecord(
      state,
      "application_artifact_uses",
      insertArtifactUse({
        applicationId: String(resolveRef(map, reference.applicationRef)),
        reference,
        map
      })
    );
  }
  for (const link of input.manifest.links) {
    const appended = appendAuthorizedWorkLinks({
      sourceEntityType: link.sourceType,
      sourceEntityId: String(resolveRef(map, link.sourceRef)),
      access: input.access,
      links: [
        {
          ...link.link,
          targetEntityId: String(resolveRef(map, link.link.targetEntityId))
        }
      ]
    });
    state.importedLinks.push(...appended.created.map(snapshotLink));
  }
}

function finalizeAppliedImport(
  state: ApplyImportState,
  requestFingerprint: string
) {
  inventoryReservedScopeLinks(state);
  inventoryCreatedMetadata({
    inventory: state.inventory,
    rootRecords: state.rootRecords,
    importedAt: state.importedAt,
    actorId: state.input.access.actor.id
  });
  tagInventoryRows(state.rawCreated, state.receiptId);
  for (const created of state.rawCreated)
    addInventory(state.inventory, created.table, created.id);
  state.inventory.push(...state.importedLinks);
  const dependencyFingerprint = fingerprint(
    state.inventory
      .map((record) => ({
        table: record.table,
        id: record.id,
        classification: record.classification,
        fingerprint: record.fingerprint,
        identity: record.identity ?? null
      }))
      .sort((left, right) =>
        `${left.table}:${left.id}`.localeCompare(`${right.table}:${right.id}`)
      )
  );
  const response = {
    receiptId: state.receiptId,
    previewDigest: state.preview.previewDigest,
    manifestDigest: state.preview.manifestDigest,
    appliedAt: state.importedAt,
    counts: state.preview.counts,
    references: Object.fromEntries(state.map),
    createdRecordCount: state.inventory.filter(
      (record) => record.classification !== "reference_only"
    ).length,
    matchedExistingCount: Object.values(state.preview.resolutions)
      .flat()
      .filter((resolution) => resolution.action === "reference").length,
    subjectiveMetricObservations: 0,
    dependencyFingerprint
  };
  storeOperationReceipt({
    id: state.receiptId,
    ownerUserId: state.input.access.mutationOwnerUserId,
    operationKind: "work_import_apply",
    idempotencyKey: state.input.idempotencyKey,
    requestFingerprint,
    response,
    createdRecords: state.inventory,
    rollbackClassification: WORK_IMPORT_ROLLBACK_CLASSIFICATION,
    dependencyFingerprint
  });
  return { replayed: false, ...response };
}

export function applyWorkImport(input: ApplyWorkImportInput) {
  if (!input.access.operator) {
    throw new HttpError(
      403,
      "work_import_operator_required",
      "Work imports require an authenticated local operator session."
    );
  }
  const requestFingerprint = fingerprint({
    manifest: input.manifest,
    expectedPreviewDigest: input.expectedPreviewDigest
  });
  const replay = getOperationReceipt({
    ownerUserId: input.access.mutationOwnerUserId,
    operationKind: "work_import_apply",
    idempotencyKey: input.idempotencyKey,
    requestFingerprint,
    access: input.access
  });
  if (replay) {
    return {
      replayed: true,
      ...((replay.response as Record<string, unknown>) ?? {})
    };
  }
  return runInTransaction(() => {
    const preview = previewWorkImport(input.access, input.manifest);
    if (preview.previewDigest !== input.expectedPreviewDigest) {
      throw new HttpError(
        409,
        "work_import_preview_changed",
        "The import preview changed before apply. Review the new dedupe and relationship result."
      );
    }
    const state: ApplyImportState = {
      input,
      preview,
      importedAt: nowIso(),
      receiptId: newWorkId("wrec"),
      map: buildResolutionMap(preview, input.manifest),
      inventory: [],
      rootRecords: [],
      rawCreated: [],
      importedLinks: []
    };
    importSettingsAndRoots(state);
    importCampaignChildren(state);
    importOpportunityAndApplicationRoots(state);
    importEvidenceAndLinks(state);
    return finalizeAppliedImport(state, requestFingerprint);
  });
}
