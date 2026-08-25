import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import type { WorkAccess } from "./access.js";
import { assertScopeAssignment } from "./access.js";
import {
  assertAuthorizedWorkReference,
  fingerprint,
  getAuthorizedRoot,
  getOperationReceipt,
  listAuthorizedWorkLinks,
  newWorkId,
  nowIso,
  recordWorkActivity,
  registerWorkRoot,
  rowToWorkRecord,
  storeOperationReceipt,
  type SqlRow
} from "./repository-helpers.js";
import {
  hasMaterialValue,
  insertRow,
  json,
  scopeColumns,
  updateRevisionedRow
} from "./repository-write-helpers.js";
import type {
  CreateJobApplicationInput,
  RecordJobApplicationEventInput,
  UpdateJobApplicationInput
} from "./types.js";

export const applicationTransitions: Record<string, readonly string[]> = {
  planned: ["preparing", "withdrawn", "closed"],
  preparing: ["blocked_on_user_input", "ready_for_review", "withdrawn"],
  blocked_on_user_input: ["preparing", "ready_for_review", "withdrawn"],
  ready_for_review: ["preparing", "ready_to_submit", "withdrawn"],
  ready_to_submit: ["preparing", "submitted", "withdrawn"],
  submitted: ["acknowledged", "screening", "rejected", "ghosted", "withdrawn"],
  acknowledged: [
    "screening",
    "interviewing",
    "assessment",
    "rejected",
    "ghosted",
    "withdrawn"
  ],
  screening: ["interviewing", "assessment", "rejected", "ghosted", "withdrawn"],
  interviewing: [
    "assessment",
    "references",
    "offer",
    "rejected",
    "ghosted",
    "withdrawn"
  ],
  assessment: [
    "interviewing",
    "references",
    "offer",
    "rejected",
    "ghosted",
    "withdrawn"
  ],
  references: ["offer", "rejected", "ghosted", "withdrawn"],
  offer: ["accepted", "declined_by_candidate", "withdrawn", "closed"],
  accepted: ["closed"],
  declined_by_candidate: ["closed"],
  withdrawn: ["closed"],
  rejected: ["closed"],
  ghosted: ["screening", "interviewing", "rejected", "closed"],
  closed: []
};

function assertOwnedApplicationReference(
  table: "candidate_positioning_profiles" | "candidate_document_sets",
  id: string | null | undefined,
  access: WorkAccess
) {
  if (!id) return;
  const row = getDatabase()
    .prepare(`SELECT owner_user_id FROM ${table} WHERE id = ? LIMIT 1`)
    .get(id) as { owner_user_id: string } | undefined;
  if (!row || row.owner_user_id !== access.mutationOwnerUserId) {
    throw new HttpError(
      404,
      "work_application_reference_not_found",
      "The selected application profile or document set was not found for this Work owner."
    );
  }
}

