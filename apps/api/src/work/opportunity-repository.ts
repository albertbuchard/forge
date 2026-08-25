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
  listWorkActivityHistory,
  newWorkId,
  nowIso,
  parseJson,
  recordWorkActivity,
  registerWorkRoot,
  rowToWorkRecord,
  storeOperationReceipt,
  type SqlRow
} from "./repository-helpers.js";
import {
  assertCompensationWrite,
  criteriaContainCompensation,
  hasMaterialValue,
  insertRow,
  json,
  scopeColumns,
  updateRevisionedRow
} from "./repository-write-helpers.js";
import type {
  CreateJobApplicationInput,
  RecordJobApplicationEventInput,
  UpdateJobApplicationInput,
  UpdateJobOpportunityInput,
  UpsertJobOpportunityInput
} from "./types.js";

function normalizeUrl(value: string) {
  if (!value.trim()) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.toLowerCase().startsWith("utm_") ||
        ["ref", "source", "tracking"].includes(key.toLowerCase())
      )
        url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.toString();
  } catch {
    return value.normalize("NFKC").trim();
  }
}

export function opportunityDedupeKey(
  input: Pick<
    UpsertJobOpportunityInput,
    | "canonicalUrl"
    | "sourceName"
    | "sourceIdentifier"
    | "employerName"
    | "title"
    | "description"
  >
) {
  const normalizedUrl = normalizeUrl(input.canonicalUrl);
  const normalizedSourceIdentifier = input.sourceIdentifier
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  if (normalizedUrl) {
    return fingerprint({ canonicalUrl: normalizedUrl });
  }
  if (normalizedSourceIdentifier) {
    return fingerprint({
      sourceName: input.sourceName.normalize("NFKC").trim().toLowerCase(),
      sourceIdentifier: normalizedSourceIdentifier
    });
  }
  return fingerprint({
    employer: input.employerName.normalize("NFKC").trim().toLowerCase(),
    title: input.title.normalize("NFKC").trim().toLowerCase(),
    description: input.description
      .normalize("NFKC")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 4_000)
  });
}

function descriptionTokens(value: string) {
  return new Set(
    value
      .normalize("NFKC")
      .toLowerCase()
      .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/u)
      .filter((token) => token.length >= 3)
      .slice(0, 2_000)
  );
}

function substantiallySimilarDescription(left: string, right: string) {
  const normalizedLeft = left.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const normalizedRight = right.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (normalizedLeft === normalizedRight) return true;
  if (!normalizedLeft || !normalizedRight) return false;
  const leftTokens = descriptionTokens(normalizedLeft);
  const rightTokens = descriptionTokens(normalizedRight);
  if (leftTokens.size < 8 || rightTokens.size < 8) return false;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = leftTokens.size + rightTokens.size - intersection;
  const jaccard = union === 0 ? 0 : intersection / union;
  const containment =
    intersection / Math.min(leftTokens.size, rightTokens.size);
  return jaccard >= 0.82 || containment >= 0.92;
}

const opportunitySourceClaimFields = [
  "title",
  "employerName",
  "roleFamily",
  "seniority",
  "description",
  "responsibilities",
  "requirements",
  "preferredQualifications",
  "skills",
  "technologies",
  "sector",
  "location",
  "workModel",
  "travel",
  "sponsorship",
  "employmentType",
  "weeklyHours",
  "duration",
  "startDate",
  "compensation",
  "benefits",
  "applicationRoute",
  "publishedAt",
  "applicationDeadline",
  "availabilityStatus",
  "unknowns",
  "redFlags",
  "eligibilityUncertainties"
] as const;

type OpportunitySourceClaimField =
  (typeof opportunitySourceClaimFields)[number];

function opportunitySourceValues(input: Record<string, unknown>) {
  return Object.fromEntries(
    opportunitySourceClaimFields.map((field) => [field, input[field]])
  ) as Record<OpportunitySourceClaimField, unknown>;
}

