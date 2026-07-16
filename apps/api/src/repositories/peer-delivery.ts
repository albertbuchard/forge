import { createHash, randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";

const MAX_ENVELOPE_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_SIZE = 200;
const MAX_ERROR_LENGTH = 4_000;
const OUTBOX_EXPIRY_SWEEP_SIZE = 1_000;
const MIN_OUTBOX_LEASE_MS = 1_000;
const MAX_OUTBOX_LEASE_MS = 24 * 60 * 60_000;
const SAFE_ENVELOPE_ID = /^[A-Za-z0-9._:-]{1,240}$/u;

export const PEER_OUTBOX_MAX_ATTEMPTS = 12;
export const PEER_OUTBOX_DEFAULT_LEASE_MS = 60_000;

const OUTBOX_CANDIDATE_SELECT = `SELECT envelope_id, next_attempt_at, created_at,
        hex(next_attempt_at) AS next_attempt_at_order,
        hex(created_at) AS created_at_order,
        hex(envelope_id) AS envelope_id_order
 FROM peer_outbox`;

export const PEER_OUTBOX_CANDIDATE_STATEMENTS = Object.freeze({
  due: `${OUTBOX_CANDIDATE_SELECT} INDEXED BY idx_peer_outbox_due_claim_order
   WHERE owner_user_id = ? AND status IN ('pending', 'failed')
     AND attempt_count < ${PEER_OUTBOX_MAX_ATTEMPTS} AND next_attempt_at <= ? AND expires_at > ?
   ORDER BY next_attempt_at, created_at, envelope_id
   LIMIT ?`,
  inFlight: `${OUTBOX_CANDIDATE_SELECT} INDEXED BY idx_peer_outbox_in_flight_claim_order
   WHERE owner_user_id = ? AND status = 'in_flight'
     AND attempt_count < ${PEER_OUTBOX_MAX_ATTEMPTS} AND next_attempt_at <= ? AND expires_at > ?
   ORDER BY next_attempt_at, created_at, envelope_id
   LIMIT ?`
});

export type PeerProjectionChange = {
  id: string;
  ownerUserId: string;
  relationshipId: string;
  projectionId: string;
  projectionVersion: number;
  changeSequence: number;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceVersion: string;
  operation: "upsert" | "tombstone" | "withdrawal";
  encryptedPayloadRef: string | null;
  payloadHash: string | null;
  grantId: string | null;
  grantSequence: number | null;
  claimedAt: string | null;
  createdAt: string;
};

export type PeerOutboxEnvelope = {
  envelopeId: string;
  ownerUserId: string;
  relationshipId: string;
  recipientDeviceId: string;
  channelId: string;
  sequence: number;
  previousAcknowledgement: number;
  messageKind: string;
  mlsEpoch: number;
  ciphertext: Uint8Array;
  ciphertextHash: string;
  sizeBytes: number;
  status:
    | "pending"
    | "in_flight"
    | "acknowledged"
    | "expired"
    | "failed"
    | "canceled";
  attemptCount: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  acknowledgedAt: string | null;
  expiresAt: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

export type PeerInboxEnvelope = {
  envelopeId: string;
  ownerUserId: string;
  relationshipId: string;
  senderDeviceId: string;
  channelId: string;
  sequence: number;
  messageKind: string;
  mlsEpoch: number;
  ciphertext: Uint8Array;
  ciphertextHash: string;
  processingState:
    | "pending"
    | "processing"
    | "processed"
    | "rejected"
    | "duplicate";
  receivedAt: string;
  processedAt: string | null;
  expiresAt: string;
  failureReason: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectionChangeSqlRow = {
  id: string;
  owner_user_id: string;
  relationship_id: string;
  projection_id: string;
  projection_version: number;
  change_sequence: number;
  source_entity_type: string;
  source_entity_id: string;
  source_version: string;
  operation: PeerProjectionChange["operation"];
  encrypted_payload_ref: string | null;
  payload_hash: string | null;
  grant_id: string | null;
  grant_sequence: number | null;
  claimed_at: string | null;
  created_at: string;
};

type OutboxSqlRow = {
  envelope_id: string;
  owner_user_id: string;
  relationship_id: string;
  recipient_device_id: string;
  channel_id: string;
  sequence: number;
  previous_acknowledgement: number;
  message_kind: string;
  mls_epoch: number;
  ciphertext: Uint8Array;
  ciphertext_hash: string;
  size_bytes: number;
  status: PeerOutboxEnvelope["status"];
  attempt_count: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  acknowledged_at: string | null;
  expires_at: string;
  last_error: string;
  created_at: string;
  updated_at: string;
};

type OutboxCandidateSqlRow = Pick<
  OutboxSqlRow,
  "envelope_id" | "next_attempt_at" | "created_at"
> & {
  next_attempt_at_order: string;
  created_at_order: string;
  envelope_id_order: string;
};

function compareSqliteBinaryHex(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

type InboxSqlRow = {
  envelope_id: string;
  owner_user_id: string;
  relationship_id: string;
  sender_device_id: string;
  channel_id: string;
  sequence: number;
  message_kind: string;
  mls_epoch: number;
  ciphertext: Uint8Array;
  ciphertext_hash: string;
  processing_state: PeerInboxEnvelope["processingState"];
  received_at: string;
  processed_at: string | null;
  expires_at: string;
  failure_reason: string;
  created_at: string;
  updated_at: string;
};

const PROJECTION_CHANGE_SELECT = `
  id, owner_user_id, relationship_id, projection_id, projection_version,
  change_sequence, source_entity_type, source_entity_id, source_version,
  operation, encrypted_payload_ref, payload_hash, grant_id, grant_sequence,
  claimed_at, created_at
`;

const OUTBOX_SELECT = `
  envelope_id, owner_user_id, relationship_id, recipient_device_id,
  channel_id, sequence, previous_acknowledgement, message_kind, mls_epoch,
  ciphertext, ciphertext_hash, size_bytes, status, attempt_count,
  next_attempt_at, last_attempt_at, acknowledged_at, expires_at, last_error,
  created_at, updated_at
`;

const INBOX_SELECT = `
  envelope_id, owner_user_id, relationship_id, sender_device_id, channel_id,
  sequence, message_kind, mls_epoch, ciphertext, ciphertext_hash,
  processing_state, received_at, processed_at, expires_at, failure_reason,
  created_at, updated_at
`;

function boundedLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new Error(
      `Peer delivery batch size must be between 1 and ${MAX_BATCH_SIZE}.`
    );
  }
  return limit;
}

function iso(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Peer delivery timestamp is invalid.");
  }
  return date.toISOString();
}

function checkedEnvelopeId(envelopeId: string): string {
  if (!SAFE_ENVELOPE_ID.test(envelopeId)) {
    throw new Error(
      "Peer envelope id must contain 1 to 240 ASCII letters, digits, dots, underscores, colons, or hyphens."
    );
  }
  return envelopeId;
}

function checkedOutboxLeaseMs(leaseMs: number | undefined): number {
  const value = leaseMs ?? PEER_OUTBOX_DEFAULT_LEASE_MS;
  if (
    !Number.isInteger(value) ||
    value < MIN_OUTBOX_LEASE_MS ||
    value > MAX_OUTBOX_LEASE_MS
  ) {
    throw new Error(
      `Peer outbox lease must be an integer between ${MIN_OUTBOX_LEASE_MS} and ${MAX_OUTBOX_LEASE_MS} milliseconds.`
    );
  }
  return value;
}

function expirePeerOutboxBatch(input: {
  database: ReturnType<typeof getDatabase>;
  ownerUserId: string;
  limit: number;
  timestamp: string;
}): number {
  const result = input.database
    .prepare(
      `UPDATE peer_outbox
       SET status = 'expired', updated_at = ?
       WHERE rowid IN (
         SELECT rowid
         FROM peer_outbox INDEXED BY idx_peer_outbox_active_expiry
         WHERE owner_user_id = ? AND expires_at <= ?
           AND status IN ('pending', 'in_flight', 'failed')
         ORDER BY expires_at, envelope_id
         LIMIT ?
       )
         AND owner_user_id = ? AND expires_at <= ?
         AND status IN ('pending', 'in_flight', 'failed')`
    )
    .run(
      input.timestamp,
      input.ownerUserId,
      input.timestamp,
      input.limit,
      input.ownerUserId,
      input.timestamp
    );
  return Number(result.changes);
}

function digestBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function checkedCiphertext(input: Uint8Array, expectedHash?: string): Buffer {
  const bytes = Buffer.from(input);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_ENVELOPE_BYTES) {
    throw new Error("Peer envelope ciphertext exceeds the allowed size.");
  }
  const actualHash = digestBytes(bytes);
  if (expectedHash !== undefined && expectedHash !== actualHash) {
    throw new Error("Peer envelope ciphertext hash does not match its bytes.");
  }
  return bytes;
}