export function createJobApplication(
  access: WorkAccess,
  input: CreateJobApplicationInput
) {
  assertScopeAssignment(access, input.scope);
  if (
    ![
      "planned",
      "preparing",
      "blocked_on_user_input",
      "ready_for_review",
      "ready_to_submit"
    ].includes(input.status)
  ) {
    throw new HttpError(
      409,
      "work_application_transition_required",
      "Create an application in a preparation stage, then use verified lifecycle transitions for later stages."
    );
  }
  getAuthorizedRoot("job_opportunity", input.opportunityId, access);
  getAuthorizedRoot("opportunity_campaign", input.primaryCampaignId, access);
  const criteriaVersion = input.criteriaVersionId
    ? (getDatabase()
        .prepare(
          `SELECT id FROM campaign_criteria_versions
           WHERE id = ? AND campaign_id = ? LIMIT 1`
        )
        .get(input.criteriaVersionId, input.primaryCampaignId) as
        | { id: string }
        | undefined)
    : (getDatabase()
        .prepare(
          `SELECT id FROM campaign_criteria_versions
           WHERE campaign_id = ?
           ORDER BY version DESC LIMIT 1`
        )
        .get(input.primaryCampaignId) as { id: string } | undefined);
  if (!criteriaVersion) {
    throw new HttpError(
      409,
      "work_application_criteria_required",
      "A Job Application must preserve an exact criteria version from its primary Opportunity Campaign."
    );
  }
  if (
    !access.canPrivateApplication &&
    [
      input.applicationRoute,
      input.accountReference,
      input.privateContacts,
      input.documentSetId,
      input.representations,
      input.unresolvedUserFacts,
      input.employerReason,
      input.inferredExplanation,
      input.lessons
    ].some(hasMaterialValue)
  ) {
    throw new HttpError(
      403,
      "work_private_application_scope_required",
      "Writing private application details requires Work transmission authority."
    );
  }
  if (
    input.candidateUserId &&
    input.candidateUserId !== access.mutationOwnerUserId
  ) {
    throw new HttpError(
      403,
      "work_candidate_owner_mismatch",
      "A Job Application candidate must match the selected Work owner."
    );
  }
  assertOwnedApplicationReference(
    "candidate_positioning_profiles",
    input.positioningProfileId,
    access
  );
  assertOwnedApplicationReference(
    "candidate_document_sets",
    input.documentSetId,
    access
  );
  const active = getDatabase()
    .prepare(
      `SELECT id FROM job_applications
    WHERE owner_user_id = ? AND opportunity_id = ? AND account_reference = ? AND deleted_at IS NULL
      AND status NOT IN ('declined_by_candidate', 'withdrawn', 'rejected', 'ghosted', 'closed') LIMIT 1`
    )
    .get(
      access.mutationOwnerUserId,
      input.opportunityId,
      input.accountReference
    ) as { id: string } | undefined;
  if (active)
    throw new HttpError(
      409,
      "work_duplicate_application",
      "An active application already exists for this opportunity and account route.",
      { applicationId: active.id }
    );
  const terminal = getDatabase()
    .prepare(
      `SELECT id FROM job_applications
    WHERE owner_user_id = ? AND opportunity_id = ? AND account_reference = ?
      AND status IN ('declined_by_candidate','withdrawn','rejected','ghosted','closed')
      AND deleted_at IS NULL
    ORDER BY COALESCE(closed_at, updated_at) DESC, id ASC LIMIT 1`
    )
    .get(
      access.mutationOwnerUserId,
      input.opportunityId,
      input.accountReference
    ) as { id: string } | undefined;
  if (terminal && !input.reapplicationReason.trim()) {
    throw new HttpError(
      409,
      "work_reapplication_reason_required",
      "A reviewed reapplication reason is required for this prior terminal application."
    );
  }
  if (!terminal && input.reapplicationReason.trim()) {
    throw new HttpError(
      409,
      "work_reapplication_prior_record_required",
      "A reapplication reason can be recorded only when a prior terminal application exists for this opportunity and account route."
    );
  }
  const id = input.id ?? newWorkId("japp");
  const now = nowIso();
  return runInTransaction(() => {
    insertRow("job_applications", {
      id,
      owner_user_id: access.mutationOwnerUserId,
      opportunity_id: input.opportunityId,
      primary_campaign_id: input.primaryCampaignId,
      criteria_version_id: criteriaVersion.id,
      candidate_user_id: input.candidateUserId ?? access.mutationOwnerUserId,
      application_route_json: json(input.applicationRoute),
      account_reference: input.accountReference,
      status: input.status,
      started_at: input.status === "planned" ? null : now,
      submitted_at: null,
      acknowledged_at: null,
      last_contact_at: input.lastContactAt ?? null,
      next_follow_up_at: input.nextFollowUpAt ?? null,
      decision_deadline: input.decisionDeadline ?? null,
      expected_response_at: input.expectedResponseAt ?? null,
      closed_at: null,
      next_action: input.nextAction,
      owner_label: input.ownerLabel,
      blocker: input.blocker,
      priority: input.priority,
      referral_state: input.referralState,
      private_contacts_json: json(input.privateContacts),
      positioning_profile_id: input.positioningProfileId,
      document_set_id: input.documentSetId,
      representations_json: json(input.representations),
      unresolved_user_facts_json: json(input.unresolvedUserFacts),
      confirmation_receipt: "",
      tracking_identifier: "",
      outcome: "",
      reapplication_of_application_id: terminal?.id ?? null,
      reapplication_reason: terminal ? input.reapplicationReason : "",
      reapplication_reviewed_at: terminal ? now : null,
      employer_reason: input.employerReason,
      inferred_explanation: input.inferredExplanation,
      lessons: input.lessons,
      reapplication_date: input.reapplicationDate ?? null,
      ...scopeColumns(input.scope),
      provenance_json: json(input.provenance),
      revision: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      import_receipt_id: null
    });
    insertRow("application_events", {
      id: newWorkId("jaevt"),
      application_id: id,
      event_type: "created",
      prior_status: null,
      new_status: input.status,
      occurred_at: now,
      actor_json: json(access.actor),
      source_artifact_id: null,
      factual_description: terminal
        ? `Reapplication workspace created after reviewed prior application ${terminal.id}.`
        : "Application workspace created.",
      outcome: "",
      next_action: input.nextAction,
      due_at: null,
      confidence: 1,
      provenance_json: json(input.provenance),
      created_at: now,
      import_receipt_id: null
    });
    registerWorkRoot("job_application", id, access.mutationOwnerUserId);
    recordWorkActivity({
      entityType: "job_application",
      entityId: id,
      eventType: "job_application_created",
      title: "Application workspace created",
      actor: access.actor
    });
    return getJobApplicationDetail(access, id);
  });
}

