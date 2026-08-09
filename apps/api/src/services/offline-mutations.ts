import { createHash } from "node:crypto";

import { getDatabase } from "../db.js";
import { HttpError } from "../errors.js";
import {
  offlineTaskMutationInputSchema,
  offlineTaskMutationReceiptSchema,
  type OfflineTaskMutationInput,
  type OfflineTaskMutationReceipt
} from "../types.js";

export const OFFLINE_MUTATION_HISTORY_DAYS = 30;
export const MAX_OFFLINE_MUTATIONS_PER_SESSION = 500;

type OfflineMutationRow = {
  request_fingerprint: string;
  receipt_json: string;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function fingerprintOfflineTaskMutation(
  input: OfflineTaskMutationInput
): string {
  const parsed = offlineTaskMutationInputSchema.parse(input);
  return createHash("sha256")
    .update(
      canonicalJson({
        domain: "forge.offline-task-status.v1",
        request: parsed
      })
    )
    .digest("hex");
}

function pruneOfflineMutationHistory(now: Date, sessionId?: string) {
  const before = new Date(
    now.getTime() - OFFLINE_MUTATION_HISTORY_DAYS * 24 * 60 * 60 * 1_000
  ).toISOString();
  const database = getDatabase();
  database
    .prepare("DELETE FROM offline_mutation_outbox WHERE created_at < ?")
    .run(before);

  if (!sessionId) return;
  database
    .prepare(
      `DELETE FROM offline_mutation_outbox
       WHERE session_id = ?
         AND idempotency_key IN (
           SELECT idempotency_key
           FROM offline_mutation_outbox
           WHERE session_id = ?
           ORDER BY created_at DESC, idempotency_key DESC
           LIMIT -1 OFFSET ?
         )`
    )
    .run(sessionId, sessionId, MAX_OFFLINE_MUTATIONS_PER_SESSION);
}

export function readOfflineTaskMutationOutcome(input: {
  sessionId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  now?: Date;
}): OfflineTaskMutationReceipt | null {
  pruneOfflineMutationHistory(input.now ?? new Date());
  const existing = getDatabase()
    .prepare(
      `SELECT request_fingerprint, receipt_json
       FROM offline_mutation_outbox
       WHERE session_id = ? AND idempotency_key = ?`
    )
    .get(input.sessionId, input.idempotencyKey) as
    | OfflineMutationRow
    | undefined;
  if (!existing) return null;
  if (existing.request_fingerprint !== input.requestFingerprint) {
    throw new HttpError(
      409,
      "offline_mutation_idempotency_conflict",
      "This offline mutation key was already used for a different request."
    );
  }
  try {
    return offlineTaskMutationReceiptSchema.parse(
      JSON.parse(existing.receipt_json)
    );
  } catch {
    throw new HttpError(
      500,
      "offline_mutation_receipt_corrupt",
      "Forge could not read the stored offline mutation result."
    );
  }
}

export function recordOfflineTaskMutationOutcome(input: {
  sessionId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  receipt: OfflineTaskMutationReceipt;
  now?: Date;
}): void {
  const receipt = offlineTaskMutationReceiptSchema.parse(input.receipt);
  const now = input.now ?? new Date(receipt.receivedAt);
  getDatabase()
    .prepare(
      `INSERT INTO offline_mutation_outbox (
         session_id, idempotency_key, request_fingerprint, terminal_status,
         receipt_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.sessionId,
      input.idempotencyKey,
      input.requestFingerprint,
      receipt.status,
      JSON.stringify(receipt),
      now.toISOString()
    );
  pruneOfflineMutationHistory(now, input.sessionId);
}
