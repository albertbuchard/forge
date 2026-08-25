import { getDatabase } from "../db.js";
import type { WorkAccess } from "./access.js";
import { newWorkId, nowIso, type SqlRow } from "./repository-helpers.js";

export function recordSupportingRevision(input: {
  kind: string;
  row: SqlRow;
  access: WorkAccess;
  createdAt?: string;
}) {
  const prior = getDatabase()
    .prepare(
      `SELECT COALESCE(MAX(version), 0) AS version
       FROM work_supporting_revisions
       WHERE record_kind = ? AND record_id = ?`
    )
    .get(input.kind, input.row.id) as { version: number };
  const version = Number(prior.version) + 1;
  getDatabase()
    .prepare(
      `INSERT INTO work_supporting_revisions (
        id, owner_user_id, record_kind, record_id, version, data_json,
        actor_json, provenance_json, created_at, import_receipt_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      newWorkId("wsrev"),
      input.access.mutationOwnerUserId,
      input.kind,
      String(input.row.id),
      version,
      JSON.stringify(input.row),
      JSON.stringify(input.access.actor),
      typeof input.row.provenance_json === "string"
        ? input.row.provenance_json
        : "{}",
      input.createdAt ?? nowIso()
    );
}

export function recordOfferRevision(
  row: SqlRow,
  access: WorkAccess,
  createdAt = nowIso()
) {
  const prior = getDatabase()
    .prepare(
      "SELECT COALESCE(MAX(version), 0) AS version FROM job_offer_revisions WHERE offer_id = ?"
    )
    .get(row.id) as { version: number };
  const version = Number(prior.version) + 1;
  getDatabase()
    .prepare(
      `INSERT INTO job_offer_revisions (
        id, offer_id, version, status, terms_json, private_compensation_json,
        contingencies_json, negotiation_asks_json, response, artifact_ids_json,
        expires_at, decision, rationale, criteria_version_id,
        planned_engagement_id, actor_json, provenance_json, created_at,
        import_receipt_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      newWorkId("joffrev"),
      row.id,
      version,
      row.status,
      row.terms_json,
      row.private_compensation_json,
      row.contingencies_json,
      row.negotiation_asks_json,
      row.response,
      row.artifact_ids_json,
      row.expires_at,
      row.decision,
      row.rationale,
      row.criteria_version_id,
      row.planned_engagement_id,
      JSON.stringify(access.actor),
      row.provenance_json,
      createdAt
    );
}