export function updateJobApplication(
  access: WorkAccess,
  id: string,
  input: UpdateJobApplicationInput
) {
  const before = getAuthorizedRoot("job_application", id, access);
  if (input.scope) assertScopeAssignment(access, input.scope);
  if (
    !access.canPrivateApplication &&
    [
      input.applicationRoute,
      input.accountReference,
      input.privateContacts,
      input.documentSetId,
      input.representations,
      input.unresolvedUserFacts,
      input.employerReason,
      input.inferredExplanation,
      input.lessons
    ].some((value) => value !== undefined)
  ) {
    throw new HttpError(
      403,
      "work_private_application_scope_required",
      "Updating private application details requires Work transmission authority."
    );
  }
  if (
    input.candidateUserId !== undefined &&
    input.candidateUserId !== access.mutationOwnerUserId
  ) {
    throw new HttpError(
      403,
      "work_candidate_owner_mismatch",
      "A Job Application candidate must match the selected Work owner."
    );
  }
  if (input.positioningProfileId !== undefined) {
    assertOwnedApplicationReference(
      "candidate_positioning_profiles",
      input.positioningProfileId,
      access
    );
  }
  if (input.documentSetId !== undefined) {
    assertOwnedApplicationReference(
      "candidate_document_sets",
      input.documentSetId,
      access
    );
  }
  const scalar: Record<string, string> = {
    candidateUserId: "candidate_user_id",
    accountReference: "account_reference",
    nextAction: "next_action",
    ownerLabel: "owner_label",
    blocker: "blocker",
    priority: "priority",
    referralState: "referral_state",
    positioningProfileId: "positioning_profile_id",
    documentSetId: "document_set_id",
    lastContactAt: "last_contact_at",
    nextFollowUpAt: "next_follow_up_at",
    decisionDeadline: "decision_deadline",
    expectedResponseAt: "expected_response_at",
    employerReason: "employer_reason",
    inferredExplanation: "inferred_explanation",
    lessons: "lessons",
    reapplicationDate: "reapplication_date"
  };
  const structured: Record<string, string> = {
    applicationRoute: "application_route_json",
    privateContacts: "private_contacts_json",
    representations: "representations_json",
    unresolvedUserFacts: "unresolved_user_facts_json",
    provenance: "provenance_json"
  };
  const data: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(scalar)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) data[column] = value;
  }
  for (const [key, column] of Object.entries(structured)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) data[column] = json(value);
  }
  if (input.scope) Object.assign(data, scopeColumns(input.scope));
  return runInTransaction(() => {
    updateRevisionedRow({
      table: "job_applications",
      id,
      expectedRevision: input.expectedRevision,
      data
    });
    insertRow("application_events", {
      id: newWorkId("jaevt"),
      application_id: id,
      event_type: "facts_updated",
      prior_status: before.status,
      new_status: before.status,
      occurred_at: nowIso(),
      actor_json: json(access.actor),
      source_artifact_id: null,
      factual_description: "Application workspace facts updated.",
      outcome: "",
      next_action: input.nextAction ?? before.nextAction ?? "",
      due_at:
        input.nextFollowUpAt === undefined
          ? (before.nextFollowUpAt ?? null)
          : input.nextFollowUpAt,
      confidence: 1,
      provenance_json: json(input.provenance ?? {}),
      created_at: nowIso(),
      import_receipt_id: null
    });
    recordWorkActivity({
      entityType: "job_application",
      entityId: id,
      eventType: "job_application_updated",
      title: "Application workspace updated",
      actor: access.actor,
      metadata: {
        beforeRevision: before.revision,
        afterRevision: Number(before.revision) + 1
      }
    });
    return getJobApplicationDetail(access, id);
  });
}

