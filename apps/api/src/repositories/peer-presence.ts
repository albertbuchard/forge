import { createHmac, randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import type {
  PeerPresenceCapabilityRecord,
  PeerPresenceCapabilityStore,
  PeerPresencePrincipal
} from "../services/peer-human-presence.js";
import type {
  PeerWebAuthnChallengeRecord,
  PeerWebAuthnCredentialRecord,
  PeerWebAuthnStore
} from "../services/peer-webauthn.js";

type CredentialRow = {
  id: string;
  owner_user_id: string;
  rp_id: string;
  credential_id: string;
  public_key_base64: string;
  counter: number;
  transports_json: string;
  label: string;
  device_type: "singleDevice" | "multiDevice";
  backed_up: number;
  aaguid: string;
  created_at: string;
  last_used_at: string | null;
};

type ChallengeRow = {
  id: string;
  owner_user_id: string;
  principal_class: "operator_session" | "companion_consent";
  principal_id: string;
  principal_origin: string | null;
  ceremony: "register" | "authenticate";
  challenge_keyed_hash: string;
  action_digest: string;
  rp_id: string;
  expected_origin: string;
  credential_set_version: string;
  credential_label: string | null;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
};

export function peerPresenceBindingHash(
  principal: PeerPresencePrincipal,
  key: Uint8Array
): string {
  if (key.byteLength < 32) {
    throw new Error("Peer presence storage requires a 32-byte binding key.");
  }
  return createHmac("sha256", key)
    .update("forge-peer/session-binding/v1\0", "utf8")
    .update(principal.ownerUserId, "utf8")
    .update("\0", "utf8")
    .update(principal.principalClass, "utf8")
    .update("\0", "utf8")
    .update(principal.principalId, "utf8")
    .update("\0", "utf8")
    .update(principal.origin ?? "", "utf8")
    .digest("hex");
}

function mapCredential(row: CredentialRow): PeerWebAuthnCredentialRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    rpId: row.rp_id,
    credentialId: row.credential_id,
    publicKeyBase64: row.public_key_base64,
    counter: row.counter,
    transports: JSON.parse(
      row.transports_json
    ) as PeerWebAuthnCredentialRecord["transports"],
    label: row.label,
    deviceType: row.device_type,
    backedUp: Boolean(row.backed_up),
    aaguid: row.aaguid,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at
  };
}

function mapChallenge(row: ChallengeRow): PeerWebAuthnChallengeRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    principalClass: row.principal_class,
    principalId: row.principal_id,
    origin: row.principal_origin,
    ceremony: row.ceremony,
    challengeHash: row.challenge_keyed_hash,
    actionDigest: row.action_digest,
    rpId: row.rp_id,
    expectedOrigin: row.expected_origin,
    credentialSetVersion: row.credential_set_version,
    credentialLabel: row.credential_label,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at
  };
}

