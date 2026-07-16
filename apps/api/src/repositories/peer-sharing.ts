import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase, runInTransaction } from "../db.js";
import type { SecretsManager } from "../managers/platform/secrets-manager.js";
import {
  PEER_PROTOCOL_VERSION,
  peerPairingInviteSchema,
  peerShareGrantVersionSchema,
  type PeerPairingInvite,
  type PeerShareGrantVersion
} from "../peer-sharing-types.js";
import { hashPeerGrantVersion } from "../services/peer-grants.js";

export type PeerRelationshipRow = {
  id: string;
  ownerUserId: string;
  localPrincipalId: string;
  remotePrincipalId: string;
  localPersonId: string | null;
  status:
    | "pending_verification"
    | "active"
    | "paused"
    | "revoked"
    | "recovery_required";
  negotiatedProtocolVersion: string;
  transportPrivacyMode: "fastest" | "hide_network_address" | "custom";
  highestReceivedSequence: number;
  highestSentSequence: number;
  establishedAt: string | null;
  lastConnectedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  remoteDisplayLabel: string;
  remoteTrustState: string;
};

export type PeerDeviceRow = {
  relationshipId: string;
  deviceId: string;
  principalRole: "local" | "remote";
  status: "pending" | "approved" | "removed" | "revoked" | "compromised";
  label: string;
  deviceType: string;
  lastSeenAt: string | null;
  approvedAt: string | null;
  removedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PeerPendingRequest = {
  id: string;
  ownerUserId: string;
  relationshipId: string | null;
  kind: "pairing" | "device" | "grant";
  status: "pending" | "accepted" | "rejected" | "expired";
  version: number;
  payload: Record<string, unknown>;
  payloadHash: string;
  expiresAt: string;
  decidedAt: string | null;
  decisionReason: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthenticatedPeerRevocationEvent = {
  cursor: string;
  eventHash: string;
  previousEventHash: string;
  kind: "grant" | "device" | "relationship" | "credential_retirement";
  source: "local_operator" | "authenticated_peer" | "certified_rotation";
  relationshipId: string;
  grantId: string | null;
  deviceId: string | null;
  targetCertificate: string | null;
  targetCertificateHash: string | null;
  targetCertificateSerial: string | null;
  reason: string;
  occurredAt: string;
  authenticatedRemotePrincipalId: string | null;
  authenticatedRemoteDeviceId: string | null;
  signingDeviceId: string;
  signingCertificate: string;
  signingCertificateHash: string;
  signature: string;
};

export type AuthenticatedPeerRevocationPage = {
  events: AuthenticatedPeerRevocationEvent[];
  acknowledgedCursor: string;
  nextCursor: string;
  hasMore: boolean;
  provenance: {
    protocolVersion: typeof PEER_PROTOCOL_VERSION;
    ownerUserId: string;
    relationshipId: null;
    localPrincipalId: string;
    localDeviceId: string;
    remotePrincipalId: null;
    remoteDeviceId: null;
    evidenceHash: string;
    authenticatedAt: string;
  };
};

export type AppliedPeerRevocationState = {
  consumerId: string;
  throughCursor: string;
  eventHash: string;
  appliedAt: string;
};

export type AppliedPeerRevocationPage = AppliedPeerRevocationState & {
  eventCount: number;
  replayed: boolean;
};

type RelationshipSqlRow = {
  id: string;
  owner_user_id: string;
  local_principal_id: string;
  remote_principal_id: string;
  local_person_id: string | null;
  status: PeerRelationshipRow["status"];
  negotiated_protocol_version: string;
  transport_privacy_mode: PeerRelationshipRow["transportPrivacyMode"];
  highest_received_sequence: number;
  highest_sent_sequence: number;
  established_at: string | null;
  last_connected_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  remote_display_label: string;
  remote_trust_state: string;
};

type DeviceSqlRow = {
  relationship_id: string;
  device_id: string;
  principal_role: PeerDeviceRow["principalRole"];
  status: PeerDeviceRow["status"];
  label: string;
  device_type: string;
  last_seen_at: string | null;
  approved_at: string | null;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
};

type RequestSqlRow = {
  id: string;
  owner_user_id: string;
  relationship_id: string | null;
  request_kind: PeerPendingRequest["kind"];
  status: PeerPendingRequest["status"];
  version: number;
  payload_json: string;
  payload_hash: string;
  expires_at: string;
  decided_at: string | null;
  decision_reason: string;
  created_at: string;
  updated_at: string;
};

const RELATIONSHIP_SELECT = `
  relationships.id, relationships.owner_user_id,
  relationships.local_principal_id, relationships.remote_principal_id,
  relationships.local_person_id, relationships.status,
  relationships.negotiated_protocol_version,
  relationships.transport_privacy_mode,
  relationships.highest_received_sequence,
  relationships.highest_sent_sequence, relationships.established_at,
  relationships.last_connected_at, relationships.revoked_at,
  relationships.created_at, relationships.updated_at,
  remote.display_label AS remote_display_label,
  remote.trust_state AS remote_trust_state
`;

function mapRelationship(row: RelationshipSqlRow): PeerRelationshipRow {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    localPrincipalId: row.local_principal_id,
    remotePrincipalId: row.remote_principal_id,
    localPersonId: row.local_person_id,
    status: row.status,
    negotiatedProtocolVersion: row.negotiated_protocol_version,
    transportPrivacyMode: row.transport_privacy_mode,
    highestReceivedSequence: row.highest_received_sequence,
    highestSentSequence: row.highest_sent_sequence,
    establishedAt: row.established_at,
    lastConnectedAt: row.last_connected_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    remoteDisplayLabel: row.remote_display_label,
    remoteTrustState: row.remote_trust_state
  };
}

function mapDevice(row: DeviceSqlRow): PeerDeviceRow {
  return {
    relationshipId: row.relationship_id,
    deviceId: row.device_id,
    principalRole: row.principal_role,
    status: row.status,
    label: row.label,
    deviceType: row.device_type,
    lastSeenAt: row.last_seen_at,
    approvedAt: row.approved_at,
    removedAt: row.removed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRequest(row: RequestSqlRow): PeerPendingRequest {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    relationshipId: row.relationship_id,
    kind: row.request_kind,
    status: row.status,
    version: row.version,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    payloadHash: row.payload_hash,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function canonicalJson(value: unknown): string {
  let nodeCount = 0;
  const visit = (candidate: unknown, depth: number): unknown => {
    nodeCount += 1;
    if (depth > 20 || nodeCount > 20_000) {
      throw new Error("Peer JSON exceeds structural limits.");
    }
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      return candidate;
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (Array.isArray(candidate)) {
      return candidate.map((entry) => visit(entry, depth + 1));
    }
    if (typeof candidate === "object") {
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error("Peer JSON contains a non-plain object.");
      }
      const entries = Object.entries(candidate as Record<string, unknown>);
      if (entries.length > 2_000) {
        throw new Error("Peer JSON object has too many keys.");
      }
      return Object.fromEntries(
        entries
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => {
            if (["__proto__", "constructor", "prototype"].includes(key)) {
              throw new Error("Peer JSON contains a protected key.");
            }
            return [key, visit(nested, depth + 1)];
          })
      );
    }
    throw new Error("Peer JSON contains a non-JSON value.");
  };
  return JSON.stringify(visit(value, 0));
}

export function hashPeerApiValue(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

const REVOCATION_APPLY_OPERATION = "apply_authenticated_revocations";
const boundedPeerIdSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9._:-]+$/);
const peerHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const peerCursorSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine(
    (value) => BigInt(value) <= 18_446_744_073_709_551_615n,
    "Peer revocation cursor exceeds u64."
  );
const peerCertificateSchema = z.string().regex(/^[A-Za-z0-9_-]{64,32768}$/);
const authenticatedPeerRevocationEventSchema = z
  .object({
    cursor: peerCursorSchema.refine((value) => value !== "0"),
    eventHash: peerHashSchema,
    previousEventHash: peerHashSchema,
    kind: z.enum(["grant", "device", "relationship", "credential_retirement"]),
    source: z.enum([
      "local_operator",
      "authenticated_peer",
      "certified_rotation"
    ]),
    relationshipId: z.string().regex(/^[a-f0-9]{32}$/),
    grantId: boundedPeerIdSchema.nullable(),
    deviceId: boundedPeerIdSchema.nullable(),
    targetCertificate: peerCertificateSchema.nullable(),
    targetCertificateHash: peerHashSchema.nullable(),
    targetCertificateSerial: peerCursorSchema
      .refine((value) => value !== "0")
      .nullable(),
    reason: z.string().trim().min(1).max(1_024),
    occurredAt: z.string().datetime({ offset: true }),
    authenticatedRemotePrincipalId: boundedPeerIdSchema.nullable(),
    authenticatedRemoteDeviceId: boundedPeerIdSchema.nullable(),
    signingDeviceId: boundedPeerIdSchema,
    signingCertificate: peerCertificateSchema,
    signingCertificateHash: peerHashSchema,
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/)
  })
  .strict()
  .superRefine((event, context) => {
    const remotePresent =
      event.authenticatedRemotePrincipalId !== null &&
      event.authenticatedRemoteDeviceId !== null;
    const remoteAbsent =
      event.authenticatedRemotePrincipalId === null &&
      event.authenticatedRemoteDeviceId === null;
    if (
      (event.source === "authenticated_peer" && !remotePresent) ||
      (event.source !== "authenticated_peer" && !remoteAbsent)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Peer revocation source binding is invalid."
      });
    }
    const targetPresent =
      event.targetCertificate !== null &&
      event.targetCertificateHash !== null &&
      event.targetCertificateSerial !== null;
    const targetAbsent =
      event.targetCertificate === null &&
      event.targetCertificateHash === null &&
      event.targetCertificateSerial === null;
    const targetValid =
      (event.kind === "grant" &&
        event.grantId !== null &&
        event.deviceId === null &&
        targetAbsent) ||
      ((event.kind === "device" || event.kind === "credential_retirement") &&
        event.grantId === null &&
        event.deviceId !== null &&
        targetPresent) ||
      (event.kind === "relationship" &&
        event.grantId === null &&
        event.deviceId === null &&
        targetAbsent);
    if (!targetValid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Peer revocation target binding is invalid."
      });
    }
  });