export function transitionJobApplication(input: {
  access: WorkAccess;
  id: string;
  expectedRevision: number;
  newStatus: string;
  factualDescription: string;
  outcome: string;
  nextAction: string;
  dueAt: string | null;
  sourceArtifactId: string | null;
  confidence: number | null;
  provenance: unknown;
  occurredAt?: string;
  verifiedSubmission?: boolean;
  verifiedOfferAcceptance?: boolean;
  confirmationReceipt?: string;
  trackingIdentifier?: string;
}) {
  const before = getAuthorizedRoot("job_application", input.id, input.access);
  assertAuthorizedWorkReference({
    access: input.access,
    entityType: "artifact",
    entityId: input.sourceArtifactId
  });
  const priorStatus = String(before.status);
  if (!(applicationTransitions[priorStatus] ?? []).includes(input.newStatus)) {
    throw new HttpError(
      409,
      "work_application_transition_invalid",
      `Application status cannot move from ${priorStatus} to ${input.newStatus}.`
    );
  }
  if (input.newStatus === "submitted" && !input.verifiedSubmission) {
    throw new HttpError(
      409,
      "work_verified_submission_required",
      "A prepared package cannot be marked submitted without an authorized preview and direct evidence."
    );
  }
  if (input.newStatus === "accepted" && !input.verifiedOfferAcceptance) {
    throw new HttpError(
      409,
      "work_verified_offer_acceptance_required",
      "An application can be marked accepted only by accepting a recorded offer and creating its planned Work Engagement."
    );
  }
  const occurredAt = input.occurredAt ?? nowIso();
  return runInTransaction(() => {
    const timestamps: Record<string, unknown> = {};
    if (input.newStatus === "submitted") timestamps.submitted_at = occurredAt;
    if (input.newStatus === "acknowledged")
      timestamps.acknowledged_at = occurredAt;
    if (
      [
        "declined_by_candidate",
        "withdrawn",
        "rejected",
        "ghosted",
        "closed"
      ].includes(input.newStatus)
    )
      timestamps.closed_at = occurredAt;
    const outcome = input.outcome.trim() ? { outcome: input.outcome } : {};
    const verifiedEvidence =
      input.newStatus === "submitted"
        ? {
            confirmation_receipt: input.confirmationReceipt ?? "",
            tracking_identifier: input.trackingIdentifier ?? ""
          }
        : {};
    updateRevisionedRow({
      table: "job_applications",
      id: input.id,
      expectedRevision: input.expectedRevision,
      data: {
        status: input.newStatus,
        next_action: input.nextAction,
        ...outcome,
        ...timestamps,
        ...verifiedEvidence
      }
    });
    insertRow("application_events", {
      id: newWorkId("jaevt"),
      application_id: input.id,
      event_type:
        input.newStatus === "submitted"
          ? "verified_submission"
          : "status_changed",
      prior_status: priorStatus,
      new_status: input.newStatus,
      occurred_at: occurredAt,
      actor_json: json(input.access.actor),
      source_artifact_id: input.sourceArtifactId,
      factual_description: input.factualDescription,
      outcome: input.outcome,
      next_action: input.nextAction,
      due_at: input.dueAt,
      confidence: input.confidence,
      provenance_json: json(input.provenance),
      created_at: nowIso(),
      import_receipt_id: null
    });
    recordWorkActivity({
      entityType: "job_application",
      entityId: input.id,
      eventType: "job_application_status_changed",
      title: `Application moved to ${input.newStatus.replaceAll("_", " ")}`,
      description: input.factualDescription,
      actor: input.access.actor
    });
    return getJobApplicationDetail(input.access, input.id);
  });
}

