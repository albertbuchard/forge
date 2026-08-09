import { createHash, randomUUID } from "node:crypto";
import { formatLocalDateKey } from "@/lib/date-keys.js";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { recordActivityEvent } from "../repositories/activity-events.js";
import {
  attentionResolutionAttemptSchema,
  attentionResolutionCheckResponseSchema,
  attentionResolutionListSchema,
  attentionResolutionReceiptSchema,
  attentionResolutionStartResultSchema,
  type AttentionInboxItem,
  type AttentionInboxKind,
  type AttentionPrimaryAction,
  type AttentionResolutionActionKey,
  type AttentionResolutionAttempt,
  type AttentionResolutionCheckResponse,
  type AttentionResolutionCheckResult,
  type AttentionResolutionList,
  type AttentionResolutionReceipt,
  type AttentionResolutionStartResult
} from "../types.js";

export const ATTENTION_RESOLUTION_RETENTION_DAYS = 365;
export const ATTENTION_RESOLUTION_MAX_PER_ACTOR = 5_000;
const MAX_PENDING_CHECKS = 100;

type AttentionResolutionAttemptRow = {
  id: string;
  actor_key: string;
  owner_user_id: string | null;
  scoped_user_ids_json: string;
  idempotency_key: string;
  request_fingerprint: string;
  item_id: string;
  source: AttentionInboxItem["source"];
  kind: AttentionInboxKind;
  action_key: AttentionResolutionActionKey;
  source_ref: string;
  source_updated_at: string;
  source_anchor_at: string;
  source_provider: string | null;
  source_agent_label_normalized: string | null;
  title: string;
  target_label: string;
  target_href: string;
  status: AttentionResolutionAttempt["status"];
  started_at: string;
  checked_at: string | null;
};

type AttentionResolutionReceiptRow = {
  id: string;
  actor_key: string;
  owner_user_id: string | null;
  scoped_user_ids_json: string;
  attempt_id: string;
  item_id: string;
  source: AttentionInboxItem["source"];
  kind: AttentionInboxKind;
  action_key: AttentionResolutionActionKey;
  source_ref: string;
  source_updated_at: string;
  title: string;
  target_label: string;
  target_href: string;
  evidence_code: string;
  evidence_summary: string;
  activity_event_id: string;
  resolved_at: string;
};

type ResolutionEvidence = {
  code: string;
  summary: string;
};

type ResolutionClassification = {
  status: AttentionResolutionCheckResult["status"];
  explanation: string;
  evidence?: ResolutionEvidence;
};

const ATTEMPT_SELECT = `
  SELECT id, actor_key, owner_user_id, scoped_user_ids_json,
         idempotency_key, request_fingerprint, item_id, source, kind,
         action_key, source_ref, source_updated_at, source_anchor_at,
         source_provider, source_agent_label_normalized, title,
         target_label, target_href, status, started_at, checked_at
  FROM attention_resolution_attempts`;

const RECEIPT_SELECT = `
  SELECT id, actor_key, owner_user_id, scoped_user_ids_json, attempt_id, item_id, source, kind,
         action_key, source_ref, source_updated_at, title, target_label,
         target_href, evidence_code, evidence_summary, activity_event_id,
         resolved_at
  FROM attention_resolution_receipts`;