const authenticatedPeerRevocationPageSchema = z
  .object({
    events: z.array(authenticatedPeerRevocationEventSchema).min(1).max(128),
    acknowledgedCursor: peerCursorSchema,
    nextCursor: peerCursorSchema,
    hasMore: z.boolean(),
    provenance: z
      .object({
        protocolVersion: z.literal(PEER_PROTOCOL_VERSION),
        ownerUserId: boundedPeerIdSchema,
        relationshipId: z.null(),
        localPrincipalId: boundedPeerIdSchema,
        localDeviceId: boundedPeerIdSchema,
        remotePrincipalId: z.null(),
        remoteDeviceId: z.null(),
        evidenceHash: peerHashSchema,
        authenticatedAt: z.string().datetime({ offset: true })
      })
      .strict()
  })
  .strict();
const appliedPeerRevocationStateSchema = z
  .object({
    consumerId: boundedPeerIdSchema,
    throughCursor: peerCursorSchema.refine((value) => value !== "0"),
    eventHash: peerHashSchema,
    eventCount: z.number().int().min(1).max(128),
    appliedAt: z.string().datetime({ offset: true })
  })
  .strict();

function revocationPageKey(input: {
  consumerId: string;
  afterCursor: string;
  throughCursor: string;
}) {
  const consumerHash = createHash("sha256")
    .update(input.consumerId, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `revocation_${consumerHash}_${input.afterCursor}_${input.throughCursor}`;
}

export function getAppliedPeerRevocationState(input: {
  ownerUserId: string;
  consumerId: string;
}): AppliedPeerRevocationState | null {
  const ownerUserId = boundedPeerIdSchema.parse(input.ownerUserId);
  const consumerId = boundedPeerIdSchema.parse(input.consumerId);
  const row = getDatabase()
    .prepare(
      `SELECT response_json
       FROM peer_idempotency_records
       WHERE owner_user_id = ? AND operation_id = ?
         AND json_extract(response_json, '$.consumerId') = ?
       ORDER BY length(json_extract(response_json, '$.throughCursor')) DESC,
                json_extract(response_json, '$.throughCursor') DESC
       LIMIT 1`
    )
    .get(ownerUserId, REVOCATION_APPLY_OPERATION, consumerId) as
    | { response_json: string }
    | undefined;
  if (!row) return null;
  const parsed = appliedPeerRevocationStateSchema.parse(
    JSON.parse(row.response_json) as unknown
  );
  return {
    consumerId: parsed.consumerId,
    throughCursor: parsed.throughCursor,
    eventHash: parsed.eventHash,
    appliedAt: parsed.appliedAt
  };
}

export function applyAuthenticatedPeerRevocationPage(input: {
  ownerUserId: string;
  consumerId: string;
  afterCursor: string;
  page: AuthenticatedPeerRevocationPage;
  now?: Date;
}): AppliedPeerRevocationPage {
  const ownerUserId = boundedPeerIdSchema.parse(input.ownerUserId);
  const consumerId = boundedPeerIdSchema.parse(input.consumerId);
  const afterCursor = peerCursorSchema.parse(input.afterCursor);
  const page = authenticatedPeerRevocationPageSchema.parse(input.page);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Peer revocation apply timestamp is invalid.");
  }
  if (
    page.provenance.ownerUserId !== ownerUserId ||
    page.acknowledgedCursor !== afterCursor ||
    Date.parse(page.provenance.authenticatedAt) > now.getTime()
  ) {
    throw new Error("Peer revocation page is outside its exact owner cursor.");
  }
  const expectedNext = BigInt(afterCursor) + BigInt(page.events.length);
  if (page.nextCursor !== expectedNext.toString()) {
    throw new Error("Peer revocation page next cursor is inconsistent.");
  }
  for (let index = 0; index < page.events.length; index += 1) {
    const event = page.events[index]!;
    const expectedCursor = BigInt(afterCursor) + BigInt(index + 1);
    const expectedPreviousHash =
      index === 0 ? null : page.events[index - 1]!.eventHash;
    if (
      event.cursor !== expectedCursor.toString() ||
      (expectedPreviousHash !== null &&
        event.previousEventHash !== expectedPreviousHash) ||
      Date.parse(event.occurredAt) > Date.parse(page.provenance.authenticatedAt)
    ) {
      throw new Error("Peer revocation page hash chain is not contiguous.");
    }
  }
  if (
    afterCursor === "0" &&
    page.events[0]!.previousEventHash !== "0".repeat(64)
  ) {
    throw new Error("Peer revocation page does not start at the chain root.");
  }

  const throughCursor = page.nextCursor;
  const eventHash = page.events.at(-1)!.eventHash;
  const idempotencyKey = revocationPageKey({
    consumerId,
    afterCursor,
    throughCursor
  });
  const requestHash = hashPeerApiValue({
    ownerUserId,
    consumerId,
    afterCursor,
    page
  });
  return runInTransaction(() => {
    const existing = getDatabase()
      .prepare(
        `SELECT request_hash, response_json
         FROM peer_idempotency_records
         WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ?`
      )
      .get(ownerUserId, REVOCATION_APPLY_OPERATION, idempotencyKey) as
      | { request_hash: string; response_json: string }
      | undefined;
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new Error(
          "Peer revocation page replay conflicts with its checkpoint."
        );
      }
      const checkpoint = appliedPeerRevocationStateSchema.parse(
        JSON.parse(existing.response_json) as unknown
      );
      return { ...checkpoint, replayed: true };
    }

    const owner = getDatabase()
      .prepare(`SELECT id FROM users WHERE id = ?`)
      .get(ownerUserId) as { id: string } | undefined;
    if (!owner) throw new Error("Peer revocation owner does not exist.");
    const prior = getAppliedPeerRevocationState({ ownerUserId, consumerId });
    if (
      (afterCursor === "0" && prior !== null) ||
      (afterCursor !== "0" &&
        (prior?.throughCursor !== afterCursor ||
          prior.eventHash !== page.events[0]!.previousEventHash))
    ) {
      throw new Error(
        "Peer revocation page does not extend local applied state."
      );
    }

    const relationshipRows = getDatabase()
      .prepare(
        `SELECT id, remote_principal_id
         FROM peer_relationships
         WHERE owner_user_id = ? AND id IN (${[
           ...new Set(page.events.map((event) => event.relationshipId))
         ]
           .map(() => "?")
           .join(", ")})`
      )
      .all(
        ownerUserId,
        ...new Set(page.events.map((event) => event.relationshipId))
      ) as Array<{ id: string; remote_principal_id: string }>;
    const relationships = new Map(
      relationshipRows.map((row) => [row.id, row.remote_principal_id])
    );
    if (
      relationships.size !==
      new Set(page.events.map((event) => event.relationshipId)).size
    ) {
      throw new Error(
        "Peer revocation page references another owner or relationship."
      );
    }

    for (const event of page.events) {
      const signingDevice = getDatabase()
        .prepare(
          `SELECT devices.certificate_hash
           FROM forge_devices AS devices
           JOIN peer_relationship_devices AS relationship_device
             ON relationship_device.device_id = devices.id
            AND relationship_device.owner_user_id = devices.owner_user_id
           WHERE devices.owner_user_id = ? AND devices.id = ?
             AND relationship_device.relationship_id = ?`
        )
        .get(ownerUserId, event.signingDeviceId, event.relationshipId) as
        | { certificate_hash: string | null }
        | undefined;
      if (
        !signingDevice ||
        signingDevice.certificate_hash !== event.signingCertificateHash
      ) {
        throw new Error("Peer revocation signing device is not locally bound.");
      }
      if (
        event.source === "authenticated_peer" &&
        (relationships.get(event.relationshipId) !==
          event.authenticatedRemotePrincipalId ||
          !getDatabase()
            .prepare(
              `SELECT 1 FROM peer_relationship_devices
               WHERE owner_user_id = ? AND relationship_id = ? AND device_id = ?
                 AND principal_role = 'remote'`
            )
            .get(
              ownerUserId,
              event.relationshipId,
              event.authenticatedRemoteDeviceId
            ))
      ) {
        throw new Error("Peer revocation remote source is not locally bound.");
      }
      if (event.deviceId !== null) {
        const target = getDatabase()
          .prepare(
            `SELECT certificate_hash, certificate_serial
             FROM forge_devices WHERE owner_user_id = ? AND id = ?`
          )
          .get(ownerUserId, event.deviceId) as
          | {
              certificate_hash: string | null;
              certificate_serial: string | null;
            }
          | undefined;
        if (
          target &&
          (target.certificate_hash !== event.targetCertificateHash ||
            target.certificate_serial !== event.targetCertificateSerial)
        ) {
          throw new Error(
            "Peer revocation target certificate is not locally bound."
          );
        }
      }
    }

    const appliedAt = now.toISOString();
    const invalidateCache = (relationshipId: string, grantId?: string) => {
      getDatabase()
        .prepare(
          `UPDATE peer_remote_records
           SET encrypted_payload = randomblob(length(encrypted_payload)),
               query_metadata_json = '{}', next_event_at = NULL,
               cache_state = 'revoked', revoked_at = COALESCE(revoked_at, ?),
               updated_at = ?
           WHERE owner_user_id = ? AND relationship_id = ?
             ${grantId === undefined ? "" : "AND grant_id = ?"}
             AND cache_state NOT IN ('revoked', 'withdrawn')`
        )
        .run(
          appliedAt,
          appliedAt,
          ownerUserId,
          relationshipId,
          ...(grantId === undefined ? [] : [grantId])
        );
    };

    for (const event of page.events) {
      if (event.kind === "grant") {
        getDatabase()
          .prepare(
            `UPDATE peer_grant_verifications
             SET verification_result = 'invalid', failure_reason = 'grant revoked'
             WHERE owner_user_id = ? AND relationship_id = ? AND grant_id = ?
               AND verification_result = 'valid'`
          )
          .run(ownerUserId, event.relationshipId, event.grantId);
        invalidateCache(event.relationshipId, event.grantId!);
        getDatabase()
          .prepare(
            `UPDATE peer_command_journal
             SET authorization_state = 'invalidated', invalidated_at = ?,
                 invalidation_reason = 'grant revoked', updated_at = ?
             WHERE owner_user_id = ? AND target_id = ? AND status != 'applied'
               AND authorization_state = 'approved'`
          )
          .run(appliedAt, appliedAt, ownerUserId, event.grantId);
      } else if (
        event.kind === "device" ||
        event.kind === "credential_retirement"
      ) {
        getDatabase()
          .prepare(
            `UPDATE peer_relationship_devices
             SET status = CASE WHEN status = 'compromised' THEN status ELSE 'revoked' END,
                 removed_at = COALESCE(removed_at, ?), updated_at = ?
             WHERE owner_user_id = ? AND relationship_id = ? AND device_id = ?
               AND status NOT IN ('removed', 'revoked')`
          )
          .run(
            appliedAt,
            appliedAt,
            ownerUserId,
            event.relationshipId,
            event.deviceId
          );
        getDatabase()
          .prepare(
            `UPDATE forge_devices
             SET status = CASE WHEN status = 'compromised' THEN status ELSE 'revoked' END,
                 revoked_at = COALESCE(revoked_at, ?), updated_at = ?
             WHERE owner_user_id = ? AND id = ?
               AND status NOT IN ('removed', 'revoked')`
          )
          .run(appliedAt, appliedAt, ownerUserId, event.deviceId);
        getDatabase()
          .prepare(
            `UPDATE peer_grant_verifications
             SET verification_result = 'invalid', failure_reason = 'device revoked'
             WHERE owner_user_id = ? AND relationship_id = ?
               AND verification_result = 'valid'
               AND (requesting_device_id = ?
                 OR EXISTS (SELECT 1 FROM json_each(verified_signer_device_ids_json)
                            WHERE value = ?)
                 OR EXISTS (SELECT 1 FROM json_each(approved_relationship_device_ids_json)
                            WHERE value = ?))`
          )
          .run(
            ownerUserId,
            event.relationshipId,
            event.deviceId,
            event.deviceId,
            event.deviceId
          );
        getDatabase()
          .prepare(
            `UPDATE peer_command_journal
             SET authorization_state = 'invalidated', invalidated_at = ?,
                 invalidation_reason = 'device revoked', updated_at = ?
             WHERE owner_user_id = ? AND approval_device_id = ?
               AND status != 'applied' AND authorization_state = 'approved'`
          )
          .run(appliedAt, appliedAt, ownerUserId, event.deviceId);
        invalidateCache(event.relationshipId);
      } else {
        getDatabase()
          .prepare(
            `UPDATE peer_relationships
             SET status = 'revoked', revoked_at = COALESCE(revoked_at, ?),
                 updated_at = ?
             WHERE owner_user_id = ? AND id = ? AND status != 'revoked'`
          )
          .run(appliedAt, appliedAt, ownerUserId, event.relationshipId);
        getDatabase()
          .prepare(
            `UPDATE peer_relationship_devices
             SET status = CASE WHEN status = 'compromised' THEN status ELSE 'revoked' END,
                 removed_at = COALESCE(removed_at, ?), updated_at = ?
             WHERE owner_user_id = ? AND relationship_id = ?
               AND status NOT IN ('removed', 'revoked')`
          )
          .run(appliedAt, appliedAt, ownerUserId, event.relationshipId);
        getDatabase()
          .prepare(
            `UPDATE peer_grant_verifications
             SET verification_result = 'invalid', failure_reason = 'relationship revoked'
             WHERE owner_user_id = ? AND relationship_id = ?
               AND verification_result = 'valid'`
          )
          .run(ownerUserId, event.relationshipId);
        getDatabase()
          .prepare(
            `UPDATE peer_command_journal
             SET authorization_state = 'invalidated', invalidated_at = ?,
                 invalidation_reason = 'relationship revoked', updated_at = ?
             WHERE owner_user_id = ? AND target_id = ? AND status != 'applied'
               AND authorization_state = 'approved'`
          )
          .run(appliedAt, appliedAt, ownerUserId, event.relationshipId);
        invalidateCache(event.relationshipId);
      }
      recordPeerAuditEvent({
        ownerUserId,
        relationshipId: event.relationshipId,
        eventType: `authenticated_${event.kind}_revocation_applied`,
        actorClass: "system",
        outcome: "recorded",
        metadata: {
          consumerId,
          cursor: event.cursor,
          eventHash: event.eventHash,
          source: event.source,
          targetId: event.grantId ?? event.deviceId
        },
        evidence: {
          signingDeviceId: event.signingDeviceId,
          signingCertificateHash: event.signingCertificateHash,
          authenticatedRemotePrincipalId: event.authenticatedRemotePrincipalId,
          authenticatedRemoteDeviceId: event.authenticatedRemoteDeviceId
        },
        now
      });
    }

    const checkpoint = appliedPeerRevocationStateSchema.parse({
      consumerId,
      throughCursor,
      eventHash,
      eventCount: page.events.length,
      appliedAt
    });
    getDatabase()
      .prepare(
        `INSERT INTO peer_idempotency_records (
           owner_user_id, operation_id, idempotency_key, request_hash,
           response_status, response_json, created_at, expires_at
         ) VALUES (?, ?, ?, ?, 200, ?, ?, '9999-12-31T23:59:59.999Z')`
      )
      .run(
        ownerUserId,
        REVOCATION_APPLY_OPERATION,
        idempotencyKey,
        requestHash,
        canonicalJson(checkpoint),
        appliedAt
      );
    return { ...checkpoint, replayed: false };
  });
}

