import { randomUUID } from "node:crypto";

import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { isEntityDeleted } from "../repositories/deleted-entities.js";
import { getEntityOwnerId } from "../repositories/entity-ownership.js";
import { getUserById } from "../repositories/users.js";
import {
  crudEntityTypeSchema,
  relationshipProposalEvidenceSchema,
  relationshipProposalSchema,
  type CrudEntityType,
  type RelationshipProposal,
  type RelationshipProposalEvidence,
  type RelationshipProposalRelation
} from "../types.js";
import { getEntityById } from "./entity-crud.js";
import {
  buildLocalSearchSourceHref,
  type LocalSearchDocument
} from "./local-search.js";

export const RELATIONSHIP_PROPOSAL_GENERATOR_ID = "forge-local-overlap";
export const RELATIONSHIP_PROPOSAL_GENERATOR_VERSION = "1.0.0";
export const RELATIONSHIP_PROPOSAL_CONFIDENCE_THRESHOLD = 0.82;
export const RELATIONSHIP_PROPOSAL_MAX_SOURCE_DOCUMENTS = 750;
export const RELATIONSHIP_PROPOSAL_MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
export const RELATIONSHIP_PROPOSAL_MAX_COMPARISONS = 2_000;
export const RELATIONSHIP_PROPOSAL_MAX_PENDING_PER_OWNER = 120;
export const RELATIONSHIP_PROPOSAL_LIST_LIMIT = 20;
export const RELATIONSHIP_PROPOSAL_EXPIRY_DAYS = 7;
export const RELATIONSHIP_PROPOSAL_RESOLVED_RETENTION_DAYS = 90;

const SUPPORTING_TYPES = new Set<CrudEntityType>([
  "project",
  "task",
  "strategy",
  "habit"
]);
const EVIDENCE_TYPES = new Set<CrudEntityType>([
  "note",
  "insight",
  "artifact",
  "trigger_report",
  "questionnaire_instrument"
]);
const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "before",
  "build",
  "complete",
  "create",
  "concerning",
  "evidence",
  "focused",
  "from",
  "into",
  "make",
  "plan",
  "record",
  "review",
  "that",
  "the",
  "their",
  "this",
  "through",
  "using",
  "with",
  "work"
]);

export type RelationshipProposalSourceDocument = LocalSearchDocument & {
  ownerUserId: string;
  authorized?: boolean;
  deleted?: boolean;
};

export type RelationshipProposalCandidate = {
  canonicalPairKey: string;
  source: RelationshipProposalSourceDocument;
  target: RelationshipProposalSourceDocument;
  relationship: RelationshipProposalRelation;
  evidence: RelationshipProposalEvidence[];
  explanation: string;
  confidence: number;
};

export type RelationshipProposalGenerationResult = {
  candidates: RelationshipProposalCandidate[];
  consideredDocuments: number;
  comparisons: number;
  unauthorizedCandidateCount: number;
  truncated: boolean;
};

type RelationshipProposalRow = {
  id: string;
  owner_user_id: string;
  source_entity_type: string;
  source_entity_id: string;
  target_entity_type: string;
  target_entity_id: string;
  canonical_pair_key: string;
  relationship: RelationshipProposalRelation;
  evidence_json: string;
  explanation: string;
  confidence: number;
  generator_id: string;
  generator_version: string;
  generation_epoch: string;
  status: "pending" | "accepted" | "rejected" | "expired";
  revision: number;
  expires_at: string;
  resolved_by_actor: string | null;
  resolved_at: string | null;
  link_created: number;
  created_at: string;
  updated_at: string;
};

export type RelationshipProposalDecisionResult =
  | {
      status: "accepted" | "rejected";
      proposalId: string;
      revision: number;
      linkCreated: boolean;
      replayed: boolean;
    }
  | { status: "not_found" | "conflict" | "expired" | "unavailable" };

function entityKey(document: Pick<LocalSearchDocument, "entityType" | "entityId">) {
  return `${document.entityType}:${document.entityId}`;
}

function canonicalPairKey(
  left: Pick<LocalSearchDocument, "entityType" | "entityId">,
  right: Pick<LocalSearchDocument, "entityType" | "entityId">
) {
  return [entityKey(left), entityKey(right)].sort().join("\u001f");
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US");
}