export function recordJobApplicationEvent(
  access: WorkAccess,
  id: string,
  input: RecordJobApplicationEventInput
) {
  const requestFingerprint = fingerprint({ id, input });
  const replay = getOperationReceipt({
    ownerUserId: access.mutationOwnerUserId,
    operationKind: "job_application_event",
    idempotencyKey: input.idempotencyKey,
    requestFingerprint
  });
  if (replay) {
    return {
      replayed: true,
      ...((replay.response as Record<string, unknown>) ?? {})
    };
  }
  const application = getAuthorizedRoot("job_application", id, access);
  assertAuthorizedWorkReference({
    access,
    entityType: "artifact",
    entityId: input.sourceArtifactId
  });
  const occurredAt = input.occurredAt ?? nowIso();
  const contactEvents = new Set([
    "email",
    "acknowledgement",
    "call",
    "interview",
    "assessment",
    "information_request",
    "follow_up",
    "withdrawal",
    "offer",
    "rejection"
  ]);
  return runInTransaction(() => {
    updateRevisionedRow({
      table: "job_applications",
      id,
      expectedRevision: input.expectedRevision,
      data: {
        ...(input.nextAction !== undefined
          ? { next_action: input.nextAction }
          : {}),
        ...(input.nextFollowUpAt !== undefined
          ? { next_follow_up_at: input.nextFollowUpAt }
          : {}),
        ...(contactEvents.has(input.eventType)
          ? { last_contact_at: occurredAt }
          : {})
      }
    });
    const eventId = newWorkId("jaevt");
    insertRow("application_events", {
      id: eventId,
      application_id: id,
      event_type: input.eventType,
      prior_status: application.status,
      new_status: application.status,
      occurred_at: occurredAt,
      actor_json: json(access.actor),
      source_artifact_id: input.sourceArtifactId,
      factual_description: input.factualDescription,
      outcome: input.outcome,
      next_action: input.nextAction ?? application.nextAction ?? "",
      due_at: input.dueAt ?? null,
      confidence: input.confidence,
      provenance_json: json(input.provenance),
      created_at: nowIso(),
      import_receipt_id: null
    });
    recordWorkActivity({
      entityType: "job_application",
      entityId: id,
      eventType: `job_application_${input.eventType}`,
      title: `Application ${input.eventType.replaceAll("_", " ")} recorded`,
      description: input.factualDescription,
      actor: access.actor,
      metadata: { eventId, occurredAt }
    });
    const response = {
      event: rowToWorkRecord(
        getDatabase()
          .prepare("SELECT * FROM application_events WHERE id = ?")
          .get(eventId) as SqlRow,
        access
      ),
      application: getJobApplicationDetail(access, id)
    };
    storeOperationReceipt({
      ownerUserId: access.mutationOwnerUserId,
      operationKind: "job_application_event",
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      response,
      createdRecords: [{ table: "application_events", id: eventId }]
    });
    return { replayed: false, ...response };
  });
}

export function getJobApplicationDetail(access: WorkAccess, id: string) {
  const application = getAuthorizedRoot("job_application", id, access);
  const events = getDatabase()
    .prepare(
      "SELECT * FROM application_events WHERE application_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 200"
    )
    .all(id) as SqlRow[];
  const questions = getDatabase()
    .prepare(
      "SELECT * FROM application_questions WHERE application_id = ? ORDER BY created_at ASC"
    )
    .all(id) as SqlRow[];
  const artifacts = getDatabase()
    .prepare(
      "SELECT * FROM application_artifact_uses WHERE application_id = ? ORDER BY used_at DESC"
    )
    .all(id) as SqlRow[];
  const interviews = getDatabase()
    .prepare(
      "SELECT * FROM job_interviews WHERE application_id = ? ORDER BY scheduled_start_at ASC, created_at ASC"
    )
    .all(id) as SqlRow[];
  const offers = getDatabase()
    .prepare(
      "SELECT * FROM job_offers WHERE application_id = ? ORDER BY created_at DESC"
    )
    .all(id) as SqlRow[];
  const transmissionPreviews = getDatabase()
    .prepare(
      "SELECT * FROM application_transmission_previews WHERE application_id = ? ORDER BY created_at DESC LIMIT 100"
    )
    .all(id) as SqlRow[];
  const projectedEvents = events.map((row) => rowToWorkRecord(row, access));
  if (!access.canPrivateApplication) {
    return {
      ...application,
      events: projectedEvents.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        priorStatus: event.priorStatus,
        newStatus: event.newStatus,
        occurredAt: event.occurredAt,
        nextAction: event.nextAction,
        dueAt: event.dueAt,
        confidence: event.confidence,
        createdAt: event.createdAt,
        redacted: true
      })),
      questions: [],
      artifactUses: [],
      interviews: [],
      offers: [],
      transmissionPreviews: [],
      privateApplicationDetailsRedacted: true,
      links: listAuthorizedWorkLinks("job_application", id, access)
    };
  }
  return {
    ...application,
    events: projectedEvents,
    questions: questions.map((row) => rowToWorkRecord(row, access)),
    artifactUses: artifacts.map((row) => rowToWorkRecord(row, access)),
    interviews: interviews.map((row) => rowToWorkRecord(row, access)),
    offers: offers.map((row) => rowToWorkRecord(row, access)),
    transmissionPreviews: transmissionPreviews.map((row) =>
      rowToWorkRecord(row, access)
    ),
    links: listAuthorizedWorkLinks("job_application", id, access)
  };
}