function opportunitySourceEvidence(input: {
  sourceName: string;
  canonicalUrl: string;
  sourceIdentifier: string;
  sourceSnapshotArtifactId: string | null;
}) {
  return {
    sourceName: input.sourceName,
    sourceUrl: normalizeUrl(input.canonicalUrl),
    sourceIdentifier: input.sourceIdentifier,
    sourceSnapshotArtifactId: input.sourceSnapshotArtifactId
  };
}

function opportunitySourceClaims(
  input: UpsertJobOpportunityInput,
  observedAt: string
) {
  const provided = new Map(
    input.claimEvidence.map((claim) => [claim.field, claim])
  );
  const generated = Object.entries(
    opportunitySourceValues(input as unknown as Record<string, unknown>)
  )
    .filter(([, value]) => hasMaterialValue(value))
    .map(([field, value]) => {
      const explicit = provided.get(field);
      return {
        field,
        valueFingerprint: fingerprint(value),
        evidence: explicit?.evidence ?? opportunitySourceEvidence(input),
        confidence: explicit?.confidence ?? input.confidence,
        observedAt: explicit?.observedAt ?? observedAt,
        provenance: explicit?.provenance ?? input.provenance
      };
    });
  const generatedFields = new Set<string>(
    generated.map((claim) => claim.field)
  );
  return [
    ...generated,
    ...input.claimEvidence
      .filter((claim) => !generatedFields.has(claim.field))
      .map((claim) => ({
        ...claim,
        valueFingerprint: null,
        observedAt: claim.observedAt ?? observedAt
      }))
  ];
}

function sourceClaimsForOpportunityUpdate(input: {
  existingClaims: unknown[];
  update: UpdateJobOpportunityInput;
  source: {
    sourceName: string;
    canonicalUrl: string;
    sourceIdentifier: string;
    sourceSnapshotArtifactId: string | null;
    confidence: number | null;
    provenance: unknown;
  };
  observedAt: string;
}) {
  const updateRecord = input.update as unknown as Record<string, unknown>;
  const changedFields = new Set(
    input.update.claimEvidence === undefined
      ? []
      : opportunitySourceClaimFields.filter(
          (field) => updateRecord[field] !== undefined
        )
  );
  const explicit = new Map(
    (input.update.claimEvidence ?? []).map((claim) => [claim.field, claim])
  );
  const replacedFields = new Set([...changedFields, ...explicit.keys()]);
  const preserved = input.existingClaims.filter((claim) => {
    if (!claim || typeof claim !== "object") return false;
    return !replacedFields.has(
      String((claim as Record<string, unknown>).field)
    );
  });
  const generated = [...changedFields]
    .filter((field) => hasMaterialValue(updateRecord[field]))
    .map((field) => {
      const claim = explicit.get(field);
      return {
        field,
        valueFingerprint: fingerprint(updateRecord[field]),
        evidence: claim?.evidence ?? {
          sourceKind: "user_correction",
          sourceLabel: "Forge Work opportunity editor",
          relatedSource: opportunitySourceEvidence(input.source)
        },
        confidence: claim?.confidence ?? input.source.confidence,
        observedAt: claim?.observedAt ?? input.observedAt,
        provenance: claim?.provenance ?? input.source.provenance
      };
    });
  const generatedFields = new Set<string>(
    generated.map((claim) => claim.field)
  );
  const additional = [...explicit.values()]
    .filter((claim) => !generatedFields.has(claim.field))
    .map((claim) => ({
      ...claim,
      valueFingerprint: null,
      observedAt: claim.observedAt ?? input.observedAt
    }));
  return [...preserved, ...generated, ...additional];
}

function currentOpportunitySourceClaims(input: {
  opportunityId: string;
  sourceName: string;
  canonicalUrl: string;
  sourceIdentifier: string;
}) {
  const row = getDatabase()
    .prepare(
      `SELECT claims_json FROM job_opportunity_sources
       WHERE opportunity_id = ? AND source_name = ?
         AND source_identifier = ? AND source_url = ? LIMIT 1`
    )
    .get(
      input.opportunityId,
      input.sourceName,
      input.sourceIdentifier,
      normalizeUrl(input.canonicalUrl)
    ) as { claims_json: string } | undefined;
  return parseJson<unknown[]>(row?.claims_json, []);
}