export function readPeerIdempotency(input: {
  ownerUserId: string;
  operationId: string;
  idempotencyKey: string;
  requestHash: string;
  secrets?: SecretsManager;
  now?: Date;
}): { status: number; response: unknown } | null {
  const row = getDatabase()
    .prepare(
      `SELECT request_hash, response_status, response_json,
              response_ciphertext, response_reference, expires_at
       FROM peer_idempotency_records
       WHERE owner_user_id = ? AND operation_id = ? AND idempotency_key = ?
         AND expires_at > ?`
    )
    .get(
      input.ownerUserId,
      input.operationId,
      input.idempotencyKey,
      (input.now ?? new Date()).toISOString()
    ) as
    | {
        request_hash: string;
        response_status: number;
        response_json: string;
        response_ciphertext: string | null;
        response_reference: string | null;
        expires_at: string;
      }
    | undefined;
  if (!row) {
    return null;
  }
  if (row.request_hash !== input.requestHash) {
    throw new Error("Idempotency key was already used for another request.");
  }
  if (row.response_ciphertext) {
    if (!input.secrets || !row.response_reference) {
      throw new Error("Encrypted peer replay material cannot be opened.");
    }
    const envelope = input.secrets.openJson<{
      version: number;
      ownerUserId: string;
      operationId: string;
      idempotencyKey: string;
      requestHash: string;
      responseReference: string;
      expiresAt: string;
      response: Record<string, unknown>;
    }>(row.response_ciphertext);
    if (
      envelope.version !== 1 ||
      envelope.ownerUserId !== input.ownerUserId ||
      envelope.operationId !== input.operationId ||
      envelope.idempotencyKey !== input.idempotencyKey ||
      envelope.requestHash !== input.requestHash ||
      envelope.responseReference !== row.response_reference ||
      envelope.expiresAt !== row.expires_at ||
      !envelope.response ||
      typeof envelope.response !== "object" ||
      Array.isArray(envelope.response)
    ) {
      throw new Error(
        "Encrypted peer replay material is bound to another command."
      );
    }
    return { status: row.response_status, response: envelope.response };
  }
  return {
    status: row.response_status,
    response: JSON.parse(row.response_json) as unknown
  };
}

