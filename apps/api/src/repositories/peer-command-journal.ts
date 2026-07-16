import { createHash } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";

const DAEMON_DISPATCH_OPERATION = "peer_command_daemon_dispatch_v1";
const DAEMON_RECEIPT_OPERATION = "peer_command_daemon_receipt_v1";
const PERMANENT_EXPIRY = "9999-12-31T23:59:59.999Z";
const hashPattern = /^[a-f0-9]{64}$/;

export type PeerCommandDaemonDispatchBinding = {
  protocol: "forge-peer-command-daemon-dispatch/v1";
  ownerUserId: string;
  commandId: string;
  operation: string;
  requestHash: string;
  authorityKeyId: string;
  authorizationId: string;
  actorClass: "operator_session" | "companion_consent";
  actorId: string;
  sessionId: string;
  deviceId: string | null;
  capabilityId: string;
  authorityStateHash: string;
  invalidationEpoch: string;
  actionDigest: string;
  approvalDeadline: string;
  boundAt: string;
};

export type PeerCommandDaemonReceiptBinding = {
  protocol: "forge-peer-command-daemon-receipt/v1";
  ownerUserId: string;
  commandId: string;
  operation: string;
  requestHash: string;
  authorityKeyId: string;
  authorizationId: string;
  actorClass: "operator_session" | "companion_consent";
  actorId: string;
  sessionId: string;
  deviceId: string | null;
  capabilityId: string;
  authorityStateHash: string;
  invalidationEpoch: string;
  actionDigest: string;
  approvalDeadline: string;
  committedAt: string;
  authorizationVerifiedAt: string;
  receiptVerifiedAt: string;
  resultHash: string;
  evidenceStatementHash: string;
  evidenceSignature: string;
};

export type PeerCommandStatus =
  | "prepared"
  | "dispatched"
  | "applied"
  | "failed"
  | "reconciliation_required";

export type PeerCommandAuthorizationState =
  | "legacy_unverifiable"
  | "approved"
  | "invalidated"
  | "receipt_committed"
  | "receipt_unresolved"
  | "quarantined";

export type PeerCommandApprovalJournalBinding = {
  ownerUserId: string;
  actorClass: "operator_session" | "companion_consent";
  actorId: string;
  sessionId: string;
  deviceId: string | null;
  capabilityId: string;
  approvalMethod: "webauthn" | "companion_signature";
  approvalDeadline: string;
  authorizationId: string;
  authorizationStateHash: string;
};