export class SqlitePeerPresenceStore
  implements PeerWebAuthnStore, PeerPresenceCapabilityStore
{
  constructor(private readonly sessionBindingKey: Uint8Array) {
    if (sessionBindingKey.byteLength < 32) {
      throw new Error("Peer presence storage requires a 32-byte binding key.");
    }
  }

  principalBindingHash(principal: PeerPresencePrincipal): string {
    return peerPresenceBindingHash(principal, this.sessionBindingKey);
  }

  listActiveCredentials(ownerUserId: string, rpId: string) {
    const rows = getDatabase()
      .prepare(
        `SELECT id, owner_user_id, rp_id, credential_id, public_key_base64,
                counter, transports_json, label, device_type, backed_up, aaguid,
                created_at, last_used_at
         FROM forge_webauthn_credentials
         WHERE owner_user_id = ? AND rp_id = ? AND status = 'active'
         ORDER BY created_at, id
         LIMIT 64`
      )
      .all(ownerUserId, rpId) as CredentialRow[];
    return rows.map(mapCredential);
  }

  createChallenge(record: PeerWebAuthnChallengeRecord): void {
    const sessionBindingKeyedHash = peerPresenceBindingHash(record, this.sessionBindingKey);
    getDatabase()
      .prepare(
        `INSERT INTO forge_human_presence_challenges (
           id, owner_user_id, principal_class, principal_id, principal_origin,
           ceremony, status, session_binding_keyed_hash, rp_id, expected_origin,
           challenge_keyed_hash, action_digest, credential_set_version,
           credential_label, verified_credential_id, expires_at, consumed_at,
           issued_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`
      )
      .run(
        record.id,
        record.ownerUserId,
        record.principalClass,
        record.principalId,
        record.origin,
        record.ceremony,
        sessionBindingKeyedHash,
        record.rpId,
        record.expectedOrigin,
        record.challengeHash,
        record.actionDigest,
        record.credentialSetVersion,
        record.credentialLabel,
        record.expiresAt,
        record.issuedAt,
        record.issuedAt
      );
  }

  claimChallenge(input: {
    id: string;
    principal: PeerPresencePrincipal;
    actionDigest: string;
    rpId: string;
    expectedOrigin: string;
    now: string;
  }): PeerWebAuthnChallengeRecord | null {
    return runInTransaction(() => {
      const sessionBindingKeyedHash = peerPresenceBindingHash(
        input.principal,
        this.sessionBindingKey
      );
      const row = getDatabase()
        .prepare(
          `SELECT id, owner_user_id, principal_class, principal_id,
                  principal_origin, ceremony, challenge_keyed_hash,
                  action_digest, rp_id, expected_origin,
                  credential_set_version, credential_label, issued_at,
                  expires_at, consumed_at
           FROM forge_human_presence_challenges
           WHERE id = ? AND owner_user_id = ? AND principal_class = ?
             AND principal_id = ?
             AND COALESCE(principal_origin, '') = COALESCE(?, '')
             AND session_binding_keyed_hash = ? AND action_digest = ?
             AND rp_id = ? AND expected_origin = ? AND status = 'pending'
             AND expires_at > ?`
        )
        .get(
          input.id,
          input.principal.ownerUserId,
          input.principal.principalClass,
          input.principal.principalId,
          input.principal.origin,
          sessionBindingKeyedHash,
          input.actionDigest,
          input.rpId,
          input.expectedOrigin,
          input.now
        ) as ChallengeRow | undefined;
      if (!row) {
        return null;
      }
      const changed = getDatabase()
        .prepare(
          `UPDATE forge_human_presence_challenges
           SET status = 'consumed', consumed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`
        )
        .run(input.now, input.now, input.id).changes;
      return changed === 1
        ? mapChallenge({ ...row, consumed_at: input.now })
        : null;
    });
  }

  createCredential(record: PeerWebAuthnCredentialRecord): boolean {
    try {
      const result = getDatabase()
        .prepare(
          `INSERT INTO forge_webauthn_credentials (
             id, owner_user_id, rp_id, credential_id, public_key_base64,
             counter, transports_json, label, device_type, backed_up, aaguid,
             status, created_at, updated_at, last_used_at, revoked_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)`
        )
        .run(
          record.id,
          record.ownerUserId,
          record.rpId,
          record.credentialId,
          record.publicKeyBase64,
          record.counter,
          JSON.stringify(record.transports),
          record.label,
          record.deviceType,
          record.backedUp ? 1 : 0,
          record.aaguid,
          record.createdAt,
          record.createdAt,
          record.lastUsedAt
        );
      return result.changes === 1;
    } catch {
      return false;
    }
  }

  updateCredentialAfterAuthentication(input: {
    id: string;
    expectedCounter: number;
    newCounter: number;
    deviceType: "singleDevice" | "multiDevice";
    backedUp: boolean;
    usedAt: string;
  }): boolean {
    return (
      getDatabase()
        .prepare(
          `UPDATE forge_webauthn_credentials
           SET counter = ?, device_type = ?, backed_up = ?, last_used_at = ?,
               updated_at = ?
           WHERE id = ? AND counter = ? AND status = 'active'`
        )
        .run(
          input.newCounter,
          input.deviceType,
          input.backedUp ? 1 : 0,
          input.usedAt,
          input.usedAt,
          input.id,
          input.expectedCounter
        ).changes === 1
    );
  }

  storeCapability(
    record: PeerPresenceCapabilityRecord,
    challengeId: string
  ): void {
    getDatabase()
      .prepare(
        `INSERT INTO forge_human_presence_capabilities (
           id, owner_user_id, challenge_id, principal_class, principal_id,
           principal_origin, status, session_binding_keyed_hash,
           capability_keyed_hash, action_digest, issued_at, expires_at,
           consumed_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(
        record.id,
        record.ownerUserId,
        challengeId,
        record.principalClass,
        record.principalId,
        record.origin,
        peerPresenceBindingHash(record, this.sessionBindingKey),
        record.tokenHash,
        record.actionDigest,
        record.issuedAt,
        record.expiresAt
      );
  }

  consumeExact(input: {
    id: string;
    tokenHash: string;
    actionDigest: string;
    principal: PeerPresencePrincipal;
    now: string;
  }): boolean {
    return (
      getDatabase()
        .prepare(
          `UPDATE forge_human_presence_capabilities
           SET status = 'consumed', consumed_at = ?
           WHERE id = ? AND owner_user_id = ? AND principal_class = ?
             AND principal_id = ?
             AND COALESCE(principal_origin, '') = COALESCE(?, '')
             AND session_binding_keyed_hash = ?
             AND capability_keyed_hash = ? AND action_digest = ?
             AND status = 'active' AND expires_at > ?`
        )
        .run(
          input.now,
          input.id,
          input.principal.ownerUserId,
          input.principal.principalClass,
          input.principal.principalId,
          input.principal.origin,
          peerPresenceBindingHash(input.principal, this.sessionBindingKey),
          input.tokenHash,
          input.actionDigest,
          input.now
        ).changes === 1
    );
  }
}

export function listPeerPresenceCredentialSummaries(ownerUserId: string) {
  return getDatabase()
    .prepare(
      `SELECT id, rp_id AS rpId, label, device_type AS deviceType,
              backed_up AS backedUp, created_at AS createdAt,
              last_used_at AS lastUsedAt
       FROM forge_webauthn_credentials
       WHERE owner_user_id = ? AND status = 'active'
       ORDER BY created_at DESC, id
       LIMIT 64`
    )
    .all(ownerUserId)
    .map((row) => {
      const credential = row as {
        id: string;
        rpId: string;
        label: string;
        deviceType: "singleDevice" | "multiDevice";
        backedUp: number;
        createdAt: string;
        lastUsedAt: string | null;
      };
      return { ...credential, backedUp: credential.backedUp === 1 };
    });
}

export function revokePeerPresenceCredential(input: {
  ownerUserId: string;
  credentialId: string;
  now?: Date;
}) {
  const now = (input.now ?? new Date()).toISOString();
  return (
    getDatabase()
      .prepare(
        `UPDATE forge_webauthn_credentials
         SET status = 'revoked', revoked_at = ?, updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND status = 'active'`
      )
      .run(now, now, input.credentialId, input.ownerUserId).changes === 1
  );
}

export function recordPeerPresenceAudit(input: {
  ownerUserId: string;
  eventType: string;
  outcome: "recorded" | "allowed" | "denied" | "failed";
  principal: PeerPresencePrincipal;
  credentialId?: string | null;
  challengeId?: string | null;
  capabilityId?: string | null;
  actionDigest?: string | null;
  evidence?: Record<string, unknown>;
  now?: Date;
}) {
  const now = (input.now ?? new Date()).toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO forge_human_presence_audit_events (
         id, owner_user_id, event_type, outcome, session_binding_keyed_hash,
         principal_class, principal_id, principal_origin, credential_id,
         challenge_id, capability_id, action_digest, evidence_json, created_at
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `pha_${randomUUID().replaceAll("-", "")}`,
      input.ownerUserId,
      input.eventType,
      input.outcome,
      input.principal.principalClass,
      input.principal.principalId,
      input.principal.origin,
      input.credentialId ?? null,
      input.challengeId ?? null,
      input.capabilityId ?? null,
      input.actionDigest ?? null,
      JSON.stringify(input.evidence ?? {}),
      now
    );
}