export function writePeerIdempotency(input: {
  ownerUserId: string;
  operationId: string;
  idempotencyKey: string;
  requestHash: string;
  status: number;
  response: unknown;
  encryptedResponse?: {
    secrets: SecretsManager;
    reference: string;
    expiresAt: string;
  };
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const encrypted = input.encryptedResponse;
  const responseJson = encrypted
    ? canonicalJson({ encryptedResponseReference: encrypted.reference })
    : canonicalJson(input.response);
  if (Buffer.byteLength(responseJson, "utf8") > 1_048_576) {
    throw new Error("Idempotent peer response is too large to store.");
  }
  const expiresAt =
    encrypted?.expiresAt ??
    new Date(now.getTime() + 7 * 86_400_000).toISOString();
  if (Date.parse(expiresAt) <= now.getTime()) {
    throw new Error("Idempotent peer response must expire in the future.");
  }
  let responseCiphertext: string | null = null;
  if (encrypted) {
    if (
      !input.response ||
      typeof input.response !== "object" ||
      Array.isArray(input.response)
    ) {
      throw new Error("Encrypted peer replay responses must be JSON objects.");
    }
    responseCiphertext = encrypted.secrets.sealJson({
      version: 1,
      ownerUserId: input.ownerUserId,
      operationId: input.operationId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      responseReference: encrypted.reference,
      expiresAt,
      response: input.response as Record<string, unknown>
    });
  }
  getDatabase()
    .prepare(
      `INSERT INTO peer_idempotency_records (
         owner_user_id, operation_id, idempotency_key, request_hash,
         response_status, response_json, response_ciphertext,
         response_reference, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.ownerUserId,
      input.operationId,
      input.idempotencyKey,
      input.requestHash,
      input.status,
      responseJson,
      responseCiphertext,
      encrypted?.reference ?? null,
      now.toISOString(),
      expiresAt
    );
}

export function createPeerInvitationRecord(input: {
  ownerUserId: string;
  invitation: PeerPairingInvite;
  bootstrapCiphertext: Uint8Array;
  bootstrapNonce: Uint8Array;
  bootstrapHash: string;
  maximumAttempts?: number;
  now?: Date;
}) {
  const invitation = peerPairingInviteSchema.parse(input.invitation);
  if (invitation.ownerUserId !== input.ownerUserId) {
    throw new Error("Peer invitation owner does not match the local owner.");
  }
  const now = (input.now ?? new Date()).toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO peer_pairing_invites (
         id, owner_user_id, inviter_principal_id, inviter_device_id, status,
         bootstrap_ciphertext, bootstrap_nonce, bootstrap_hash,
         invitation_fingerprint, protocol_version, transport_kinds_json,
         monotonic_sequence, failed_attempt_count, maximum_attempts, expires_at,
         claimed_at, consumed_at, canceled_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, NULL, NULL, NULL, ?, ?)`
    )
    .run(
      invitation.id,
      input.ownerUserId,
      invitation.inviterPrincipalId,
      invitation.inviterDeviceId,
      Buffer.from(input.bootstrapCiphertext),
      Buffer.from(input.bootstrapNonce),
      input.bootstrapHash,
      invitation.fingerprint,
      invitation.protocolVersion,
      JSON.stringify(invitation.transportKinds),
      input.maximumAttempts ?? 5,
      invitation.expiresAt,
      now,
      now
    );
  return invitation;
}

export function getPeerInvitationStatus(
  ownerUserId: string,
  invitationId: string,
  now: Date = new Date()
) {
  const row = getDatabase()
    .prepare(
      `SELECT id, status, invitation_fingerprint AS fingerprint,
              protocol_version AS protocolVersion,
              transport_kinds_json AS transportKindsJson,
              failed_attempt_count AS failedAttemptCount,
              maximum_attempts AS maximumAttempts, expires_at AS expiresAt,
              claimed_at AS claimedAt, consumed_at AS consumedAt,
              canceled_at AS canceledAt, created_at AS createdAt,
              updated_at AS updatedAt
       FROM peer_pairing_invites
       WHERE id = ? AND owner_user_id = ?`
    )
    .get(invitationId, ownerUserId) as
    | (Record<string, unknown> & {
        status: string;
        expiresAt: string;
        transportKindsJson: string;
      })
    | undefined;
  if (!row) {
    return null;
  }
  const { transportKindsJson, ...invitation } = row;
  const status =
    row.status === "active" && Date.parse(row.expiresAt) <= now.getTime()
      ? "expired"
      : row.status;
  return {
    ...invitation,
    status,
    transportKinds: JSON.parse(transportKindsJson) as string[]
  };
}

export function cancelPeerInvitationRecord(input: {
  ownerUserId: string;
  invitationId: string;
  now?: Date;
}) {
  const now = (input.now ?? new Date()).toISOString();
  return (
    getDatabase()
      .prepare(
        `UPDATE peer_pairing_invites
         SET status = 'canceled', canceled_at = ?, updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND status IN ('active', 'claimed')
           AND consumed_at IS NULL AND expires_at > ?`
      )
      .run(now, now, input.invitationId, input.ownerUserId, now).changes === 1
  );
}

export function createPeerPendingRequest(input: {
  ownerUserId: string;
  relationshipId?: string | null;
  kind: PeerPendingRequest["kind"];
  payload: Record<string, unknown>;
  expiresAt: string;
  id?: string;
  now?: Date;
}) {
  const payloadJson = canonicalJson(input.payload);
  if (Buffer.byteLength(payloadJson, "utf8") > 1_048_576) {
    throw new Error("Pending peer request payload exceeds one MiB.");
  }
  const now = (input.now ?? new Date()).toISOString();
  if (Date.parse(input.expiresAt) <= Date.parse(now)) {
    throw new Error("Pending peer request must expire in the future.");
  }
  const id = input.id ?? `ppr_${randomUUID().replaceAll("-", "")}`;
  getDatabase()
    .prepare(
      `INSERT INTO peer_pending_requests (
         id, owner_user_id, relationship_id, request_kind, status, version,
         payload_json, payload_hash, expires_at, decided_at, decision_reason,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'pending', 1, ?, ?, ?, NULL, '', ?, ?)`
    )
    .run(
      id,
      input.ownerUserId,
      input.relationshipId ?? null,
      input.kind,
      payloadJson,
      createHash("sha256").update(payloadJson).digest("hex"),
      input.expiresAt,
      now,
      now
    );
  return getPeerPendingRequest(input.ownerUserId, id)!;
}

export function getPeerPendingRequest(ownerUserId: string, requestId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT id, owner_user_id, relationship_id, request_kind, status,
              version, payload_json, payload_hash, expires_at, decided_at,
              decision_reason, created_at, updated_at
       FROM peer_pending_requests
       WHERE id = ? AND owner_user_id = ?`
    )
    .get(requestId, ownerUserId) as RequestSqlRow | undefined;
  return row ? mapRequest(row) : null;
}

export function listPeerPendingRequests(input: {
  ownerUserId: string;
  kind?: PeerPendingRequest["kind"];
  status?: PeerPendingRequest["status"];
  limit: number;
  before?: { createdAt: string; id: string } | null;
  now?: Date;
}) {
  const conditions = ["owner_user_id = ?"];
  const parameters: Array<string | number> = [input.ownerUserId];
  if (input.kind) {
    conditions.push("request_kind = ?");
    parameters.push(input.kind);
  }
  if (input.status) {
    conditions.push("status = ?");
    parameters.push(input.status);
  }
  if (input.before) {
    conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
    parameters.push(
      input.before.createdAt,
      input.before.createdAt,
      input.before.id
    );
  }
  const rows = getDatabase()
    .prepare(
      `SELECT id, owner_user_id, relationship_id, request_kind,
              CASE WHEN status = 'pending' AND expires_at <= ? THEN 'expired' ELSE status END AS status,
              version, payload_json, payload_hash, expires_at, decided_at,
              decision_reason, created_at, updated_at
       FROM peer_pending_requests
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(
      (input.now ?? new Date()).toISOString(),
      ...parameters,
      input.limit + 1
    ) as RequestSqlRow[];
  return rows.map(mapRequest);
}

export function decidePeerPendingRequest(input: {
  ownerUserId: string;
  requestId: string;
  expectedVersion: number;
  decision: "accepted" | "rejected";
  reason?: string;
  now?: Date;
}) {
  const now = (input.now ?? new Date()).toISOString();
  return runInTransaction(() => {
    const request = getPeerPendingRequest(input.ownerUserId, input.requestId);
    if (!request || request.status !== "pending") {
      return null;
    }
    if (request.version !== input.expectedVersion) {
      throw new Error("Pending peer request version changed.");
    }
    if (Date.parse(request.expiresAt) <= Date.parse(now)) {
      return null;
    }
    const changed = getDatabase()
      .prepare(
        `UPDATE peer_pending_requests
         SET status = ?, version = version + 1, decided_at = ?,
             decision_reason = ?, updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND status = 'pending'
           AND version = ? AND expires_at > ?`
      )
      .run(
        input.decision,
        now,
        input.reason ?? "",
        now,
        input.requestId,
        input.ownerUserId,
        input.expectedVersion,
        now
      ).changes;
    return changed === 1
      ? getPeerPendingRequest(input.ownerUserId, input.requestId)
      : null;
  });
}

export function listPeerRelationships(input: {
  ownerUserId: string;
  status?: PeerRelationshipRow["status"];
  query?: string;
  limit: number;
  before?: { updatedAt: string; id: string } | null;
}) {
  const conditions = ["relationships.owner_user_id = ?"];
  const parameters: Array<string | number> = [input.ownerUserId];
  if (input.status) {
    conditions.push("relationships.status = ?");
    parameters.push(input.status);
  }
  if (input.query?.trim()) {
    conditions.push("LOWER(remote.display_label) LIKE ? ESCAPE '\\'");
    parameters.push(
      `%${input.query
        .trim()
        .toLocaleLowerCase("und")
        .replace(/[\\%_]/g, "\\$&")}%`
    );
  }
  if (input.before) {
    conditions.push(
      "(relationships.updated_at < ? OR (relationships.updated_at = ? AND relationships.id < ?))"
    );
    parameters.push(
      input.before.updatedAt,
      input.before.updatedAt,
      input.before.id
    );
  }
  const rows = getDatabase()
    .prepare(
      `SELECT ${RELATIONSHIP_SELECT}
       FROM peer_relationships AS relationships
       JOIN forge_principals AS remote
         ON remote.id = relationships.remote_principal_id
        AND remote.owner_user_id = relationships.owner_user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY relationships.updated_at DESC, relationships.id DESC
       LIMIT ?`
    )
    .all(...parameters, input.limit + 1) as RelationshipSqlRow[];
  return rows.map(mapRelationship);
}

export function getPeerRelationship(
  ownerUserId: string,
  relationshipId: string
) {
  const row = getDatabase()
    .prepare(
      `SELECT ${RELATIONSHIP_SELECT}
       FROM peer_relationships AS relationships
       JOIN forge_principals AS remote
         ON remote.id = relationships.remote_principal_id
        AND remote.owner_user_id = relationships.owner_user_id
       WHERE relationships.id = ? AND relationships.owner_user_id = ?`
    )
    .get(relationshipId, ownerUserId) as RelationshipSqlRow | undefined;
  return row ? mapRelationship(row) : null;
}

export function listPeerRelationshipDevices(
  ownerUserId: string,
  relationshipId: string
) {
  const rows = getDatabase()
    .prepare(
      `SELECT links.relationship_id, links.device_id, links.principal_role,
              links.status, devices.label, devices.device_type,
              devices.last_seen_at, links.approved_at, links.removed_at,
              links.created_at, links.updated_at
       FROM peer_relationship_devices AS links
       JOIN forge_devices AS devices
         ON devices.id = links.device_id
        AND devices.owner_user_id = links.owner_user_id
       WHERE links.owner_user_id = ? AND links.relationship_id = ?
       ORDER BY links.principal_role, links.updated_at DESC, links.device_id
       LIMIT 256`
    )
    .all(ownerUserId, relationshipId) as DeviceSqlRow[];
  return rows.map(mapDevice);
}

export function mutatePeerRelationshipDevice(input: {
  ownerUserId: string;
  relationshipId: string;
  deviceId: string;
  expectedRelationshipVersion: string;
  action: "approve" | "remove";
  now?: Date;
}) {
  const now = (input.now ?? new Date()).toISOString();
  return runInTransaction(() => {
    const relationship = getPeerRelationship(
      input.ownerUserId,
      input.relationshipId
    );
    if (!relationship) {
      return null;
    }
    if (relationship.updatedAt !== input.expectedRelationshipVersion) {
      throw new Error("Peer relationship version changed.");
    }
    const status = input.action === "approve" ? "approved" : "removed";
    const result = getDatabase()
      .prepare(
        `UPDATE peer_relationship_devices
         SET status = ?, approved_at = CASE WHEN ? = 'approved' THEN ? ELSE approved_at END,
             removed_at = CASE WHEN ? = 'removed' THEN ? ELSE NULL END,
             updated_at = ?
         WHERE owner_user_id = ? AND relationship_id = ? AND device_id = ?
           AND status ${input.action === "approve" ? "= 'pending'" : "IN ('pending', 'approved')"}`
      )
      .run(
        status,
        status,
        now,
        status,
        now,
        now,
        input.ownerUserId,
        input.relationshipId,
        input.deviceId
      );
    if (result.changes !== 1) {
      return null;
    }
    getDatabase()
      .prepare(
        `UPDATE peer_relationships SET updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND updated_at = ?`
      )
      .run(
        now,
        input.relationshipId,
        input.ownerUserId,
        input.expectedRelationshipVersion
      );
    return (
      listPeerRelationshipDevices(input.ownerUserId, input.relationshipId).find(
        (device) => device.deviceId === input.deviceId
      ) ?? null
    );
  });
}

export function revokePeerRelationshipRecord(input: {
  ownerUserId: string;
  relationshipId: string;
  expectedVersion: string;
  reason: string;
  purgeManagedCache: boolean;
  now?: Date;
}) {
  const now = (input.now ?? new Date()).toISOString();
  return runInTransaction(() => {
    const changed = getDatabase()
      .prepare(
        `UPDATE peer_relationships
         SET status = 'revoked', revoked_at = ?, updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND updated_at = ?
           AND status != 'revoked'`
      )
      .run(
        now,
        now,
        input.relationshipId,
        input.ownerUserId,
        input.expectedVersion
      ).changes;
    if (changed !== 1) {
      return null;
    }
    getDatabase()
      .prepare(
        `UPDATE peer_share_grants
         SET status = 'revoked', revoked_at = ?
         WHERE owner_user_id = ? AND relationship_id = ?
           AND status IN ('draft', 'proposed', 'active', 'countered')`
      )
      .run(now, input.ownerUserId, input.relationshipId);
    getDatabase()
      .prepare(
        `UPDATE peer_relationship_devices
         SET status = CASE WHEN status = 'compromised' THEN status ELSE 'revoked' END,
             removed_at = COALESCE(removed_at, ?), updated_at = ?
         WHERE owner_user_id = ? AND relationship_id = ?
           AND status NOT IN ('removed', 'revoked')`
      )
      .run(now, now, input.ownerUserId, input.relationshipId);
    if (input.purgeManagedCache) {
      getDatabase()
        .prepare(
          `UPDATE peer_remote_records
           SET encrypted_payload = randomblob(length(encrypted_payload)),
               cache_state = 'revoked', revoked_at = ?, updated_at = ?
           WHERE owner_user_id = ? AND relationship_id = ?
             AND cache_state NOT IN ('revoked', 'withdrawn')`
        )
        .run(now, now, input.ownerUserId, input.relationshipId);
    } else {
      getDatabase()
        .prepare(
          `UPDATE peer_remote_records
           SET cache_state = 'revoked', revoked_at = ?, updated_at = ?
           WHERE owner_user_id = ? AND relationship_id = ?
             AND cache_state NOT IN ('revoked', 'withdrawn')`
        )
        .run(now, now, input.ownerUserId, input.relationshipId);
    }
    recordPeerAuditEvent({
      ownerUserId: input.ownerUserId,
      relationshipId: input.relationshipId,
      eventType: "relationship_revoked",
      actorClass: "system",
      outcome: "recorded",
      metadata: {
        reason: input.reason,
        purgeManagedCache: input.purgeManagedCache
      },
      now: new Date(now)
    });
    return getPeerRelationship(input.ownerUserId, input.relationshipId);
  });
}

export function listPeerGrantVersions(input: {
  ownerUserId: string;
  relationshipId: string;
  status?: string;
  limit: number;
  before?: { issuedAt: string; id: string; sequence: number } | null;
}): PeerShareGrantVersion[] {
  const conditions = ["owner_user_id = ?", "relationship_id = ?"];
  const parameters: Array<string | number> = [
    input.ownerUserId,
    input.relationshipId
  ];
  if (input.status) {
    conditions.push("status = ?");
    parameters.push(input.status);
  }
  if (input.before) {
    conditions.push(
      `(issued_at < ? OR (issued_at = ? AND (id < ? OR (id = ? AND sequence < ?))))`
    );
    parameters.push(
      input.before.issuedAt,
      input.before.issuedAt,
      input.before.id,
      input.before.id,
      input.before.sequence
    );
  }
  const rows = getDatabase()
    .prepare(
      `SELECT canonical_grant_json
       FROM peer_share_grants
       WHERE ${conditions.join(" AND ")}
       ORDER BY issued_at DESC, id DESC, sequence DESC
       LIMIT ?`
    )
    .all(...parameters, input.limit + 1) as Array<{
    canonical_grant_json: string;
  }>;
  return rows.map((row) =>
    peerShareGrantVersionSchema.parse(JSON.parse(row.canonical_grant_json))
  );
}

export function getLatestPeerGrantVersion(
  ownerUserId: string,
  grantId: string
) {
  const row = getDatabase()
    .prepare(
      `SELECT canonical_grant_json
       FROM peer_share_grants
       WHERE owner_user_id = ? AND id = ?
       ORDER BY sequence DESC LIMIT 1`
    )
    .get(ownerUserId, grantId) as { canonical_grant_json: string } | undefined;
  return row
    ? peerShareGrantVersionSchema.parse(JSON.parse(row.canonical_grant_json))
    : null;
}

export type VerifiedPeerQueryGrantEvidence = {
  grant: PeerShareGrantVersion;
  verificationId: string;
  verifiedGrantHash: string;
  verifiedSignerDeviceIds: string[];
  approvedRelationshipDeviceIds: string[];
  requestingDeviceId: string;
  verifiedAt: string;
};

export function getVerifiedPeerQueryGrantEvidence(input: {
  ownerUserId: string;
  relationshipId: string;
  grantId: string;
  grantSequence: number;
  verificationId: string;
  verifiedGrantHash: string;
}): VerifiedPeerQueryGrantEvidence | null {
  const row = getDatabase()
    .prepare(
      `SELECT grants.canonical_grant_json AS canonicalGrantJson,
              verification.id AS verificationId,
              verification.verified_grant_hash AS verifiedGrantHash,
              verification.verified_signer_device_ids_json AS verifiedSignerDeviceIdsJson,
              verification.approved_relationship_device_ids_json AS approvedDeviceIdsJson,
              verification.requesting_device_id AS requestingDeviceId,
              verification.verified_at AS verifiedAt
       FROM peer_grant_verifications AS verification
       JOIN peer_share_grants AS grants
         ON grants.id = verification.grant_id
        AND grants.sequence = verification.grant_sequence
        AND grants.owner_user_id = verification.owner_user_id
       JOIN peer_relationships AS relationships
         ON relationships.id = verification.relationship_id
        AND relationships.owner_user_id = verification.owner_user_id
       WHERE verification.id = ?
         AND verification.owner_user_id = ?
         AND verification.relationship_id = ?
         AND verification.grant_id = ?
         AND verification.grant_sequence = ?
         AND verification.verified_grant_hash = ?
         AND verification.verification_result = 'valid'
         AND verification.requesting_device_id IS NOT NULL
         AND grants.version_hash = verification.verified_grant_hash
         AND grants.direction = 'remote_to_local'
         AND relationships.status = 'active'
       LIMIT 1`
    )
    .get(
      input.verificationId,
      input.ownerUserId,
      input.relationshipId,
      input.grantId,
      input.grantSequence,
      input.verifiedGrantHash
    ) as
    | {
        canonicalGrantJson: string;
        verificationId: string;
        verifiedGrantHash: string;
        verifiedSignerDeviceIdsJson: string;
        approvedDeviceIdsJson: string;
        requestingDeviceId: string;
        verifiedAt: string;
      }
    | undefined;
  if (!row) {
    return null;
  }
  const parseDeviceIds = (value: string) => {
    const parsed = JSON.parse(value) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some((entry) => typeof entry !== "string") ||
      new Set(parsed).size !== parsed.length
    ) {
      throw new Error("Stored peer grant device evidence is invalid.");
    }
    return parsed;
  };
  return {
    grant: peerShareGrantVersionSchema.parse(
      JSON.parse(row.canonicalGrantJson)
    ),
    verificationId: row.verificationId,
    verifiedGrantHash: row.verifiedGrantHash,
    verifiedSignerDeviceIds: parseDeviceIds(row.verifiedSignerDeviceIdsJson),
    approvedRelationshipDeviceIds: parseDeviceIds(row.approvedDeviceIdsJson),
    requestingDeviceId: row.requestingDeviceId,
    verifiedAt: row.verifiedAt
  };
}