export type PeerCommandJournalEntry = {
  commandId: string;
  ownerUserId: string;
  operationId: string;
  targetType: string;
  targetId: string;
  requestHash: string;
  expectedVersion: string | null;
  authorizationState: PeerCommandAuthorizationState;
  approval: PeerCommandApprovalJournalBinding | null;
  invalidatedAt: string | null;
  invalidationReason: string | null;
  daemonCommittedAt: string | null;
  receiptCheckedAt: string | null;
  quarantineReason: string | null;
  status: PeerCommandStatus;
  attemptCount: number;
  resultHash: string | null;
  resultReference: string | null;
  lastError: string;
  lastDispatchedAt: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PeerCommandSqlRow = {
  command_id: string;
  owner_user_id: string;
  operation_id: string;
  target_type: string;
  target_id: string;
  request_hash: string;
  expected_version: string | null;
  authorization_state: PeerCommandAuthorizationState;
  approval_owner_user_id: string | null;
  approval_actor_class: "operator_session" | "companion_consent" | null;
  approval_actor_id: string | null;
  approval_session_id: string | null;
  approval_device_id: string | null;
  approval_capability_id: string | null;
  approval_method: "webauthn" | "companion_signature" | null;
  approval_deadline: string | null;
  authorization_id: string | null;
  authorization_state_hash: string | null;
  invalidated_at: string | null;
  invalidation_reason: string | null;
  daemon_committed_at: string | null;
  receipt_checked_at: string | null;
  quarantine_reason: string | null;
  status: PeerCommandStatus;
  attempt_count: number;
  result_hash: string | null;
  result_reference: string | null;
  last_error: string;
  last_dispatched_at: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
};

const COMMAND_SELECT = `
  command_id, owner_user_id, operation_id, target_type, target_id,
  request_hash, expected_version, status, attempt_count, result_hash,
  result_reference, authorization_state, approval_owner_user_id,
  approval_actor_class, approval_actor_id, approval_session_id,
  approval_device_id, approval_capability_id, approval_method,
  approval_deadline, authorization_id, authorization_state_hash,
  invalidated_at, invalidation_reason, daemon_committed_at,
  receipt_checked_at, quarantine_reason,
  last_error, last_dispatched_at, applied_at, created_at, updated_at
`;

function mapCommand(row: PeerCommandSqlRow): PeerCommandJournalEntry {
  return {
    commandId: row.command_id,
    ownerUserId: row.owner_user_id,
    operationId: row.operation_id,
    targetType: row.target_type,
    targetId: row.target_id,
    requestHash: row.request_hash,
    expectedVersion: row.expected_version,
    authorizationState: row.authorization_state,
    approval:
      row.approval_owner_user_id &&
      row.approval_actor_class &&
      row.approval_actor_id &&
      row.approval_session_id &&
      row.approval_capability_id &&
      row.approval_method &&
      row.approval_deadline &&
      row.authorization_id &&
      row.authorization_state_hash
        ? {
            ownerUserId: row.approval_owner_user_id,
            actorClass: row.approval_actor_class,
            actorId: row.approval_actor_id,
            sessionId: row.approval_session_id,
            deviceId: row.approval_device_id,
            capabilityId: row.approval_capability_id,
            approvalMethod: row.approval_method,
            approvalDeadline: row.approval_deadline,
            authorizationId: row.authorization_id,
            authorizationStateHash: row.authorization_state_hash
          }
        : null,
    invalidatedAt: row.invalidated_at,
    invalidationReason: row.invalidation_reason,
    daemonCommittedAt: row.daemon_committed_at,
    receiptCheckedAt: row.receipt_checked_at,
    quarantineReason: row.quarantine_reason,
    status: row.status,
    attemptCount: row.attempt_count,
    resultHash: row.result_hash,
    resultReference: row.result_reference,
    lastError: row.last_error,
    lastDispatchedAt: row.last_dispatched_at,
    appliedAt: row.applied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function canonicalJson(value: unknown): string {
  const canonicalize = (candidate: unknown): unknown => {
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean" ||
      (typeof candidate === "number" && Number.isFinite(candidate))
    ) {
      return candidate;
    }
    if (Array.isArray(candidate)) return candidate.map(canonicalize);
    if (typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, nested]) => [key, canonicalize(nested)])
      );
    }
    throw new Error("Peer command journal evidence is not canonical JSON.");
  };
  return JSON.stringify(canonicalize(value));
}

function requireHash(value: string, label: string) {
  if (!hashPattern.test(value)) {
    throw new Error(`Peer command ${label} is not a canonical hash.`);
  }
  return value;
}

function requireTimestamp(value: string, label: string) {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`Peer command ${label} is not a valid timestamp.`);
  }
  return value;
}

function timestampsMatch(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime === rightTime
  );
}

function evidenceRow(input: {
  ownerUserId: string;
  operationId: string;
  commandId: string;
}): { requestHash: string; responseJson: string } | null {
  const row = getDatabase()
    .prepare(
      `SELECT request_hash AS requestHash, response_json AS responseJson
       FROM peer_idempotency_records
       WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ?`
    )
    .get(input.ownerUserId, input.operationId, input.commandId) as
    | { requestHash: string; responseJson: string }
    | undefined;
  return row ?? null;
}

function persistImmutableEvidence(input: {
  ownerUserId: string;
  operationId: string;
  commandId: string;
  requestHash: string;
  responseStatus: number;
  value: unknown;
  createdAt: string;
}) {
  const responseJson = canonicalJson(input.value);
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO peer_idempotency_records (
         owner_user_id, operation_id, idempotency_key, request_hash,
         response_status, response_json, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.ownerUserId,
      input.operationId,
      input.commandId,
      input.requestHash,
      input.responseStatus,
      responseJson,
      input.createdAt,
      PERMANENT_EXPIRY
    );
  const stored = evidenceRow(input);
  if (
    !stored ||
    stored.requestHash !== input.requestHash ||
    stored.responseJson !== responseJson
  ) {
    throw new Error(
      "Peer command durable evidence conflicts with its binding."
    );
  }
}

function timestamp(date: Date): string {
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Peer command timestamp is invalid.");
  }
  return date.toISOString();
}

