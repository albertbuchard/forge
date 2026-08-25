import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
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
import {
  getJobApplicationDetail,
  transitionJobApplication
} from "./repository.js";
import {
  assertGuardContextUnchanged,
  prepareTransmissionMaterials,
  verifyApplicationArtifactApprovals,
  type ApprovedTransmissionAnswer,
  type VerifiedArtifactVersion
} from "./transmission.js";

function json(value: unknown) {
  return JSON.stringify(value ?? null);
}

function principalMatches(
  access: WorkAccess,
  authorized: Record<string, unknown>
) {
  const agentId = authorized.agentId;
  const tokenId = authorized.tokenId;
  const clientIdentity = authorized.clientIdentity;
  if (typeof agentId === "string" && agentId) {
    return (
      access.principal.agentId === agentId &&
      access.principal.tokenId === tokenId
    );
  }
  return access.principal.clientIdentity === clientIdentity;
}

function parseArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function recordSubmittedMaterialHistory(input: {
  access: WorkAccess;
  applicationId: string;
  previewId: string;
  previewDigest: string;
  destination: unknown;
  answers: ApprovedTransmissionAnswer[];
  artifactVersions: VerifiedArtifactVersion[];
  occurredAt: string;
}) {
  for (const answer of input.answers) {
    const current = getDatabase()
      .prepare(
        "SELECT * FROM application_questions WHERE id = ? AND application_id = ?"
      )
      .get(answer.questionId, input.applicationId) as SqlRow | undefined;
    if (
      !current ||
      current.review_state !== "approved" ||
      current.approved_answer !== answer.answer
    ) {
      throw new HttpError(
        409,
        "work_transmission_answer_changed",
        "An approved application answer changed before submission evidence was recorded."
      );
    }
    const useHistory = [
      ...parseArray(current.use_history_json),
      {
        transmissionPreviewId: input.previewId,
        previewDigest: input.previewDigest,
        submittedAt: input.occurredAt,
        destinationDigest: fingerprint(input.destination),
        approvedAnswerDigest: fingerprint(answer.answer)
      }
    ].slice(-5_000);
    const update = getDatabase()
      .prepare(
        `UPDATE application_questions
         SET review_state = 'submitted', use_history_json = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND application_id = ? AND revision = ?
           AND review_state = 'approved'`
      )
      .run(
        json(useHistory),
        input.occurredAt,
        answer.questionId,
        input.applicationId,
        current.revision
      );
    if (Number(update.changes) !== 1) {
      throw new HttpError(
        409,
        "work_transmission_answer_concurrent_change",
        "An application answer changed while its submitted-use history was being recorded."
      );
    }
    const updated = getDatabase()
      .prepare("SELECT * FROM application_questions WHERE id = ?")
      .get(answer.questionId) as SqlRow;
    const latest = getDatabase()
      .prepare(
        `SELECT COALESCE(MAX(version), 0) AS version
         FROM work_supporting_revisions
         WHERE record_kind = 'applicationQuestion' AND record_id = ?`
      )
      .get(answer.questionId) as { version: number };
    getDatabase()
      .prepare(
        `INSERT INTO work_supporting_revisions (
          id, owner_user_id, record_kind, record_id, version, data_json,
          actor_json, provenance_json, created_at, import_receipt_id
        ) VALUES (?, ?, 'applicationQuestion', ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        newWorkId("wsrev"),
        input.access.mutationOwnerUserId,
        answer.questionId,
        Number(latest.version) + 1,
        json(updated),
        json(input.access.actor),
        typeof updated.provenance_json === "string"
          ? updated.provenance_json
          : "{}",
        input.occurredAt
      );
  }
  for (const artifact of input.artifactVersions) {
    const approval = verifyApplicationArtifactApprovals(input.applicationId, [
      artifact
    ])[0];
    getDatabase()
      .prepare(
        `INSERT INTO application_artifact_uses (
          id, application_id, artifact_id, artifact_version_id,
          content_sha256, use_kind, approval_state, used_at,
          transmission_preview_id, provenance_json, created_at,
          import_receipt_id
        ) VALUES (?, ?, ?, ?, ?, 'verified_submission', ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        newWorkId("ause"),
        input.applicationId,
        artifact.artifactId,
        artifact.artifactVersionId,
        artifact.contentSha256,
        approval.approvalState,
        input.occurredAt,
        input.previewId,
        json({
          sourceKind: "external_source",
          transmissionPreviewId: input.previewId,
          previewDigest: input.previewDigest,
          sourceArtifactUseId: approval.artifactUseId
        }),
        input.occurredAt
      );
  }
}

export function recordVerifiedSubmission(input: {
  access: WorkAccess;
  authorizationIdentity: string;
  previewDigest: string;
  evidenceArtifactId: string | null;
  confirmationReceipt: string;
  trackingIdentifier: string;
  factualDescription: string;
  occurredAt?: string;
  idempotencyKey: string;
}) {
  if (!input.access.canTransmit) {
    throw new HttpError(
      403,
      "work_transmit_scope_required",
      "This operation requires work.transmit authority."
    );
  }
  const requestFingerprint = fingerprint(input);
  const replay = getOperationReceipt({
    ownerUserId: input.access.mutationOwnerUserId,
    operationKind: "verified_submission",
    idempotencyKey: input.idempotencyKey,
    requestFingerprint
  });
  if (replay)
    return {
      replayed: true,
      ...((replay.response as Record<string, unknown>) ?? {})
    };
  return runInTransaction(() => {
    const row = getDatabase()
      .prepare(
        "SELECT * FROM application_transmission_previews WHERE authorization_identity = ? AND owner_user_id = ?"
      )
      .get(input.authorizationIdentity, input.access.mutationOwnerUserId) as
      | SqlRow
      | undefined;
    if (!row)
      throw new HttpError(
        404,
        "work_transmission_authorization_not_found",
        "The transmission authorization was not found."
      );
    const preview = rowToWorkRecord(row, input.access);
    if (
      preview.status !== "authorized" ||
      preview.previewDigest !== input.previewDigest
    ) {
      throw new HttpError(
        409,
        "work_transmission_authorization_invalid",
        "The authorization is expired, consumed, or does not match this digest."
      );
    }
    if (new Date(String(preview.expiresAt)).getTime() <= Date.now()) {
      throw new HttpError(
        409,
        "work_transmission_authorization_expired",
        "The transmission authorization has expired."
      );
    }
    const authorized = preview.authorizedPrincipal as Record<string, unknown>;
    if (!principalMatches(input.access, authorized)) {
      throw new HttpError(
        403,
        "work_transmission_principal_mismatch",
        "Only the exact authorized agent, token, or local client may complete this transmission."
      );
    }
    if (input.evidenceArtifactId) {
      assertAuthorizedWorkReference({
        access: input.access,
        entityType: "artifact",
        entityId: input.evidenceArtifactId
      });
      const evidence = getDatabase()
        .prepare("SELECT id FROM artifacts WHERE id = ?")
        .get(input.evidenceArtifactId);
      if (!evidence)
        throw new HttpError(
          404,
          "work_submission_evidence_not_found",
          "The submission evidence Artifact was not found."
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
    const occurredAt = input.occurredAt ?? nowIso();
    transitionJobApplication({
      access: input.access,
      id: String(application.id),
      expectedRevision: Number(application.revision),
      newStatus: "submitted",
      factualDescription: input.factualDescription,
      outcome: "submitted",
      nextAction: "Wait for acknowledgement and schedule the next follow-up.",
      dueAt: null,
      sourceArtifactId: input.evidenceArtifactId,
      confidence: 1,
      provenance: {
        sourceKind: "external_source",
        transmissionPreviewId: preview.id,
        previewDigest: input.previewDigest
      },
      occurredAt,
      verifiedSubmission: true,
      confirmationReceipt: input.confirmationReceipt,
      trackingIdentifier: input.trackingIdentifier
    });
    recordSubmittedMaterialHistory({
      access: input.access,
      applicationId: String(application.id),
      previewId: String(preview.id),
      previewDigest: input.previewDigest,
      destination: preview.destination,
      answers: materials.answers,
      artifactVersions: materials.artifactVersions,
      occurredAt
    });
    const consumed = getDatabase()
      .prepare(
        `UPDATE application_transmission_previews
         SET status = 'consumed', consumed_at = ?, completion_evidence_json = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'authorized'`
      )
      .run(
        occurredAt,
        json({
          evidenceArtifactId: input.evidenceArtifactId,
          confirmationReceipt: input.confirmationReceipt,
          trackingIdentifier: input.trackingIdentifier
        }),
        occurredAt,
        String(preview.id)
      );
    if (Number(consumed.changes) !== 1) {
      throw new HttpError(
        409,
        "work_transmission_completion_replay",
        "This authorization was already consumed."
      );
    }
    const response = {
      application: getJobApplicationDetail(
        input.access,
        String(application.id)
      ),
      preview: rowToWorkRecord(
        getDatabase()
          .prepare(
            "SELECT * FROM application_transmission_previews WHERE id = ?"
          )
          .get(String(preview.id)) as SqlRow,
        input.access
      )
    };
    storeOperationReceipt({
      ownerUserId: input.access.mutationOwnerUserId,
      operationKind: "verified_submission",
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      response
    });
    return { replayed: false, ...response };
  });
}
