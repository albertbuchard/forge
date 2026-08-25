import { getDatabase } from "../db.js";
import { HttpError } from "../errors.js";
import { getEntityOwnerId } from "../repositories/entity-ownership.js";
import type { WorkAccess } from "./access.js";
import { findProtectedApplicantField } from "./privacy.js";
import {
  assertAuthorizedWorkReference,
  fingerprint,
  rowToWorkRecord,
  type SqlRow
} from "./repository-helpers.js";
import {
  applicationTransitions,
  findJobOpportunityDuplicate,
  opportunityDedupeKey
} from "./repository.js";
import type { WorkImportManifest } from "./types-operations.js";

type RollbackClass =
  | "reference_only"
  | "soft_delete_root"
  | "physical_delete_receipt_row"
  | "immutable_receipt";

export type InventoryRecord = {
  table: string;
  id: string;
  classification: RollbackClass;
  fingerprint: string;
  identity?: Record<string, unknown>;
};

type Resolution = {
  ref: string;
  action: "create" | "reference";
  existingId: string | null;
};

const EVIDENCE_BOUND_APPLICATION_STATUSES = new Set([
  "submitted",
  "acknowledged",
  "screening",
  "interviewing",
  "assessment",
  "references",
  "offer",
  "accepted",
  "declined_by_candidate",
  "rejected",
  "ghosted"
]);

export const CLOSED_APPLICATION_STATUSES = new Set([
  "declined_by_candidate",
  "withdrawn",
  "rejected",
  "ghosted",
  "closed"
]);

export const WORK_IMPORT_ROLLBACK_CLASSIFICATION: Readonly<
  Record<string, RollbackClass>
> = Object.freeze({
  work_settings: "physical_delete_receipt_row",
  work_organizations: "soft_delete_root",
  work_engagements: "soft_delete_root",
  work_engagement_events: "physical_delete_receipt_row",
  work_metric_definitions: "physical_delete_receipt_row",
  work_check_ins: "physical_delete_receipt_row",
  work_metric_observations: "physical_delete_receipt_row",
  opportunity_campaigns: "soft_delete_root",
  campaign_criteria_versions: "physical_delete_receipt_row",
  campaign_role_targets: "physical_delete_receipt_row",
  campaign_organization_targets: "physical_delete_receipt_row",
  job_opportunities: "soft_delete_root",
  job_opportunity_sources: "physical_delete_receipt_row",
  campaign_opportunity_evaluations: "physical_delete_receipt_row",
  candidate_positioning_profiles: "soft_delete_root",
  candidate_document_sets: "physical_delete_receipt_row",
  application_response_templates: "physical_delete_receipt_row",
  job_applications: "soft_delete_root",
  application_questions: "physical_delete_receipt_row",
  application_events: "physical_delete_receipt_row",
  application_artifact_uses: "physical_delete_receipt_row",
  job_interviews: "physical_delete_receipt_row",
  job_offers: "physical_delete_receipt_row",
  job_offer_revisions: "physical_delete_receipt_row",
  job_search_sources: "physical_delete_receipt_row",
  job_saved_queries: "physical_delete_receipt_row",
  job_automation_policies: "physical_delete_receipt_row",
  job_search_runs: "physical_delete_receipt_row",
  job_search_run_items: "physical_delete_receipt_row",
  work_outreach: "physical_delete_receipt_row",
  work_supporting_revisions: "physical_delete_receipt_row",
  application_transmission_previews: "physical_delete_receipt_row",
  work_operation_receipts: "immutable_receipt",
  entity_links: "physical_delete_receipt_row",
  activity_events: "physical_delete_receipt_row",
  entity_owners: "reference_only"
});

const prohibitedValue =
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{12,})/u;
const prohibitedSensitiveKeys = new Set([
  "race",
  "ethnicity",
  "religion",
  "sexualorientation",
  "disabilitystatus"
]);

function isProhibitedPrivateKey(key: string) {
  const normalizedKey = key.replaceAll(/[^a-z0-9]/giu, "").toLowerCase();
  return (
    normalizedKey.includes("password") ||
    normalizedKey.includes("passphrase") ||
    normalizedKey.includes("secret") ||
    normalizedKey.includes("privatekey") ||
    normalizedKey.includes("credential") ||
    normalizedKey.includes("homeaddress") ||
    normalizedKey.includes("protecteddemographic") ||
    normalizedKey === "token" ||
    normalizedKey.endsWith("accesstoken") ||
    normalizedKey.endsWith("refreshtoken") ||
    normalizedKey.endsWith("authtoken") ||
    normalizedKey.endsWith("sessiontoken") ||
    normalizedKey === "apikey" ||
    prohibitedSensitiveKeys.has(normalizedKey)
  );
}