function commandRow(commandId: string): PeerCommandJournalEntry | null {
  const row = getDatabase()
    .prepare(
      `SELECT ${COMMAND_SELECT} FROM peer_command_journal WHERE command_id = ?`
    )
    .get(commandId) as PeerCommandSqlRow | undefined;
  return row ? mapCommand(row) : null;
}

export function derivePeerCommandId(input: {
  ownerUserId: string;
  operationId: string;
  targetType: string;
  targetId: string;
  requestHash: string;
  retryKey?: string | null;
}): string {
  const digest = createHash("sha256")
    .update("forge-peer-command/v1\0", "utf8")
    .update(input.ownerUserId, "utf8")
    .update("\0", "utf8")
    .update(input.operationId, "utf8")
    .update("\0", "utf8")
    .update(input.targetType, "utf8")
    .update("\0", "utf8")
    .update(input.targetId, "utf8")
    .update("\0", "utf8")
    .update(input.requestHash, "utf8")
    .update("\0", "utf8")
    .update(input.retryKey ?? "", "utf8")
    .digest("hex");
  return `pcmd_${digest}`;
}

export function getPeerCommand(
  commandId: string
): PeerCommandJournalEntry | null {
  return commandRow(commandId);
}

export function recordPeerCommandDaemonDispatch(input: {
  ownerUserId: string;
  commandId: string;
  operation: string;
  requestHash: string;
  authorization: {
    authorityKeyId: string;
    authorizationId: string;
    ownerUserId: string;
    actorClass: "operator_session" | "companion_consent" | "service_worker";
    actorId: string;
    sessionId: string;
    deviceId: string | null;
    capabilityId: string;
    actionDigest: string;
    authorityStateHash: string;
    invalidationEpoch: string;
    approvalDeadline: string;
    issuedAt: string;
  };
}): PeerCommandDaemonDispatchBinding | null {
  return runInTransaction(() => {
    const entry = commandRow(input.commandId);
    if (!entry) return null;
    const authorization = input.authorization;
    const approval = entry.approval;
    if (
      entry.ownerUserId !== input.ownerUserId ||
      entry.status !== "dispatched" ||
      entry.authorizationState !== "approved" ||
      !approval ||
      authorization.actorClass === "service_worker" ||
      authorization.ownerUserId !== input.ownerUserId ||
      approval.ownerUserId !== input.ownerUserId ||
      approval.authorizationId !== authorization.authorizationId ||
      approval.actorClass !== authorization.actorClass ||
      approval.actorId !== authorization.actorId ||
      approval.sessionId !== authorization.sessionId ||
      approval.deviceId !== authorization.deviceId ||
      approval.capabilityId !== authorization.capabilityId ||
      approval.approvalDeadline !== authorization.approvalDeadline
    ) {
      throw new Error(
        "Peer command dispatch does not match its authorization-bound journal."
      );
    }
    const boundAt = requireTimestamp(
      authorization.issuedAt,
      "dispatch authorization time"
    );
    if (
      Date.parse(boundAt) > Date.parse(authorization.approvalDeadline) ||
      !/^(0|[1-9][0-9]*)$/.test(authorization.invalidationEpoch)
    ) {
      throw new Error("Peer command dispatch authorization window is invalid.");
    }
    const binding: PeerCommandDaemonDispatchBinding = {
      protocol: "forge-peer-command-daemon-dispatch/v1",
      ownerUserId: input.ownerUserId,
      commandId: input.commandId,
      operation: input.operation,
      requestHash: requireHash(input.requestHash, "daemon request hash"),
      authorityKeyId: authorization.authorityKeyId,
      authorizationId: authorization.authorizationId,
      actorClass: authorization.actorClass,
      actorId: authorization.actorId,
      sessionId: authorization.sessionId,
      deviceId: authorization.deviceId,
      capabilityId: authorization.capabilityId,
      authorityStateHash: requireHash(
        authorization.authorityStateHash,
        "authority state hash"
      ),
      invalidationEpoch: authorization.invalidationEpoch,
      actionDigest: requireHash(
        authorization.actionDigest,
        "approval action digest"
      ),
      approvalDeadline: requireTimestamp(
        authorization.approvalDeadline,
        "approval deadline"
      ),
      boundAt
    };
    persistImmutableEvidence({
      ownerUserId: input.ownerUserId,
      operationId: DAEMON_DISPATCH_OPERATION,
      commandId: input.commandId,
      requestHash: binding.requestHash,
      responseStatus: 202,
      value: binding,
      createdAt: boundAt
    });
    return binding;
  });
}

