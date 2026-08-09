import { randomUUID } from "node:crypto";

import { getDatabase } from "../db.js";
import { HttpError } from "../errors.js";

export const MUTATION_RECEIPT_TTL_MS = 10 * 60 * 1_000;
export const MUTATION_RECEIPT_HISTORY_DAYS = 30;
export const MAX_MUTATION_RECEIPTS = 50;

export type MutationReceiptOperation =
  | "entity_update"
  | "entity_soft_delete"
  | "entity_hard_delete"
  | "task_update"
  | "attention_state";

export type MutationReceiptStatus =
  | "available"
  | "undone"
  | "expired"
  | "conflicted"
  | "not_reversible";

export type MutationReceipt = {
  id: string;
  operation: MutationReceiptOperation;
  targetType: string;
  targetId: string;
  targetLabel: string;
  ownerUserId: string | null;
  summary: string;
  status: MutationReceiptStatus;
  reversible: boolean;
  explanation: string;
  expiresAt: string | null;
  createdAt: string;
  undoneAt: string | null;
};

export type MutationReceiptInverse =
  | {
      kind: "entity_update";
      entityType: string;
      entityId: string;
      patch: Record<string, unknown>;
    }
  | {
      kind: "entity_restore";
      entityType: string;
      entityId: string;
    }
  | {
      kind: "task_update";
      taskId: string;
      patch: Record<string, unknown>;
    }
  | {
      kind: "attention_state";
      itemId: string;
      state: "active" | "snoozed" | "dismissed";
      snoozedUntil: string | null;
      note: string;
      sourceUpdatedAt: string;
    };

export type MutationReceiptExpected =
  | {
      kind: "entity_fields";
      fields: Record<string, unknown>;
    }
  | { kind: "entity_deleted" }
  | {
      kind: "task_fields";
      fields: Record<string, unknown>;
    }
  | {
      kind: "attention_state";
      state: "active" | "snoozed" | "dismissed";
      snoozedUntil: string | null;
      sourceUpdatedAt: string;
    };

type MutationReceiptRow = {
  id: string;
  actor_key: string;
  owner_user_id: string | null;
  operation: MutationReceiptOperation;
  target_type: string;
  target_id: string;
  target_label: string;
  summary: string;
  inverse_json: string | null;
  expected_json: string | null;
  status: Exclude<MutationReceiptStatus, "expired">;
  terminal_explanation: string | null;
  expires_at: string | null;
  undo_idempotency_key: string | null;
  undo_result_json: string | null;
  created_at: string;
  updated_at: string;
  undone_at: string | null;
};

export type MutationReceiptRecord = {
  view: MutationReceipt;
  actorKey: string;
  inverse: MutationReceiptInverse | null;
  expected: MutationReceiptExpected | null;
  undoIdempotencyKey: string | null;
  undoResult: Record<string, unknown> | null;
};

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  return JSON.parse(value) as T;
}

function publicStatus(row: MutationReceiptRow, now: Date): MutationReceiptStatus {
  if (
    row.status === "available" &&
    row.expires_at !== null &&
    Date.parse(row.expires_at) <= now.getTime()
  ) {
    return "expired";
  }
  return row.status;
}

function statusExplanation(
  row: MutationReceiptRow,
  status: MutationReceiptStatus
): string {
  if (status === "available") {
    return "Undo is available until the time shown.";
  }
  if (status === "undone") {
    return "This change has already been undone.";
  }
  if (status === "expired") {
    return "The safe Undo window has ended, so Forge left the current data unchanged.";
  }
  return (
    row.terminal_explanation ??
    "Forge cannot safely undo this change, so the current data was left unchanged."
  );
}

function toRecord(row: MutationReceiptRow, now = new Date()): MutationReceiptRecord {
  const status = publicStatus(row, now);
  return {
    view: {
      id: row.id,
      operation: row.operation,
      targetType: row.target_type,
      targetId: row.target_id,
      targetLabel: row.target_label,
      ownerUserId: row.owner_user_id,
      summary: row.summary,
      status,
      reversible: status === "available",
      explanation: statusExplanation(row, status),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      undoneAt: row.undone_at
    },
    actorKey: row.actor_key,
    inverse: parseJson<MutationReceiptInverse>(row.inverse_json),
    expected: parseJson<MutationReceiptExpected>(row.expected_json),
    undoIdempotencyKey: row.undo_idempotency_key,
    undoResult: parseJson<Record<string, unknown>>(row.undo_result_json)
  };
}

function normalizeLimit(limit?: number) {
  return Math.max(1, Math.min(MAX_MUTATION_RECEIPTS, Math.trunc(limit ?? 20)));
}

function pruneMutationReceiptHistory(now: Date) {
  const before = new Date(
    now.getTime() - MUTATION_RECEIPT_HISTORY_DAYS * 24 * 60 * 60 * 1_000
  ).toISOString();
  getDatabase()
    .prepare("DELETE FROM mutation_receipts WHERE created_at < ?")
    .run(before);
}

