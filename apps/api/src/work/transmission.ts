import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import type { AgentAction } from "../types.js";
import type { CollaborationContext } from "../repositories/collaboration.js";
import { getEntityOwnerId } from "../repositories/entity-ownership.js";
import type { WorkAccess } from "./access.js";
import {
  assertAuthorizedWorkReference,
  fingerprint,
  getAuthorizedRoot,
  getOperationReceipt,
  newWorkId,
  nowIso,
  rowToWorkRecord,
  storeOperationReceipt,
  type SqlRow
} from "./repository-helpers.js";

type TransmissionPreviewInput = {
  applicationId: string;
  destination: Record<string, unknown>;
  fields: Record<string, unknown>;
  answers: Array<Record<string, unknown>>;
  artifactVersions: Array<Record<string, unknown>>;
  representations: Record<string, unknown>;
  unresolvedGates: Array<Record<string, unknown>>;
  expiresInMinutes: number;
  idempotencyKey: string;
};

export type VerifiedArtifactVersion = {
  artifactId: string;
  artifactVersionId: string | null;
  versionNumber: number | null;
  contentSha256: string;
};

export type ApprovedTransmissionAnswer = {
  questionId: string;
  exactQuestion: string;
  answer: string;
};

function json(value: unknown) {
  return JSON.stringify(value ?? null);
}

function verifyArtifactVersions(
  artifactVersions: Array<Record<string, unknown>>,
  accessOrOwner?: WorkAccess | string
) {
  const seen = new Set<string>();
  return artifactVersions.map((entry) => {
    const artifactId = String(entry.artifactId ?? "").trim();
    const versionId = String(entry.artifactVersionId ?? "").trim();
    const expectedSha = String(entry.contentSha256 ?? "").trim();
    if (!artifactId || !expectedSha) {
      throw new HttpError(
        400,
        "work_transmission_artifact_invalid",
        "Every transmitted Artifact requires its stable ID and content checksum."
      );
    }
    if (typeof accessOrOwner === "string") {
      const owner = getEntityOwnerId("artifact", artifactId);
      if (owner && owner !== accessOrOwner) {
        throw new HttpError(
          403,
          "work_transmission_artifact_owner_mismatch",
          "A selected transmission Artifact belongs to another Work owner."
        );
      }
    } else if (accessOrOwner) {
      assertAuthorizedWorkReference({
        access: accessOrOwner,
        entityType: "artifact",
        entityId: artifactId
      });
    }
    const row = versionId
      ? (getDatabase()
          .prepare(
            "SELECT artifact_id, id, content_sha256, version_number FROM artifact_versions WHERE id = ? AND artifact_id = ?"
          )
          .get(versionId, artifactId) as
          | {
              artifact_id: string;
              id: string;
              content_sha256: string;
              version_number: number;
            }
          | undefined)
      : (getDatabase()
          .prepare(
            "SELECT id AS artifact_id, '' AS id, content_sha256, 0 AS version_number FROM artifacts WHERE id = ?"
          )
          .get(artifactId) as
          | {
              artifact_id: string;
              id: string;
              content_sha256: string;
              version_number: number;
            }
          | undefined);
    if (!row || row.content_sha256 !== expectedSha) {
      throw new HttpError(
        409,
        "work_transmission_artifact_changed",
        "A selected Artifact version no longer matches the reviewed checksum."
      );
    }
    const result = {
      artifactId: row.artifact_id,
      artifactVersionId: row.id || null,
      versionNumber: row.version_number || null,
      contentSha256: row.content_sha256
    };
    const identity = `${result.artifactId}:${result.artifactVersionId ?? "current"}`;
    if (seen.has(identity)) {
      throw new HttpError(
        400,
        "work_transmission_artifact_duplicate",
        "A transmission preview cannot include the same Artifact version twice."
      );
    }
    seen.add(identity);
    return result;
  });
}

const prohibitedTransmissionKey =
  /^(?:password|passwordHash|secret|secretToken|token|apiKey|privateKey|credential|credentials)$/iu;