export function verifyPeerCommandDaemonReceipt(input: {
  ownerUserId: string;
  commandId: string;
  operation: string;
  requestHash: string;
  approvalDeadline: string;
  committedAt: string;
  resultHash: string;
  currentAuthorityStateHash: string;
  authorization: {
    authorityKeyId: string;
    authorizationId: string;
    actorClass: "operator_session" | "companion_consent" | "service_worker";
    actorId: string;
    actorDeviceId: string | null;
    sessionId: string;
    capabilityId: string;
    actionDigest: string;
    invalidationEpoch: string;
    authorityStateHash: string;
    verifiedAt: string;
  };
  evidence: {
    statementHash: string;
    signature: string;
  };
  now?: Date;
}): PeerCommandJournalEntry | null {
  return runInTransaction(() => {
    const entry = commandRow(input.commandId);
    if (!entry) return null;
    if (entry.ownerUserId !== input.ownerUserId || !entry.approval) {
      throw new Error("Peer command receipt belongs to another journal owner.");
    }
    const dispatchRow = evidenceRow({
      ownerUserId: input.ownerUserId,
      operationId: DAEMON_DISPATCH_OPERATION,
      commandId: input.commandId
    });
    if (!dispatchRow) {
      throw new Error("Peer command receipt has no durable dispatch binding.");
    }
    const dispatch = JSON.parse(
      dispatchRow.responseJson
    ) as PeerCommandDaemonDispatchBinding;
    const authorization = input.authorization;
    const receiptVerifiedAt =
      entry.receiptCheckedAt ?? timestamp(input.now ?? new Date());
    const committedAt = requireTimestamp(input.committedAt, "commit time");
    const authorizationVerifiedAt = requireTimestamp(
      authorization.verifiedAt,
      "authorization verification time"
    );
    const exact =
      dispatch.protocol === "forge-peer-command-daemon-dispatch/v1" &&
      dispatch.ownerUserId === input.ownerUserId &&
      dispatch.commandId === input.commandId &&
      dispatch.operation === input.operation &&
      dispatch.requestHash === input.requestHash &&
      dispatchRow.requestHash === input.requestHash &&
      dispatch.authorityKeyId === authorization.authorityKeyId &&
      dispatch.authorizationId === authorization.authorizationId &&
      dispatch.actorClass === authorization.actorClass &&
      dispatch.actorId === authorization.actorId &&
      dispatch.sessionId === authorization.sessionId &&
      dispatch.deviceId === authorization.actorDeviceId &&
      dispatch.capabilityId === authorization.capabilityId &&
      dispatch.actionDigest === authorization.actionDigest &&
      dispatch.authorityStateHash === authorization.authorityStateHash &&
      dispatch.authorityStateHash === input.currentAuthorityStateHash &&
      dispatch.invalidationEpoch === authorization.invalidationEpoch &&
      timestampsMatch(dispatch.approvalDeadline, input.approvalDeadline) &&
      entry.approval.authorizationId === authorization.authorizationId &&
      entry.approval.actorClass === authorization.actorClass &&
      entry.approval.actorId === authorization.actorId &&
      entry.approval.sessionId === authorization.sessionId &&
      entry.approval.deviceId === authorization.actorDeviceId &&
      entry.approval.capabilityId === authorization.capabilityId &&
      timestampsMatch(
        entry.approval.approvalDeadline,
        input.approvalDeadline
      ) &&
      Date.parse(authorizationVerifiedAt) <= Date.parse(committedAt) &&
      Date.parse(committedAt) <= Date.parse(input.approvalDeadline);
    if (
      !exact ||
      authorization.actorClass === "service_worker" ||
      !["approved", "receipt_unresolved", "receipt_committed"].includes(
        entry.authorizationState
      ) ||
      entry.invalidatedAt !== null ||
      !hashPattern.test(input.requestHash) ||
      !hashPattern.test(input.resultHash) ||
      !hashPattern.test(input.currentAuthorityStateHash) ||
      !hashPattern.test(input.evidence.statementHash) ||
      input.evidence.signature.length !== 86
    ) {
      throw new Error(
        "Peer command receipt does not match its dispatch and current authority state."
      );
    }
    const receiptBinding: PeerCommandDaemonReceiptBinding = {
      protocol: "forge-peer-command-daemon-receipt/v1",
      ownerUserId: input.ownerUserId,
      commandId: input.commandId,
      operation: input.operation,
      requestHash: input.requestHash,
      authorityKeyId: authorization.authorityKeyId,
      authorizationId: authorization.authorizationId,
      actorClass: authorization.actorClass,
      actorId: authorization.actorId,
      sessionId: authorization.sessionId,
      deviceId: authorization.actorDeviceId,
      capabilityId: authorization.capabilityId,
      authorityStateHash: authorization.authorityStateHash,
      invalidationEpoch: authorization.invalidationEpoch,
      actionDigest: authorization.actionDigest,
      approvalDeadline: dispatch.approvalDeadline,
      committedAt,
      authorizationVerifiedAt,
      receiptVerifiedAt,
      resultHash: input.resultHash,
      evidenceStatementHash: input.evidence.statementHash,
      evidenceSignature: input.evidence.signature
    };
    persistImmutableEvidence({
      ownerUserId: input.ownerUserId,
      operationId: DAEMON_RECEIPT_OPERATION,
      commandId: input.commandId,
      requestHash: input.requestHash,
      responseStatus: 200,
      value: receiptBinding,
      createdAt: receiptVerifiedAt
    });
    if (
      entry.status !== "applied" &&
      entry.authorizationState !== "receipt_committed"
    ) {
      const updated = getDatabase()
        .prepare(
          `UPDATE peer_command_journal
           SET authorization_state = 'receipt_committed',
               daemon_committed_at = ?, receipt_checked_at = ?,
               last_error = '', updated_at = ?
           WHERE command_id = ? AND owner_user_id = ?
             AND status IN ('dispatched', 'failed', 'reconciliation_required')
             AND authorization_state IN ('approved', 'receipt_unresolved')
             AND invalidated_at IS NULL`
        )
        .run(
          committedAt,
          receiptVerifiedAt,
          receiptVerifiedAt,
          input.commandId,
          input.ownerUserId
        );
      if (updated.changes !== 1) {
        throw new Error(
          "Peer command receipt state changed before verification."
        );
      }
    } else if (
      entry.daemonCommittedAt !== committedAt ||
      entry.receiptCheckedAt === null
    ) {
      throw new Error(
        "Peer command receipt replay conflicts with journal evidence."
      );
    }
    const verified = commandRow(input.commandId);
    if (!verified)
      throw new Error("Verified peer command receipt disappeared.");
    return verified;
  });
}