export function createMutationReceipt(input: {
  actorKey: string;
  ownerUserId: string | null;
  operation: MutationReceiptOperation;
  targetType: string;
  targetId: string;
  targetLabel: string;
  summary: string;
  inverse?: MutationReceiptInverse | null;
  expected?: MutationReceiptExpected | null;
  terminalExplanation?: string | null;
  now?: Date;
}): MutationReceipt {
  const now = input.now ?? new Date();
  pruneMutationReceiptHistory(now);
  const createdAt = now.toISOString();
  const reversible = Boolean(input.inverse && input.expected);
  const expiresAt = reversible
    ? new Date(now.getTime() + MUTATION_RECEIPT_TTL_MS).toISOString()
    : null;
  const id = `mrc_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  getDatabase()
    .prepare(
      `INSERT INTO mutation_receipts (
         id, actor_key, owner_user_id, operation, target_type, target_id,
         target_label, summary, inverse_json, expected_json, status,
         terminal_explanation, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.actorKey,
      input.ownerUserId,
      input.operation,
      input.targetType,
      input.targetId,
      input.targetLabel,
      input.summary,
      reversible ? JSON.stringify(input.inverse) : null,
      reversible ? JSON.stringify(input.expected) : null,
      reversible ? "available" : "not_reversible",
      reversible
        ? null
        : (input.terminalExplanation ??
            "This change cannot be safely reversed."),
      expiresAt,
      createdAt,
      createdAt
    );
  return getMutationReceiptRecord(input.actorKey, id, undefined, now)!.view;
}

export function getMutationReceiptRecord(
  actorKey: string,
  receiptId: string,
  allowedOwnerUserIds?: string[],
  now = new Date()
): MutationReceiptRecord | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM mutation_receipts WHERE actor_key = ? AND id = ?`
    )
    .get(actorKey, receiptId) as MutationReceiptRow | undefined;
  if (!row) return null;
  if (
    allowedOwnerUserIds?.length &&
    (row.owner_user_id === null || !allowedOwnerUserIds.includes(row.owner_user_id))
  ) {
    return null;
  }
  return toRecord(row, now);
}

export function listMutationReceipts(input: {
  actorKey: string;
  ownerUserIds?: string[];
  limit?: number;
  now?: Date;
}): { receipts: MutationReceipt[]; limit: number } {
  const limit = normalizeLimit(input.limit);
  const ownerUserIds = Array.from(new Set(input.ownerUserIds ?? []));
  const ownerClause = ownerUserIds.length
    ? ` AND owner_user_id IN (${ownerUserIds.map(() => "?").join(", ")})`
    : "";
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM mutation_receipts
       WHERE actor_key = ?${ownerClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(input.actorKey, ...ownerUserIds, limit) as MutationReceiptRow[];
  return {
    receipts: rows.map((row) => toRecord(row, input.now).view),
    limit
  };
}

export function beginMutationReceiptUndo(input: {
  actorKey: string;
  receiptId: string;
  idempotencyKey: string;
  allowedOwnerUserIds?: string[];
  now?: Date;
}): { record: MutationReceiptRecord; replayed: boolean } {
  const now = input.now ?? new Date();
  const record = getMutationReceiptRecord(
    input.actorKey,
    input.receiptId,
    input.allowedOwnerUserIds,
    now
  );
  if (!record) {
    throw new HttpError(404, "mutation_receipt_not_found", "Change receipt not found.");
  }
  if (record.view.status === "undone") {
    if (record.undoIdempotencyKey === input.idempotencyKey) {
      return { record, replayed: true };
    }
    throw new HttpError(
      409,
      "mutation_receipt_already_undone",
      "This change has already been undone.",
      { receipt: record.view }
    );
  }
  if (record.view.status !== "available") {
    throw new HttpError(
      409,
      `mutation_receipt_${record.view.status}`,
      record.view.explanation,
      { receipt: record.view }
    );
  }
  const reused = getDatabase()
    .prepare(
      `SELECT id FROM mutation_receipts
       WHERE actor_key = ? AND undo_idempotency_key = ? AND id <> ?`
    )
    .get(input.actorKey, input.idempotencyKey, input.receiptId) as
    | { id: string }
    | undefined;
  if (reused) {
    throw new HttpError(
      409,
      "mutation_receipt_idempotency_conflict",
      "This Undo request identifier already belongs to another change."
    );
  }
  return { record, replayed: false };
}

export function completeMutationReceiptUndo(input: {
  actorKey: string;
  receiptId: string;
  idempotencyKey: string;
  result: Record<string, unknown>;
  now?: Date;
}): MutationReceiptRecord {
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  const updated = getDatabase()
    .prepare(
      `UPDATE mutation_receipts
       SET status = 'undone', undo_idempotency_key = ?, undo_result_json = ?,
           undone_at = ?, updated_at = ?
       WHERE actor_key = ? AND id = ? AND status = 'available'`
    )
    .run(
      input.idempotencyKey,
      JSON.stringify(input.result),
      timestamp,
      timestamp,
      input.actorKey,
      input.receiptId
    );
  if (updated.changes !== 1) {
    throw new HttpError(
      409,
      "mutation_receipt_state_conflict",
      "The change receipt was updated by another request."
    );
  }
  return getMutationReceiptRecord(input.actorKey, input.receiptId, undefined, now)!;
}

export function markMutationReceiptConflict(input: {
  actorKey: string;
  receiptId: string;
  explanation: string;
  now?: Date;
}): MutationReceipt {
  const now = input.now ?? new Date();
  getDatabase()
    .prepare(
      `UPDATE mutation_receipts
       SET status = 'conflicted', terminal_explanation = ?, updated_at = ?
       WHERE actor_key = ? AND id = ? AND status = 'available'`
    )
    .run(input.explanation, now.toISOString(), input.actorKey, input.receiptId);
  return getMutationReceiptRecord(input.actorKey, input.receiptId, undefined, now)!.view;
}

export function mutationReceiptValuesMatch(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>
) {
  return Object.entries(expected).every(
    ([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value)
  );
}