function assertNoProhibitedPrivateData(value: unknown, path = "manifest") {
  if (typeof value === "string") {
    if (prohibitedValue.test(value)) {
      throw new HttpError(
        400,
        "work_import_prohibited_secret",
        `The private import contains credential-like material at ${path}.`
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoProhibitedPrivateData(entry, `${path}[${index}]`)
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isProhibitedPrivateKey(key)) {
      throw new HttpError(
        400,
        "work_import_prohibited_private_field",
        `The private import field ${path}.${key} is not accepted by the Work importer.`
      );
    }
    assertNoProhibitedPrivateData(entry, `${path}.${key}`);
  }
}

function assertConfirmedContacts(manifest: WorkImportManifest) {
  for (const [index, application] of manifest.applications.entries()) {
    for (const contact of application.privateContacts) {
      if (contact.confirmed !== true) {
        throw new HttpError(
          400,
          "work_import_unconfirmed_contact",
          `Application ${index + 1} contains a private contact that is not explicitly confirmed.`
        );
      }
    }
  }
}

function itemRef(kind: string, index: number, item: { id?: string }) {
  return item.id?.trim() || `${kind}:${index + 1}`;
}

function normalized(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function rowFingerprint(table: string, id: string) {
  const primaryKey = table === "work_settings" ? "owner_user_id" : "id";
  const row = getDatabase()
    .prepare(`SELECT * FROM ${table} WHERE ${primaryKey} = ?`)
    .get(id) as SqlRow | undefined;
  if (!row) return null;
  return fingerprint(rowToWorkRecord(row));
}

function applicationHasDirectSourceEvidence(
  application: WorkImportManifest["applications"][number]
) {
  return Boolean(
    application.provenance.sourceArtifactId ||
    application.provenance.evidence.length > 0
  );
}

function eventHasDirectSourceEvidence(
  event: WorkImportManifest["applicationEvents"][number]
) {
  return Boolean(
    event.sourceArtifactId ||
    event.provenance.sourceArtifactId ||
    event.provenance.evidence.length > 0
  );
}

export function orderedApplicationEvents(
  manifest: WorkImportManifest,
  applicationRef: string
) {
  return manifest.applicationEvents
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.applicationRef === applicationRef)
    .sort(
      (left, right) =>
        left.event.occurredAt.localeCompare(right.event.occurredAt) ||
        left.index - right.index
    )
    .map(({ event }) => event);
}

function verifyArtifactReference(input: {
  ownerUserId: string;
  artifactId: string;
  artifactVersionId: string | null;
  contentSha256: string;
}) {
  const owner = getEntityOwnerId("artifact", input.artifactId);
  if (owner && owner !== input.ownerUserId) {
    throw new HttpError(
      403,
      "work_import_artifact_owner_mismatch",
      "An Artifact reference belongs to another Forge owner."
    );
  }
  const row = input.artifactVersionId
    ? (getDatabase()
        .prepare(
          `SELECT artifact_id, content_sha256
           FROM artifact_versions
           WHERE id = ? AND artifact_id = ?`
        )
        .get(input.artifactVersionId, input.artifactId) as
        | { artifact_id: string; content_sha256: string }
        | undefined)
    : (getDatabase()
        .prepare(
          "SELECT id AS artifact_id, content_sha256 FROM artifacts WHERE id = ?"
        )
        .get(input.artifactId) as
        | { artifact_id: string; content_sha256: string }
        | undefined);
  if (!row || row.content_sha256 !== input.contentSha256) {
    throw new HttpError(
      409,
      "work_import_artifact_integrity",
      "An Artifact reference is missing or does not match its declared checksum."
    );
  }
}

function resolveOrganizations(manifest: WorkImportManifest): Resolution[] {
  return manifest.organizations.map((organization, index) => {
    if (organization.id) {
      const exact = getDatabase()
        .prepare(
          `SELECT id, owner_user_id, normalized_name, deleted_at
           FROM work_organizations WHERE id = ? LIMIT 1`
        )
        .get(organization.id) as
        | {
            id: string;
            owner_user_id: string;
            normalized_name: string;
            deleted_at: string | null;
          }
        | undefined;
      if (exact) {
        if (
          exact.owner_user_id !== manifest.ownerUserId ||
          exact.normalized_name !== normalized(organization.name) ||
          exact.deleted_at !== null
        ) {
          throw new HttpError(
            409,
            "work_import_organization_identity_conflict",
            `Work Organization ${organization.id} already exists with a different owner or canonical name.`
          );
        }
        return {
          ref: itemRef("organization", index, organization),
          action: "reference",
          existingId: exact.id
        };
      }
    }
    const match = getDatabase()
      .prepare(
        `SELECT id FROM work_organizations
         WHERE owner_user_id = ? AND normalized_name = ? AND deleted_at IS NULL
         LIMIT 1`
      )
      .get(manifest.ownerUserId, normalized(organization.name)) as
      | { id: string }
      | undefined;
    return {
      ref: itemRef("organization", index, organization),
      action: match ? "reference" : "create",
      existingId: match?.id ?? null
    };
  });
}

function resolutionIdMap(resolutions: Resolution[]) {
  return new Map(
    resolutions.flatMap((resolution) =>
      resolution.existingId ? [[resolution.ref, resolution.existingId]] : []
    )
  );
}

function resolveEngagements(
  manifest: WorkImportManifest,
  organizationResolutions: Resolution[]
): Resolution[] {
  const organizations = resolutionIdMap(organizationResolutions);
  return manifest.engagements.map((engagement, index) => {
    if (engagement.id) {
      const exact = getDatabase()
        .prepare(
          `SELECT id, owner_user_id, title, organization_id, start_date, deleted_at
           FROM work_engagements WHERE id = ? LIMIT 1`
        )
        .get(engagement.id) as
        | {
            id: string;
            owner_user_id: string;
            title: string;
            organization_id: string | null;
            start_date: string | null;
            deleted_at: string | null;
          }
        | undefined;
      if (exact) {
        const expectedOrganization = engagement.organizationId
          ? (organizations.get(engagement.organizationId) ??
            engagement.organizationId)
          : null;
        if (
          exact.owner_user_id !== manifest.ownerUserId ||
          normalized(exact.title) !== normalized(engagement.title) ||
          exact.organization_id !== expectedOrganization ||
          exact.start_date !== (engagement.startDate ?? null) ||
          exact.deleted_at !== null
        ) {
          throw new HttpError(
            409,
            "work_import_engagement_identity_conflict",
            `Work Engagement ${engagement.id} already exists with different owner or identity facts.`
          );
        }
        return {
          ref: itemRef("engagement", index, engagement),
          action: "reference",
          existingId: exact.id
        };
      }
    }
    const candidates = getDatabase()
      .prepare(
        `SELECT id, organization_id, start_date
         FROM work_engagements
         WHERE owner_user_id = ?
           AND forge_nfkc_lower(title) = forge_nfkc_lower(?)
           AND deleted_at IS NULL`
      )
      .all(manifest.ownerUserId, engagement.title) as Array<{
      id: string;
      organization_id: string | null;
      start_date: string | null;
    }>;
    const match = candidates.find(
      (candidate) =>
        (engagement.startDate ?? null) === candidate.start_date &&
        (!engagement.organizationId ||
          (organizations.get(engagement.organizationId) ??
            engagement.organizationId) === candidate.organization_id)
    );
    return {
      ref: itemRef("engagement", index, engagement),
      action: match ? "reference" : "create",
      existingId: match?.id ?? null
    };
  });
}

function resolveCampaigns(manifest: WorkImportManifest): Resolution[] {
  return manifest.campaigns.map((campaign, index) => {
    if (campaign.id) {
      const exact = getDatabase()
        .prepare(
          `SELECT id, owner_user_id, title, active_from, active_until, deleted_at
           FROM opportunity_campaigns WHERE id = ? LIMIT 1`
        )
        .get(campaign.id) as
        | {
            id: string;
            owner_user_id: string;
            title: string;
            active_from: string | null;
            active_until: string | null;
            deleted_at: string | null;
          }
        | undefined;
      if (exact) {
        if (
          exact.owner_user_id !== manifest.ownerUserId ||
          normalized(exact.title) !== normalized(campaign.title) ||
          exact.active_from !== (campaign.activeFrom ?? null) ||
          exact.active_until !== (campaign.activeUntil ?? null) ||
          exact.deleted_at !== null
        ) {
          throw new HttpError(
            409,
            "work_import_campaign_identity_conflict",
            `Opportunity Campaign ${campaign.id} already exists with different owner or identity facts.`
          );
        }
        return {
          ref: itemRef("campaign", index, campaign),
          action: "reference",
          existingId: exact.id
        };
      }
    }
    const match = getDatabase()
      .prepare(
        `SELECT id FROM opportunity_campaigns
         WHERE owner_user_id = ?
           AND forge_nfkc_lower(title) = forge_nfkc_lower(?)
           AND COALESCE(active_from, '') = COALESCE(?, '')
           AND COALESCE(active_until, '') = COALESCE(?, '')
           AND deleted_at IS NULL
         LIMIT 1`
      )
      .get(
        manifest.ownerUserId,
        campaign.title,
        campaign.activeFrom ?? null,
        campaign.activeUntil ?? null
      ) as { id: string } | undefined;
    return {
      ref: itemRef("campaign", index, campaign),
      action: match ? "reference" : "create",
      existingId: match?.id ?? null
    };
  });
}

function resolveOpportunities(manifest: WorkImportManifest): Resolution[] {
  return manifest.opportunities.map((opportunity, index) => {
    if (opportunity.id) {
      const exact = getDatabase()
        .prepare(
          `SELECT id, owner_user_id, dedupe_key, deleted_at
           FROM job_opportunities WHERE id = ? LIMIT 1`
        )
        .get(opportunity.id) as
        | {
            id: string;
            owner_user_id: string;
            dedupe_key: string;
            deleted_at: string | null;
          }
        | undefined;
      if (exact) {
        if (
          exact.owner_user_id !== manifest.ownerUserId ||
          exact.dedupe_key !== opportunityDedupeKey(opportunity) ||
          exact.deleted_at !== null
        ) {
          throw new HttpError(
            409,
            "work_import_opportunity_identity_conflict",
            `Job Opportunity ${opportunity.id} already exists with a different owner or dedupe identity.`
          );
        }
        return {
          ref: itemRef("opportunity", index, opportunity),
          action: "reference",
          existingId: exact.id
        };
      }
    }
    const match = findJobOpportunityDuplicate(
      manifest.ownerUserId,
      opportunity
    );
    return {
      ref: itemRef("opportunity", index, opportunity),
      action: match ? "reference" : "create",
      existingId: match?.id ?? null
    };
  });
}

function resolveApplications(
  manifest: WorkImportManifest,
  opportunityResolutions: Resolution[]
): Resolution[] {
  const opportunities = resolutionIdMap(opportunityResolutions);
  return manifest.applications.map((application, index) => {
    const opportunityId =
      opportunities.get(application.opportunityId) ?? application.opportunityId;
    if (application.id) {
      const exact = getDatabase()
        .prepare(
          `SELECT id, owner_user_id, opportunity_id, account_reference, deleted_at
           FROM job_applications WHERE id = ? LIMIT 1`
        )
        .get(application.id) as
        | {
            id: string;
            owner_user_id: string;
            opportunity_id: string;
            account_reference: string;
            deleted_at: string | null;
          }
        | undefined;
      if (exact) {
        if (
          exact.owner_user_id !== manifest.ownerUserId ||
          exact.opportunity_id !== opportunityId ||
          exact.account_reference !== application.accountReference ||
          exact.deleted_at !== null
        ) {
          throw new HttpError(
            409,
            "work_import_application_identity_conflict",
            `Application ${application.id} already exists with a different owner, Opportunity, or account route.`
          );
        }
        return {
          ref: itemRef("application", index, application),
          action: "reference",
          existingId: exact.id
        };
      }
    }
    const terminal = CLOSED_APPLICATION_STATUSES.has(application.status);
    const candidates = getDatabase()
      .prepare(
        terminal
          ? `SELECT id FROM job_applications
             WHERE owner_user_id = ? AND opportunity_id = ?
               AND account_reference = ? AND status = ?
               AND COALESCE(reapplication_date, '') = COALESCE(?, '')
               AND deleted_at IS NULL
             ORDER BY updated_at DESC, id ASC
             LIMIT 2`
          : `SELECT id FROM job_applications
             WHERE owner_user_id = ? AND opportunity_id = ?
               AND account_reference = ? AND deleted_at IS NULL
               AND status NOT IN ('declined_by_candidate','withdrawn','rejected','ghosted','closed')
             ORDER BY updated_at DESC, id ASC
             LIMIT 2`
      )
      .all(
        ...(terminal
          ? [
              manifest.ownerUserId,
              opportunityId,
              application.accountReference,
              application.status,
              application.reapplicationDate ?? null
            ]
          : [manifest.ownerUserId, opportunityId, application.accountReference])
      ) as Array<{ id: string }>;
    if (terminal && candidates.length > 1) {
      throw new HttpError(
        409,
        "work_import_application_identity_ambiguous",
        "Several historical applications match the same Opportunity, account route, status, and reapplication date. Give each imported historical application a stable id."
      );
    }
    const match = candidates[0];
    return {
      ref: itemRef("application", index, application),
      action: match ? "reference" : "create",
      existingId: match?.id ?? null
    };
  });
}

function classificationCounts(resolutions: Record<string, Resolution[]>) {
  return Object.fromEntries(
    Object.entries(resolutions).map(([key, values]) => [
      key,
      {
        create: values.filter((value) => value.action === "create").length,
        reference: values.filter((value) => value.action === "reference").length
      }
    ])
  );
}

export function previewWorkImport(
  access: WorkAccess,
  manifest: WorkImportManifest
) {
  if (!access.operator) {
    throw new HttpError(
      403,
      "work_import_operator_required",
      "Work imports require an authenticated local operator session."
    );
  }
  if (manifest.ownerUserId !== access.mutationOwnerUserId) {
    throw new HttpError(
      403,
      "work_import_owner_mismatch",
      "The import manifest owner must match the selected Forge owner."
    );
  }
  assertNoProhibitedPrivateData(manifest);
  for (const [index, application] of manifest.applications.entries()) {
    const protectedPath = findProtectedApplicantField(
      application.representations
    );
    if (protectedPath) {
      throw new HttpError(
        400,
        "work_import_protected_demographic",
        `Application ${index + 1} contains a protected demographic representation at representations.${protectedPath.join(".")}.`
      );
    }
  }
  assertConfirmedContacts(manifest);
  for (const reference of manifest.artifactReferences) {
    verifyArtifactReference({
      ownerUserId: manifest.ownerUserId,
      artifactId: reference.artifactId,
      artifactVersionId: reference.artifactVersionId,
      contentSha256: reference.contentSha256
    });
  }
  const organizations = resolveOrganizations(manifest);
  const engagements = resolveEngagements(manifest, organizations);
  const campaigns = resolveCampaigns(manifest);
  const opportunities = resolveOpportunities(manifest);
  const applications = resolveApplications(manifest, opportunities);
  const resolutions = {
    organizations,
    engagements,
    campaigns,
    opportunities,
    applications
  };
  const rootGroups = [
    ["work_organization", organizations],
    ["work_engagement", engagements],
    ["opportunity_campaign", campaigns],
    ["job_opportunity", opportunities],
    ["job_application", applications]
  ] as const;
  const rootRefTypes = new Map<string, string>();
  for (const [entityType, group] of rootGroups) {
    for (const resolution of group) {
      const prior = rootRefTypes.get(resolution.ref);
      if (prior) {
        throw new HttpError(
          400,
          "work_import_reference_duplicate",
          `Manifest reference ${resolution.ref} is used by both ${prior} and ${entityType}.`
        );
      }
      rootRefTypes.set(resolution.ref, entityType);
    }
  }
  const criteriaByRef = new Map<
    string,
    WorkImportManifest["criteriaVersions"][number]
  >();
  for (const entry of manifest.criteriaVersions) {
    if (rootRefTypes.has(entry.ref) || criteriaByRef.has(entry.ref)) {
      throw new HttpError(
        400,
        "work_import_reference_duplicate",
        `Criteria reference ${entry.ref} is not unique inside this manifest.`
      );
    }
    criteriaByRef.set(entry.ref, entry);
  }
  const artifactRefs = new Map<string, string>();
  for (const entry of manifest.artifactReferences) {
    if (
      rootRefTypes.has(entry.ref) ||
      criteriaByRef.has(entry.ref) ||
      artifactRefs.has(entry.ref)
    ) {
      throw new HttpError(
        400,
        "work_import_reference_duplicate",
        `Artifact reference ${entry.ref} is not globally unique inside this manifest.`
      );
    }
    artifactRefs.set(entry.ref, entry.artifactId);
  }
  const referenceActions = new Map(
    Object.values(resolutions)
      .flat()
      .map((resolution) => [resolution.ref, resolution.action])
  );
  const resolutionsByRef = new Map(
    Object.values(resolutions)
      .flat()
      .map((resolution) => [resolution.ref, resolution] as const)
  );
  const requireRootRef = (
    value: string | null | undefined,
    expectedType: string,
    label: string
  ) => {
    if (!value) return;
    const manifestType = rootRefTypes.get(value);
    if (manifestType && manifestType !== expectedType) {
      throw new HttpError(
        400,
        "work_import_reference_type_mismatch",
        `${label} ${value} resolves to ${manifestType}, not ${expectedType}.`
      );
    }
    if (manifestType) return;
    const owner = getEntityOwnerId(expectedType, value);
    if (!owner || owner !== manifest.ownerUserId) {
      throw new HttpError(
        400,
        "work_import_reference_unresolved",
        `${label} ${value} does not resolve to an owned ${expectedType} record or manifest reference.`
      );
    }
  };
  const requireArtifactRef = (
    value: string | null | undefined,
    label: string
  ) => {
    if (!value) return;
    if (rootRefTypes.has(value) || criteriaByRef.has(value)) {
      throw new HttpError(
        400,
        "work_import_reference_type_mismatch",
        `${label} ${value} is not an Artifact reference.`
      );
    }
    assertAuthorizedWorkReference({
      access,
      entityType: "artifact",
      entityId: artifactRefs.get(value) ?? value
    });
  };
  const requireProvenanceArtifact = (
    provenance: WorkImportManifest["applications"][number]["provenance"],
    label: string
  ) => requireArtifactRef(provenance.sourceArtifactId, label);
  for (const engagement of manifest.engagements) {
    requireRootRef(
      engagement.organizationId,
      "work_organization",
      "Work Engagement organization reference"
    );
  }
  for (const campaign of manifest.campaigns) {
    requireRootRef(
      campaign.sourceEngagementId,
      "work_engagement",
      "Opportunity Campaign source engagement reference"
    );
  }
  for (const opportunity of manifest.opportunities) {
    requireRootRef(
      opportunity.organizationId,
      "work_organization",
      "Job Opportunity organization reference"
    );
    requireArtifactRef(
      opportunity.sourceSnapshotArtifactId,
      "Job Opportunity source snapshot Artifact"
    );
    requireProvenanceArtifact(
      opportunity.provenance,
      "Job Opportunity provenance Artifact"
    );
    for (const claim of opportunity.claimEvidence) {
      requireProvenanceArtifact(
        claim.provenance,
        "Job Opportunity claim-evidence Artifact"
      );
    }
  }
  for (const organization of manifest.organizations) {
    requireProvenanceArtifact(
      organization.provenance,
      "Work Organization provenance Artifact"
    );
  }
  for (const engagement of manifest.engagements) {
    requireProvenanceArtifact(
      engagement.provenance,
      "Work Engagement provenance Artifact"
    );
  }
  for (const campaign of manifest.campaigns) {
    requireProvenanceArtifact(
      campaign.provenance,
      "Opportunity Campaign provenance Artifact"
    );
  }
  for (const criteria of manifest.criteriaVersions) {
    requireProvenanceArtifact(
      criteria.value.provenance,
      "Campaign Criteria provenance Artifact"
    );
  }
  for (const target of manifest.organizationTargets) {
    requireRootRef(
      target.value.organizationId,
      "work_organization",
      "Organization Target reference"
    );
  }
  for (const [
    applicationIndex,
    application
  ] of manifest.applications.entries()) {
    requireRootRef(
      application.opportunityId,
      "job_opportunity",
      "Job Application Opportunity reference"
    );
    requireRootRef(
      application.primaryCampaignId,
      "opportunity_campaign",
      "Job Application primary campaign reference"
    );
    requireProvenanceArtifact(
      application.provenance,
      "Job Application provenance Artifact"
    );
    const applicationRef = applications[applicationIndex]?.ref;
    const events = applicationRef
      ? orderedApplicationEvents(manifest, applicationRef)
      : [];
    let currentStatus: string | null = null;
    let statusObserved = false;
    for (const event of events) {
      requireArtifactRef(
        event.sourceArtifactId,
        "Application Event evidence Artifact"
      );
      requireProvenanceArtifact(
        event.provenance,
        "Application Event provenance Artifact"
      );
      if (currentStatus === null && event.priorStatus) {
        currentStatus = event.priorStatus;
      } else if (
        currentStatus !== null &&
        event.priorStatus !== null &&
        event.priorStatus !== currentStatus
      ) {
        throw new HttpError(
          409,
          "work_import_application_history_disconnected",
          `Application history ${applicationRef} expects ${event.priorStatus} after ${currentStatus}.`
        );
      }
      if (event.newStatus) {
        if (
          currentStatus !== null &&
          event.newStatus !== currentStatus &&
          !(applicationTransitions[currentStatus] ?? []).includes(
            event.newStatus
          )
        ) {
          throw new HttpError(
            409,
            "work_import_application_transition_invalid",
            `Application history ${applicationRef} contains the unsupported transition ${currentStatus} to ${event.newStatus}. Use a null prior status for an evidence-backed partial historical snapshot.`
          );
        }
        if (
          EVIDENCE_BOUND_APPLICATION_STATUSES.has(event.newStatus) &&
          !eventHasDirectSourceEvidence(event)
        ) {
          throw new HttpError(
            400,
            "work_import_application_status_evidence_required",
            `Application history ${applicationRef} establishes ${event.newStatus} without an evidence Artifact or explicit provenance evidence.`
          );
        }
        currentStatus = event.newStatus;
        statusObserved = true;
      }
    }
    if (statusObserved && currentStatus !== application.status) {
      throw new HttpError(
        409,
        "work_import_application_status_mismatch",
        `Application ${applicationRef} ends at ${currentStatus}, but its current status is ${application.status}.`
      );
    }
    if (
      EVIDENCE_BOUND_APPLICATION_STATUSES.has(application.status) &&
      !applicationHasDirectSourceEvidence(application) &&
      !events.some(
        (event) =>
          event.newStatus === application.status &&
          eventHasDirectSourceEvidence(event)
      )
    ) {
      throw new HttpError(
        400,
        "work_import_application_status_evidence_required",
        `Application ${applicationRef} requires an evidence Artifact or explicit provenance evidence for imported status ${application.status}.`
      );
    }
    if (!application.criteriaVersionId) {
      const campaignResolution = resolutionsByRef.get(
        application.primaryCampaignId
      );
      const campaignIndex = campaigns.findIndex(
        (resolution) => resolution.ref === application.primaryCampaignId
      );
      const campaignInput =
        campaignIndex >= 0 ? manifest.campaigns[campaignIndex] : undefined;
      const hasImportedCriteria = manifest.criteriaVersions.some(
        (entry) => entry.campaignRef === application.primaryCampaignId
      );
      const existingCampaignId =
        campaignResolution?.existingId ??
        (campaignResolution ? null : application.primaryCampaignId);
      const hasExistingCriteria = existingCampaignId
        ? Boolean(
            getDatabase()
              .prepare(
                `SELECT 1 AS present FROM campaign_criteria_versions
                 WHERE campaign_id = ? LIMIT 1`
              )
              .get(existingCampaignId)
          )
        : false;
      const hasCreatedCampaignInitialCriteria = Boolean(
        campaignResolution?.action === "create" &&
        campaignInput?.initialCriteria
      );
      if (
        !hasCreatedCampaignInitialCriteria &&
        !hasImportedCriteria &&
        !hasExistingCriteria
      ) {
        throw new HttpError(
          409,
          "work_import_application_criteria_required",
          `Application ${applicationRef} has no exact criteria version available in its primary Opportunity Campaign.`
        );
      }
      continue;
    }
    const importedCriteria = criteriaByRef.get(application.criteriaVersionId);
    if (importedCriteria) {
      if (importedCriteria.campaignRef !== application.primaryCampaignId) {
        throw new HttpError(
          400,
          "work_import_criteria_campaign_mismatch",
          `Application criteria reference ${application.criteriaVersionId} belongs to another campaign.`
        );
      }
      continue;
    }
    const campaignResolution = resolutionsByRef.get(
      application.primaryCampaignId
    );
    const campaignId =
      campaignResolution?.existingId ?? application.primaryCampaignId;
    const existingCriteria = getDatabase()
      .prepare(
        `SELECT id FROM campaign_criteria_versions
         WHERE id = ? AND campaign_id = ? LIMIT 1`
      )
      .get(application.criteriaVersionId, campaignId);
    if (!existingCriteria) {
      throw new HttpError(
        400,
        "work_import_criteria_reference_unresolved",
        `Application criteria reference ${application.criteriaVersionId} does not resolve to its primary campaign.`
      );
    }
  }
  const earlierImportedTerminalKeys = new Set<string>();
  const importedActiveKeys = new Set<string>();
  for (const [index, application] of manifest.applications.entries()) {
    const resolution = applications[index];
    const opportunityResolution = resolutionsByRef.get(
      application.opportunityId
    );
    const opportunityId =
      opportunityResolution?.existingId ?? application.opportunityId;
    const applicationKey = fingerprint([
      opportunityId,
      application.accountReference
    ]);
    if (
      resolution?.action === "create" &&
      !CLOSED_APPLICATION_STATUSES.has(application.status)
    ) {
      if (importedActiveKeys.has(applicationKey)) {
        throw new HttpError(
          409,
          "work_import_duplicate_active_application",
          "The manifest contains more than one active application for the same Opportunity and account route."
        );
      }
      importedActiveKeys.add(applicationKey);
    }
    if (resolution?.action === "create") {
      const priorPersisted = getDatabase()
        .prepare(
          `SELECT 1 AS present FROM job_applications
           WHERE owner_user_id = ? AND opportunity_id = ?
             AND account_reference = ?
             AND status IN ('declined_by_candidate','withdrawn','rejected','ghosted','closed')
             AND deleted_at IS NULL
           LIMIT 1`
        )
        .get(manifest.ownerUserId, opportunityId, application.accountReference);
      const hasPrior =
        Boolean(priorPersisted) ||
        earlierImportedTerminalKeys.has(applicationKey);
      if (hasPrior && !application.reapplicationReason.trim()) {
        throw new HttpError(
          409,
          "work_import_reapplication_reason_required",
          `Application ${resolution.ref} follows a terminal application for the same Opportunity and account route and requires a reviewed reapplication reason.`
        );
      }
      if (!hasPrior && application.reapplicationReason.trim()) {
        throw new HttpError(
          409,
          "work_import_reapplication_prior_record_required",
          `Application ${resolution.ref} declares a reapplication reason without an earlier terminal application in Forge or earlier in this manifest.`
        );
      }
    }
    if (CLOSED_APPLICATION_STATUSES.has(application.status)) {
      earlierImportedTerminalKeys.add(applicationKey);
    }
  }
  for (const reference of manifest.artifactReferences) {
    requireProvenanceArtifact(
      reference.provenance,
      "Application Artifact-use provenance Artifact"
    );
  }
  for (const link of manifest.links) {
    const sourceManifestType = rootRefTypes.get(link.sourceRef);
    if (sourceManifestType && sourceManifestType !== link.sourceType) {
      throw new HttpError(
        400,
        "work_import_reference_type_mismatch",
        `Relationship source ${link.sourceRef} resolves to ${sourceManifestType}, not ${link.sourceType}.`
      );
    }
    if (!sourceManifestType) {
      assertAuthorizedWorkReference({
        access,
        entityType: link.sourceType,
        entityId: link.sourceRef
      });
    }
    const targetManifestType = rootRefTypes.get(link.link.targetEntityId);
    const targetArtifactId = artifactRefs.get(link.link.targetEntityId);
    if (
      targetManifestType &&
      targetManifestType !== link.link.targetEntityType
    ) {
      throw new HttpError(
        400,
        "work_import_reference_type_mismatch",
        `Relationship target ${link.link.targetEntityId} resolves to ${targetManifestType}, not ${link.link.targetEntityType}.`
      );
    }
    if (targetArtifactId && link.link.targetEntityType !== "artifact") {
      throw new HttpError(
        400,
        "work_import_reference_type_mismatch",
        `Relationship target ${link.link.targetEntityId} is an Artifact reference, not ${link.link.targetEntityType}.`
      );
    }
    if (!targetManifestType && !targetArtifactId) {
      assertAuthorizedWorkReference({
        access,
        entityType: link.link.targetEntityType,
        entityId: link.link.targetEntityId
      });
    }
  }
  for (const value of [
    ...manifest.criteriaVersions.map((entry) => ({
      ref: entry.campaignRef,
      kind: "criteria version",
      expectedType: "opportunity_campaign"
    })),
    ...manifest.roleTargets.map((entry) => ({
      ref: entry.campaignRef,
      kind: "role target",
      expectedType: "opportunity_campaign"
    })),
    ...manifest.organizationTargets.map((entry) => ({
      ref: entry.campaignRef,
      kind: "organization target",
      expectedType: "opportunity_campaign"
    })),
    ...manifest.applicationEvents.map((entry) => ({
      ref: entry.applicationRef,
      kind: "application event",
      expectedType: "job_application"
    })),
    ...manifest.artifactReferences.flatMap((entry) =>
      entry.applicationRef
        ? [
            {
              ref: entry.applicationRef,
              kind: "application Artifact use",
              expectedType: "job_application"
            }
          ]
        : []
    )
  ]) {
    if (!referenceActions.has(value.ref)) {
      throw new HttpError(
        400,
        "work_import_reference_unresolved",
        `The ${value.kind} reference ${value.ref} does not resolve inside this manifest.`
      );
    }
    if (rootRefTypes.get(value.ref) !== value.expectedType) {
      throw new HttpError(
        400,
        "work_import_reference_type_mismatch",
        `The ${value.kind} reference ${value.ref} does not resolve to ${value.expectedType}.`
      );
    }
    if (referenceActions.get(value.ref) === "reference") {
      throw new HttpError(
        409,
        "work_import_insert_only_conflict",
        `The ${value.kind} would add child data to matched existing record ${value.ref}; insert-only import permits only new links to matched records.`
      );
    }
  }
  const manifestDigest = fingerprint(manifest);
  const warnings: string[] = [];
  const existingSettings = getDatabase()
    .prepare(
      "SELECT looking_for_opportunities FROM work_settings WHERE owner_user_id = ?"
    )
    .get(manifest.ownerUserId) as
    | { looking_for_opportunities: number }
    | undefined;
  if (
    manifest.lookingForOpportunities !== undefined &&
    existingSettings &&
    Boolean(existingSettings.looking_for_opportunities) !==
      manifest.lookingForOpportunities
  ) {
    warnings.push(
      "Existing Work settings are reference-only and will not be overwritten by this import."
    );
  }
  const previewCore = {
    schemaVersion: 1,
    sourceDigest: manifest.source.digest,
    manifestDigest,
    ownerUserId: manifest.ownerUserId,
    counts: {
      ...classificationCounts(resolutions),
      criteriaVersions: manifest.criteriaVersions.length,
      roleTargets: manifest.roleTargets.length,
      organizationTargets: manifest.organizationTargets.length,
      applicationEvents: manifest.applicationEvents.length,
      links: manifest.links.length,
      artifactReferences: manifest.artifactReferences.length
    },
    resolutions,
    warnings,
    subjectiveMetricObservations: 0,
    rollbackClassification: WORK_IMPORT_ROLLBACK_CLASSIFICATION
  };
  return {
    ...previewCore,
    previewDigest: fingerprint(previewCore),
    readyToApply: true
  };
}