export function preparePeerCommand(input: {
  commandId: string;
  ownerUserId: string;
  operationId: string;
  targetType: string;
  targetId: string;
  requestHash: string;
  expectedVersion?: string | null;
  approval: PeerCommandApprovalJournalBinding;
  now?: Date;
}): { entry: PeerCommandJournalEntry; inserted: boolean } {
  return runInTransaction(() => {
    const now = timestamp(input.now ?? new Date());
    if (
      input.approval.ownerUserId !== input.ownerUserId ||
      Date.parse(input.approval.approvalDeadline) <= Date.parse(now) ||
      !/^[a-f0-9]{64}$/.test(input.approval.authorizationStateHash)
    ) {
      throw new Error("Peer command approval binding is invalid or expired.");
    }
    const result = getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO peer_command_journal (
           command_id, owner_user_id, operation_id, target_type, target_id,
           request_hash, expected_version, status, attempt_count, result_hash,
           result_reference, authorization_state, approval_owner_user_id,
           approval_actor_class, approval_actor_id, approval_session_id,
           approval_device_id, approval_capability_id, approval_method,
           approval_deadline, authorization_id, authorization_state_hash,
           last_error, last_dispatched_at, applied_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', 0, NULL, NULL, 'approved',
                   ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL, NULL, ?, ?)`
      )
      .run(
        input.commandId,
        input.ownerUserId,
        input.operationId,
        input.targetType,
        input.targetId,
        input.requestHash,
        input.expectedVersion ?? null,
        input.approval.ownerUserId,
        input.approval.actorClass,
        input.approval.actorId,
        input.approval.sessionId,
        input.approval.deviceId,
        input.approval.capabilityId,
        input.approval.approvalMethod,
        input.approval.approvalDeadline,
        input.approval.authorizationId,
        input.approval.authorizationStateHash,
        now,
        now
      );
    const entry = commandRow(input.commandId);
    if (!entry) {
      throw new Error("Peer command could not be read after preparation.");
    }
    if (
      entry.ownerUserId !== input.ownerUserId ||
      entry.operationId !== input.operationId ||
      entry.targetType !== input.targetType ||
      entry.targetId !== input.targetId ||
      entry.requestHash !== input.requestHash ||
      entry.expectedVersion !== (input.expectedVersion ?? null) ||
      !entry.approval ||
      JSON.stringify(entry.approval) !== JSON.stringify(input.approval) ||
      entry.authorizationState === "legacy_unverifiable" ||
      entry.authorizationState === "quarantined"
    ) {
      throw new Error(
        "Peer command id conflicts with a different reviewed operation."
      );
    }
    return { entry, inserted: result.changes === 1 };
  });
}

export function markPeerCommandDispatched(input: {
  commandId: string;
  ownerUserId: string;
  now?: Date;
}): PeerCommandJournalEntry {
  return runInTransaction(() => {
    const now = timestamp(input.now ?? new Date());
    const result = getDatabase()
      .prepare(
        `UPDATE peer_command_journal
         SET status = 'dispatched', attempt_count = attempt_count + 1,
             last_dispatched_at = ?, last_error = '', updated_at = ?
         WHERE command_id = ? AND owner_user_id = ?
           AND status = 'prepared' AND authorization_state = 'approved'
           AND invalidated_at IS NULL AND approval_deadline > ?`
      )
      .run(now, now, input.commandId, input.ownerUserId, now);
    if (result.changes !== 1) {
      const current = commandRow(input.commandId);
      if (
        current?.ownerUserId === input.ownerUserId &&
        current.status === "applied"
      ) {
        return current;
      }
      throw new Error("Peer command is not dispatchable.");
    }
    const entry = commandRow(input.commandId);
    if (!entry) throw new Error("Dispatched peer command is missing.");
    return entry;
  });
}

export function markPeerCommandReceiptRecovered(input: {
  commandId: string;
  ownerUserId: string;
  now?: Date;
}): PeerCommandJournalEntry {
  return runInTransaction(() => {
    const now = timestamp(input.now ?? new Date());
    const current = commandRow(input.commandId);
    const dispatch = evidenceRow({
      ownerUserId: input.ownerUserId,
      operationId: DAEMON_DISPATCH_OPERATION,
      commandId: input.commandId
    });
    if (
      dispatch &&
      (current?.authorizationState !== "receipt_committed" ||
        current.daemonCommittedAt === null ||
        current.receiptCheckedAt === null ||
        !evidenceRow({
          ownerUserId: input.ownerUserId,
          operationId: DAEMON_RECEIPT_OPERATION,
          commandId: input.commandId
        }))
    ) {
      throw new Error("Peer command receipt has not been durably verified.");
    }
    const result = getDatabase()
      .prepare(
        `UPDATE peer_command_journal
         SET status = 'dispatched', last_error = '', updated_at = ?
         WHERE command_id = ? AND owner_user_id = ?
           AND status IN ('dispatched', 'failed', 'reconciliation_required')`
      )
      .run(now, input.commandId, input.ownerUserId);
    if (result.changes !== 1) {
      const current = commandRow(input.commandId);
      if (
        current?.ownerUserId === input.ownerUserId &&
        current.status === "applied"
      ) {
        return current;
      }
      throw new Error("Peer command receipt is not recoverable.");
    }
    const entry = commandRow(input.commandId);
    if (!entry) throw new Error("Recovered peer command is missing.");
    return entry;
  });
}

export function markPeerCommandFailed(input: {
  commandId: string;
  ownerUserId: string;
  error: string;
  now?: Date;
}): boolean {
  const now = timestamp(input.now ?? new Date());
  const result = getDatabase()
    .prepare(
      `UPDATE peer_command_journal
       SET status = 'failed',
           authorization_state = CASE
             WHEN authorization_state = 'approved' THEN 'receipt_unresolved'
             ELSE authorization_state
           END,
           last_error = ?, updated_at = ?
       WHERE command_id = ? AND owner_user_id = ? AND status = 'dispatched'`
    )
    .run(input.error.slice(0, 4_000), now, input.commandId, input.ownerUserId);
  return result.changes === 1;
}

export function markPeerCommandReconciliationRequired(input: {
  commandId: string;
  ownerUserId: string;
  reason: string;
  now?: Date;
}): boolean {
  const now = timestamp(input.now ?? new Date());
  const result = getDatabase()
    .prepare(
      `UPDATE peer_command_journal
       SET status = 'reconciliation_required',
           authorization_state = CASE
             WHEN authorization_state = 'approved' THEN 'receipt_unresolved'
             ELSE authorization_state
           END,
           last_error = ?, updated_at = ?
       WHERE command_id = ? AND owner_user_id = ? AND status != 'applied'`
    )
    .run(input.reason.slice(0, 4_000), now, input.commandId, input.ownerUserId);
  return result.changes === 1;
}

export function applyPeerCommand<T>(input: {
  commandId: string;
  ownerUserId: string;
  resultHash?: string | null;
  resultReference?: string | null;
  now?: Date;
  apply: () => T;
}): { applied: boolean; entry: PeerCommandJournalEntry; value: T | null } {
  return runInTransaction(() => {
    const current = commandRow(input.commandId);
    if (!current || current.ownerUserId !== input.ownerUserId) {
      throw new Error("Prepared peer command was not found.");
    }
    if (current.status === "applied") {
      if ((input.resultHash ?? null) !== current.resultHash) {
        throw new Error(
          "Applied peer command result hash does not match the replayed result."
        );
      }
      return { applied: false, entry: current, value: null };
    }
    if (current.status !== "dispatched") {
      throw new Error(
        "Peer command must be dispatched before local application."
      );
    }
    const dispatch = evidenceRow({
      ownerUserId: input.ownerUserId,
      operationId: DAEMON_DISPATCH_OPERATION,
      commandId: input.commandId
    });
    if (dispatch) {
      const receiptRow = evidenceRow({
        ownerUserId: input.ownerUserId,
        operationId: DAEMON_RECEIPT_OPERATION,
        commandId: input.commandId
      });
      const receipt = receiptRow
        ? (JSON.parse(
            receiptRow.responseJson
          ) as PeerCommandDaemonReceiptBinding)
        : null;
      if (
        current.authorizationState !== "receipt_committed" ||
        current.daemonCommittedAt === null ||
        current.receiptCheckedAt === null ||
        !receipt ||
        receipt.protocol !== "forge-peer-command-daemon-receipt/v1" ||
        receipt.requestHash !== dispatch.requestHash ||
        input.resultHash === undefined ||
        input.resultHash === null ||
        receipt.resultHash !== input.resultHash
      ) {
        throw new Error(
          "Peer command local application requires its exact verified daemon receipt."
        );
      }
    }
    const value = input.apply();
    const now = timestamp(input.now ?? new Date());
    const result = getDatabase()
      .prepare(
        `UPDATE peer_command_journal
         SET status = 'applied', result_hash = ?, result_reference = ?,
             applied_at = ?, updated_at = ?,
             last_error = ''
         WHERE command_id = ? AND owner_user_id = ? AND status = 'dispatched'`
      )
      .run(
        input.resultHash ?? null,
        input.resultReference ?? null,
        now,
        now,
        input.commandId,
        input.ownerUserId
      );
    if (result.changes !== 1) {
      throw new Error(
        "Peer command changed before local application committed."
      );
    }
    const entry = commandRow(input.commandId);
    if (!entry) throw new Error("Applied peer command is missing.");
    return { applied: true, entry, value };
  });
}

export function listRecoverablePeerCommands(input: {
  ownerUserId: string;
  limit: number;
}): PeerCommandJournalEntry[] {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) {
    throw new Error("Peer command recovery limit must be between 1 and 200.");
  }
  const rows = getDatabase()
    .prepare(
      `SELECT ${COMMAND_SELECT} FROM peer_command_journal
       WHERE owner_user_id = ?
         AND status IN ('prepared', 'dispatched', 'failed', 'reconciliation_required')
       ORDER BY updated_at, command_id LIMIT ?`
    )
    .all(input.ownerUserId, input.limit) as PeerCommandSqlRow[];
  return rows.map(mapCommand);
}