export function findJobOpportunityDuplicate(
  ownerUserId: string,
  input: Pick<
    UpsertJobOpportunityInput,
    | "canonicalUrl"
    | "sourceName"
    | "sourceIdentifier"
    | "employerName"
    | "title"
    | "description"
  >,
  excludeId?: string
) {
  const dedupeKey = opportunityDedupeKey(input);
  const exact = getDatabase()
    .prepare(
      `SELECT id, revision FROM job_opportunities
       WHERE owner_user_id = ? AND dedupe_key = ?
         AND (? = '' OR id <> ?) AND deleted_at IS NULL
       LIMIT 1`
    )
    .get(ownerUserId, dedupeKey, excludeId ?? "", excludeId ?? "") as
    | { id: string; revision: number }
    | undefined;
  if (exact) return exact;
  if (normalizeUrl(input.canonicalUrl) || input.sourceIdentifier.trim()) {
    return undefined;
  }
  const candidates = getDatabase()
    .prepare(
      `SELECT id, revision, description FROM job_opportunities
       WHERE owner_user_id = ?
         AND forge_nfkc_lower(employer_name) = forge_nfkc_lower(?)
         AND forge_nfkc_lower(title) = forge_nfkc_lower(?)
         AND (? = '' OR id <> ?) AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 25`
    )
    .all(
      ownerUserId,
      input.employerName,
      input.title,
      excludeId ?? "",
      excludeId ?? ""
    ) as Array<{ id: string; revision: number; description: string }>;
  return candidates.find((candidate) =>
    substantiallySimilarDescription(candidate.description, input.description)
  );
}