function tokenize(value: string) {
  return normalizeText(value)
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((term) => term.length >= 3 && !STOP_WORDS.has(term)) ?? [];
}

function documentTerms(document: LocalSearchDocument) {
  const fields = [
    { key: "title", value: document.title },
    { key: "detail", value: document.detail },
    ...document.fields.map((field) => ({
      key: field.label || field.key,
      value: field.value
    }))
  ];
  const terms = new Map<string, string>();
  for (const field of fields) {
    for (const term of tokenize(field.value)) {
      if (!terms.has(term)) terms.set(term, field.key);
    }
  }
  return terms;
}

function orderCandidate(
  left: RelationshipProposalSourceDocument,
  right: RelationshipProposalSourceDocument
): {
  source: RelationshipProposalSourceDocument;
  target: RelationshipProposalSourceDocument;
  relationship: RelationshipProposalRelation;
} {
  if (SUPPORTING_TYPES.has(left.entityType) && right.entityType === "goal") {
    return { source: left, target: right, relationship: "supports" };
  }
  if (SUPPORTING_TYPES.has(right.entityType) && left.entityType === "goal") {
    return { source: right, target: left, relationship: "supports" };
  }
  if (EVIDENCE_TYPES.has(left.entityType) && !EVIDENCE_TYPES.has(right.entityType)) {
    return { source: left, target: right, relationship: "informs" };
  }
  if (EVIDENCE_TYPES.has(right.entityType) && !EVIDENCE_TYPES.has(left.entityType)) {
    return { source: right, target: left, relationship: "informs" };
  }
  return entityKey(left).localeCompare(entityKey(right)) <= 0
    ? { source: left, target: right, relationship: "related" }
    : { source: right, target: left, relationship: "related" };
}

function existingLinkKey(input: {
  sourceEntityType: string;
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
  relationship: string;
}) {
  const source = `${input.sourceEntityType}:${input.sourceEntityId}`;
  const target = `${input.targetEntityType}:${input.targetEntityId}`;
  if (input.relationship === "related") {
    return `${[source, target].sort().join("\u001f")}:related`;
  }
  return `${source}>${target}:${input.relationship}`;
}

function candidateLinkKey(candidate: RelationshipProposalCandidate) {
  return existingLinkKey({
    sourceEntityType: candidate.source.entityType,
    sourceEntityId: candidate.source.entityId,
    targetEntityType: candidate.target.entityType,
    targetEntityId: candidate.target.entityId,
    relationship: candidate.relationship
  });
}