function requireOperatorActor(actorKey: string) {
  if (actorKey !== "operator") {
    throw new HttpError(
      403,
      "attention_resolution_operator_required",
      "Attention resolution evidence is available only to an authenticated operator session."
    );
  }
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizedUserIds(userIds: string[] | undefined) {
  return [...new Set((userIds ?? []).map((value) => value.trim()).filter(Boolean))]
    .sort();
}

function startFingerprint(input: {
  itemId: string;
  actionKey: AttentionResolutionActionKey;
  sourceUpdatedAt: string;
  scopedUserIds?: string[];
}) {
  return fingerprint({
    itemId: input.itemId,
    actionKey: input.actionKey,
    sourceUpdatedAt: input.sourceUpdatedAt,
    scopedUserIds: normalizedUserIds(input.scopedUserIds)
  });
}

function checkFingerprint(userIds: string[] | undefined) {
  return fingerprint({ userIds: normalizedUserIds(userIds) });
}

function mapAttempt(row: AttentionResolutionAttemptRow) {
  return attentionResolutionAttemptSchema.parse({
    id: row.id,
    itemId: row.item_id,
    source: row.source,
    kind: row.kind,
    actionKey: row.action_key,
    sourceRef: row.source_ref,
    sourceUpdatedAt: row.source_updated_at,
    title: row.title,
    targetLabel: row.target_label,
    targetHref: row.target_href,
    status: row.status,
    startedAt: row.started_at,
    checkedAt: row.checked_at
  });
}

function mapReceipt(row: AttentionResolutionReceiptRow) {
  return attentionResolutionReceiptSchema.parse({
    id: row.id,
    attemptId: row.attempt_id,
    itemId: row.item_id,
    source: row.source,
    kind: row.kind,
    actionKey: row.action_key,
    sourceRef: row.source_ref,
    sourceUpdatedAt: row.source_updated_at,
    title: row.title,
    targetLabel: row.target_label,
    targetHref: row.target_href,
    evidenceCode: row.evidence_code,
    evidenceSummary: row.evidence_summary,
    activityEventId: row.activity_event_id,
    resolvedAt: row.resolved_at
  });
}

const ATTENTION_PRIMARY_ACTION_DEFINITIONS: Record<
  AttentionInboxKind,
  Pick<AttentionPrimaryAction, "key" | "label" | "resolutionCondition">
> = {
  decision: {
    key: "review_decision",
    label: "Review decision",
    resolutionCondition:
      "Resolved after this approval is approved, rejected, or executed."
  },
  review: {
    key: "review_insight",
    label: "Review insight",
    resolutionCondition: "Resolved after this insight is accepted or applied."
  },
  blocked_work: {
    key: "resolve_blocker",
    label: "Resolve blocker",
    resolutionCondition:
      "Resolved after the original blocked condition clears on the existing task, even if the task remains overdue."
  },
  overdue_work: {
    key: "review_due_work",
    label: "Review due work",
    resolutionCondition:
      "Resolved after the existing task is done, has no due date, or is due today or later."
  },
  sync_problem: {
    key: "recover_companion_sync",
    label: "Recover companion sync",
    resolutionCondition:
      "Resolved after a later companion sync for the same user completes."
  },
  runtime_problem: {
    key: "reconnect_runtime",
    label: "Reconnect runtime",
    resolutionCondition:
      "Resolved after the same provider and agent-label group reports a newer connected heartbeat."
  }
};

export function attentionPrimaryActionFor(input: {
  kind: AttentionInboxKind;
  sourceRef: string;
  href: string;
}): AttentionPrimaryAction {
  return {
    ...ATTENTION_PRIMARY_ACTION_DEFINITIONS[input.kind],
    href: input.href,
    sourceRef: input.sourceRef
  };
}

function primaryActionForAttempt(row: AttentionResolutionAttemptRow) {
  const action = attentionPrimaryActionFor({
    kind: row.kind,
    sourceRef: row.source_ref,
    href: row.target_href
  });
  if (action.key !== row.action_key) {
    throw new HttpError(
      409,
      "attention_resolution_contract_conflict",
      "The stored resolution attempt no longer matches the Attention action contract."
    );
  }
  return action;
}

function startResult(
  row: AttentionResolutionAttemptRow,
  replayed: boolean
): AttentionResolutionStartResult {
  return attentionResolutionStartResultSchema.parse({
    attempt: mapAttempt(row),
    primaryAction: primaryActionForAttempt(row),
    replayed
  });
}

function existingStartRow(actorKey: string, idempotencyKey: string) {
  return getDatabase()
    .prepare(`${ATTEMPT_SELECT} WHERE actor_key = ? AND idempotency_key = ?`)
    .get(actorKey, idempotencyKey) as AttentionResolutionAttemptRow | undefined;
}

function assertMatchingStartFingerprint(
  row: AttentionResolutionAttemptRow,
  expectedFingerprint: string
) {
  if (row.request_fingerprint !== expectedFingerprint) {
    throw new HttpError(
      409,
      "attention_resolution_idempotency_conflict",
      "This Idempotency-Key is already bound to a different attention resolution request."
    );
  }
}

export function findAttentionResolutionStartReplay(input: {
  actorKey: string;
  idempotencyKey: string;
  itemId: string;
  actionKey: AttentionResolutionActionKey;
  sourceUpdatedAt: string;
  scopedUserIds?: string[];
  now?: Date;
}): AttentionResolutionStartResult | null {
  requireOperatorActor(input.actorKey);
  return runInTransaction(() => {
    pruneExpiredActorRecords(input.actorKey, input.now ?? new Date());
    const row = existingStartRow(input.actorKey, input.idempotencyKey);
    if (!row) {
      return null;
    }
    assertMatchingStartFingerprint(row, startFingerprint(input));
    return startResult(row, true);
  });
}

function pruneExpiredActorRecords(
  actorKey: string,
  now: Date,
  preserve: {
    attemptIds?: string[];
    receiptIds?: string[];
    checkIdempotencyKeys?: string[];
  } = {}
) {
  const cutoff = new Date(
    now.getTime() - ATTENTION_RESOLUTION_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const database = getDatabase();
  const attemptIds = [...new Set(preserve.attemptIds ?? [])];
  const receiptIds = [...new Set(preserve.receiptIds ?? [])];
  const checkKeys = [...new Set(preserve.checkIdempotencyKeys ?? [])];

  database.exec(`
    CREATE TEMP TABLE IF NOT EXISTS attention_resolution_retention_attempts (
      id TEXT PRIMARY KEY
    );
    CREATE TEMP TABLE IF NOT EXISTS attention_resolution_retention_checks (
      idempotency_key TEXT PRIMARY KEY
    );
    DELETE FROM attention_resolution_retention_attempts;
    DELETE FROM attention_resolution_retention_checks;
  `);

  const keepAttempt = database.prepare(
    `INSERT OR IGNORE INTO attention_resolution_retention_attempts (id)
     VALUES (?)`
  );
  for (const attemptId of attemptIds) {
    keepAttempt.run(attemptId);
  }
  if (receiptIds.length > 0) {
    database
      .prepare(
        `INSERT OR IGNORE INTO attention_resolution_retention_attempts (id)
         SELECT attempt_id
         FROM attention_resolution_receipts
         WHERE actor_key = ?
           AND id IN (${receiptIds.map(() => "?").join(", ")})`
      )
      .run(actorKey, ...receiptIds);
  }

  const preservedAttemptCount = (
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM attention_resolution_retention_attempts`
      )
      .get() as { count: number }
  ).count;
  database
    .prepare(
      `INSERT OR IGNORE INTO attention_resolution_retention_attempts (id)
       SELECT attempt.id
       FROM attention_resolution_attempts attempt
       LEFT JOIN attention_resolution_receipts receipt
         ON receipt.attempt_id = attempt.id
       WHERE attempt.actor_key = ?
         AND COALESCE(receipt.resolved_at, attempt.started_at) >= ?
         AND NOT EXISTS (
           SELECT 1
           FROM attention_resolution_retention_attempts kept
           WHERE kept.id = attempt.id
         )
       ORDER BY COALESCE(receipt.resolved_at, attempt.started_at) DESC,
                attempt.id DESC
       LIMIT ?`
    )
    .run(
      actorKey,
      cutoff,
      Math.max(0, ATTENTION_RESOLUTION_MAX_PER_ACTOR - preservedAttemptCount)
    );

  const receiptPreservationClause =
    receiptIds.length > 0
      ? `AND id NOT IN (${receiptIds.map(() => "?").join(", ")})`
      : "";
  database
    .prepare(
      `DELETE FROM attention_resolution_receipts
       WHERE actor_key = ?
         AND resolved_at < ?
         ${receiptPreservationClause}`
    )
    .run(actorKey, cutoff, ...receiptIds);
  database
    .prepare(
      `DELETE FROM attention_resolution_receipts
       WHERE actor_key = ?
         AND attempt_id NOT IN (
           SELECT id FROM attention_resolution_retention_attempts
         )`
    )
    .run(actorKey);
  database
    .prepare(
      `DELETE FROM attention_resolution_attempts
       WHERE actor_key = ?
         AND id NOT IN (
           SELECT id FROM attention_resolution_retention_attempts
         )`
    )
    .run(actorKey);

  const keepCheck = database.prepare(
    `INSERT OR IGNORE INTO attention_resolution_retention_checks (idempotency_key)
     VALUES (?)`
  );
  for (const checkKey of checkKeys) {
    keepCheck.run(checkKey);
  }
  const preservedCheckCount = (
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM attention_resolution_retention_checks`
      )
      .get() as { count: number }
  ).count;
  database
    .prepare(
      `INSERT OR IGNORE INTO attention_resolution_retention_checks (idempotency_key)
       SELECT idempotency_key
       FROM attention_resolution_check_idempotency checks
       WHERE checks.actor_key = ?
         AND checks.created_at >= ?
         AND NOT EXISTS (
           SELECT 1
           FROM attention_resolution_retention_checks kept
           WHERE kept.idempotency_key = checks.idempotency_key
         )
       ORDER BY checks.created_at DESC, checks.idempotency_key DESC
       LIMIT ?`
    )
    .run(
      actorKey,
      cutoff,
      Math.max(0, ATTENTION_RESOLUTION_MAX_PER_ACTOR - preservedCheckCount)
    );
  database
    .prepare(
      `DELETE FROM attention_resolution_check_idempotency
       WHERE actor_key = ?
         AND idempotency_key NOT IN (
           SELECT idempotency_key
           FROM attention_resolution_retention_checks
         )`
    )
    .run(actorKey);
}

export function startAttentionResolutionAttempt(input: {
  actorKey: string;
  idempotencyKey: string;
  item: AttentionInboxItem;
  actionKey: AttentionResolutionActionKey;
  sourceUpdatedAt: string;
  ownerUserId?: string | null;
  scopedUserIds?: string[];
  now?: Date;
}): AttentionResolutionStartResult {
  requireOperatorActor(input.actorKey);
  const expectedFingerprint = startFingerprint({
    itemId: input.item.id,
    actionKey: input.actionKey,
    sourceUpdatedAt: input.sourceUpdatedAt,
    scopedUserIds: input.scopedUserIds
  });
  return runInTransaction(() => {
    const now = input.now ?? new Date();
    pruneExpiredActorRecords(input.actorKey, now);
    const replay = existingStartRow(input.actorKey, input.idempotencyKey);
    if (replay) {
      assertMatchingStartFingerprint(replay, expectedFingerprint);
      return startResult(replay, true);
    }
    if (input.item.state !== "active") {
      throw new HttpError(
        409,
        "attention_resolution_item_inactive",
        "Resolution tracking can start only from the current active Attention item."
      );
    }
    if (
      input.item.primaryAction.key !== input.actionKey ||
      input.item.primaryAction.sourceRef.length === 0
    ) {
      throw new HttpError(
        409,
        "attention_resolution_action_mismatch",
        "The requested action does not match the current Attention item."
      );
    }
    if (input.item.sourceUpdatedAt !== input.sourceUpdatedAt) {
      throw new HttpError(
        409,
        "attention_resolution_source_stale",
        "The Attention source changed. Read the current item before starting resolution tracking."
      );
    }
    const startedAt = now.toISOString();
    const attemptId = `atra_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const provider =
      input.item.source === "agent_session" &&
      typeof input.item.metadata.provider === "string"
        ? input.item.metadata.provider.trim().toLowerCase()
        : null;
    const normalizedAgentLabel =
      input.item.source === "agent_session"
        ? input.item.target.label.trim().toLowerCase()
        : null;
    getDatabase()
      .prepare(
        `INSERT INTO attention_resolution_attempts (
           id, actor_key, owner_user_id, scoped_user_ids_json,
           idempotency_key, request_fingerprint, item_id, source, kind,
           action_key, source_ref, source_updated_at, source_anchor_at,
           source_provider, source_agent_label_normalized, title,
           target_label, target_href, status, started_at, checked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`
      )
      .run(
        attemptId,
        input.actorKey,
        input.ownerUserId ?? null,
        JSON.stringify(normalizedUserIds(input.scopedUserIds)),
        input.idempotencyKey,
        expectedFingerprint,
        input.item.id,
        input.item.source,
        input.item.kind,
        input.actionKey,
        input.item.primaryAction.sourceRef,
        input.item.sourceUpdatedAt,
        input.item.source === "companion_sync"
          ? input.item.createdAt
          : input.item.sourceUpdatedAt,
        provider,
        normalizedAgentLabel,
        input.item.title,
        input.item.target.label,
        input.item.primaryAction.href,
        startedAt
      );
    pruneExpiredActorRecords(input.actorKey, now, {
      attemptIds: [attemptId]
    });
    const row = existingStartRow(input.actorKey, input.idempotencyKey);
    if (!row) {
      throw new Error("Attention resolution attempt was not persisted.");
    }
    return startResult(row, false);
  });
}

function sourceId(row: AttentionResolutionAttemptRow) {
  const separator = row.source_ref.indexOf(":");
  return separator >= 0 ? row.source_ref.slice(separator + 1) : "";
}

function parseScopedUserIds(row: AttentionResolutionAttemptRow) {
  try {
    const parsed = JSON.parse(row.scoped_user_ids_json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function ownerAllowed(row: AttentionResolutionAttemptRow, ownerUserId: string | null) {
  const scope = parseScopedUserIds(row);
  return scope.length === 0 || (ownerUserId !== null && scope.includes(ownerUserId));
}

function entityOwnerId(entityType: string, entityId: string) {
  const owner = getDatabase()
    .prepare(
      `SELECT user_id FROM entity_owners
       WHERE entity_type = ? AND entity_id = ?`
    )
    .get(entityType, entityId) as { user_id: string } | undefined;
  return owner?.user_id ?? null;
}

function classifyApproval(row: AttentionResolutionAttemptRow): ResolutionClassification {
  const approval = getDatabase()
    .prepare(
      `SELECT status, updated_at, entity_type, entity_id
       FROM approval_requests WHERE id = ?`
    )
    .get(sourceId(row)) as
    | {
        status: string;
        updated_at: string;
        entity_type: string | null;
        entity_id: string | null;
      }
    | undefined;
  if (!approval) {
    return { status: "deleted", explanation: "The original source is no longer available." };
  }
  const owner =
    approval.entity_type && approval.entity_id
      ? entityOwnerId(approval.entity_type, approval.entity_id)
      : null;
  if (!ownerAllowed(row, owner)) {
    return { status: "denied", explanation: "The source is no longer within the attempt's authorized user scope." };
  }
  if (["approved", "rejected", "executed"].includes(approval.status)) {
    return {
      status: "resolved",
      explanation: "The approval now has a qualifying terminal decision.",
      evidence: {
        code: "approval_terminal_decision",
        summary: "The approval was approved, rejected, or executed."
      }
    };
  }
  if (approval.status === "cancelled" || approval.updated_at !== row.source_updated_at) {
    return { status: "stale", explanation: "The approval changed without meeting the recorded resolution condition." };
  }
  return { status: "still_open", explanation: "The approval has not yet reached a qualifying decision." };
}

function classifyInsight(row: AttentionResolutionAttemptRow): ResolutionClassification {
  const insight = getDatabase()
    .prepare(`SELECT status, updated_at FROM insights WHERE id = ?`)
    .get(sourceId(row)) as { status: string; updated_at: string } | undefined;
  if (!insight) {
    return { status: "deleted", explanation: "The original source is no longer available." };
  }
  const owner = entityOwnerId("insight", sourceId(row));
  if (!ownerAllowed(row, owner)) {
    return { status: "denied", explanation: "The source is no longer within the attempt's authorized user scope." };
  }
  if (insight.status === "accepted" || insight.status === "applied") {
    return {
      status: "resolved",
      explanation: "The insight now has qualifying review evidence.",
      evidence: {
        code: "insight_accepted_or_applied",
        summary: "The insight was accepted or applied."
      }
    };
  }
  if (
    ["dismissed", "snoozed", "expired"].includes(insight.status) ||
    insight.updated_at !== row.source_updated_at
  ) {
    return { status: "stale", explanation: "The insight changed without meeting the recorded resolution condition." };
  }
  return { status: "still_open", explanation: "The insight has not yet been accepted or applied." };
}

function classifyTask(
  row: AttentionResolutionAttemptRow,
  now: Date
): ResolutionClassification {
  const task = getDatabase()
    .prepare(`SELECT status, due_date FROM tasks WHERE id = ?`)
    .get(sourceId(row)) as { status: string; due_date: string | null } | undefined;
  if (!task) {
    return { status: "deleted", explanation: "The original task is no longer available." };
  }
  const owner = entityOwnerId("task", sourceId(row));
  if (!ownerAllowed(row, owner)) {
    return { status: "denied", explanation: "The task is no longer within the attempt's authorized user scope." };
  }
  if (row.kind === "blocked_work") {
    if (task.status !== "blocked") {
      return {
        status: "resolved",
        explanation: "The original task is no longer blocked.",
        evidence: {
          code: "blocked_condition_cleared",
          summary: "The original blocked condition cleared on the existing task."
        }
      };
    }
    return { status: "still_open", explanation: "The original task remains blocked." };
  }
  const today = formatLocalDateKey(now);
  if (task.status === "done" || task.due_date === null || task.due_date >= today) {
    return {
      status: "resolved",
      explanation: "The task no longer meets the recorded overdue condition.",
      evidence: {
        code: "overdue_condition_cleared",
        summary: "The existing task is done, has no due date, or is due today or later."
      }
    };
  }
  return { status: "still_open", explanation: "The existing task remains overdue." };
}

function classifyCompanionSync(
  row: AttentionResolutionAttemptRow
): ResolutionClassification {
  const original = getDatabase()
    .prepare(`SELECT user_id FROM health_mobile_sync_sessions WHERE id = ?`)
    .get(sourceId(row)) as { user_id: string } | undefined;
  if (!original) {
    return { status: "deleted", explanation: "The original sync source is no longer available." };
  }
  const ownerUserId = original.user_id;
  if (!ownerAllowed(row, ownerUserId)) {
    return { status: "denied", explanation: "The sync source is no longer within the attempt's authorized user scope." };
  }
  if (!ownerUserId) {
    return { status: "still_open", explanation: "No later completed companion sync has been confirmed." };
  }
  const recovered = getDatabase()
    .prepare(
      `SELECT 1
       FROM health_mobile_sync_sessions
       WHERE user_id = ?
         AND status = 'completed'
         AND completed_at IS NOT NULL
         AND started_at > ?
       ORDER BY started_at DESC
       LIMIT 1`
    )
    .get(ownerUserId, row.source_anchor_at);
  if (recovered) {
    return {
      status: "resolved",
      explanation: "A later companion sync for the same user completed.",
      evidence: {
        code: "companion_sync_recovered",
        summary: "A later companion sync for the same user completed."
      }
    };
  }
  return { status: "still_open", explanation: "No later completed companion sync has been confirmed." };
}

function classifyRuntime(
  row: AttentionResolutionAttemptRow,
  now: Date
): ResolutionClassification {
  if (!row.source_provider || !row.source_agent_label_normalized) {
    return { status: "stale", explanation: "The runtime group identity no longer matches the resolution contract." };
  }
  const original = getDatabase()
    .prepare(`SELECT 1 FROM agent_runtime_sessions WHERE id = ?`)
    .get(sourceId(row));
  if (!original) {
    return { status: "deleted", explanation: "The original runtime source is no longer available." };
  }
  const threshold =
    row.started_at > row.source_updated_at ? row.started_at : row.source_updated_at;
  const sessions = getDatabase()
    .prepare(
      `SELECT status, stale_after_seconds, last_heartbeat_at
       FROM agent_runtime_sessions
       WHERE provider = ?
         AND lower(trim(agent_label)) = ?
         AND last_heartbeat_at > ?
       ORDER BY last_heartbeat_at DESC
       LIMIT 10`
    )
    .all(
      row.source_provider,
      row.source_agent_label_normalized,
      threshold
    ) as Array<{
    status: string;
    stale_after_seconds: number;
    last_heartbeat_at: string;
  }>;
  const connected = sessions.some((session) => {
    const heartbeatAt = Date.parse(session.last_heartbeat_at);
    return (
      session.status === "connected" &&
      Number.isFinite(heartbeatAt) &&
      now.getTime() - heartbeatAt <= Math.max(1, session.stale_after_seconds) * 1000
    );
  });
  if (connected) {
    return {
      status: "resolved",
      explanation: "The matching runtime group has a newer connected heartbeat.",
      evidence: {
        code: "runtime_reconnected",
        summary: "The matching provider and normalized agent-label group reported a newer connected heartbeat."
      }
    };
  }
  return { status: "still_open", explanation: "No newer connected heartbeat has been confirmed for the matching runtime group." };
}

function classifyAttempt(
  row: AttentionResolutionAttemptRow,
  now: Date
): ResolutionClassification {
  switch (row.source) {
    case "approval":
      return classifyApproval(row);
    case "insight":
      return classifyInsight(row);
    case "task":
      return classifyTask(row, now);
    case "companion_sync":
      return classifyCompanionSync(row);
    case "agent_session":
      return classifyRuntime(row, now);
  }
}

function createResolutionReceipt(
  row: AttentionResolutionAttemptRow,
  evidence: ResolutionEvidence,
  now: Date
): AttentionResolutionReceipt {
  const existing = getDatabase()
    .prepare(`${RECEIPT_SELECT} WHERE attempt_id = ?`)
    .get(row.id) as AttentionResolutionReceiptRow | undefined;
  if (existing) {
    return mapReceipt(existing);
  }
  const resolvedAt = now.toISOString();
  const activity = recordActivityEvent(
    {
      entityType: "system",
      entityId: row.id,
      eventType: "attention_resolution_confirmed",
      title: `Attention resolved: ${row.title}`,
      description: evidence.summary,
      actor: "operator",
      source: "system",
      metadata: {
        attemptId: row.id,
        itemId: row.item_id,
        source: row.source,
        kind: row.kind,
        actionKey: row.action_key,
        evidenceCode: evidence.code
      }
    },
    now
  );
  const receiptId = `atrr_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  getDatabase()
    .prepare(
      `INSERT INTO attention_resolution_receipts (
         id, actor_key, owner_user_id, scoped_user_ids_json, attempt_id, item_id, source, kind,
         action_key, source_ref, source_updated_at, title, target_label,
         target_href, evidence_code, evidence_summary, activity_event_id,
         resolved_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      receiptId,
      row.actor_key,
      row.owner_user_id,
      row.scoped_user_ids_json,
      row.id,
      row.item_id,
      row.source,
      row.kind,
      row.action_key,
      row.source_ref,
      row.source_updated_at,
      row.title,
      row.target_label,
      row.target_href,
      evidence.code,
      evidence.summary,
      activity.id,
      resolvedAt
    );
  getDatabase()
    .prepare(
      `UPDATE attention_resolution_attempts
       SET status = 'resolved', checked_at = ?
       WHERE id = ? AND status = 'pending'`
    )
    .run(resolvedAt, row.id);
  const created = getDatabase()
    .prepare(`${RECEIPT_SELECT} WHERE id = ?`)
    .get(receiptId) as AttentionResolutionReceiptRow | undefined;
  if (!created) {
    throw new Error("Attention resolution receipt was not persisted.");
  }
  return mapReceipt(created);
}

function checkReplay(input: {
  actorKey: string;
  idempotencyKey: string;
  requestFingerprint: string;
}): AttentionResolutionCheckResponse | null {
  const row = getDatabase()
    .prepare(
      `SELECT request_fingerprint, response_json
       FROM attention_resolution_check_idempotency
       WHERE actor_key = ? AND idempotency_key = ?`
    )
    .get(input.actorKey, input.idempotencyKey) as
    | { request_fingerprint: string; response_json: string }
    | undefined;
  if (!row) {
    return null;
  }
  if (row.request_fingerprint !== input.requestFingerprint) {
    throw new HttpError(
      409,
      "attention_resolution_idempotency_conflict",
      "This Idempotency-Key is already bound to a different attention resolution check."
    );
  }
  return attentionResolutionCheckResponseSchema.parse(JSON.parse(row.response_json));
}

function pendingAttempts(actorKey: string, userIds: string[] | undefined) {
  const normalized = normalizedUserIds(userIds);
  return getDatabase()
    .prepare(
      `${ATTEMPT_SELECT}
       WHERE actor_key = ? AND status = 'pending'
         AND scoped_user_ids_json = ?
       ORDER BY started_at ASC, id ASC
       LIMIT ${MAX_PENDING_CHECKS}`
    )
    .all(actorKey, JSON.stringify(normalized)) as AttentionResolutionAttemptRow[];
}

export function checkAttentionResolutionAttempts(input: {
  actorKey: string;
  idempotencyKey: string;
  userIds?: string[];
  now?: Date;
}): { response: AttentionResolutionCheckResponse; replayed: boolean } {
  requireOperatorActor(input.actorKey);
  const requestFingerprint = checkFingerprint(input.userIds);
  return runInTransaction(() => {
    const now = input.now ?? new Date();
    pruneExpiredActorRecords(input.actorKey, now);
    const replay = checkReplay({
      actorKey: input.actorKey,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint
    });
    if (replay) {
      return { response: replay, replayed: true };
    }
    const results: AttentionResolutionCheckResult[] = [];
    const receipts: AttentionResolutionReceipt[] = [];
    for (const row of pendingAttempts(input.actorKey, input.userIds)) {
      const classification = classifyAttempt(row, now);
      let receipt: AttentionResolutionReceipt | null = null;
      if (classification.status === "resolved" && classification.evidence) {
        receipt = createResolutionReceipt(row, classification.evidence, now);
        receipts.push(receipt);
      } else {
        getDatabase()
          .prepare(
            `UPDATE attention_resolution_attempts
             SET status = ?, checked_at = ?
             WHERE id = ? AND status = 'pending'`
          )
          .run(
            classification.status === "still_open" ? "pending" : "unavailable",
            now.toISOString(),
            row.id
          );
      }
      results.push({
        attemptId: row.id,
        itemId: row.item_id,
        status: classification.status,
        explanation: classification.explanation,
        receipt
      });
    }
    const response = attentionResolutionCheckResponseSchema.parse({
      results,
      receipts
    });
    getDatabase()
      .prepare(
        `INSERT INTO attention_resolution_check_idempotency (
           actor_key, idempotency_key, request_fingerprint, response_json, created_at
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        input.actorKey,
        input.idempotencyKey,
        requestFingerprint,
        JSON.stringify(response),
        now.toISOString()
      );
    pruneExpiredActorRecords(input.actorKey, now, {
      attemptIds: results.map((result) => result.attemptId),
      receiptIds: receipts.map((receipt) => receipt.id),
      checkIdempotencyKeys: [input.idempotencyKey]
    });
    return { response, replayed: false };
  });
}

export function listAttentionResolutionReceipts(input: {
  actorKey: string;
  userIds?: string[];
  limit?: number;
  now?: Date;
}): AttentionResolutionList {
  requireOperatorActor(input.actorKey);
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const cutoff = new Date(
    (input.now ?? new Date()).getTime() -
      ATTENTION_RESOLUTION_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const userIds = normalizedUserIds(input.userIds);
  const scopeJson = JSON.stringify(userIds);
  const params = [input.actorKey, cutoff, scopeJson];
  const rows = getDatabase()
    .prepare(
      `${RECEIPT_SELECT}
       WHERE actor_key = ? AND resolved_at >= ?
         AND scoped_user_ids_json = ?
       ORDER BY resolved_at DESC, id DESC
       LIMIT ?`
    )
    .all(...params, limit) as AttentionResolutionReceiptRow[];
  const count = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT id
         FROM attention_resolution_receipts
         WHERE actor_key = ? AND resolved_at >= ?
           AND scoped_user_ids_json = ?
         ORDER BY resolved_at DESC, id DESC
         LIMIT ${ATTENTION_RESOLUTION_MAX_PER_ACTOR}
       )`
    )
    .get(...params) as { count: number };
  return attentionResolutionListSchema.parse({
    receipts: rows.map(mapReceipt),
    total: count.count,
    limit,
    retention: {
      days: ATTENTION_RESOLUTION_RETENTION_DAYS,
      maxPerActor: ATTENTION_RESOLUTION_MAX_PER_ACTOR
    }
  });
}