export function insertPeerGrantVersion(grantInput: PeerShareGrantVersion) {
  const grant = peerShareGrantVersionSchema.parse(grantInput);
  return runInTransaction(() => {
    getDatabase()
      .prepare(
        `INSERT INTO peer_share_grants (
           id, sequence, owner_user_id, relationship_id, direction, status,
           previous_version_hash, version_hash, label, purpose,
           canonical_grant_json, cache_policy_json, signatures_json,
           verification_evidence_json, protocol_version, schema_version,
           issued_at, accepted_at, effective_at, expires_at, revoked_at,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        grant.id,
        grant.sequence,
        grant.ownerUserId,
        grant.relationshipId,
        grant.direction,
        grant.status,
        grant.previousVersionHash,
        hashPeerGrantVersion(grant),
        grant.label,
        grant.purpose,
        canonicalJson(grant),
        canonicalJson(grant.cachePolicy),
        canonicalJson(grant.signatures),
        grant.protocolVersion,
        grant.schemaVersion,
        grant.issuedAt,
        grant.status === "active" ? grant.issuedAt : null,
        grant.effectiveAt,
        grant.expiresAt,
        grant.revokedAt,
        grant.issuedAt
      );
    const insertRule = getDatabase().prepare(
      `INSERT INTO peer_share_rules (
         grant_id, grant_sequence, owner_user_id, id, rule_position,
         projection_id, projection_version, effect, entity_selector_json,
         field_policy_json, time_policy_json, precision,
         aggregation_policy_json, approved_device_ids_json, device_policy,
         maximum_result_count, maximum_payload_bytes, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const [position, rule] of grant.rules.entries()) {
      insertRule.run(
        grant.id,
        grant.sequence,
        grant.ownerUserId,
        rule.id,
        position,
        rule.projectionId,
        rule.effect,
        rule.entitySelector === null
          ? null
          : canonicalJson(rule.entitySelector),
        canonicalJson(rule.fields),
        canonicalJson(rule.time),
        rule.precision,
        rule.aggregation === null ? null : canonicalJson(rule.aggregation),
        canonicalJson(rule.approvedDeviceIds),
        rule.devicePolicy,
        rule.maximumResultCount,
        rule.maximumPayloadBytes,
        grant.issuedAt
      );
    }
    return grant;
  });
}

export function getPeerSyncStatus(ownerUserId: string, relationshipId: string) {
  const relationship = getPeerRelationship(ownerUserId, relationshipId);
  if (!relationship) {
    return null;
  }
  const counts = getDatabase()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM peer_outbox WHERE owner_user_id = ? AND relationship_id = ? AND status IN ('pending', 'in_flight', 'failed')) AS pendingOutbox,
         (SELECT COUNT(*) FROM peer_inbox WHERE owner_user_id = ? AND relationship_id = ? AND processing_state IN ('pending', 'processing')) AS pendingInbox,
         (SELECT COUNT(*) FROM peer_remote_records WHERE owner_user_id = ? AND relationship_id = ? AND cache_state = 'current') AS currentRemoteRecords,
         (SELECT COUNT(*) FROM peer_remote_records WHERE owner_user_id = ? AND relationship_id = ? AND cache_state IN ('stale', 'key_unavailable')) AS staleRemoteRecords`
    )
    .get(
      ownerUserId,
      relationshipId,
      ownerUserId,
      relationshipId,
      ownerUserId,
      relationshipId,
      ownerUserId,
      relationshipId
    ) as Record<string, number>;
  return { relationship, ...counts };
}

export function listPeerDiagnostics(input: {
  ownerUserId: string;
  relationshipId: string;
  limit: number;
  before?: { createdAt: string; id: string } | null;
}) {
  const parameters: Array<string | number> = [
    input.ownerUserId,
    input.relationshipId
  ];
  const cursor = input.before
    ? "AND (created_at < ? OR (created_at = ? AND id < ?))"
    : "";
  if (input.before) {
    parameters.push(
      input.before.createdAt,
      input.before.createdAt,
      input.before.id
    );
  }
  return getDatabase()
    .prepare(
      `SELECT id, event_type AS eventType, actor_class AS actorClass,
              outcome, metadata_json AS metadataJson, created_at AS createdAt
       FROM peer_audit_events
       WHERE owner_user_id = ? AND relationship_id = ? ${cursor}
       ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(...parameters, input.limit + 1)
    .map((row) => {
      const typed = row as { metadataJson: string } & Record<string, unknown>;
      const { metadataJson, ...diagnostic } = typed;
      return {
        ...diagnostic,
        metadata: JSON.parse(metadataJson)
      };
    });
}