export function generateRelationshipProposalCandidates(input: {
  ownerUserId: string;
  documents: RelationshipProposalSourceDocument[];
  existingLinkKeys?: ReadonlySet<string>;
  maxComparisons?: number;
}): RelationshipProposalGenerationResult {
  const maxComparisons = Math.min(
    Math.max(input.maxComparisons ?? RELATIONSHIP_PROPOSAL_MAX_COMPARISONS, 1),
    RELATIONSHIP_PROPOSAL_MAX_COMPARISONS
  );
  const eligible = input.documents
    .filter(
      (document) =>
        document.ownerUserId === input.ownerUserId &&
        document.authorized !== false &&
        document.deleted !== true
    )
    .slice(0, RELATIONSHIP_PROPOSAL_MAX_SOURCE_DOCUMENTS);
  const terms = new Map(eligible.map((document) => [entityKey(document), documentTerms(document)]));
  const candidates: RelationshipProposalCandidate[] = [];
  let comparisons = 0;
  let truncated = input.documents.length > eligible.length;

  outer: for (let leftIndex = 0; leftIndex < eligible.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < eligible.length; rightIndex += 1) {
      if (comparisons >= maxComparisons) {
        truncated = true;
        break outer;
      }
      comparisons += 1;
      const left = eligible[leftIndex]!;
      const right = eligible[rightIndex]!;
      if (entityKey(left) === entityKey(right)) continue;
      const leftTerms = terms.get(entityKey(left))!;
      const rightTerms = terms.get(entityKey(right))!;
      const shared = [...leftTerms.keys()]
        .filter((term) => rightTerms.has(term))
        .sort()
        .slice(0, 8);
      const ordered = orderCandidate(left, right);
      const requiredOverlap = ordered.relationship === "related" ? 3 : 2;
      if (shared.length < requiredOverlap) continue;
      const smallerTermCount = Math.max(1, Math.min(leftTerms.size, rightTerms.size));
      const coverage = shared.length / smallerTermCount;
      const confidence = Math.min(
        0.99,
        Number((0.72 + shared.length * 0.06 + Math.min(coverage, 1) * 0.12).toFixed(4))
      );
      if (confidence < RELATIONSHIP_PROPOSAL_CONFIDENCE_THRESHOLD) continue;
      const sourceTerms = terms.get(entityKey(ordered.source))!;
      const targetTerms = terms.get(entityKey(ordered.target))!;
      const evidence = relationshipProposalEvidenceSchema.array().parse([
        {
          sourceField: sourceTerms.get(shared[0]!) ?? "title",
          targetField: targetTerms.get(shared[0]!) ?? "title",
          matchedTerms: shared
        }
      ]);
      const candidate: RelationshipProposalCandidate = {
        canonicalPairKey: canonicalPairKey(ordered.source, ordered.target),
        source: ordered.source,
        target: ordered.target,
        relationship: ordered.relationship,
        evidence,
        explanation:
          ordered.relationship === "related"
            ? `These records share the specific terms ${shared.join(", ")}. Review whether they belong together.`
            : `The ${ordered.source.category.toLowerCase()} shares the specific terms ${shared.join(", ")} and may ${ordered.relationship} the ${ordered.target.category.toLowerCase()}.`,
        confidence
      };
      if (!input.existingLinkKeys?.has(candidateLinkKey(candidate))) {
        candidates.push(candidate);
      }
    }
  }

  candidates.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      left.canonicalPairKey.localeCompare(right.canonicalPairKey) ||
      left.relationship.localeCompare(right.relationship)
  );
  return {
    candidates: candidates.slice(0, RELATIONSHIP_PROPOSAL_MAX_PENDING_PER_OWNER),
    consideredDocuments: eligible.length,
    comparisons,
    unauthorizedCandidateCount: candidates.filter(
      (candidate) =>
        candidate.source.ownerUserId !== input.ownerUserId ||
        candidate.target.ownerUserId !== input.ownerUserId ||
        candidate.source.authorized === false ||
        candidate.target.authorized === false ||
        candidate.source.deleted === true ||
        candidate.target.deleted === true
    ).length,
    truncated
  };
}