function assertNoTransmissionSecrets(value: unknown, path = "transmission") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoTransmissionSecrets(entry, `${path}[${index}]`)
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (prohibitedTransmissionKey.test(key)) {
      throw new HttpError(
        400,
        "work_transmission_secret_forbidden",
        `Credentials and secrets cannot be stored in a Work transmission preview (${path}.${key}).`
      );
    }
    assertNoTransmissionSecrets(entry, `${path}.${key}`);
  }
}

function previewDigest(input: {
  ownerUserId: string;
  applicationId: string;
  requestingAgentId: string | null;
  requestingTokenId: string | null;
  requestingClientIdentity: string;
  destination: unknown;
  fields: unknown;
  answers: unknown;
  artifactVersions: unknown;
  representations: unknown;
  unresolvedGates: unknown;
  guardContext: unknown;
}) {
  return fingerprint(input);
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function representationPresent(
  representations: Record<string, unknown>,
  key: string
) {
  const normalized = key.replaceAll(/[^a-z0-9]/giu, "").toLowerCase();
  return Object.entries(representations).some(([candidate, value]) => {
    const normalizedCandidate = candidate
      .replaceAll(/[^a-z0-9]/giu, "")
      .toLowerCase();
    return normalizedCandidate === normalized && value !== null && value !== "";
  });
}

function unresolvedCompensationGate(input: {
  gate: Record<string, unknown>;
  compensation: Record<string, unknown>;
  representations: Record<string, unknown>;
}) {
  const kind = String(input.gate.kind ?? "user_confirmation");
  const operator = String(input.gate.operator ?? "review_required");
  const representationKey = `compensation_${kind}`;
  if (kind === "user_confirmation" || operator === "review_required") {
    return !representationPresent(input.representations, representationKey);
  }
  const moneyKey = (
    {
      minimum_base: "base",
      minimum_total: "total",
      minimum_hourly: "hourlyRate",
      minimum_daily: "dailyRate",
      currency: "base"
    } as Record<string, string>
  )[kind];
  const money = recordValue(moneyKey ? input.compensation[moneyKey] : null);
  if (kind === "currency") {
    const actualCurrency = String(money.currency ?? "").toUpperCase();
    const requiredCurrency = String(input.gate.currency ?? "").toUpperCase();
    if (operator === "known") return !actualCurrency;
    return (
      !actualCurrency ||
      !requiredCurrency ||
      actualCurrency !== requiredCurrency
    );
  }
  const actualAmount = money.amount;
  const requiredAmount = input.gate.amount;
  if (operator === "known") {
    return typeof actualAmount !== "number" || money.unknown === true;
  }
  if (typeof actualAmount !== "number" || typeof requiredAmount !== "number") {
    return true;
  }
  const requiredCurrency = String(input.gate.currency ?? "").toUpperCase();
  const actualCurrency = String(money.currency ?? "").toUpperCase();
  if (requiredCurrency && actualCurrency !== requiredCurrency) return true;
  return operator === "equals"
    ? actualAmount !== requiredAmount
    : actualAmount < requiredAmount;
}

function verifyApprovedAnswers(
  applicationId: string,
  answers: Array<Record<string, unknown>>
) {
  const seen = new Set<string>();
  const normalized: ApprovedTransmissionAnswer[] = [];
  const guards: Array<Record<string, unknown>> = [];
  for (const answer of answers) {
    const questionId = String(answer.questionId ?? "").trim();
    if (!questionId || seen.has(questionId)) {
      throw new HttpError(
        400,
        seen.has(questionId)
          ? "work_transmission_answer_duplicate"
          : "work_transmission_answer_invalid",
        seen.has(questionId)
          ? "A transmission preview cannot include the same application answer twice."
          : "Every transmitted answer requires its application question identifier."
      );
    }
    seen.add(questionId);
    const row = getDatabase()
      .prepare(
        `SELECT id, exact_question, approved_answer, review_state, revision
         FROM application_questions
         WHERE id = ? AND application_id = ? LIMIT 1`
      )
      .get(questionId, applicationId) as
      | {
          id: string;
          exact_question: string;
          approved_answer: string;
          review_state: string;
          revision: number;
        }
      | undefined;
    if (
      !row ||
      row.review_state !== "approved" ||
      !row.approved_answer.trim() ||
      String(answer.exactQuestion ?? "") !== row.exact_question ||
      String(answer.answer ?? "") !== row.approved_answer
    ) {
      throw new HttpError(
        409,
        "work_transmission_answer_not_approved",
        "Every transmitted answer must exactly match an approved answer on this application."
      );
    }
    normalized.push({
      questionId: row.id,
      exactQuestion: row.exact_question,
      answer: row.approved_answer
    });
    guards.push({
      questionId: row.id,
      revision: row.revision,
      reviewState: row.review_state,
      exactQuestionDigest: fingerprint(row.exact_question),
      approvedAnswerDigest: fingerprint(row.approved_answer)
    });
  }
  return { normalized, guards };
}

export function verifyApplicationArtifactApprovals(
  applicationId: string,
  artifactVersions: VerifiedArtifactVersion[]
) {
  return artifactVersions.map((artifact) => {
    const row = artifact.artifactVersionId
      ? (getDatabase()
          .prepare(
            `SELECT id, approval_state, use_kind, used_at
             FROM application_artifact_uses
             WHERE application_id = ? AND artifact_id = ?
               AND artifact_version_id = ? AND content_sha256 = ?
               AND approval_state IN ('approved', 'sealed')
             ORDER BY used_at DESC, id ASC LIMIT 1`
          )
          .get(
            applicationId,
            artifact.artifactId,
            artifact.artifactVersionId,
            artifact.contentSha256
          ) as
          | {
              id: string;
              approval_state: string;
              use_kind: string;
              used_at: string;
            }
          | undefined)
      : (getDatabase()
          .prepare(
            `SELECT id, approval_state, use_kind, used_at
             FROM application_artifact_uses
             WHERE application_id = ? AND artifact_id = ?
               AND artifact_version_id IS NULL AND content_sha256 = ?
               AND approval_state IN ('approved', 'sealed')
             ORDER BY used_at DESC, id ASC LIMIT 1`
          )
          .get(applicationId, artifact.artifactId, artifact.contentSha256) as
          | {
              id: string;
              approval_state: string;
              use_kind: string;
              used_at: string;
            }
          | undefined);
    if (!row) {
      throw new HttpError(
        409,
        "work_transmission_artifact_not_approved",
        "Every transmitted Artifact version must be explicitly approved or sealed for this application."
      );
    }
    return {
      artifactUseId: row.id,
      artifactId: artifact.artifactId,
      artifactVersionId: artifact.artifactVersionId,
      contentSha256: artifact.contentSha256,
      approvalState: row.approval_state,
      useKind: row.use_kind,
      usedAt: row.used_at
    };
  });
}

export function prepareTransmissionMaterials(input: {
  applicationId: string;
  artifactVersions: Array<Record<string, unknown>>;
  answers: Array<Record<string, unknown>>;
  accessOrOwner: WorkAccess | string;
}) {
  const applicationRow = getDatabase()
    .prepare(
      "SELECT * FROM job_applications WHERE id = ? AND deleted_at IS NULL"
    )
    .get(input.applicationId) as SqlRow | undefined;
  if (!applicationRow) {
    throw new HttpError(
      404,
      "work_application_not_found",
      "The application for this transmission was not found."
    );
  }
  if (
    typeof input.accessOrOwner === "string" &&
    applicationRow.owner_user_id !== input.accessOrOwner
  ) {
    throw new HttpError(
      403,
      "work_transmission_application_owner_mismatch",
      "The transmission application belongs to another Work owner."
    );
  }
  if (typeof input.accessOrOwner !== "string") {
    getAuthorizedRoot(
      "job_application",
      input.applicationId,
      input.accessOrOwner
    );
  }
  if (applicationRow.status !== "ready_to_submit") {
    throw new HttpError(
      409,
      "work_transmission_application_not_ready",
      "An application must be in ready to submit before an exact transmission preview can be approved."
    );
  }
  const artifactVersions = verifyArtifactVersions(
    input.artifactVersions,
    input.accessOrOwner
  );
  const artifactApprovals = verifyApplicationArtifactApprovals(
    input.applicationId,
    artifactVersions
  );
  const approvedAnswers = verifyApprovedAnswers(
    input.applicationId,
    input.answers
  );
  const policyRow = getDatabase()
    .prepare(
      `SELECT * FROM job_automation_policies
       WHERE campaign_id = ? AND criteria_version_id = ?
       ORDER BY updated_at DESC, id ASC LIMIT 1`
    )
    .get(
      applicationRow.primary_campaign_id,
      applicationRow.criteria_version_id
    ) as SqlRow | undefined;
  const opportunityRow = getDatabase()
    .prepare(
      `SELECT id, owner_user_id, revision, compensation_json, disposition,
              availability_status, updated_at, deleted_at
       FROM job_opportunities WHERE id = ? LIMIT 1`
    )
    .get(applicationRow.opportunity_id) as SqlRow | undefined;
  if (
    !opportunityRow ||
    opportunityRow.owner_user_id !== applicationRow.owner_user_id ||
    opportunityRow.deleted_at
  ) {
    throw new HttpError(
      409,
      "work_transmission_opportunity_unavailable",
      "The application Opportunity is unavailable or no longer belongs to the same Work owner."
    );
  }
  const guardContext = {
    applicationId: applicationRow.id,
    applicationRevision: applicationRow.revision,
    applicationStatus: applicationRow.status,
    campaignId: applicationRow.primary_campaign_id,
    criteriaVersionId: applicationRow.criteria_version_id,
    opportunityId: applicationRow.opportunity_id,
    applicationFactsDigest: fingerprint({
      representations: applicationRow.representations_json,
      unresolvedUserFacts: applicationRow.unresolved_user_facts_json
    }),
    opportunityRevision: opportunityRow.revision,
    opportunityFactsDigest: fingerprint({
      compensation: opportunityRow.compensation_json,
      disposition: opportunityRow.disposition,
      availabilityStatus: opportunityRow.availability_status,
      updatedAt: opportunityRow.updated_at
    }),
    automationPolicy: policyRow
      ? {
          id: policyRow.id,
          revision: policyRow.revision,
          digest: fingerprint(policyRow)
        }
      : null,
    approvedAnswerGuards: approvedAnswers.guards,
    artifactApprovalGuards: artifactApprovals
  };
  return {
    applicationRow,
    artifactVersions,
    answers: approvedAnswers.normalized,
    guardContext
  };
}

export function assertGuardContextUnchanged(
  expected: unknown,
  actual: unknown
) {
  if (fingerprint(expected) !== fingerprint(actual)) {
    throw new HttpError(
      409,
      "work_transmission_guard_context_changed",
      "The application, approved answers, Artifact approvals, Opportunity facts, or automation policy changed after preview. Create and review a new transmission preview."
    );
  }
}

function deriveTransmissionGates(input: {
  access: WorkAccess;
  application: Record<string, unknown>;
  representations: Record<string, unknown>;
  supplied: Array<Record<string, unknown>>;
}) {
  const gates = [...input.supplied];
  for (const fact of Array.isArray(input.application.unresolvedUserFacts)
    ? input.application.unresolvedUserFacts
    : []) {
    gates.push({
      kind: "unresolved_user_fact",
      label: String(
        recordValue(fact).label ??
          recordValue(fact).question ??
          "Unresolved user fact"
      ),
      source: "job_application",
      fact
    });
  }
  const policyRow = getDatabase()
    .prepare(
      `SELECT * FROM job_automation_policies
       WHERE campaign_id = ? AND criteria_version_id = ?
       ORDER BY updated_at DESC, id ASC LIMIT 1`
    )
    .get(
      String(input.application.primaryCampaignId),
      String(input.application.criteriaVersionId)
    ) as SqlRow | undefined;
  if (policyRow) {
    const policy = rowToWorkRecord(policyRow, input.access);
    const questions = getDatabase()
      .prepare(
        `SELECT normalized_category, approved_answer, review_state
         FROM application_questions WHERE application_id = ?`
      )
      .all(String(input.application.id)) as Array<{
      normalized_category: string;
      approved_answer: string;
      review_state: string;
    }>;
    for (const rawGate of Array.isArray(policy.legalAnswerGates)
      ? policy.legalAnswerGates
      : []) {
      const gate = recordValue(rawGate);
      const category = String(gate.category ?? "");
      const requirement = String(gate.requirement ?? "");
      const approved = questions.some(
        (question) =>
          question.normalized_category === category &&
          ["approved", "submitted"].includes(question.review_state) &&
          Boolean(question.approved_answer.trim())
      );
      const resolved =
        requirement === "approved_response_required"
          ? approved
          : requirement === "user_confirmation_required"
            ? representationPresent(input.representations, category)
            : false;
      if (!resolved) {
        gates.push({
          kind: "legal_answer_gate",
          label: `Resolve legal answer: ${category || "unspecified category"}`,
          source: "automation_policy",
          policyGate: gate
        });
      }
    }
    const rawCompensationGates = JSON.parse(
      String(policyRow.compensation_gates_json ?? "[]")
    ) as unknown;
    if (
      !input.access.canCompensation &&
      Array.isArray(rawCompensationGates) &&
      rawCompensationGates.length > 0
    ) {
      gates.push({
        kind: "compensation_authority_required",
        label:
          "Review configured compensation gates with compensation authority.",
        source: "automation_policy"
      });
    } else if (input.access.canCompensation) {
      const opportunity = getAuthorizedRoot(
        "job_opportunity",
        String(input.application.opportunityId),
        input.access
      );
      const compensation = recordValue(opportunity.compensation);
      for (const rawGate of Array.isArray(policy.compensationGates)
        ? policy.compensationGates
        : []) {
        const gate = recordValue(rawGate);
        if (
          unresolvedCompensationGate({
            gate,
            compensation,
            representations: input.representations
          })
        ) {
          gates.push({
            kind: "compensation_gate",
            label: `Resolve compensation gate: ${String(gate.kind ?? "review")}`,
            source: "automation_policy",
            policyGate: gate
          });
        }
      }
    }
  }
  const unique = new Map<string, Record<string, unknown>>();
  for (const gate of gates) unique.set(fingerprint(gate), gate);
  return [...unique.values()];
}

export function createTransmissionPreview(
  access: WorkAccess,
  input: TransmissionPreviewInput
) {
  if (!access.canTransmit) {
    throw new HttpError(
      403,
      "work_transmit_scope_required",
      "This operation requires work.transmit authority."
    );
  }
  const application = getAuthorizedRoot(
    "job_application",
    input.applicationId,
    access
  );
  assertNoTransmissionSecrets({
    destination: input.destination,
    fields: input.fields,
    answers: input.answers,
    representations: input.representations,
    unresolvedGates: input.unresolvedGates
  });
  const requestFingerprint = fingerprint(input);
  const replay = getOperationReceipt({
    ownerUserId: access.mutationOwnerUserId,
    operationKind: "transmission_preview",
    idempotencyKey: input.idempotencyKey,
    requestFingerprint
  });
  if (replay)
    return {
      replayed: true,
      ...((replay.response as Record<string, unknown>) ?? {})
    };
  const materials = prepareTransmissionMaterials({
    applicationId: input.applicationId,
    artifactVersions: input.artifactVersions,
    answers: input.answers,
    accessOrOwner: access
  });
  const representations = {
    ...recordValue(application.representations),
    ...input.representations
  };
  const unresolvedGates = deriveTransmissionGates({
    access,
    application,
    representations,
    supplied: input.unresolvedGates
  });
  const digest = previewDigest({
    ownerUserId: access.mutationOwnerUserId,
    applicationId: input.applicationId,
    requestingAgentId: access.principal.agentId,
    requestingTokenId: access.principal.tokenId,
    requestingClientIdentity: access.principal.clientIdentity,
    destination: input.destination,
    fields: input.fields,
    answers: materials.answers,
    artifactVersions: materials.artifactVersions,
    representations,
    unresolvedGates,
    guardContext: materials.guardContext
  });
  return runInTransaction(() => {
    const id = newWorkId("txprev");
    const now = nowIso();
    const expiresAt = new Date(
      Date.now() + input.expiresInMinutes * 60_000
    ).toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO application_transmission_previews (
          id, owner_user_id, application_id, requesting_agent_id, requesting_token_id,
          requesting_client_identity, destination_json, fields_json, answers_json,
          artifact_versions_json, representations_json, unresolved_gates_json,
          guard_context_json,
          preview_digest, status, approval_request_id, agent_action_id,
          authorization_identity, authorized_principal_json, authorized_at,
          expires_at, consumed_at, completion_evidence_json, revision,
          created_at, updated_at, import_receipt_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, NULL, NULL, '{}', NULL, ?, NULL, '{}', 1, ?, ?, NULL)`
      )
      .run(
        id,
        access.mutationOwnerUserId,
        input.applicationId,
        access.principal.agentId,
        access.principal.tokenId,
        access.principal.clientIdentity,
        json(input.destination),
        json(input.fields),
        json(materials.answers),
        json(materials.artifactVersions),
        json(representations),
        json(unresolvedGates),
        json(materials.guardContext),
        digest,
        expiresAt,
        now,
        now
      );
    const response = {
      preview: rowToWorkRecord(
        getDatabase()
          .prepare(
            "SELECT * FROM application_transmission_previews WHERE id = ?"
          )
          .get(id) as SqlRow,
        access
      ),
      application: {
        id: application.id,
        status: application.status,
        revision: application.revision
      }
    };
    storeOperationReceipt({
      ownerUserId: access.mutationOwnerUserId,
      operationKind: "transmission_preview",
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      response,
      createdRecords: [{ table: "application_transmission_previews", id }]
    });
    return { replayed: false, ...response };
  });
}

export function buildTransmissionApprovalAction(input: {
  access: WorkAccess;
  previewId: string;
}) {
  if (!input.access.canTransmit) {
    throw new HttpError(
      403,
      "work_transmit_scope_required",
      "This operation requires work.transmit authority."
    );
  }
  const row = getDatabase()
    .prepare(
      "SELECT * FROM application_transmission_previews WHERE id = ? AND owner_user_id = ?"
    )
    .get(input.previewId, input.access.mutationOwnerUserId) as
    | SqlRow
    | undefined;
  if (!row)
    throw new HttpError(
      404,
      "work_transmission_preview_not_found",
      "The transmission preview was not found."
    );
  const preview = rowToWorkRecord(row, input.access);
  if (preview.status !== "draft")
    throw new HttpError(
      409,
      "work_transmission_preview_state",
      "Only a draft transmission preview can request approval."
    );
  if (new Date(String(preview.expiresAt)).getTime() <= Date.now()) {
    getDatabase()
      .prepare(
        "UPDATE application_transmission_previews SET status = 'expired', revision = revision + 1, updated_at = ? WHERE id = ?"
      )
      .run(nowIso(), input.previewId);
    throw new HttpError(
      409,
      "work_transmission_preview_expired",
      "This transmission preview has expired."
    );
  }
  const application = getAuthorizedRoot(
    "job_application",
    String(preview.applicationId),
    input.access
  );
  const materials = prepareTransmissionMaterials({
    applicationId: String(preview.applicationId),
    artifactVersions: Array.isArray(preview.artifactVersions)
      ? (preview.artifactVersions as Array<Record<string, unknown>>)
      : [],
    answers: Array.isArray(preview.answers)
      ? (preview.answers as Array<Record<string, unknown>>)
      : [],
    accessOrOwner: input.access
  });
  assertGuardContextUnchanged(preview.guardContext, materials.guardContext);
  const currentGates = deriveTransmissionGates({
    access: input.access,
    application,
    representations: recordValue(preview.representations),
    supplied: []
  });
  if (
    (Array.isArray(preview.unresolvedGates) &&
      preview.unresolvedGates.length > 0) ||
    currentGates.length > 0
  ) {
    throw new HttpError(
      409,
      "work_transmission_gates_unresolved",
      "Resolve every user-only, legal, compensation, and duplicate gate before requesting approval."
    );
  }
  const actualDigest = previewDigest({
    ownerUserId: String(preview.ownerUserId),
    applicationId: String(preview.applicationId),
    requestingAgentId:
      typeof preview.requestingAgentId === "string"
        ? preview.requestingAgentId
        : null,
    requestingTokenId:
      typeof preview.requestingTokenId === "string"
        ? preview.requestingTokenId
        : null,
    requestingClientIdentity: String(preview.requestingClientIdentity),
    destination: preview.destination,
    fields: preview.fields,
    answers: materials.answers,
    artifactVersions: materials.artifactVersions,
    representations: preview.representations,
    unresolvedGates: preview.unresolvedGates,
    guardContext: materials.guardContext
  });
  if (actualDigest !== preview.previewDigest) {
    throw new HttpError(
      409,
      "work_transmission_digest_mismatch",
      "The destination, fields, answers, representations, gates, or Artifacts changed after review."
    );
  }
  return {
    agentId: input.access.principal.agentId,
    tokenId: input.access.principal.tokenId,
    actionType: "work_application_transmission",
    riskLevel: "high" as const,
    title: "Authorize one exact application transmission",
    summary: `Review the exact destination, answers, representations, and Artifact versions for application ${String(preview.applicationId)}. Approval authorizes this digest only; it does not record submission.`,
    payload: {
      entityType: "job_application",
      entityId: preview.applicationId,
      previewId: preview.id,
      previewDigest: preview.previewDigest,
      ownerUserId: preview.ownerUserId,
      requestingAgentId: preview.requestingAgentId,
      requestingTokenId: preview.requestingTokenId,
      requestingClientIdentity: preview.requestingClientIdentity,
      review: {
        destination: preview.destination,
        fields: preview.fields,
        answers: preview.answers,
        artifactVersions: preview.artifactVersions,
        representations: preview.representations
      }
    }
  };
}

export function attachTransmissionApproval(input: {
  previewId: string;
  actionId: string;
  approvalRequestId: string;
  access: WorkAccess;
}) {
  const existing = getDatabase()
    .prepare(
      `SELECT * FROM application_transmission_previews
       WHERE id = ? AND owner_user_id = ?`
    )
    .get(input.previewId, input.access.mutationOwnerUserId) as
    | SqlRow
    | undefined;
  if (
    existing?.status === "approval_pending" &&
    existing.agent_action_id === input.actionId &&
    existing.approval_request_id === input.approvalRequestId
  ) {
    return rowToWorkRecord(existing, input.access);
  }
  const result = getDatabase()
    .prepare(
      `UPDATE application_transmission_previews
       SET status = 'approval_pending', agent_action_id = ?, approval_request_id = ?,
           revision = revision + 1, updated_at = ?
       WHERE id = ? AND owner_user_id = ? AND status = 'draft'`
    )
    .run(
      input.actionId,
      input.approvalRequestId,
      nowIso(),
      input.previewId,
      input.access.mutationOwnerUserId
    );
  if (Number(result.changes) !== 1) {
    throw new HttpError(
      409,
      "work_transmission_preview_state",
      "The transmission preview changed before approval could be attached."
    );
  }
  return rowToWorkRecord(
    getDatabase()
      .prepare("SELECT * FROM application_transmission_previews WHERE id = ?")
      .get(input.previewId) as SqlRow,
    input.access
  );
}

export function rejectTransmissionApprovalAction(action: AgentAction) {
  if (action.actionType !== "work_application_transmission") return;
  const previewId = String(action.payload.previewId ?? "");
  if (!previewId) return;
  getDatabase()
    .prepare(
      `UPDATE application_transmission_previews
       SET status = 'rejected', revision = revision + 1, updated_at = ?
       WHERE id = ? AND agent_action_id = ? AND status = 'approval_pending'`
    )
    .run(nowIso(), previewId, action.id);
}

export function authorizeTransmissionAgentAction(
  action: AgentAction,
  _context: CollaborationContext
): Record<string, unknown> {
  const previewId = String(action.payload.previewId ?? "");
  const expectedDigest = String(action.payload.previewDigest ?? "");
  return runInTransaction(() => {
    const row = getDatabase()
      .prepare("SELECT * FROM application_transmission_previews WHERE id = ?")
      .get(previewId) as SqlRow | undefined;
    if (!row)
      throw new HttpError(
        404,
        "work_transmission_preview_not_found",
        "The transmission preview was not found."
      );
    const preview = rowToWorkRecord(row);
    if (
      preview.agentActionId !== action.id ||
      preview.approvalRequestId !== action.approvalRequestId
    ) {
      throw new HttpError(
        409,
        "work_transmission_approval_binding",
        "The approval is not bound to this transmission preview."
      );
    }
    if (preview.status !== "approval_pending") {
      throw new HttpError(
        409,
        "work_transmission_preview_state",
        "The transmission preview is no longer awaiting approval."
      );
    }
    if (new Date(String(preview.expiresAt)).getTime() <= Date.now()) {
      throw new HttpError(
        409,
        "work_transmission_preview_expired",
        "The transmission preview expired before approval."
      );
    }
    if (preview.previewDigest !== expectedDigest) {
      throw new HttpError(
        409,
        "work_transmission_digest_mismatch",
        "The approved digest does not match the current preview."
      );
    }
    const materials = prepareTransmissionMaterials({
      applicationId: String(preview.applicationId),
      artifactVersions: Array.isArray(preview.artifactVersions)
        ? (preview.artifactVersions as Array<Record<string, unknown>>)
        : [],
      answers: Array.isArray(preview.answers)
        ? (preview.answers as Array<Record<string, unknown>>)
        : [],
      accessOrOwner: String(preview.ownerUserId)
    });
    assertGuardContextUnchanged(preview.guardContext, materials.guardContext);
    if (
      Array.isArray(preview.unresolvedGates) &&
      preview.unresolvedGates.length > 0
    ) {
      throw new HttpError(
        409,
        "work_transmission_gates_unresolved",
        "The approved transmission still contains an unresolved gate."
      );
    }
    const actualDigest = previewDigest({
      ownerUserId: String(preview.ownerUserId),
      applicationId: String(preview.applicationId),
      requestingAgentId:
        typeof preview.requestingAgentId === "string"
          ? preview.requestingAgentId
          : null,
      requestingTokenId:
        typeof preview.requestingTokenId === "string"
          ? preview.requestingTokenId
          : null,
      requestingClientIdentity: String(preview.requestingClientIdentity),
      destination: preview.destination,
      fields: preview.fields,
      answers: materials.answers,
      artifactVersions: materials.artifactVersions,
      representations: preview.representations,
      unresolvedGates: preview.unresolvedGates,
      guardContext: materials.guardContext
    });
    if (actualDigest !== expectedDigest) {
      throw new HttpError(
        409,
        "work_transmission_digest_mismatch",
        "The destination, fields, answers, representations, or Artifacts changed after review."
      );
    }
    const authorizationIdentity = newWorkId("txauth");
    const principal = {
      agentId: preview.requestingAgentId ?? null,
      tokenId: preview.requestingTokenId ?? null,
      clientIdentity: preview.requestingClientIdentity,
      ownerUserId: preview.ownerUserId
    };
    const authorizedAt = nowIso();
    const result = getDatabase()
      .prepare(
        `UPDATE application_transmission_previews
         SET status = 'authorized', authorization_identity = ?, authorized_principal_json = ?,
             authorized_at = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'approval_pending'`
      )
      .run(
        authorizationIdentity,
        json(principal),
        authorizedAt,
        authorizedAt,
        previewId
      );
    if (Number(result.changes) !== 1) {
      throw new HttpError(
        409,
        "work_transmission_concurrent_approval",
        "The transmission preview was resolved concurrently."
      );
    }
    return {
      deferred: false,
      authorizationIdentity,
      previewId,
      previewDigest: expectedDigest,
      authorizedPrincipal: principal,
      authorizedAt,
      externalSubmissionRecorded: false
    };
  });
}