function mapProjectionChange(
  row: ProjectionChangeSqlRow
): PeerProjectionChange {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    relationshipId: row.relationship_id,
    projectionId: row.projection_id,
    projectionVersion: row.projection_version,
    changeSequence: row.change_sequence,
    sourceEntityType: row.source_entity_type,
    sourceEntityId: row.source_entity_id,
    sourceVersion: row.source_version,
    operation: row.operation,
    encryptedPayloadRef: row.encrypted_payload_ref,
    payloadHash: row.payload_hash,
    grantId: row.grant_id,
    grantSequence: row.grant_sequence,
    claimedAt: row.claimed_at,
    createdAt: row.created_at
  };
}

function mapOutbox(row: OutboxSqlRow): PeerOutboxEnvelope {
  return {
    envelopeId: row.envelope_id,
    ownerUserId: row.owner_user_id,
    relationshipId: row.relationship_id,
    recipientDeviceId: row.recipient_device_id,
    channelId: row.channel_id,
    sequence: row.sequence,
    previousAcknowledgement: row.previous_acknowledgement,
    messageKind: row.message_kind,
    mlsEpoch: row.mls_epoch,
    ciphertext: Buffer.from(row.ciphertext),
    ciphertextHash: row.ciphertext_hash,
    sizeBytes: row.size_bytes,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastAttemptAt: row.last_attempt_at,
    acknowledgedAt: row.acknowledged_at,
    expiresAt: row.expires_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapInbox(row: InboxSqlRow): PeerInboxEnvelope {
  return {
    envelopeId: row.envelope_id,
    ownerUserId: row.owner_user_id,
    relationshipId: row.relationship_id,
    senderDeviceId: row.sender_device_id,
    channelId: row.channel_id,
    sequence: row.sequence,
    messageKind: row.message_kind,
    mlsEpoch: row.mls_epoch,
    ciphertext: Buffer.from(row.ciphertext),
    ciphertextHash: row.ciphertext_hash,
    processingState: row.processing_state,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    expiresAt: row.expires_at,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function readOutbox(
  envelopeId: string,
  ownerUserId: string
): PeerOutboxEnvelope | null {
  const row = getDatabase()
    .prepare(
      `SELECT ${OUTBOX_SELECT} FROM peer_outbox WHERE envelope_id = ? AND owner_user_id = ?`
    )
    .get(envelopeId, ownerUserId) as OutboxSqlRow | undefined;
  return row ? mapOutbox(row) : null;
}

function readOutboxBatch(
  database: ReturnType<typeof getDatabase>,
  envelopeIds: string[],
  ownerUserId: string
): PeerOutboxEnvelope[] {
  if (envelopeIds.length === 0) return [];
  const placeholders = envelopeIds.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `SELECT ${OUTBOX_SELECT}
       FROM peer_outbox
       WHERE owner_user_id = ? AND envelope_id IN (${placeholders})`
    )
    .all(ownerUserId, ...envelopeIds) as OutboxSqlRow[];
  const envelopesById = new Map(
    rows.map((row) => {
      const envelope = mapOutbox(row);
      return [envelope.envelopeId, envelope] as const;
    })
  );
  return envelopeIds.flatMap((envelopeId) => {
    const envelope = envelopesById.get(envelopeId);
    return envelope ? [envelope] : [];
  });
}

function readInbox(
  envelopeId: string,
  ownerUserId: string
): PeerInboxEnvelope | null {
  const row = getDatabase()
    .prepare(
      `SELECT ${INBOX_SELECT} FROM peer_inbox WHERE envelope_id = ? AND owner_user_id = ?`
    )
    .get(envelopeId, ownerUserId) as InboxSqlRow | undefined;
  return row ? mapInbox(row) : null;
}

export function recordPeerProjectionChange(input: {
  id?: string;
  ownerUserId: string;
  relationshipId: string;
  projectionId: string;
  projectionVersion: number;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceVersion: string;
  operation: PeerProjectionChange["operation"];
  encryptedPayloadRef?: string | null;
  payloadHash?: string | null;
  grantId?: string | null;
  grantSequence?: number | null;
  now?: Date;
}): PeerProjectionChange {
  return runInTransaction(() => {
    const database = getDatabase();
    const next = database
      .prepare(
        `SELECT COALESCE(MAX(change_sequence), 0) + 1 AS next_sequence
         FROM peer_projection_changes
         WHERE owner_user_id = ? AND relationship_id = ? AND projection_id = ?`
      )
      .get(input.ownerUserId, input.relationshipId, input.projectionId) as {
      next_sequence: number;
    };
    const id = input.id ?? randomUUID();
    const createdAt = iso(input.now ?? new Date());
    database
      .prepare(
        `INSERT INTO peer_projection_changes (
           id, owner_user_id, relationship_id, projection_id,
           projection_version, change_sequence, source_entity_type,
           source_entity_id, source_version, operation, encrypted_payload_ref,
           payload_hash, grant_id, grant_sequence, claimed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
      )
      .run(
        id,
        input.ownerUserId,
        input.relationshipId,
        input.projectionId,
        input.projectionVersion,
        next.next_sequence,
        input.sourceEntityType,
        input.sourceEntityId,
        input.sourceVersion,
        input.operation,
        input.encryptedPayloadRef ?? null,
        input.payloadHash ?? null,
        input.grantId ?? null,
        input.grantSequence ?? null,
        createdAt
      );
    const row = database
      .prepare(
        `SELECT ${PROJECTION_CHANGE_SELECT} FROM peer_projection_changes WHERE id = ?`
      )
      .get(id) as ProjectionChangeSqlRow;
    return mapProjectionChange(row);
  });
}

export function listUnclaimedPeerProjectionChanges(input: {
  ownerUserId: string;
  relationshipId: string;
  limit: number;
}): PeerProjectionChange[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${PROJECTION_CHANGE_SELECT}
       FROM peer_projection_changes
       WHERE owner_user_id = ? AND relationship_id = ? AND claimed_at IS NULL
       ORDER BY change_sequence, id
       LIMIT ?`
    )
    .all(
      input.ownerUserId,
      input.relationshipId,
      boundedLimit(input.limit)
    ) as ProjectionChangeSqlRow[];
  return rows.map(mapProjectionChange);
}

function insertOutboxEnvelope(input: {
  envelopeId?: string;
  ownerUserId: string;
  relationshipId: string;
  recipientDeviceId: string;
  channelId: string;
  sequence: number;
  previousAcknowledgement?: number;
  messageKind: string;
  mlsEpoch: number;
  ciphertext: Uint8Array;
  ciphertextHash?: string;
  nextAttemptAt?: Date;
  expiresAt: Date;
  now?: Date;
}): { envelope: PeerOutboxEnvelope; inserted: boolean } {
  const now = input.now ?? new Date();
  const timestamp = iso(now);
  const expiresAt = iso(input.expiresAt);
  if (expiresAt <= timestamp) {
    throw new Error("Peer outbox envelope must expire after it is created.");
  }
  const ciphertext = checkedCiphertext(input.ciphertext, input.ciphertextHash);
  const ciphertextHash = digestBytes(ciphertext);
  const envelopeId = checkedEnvelopeId(input.envelopeId ?? randomUUID());
  const result = getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO peer_outbox (
         envelope_id, owner_user_id, relationship_id, recipient_device_id,
         channel_id, sequence, previous_acknowledgement, message_kind,
         mls_epoch, ciphertext, ciphertext_hash, size_bytes, status,
         attempt_count, next_attempt_at, last_attempt_at, acknowledged_at,
         expires_at, last_error, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, '', ?, ?)`
    )
    .run(
      envelopeId,
      input.ownerUserId,
      input.relationshipId,
      input.recipientDeviceId,
      input.channelId,
      input.sequence,
      input.previousAcknowledgement ?? 0,
      input.messageKind,
      input.mlsEpoch,
      ciphertext,
      ciphertextHash,
      ciphertext.byteLength,
      iso(input.nextAttemptAt ?? now),
      expiresAt,
      timestamp,
      timestamp
    );
  const envelope = readOutbox(envelopeId, input.ownerUserId);
  if (!envelope) {
    throw new Error("Peer outbox envelope could not be read after insertion.");
  }
  const immutableMatches =
    envelope.relationshipId === input.relationshipId &&
    envelope.recipientDeviceId === input.recipientDeviceId &&
    envelope.channelId === input.channelId &&
    envelope.sequence === input.sequence &&
    envelope.previousAcknowledgement === (input.previousAcknowledgement ?? 0) &&
    envelope.messageKind === input.messageKind &&
    envelope.mlsEpoch === input.mlsEpoch &&
    envelope.ciphertextHash === ciphertextHash &&
    envelope.expiresAt === expiresAt;
  if (!immutableMatches) {
    throw new Error(
      "Peer outbox envelope id conflicts with different immutable content."
    );
  }
  return { envelope, inserted: result.changes === 1 };
}

export function enqueuePeerOutboxEnvelope(
  input: Parameters<typeof insertOutboxEnvelope>[0]
): { envelope: PeerOutboxEnvelope; inserted: boolean } {
  return runInTransaction(() => insertOutboxEnvelope(input));
}

export function commitPeerProjectionChangeEnvelope(input: {
  ownerUserId: string;
  relationshipId: string;
  changeIds: string[];
  envelope: Omit<
    Parameters<typeof insertOutboxEnvelope>[0],
    "ownerUserId" | "relationshipId" | "now"
  >;
  now?: Date;
}): PeerOutboxEnvelope {
  const uniqueIds = [...new Set(input.changeIds)];
  if (uniqueIds.length < 1 || uniqueIds.length > MAX_BATCH_SIZE) {
    throw new Error(
      `A peer envelope must claim between 1 and ${MAX_BATCH_SIZE} projection changes.`
    );
  }
  return runInTransaction(() => {
    const database = getDatabase();
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const eligible = database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM peer_projection_changes
         WHERE owner_user_id = ? AND relationship_id = ? AND claimed_at IS NULL
           AND id IN (${placeholders})`
      )
      .get(input.ownerUserId, input.relationshipId, ...uniqueIds) as {
      count: number;
    };
    if (eligible.count !== uniqueIds.length) {
      throw new Error(
        "One or more peer projection changes were already claimed or are out of scope."
      );
    }
    const now = input.now ?? new Date();
    const { envelope } = insertOutboxEnvelope({
      ...input.envelope,
      ownerUserId: input.ownerUserId,
      relationshipId: input.relationshipId,
      now
    });
    const claimed = database
      .prepare(
        `UPDATE peer_projection_changes SET claimed_at = ?
         WHERE owner_user_id = ? AND relationship_id = ? AND claimed_at IS NULL
           AND id IN (${placeholders})`
      )
      .run(iso(now), input.ownerUserId, input.relationshipId, ...uniqueIds);
    if (claimed.changes !== uniqueIds.length) {
      throw new Error(
        "Peer projection change claim changed during envelope commit."
      );
    }
    return envelope;
  });
}

export function claimDuePeerOutbox(input: {
  ownerUserId: string;
  limit: number;
  now?: Date;
  leaseMs?: number;
}): PeerOutboxEnvelope[] {
  const now = input.now ?? new Date();
  const timestamp = iso(now);
  const leaseExpiresAt = iso(
    new Date(now.getTime() + checkedOutboxLeaseMs(input.leaseMs))
  );
  return runInTransaction(() => {
    const database = getDatabase();
    const limit = boundedLimit(input.limit);
    const expired = expirePeerOutboxBatch({
      database,
      ownerUserId: input.ownerUserId,
      limit: OUTBOX_EXPIRY_SWEEP_SIZE,
      timestamp
    });
    if (expired === OUTBOX_EXPIRY_SWEEP_SIZE) {
      return [];
    }
    const branchArguments = [
      input.ownerUserId,
      timestamp,
      timestamp,
      limit
    ] as const;
    const candidates = [
      ...(database
        .prepare(PEER_OUTBOX_CANDIDATE_STATEMENTS.due)
        .all(...branchArguments) as OutboxCandidateSqlRow[]),
      ...(database
        .prepare(PEER_OUTBOX_CANDIDATE_STATEMENTS.inFlight)
        .all(...branchArguments) as OutboxCandidateSqlRow[])
    ]
      .sort(
        (left, right) =>
          compareSqliteBinaryHex(
            left.next_attempt_at_order,
            right.next_attempt_at_order
          ) ||
          compareSqliteBinaryHex(
            left.created_at_order,
            right.created_at_order
          ) ||
          compareSqliteBinaryHex(
            left.envelope_id_order,
            right.envelope_id_order
          )
      )
      .slice(0, limit);
    const claimedEnvelopeIds: string[] = [];
    const update = database.prepare(
      `UPDATE peer_outbox
       SET status = 'in_flight', attempt_count = attempt_count + 1,
           next_attempt_at = ?, last_attempt_at = ?, updated_at = ?
       WHERE envelope_id = ? AND owner_user_id = ? AND expires_at > ?
         AND attempt_count < ${PEER_OUTBOX_MAX_ATTEMPTS}
         AND (
           (status IN ('pending', 'failed') AND next_attempt_at <= ?)
           OR (status = 'in_flight' AND next_attempt_at <= ?)
         )`
    );
    for (const candidate of candidates) {
      const result = update.run(
        leaseExpiresAt,
        timestamp,
        timestamp,
        candidate.envelope_id,
        input.ownerUserId,
        timestamp,
        timestamp,
        timestamp
      );
      if (result.changes === 1) {
        claimedEnvelopeIds.push(candidate.envelope_id);
      }
    }
    return readOutboxBatch(database, claimedEnvelopeIds, input.ownerUserId);
  });
}

export function markPeerOutboxFailed(input: {
  ownerUserId: string;
  envelopeId: string;
  expectedAttemptCount: number;
  error: string;
  nextAttemptAt: Date;
  now?: Date;
}): boolean {
  const now = iso(input.now ?? new Date());
  const nextAttemptAt = iso(input.nextAttemptAt);
  if (
    !Number.isInteger(input.expectedAttemptCount) ||
    input.expectedAttemptCount < 1 ||
    input.expectedAttemptCount > PEER_OUTBOX_MAX_ATTEMPTS
  ) {
    throw new Error("Peer outbox attempt count is invalid.");
  }
  if (nextAttemptAt <= now) {
    throw new Error("Peer outbox retry must be scheduled in the future.");
  }
  const result = getDatabase()
    .prepare(
      `UPDATE peer_outbox
       SET status = CASE WHEN attempt_count >= ${PEER_OUTBOX_MAX_ATTEMPTS} THEN 'canceled' ELSE 'failed' END,
           next_attempt_at = ?, last_error = ?, updated_at = ?
       WHERE envelope_id = ? AND owner_user_id = ? AND status = 'in_flight'
         AND attempt_count = ?`
    )
    .run(
      nextAttemptAt,
      input.error.slice(0, MAX_ERROR_LENGTH),
      now,
      input.envelopeId,
      input.ownerUserId,
      input.expectedAttemptCount
    );
  return result.changes === 1;
}

export function recordPeerDeliveryReceipt(input: {
  id?: string;
  ownerUserId: string;
  relationshipId: string;
  acknowledgingDeviceId: string;
  channelId: string;
  highestContiguousSequence: number;
  acknowledgementSignature: string;
  receivedAt?: Date;
}): { inserted: boolean; acknowledgedCount: number; stale: boolean } {
  return runInTransaction(() => {
    const database = getDatabase();
    const receivedAt = iso(input.receivedAt ?? new Date());
    const latest = database
      .prepare(
        `SELECT highest_contiguous_sequence, acknowledgement_signature
         FROM peer_delivery_receipts
         WHERE owner_user_id = ? AND relationship_id = ?
           AND acknowledging_device_id = ? AND channel_id = ?
         ORDER BY highest_contiguous_sequence DESC LIMIT 1`
      )
      .get(
        input.ownerUserId,
        input.relationshipId,
        input.acknowledgingDeviceId,
        input.channelId
      ) as
      | {
          highest_contiguous_sequence: number;
          acknowledgement_signature: string;
        }
      | undefined;
    if (
      latest &&
      input.highestContiguousSequence < latest.highest_contiguous_sequence
    ) {
      return { inserted: false, acknowledgedCount: 0, stale: true };
    }
    const existing = database
      .prepare(
        `SELECT acknowledgement_signature
         FROM peer_delivery_receipts
         WHERE owner_user_id = ? AND relationship_id = ?
           AND acknowledging_device_id = ? AND channel_id = ?
           AND highest_contiguous_sequence = ?`
      )
      .get(
        input.ownerUserId,
        input.relationshipId,
        input.acknowledgingDeviceId,
        input.channelId,
        input.highestContiguousSequence
      ) as { acknowledgement_signature: string } | undefined;
    if (
      existing &&
      existing.acknowledgement_signature !== input.acknowledgementSignature
    ) {
      throw new Error(
        "Peer delivery receipt sequence conflicts with a different signature."
      );
    }
    let inserted = false;
    if (!existing) {
      const result = database
        .prepare(
          `INSERT INTO peer_delivery_receipts (
             id, owner_user_id, relationship_id, acknowledging_device_id,
             channel_id, highest_contiguous_sequence,
             acknowledgement_signature, received_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.id ?? randomUUID(),
          input.ownerUserId,
          input.relationshipId,
          input.acknowledgingDeviceId,
          input.channelId,
          input.highestContiguousSequence,
          input.acknowledgementSignature,
          receivedAt,
          receivedAt
        );
      inserted = result.changes === 1;
    }
    const acknowledged = database
      .prepare(
        `UPDATE peer_outbox
         SET status = 'acknowledged', acknowledged_at = COALESCE(acknowledged_at, ?),
             updated_at = ?, last_error = ''
         WHERE owner_user_id = ? AND relationship_id = ?
           AND recipient_device_id = ? AND channel_id = ? AND sequence <= ?
           AND status IN ('pending', 'in_flight', 'failed', 'canceled')`
      )
      .run(
        receivedAt,
        receivedAt,
        input.ownerUserId,
        input.relationshipId,
        input.acknowledgingDeviceId,
        input.channelId,
        input.highestContiguousSequence
      );
    return {
      inserted,
      acknowledgedCount: Number(acknowledged.changes),
      stale: false
    };
  });
}

export function expirePeerOutbox(input: {
  ownerUserId: string;
  limit: number;
  now?: Date;
}): number {
  const timestamp = iso(input.now ?? new Date());
  const limit = boundedLimit(input.limit);
  return runInTransaction(() =>
    expirePeerOutboxBatch({
      database: getDatabase(),
      ownerUserId: input.ownerUserId,
      limit,
      timestamp
    })
  );
}

export function receivePeerInboxEnvelope(input: {
  envelopeId: string;
  ownerUserId: string;
  relationshipId: string;
  senderDeviceId: string;
  channelId: string;
  sequence: number;
  messageKind: string;
  mlsEpoch: number;
  ciphertext: Uint8Array;
  ciphertextHash?: string;
  receivedAt?: Date;
  expiresAt: Date;
}): { envelope: PeerInboxEnvelope; duplicate: boolean } {
  return runInTransaction(() => {
    const receivedAt = input.receivedAt ?? new Date();
    const receivedAtIso = iso(receivedAt);
    const expiresAt = iso(input.expiresAt);
    if (expiresAt <= receivedAtIso) {
      throw new Error("Expired peer inbox envelopes cannot be accepted.");
    }
    const ciphertext = checkedCiphertext(
      input.ciphertext,
      input.ciphertextHash
    );
    const ciphertextHash = digestBytes(ciphertext);
    const database = getDatabase();
    const sameId = readInbox(input.envelopeId, input.ownerUserId);
    if (sameId) {
      if (
        sameId.relationshipId !== input.relationshipId ||
        sameId.senderDeviceId !== input.senderDeviceId ||
        sameId.channelId !== input.channelId ||
        sameId.sequence !== input.sequence ||
        sameId.messageKind !== input.messageKind ||
        sameId.mlsEpoch !== input.mlsEpoch ||
        sameId.ciphertextHash !== ciphertextHash
      ) {
        throw new Error(
          "Peer inbox envelope id conflicts with different immutable content."
        );
      }
      return { envelope: sameId, duplicate: true };
    }
    const sameSequence = database
      .prepare(
        `SELECT ${INBOX_SELECT} FROM peer_inbox
         WHERE owner_user_id = ? AND relationship_id = ? AND sender_device_id = ?
           AND channel_id = ? AND sequence = ?`
      )
      .get(
        input.ownerUserId,
        input.relationshipId,
        input.senderDeviceId,
        input.channelId,
        input.sequence
      ) as InboxSqlRow | undefined;
    if (sameSequence) {
      if (sameSequence.ciphertext_hash !== ciphertextHash) {
        throw new Error(
          "Peer inbox sequence replay contains different ciphertext."
        );
      }
      return { envelope: mapInbox(sameSequence), duplicate: true };
    }
    database
      .prepare(
        `INSERT INTO peer_inbox (
           envelope_id, owner_user_id, relationship_id, sender_device_id,
           channel_id, sequence, message_kind, mls_epoch, ciphertext,
           ciphertext_hash, processing_state, received_at, processed_at,
           expires_at, failure_reason, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, '', ?, ?)`
      )
      .run(
        input.envelopeId,
        input.ownerUserId,
        input.relationshipId,
        input.senderDeviceId,
        input.channelId,
        input.sequence,
        input.messageKind,
        input.mlsEpoch,
        ciphertext,
        ciphertextHash,
        receivedAtIso,
        expiresAt,
        receivedAtIso,
        receivedAtIso
      );
    const envelope = readInbox(input.envelopeId, input.ownerUserId);
    if (!envelope)
      throw new Error("Peer inbox envelope could not be read after insertion.");
    return { envelope, duplicate: false };
  });
}

export function claimPeerInbox(input: {
  ownerUserId: string;
  limit: number;
  now?: Date;
  leaseMs?: number;
}): PeerInboxEnvelope[] {
  const now = input.now ?? new Date();
  const timestamp = iso(now);
  const staleBefore = iso(new Date(now.getTime() - (input.leaseMs ?? 60_000)));
  return runInTransaction(() => {
    const database = getDatabase();
    const candidates = database
      .prepare(
        `SELECT envelope_id FROM peer_inbox
         WHERE owner_user_id = ? AND expires_at > ?
           AND (processing_state = 'pending'
             OR (processing_state = 'processing' AND updated_at <= ?))
         ORDER BY received_at, envelope_id LIMIT ?`
      )
      .all(
        input.ownerUserId,
        timestamp,
        staleBefore,
        boundedLimit(input.limit)
      ) as Array<{
      envelope_id: string;
    }>;
    const claimed: PeerInboxEnvelope[] = [];
    const update = database.prepare(
      `UPDATE peer_inbox SET processing_state = 'processing', updated_at = ?
       WHERE owner_user_id = ? AND envelope_id = ? AND expires_at > ?
         AND (processing_state = 'pending'
           OR (processing_state = 'processing' AND updated_at <= ?))`
    );
    for (const candidate of candidates) {
      if (
        update.run(
          timestamp,
          input.ownerUserId,
          candidate.envelope_id,
          timestamp,
          staleBefore
        ).changes === 1
      ) {
        const envelope = readInbox(candidate.envelope_id, input.ownerUserId);
        if (envelope) claimed.push(envelope);
      }
    }
    return claimed;
  });
}

export function finishPeerInboxEnvelope(input: {
  ownerUserId: string;
  envelopeId: string;
  claimedAt: string;
  outcome: "processed" | "rejected" | "duplicate";
  failureReason?: string;
  now?: Date;
}): boolean {
  const timestamp = iso(input.now ?? new Date());
  const result = getDatabase()
    .prepare(
      `UPDATE peer_inbox
       SET processing_state = ?, processed_at = ?, failure_reason = ?, updated_at = ?
       WHERE owner_user_id = ? AND envelope_id = ?
         AND processing_state = 'processing' AND updated_at = ?`
    )
    .run(
      input.outcome,
      timestamp,
      (input.failureReason ?? "").slice(0, MAX_ERROR_LENGTH),
      timestamp,
      input.ownerUserId,
      input.envelopeId,
      input.claimedAt
    );
  return result.changes === 1;
}