export function recordPeerAuditEvent(input: {
  ownerUserId: string;
  relationshipId?: string | null;
  eventType: string;
  actorClass:
    | "operator_session"
    | "agent_token"
    | "companion_session"
    | "companion_consent"
    | "peer_device"
    | "local_service"
    | "system";
  actorId?: string | null;
  deviceId?: string | null;
  outcome: "recorded" | "allowed" | "denied" | "failed";
  metadata?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  now?: Date;
}) {
  const metadataJson = canonicalJson(input.metadata ?? {});
  const evidenceJson = canonicalJson(input.evidence ?? {});
  if (
    Buffer.byteLength(metadataJson, "utf8") > 32_768 ||
    Buffer.byteLength(evidenceJson, "utf8") > 262_144
  ) {
    throw new Error("Peer audit payload exceeds its storage bound.");
  }
  getDatabase()
    .prepare(
      `INSERT INTO peer_audit_events (
         id, owner_user_id, relationship_id, event_type, actor_class,
         actor_id, device_id, outcome, metadata_json, evidence_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `pae_${randomUUID().replaceAll("-", "")}`,
      input.ownerUserId,
      input.relationshipId ?? null,
      input.eventType,
      input.actorClass,
      input.actorId ?? null,
      input.deviceId ?? null,
      input.outcome,
      metadataJson,
      evidenceJson,
      (input.now ?? new Date()).toISOString()
    );
}

export function listPersonPeerQuestionHistory(input: {
  ownerUserId: string;
  personId: string;
  limit: number;
  before?: { createdAt: string; id: string } | null;
}) {
  const parameters: Array<string | number> = [
    input.ownerUserId,
    input.personId
  ];
  const cursor = input.before
    ? "AND (created_at < ? OR (created_at = ? AND id < ?))"
    : "";
  if (input.before) {
    parameters.push(
      input.before.createdAt,
      input.before.createdAt,
      input.before.id
    );
  }
  return getDatabase()
    .prepare(
      `SELECT id, projection_id AS projectionId, requester_class AS requesterClass,
              decision, decision_reason AS decisionReason,
              result_count AS resultCount, duration_ms AS durationMs,
              created_at AS createdAt
       FROM peer_query_audit
       WHERE owner_user_id = ? AND person_id = ? ${cursor}
       ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(...parameters, input.limit + 1);
}