function refreshOpportunitySource(input: {
  opportunityId: string;
  sourceName: string;
  canonicalUrl: string;
  sourceIdentifier: string;
  sourceSnapshotArtifactId: string | null;
  replaceSnapshot: boolean;
  confidence: number | null;
  provenance: unknown;
  claims: unknown[];
  observedAt: string;
}) {
  const sourceUrl = normalizeUrl(input.canonicalUrl);
  const existing = getDatabase()
    .prepare(
      `SELECT id FROM job_opportunity_sources
       WHERE opportunity_id = ? AND source_name = ?
         AND source_identifier = ? AND source_url = ? LIMIT 1`
    )
    .get(
      input.opportunityId,
      input.sourceName,
      input.sourceIdentifier,
      sourceUrl
    ) as { id: string } | undefined;
  if (existing) {
    getDatabase()
      .prepare(
        `UPDATE job_opportunity_sources
         SET snapshot_artifact_id = CASE WHEN ? = 1 THEN ? ELSE snapshot_artifact_id END,
             last_seen_at = ?, last_checked_at = ?,
             status = 'live', confidence = ?, claims_json = ?, provenance_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.replaceSnapshot ? 1 : 0,
        input.sourceSnapshotArtifactId,
        input.observedAt,
        input.observedAt,
        input.confidence,
        json(input.claims),
        json(input.provenance),
        input.observedAt,
        existing.id
      );
    return { id: existing.id, created: false };
  }
  const id = newWorkId("jsrc");
  insertRow("job_opportunity_sources", {
    id,
    opportunity_id: input.opportunityId,
    source_name: input.sourceName,
    source_url: sourceUrl,
    source_identifier: input.sourceIdentifier,
    snapshot_artifact_id: input.sourceSnapshotArtifactId,
    first_seen_at: input.observedAt,
    last_seen_at: input.observedAt,
    last_checked_at: input.observedAt,
    status: "live",
    confidence: input.confidence,
    claims_json: json(input.claims),
    provenance_json: json(input.provenance),
    created_at: input.observedAt,
    updated_at: input.observedAt,
    import_receipt_id: null
  });
  return { id, created: true };
}

export type UpsertJobOpportunityResult = {
  replayed: boolean;
  opportunity: Record<string, unknown>;
  deduplicated: boolean;
  referenceOnly: boolean;
  createdRecords: Array<{ table: string; id: string }>;
};

export function upsertJobOpportunity(
  access: WorkAccess,
  input: UpsertJobOpportunityInput,
  options: {
    insertOnly?: boolean;
    recordReceipt?: boolean;
    recordActivity?: boolean;
  } = {}
): UpsertJobOpportunityResult {
  assertScopeAssignment(access, input.scope);
  assertCompensationWrite(access, [input.compensation, input.benefits]);
  assertAuthorizedWorkReference({
    access,
    entityType: "work_organization",
    entityId: input.organizationId
  });
  assertAuthorizedWorkReference({
    access,
    entityType: "artifact",
    entityId: input.sourceSnapshotArtifactId
  });
  const requestFingerprint = fingerprint(input);
  const recordReceipt = options.recordReceipt ?? true;
  if (recordReceipt) {
    const replay = getOperationReceipt({
      ownerUserId: access.mutationOwnerUserId,
      operationKind: "opportunity_upsert",
      idempotencyKey: input.idempotencyKey,
      requestFingerprint
    });
    if (replay) {
      const response = (replay.response ?? {}) as Record<string, unknown>;
      if (
        !response.opportunity ||
        typeof response.opportunity !== "object" ||
        Array.isArray(response.opportunity)
      ) {
        throw new HttpError(
          409,
          "work_opportunity_receipt_invalid",
          "The stored opportunity receipt is incomplete and cannot be replayed safely."
        );
      }
      return {
        replayed: true,
        opportunity: response.opportunity as Record<string, unknown>,
        deduplicated: Boolean(response.deduplicated),
        referenceOnly: Boolean(response.referenceOnly),
        createdRecords: Array.isArray(replay.createdRecords)
          ? replay.createdRecords.flatMap((record) => {
              if (
                !record ||
                typeof record !== "object" ||
                Array.isArray(record)
              )
                return [];
              const value = record as Record<string, unknown>;
              return typeof value.table === "string" &&
                typeof value.id === "string"
                ? [{ table: value.table, id: value.id }]
                : [];
            })
          : []
      };
    }
  }
  const dedupeKey = opportunityDedupeKey(input);
  return runInTransaction(() => {
    const existing = findJobOpportunityDuplicate(
      access.mutationOwnerUserId,
      input
    );
    if (existing && options.insertOnly) {
      return {
        replayed: false,
        opportunity: getAuthorizedRoot("job_opportunity", existing.id, access),
        deduplicated: true,
        referenceOnly: true,
        createdRecords: []
      };
    }
    const now = nowIso();
    const id = existing?.id ?? input.id ?? newWorkId("jopp");
    const data = {
      organization_id: input.organizationId,
      canonical_url: normalizeUrl(input.canonicalUrl),
      source_name: input.sourceName,
      source_identifier: input.sourceIdentifier,
      dedupe_key: dedupeKey,
      title: input.title,
      employer_name: input.employerName,
      role_family: input.roleFamily,
      seniority: input.seniority,
      description: input.description,
      responsibilities_json: json(input.responsibilities),
      requirements_json: json(input.requirements),
      preferred_qualifications_json: json(input.preferredQualifications),
      skills_json: json(input.skills),
      technologies_json: json(input.technologies),
      sector: input.sector,
      location_json: json(input.location),
      work_model: input.workModel,
      travel_json: json(input.travel),
      sponsorship_json: json(input.sponsorship),
      employment_type: input.employmentType,
      weekly_hours_json: json(input.weeklyHours),
      duration_json: json(input.duration),
      start_date: input.startDate,
      compensation_json: json(input.compensation),
      benefits_json: json(input.benefits),
      application_route_json: json(input.applicationRoute),
      published_at: input.publishedAt,
      application_deadline: input.applicationDeadline,
      availability_status: input.availabilityStatus,
      disposition: input.disposition,
      confidence: input.confidence,
      unknowns_json: json(input.unknowns),
      red_flags_json: json(input.redFlags),
      eligibility_uncertainties_json: json(input.eligibilityUncertainties),
      excitement: input.excitement,
      decision: input.decision,
      decision_rationale: input.decisionRationale,
      next_action: input.nextAction,
      ...scopeColumns(input.scope),
      provenance_json: json(input.provenance)
    };
    if (existing) {
      updateRevisionedRow({
        table: "job_opportunities",
        id,
        expectedRevision: existing.revision,
        data: { ...data, last_checked_at: now }
      });
    } else {
      insertRow("job_opportunities", {
        id,
        owner_user_id: access.mutationOwnerUserId,
        ...data,
        first_seen_at: now,
        last_checked_at: now,
        revision: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        import_receipt_id: null
      });
      registerWorkRoot("job_opportunity", id, access.mutationOwnerUserId);
    }
    const source = refreshOpportunitySource({
      opportunityId: id,
      sourceName: input.sourceName,
      canonicalUrl: input.canonicalUrl,
      sourceIdentifier: input.sourceIdentifier,
      sourceSnapshotArtifactId: input.sourceSnapshotArtifactId,
      replaceSnapshot: input.sourceSnapshotArtifactId !== null,
      confidence: input.confidence,
      provenance: input.provenance,
      claims: opportunitySourceClaims(input, now),
      observedAt: now
    });
    const opportunity = getAuthorizedRoot("job_opportunity", id, access);
    const response = { opportunity, deduplicated: Boolean(existing) };
    const createdRecords = [
      ...(!existing ? [{ table: "job_opportunities", id }] : []),
      ...(source.created
        ? [{ table: "job_opportunity_sources", id: source.id }]
        : [])
    ];
    if (recordReceipt) {
      storeOperationReceipt({
        ownerUserId: access.mutationOwnerUserId,
        operationKind: "opportunity_upsert",
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        response,
        createdRecords
      });
    }
    if (options.recordActivity ?? true) {
      recordWorkActivity({
        entityType: "job_opportunity",
        entityId: id,
        eventType: existing
          ? "job_opportunity_refreshed"
          : "job_opportunity_discovered",
        title: `${existing ? "Opportunity refreshed" : "Opportunity discovered"}: ${input.title}`,
        actor: access.actor
      });
    }
    return {
      replayed: false,
      ...response,
      referenceOnly: false,
      createdRecords
    };
  });
}

export function evaluateJobOpportunity(input: {
  access: WorkAccess;
  campaignId: string;
  opportunityId: string;
  evaluation: Record<string, unknown>;
}) {
  getAuthorizedRoot("opportunity_campaign", input.campaignId, input.access);
  getAuthorizedRoot("job_opportunity", input.opportunityId, input.access);
  const criteria = getDatabase()
    .prepare(
      "SELECT id, criteria_json FROM campaign_criteria_versions WHERE id = ? AND campaign_id = ?"
    )
    .get(String(input.evaluation.criteriaVersionId), input.campaignId) as
    | { id: string; criteria_json: string }
    | undefined;
  if (!criteria) {
    throw new HttpError(
      409,
      "work_evaluation_criteria_mismatch",
      "The evaluation criteria version does not belong to this Opportunity Campaign."
    );
  }
  const criteriaDocument = JSON.parse(criteria.criteria_json) as {
    criteria?: Array<Record<string, unknown>>;
  };
  const campaignCriteria = Array.isArray(criteriaDocument.criteria)
    ? criteriaDocument.criteria
    : [];
  const criteriaByKey = new Map(
    campaignCriteria.map((criterion) => [String(criterion.key), criterion])
  );
  const criterionScores = Array.isArray(input.evaluation.criterionScores)
    ? (input.evaluation.criterionScores as Array<Record<string, unknown>>)
    : [];
  const evaluatedKeys = new Set<string>();
  for (const item of criterionScores) {
    const criterionKey = String(item.criterionKey ?? "");
    if (!criteriaByKey.has(criterionKey)) {
      throw new HttpError(
        409,
        "work_evaluation_criterion_mismatch",
        "An evaluation matrix item does not belong to the selected criteria version.",
        { criterionKey }
      );
    }
    if (evaluatedKeys.has(criterionKey)) {
      throw new HttpError(
        409,
        "work_evaluation_criterion_duplicate",
        "An evaluation may contain only one matrix item for each criterion key.",
        { criterionKey }
      );
    }
    evaluatedKeys.add(criterionKey);
  }
  const hardCriteria = campaignCriteria.filter(
    (criterion) => criterion.importance === "hard"
  );
  const failedHardCriteria = criterionScores.filter((item) => {
    const criterion = criteriaByKey.get(String(item.criterionKey ?? ""));
    return criterion?.importance === "hard" && item.result === "fail";
  });
  if (
    failedHardCriteria.length > 0 &&
    input.evaluation.hardGateResult !== "fail"
  ) {
    throw new HttpError(
      409,
      "work_evaluation_hard_gate_inconsistent",
      "A failed hard criterion requires the evaluation hard-gate result to be fail."
    );
  }
  if (input.evaluation.hardGateResult === "pass") {
    const unresolvedHardCriteria = hardCriteria.filter((criterion) => {
      const item = criterionScores.find(
        (candidate) => candidate.criterionKey === criterion.key
      );
      return !item || item.result !== "pass";
    });
    if (unresolvedHardCriteria.length > 0) {
      throw new HttpError(
        409,
        "work_evaluation_hard_gate_unproved",
        "A hard-gate pass requires an explicit passing matrix item for every hard criterion.",
        {
          criterionKeys: unresolvedHardCriteria.map((criterion) =>
            String(criterion.key)
          )
        }
      );
    }
  }
  const evidenceRecords = [
    ...(Array.isArray(input.evaluation.evidenceSources)
      ? (input.evaluation.evidenceSources as Array<Record<string, unknown>>)
      : []),
    ...(Array.isArray(input.evaluation.matchedEvidence)
      ? (input.evaluation.matchedEvidence as Array<Record<string, unknown>>)
      : []),
    ...criterionScores.flatMap((item) =>
      Array.isArray(item.matchedEvidence)
        ? (item.matchedEvidence as Array<Record<string, unknown>>)
        : []
    )
  ];
  for (const evidence of evidenceRecords) {
    assertAuthorizedWorkReference({
      access: input.access,
      entityType: "artifact",
      entityId:
        typeof evidence.sourceArtifactId === "string"
          ? evidence.sourceArtifactId
          : null
    });
  }
  if (
    criteriaContainCompensation(JSON.parse(criteria.criteria_json)) &&
    !input.access.canCompensation
  ) {
    throw new HttpError(
      403,
      "work_compensation_scope_required",
      "Evaluating compensation criteria requires Work compensation authority."
    );
  }
  return runInTransaction(() => {
    const current = getDatabase()
      .prepare(
        "SELECT COALESCE(MAX(evaluation_version), 0) AS version FROM campaign_opportunity_evaluations WHERE campaign_id = ? AND opportunity_id = ?"
      )
      .get(input.campaignId, input.opportunityId) as { version: number };
    const id = newWorkId("jeval");
    const evaluatedAt = String(input.evaluation.evaluatedAt ?? nowIso());
    insertRow("campaign_opportunity_evaluations", {
      id,
      campaign_id: input.campaignId,
      opportunity_id: input.opportunityId,
      criteria_version_id: input.evaluation.criteriaVersionId,
      evaluation_version: current.version + 1,
      evaluated_at: evaluatedAt,
      evaluator_json: json(input.evaluation.evaluator),
      model_provenance_json: json(input.evaluation.modelProvenance),
      evidence_sources_json: json(input.evaluation.evidenceSources),
      overall_score: input.evaluation.overallScore,
      confidence: input.evaluation.confidence,
      hard_gate_result: input.evaluation.hardGateResult,
      criterion_scores_json: json(input.evaluation.criterionScores),
      matched_evidence_json: json(input.evaluation.matchedEvidence),
      gaps_json: json(input.evaluation.gaps),
      failure_reasons_json: json(input.evaluation.failureReasons),
      tradeoffs_json: json(input.evaluation.tradeoffs),
      recommendation: input.evaluation.recommendation,
      human_override_json: json(input.evaluation.humanOverride ?? {}),
      provenance_json: json(input.evaluation.provenance),
      created_at: nowIso(),
      import_receipt_id: null
    });
    recordWorkActivity({
      entityType: "job_opportunity",
      entityId: input.opportunityId,
      eventType: "job_opportunity_evaluated",
      title: `Opportunity evaluated for campaign ${input.campaignId}`,
      actor: input.access.actor
    });
    return rowToWorkRecord(
      getDatabase()
        .prepare("SELECT * FROM campaign_opportunity_evaluations WHERE id = ?")
        .get(id) as SqlRow,
      input.access
    );
  });
}

export function getJobOpportunityDetail(access: WorkAccess, id: string) {
  const opportunity = getAuthorizedRoot("job_opportunity", id, access);
  const sources = getDatabase()
    .prepare(
      `SELECT * FROM job_opportunity_sources
       WHERE opportunity_id = ? ORDER BY last_checked_at DESC, id ASC LIMIT 50`
    )
    .all(id) as SqlRow[];
  const evaluations = getDatabase()
    .prepare(
      `SELECT * FROM campaign_opportunity_evaluations
       WHERE opportunity_id = ?
       ORDER BY evaluated_at DESC, evaluation_version DESC LIMIT 50`
    )
    .all(id) as SqlRow[];
  const applications = getDatabase()
    .prepare(
      `SELECT * FROM job_applications
       WHERE opportunity_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC, id ASC LIMIT 50`
    )
    .all(id) as SqlRow[];
  return {
    ...opportunity,
    sources: sources.map((row) => rowToWorkRecord(row, access)),
    evaluations: evaluations.map((row) => rowToWorkRecord(row, access)),
    applications: applications.map((row) => rowToWorkRecord(row, access)),
    history: listWorkActivityHistory("job_opportunity", id, access),
    links: listAuthorizedWorkLinks("job_opportunity", id, access)
  };
}

export function updateJobOpportunity(
  access: WorkAccess,
  id: string,
  input: UpdateJobOpportunityInput
) {
  const current = getAuthorizedRoot("job_opportunity", id, access);
  if (input.scope) assertScopeAssignment(access, input.scope);
  if (input.compensation !== undefined || input.benefits !== undefined) {
    if (!access.canCompensation) {
      throw new HttpError(
        403,
        "work_compensation_scope_required",
        "Updating opportunity compensation or benefits requires Work compensation authority."
      );
    }
  }
  if (input.organizationId !== undefined) {
    assertAuthorizedWorkReference({
      access,
      entityType: "work_organization",
      entityId: input.organizationId
    });
  }
  if (input.sourceSnapshotArtifactId !== undefined) {
    assertAuthorizedWorkReference({
      access,
      entityType: "artifact",
      entityId: input.sourceSnapshotArtifactId
    });
  }
  const scalar: Record<string, string> = {
    organizationId: "organization_id",
    canonicalUrl: "canonical_url",
    sourceName: "source_name",
    sourceIdentifier: "source_identifier",
    title: "title",
    employerName: "employer_name",
    roleFamily: "role_family",
    seniority: "seniority",
    description: "description",
    sector: "sector",
    workModel: "work_model",
    employmentType: "employment_type",
    startDate: "start_date",
    publishedAt: "published_at",
    applicationDeadline: "application_deadline",
    availabilityStatus: "availability_status",
    disposition: "disposition",
    confidence: "confidence",
    excitement: "excitement",
    decision: "decision",
    decisionRationale: "decision_rationale",
    nextAction: "next_action"
  };
  const structured: Record<string, string> = {
    responsibilities: "responsibilities_json",
    requirements: "requirements_json",
    preferredQualifications: "preferred_qualifications_json",
    skills: "skills_json",
    technologies: "technologies_json",
    location: "location_json",
    travel: "travel_json",
    sponsorship: "sponsorship_json",
    weeklyHours: "weekly_hours_json",
    duration: "duration_json",
    compensation: "compensation_json",
    benefits: "benefits_json",
    applicationRoute: "application_route_json",
    unknowns: "unknowns_json",
    redFlags: "red_flags_json",
    eligibilityUncertainties: "eligibility_uncertainties_json",
    provenance: "provenance_json"
  };
  const data: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(scalar)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) {
      data[column] =
        key === "canonicalUrl" ? normalizeUrl(String(value)) : value;
    }
  }
  for (const [key, column] of Object.entries(structured)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) data[column] = json(value);
  }
  if (input.scope) Object.assign(data, scopeColumns(input.scope));
  const sourceRefreshRequested =
    input.canonicalUrl !== undefined ||
    input.sourceName !== undefined ||
    input.sourceIdentifier !== undefined ||
    input.sourceSnapshotArtifactId !== undefined ||
    input.confidence !== undefined ||
    input.claimEvidence !== undefined;
  return runInTransaction(() => {
    const dedupeInput = {
      canonicalUrl: String(input.canonicalUrl ?? current.canonicalUrl ?? ""),
      sourceName: String(input.sourceName ?? current.sourceName ?? ""),
      sourceIdentifier: String(
        input.sourceIdentifier ?? current.sourceIdentifier ?? ""
      ),
      employerName: String(input.employerName ?? current.employerName ?? ""),
      title: String(input.title ?? current.title ?? ""),
      description: String(input.description ?? current.description ?? "")
    };
    const dedupeKey = opportunityDedupeKey(dedupeInput);
    const duplicate = findJobOpportunityDuplicate(
      access.mutationOwnerUserId,
      dedupeInput,
      id
    );
    if (duplicate) {
      throw new HttpError(
        409,
        "work_opportunity_duplicate",
        "This change would make the opportunity duplicate an existing role. Open the existing opportunity instead."
      );
    }
    data.dedupe_key = dedupeKey;
    updateRevisionedRow({
      table: "job_opportunities",
      id,
      expectedRevision: input.expectedRevision,
      data
    });
    if (sourceRefreshRequested) {
      const observedAt = nowIso();
      const source = {
        sourceName: dedupeInput.sourceName,
        canonicalUrl: dedupeInput.canonicalUrl,
        sourceIdentifier: dedupeInput.sourceIdentifier,
        sourceSnapshotArtifactId: input.sourceSnapshotArtifactId ?? null,
        replaceSnapshot: input.sourceSnapshotArtifactId !== undefined,
        confidence:
          input.confidence === undefined
            ? ((current.confidence as number | null | undefined) ?? null)
            : input.confidence,
        provenance: input.provenance ?? current.provenance ?? {}
      };
      refreshOpportunitySource({
        opportunityId: id,
        ...source,
        claims: sourceClaimsForOpportunityUpdate({
          existingClaims: currentOpportunitySourceClaims({
            opportunityId: id,
            ...source
          }),
          update: input,
          source,
          observedAt
        }),
        observedAt
      });
    }
    recordWorkActivity({
      entityType: "job_opportunity",
      entityId: id,
      eventType: "job_opportunity_updated",
      title: "Job opportunity updated",
      actor: access.actor,
      metadata: {
        beforeRevision: current.revision,
        afterRevision: Number(current.revision) + 1,
        priorDisposition: current.disposition,
        newDisposition: input.disposition ?? current.disposition,
        changedFields: Object.keys(input).filter(
          (key) => !["expectedRevision", "claimEvidence"].includes(key)
        ),
        provenance: input.provenance ?? {}
      }
    });
    return getJobOpportunityDetail(access, id);
  });
}