function proposalId() {
  return `rpr_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function readRows(ownerUserId: string): RelationshipProposalRow[] {
  return getDatabase()
    .prepare(
      `SELECT id, owner_user_id, source_entity_type, source_entity_id,
              target_entity_type, target_entity_id, canonical_pair_key,
              relationship, evidence_json, explanation, confidence,
              generator_id, generator_version, generation_epoch, status,
              revision, expires_at, resolved_by_actor, resolved_at,
              link_created, created_at, updated_at
       FROM relationship_proposals
       WHERE owner_user_id = ?
       ORDER BY confidence DESC, created_at ASC, id ASC`
    )
    .all(ownerUserId) as RelationshipProposalRow[];
}

function readRow(id: string, ownerUserId: string) {
  return getDatabase()
    .prepare(
      `SELECT id, owner_user_id, source_entity_type, source_entity_id,
              target_entity_type, target_entity_id, canonical_pair_key,
              relationship, evidence_json, explanation, confidence,
              generator_id, generator_version, generation_epoch, status,
              revision, expires_at, resolved_by_actor, resolved_at,
              link_created, created_at, updated_at
       FROM relationship_proposals
       WHERE id = ? AND owner_user_id = ?`
    )
    .get(id, ownerUserId) as RelationshipProposalRow | undefined;
}

function getString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function liveEndpoint(entityTypeValue: string, entityId: string, ownerUserId: string) {
  const parsedType = crudEntityTypeSchema.safeParse(entityTypeValue);
  if (!parsedType.success) return null;
  const entityType = parsedType.data;
  if (
    getEntityOwnerId(entityType, entityId) !== ownerUserId ||
    isEntityDeleted(entityType, entityId)
  ) {
    return null;
  }
  const record = getEntityById(entityType, entityId);
  if (!record) return null;
  const title =
    getString(record, ["title", "name", "label", "question", "displayName"]) ??
    `${entityType.replaceAll("_", " ")} record`;
  const detail =
    getString(record, ["summary", "description", "notes", "status"]) ??
    "Open the source record for details.";
  return {
    entityType,
    entityId,
    title: title.slice(0, 500),
    detail: detail.slice(0, 1_000),
    sourceHref: buildLocalSearchSourceHref(entityType, entityId),
    graphHref: `/knowledge-graph?focus=${encodeURIComponent(`${entityType}:${entityId}`)}`
  };
}

function mapVisibleProposal(row: RelationshipProposalRow): RelationshipProposal | null {
  if (row.status !== "pending") return null;
  const source = liveEndpoint(
    row.source_entity_type,
    row.source_entity_id,
    row.owner_user_id
  );
  const target = liveEndpoint(
    row.target_entity_type,
    row.target_entity_id,
    row.owner_user_id
  );
  if (!source || !target) return null;
  return relationshipProposalSchema.parse({
    id: row.id,
    ownerUserId: row.owner_user_id,
    source,
    target,
    relationship: row.relationship,
    evidence: JSON.parse(row.evidence_json),
    explanation: row.explanation,
    confidence: row.confidence,
    generator: { id: row.generator_id, version: row.generator_version },
    status: row.status,
    revision: row.revision,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function scrubAsExpired(id: string, nowIso: string) {
  getDatabase()
    .prepare(
      `UPDATE relationship_proposals
       SET status = 'expired', evidence_json = '[]',
           explanation = 'This suggestion is no longer available.',
           resolved_at = ?, updated_at = ?, revision = revision + 1
       WHERE id = ? AND status = 'pending'`
    )
    .run(nowIso, nowIso, id);
}

function expireAndPrune(ownerUserId: string, now: Date) {
  const nowIso = now.toISOString();
  getDatabase()
    .prepare(
      `UPDATE relationship_proposals
       SET status = 'expired', evidence_json = '[]',
           explanation = 'This suggestion expired before review.',
           resolved_at = ?, updated_at = ?, revision = revision + 1
       WHERE owner_user_id = ? AND status = 'pending' AND expires_at <= ?`
    )
    .run(nowIso, nowIso, ownerUserId, nowIso);
  const retentionCutoff = new Date(
    now.getTime() - RELATIONSHIP_PROPOSAL_RESOLVED_RETENTION_DAYS * 86_400_000
  ).toISOString();
  getDatabase()
    .prepare(
      `DELETE FROM relationship_proposals
       WHERE owner_user_id = ? AND status IN ('expired', 'accepted', 'rejected')
         AND resolved_at < ?`
    )
    .run(ownerUserId, retentionCutoff);
}

function listOwnerExistingLinkKeys(ownerUserId: string) {
  const rows = getDatabase()
    .prepare(
      `SELECT links.source_entity_type, links.source_entity_id,
              links.target_entity_type, links.target_entity_id,
              links.relationship
       FROM entity_links links
       INNER JOIN entity_owners source_owner
         ON source_owner.entity_type = links.source_entity_type
        AND source_owner.entity_id = links.source_entity_id
        AND source_owner.role = 'owner'
       INNER JOIN entity_owners target_owner
         ON target_owner.entity_type = links.target_entity_type
        AND target_owner.entity_id = links.target_entity_id
        AND target_owner.role = 'owner'
       WHERE source_owner.user_id = ? AND target_owner.user_id = ?`
    )
    .all(ownerUserId, ownerUserId) as Array<{
    source_entity_type: string;
    source_entity_id: string;
    target_entity_type: string;
    target_entity_id: string;
    relationship: string;
  }>;
  return new Set(
    rows.map((row) =>
      existingLinkKey({
        sourceEntityType: row.source_entity_type,
        sourceEntityId: row.source_entity_id,
        targetEntityType: row.target_entity_type,
        targetEntityId: row.target_entity_id,
        relationship: row.relationship
      })
    )
  );
}

export function selectOwnerRelationshipProposalDocuments(
  ownerUserId: string,
  documents: LocalSearchDocument[]
): RelationshipProposalSourceDocument[] {
  if (!getUserById(ownerUserId)) return [];
  return documents.flatMap((document) => {
    if (
      getEntityOwnerId(document.entityType, document.entityId) !== ownerUserId ||
      isEntityDeleted(document.entityType, document.entityId) ||
      !getEntityById(document.entityType, document.entityId)
    ) {
      return [];
    }
    return [{ ...document, ownerUserId, authorized: true, deleted: false }];
  });
}

export function createOwnerRelationshipProposals(input: {
  ownerUserId: string;
  documents: LocalSearchDocument[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const ownerDocuments = selectOwnerRelationshipProposalDocuments(
    input.ownerUserId,
    input.documents
  );
  const authorizedDocumentBytes = ownerDocuments.reduce(
    (total, document) =>
      total +
      Buffer.byteLength(document.title) +
      Buffer.byteLength(document.detail) +
      document.fields.reduce(
        (fieldTotal, field) => fieldTotal + Buffer.byteLength(field.value),
        0
      ),
    0
  );
  if (
    ownerDocuments.length > RELATIONSHIP_PROPOSAL_MAX_SOURCE_DOCUMENTS ||
    authorizedDocumentBytes > RELATIONSHIP_PROPOSAL_MAX_DOCUMENT_BYTES
  ) {
    throw new HttpError(
      413,
      "relationship_proposal_capacity_exceeded",
      `The authorized proposal source exceeds the bounded envelope of ${RELATIONSHIP_PROPOSAL_MAX_SOURCE_DOCUMENTS} records or ${RELATIONSHIP_PROPOSAL_MAX_DOCUMENT_BYTES} text bytes.`
    );
  }
  const generation = generateRelationshipProposalCandidates({
    ownerUserId: input.ownerUserId,
    documents: ownerDocuments,
    existingLinkKeys: listOwnerExistingLinkKeys(input.ownerUserId)
  });
  const generationEpoch = `${now.toISOString()}:${randomUUID().slice(0, 8)}`;
  const expiresAt = new Date(
    now.getTime() + RELATIONSHIP_PROPOSAL_EXPIRY_DAYS * 86_400_000
  ).toISOString();

  const created = runInTransaction(() => {
    expireAndPrune(input.ownerUserId, now);
    const existingRows = readRows(input.ownerUserId);
    const blockedPairs = new Set(
      existingRows
        .filter((row) =>
          ["pending", "accepted", "rejected"].includes(row.status)
        )
        .map((row) => `${row.canonical_pair_key}:${row.relationship}`)
    );
    const pendingCount = existingRows.filter((row) => row.status === "pending").length;
    const available = Math.max(
      0,
      RELATIONSHIP_PROPOSAL_MAX_PENDING_PER_OWNER - pendingCount
    );
    const insert = getDatabase().prepare(
      `INSERT INTO relationship_proposals (
         id, owner_user_id, source_entity_type, source_entity_id,
         target_entity_type, target_entity_id, canonical_pair_key,
         relationship, evidence_json, explanation, confidence,
         generator_id, generator_version, generation_epoch, status,
         revision, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?)`
    );
    let inserted = 0;
    for (const candidate of generation.candidates) {
      if (inserted >= available) break;
      const historyKey = `${candidate.canonicalPairKey}:${candidate.relationship}`;
      if (blockedPairs.has(historyKey)) continue;
      insert.run(
        proposalId(),
        input.ownerUserId,
        candidate.source.entityType,
        candidate.source.entityId,
        candidate.target.entityType,
        candidate.target.entityId,
        candidate.canonicalPairKey,
        candidate.relationship,
        JSON.stringify(candidate.evidence),
        candidate.explanation,
        candidate.confidence,
        RELATIONSHIP_PROPOSAL_GENERATOR_ID,
        RELATIONSHIP_PROPOSAL_GENERATOR_VERSION,
        generationEpoch,
        expiresAt,
        now.toISOString(),
        now.toISOString()
      );
      blockedPairs.add(historyKey);
      inserted += 1;
    }
    return inserted;
  });

  return {
    ...listOwnerRelationshipProposals(input.ownerUserId),
    generation: {
      generator: {
        id: RELATIONSHIP_PROPOSAL_GENERATOR_ID,
        version: RELATIONSHIP_PROPOSAL_GENERATOR_VERSION
      },
      consideredDocuments: generation.consideredDocuments,
      comparisons: generation.comparisons,
      created,
      unauthorizedCandidateCount: generation.unauthorizedCandidateCount,
      truncated: generation.truncated
    }
  };
}

export function listOwnerRelationshipProposals(
  ownerUserId: string,
  limit = RELATIONSHIP_PROPOSAL_LIST_LIMIT,
  now = new Date()
) {
  return runInTransaction(() => {
    expireAndPrune(ownerUserId, now);
    const visible: RelationshipProposal[] = [];
    for (const row of readRows(ownerUserId).filter((item) => item.status === "pending")) {
      const proposal = mapVisibleProposal(row);
      if (proposal) visible.push(proposal);
      else scrubAsExpired(row.id, now.toISOString());
    }
    const boundedLimit = Math.min(
      Math.max(limit, 1),
      RELATIONSHIP_PROPOSAL_LIST_LIMIT
    );
    return {
      proposals: visible.slice(0, boundedLimit),
      total: visible.length,
      shown: Math.min(visible.length, boundedLimit),
      limit: boundedLimit,
      generatedAt: now.toISOString()
    };
  });
}

export function decideRelationshipProposal(input: {
  proposalId: string;
  ownerUserId: string;
  expectedRevision: number;
  action: "accept" | "reject";
  actor: string | null;
  now?: Date;
}): RelationshipProposalDecisionResult {
  return runInTransaction(() => {
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    const row = readRow(input.proposalId, input.ownerUserId);
    if (!row) return { status: "not_found" };

    if (row.status === "accepted" || row.status === "rejected") {
      const completedAction = row.status === "accepted" ? "accept" : "reject";
      if (completedAction !== input.action) return { status: "conflict" };
      return {
        status: row.status,
        proposalId: row.id,
        revision: row.revision,
        linkCreated: row.link_created === 1,
        replayed: true
      };
    }
    if (row.status === "expired") return { status: "expired" };
    if (row.expires_at <= nowIso) {
      scrubAsExpired(row.id, nowIso);
      return { status: "expired" };
    }
    if (row.revision !== input.expectedRevision) return { status: "conflict" };

    if (input.action === "reject") {
      const result = getDatabase()
        .prepare(
          `UPDATE relationship_proposals
           SET status = 'rejected', evidence_json = '[]',
               explanation = 'Rejected by a human reviewer.',
               resolved_by_actor = ?, resolved_at = ?, updated_at = ?,
               revision = revision + 1
           WHERE id = ? AND owner_user_id = ? AND status = 'pending' AND revision = ?`
        )
        .run(
          input.actor,
          nowIso,
          nowIso,
          row.id,
          row.owner_user_id,
          input.expectedRevision
        );
      if (result.changes !== 1) return { status: "conflict" };
      return {
        status: "rejected",
        proposalId: row.id,
        revision: row.revision + 1,
        linkCreated: false,
        replayed: false
      };
    }

    const source = liveEndpoint(
      row.source_entity_type,
      row.source_entity_id,
      row.owner_user_id
    );
    const target = liveEndpoint(
      row.target_entity_type,
      row.target_entity_id,
      row.owner_user_id
    );
    if (!source || !target) {
      scrubAsExpired(row.id, nowIso);
      return { status: "unavailable" };
    }
    const result = getDatabase()
      .prepare(
        `UPDATE relationship_proposals
         SET status = 'accepted', evidence_json = '[]',
             explanation = 'Accepted by a human reviewer.',
             resolved_by_actor = ?, resolved_at = ?, link_created = 1,
             updated_at = ?, revision = revision + 1
         WHERE id = ? AND owner_user_id = ? AND status = 'pending' AND revision = ?`
      )
      .run(
        input.actor,
        nowIso,
        nowIso,
        row.id,
        row.owner_user_id,
        input.expectedRevision
      );
    if (result.changes !== 1) return { status: "conflict" };
    getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO entity_links (
           source_entity_type, source_entity_id, target_entity_type,
           target_entity_id, anchor_key, relationship, created_by_actor, created_at
         ) VALUES (?, ?, ?, ?, '', ?, ?, ?)`
      )
      .run(
        source.entityType,
        source.entityId,
        target.entityType,
        target.entityId,
        row.relationship,
        input.actor,
        nowIso
      );
    return {
      status: "accepted",
      proposalId: row.id,
      revision: row.revision + 1,
      linkCreated: true,
      replayed: false
    };
  });
}
