import { createHash, createHmac, randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import { HttpError } from "../errors.js";
import { recordEventLog } from "../repositories/event-log.js";
import {
  createArtifactFromUpload,
  decodeArtifactUploadBase64,
  readArtifactDownload,
  type ArtifactContext
} from "../services/artifacts.js";
import { verifyAgentMessageMedia } from "./media.js";
import {
  AGENT_MESSAGE_DEFAULT_RETENTION_DAYS,
  AGENT_MESSAGE_MAX_VOICE_BYTES,
  AGENT_MESSAGE_RESERVATION_TTL_HOURS,
  INBOX_ACTIVITY_EVENT_KINDS,
  type AgentMessageEventKind,
  type AgentMessageStatus
} from "./types.js";

type MessageRow = {
  id: string;
  owner_user_id: string;
  sender_kind: "human_user" | "agent" | "system";
  sender_user_id: string | null;
  sender_agent_id: string | null;
  sender_label: string;
  initial_recipient_agent_id: string;
  initial_recipient_label: string;
  recipient_agent_id: string;
  recipient_label: string;
  forwarded_from_message_id: string | null;
  retried_from_message_id: string | null;
  body_text: string;
  voice_artifact_id: string | null;
  voice_mime_type: string;
  voice_byte_size: number | null;
  voice_declared_duration_ms: number | null;
  voice_verified_duration_ms: number | null;
  sensitivity: "sensitive_media";
  status: AgentMessageStatus;
  revision: number;
  progress_summary: string;
  result_markdown: string;
  transcript_text: string;
  transcript_provider: string;
  transcript_disclosure: string;
  failure_code: string;
  failure_message: string;
  claim_secret_digest: string | null;
  claimed_by_agent_id: string | null;
  claim_generation: number;
  claimed_at: string | null;
  claim_renewed_at: string | null;
  claim_expires_at: string | null;
  client_idempotency_key: string;
  request_fingerprint: string;
  retention_until: string;
  deleted_at: string | null;
  delivered_at: string;
  acknowledged_at: string | null;
  handled_at: string | null;
  failed_at: string | null;
  forwarded_at: string | null;
  created_at: string;
  updated_at: string;
};

type ReservationRow = {
  id: string;
  owner_user_id: string;
  upload_idempotency_key: string;
  request_fingerprint: string;
  status: "pending" | "active" | "consumed" | "expired";
  artifact_id: string | null;
  original_file_name: string;
  declared_mime_type: string;
  verified_mime_type: string;
  verified_container: string;
  verified_codec: string;
  byte_size: number | null;
  content_sha256: string | null;
  declared_duration_ms: number | null;
  verified_duration_ms: number | null;
  parser_name: string;
  parser_version: string;
  expires_at: string;
  consumed_message_id: string | null;
  created_at: string;
  updated_at: string;
};

type ReceiptRow = {
  request_fingerprint: string;
  response_json: string;
};

export type AgentMessageActor = {
  kind: "human_user" | "agent" | "system";
  id: string | null;
  label: string;
  source: "ui" | "agent" | "openclaw" | "system";
};

export type ConnectedAgent = {
  id: string;
  label: string;
  provider: string | null;
  agentType: string;
  connected: boolean;
  lastSeenAt: string | null;
};

function id(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function leaseDigest(secret: string, key: Buffer) {
  return createHmac("sha256", key)
    .update("forge-agent-message-lease/v1\0", "utf8")
    .update(secret, "utf8")
    .digest("hex");
}

function nowIso(now = new Date()) {
  return now.toISOString();
}

function inImmediateTransaction<T>(callback: () => T): T {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function messagePublic(row: MessageRow, unreadSequence?: number | null) {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    sender: {
      kind: row.sender_kind,
      userId: row.sender_user_id,
      agentId: row.sender_agent_id,
      label: row.sender_label
    },
    initialRecipient: {
      agentId: row.initial_recipient_agent_id,
      label: row.initial_recipient_label
    },
    recipient: {
      agentId: row.recipient_agent_id,
      label: row.recipient_label
    },
    forwardedFromMessageId: row.forwarded_from_message_id,
    retriedFromMessageId: row.retried_from_message_id,
    bodyText: row.body_text,
    voiceArtifact: row.voice_artifact_id
      ? {
          id: row.voice_artifact_id,
          mimeType: row.voice_mime_type,
          byteSize: row.voice_byte_size,
          declaredDurationMs: row.voice_declared_duration_ms,
          verifiedDurationMs: row.voice_verified_duration_ms,
          sensitivity: row.sensitivity
        }
      : null,
    status: row.status,
    revision: row.revision,
    progressSummary: row.progress_summary,
    resultMarkdown: row.result_markdown,
    transcript: row.transcript_text
      ? {
          text: row.transcript_text,
          provider: row.transcript_provider,
          disclosure: row.transcript_disclosure
        }
      : null,
    failure: row.failure_code
      ? { code: row.failure_code, message: row.failure_message }
      : null,
    claim: row.claimed_by_agent_id
      ? {
          agentId: row.claimed_by_agent_id,
          generation: row.claim_generation,
          claimedAt: row.claimed_at,
          renewedAt: row.claim_renewed_at,
          expiresAt: row.claim_expires_at
        }
      : null,
    unreadInboxEventSequence: unreadSequence ?? null,
    retentionUntil: row.retention_until,
    deletedAt: row.deleted_at,
    deliveredAt: row.delivered_at,
    acknowledgedAt: row.acknowledged_at,
    handledAt: row.handled_at,
    failedAt: row.failed_at,
    forwardedAt: row.forwarded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function reservationPublic(row: ReservationRow) {
  return {
    id: row.id,
    status: row.status,
    artifactId: row.artifact_id,
    originalFileName: row.original_file_name,
    declaredMimeType: row.declared_mime_type,
    verifiedMimeType: row.verified_mime_type || null,
    verifiedContainer: row.verified_container || null,
    verifiedCodec: row.verified_codec || null,
    byteSize: row.byte_size,
    contentSha256: row.content_sha256,
    declaredDurationMs: row.declared_duration_ms,
    verifiedDurationMs: row.verified_duration_ms,
    parser:
      row.parser_name && row.parser_version
        ? { name: row.parser_name, version: row.parser_version }
        : null,
    expiresAt: row.expires_at,
    consumedMessageId: row.consumed_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function requireMessage(messageId: string): MessageRow {
  const row = getDatabase()
    .prepare("SELECT * FROM agent_messages WHERE id = ?")
    .get(messageId) as MessageRow | undefined;
  if (!row) {
    throw new HttpError(404, "agent_message_not_found", "Agent Message not found.");
  }
  return row;
}

function requireOwnerMessage(messageId: string, ownerUserId: string) {
  const row = requireMessage(messageId);
  if (row.owner_user_id !== ownerUserId || row.deleted_at) {
    throw new HttpError(404, "agent_message_not_found", "Agent Message not found.");
  }
  return row;
}

function agentForOwner(agentId: string, ownerUserId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT identities.id, identities.label, identities.agent_type, identities.provider
       FROM agent_identities identities
       JOIN agent_identity_users links ON links.agent_id = identities.id
       WHERE identities.id = ? AND links.user_id = ?
       LIMIT 1`
    )
    .get(agentId, ownerUserId) as
    | { id: string; label: string; agent_type: string; provider: string | null }
    | undefined;
  if (!row) {
    throw new HttpError(
      400,
      "agent_message_recipient_invalid",
      "Select an agent connected to this Forge owner."
    );
  }
  return row;
}

export function listConnectedAgents(ownerUserId: string): ConnectedAgent[] {
  const now = new Date().toISOString();
  const rows = getDatabase()
    .prepare(
      `SELECT identities.id, identities.label, identities.agent_type, identities.provider,
              MAX(sessions.last_seen_at) AS last_seen_at,
              MAX(CASE
                WHEN sessions.status = 'connected'
                 AND sessions.ended_at IS NULL
                 AND datetime(sessions.last_heartbeat_at, '+' || sessions.stale_after_seconds || ' seconds') > datetime(?)
                THEN 1 ELSE 0 END) AS connected
       FROM agent_identities identities
       JOIN agent_identity_users links ON links.agent_id = identities.id
       LEFT JOIN agent_runtime_sessions sessions ON sessions.agent_id = identities.id
       WHERE links.user_id = ?
       GROUP BY identities.id
       ORDER BY connected DESC, lower(identities.label), identities.id`
    )
    .all(now, ownerUserId) as Array<{
    id: string;
    label: string;
    agent_type: string;
    provider: string | null;
    last_seen_at: string | null;
    connected: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    provider: row.provider,
    agentType: row.agent_type,
    connected: row.connected === 1,
    lastSeenAt: row.last_seen_at
  }));
}

export function getAgentMessageSettings(ownerUserId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT defaults.default_agent_id, identities.label
       FROM agent_message_defaults defaults
       JOIN agent_identities identities ON identities.id = defaults.default_agent_id
       WHERE defaults.owner_user_id = ?`
    )
    .get(ownerUserId) as
    | { default_agent_id: string; label: string }
    | undefined;
  return {
    defaultAgent: row
      ? { id: row.default_agent_id, label: row.label }
      : null,
    retentionDays: AGENT_MESSAGE_DEFAULT_RETENTION_DAYS,
    voice: {
      maximumBytes: AGENT_MESSAGE_MAX_VOICE_BYTES,
      maximumDurationMs: 600_000,
      cellularThresholdBytes: 5 * 1024 * 1024,
      supportedMimeTypes: [
        "audio/mp4",
        "audio/aac",
        "audio/mpeg",
        "audio/wav",
        "audio/webm",
        "audio/ogg"
      ]
    },
    backgroundDelivery:
      "Forge schedules queued uploads, but iOS decides when background work runs."
  };
}

export function updateAgentMessageSettings(input: {
  ownerUserId: string;
  defaultAgentId: string;
  actor: AgentMessageActor;
  now?: Date;
}) {
  const agent = agentForOwner(input.defaultAgentId, input.ownerUserId);
  const at = nowIso(input.now);
  return inImmediateTransaction(() => {
    const previous = getDatabase()
      .prepare(
        "SELECT default_agent_id FROM agent_message_defaults WHERE owner_user_id = ?"
      )
      .get(input.ownerUserId) as { default_agent_id: string } | undefined;
    getDatabase()
      .prepare(
        `INSERT INTO agent_message_defaults (owner_user_id, default_agent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_user_id) DO UPDATE SET
           default_agent_id = excluded.default_agent_id,
           updated_at = excluded.updated_at`
      )
      .run(input.ownerUserId, agent.id, at, at);
    recordEventLog(
      {
        eventKind: "agent_messages.default_changed",
        entityType: "agent_message_settings",
        entityId: input.ownerUserId,
        actor: input.actor.label,
        source: input.actor.source,
        metadata: {
          ownerUserId: input.ownerUserId,
          oldAgentId: previous?.default_agent_id ?? null,
          newAgentId: agent.id,
          actorKind: input.actor.kind,
          actorId: input.actor.id
        }
      },
      input.now
    );
    return getAgentMessageSettings(input.ownerUserId);
  });
}

function resolveRecipient(ownerUserId: string, requested?: string) {
  let agentId = requested;
  if (!agentId) {
    const setting = getDatabase()
      .prepare(
        "SELECT default_agent_id FROM agent_message_defaults WHERE owner_user_id = ?"
      )
      .get(ownerUserId) as { default_agent_id: string } | undefined;
    agentId = setting?.default_agent_id;
  }
  if (!agentId) {
    agentId = listConnectedAgents(ownerUserId)[0]?.id;
  }
  if (!agentId) {
    throw new HttpError(
      409,
      "agent_message_no_recipient",
      "Connect an agent or select a default agent before sending."
    );
  }
  return agentForOwner(agentId, ownerUserId);
}

export function createVoiceReservation(input: {
  ownerUserId: string;
  idempotencyKey: string;
  originalFileName: string;
  declaredMimeType: string;
  declaredDurationMs: number;
  now?: Date;
}) {
  const requestFingerprint = fingerprint({
    originalFileName: input.originalFileName,
    declaredMimeType: input.declaredMimeType.toLowerCase(),
    declaredDurationMs: input.declaredDurationMs
  });
  const existing = getDatabase()
    .prepare(
      `SELECT * FROM agent_message_voice_reservations
       WHERE owner_user_id = ? AND upload_idempotency_key = ?`
    )
    .get(input.ownerUserId, input.idempotencyKey) as ReservationRow | undefined;
  if (existing) {
    if (existing.request_fingerprint !== requestFingerprint) {
      throw new HttpError(
        409,
        "agent_message_idempotency_conflict",
        "This voice reservation key was already used with different metadata."
      );
    }
    return { reservation: reservationPublic(existing), replayed: true };
  }
  const at = input.now ?? new Date();
  const expiresAt = new Date(
    at.getTime() + AGENT_MESSAGE_RESERVATION_TTL_HOURS * 60 * 60 * 1000
  ).toISOString();
  const reservationId = id("amvr");
  getDatabase()
    .prepare(
      `INSERT INTO agent_message_voice_reservations (
        id, owner_user_id, upload_idempotency_key, request_fingerprint, status,
        original_file_name, declared_mime_type, declared_duration_ms,
        expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      reservationId,
      input.ownerUserId,
      input.idempotencyKey,
      requestFingerprint,
      input.originalFileName,
      input.declaredMimeType.toLowerCase(),
      input.declaredDurationMs,
      expiresAt,
      at.toISOString(),
      at.toISOString()
    );
  const row = getDatabase()
    .prepare("SELECT * FROM agent_message_voice_reservations WHERE id = ?")
    .get(reservationId) as ReservationRow;
  return { reservation: reservationPublic(row), replayed: false };
}

export async function activateVoiceReservation(input: {
  ownerUserId: string;
  reservationId: string;
  idempotencyKey: string;
  contentBase64: string;
  declaredMimeType: string;
  declaredDurationMs: number;
  actor: AgentMessageActor;
  now?: Date;
}) {
  const reservation = getDatabase()
    .prepare("SELECT * FROM agent_message_voice_reservations WHERE id = ?")
    .get(input.reservationId) as ReservationRow | undefined;
  if (
    !reservation ||
    reservation.owner_user_id !== input.ownerUserId ||
    Date.parse(reservation.expires_at) <= (input.now ?? new Date()).getTime()
  ) {
    throw new HttpError(
      404,
      "agent_message_voice_reservation_not_found",
      "Voice reservation not found or expired."
    );
  }
  if (
    input.idempotencyKey !== reservation.upload_idempotency_key ||
    input.declaredMimeType.toLowerCase() !== reservation.declared_mime_type ||
    input.declaredDurationMs !== reservation.declared_duration_ms
  ) {
    throw new HttpError(
      409,
      "agent_message_idempotency_conflict",
      "Voice activation does not match the reserved request."
    );
  }
  const bytes = decodeArtifactUploadBase64(
    input.contentBase64,
    AGENT_MESSAGE_MAX_VOICE_BYTES
  );
  try {
    const verified = await verifyAgentMessageMedia({
      buffer: bytes,
      originalFileName: reservation.original_file_name,
      declaredMimeType: input.declaredMimeType,
      declaredDurationMs: input.declaredDurationMs
    });
    if (reservation.status === "active" || reservation.status === "consumed") {
      if (
        reservation.content_sha256 !== verified.contentSha256 ||
        reservation.byte_size !== verified.byteSize ||
        reservation.verified_duration_ms !== verified.durationMs
      ) {
        throw new HttpError(
          409,
          "agent_message_idempotency_conflict",
          "This voice reservation was already activated with different audio."
        );
      }
      return { reservation: reservationPublic(reservation), replayed: true };
    }
    const artifactContext: ArtifactContext = {
      source: input.actor.source,
      actor: input.actor.label,
      userIds: [input.ownerUserId],
      token: null
    };
    const artifactResult = await createArtifactFromUpload(
      {
        idempotencyKey: `agent-message:${input.ownerUserId}:${input.idempotencyKey}`,
        title: "Agent Message voice note",
        shortDescription: "Original voice note attached to an asynchronous Agent Message.",
        description:
          "Sensitive original audio preserved by Forge. Agent access is limited to the addressed message's active claim lease.",
        originalFileName: reservation.original_file_name,
        declaredMimeType: verified.mimeType,
        contentBase64: input.contentBase64,
        sourceKind: "agent_message_voice",
        sourceLabel: "Agent Messages",
        uploadedByUserId: input.ownerUserId,
        downloadPolicy: "human_only",
        links: [],
        metadata: {
          sensitivity: "sensitive_media",
          purpose: "agent_message_original_voice",
          verifiedDurationMs: verified.durationMs,
          declaredDurationMs: input.declaredDurationMs,
          parserName: verified.parserName,
          parserVersion: verified.parserVersion,
          detectedContainer: verified.container,
          detectedCodec: verified.codec
        }
      },
      artifactContext
    );
    const at = nowIso(input.now);
    getDatabase()
      .prepare(
        `UPDATE agent_message_voice_reservations
         SET status = 'active', artifact_id = ?, verified_mime_type = ?,
             verified_container = ?, verified_codec = ?, byte_size = ?,
             content_sha256 = ?, verified_duration_ms = ?, parser_name = ?,
             parser_version = ?, updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND status = 'pending'`
      )
      .run(
        artifactResult.artifact.id,
        verified.mimeType,
        verified.container,
        verified.codec,
        verified.byteSize,
        verified.contentSha256,
        verified.durationMs,
        verified.parserName,
        verified.parserVersion,
        at,
        reservation.id,
        input.ownerUserId
      );
    const activated = getDatabase()
      .prepare("SELECT * FROM agent_message_voice_reservations WHERE id = ?")
      .get(reservation.id) as ReservationRow;
    return {
      reservation: reservationPublic(activated),
      replayed: artifactResult.replayed
    };
  } finally {
    bytes.fill(0);
  }
}

function nextEventSequence(messageId: string) {
  const row = getDatabase()
    .prepare(
      "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM agent_message_events WHERE message_id = ?"
    )
    .get(messageId) as { sequence: number };
  return row.sequence;
}

function appendEvent(input: {
  messageId: string;
  kind: AgentMessageEventKind;
  actor: AgentMessageActor;
  priorStatus: AgentMessageStatus | null;
  nextStatus: AgentMessageStatus | null;
  metadata?: Record<string, unknown>;
  at: string;
}) {
  const sequence = nextEventSequence(input.messageId);
  getDatabase()
    .prepare(
      `INSERT INTO agent_message_events (
        id, message_id, sequence, event_kind, actor_kind, actor_id, actor_label,
        prior_status, next_status, metadata_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id("ame"),
      input.messageId,
      sequence,
      input.kind,
      input.actor.kind,
      input.actor.id,
      input.actor.label,
      input.priorStatus,
      input.nextStatus,
      JSON.stringify(input.metadata ?? {}),
      input.at
    );
  return sequence;
}

export function createAgentMessage(input: {
  ownerUserId: string;
  senderUserId: string;
  senderLabel: string;
  idempotencyKey: string;
  recipientAgentId?: string;
  bodyText: string;
  voiceReservationId?: string;
  retentionDays: number;
  forwardedFromMessageId?: string;
  retriedFromMessageId?: string;
  actor: AgentMessageActor;
  now?: Date;
}) {
  const recipient = resolveRecipient(input.ownerUserId, input.recipientAgentId);
  const reservation = input.voiceReservationId
    ? (getDatabase()
        .prepare("SELECT * FROM agent_message_voice_reservations WHERE id = ?")
        .get(input.voiceReservationId) as ReservationRow | undefined)
    : undefined;
  if (
    reservation &&
    (reservation.owner_user_id !== input.ownerUserId ||
      reservation.status !== "active" ||
      !reservation.artifact_id ||
      Date.parse(reservation.expires_at) <= (input.now ?? new Date()).getTime())
  ) {
    throw new HttpError(
      409,
      "agent_message_voice_reservation_not_active",
      "The selected voice reservation is not active for this owner."
    );
  }
  const requestFingerprint = fingerprint({
    recipientAgentId: recipient.id,
    bodyText: input.bodyText,
    voiceArtifactId: reservation?.artifact_id ?? null,
    voiceContentSha256: reservation?.content_sha256 ?? null,
    retentionDays: input.retentionDays,
    forwardedFromMessageId: input.forwardedFromMessageId ?? null,
    retriedFromMessageId: input.retriedFromMessageId ?? null
  });
  const at = input.now ?? new Date();
  return inImmediateTransaction(() => {
    const existing = getDatabase()
      .prepare(
        `SELECT * FROM agent_messages
         WHERE owner_user_id = ? AND client_idempotency_key = ?`
      )
      .get(input.ownerUserId, input.idempotencyKey) as MessageRow | undefined;
    if (existing) {
      if (existing.request_fingerprint !== requestFingerprint) {
        throw new HttpError(
          409,
          "agent_message_idempotency_conflict",
          "This message key was already used with a different payload."
        );
      }
      return { message: messagePublic(existing), replayed: true };
    }
    if (reservation) {
      const claimed = getDatabase()
        .prepare(
          `UPDATE agent_message_voice_reservations
           SET status = 'consumed', consumed_message_id = ?, updated_at = ?
           WHERE id = ? AND owner_user_id = ? AND status = 'active'`
        );
      const messageId = id("amsg");
      const result = claimed.run(
        messageId,
        at.toISOString(),
        reservation.id,
        input.ownerUserId
      );
      if (result.changes !== 1) {
        throw new HttpError(
          409,
          "agent_message_voice_reservation_consumed",
          "The selected voice reservation was already consumed."
        );
      }
      return insertNewMessage({ ...input, recipient, reservation, requestFingerprint, messageId, at });
    }
    return insertNewMessage({
      ...input,
      recipient,
      reservation: undefined,
      requestFingerprint,
      messageId: id("amsg"),
      at
    });
  });
}

function insertNewMessage(input: {
  ownerUserId: string;
  senderUserId: string;
  senderLabel: string;
  idempotencyKey: string;
  bodyText: string;
  retentionDays: number;
  actor: AgentMessageActor;
  recipient: { id: string; label: string };
  reservation?: ReservationRow;
  requestFingerprint: string;
  messageId: string;
  forwardedFromMessageId?: string;
  retriedFromMessageId?: string;
  at: Date;
}) {
  const timestamp = input.at.toISOString();
  const retentionUntil = new Date(
    input.at.getTime() + input.retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO agent_messages (
        id, owner_user_id, sender_kind, sender_user_id, sender_agent_id, sender_label,
        initial_recipient_agent_id, initial_recipient_label, recipient_agent_id, recipient_label,
        forwarded_from_message_id, retried_from_message_id, body_text, voice_artifact_id,
        voice_mime_type, voice_byte_size, voice_declared_duration_ms,
        voice_verified_duration_ms, status, client_idempotency_key, request_fingerprint,
        retention_until, delivered_at, created_at, updated_at
      ) VALUES (?, ?, 'human_user', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                'delivered', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.messageId,
      input.ownerUserId,
      input.senderUserId,
      input.senderLabel,
      input.recipient.id,
      input.recipient.label,
      input.recipient.id,
      input.recipient.label,
      input.forwardedFromMessageId ?? null,
      input.retriedFromMessageId ?? null,
      input.bodyText.trim(),
      input.reservation?.artifact_id ?? null,
      input.reservation?.verified_mime_type ?? "",
      input.reservation?.byte_size ?? null,
      input.reservation?.declared_duration_ms ?? null,
      input.reservation?.verified_duration_ms ?? null,
      input.idempotencyKey,
      input.requestFingerprint,
      retentionUntil,
      timestamp,
      timestamp,
      timestamp
    );
  appendEvent({
    messageId: input.messageId,
    kind: input.retriedFromMessageId ? "retried" : "created",
    actor: input.actor,
    priorStatus: null,
    nextStatus: "delivered",
    metadata: {
      recipientAgentId: input.recipient.id,
      hasText: input.bodyText.trim().length > 0,
      hasVoice: Boolean(input.reservation?.artifact_id),
      voiceContentSha256: input.reservation?.content_sha256 ?? null,
      forwardedFromMessageId: input.forwardedFromMessageId ?? null,
      retriedFromMessageId: input.retriedFromMessageId ?? null
    },
    at: timestamp
  });
  const row = requireMessage(input.messageId);
  return { message: messagePublic(row), replayed: false };
}

export function listAgentMessages(input: {
  ownerUserId: string;
  box: "inbox" | "outbox";
  status?: AgentMessageStatus;
  limit: number;
  offset: number;
}) {
  const parameters: Array<string | number> = [input.ownerUserId];
  const where = ["messages.owner_user_id = ?", "messages.deleted_at IS NULL"];
  if (input.status) {
    where.push("messages.status = ?");
    parameters.push(input.status);
  }
  const eligiblePlaceholders = INBOX_ACTIVITY_EVENT_KINDS.map(() => "?").join(", ");
  const eligible = [...INBOX_ACTIVITY_EVENT_KINDS];
  if (input.box === "inbox") {
    where.push(
      `COALESCE((
         SELECT MAX(events.sequence)
         FROM agent_message_events events
         WHERE events.message_id = messages.id
           AND events.actor_kind = 'agent'
           AND events.event_kind IN (${eligiblePlaceholders})
       ), 0) > COALESCE(reads.last_read_event_sequence, 0)`
    );
    parameters.push(...eligible);
  } else {
    where.push("messages.sender_kind = 'human_user'");
  }
  parameters.push(...eligible, input.limit, input.offset);
  const rows = getDatabase()
    .prepare(
      `SELECT messages.*,
              (SELECT MAX(events.sequence)
               FROM agent_message_events events
               WHERE events.message_id = messages.id
                 AND events.actor_kind = 'agent'
                 AND events.event_kind IN (${eligiblePlaceholders})) AS unread_sequence
       FROM agent_messages messages
       LEFT JOIN agent_message_reads reads
         ON reads.owner_user_id = messages.owner_user_id AND reads.message_id = messages.id
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(unread_sequence, 0) DESC, messages.updated_at DESC, messages.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...parameters) as Array<MessageRow & { unread_sequence: number | null }>;
  const unreadCount = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM agent_messages messages
       LEFT JOIN agent_message_reads reads
         ON reads.owner_user_id = messages.owner_user_id AND reads.message_id = messages.id
       WHERE messages.owner_user_id = ? AND messages.deleted_at IS NULL
         AND COALESCE((
           SELECT MAX(events.sequence)
           FROM agent_message_events events
           WHERE events.message_id = messages.id
             AND events.actor_kind = 'agent'
             AND events.event_kind IN (${eligiblePlaceholders})
         ), 0) > COALESCE(reads.last_read_event_sequence, 0)`
    )
    .get(input.ownerUserId, ...eligible) as { count: number };
  return {
    box: input.box,
    items: rows.map((row) => messagePublic(row, row.unread_sequence)),
    unreadThreadCount: unreadCount.count,
    limit: input.limit,
    offset: input.offset,
    hasMore: rows.length === input.limit
  };
}

export function getAgentMessageDetail(ownerUserId: string, messageId: string) {
  const message = requireOwnerMessage(messageId, ownerUserId);
  const events = getDatabase()
    .prepare(
      `SELECT id, sequence, event_kind, actor_kind, actor_id, actor_label,
              prior_status, next_status, metadata_json, occurred_at
       FROM agent_message_events WHERE message_id = ? ORDER BY sequence`
    )
    .all(messageId) as Array<Record<string, unknown> & { metadata_json: string }>;
  const related = getDatabase()
    .prepare(
      `SELECT * FROM agent_messages
       WHERE owner_user_id = ?
         AND (id = ? OR forwarded_from_message_id = ? OR retried_from_message_id = ?
              OR id = ? OR id = ?)
       ORDER BY created_at, id`
    )
    .all(
      ownerUserId,
      messageId,
      messageId,
      messageId,
      message.forwarded_from_message_id,
      message.retried_from_message_id
    ) as MessageRow[];
  return {
    message: messagePublic(message),
    events: events.map((event) => ({
      ...event,
      metadata: parseJson(event.metadata_json),
      metadata_json: undefined
    })),
    relatedMessages: related.map((row) => messagePublic(row))
  };
}

export function getAgentMessageDetailForAgent(input: {
  messageId: string;
  agentId: string;
  ownerUserIds: string[];
}) {
  const message = requireMessage(input.messageId);
  if (
    message.deleted_at ||
    message.recipient_agent_id !== input.agentId ||
    !input.ownerUserIds.includes(message.owner_user_id)
  ) {
    throw new HttpError(404, "agent_message_not_found", "Agent Message not found.");
  }
  return getAgentMessageDetail(message.owner_user_id, message.id);
}

function existingOperationReceipt(input: {
  messageId: string;
  operationKind: string;
  operationKey: string;
  requestFingerprint: string;
}) {
  const row = getDatabase()
    .prepare(
      `SELECT request_fingerprint, response_json
       FROM agent_message_operation_receipts
       WHERE message_id = ? AND operation_kind = ? AND operation_key = ?`
    )
    .get(input.messageId, input.operationKind, input.operationKey) as
    | ReceiptRow
    | undefined;
  if (!row) return null;
  if (row.request_fingerprint !== input.requestFingerprint) {
    throw new HttpError(
      409,
      "agent_message_idempotency_conflict",
      "This operation key was already used with a different payload."
    );
  }
  return parseJson<Record<string, unknown>>(row.response_json);
}

function insertOperationReceipt(input: {
  messageId: string;
  operationKind: string;
  operationKey: string;
  requestFingerprint: string;
  actor: AgentMessageActor;
  revision: number;
  claimGeneration: number;
  eventSequence: number;
  response: unknown;
  at: string;
}) {
  getDatabase()
    .prepare(
      `INSERT INTO agent_message_operation_receipts (
        id, message_id, operation_kind, operation_key, request_fingerprint,
        actor_kind, actor_id, resulting_revision, resulting_claim_generation,
        resulting_event_sequence, response_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id("amor"),
      input.messageId,
      input.operationKind,
      input.operationKey,
      input.requestFingerprint,
      input.actor.kind,
      input.actor.id,
      input.revision,
      input.claimGeneration,
      input.eventSequence,
      JSON.stringify(input.response),
      input.at
    );
}

export function markAgentMessageRead(input: {
  ownerUserId: string;
  messageId: string;
  operationKey: string;
  expectedInboxEventSequence: number;
  actor: AgentMessageActor;
  now?: Date;
}) {
  const requestFingerprint = fingerprint({
    expectedInboxEventSequence: input.expectedInboxEventSequence
  });
  return inImmediateTransaction(() => {
    const replay = existingOperationReceipt({
      messageId: input.messageId,
      operationKind: "mark_read",
      operationKey: input.operationKey,
      requestFingerprint
    });
    if (replay) return { ...replay, replayed: true };
    const message = requireOwnerMessage(input.messageId, input.ownerUserId);
    const placeholders = INBOX_ACTIVITY_EVENT_KINDS.map(() => "?").join(", ");
    const observed = getDatabase()
      .prepare(
        `SELECT COALESCE(MAX(sequence), 0) AS sequence
         FROM agent_message_events
         WHERE message_id = ? AND actor_kind = 'agent'
           AND event_kind IN (${placeholders})`
      )
      .get(message.id, ...INBOX_ACTIVITY_EVENT_KINDS) as { sequence: number };
    if (observed.sequence < input.expectedInboxEventSequence) {
      throw new HttpError(
        409,
        "agent_message_read_sequence_invalid",
        "The expected inbox event is not present. Refresh this message."
      );
    }
    const at = nowIso(input.now);
    getDatabase()
      .prepare(
        `INSERT INTO agent_message_reads (
          owner_user_id, message_id, last_read_event_sequence, read_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(owner_user_id, message_id) DO UPDATE SET
          last_read_event_sequence = MAX(last_read_event_sequence, excluded.last_read_event_sequence),
          read_at = excluded.read_at,
          updated_at = excluded.updated_at`
      )
      .run(
        input.ownerUserId,
        message.id,
        input.expectedInboxEventSequence,
        at,
        at
      );
    const response = {
      messageId: message.id,
      readThroughEventSequence: input.expectedInboxEventSequence,
      latestInboxEventSequence: observed.sequence,
      hasUnreadNewerActivity: observed.sequence > input.expectedInboxEventSequence
    };
    insertOperationReceipt({
      messageId: message.id,
      operationKind: "mark_read",
      operationKey: input.operationKey,
      requestFingerprint,
      actor: input.actor,
      revision: message.revision,
      claimGeneration: message.claim_generation,
      eventSequence: input.expectedInboxEventSequence,
      response,
      at
    });
    return { ...response, replayed: false };
  });
}

export function pollAgentMessages(input: {
  agentId: string;
  ownerUserIds: string[];
  limit: number;
  now?: Date;
}) {
  if (input.ownerUserIds.length === 0) return { items: [], polledAt: nowIso(input.now) };
  const owners = input.ownerUserIds.map(() => "?").join(", ");
  const at = nowIso(input.now);
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM agent_messages
       WHERE recipient_agent_id = ? AND owner_user_id IN (${owners})
         AND deleted_at IS NULL AND retention_until > ?
         AND status NOT IN ('handled', 'failed', 'forwarded')
         AND (claim_secret_digest IS NULL OR claim_expires_at <= ? OR claimed_by_agent_id = ?)
       ORDER BY created_at, id LIMIT ?`
    )
    .all(
      input.agentId,
      ...input.ownerUserIds,
      at,
      at,
      input.agentId,
      input.limit
    ) as MessageRow[];
  return {
    items: rows.map((row) => messagePublic(row)),
    polledAt: at,
    claimRequired: true
  };
}

function requireAgentMessage(messageId: string, agentId: string) {
  const row = requireMessage(messageId);
  if (row.recipient_agent_id !== agentId || row.deleted_at) {
    throw new HttpError(404, "agent_message_not_found", "Agent Message not found.");
  }
  if (["handled", "failed", "forwarded"].includes(row.status)) {
    throw new HttpError(
      409,
      "agent_message_terminal",
      "This Agent Message already has a terminal outcome."
    );
  }
  return row;
}

export function claimAgentMessage(input: {
  messageId: string;
  agentId: string;
  operationKey: string;
  leaseSecret: string;
  leaseSeconds: number;
  leaseDigestKey: Buffer;
  actor: AgentMessageActor;
  now?: Date;
}) {
  const secretDigest = leaseDigest(input.leaseSecret, input.leaseDigestKey);
  const requestFingerprint = fingerprint({
    agentId: input.agentId,
    leaseSeconds: input.leaseSeconds,
    secretDigest
  });
  return inImmediateTransaction(() => {
    const replay = existingOperationReceipt({
      messageId: input.messageId,
      operationKind: "claim",
      operationKey: input.operationKey,
      requestFingerprint
    });
    if (replay) return { ...replay, replayed: true };
    const message = requireAgentMessage(input.messageId, input.agentId);
    const now = input.now ?? new Date();
    const hasLiveLease =
      message.claim_secret_digest !== null &&
      message.claim_expires_at !== null &&
      Date.parse(message.claim_expires_at) > now.getTime();
    if (hasLiveLease) {
      throw new HttpError(
        409,
        "agent_message_claimed",
        "Another live claim lease currently owns this Agent Message.",
        { claimExpiresAt: message.claim_expires_at }
      );
    }
    const at = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + input.leaseSeconds * 1000
    ).toISOString();
    const generation = message.claim_generation + 1;
    const revision = message.revision + 1;
    getDatabase()
      .prepare(
        `UPDATE agent_messages SET
           status = 'claimed', revision = ?, claim_secret_digest = ?,
           claimed_by_agent_id = ?, claim_generation = ?, claimed_at = ?,
           claim_renewed_at = ?, claim_expires_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        revision,
        secretDigest,
        input.agentId,
        generation,
        at,
        at,
        expiresAt,
        at,
        message.id
      );
    const eventSequence = appendEvent({
      messageId: message.id,
      kind: message.claim_generation > 0 ? "lease_expired_takeover" : "claimed",
      actor: input.actor,
      priorStatus: message.status,
      nextStatus: "claimed",
      metadata: {
        claimGeneration: generation,
        priorClaimGeneration: message.claim_generation,
        priorClaimantAgentId: message.claimed_by_agent_id,
        leaseSeconds: input.leaseSeconds
      },
      at
    });
    const response = {
      messageId: message.id,
      status: "claimed",
      revision,
      claimGeneration: generation,
      claimExpiresAt: expiresAt
    };
    insertOperationReceipt({
      messageId: message.id,
      operationKind: "claim",
      operationKey: input.operationKey,
      requestFingerprint,
      actor: input.actor,
      revision,
      claimGeneration: generation,
      eventSequence,
      response,
      at
    });
    return { ...response, replayed: false };
  });
}

function verifyLiveLease(input: {
  message: MessageRow;
  agentId: string;
  leaseSecret: string;
  claimGeneration: number;
  leaseDigestKey: Buffer;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const digest = leaseDigest(input.leaseSecret, input.leaseDigestKey);
  if (
    input.message.recipient_agent_id !== input.agentId ||
    input.message.claimed_by_agent_id !== input.agentId ||
    input.message.claim_secret_digest !== digest ||
    input.message.claim_generation !== input.claimGeneration ||
    !input.message.claim_expires_at ||
    Date.parse(input.message.claim_expires_at) <= now.getTime()
  ) {
    throw new HttpError(
      409,
      "agent_message_lease_invalid",
      "The Agent Message claim lease is missing, expired, or does not match this agent."
    );
  }
}

function nonterminalAgentOperation(input: {
  messageId: string;
  agentId: string;
  operationKind: "renew" | "progress" | "acknowledge";
  operationKey: string;
  leaseSecret: string;
  claimGeneration: number;
  leaseDigestKey: Buffer;
  actor: AgentMessageActor;
  payload: Record<string, unknown>;
  now?: Date;
}) {
  const requestFingerprint = fingerprint({
    ...input.payload,
    claimGeneration: input.claimGeneration,
    leaseDigest: leaseDigest(input.leaseSecret, input.leaseDigestKey)
  });
  return inImmediateTransaction(() => {
    const replay = existingOperationReceipt({
      messageId: input.messageId,
      operationKind: input.operationKind,
      operationKey: input.operationKey,
      requestFingerprint
    });
    if (replay) return { ...replay, replayed: true };
    const message = requireAgentMessage(input.messageId, input.agentId);
    verifyLiveLease({ ...input, message });
    const now = input.now ?? new Date();
    const at = now.toISOString();
    let nextStatus = message.status;
    let kind: AgentMessageEventKind;
    let expiresAt = message.claim_expires_at;
    if (input.operationKind === "renew") {
      kind = "lease_renewed";
      expiresAt = new Date(
        now.getTime() + Number(input.payload.leaseSeconds) * 1000
      ).toISOString();
    } else if (input.operationKind === "progress") {
      kind = "progress";
      if (message.status !== "acknowledged") nextStatus = "in_progress";
    } else {
      kind = "acknowledgement";
      nextStatus = "acknowledged";
    }
    const revision = message.revision + 1;
    getDatabase()
      .prepare(
        `UPDATE agent_messages SET status = ?, revision = ?,
           progress_summary = CASE WHEN ? = 'progress' THEN ? ELSE progress_summary END,
           acknowledged_at = CASE WHEN ? = 'acknowledge' THEN ? ELSE acknowledged_at END,
           claim_renewed_at = ?, claim_expires_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        nextStatus,
        revision,
        input.operationKind,
        String(input.payload.progressSummary ?? ""),
        input.operationKind,
        at,
        at,
        expiresAt,
        at,
        message.id
      );
    const eventSequence = appendEvent({
      messageId: message.id,
      kind,
      actor: input.actor,
      priorStatus: message.status,
      nextStatus,
      metadata:
        input.operationKind === "progress"
          ? { progressSummary: String(input.payload.progressSummary) }
          : input.operationKind === "renew"
            ? { claimGeneration: message.claim_generation, expiresAt }
            : { claimGeneration: message.claim_generation },
      at
    });
    const response = {
      messageId: message.id,
      status: nextStatus,
      revision,
      claimGeneration: message.claim_generation,
      claimExpiresAt: expiresAt,
      eventSequence
    };
    insertOperationReceipt({
      messageId: message.id,
      operationKind: input.operationKind,
      operationKey: input.operationKey,
      requestFingerprint,
      actor: input.actor,
      revision,
      claimGeneration: message.claim_generation,
      eventSequence,
      response,
      at
    });
    return { ...response, replayed: false };
  });
}

export function renewAgentMessageLease(
  input: Omit<Parameters<typeof nonterminalAgentOperation>[0], "operationKind" | "payload"> & {
    leaseSeconds: number;
  }
) {
  return nonterminalAgentOperation({
    ...input,
    operationKind: "renew",
    payload: { leaseSeconds: input.leaseSeconds }
  });
}

export function progressAgentMessage(
  input: Omit<Parameters<typeof nonterminalAgentOperation>[0], "operationKind" | "payload"> & {
    progressSummary: string;
  }
) {
  return nonterminalAgentOperation({
    ...input,
    operationKind: "progress",
    payload: { progressSummary: input.progressSummary }
  });
}

export function acknowledgeAgentMessage(
  input: Omit<Parameters<typeof nonterminalAgentOperation>[0], "operationKind" | "payload">
) {
  return nonterminalAgentOperation({
    ...input,
    operationKind: "acknowledge",
    payload: {}
  });
}

function existingTerminalReceipt(input: {
  messageId: string;
  receiptKey: string;
  requestFingerprint: string;
}) {
  const row = getDatabase()
    .prepare(
      `SELECT request_fingerprint, response_json
       FROM agent_message_terminal_receipts
       WHERE message_id = ? AND receipt_key = ?`
    )
    .get(input.messageId, input.receiptKey) as ReceiptRow | undefined;
  if (!row) return null;
  if (row.request_fingerprint !== input.requestFingerprint) {
    throw new HttpError(
      409,
      "agent_message_idempotency_conflict",
      "This terminal receipt was already used with a different payload."
    );
  }
  return parseJson<Record<string, unknown>>(row.response_json);
}

export function handleAgentMessage(input: {
  messageId: string;
  agentId: string;
  receiptKey: string;
  leaseSecret: string;
  claimGeneration: number;
  leaseDigestKey: Buffer;
  resultMarkdown: string;
  transcriptText: string;
  transcriptProvider: string;
  transcriptDisclosure: string;
  actor: AgentMessageActor;
  now?: Date;
}) {
  const requestFingerprint = fingerprint({
    outcome: "handled",
    resultMarkdown: input.resultMarkdown,
    transcriptText: input.transcriptText,
    transcriptProvider: input.transcriptProvider,
    transcriptDisclosure: input.transcriptDisclosure,
    claimGeneration: input.claimGeneration
  });
  return terminalAgentOperation({ ...input, requestFingerprint, outcome: "handled" });
}

export function failAgentMessage(input: {
  messageId: string;
  agentId: string;
  receiptKey: string;
  leaseSecret: string;
  claimGeneration: number;
  leaseDigestKey: Buffer;
  failureCode: string;
  failureMessage: string;
  actor: AgentMessageActor;
  now?: Date;
}) {
  const requestFingerprint = fingerprint({
    outcome: "failed",
    failureCode: input.failureCode,
    failureMessage: input.failureMessage,
    claimGeneration: input.claimGeneration
  });
  return terminalAgentOperation({ ...input, requestFingerprint, outcome: "failed" });
}

function terminalAgentOperation(input: {
  messageId: string;
  agentId: string;
  receiptKey: string;
  leaseSecret: string;
  claimGeneration: number;
  leaseDigestKey: Buffer;
  requestFingerprint: string;
  outcome: "handled" | "failed";
  actor: AgentMessageActor;
  now?: Date;
  resultMarkdown?: string;
  transcriptText?: string;
  transcriptProvider?: string;
  transcriptDisclosure?: string;
  failureCode?: string;
  failureMessage?: string;
}) {
  return inImmediateTransaction(() => {
    const replay = existingTerminalReceipt(input);
    if (replay) return { ...replay, replayed: true };
    const message = requireAgentMessage(input.messageId, input.agentId);
    verifyLiveLease({ ...input, message });
    const at = nowIso(input.now);
    const revision = message.revision + 1;
    getDatabase()
      .prepare(
        `UPDATE agent_messages SET status = ?, revision = ?,
          result_markdown = ?, transcript_text = ?, transcript_provider = ?,
          transcript_disclosure = ?, failure_code = ?, failure_message = ?,
          handled_at = CASE WHEN ? = 'handled' THEN ? ELSE handled_at END,
          failed_at = CASE WHEN ? = 'failed' THEN ? ELSE failed_at END,
          claim_secret_digest = NULL, claim_expires_at = NULL, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.outcome,
        revision,
        input.resultMarkdown ?? "",
        input.transcriptText ?? "",
        input.transcriptProvider ?? "",
        input.transcriptDisclosure ?? "",
        input.failureCode ?? "",
        input.failureMessage ?? "",
        input.outcome,
        at,
        input.outcome,
        at,
        at,
        message.id
      );
    const eventSequence = appendEvent({
      messageId: message.id,
      kind: input.outcome,
      actor: input.actor,
      priorStatus: message.status,
      nextStatus: input.outcome,
      metadata:
        input.outcome === "handled"
          ? {
              hasResult: Boolean(input.resultMarkdown),
              hasTranscript: Boolean(input.transcriptText),
              transcriptProvider: input.transcriptProvider || null,
              transcriptDisclosure: input.transcriptDisclosure || null
            }
          : { failureCode: input.failureCode },
      at
    });
    const response = {
      messageId: message.id,
      status: input.outcome,
      revision,
      claimGeneration: message.claim_generation,
      eventSequence
    };
    getDatabase()
      .prepare(
        `INSERT INTO agent_message_terminal_receipts (
          id, message_id, receipt_key, request_fingerprint, terminal_outcome,
          resulting_message_id, agent_id, claim_generation, response_json, created_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
      )
      .run(
        id("amtr"),
        message.id,
        input.receiptKey,
        input.requestFingerprint,
        input.outcome,
        input.agentId,
        message.claim_generation,
        JSON.stringify(response),
        at
      );
    return { ...response, replayed: false };
  });
}

export function forwardAgentMessage(input: {
  messageId: string;
  agentId: string;
  receiptKey: string;
  leaseSecret: string;
  claimGeneration: number;
  leaseDigestKey: Buffer;
  recipientAgentId: string;
  progressSummary: string;
  actor: AgentMessageActor;
  now?: Date;
}) {
  const requestFingerprint = fingerprint({
    outcome: "forwarded",
    recipientAgentId: input.recipientAgentId,
    progressSummary: input.progressSummary,
    claimGeneration: input.claimGeneration
  });
  return inImmediateTransaction(() => {
    const replay = existingTerminalReceipt({ ...input, requestFingerprint });
    if (replay) return { ...replay, replayed: true };
    const message = requireAgentMessage(input.messageId, input.agentId);
    verifyLiveLease({ ...input, message });
    const recipient = agentForOwner(input.recipientAgentId, message.owner_user_id);
    if (recipient.id === input.agentId) {
      throw new HttpError(
        400,
        "agent_message_forward_recipient_invalid",
        "Forward an Agent Message to a different connected agent."
      );
    }
    const at = input.now ?? new Date();
    const timestamp = at.toISOString();
    const childId = id("amsg");
    const childFingerprint = fingerprint({
      forwardedFromMessageId: message.id,
      recipientAgentId: recipient.id,
      voiceArtifactId: message.voice_artifact_id,
      bodyText: message.body_text
    });
    getDatabase()
      .prepare(
        `INSERT INTO agent_messages (
          id, owner_user_id, sender_kind, sender_agent_id, sender_label,
          initial_recipient_agent_id, initial_recipient_label, recipient_agent_id,
          recipient_label, forwarded_from_message_id, body_text, voice_artifact_id,
          voice_mime_type, voice_byte_size, voice_declared_duration_ms,
          voice_verified_duration_ms, status, progress_summary,
          client_idempotency_key, request_fingerprint, retention_until,
          delivered_at, created_at, updated_at
        ) VALUES (?, ?, 'agent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  'delivered', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        childId,
        message.owner_user_id,
        input.agentId,
        input.actor.label,
        recipient.id,
        recipient.label,
        recipient.id,
        recipient.label,
        message.id,
        message.body_text,
        message.voice_artifact_id,
        message.voice_mime_type,
        message.voice_byte_size,
        message.voice_declared_duration_ms,
        message.voice_verified_duration_ms,
        input.progressSummary,
        `forward:${message.id}:${input.receiptKey}`,
        childFingerprint,
        message.retention_until,
        timestamp,
        timestamp,
        timestamp
      );
    appendEvent({
      messageId: childId,
      kind: "forwarded",
      actor: input.actor,
      priorStatus: null,
      nextStatus: "delivered",
      metadata: { forwardedFromMessageId: message.id, recipientAgentId: recipient.id },
      at: timestamp
    });
    const revision = message.revision + 1;
    getDatabase()
      .prepare(
        `UPDATE agent_messages SET status = 'forwarded', revision = ?,
          progress_summary = ?, forwarded_at = ?, claim_secret_digest = NULL,
          claim_expires_at = NULL, updated_at = ? WHERE id = ?`
      )
      .run(revision, input.progressSummary, timestamp, timestamp, message.id);
    const eventSequence = appendEvent({
      messageId: message.id,
      kind: "forwarded",
      actor: input.actor,
      priorStatus: message.status,
      nextStatus: "forwarded",
      metadata: { resultingMessageId: childId, recipientAgentId: recipient.id },
      at: timestamp
    });
    const response = {
      messageId: message.id,
      resultingMessageId: childId,
      status: "forwarded",
      revision,
      claimGeneration: message.claim_generation,
      eventSequence
    };
    getDatabase()
      .prepare(
        `INSERT INTO agent_message_terminal_receipts (
          id, message_id, receipt_key, request_fingerprint, terminal_outcome,
          resulting_message_id, agent_id, claim_generation, response_json, created_at
        ) VALUES (?, ?, ?, ?, 'forwarded', ?, ?, ?, ?, ?)`
      )
      .run(
        id("amtr"),
        message.id,
        input.receiptKey,
        requestFingerprint,
        childId,
        input.agentId,
        message.claim_generation,
        JSON.stringify(response),
        timestamp
      );
    return { ...response, replayed: false };
  });
}

export function reassignAgentMessage(input: {
  ownerUserId: string;
  messageId: string;
  operationKey: string;
  expectedRevision: number;
  recipientAgentId: string;
  revokeActiveLease: boolean;
  reason: string;
  actor: AgentMessageActor;
  now?: Date;
}) {
  const requestFingerprint = fingerprint({
    expectedRevision: input.expectedRevision,
    recipientAgentId: input.recipientAgentId,
    revokeActiveLease: input.revokeActiveLease,
    reason: input.reason
  });
  return inImmediateTransaction(() => {
    const replay = existingOperationReceipt({
      messageId: input.messageId,
      operationKind: "reassign",
      operationKey: input.operationKey,
      requestFingerprint
    });
    if (replay) return { ...replay, replayed: true };
    const message = requireOwnerMessage(input.messageId, input.ownerUserId);
    if (message.revision !== input.expectedRevision) {
      throw new HttpError(
        409,
        "agent_message_revision_conflict",
        "Refresh the Agent Message before reassigning it."
      );
    }
    if (["handled", "failed", "forwarded"].includes(message.status)) {
      throw new HttpError(
        409,
        "agent_message_terminal",
        "A terminal Agent Message cannot be reassigned."
      );
    }
    const now = input.now ?? new Date();
    const liveLease =
      message.claim_secret_digest !== null &&
      message.claim_expires_at !== null &&
      Date.parse(message.claim_expires_at) > now.getTime();
    if (liveLease && !input.revokeActiveLease) {
      throw new HttpError(
        409,
        "agent_message_live_lease",
        "Confirm lease revocation to reassign work already claimed by an agent."
      );
    }
    const recipient = agentForOwner(input.recipientAgentId, input.ownerUserId);
    const at = now.toISOString();
    const generation = liveLease
      ? message.claim_generation + 1
      : message.claim_generation;
    const revision = message.revision + 1;
    if (liveLease) {
      appendEvent({
        messageId: message.id,
        kind: "lease_revoked",
        actor: input.actor,
        priorStatus: message.status,
        nextStatus: "delivered",
        metadata: {
          reason: input.reason,
          priorClaimantAgentId: message.claimed_by_agent_id,
          invalidatedClaimGeneration: message.claim_generation
        },
        at
      });
    }
    getDatabase()
      .prepare(
        `UPDATE agent_messages SET recipient_agent_id = ?, recipient_label = ?,
          status = 'delivered', revision = ?, claim_secret_digest = NULL,
          claimed_by_agent_id = NULL, claim_generation = ?, claimed_at = NULL,
          claim_renewed_at = NULL, claim_expires_at = NULL, updated_at = ?
         WHERE id = ?`
      )
      .run(recipient.id, recipient.label, revision, generation, at, message.id);
    const eventSequence = appendEvent({
      messageId: message.id,
      kind: "reassigned",
      actor: input.actor,
      priorStatus: message.status,
      nextStatus: "delivered",
      metadata: {
        reason: input.reason,
        previousRecipientAgentId: message.recipient_agent_id,
        recipientAgentId: recipient.id,
        leaseRevoked: liveLease
      },
      at
    });
    const response = {
      messageId: message.id,
      status: "delivered",
      revision,
      recipient: { agentId: recipient.id, label: recipient.label },
      claimGeneration: generation,
      eventSequence
    };
    insertOperationReceipt({
      messageId: message.id,
      operationKind: "reassign",
      operationKey: input.operationKey,
      requestFingerprint,
      actor: input.actor,
      revision,
      claimGeneration: generation,
      eventSequence,
      response,
      at
    });
    return { ...response, replayed: false };
  });
}

export function retryAgentMessage(input: {
  ownerUserId: string;
  messageId: string;
  operationKey: string;
  recipientAgentId?: string;
  actor: AgentMessageActor;
  now?: Date;
}) {
  const requestFingerprint = fingerprint({
    recipientAgentId: input.recipientAgentId ?? null
  });
  return inImmediateTransaction(() => {
    const replay = existingOperationReceipt({
      messageId: input.messageId,
      operationKind: "retry",
      operationKey: input.operationKey,
      requestFingerprint
    });
    if (replay) return { ...replay, replayed: true };
    const source = requireOwnerMessage(input.messageId, input.ownerUserId);
    if (source.status !== "failed") {
      throw new HttpError(
        409,
        "agent_message_retry_invalid",
        "Only a failed Agent Message can be retried."
      );
    }
    const recipient = resolveRecipient(
      input.ownerUserId,
      input.recipientAgentId ?? source.recipient_agent_id
    );
    const at = input.now ?? new Date();
    const timestamp = at.toISOString();
    const childId = id("amsg");
    const childFingerprint = fingerprint({
      retriedFromMessageId: source.id,
      recipientAgentId: recipient.id,
      voiceArtifactId: source.voice_artifact_id,
      bodyText: source.body_text
    });
    getDatabase()
      .prepare(
        `INSERT INTO agent_messages (
          id, owner_user_id, sender_kind, sender_user_id, sender_label,
          initial_recipient_agent_id, initial_recipient_label, recipient_agent_id,
          recipient_label, retried_from_message_id, body_text, voice_artifact_id,
          voice_mime_type, voice_byte_size, voice_declared_duration_ms,
          voice_verified_duration_ms, status, client_idempotency_key,
          request_fingerprint, retention_until, delivered_at, created_at, updated_at
        ) VALUES (?, ?, 'human_user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  'delivered', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        childId,
        source.owner_user_id,
        source.sender_user_id,
        source.sender_label,
        recipient.id,
        recipient.label,
        recipient.id,
        recipient.label,
        source.id,
        source.body_text,
        source.voice_artifact_id,
        source.voice_mime_type,
        source.voice_byte_size,
        source.voice_declared_duration_ms,
        source.voice_verified_duration_ms,
        `retry:${source.id}:${input.operationKey}`,
        childFingerprint,
        source.retention_until,
        timestamp,
        timestamp,
        timestamp
      );
    const eventSequence = appendEvent({
      messageId: childId,
      kind: "retried",
      actor: input.actor,
      priorStatus: null,
      nextStatus: "delivered",
      metadata: { retriedFromMessageId: source.id, recipientAgentId: recipient.id },
      at: timestamp
    });
    const response = {
      sourceMessageId: source.id,
      resultingMessageId: childId,
      status: "delivered",
      revision: 1,
      claimGeneration: 0,
      eventSequence
    };
    insertOperationReceipt({
      messageId: source.id,
      operationKind: "retry",
      operationKey: input.operationKey,
      requestFingerprint,
      actor: input.actor,
      revision: source.revision,
      claimGeneration: source.claim_generation,
      eventSequence: 0,
      response,
      at: timestamp
    });
    return { ...response, replayed: false };
  });
}

export function deleteAgentMessage(input: {
  ownerUserId: string;
  messageId: string;
  reason: string;
  actor: AgentMessageActor;
  now?: Date;
}) {
  return inImmediateTransaction(() => {
    const message = requireMessage(input.messageId);
    if (message.owner_user_id !== input.ownerUserId) {
      throw new HttpError(404, "agent_message_not_found", "Agent Message not found.");
    }
    if (message.deleted_at) return { messageId: message.id, deletedAt: message.deleted_at };
    const at = nowIso(input.now);
    getDatabase()
      .prepare(
        `UPDATE agent_messages SET deleted_at = ?, deleted_by_kind = ?,
          deleted_by_id = ?, deletion_reason = ?, revision = revision + 1,
          claim_secret_digest = NULL, claimed_by_agent_id = NULL,
          claim_expires_at = NULL, updated_at = ? WHERE id = ?`
      )
      .run(
        at,
        input.actor.kind,
        input.actor.id,
        input.reason,
        at,
        message.id
      );
    appendEvent({
      messageId: message.id,
      kind: "deleted",
      actor: input.actor,
      priorStatus: message.status,
      nextStatus: message.status,
      metadata: { reason: input.reason },
      at
    });
    return { messageId: message.id, deletedAt: at };
  });
}

export async function readAgentMessageVoice(input: {
  messageId: string;
  agentId: string;
  leaseSecret: string;
  claimGeneration: number;
  leaseDigestKey: Buffer;
  ownerUserIds: string[];
  now?: Date;
}) {
  const message = requireAgentMessage(input.messageId, input.agentId);
  if (!input.ownerUserIds.includes(message.owner_user_id)) {
    throw new HttpError(404, "agent_message_not_found", "Agent Message not found.");
  }
  verifyLiveLease({ ...input, message });
  if (!message.voice_artifact_id) {
    throw new HttpError(
      404,
      "agent_message_voice_not_found",
      "This Agent Message does not contain a voice note."
    );
  }
  const artifactContext: ArtifactContext = {
    source: "agent",
    actor: "Agent Messages leased media delivery",
    userIds: [message.owner_user_id],
    token: null
  };
  const download = await readArtifactDownload(
    message.voice_artifact_id,
    "",
    artifactContext
  );
  if (
    !download ||
    download.artifact.sourceKind !== "agent_message_voice" ||
    download.artifact.artifactState !== "active" ||
    download.artifact.contentProtection.mode !== "plaintext" ||
    download.artifact.contentSha256 !==
      createHash("sha256").update(download.bytes).digest("hex") ||
    download.bytes.byteLength !== message.voice_byte_size
  ) {
    download?.bytes.fill(0);
    throw new HttpError(
      409,
      "agent_message_voice_unavailable",
      "The original voice Artifact did not pass the Agent Messages integrity policy."
    );
  }
  return {
    messageId: message.id,
    artifactId: download.artifact.id,
    mimeType: message.voice_mime_type,
    byteSize: download.bytes.byteLength,
    contentSha256: download.artifact.contentSha256,
    originalFileName: download.artifact.originalFileName,
    bytes: download.bytes
  };
}
