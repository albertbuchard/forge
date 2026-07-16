import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify
} from "node:crypto";
import { z } from "zod";
import { getDatabase, runInTransaction } from "../db.js";
import {
  peerPresenceBindingHash,
  SqlitePeerPresenceStore
} from "../repositories/peer-presence.js";
import {
  PEER_COMPANION_CONSENT_PROTOCOL,
  PEER_COMPANION_KEY_ALGORITHM,
  createPeerCompanionPublicKey,
  decodeCanonicalPeerCompanionSignature,
  peerCompanionDeviceIdSchema,
  peerCompanionKeyIdSchema
} from "./peer-companion-contract.js";
import {
  digestPeerPresenceAction,
  issuePeerPresenceCapability,
  type PeerPresenceAction,
  type PeerPresenceCapabilityRecord,
  type PeerPresencePrincipal
} from "./peer-human-presence.js";

export { PEER_COMPANION_CONSENT_PROTOCOL } from "./peer-companion-contract.js";

export const PEER_COMPANION_CONSENT_TTL_MS = 2 * 60_000;

const challengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

type CompanionChallengeRow = {
  id: string;
  owner_user_id: string;
  principal_id: string;
  challenge_keyed_hash: string;
  action_digest: string;
  expected_origin: string;
  credential_set_version: string;
  issued_at: string;
  expires_at: string;
};

export type PeerCompanionConsentOptions = {
  protocol: typeof PEER_COMPANION_CONSENT_PROTOCOL;
  challengeId: string;
  challenge: string;
  actionDigest: string;
  deviceId: string;
  ownerUserId: string;
  principalId: string;
  issuedAt: string;
  expiresAt: string;
};

export type PeerCompanionConsentSignatureProof =
  PeerCompanionConsentOptions & {
    algorithm: typeof PEER_COMPANION_KEY_ALGORITHM;
    keyId: string;
  };

function challengeHash(challenge: string, key: Uint8Array): string {
  if (key.byteLength < 32) {
    throw new Error("Companion consent challenge hashing requires 32 bytes.");
  }
  return createHmac("sha256", key)
    .update("forge-peer/companion-consent-challenge/v2\0", "utf8")
    .update(challengeSchema.parse(challenge), "utf8")
    .digest("hex");
}

function challengeMatches(
  challenge: string,
  expectedHash: string,
  key: Uint8Array
): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return timingSafeEqual(
    Buffer.from(challengeHash(challenge, key), "hex"),
    Buffer.from(expectedHash, "hex")
  );
}

export function canonicalPeerCompanionConsentSignature(
  input: PeerCompanionConsentSignatureProof
): Buffer {
  const parsed = {
    actionDigest: z.string().regex(/^[a-f0-9]{64}$/).parse(input.actionDigest),
    algorithm: z
      .literal(PEER_COMPANION_KEY_ALGORITHM)
      .parse(input.algorithm),
    challenge: challengeSchema.parse(input.challenge),
    challengeId: z.string().trim().min(1).max(240).parse(input.challengeId),
    deviceId: peerCompanionDeviceIdSchema.parse(input.deviceId),
    expiresAt: z.string().datetime({ offset: true }).parse(input.expiresAt),
    issuedAt: z.string().datetime({ offset: true }).parse(input.issuedAt),
    keyId: peerCompanionKeyIdSchema.parse(input.keyId),
    ownerUserId: z.string().trim().min(1).max(240).parse(input.ownerUserId),
    principalId: z.string().trim().min(1).max(240).parse(input.principalId),
    protocol: z.literal(PEER_COMPANION_CONSENT_PROTOCOL).parse(input.protocol)
  };
  return Buffer.from(JSON.stringify(parsed), "utf8");
}

function companionPrincipal(input: {
  ownerUserId: string;
  principalId: string;
}): PeerPresencePrincipal {
  return {
    principalClass: "companion_consent",
    principalId: input.principalId,
    ownerUserId: input.ownerUserId,
    origin: null
  };
}

export function createPeerCompanionConsentOptions(input: {
  action: PeerPresenceAction;
  ownerUserId: string;
  principalId: string;
  deviceId: string;
  keyId: string;
  challengeHashingKey: Uint8Array;
  sessionBindingKey: Uint8Array;
  now?: Date;
}): PeerCompanionConsentOptions {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Companion consent issue time is invalid.");
  }
  const deviceId = peerCompanionDeviceIdSchema.parse(input.deviceId);
  const keyId = peerCompanionKeyIdSchema.parse(input.keyId);
  const keyIdHash = createHash("sha256").update(keyId, "utf8").digest("hex");
  const principal = companionPrincipal(input);
  const challenge = randomBytes(32).toString("base64url");
  const actionDigest = digestPeerPresenceAction(input.action);
  const challengeId = `pcc_${randomUUID().replaceAll("-", "")}`;
  const issuedAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + PEER_COMPANION_CONSENT_TTL_MS
  ).toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO forge_human_presence_challenges (
         id, owner_user_id, principal_class, principal_id, principal_origin,
         ceremony, status, session_binding_keyed_hash, rp_id, expected_origin,
         challenge_keyed_hash, action_digest, credential_set_version,
         credential_label, verified_credential_id, expires_at, consumed_at,
         issued_at, updated_at
       ) VALUES (?, ?, 'companion_consent', ?, NULL, 'companion', 'pending',
                 ?, 'companion', ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)`
    )
    .run(
      challengeId,
      input.ownerUserId,
      input.principalId,
      peerPresenceBindingHash(principal, input.sessionBindingKey),
      deviceId,
      challengeHash(challenge, input.challengeHashingKey),
      actionDigest,
      keyIdHash,
      expiresAt,
      issuedAt,
      issuedAt
    );
  return {
    protocol: PEER_COMPANION_CONSENT_PROTOCOL,
    challengeId,
    challenge,
    actionDigest,
    deviceId,
    ownerUserId: input.ownerUserId,
    principalId: input.principalId,
    issuedAt,
    expiresAt
  };
}

function signingPublicKey(input: {
  ownerUserId: string;
  principalId: string;
  deviceId: string;
  keyId: string;
}): string | null {
  const row = getDatabase()
    .prepare(
      `SELECT signing_public_key AS publicKey
       FROM peer_companion_enrollments
       WHERE pairing_session_id = ? AND owner_user_id = ? AND device_id = ?
         AND key_id = ? AND algorithm = 'ES256' AND status = 'active'
       LIMIT 1`
    )
    .get(
      input.principalId,
      input.ownerUserId,
      input.deviceId,
      input.keyId
    ) as { publicKey: string } | undefined;
  return row?.publicKey ?? null;
}

export function verifyPeerCompanionConsent(input: {
  challengeId: string;
  challenge: string;
  signature: string;
  algorithm: string;
  keyId: string;
  action: PeerPresenceAction;
  ownerUserId: string;
  principalId: string;
  deviceId: string;
  challengeHashingKey: Uint8Array;
  sessionBindingKey: Uint8Array;
  capabilityHashingKey: Uint8Array;
  presenceStore: SqlitePeerPresenceStore;
  now?: Date;
}): {
  capability: { secret: string; record: PeerPresenceCapabilityRecord };
  actionDigest: string;
  verifiedAt: string;
} {
  const now = input.now ?? new Date();
  const actionDigest = digestPeerPresenceAction(input.action);
  const principal = companionPrincipal(input);
  const deviceId = peerCompanionDeviceIdSchema.parse(input.deviceId);
  const keyId = peerCompanionKeyIdSchema.parse(input.keyId);
  const algorithm = z
    .literal(PEER_COMPANION_KEY_ALGORITHM)
    .parse(input.algorithm);
  const signature = decodeCanonicalPeerCompanionSignature(input.signature);
  return runInTransaction(() => {
    const row = getDatabase()
      .prepare(
        `SELECT id, owner_user_id, principal_id, challenge_keyed_hash,
                action_digest, expected_origin, credential_set_version,
                issued_at,
                expires_at
         FROM forge_human_presence_challenges
         WHERE id = ? AND owner_user_id = ?
           AND principal_class = 'companion_consent' AND principal_id = ?
           AND principal_origin IS NULL AND ceremony = 'companion'
           AND session_binding_keyed_hash = ? AND action_digest = ?
           AND expected_origin = ? AND credential_set_version = ?
           AND status = 'pending' AND expires_at > ?
         LIMIT 1`
      )
      .get(
        input.challengeId,
        input.ownerUserId,
        input.principalId,
        peerPresenceBindingHash(principal, input.sessionBindingKey),
        actionDigest,
        deviceId,
        createHash("sha256").update(keyId, "utf8").digest("hex"),
        now.toISOString()
      ) as CompanionChallengeRow | undefined;
    if (
      !row ||
      !challengeMatches(
        input.challenge,
        row.challenge_keyed_hash,
        input.challengeHashingKey
      )
    ) {
      throw new Error(
        "Companion consent challenge is invalid, expired, replayed, or action-mismatched."
      );
    }
    const publicKey = signingPublicKey({
      ownerUserId: input.ownerUserId,
      principalId: input.principalId,
      deviceId,
      keyId
    });
    if (!publicKey) {
      throw new Error("Secure companion enrollment key is unavailable.");
    }
    const proof: PeerCompanionConsentSignatureProof = {
      protocol: PEER_COMPANION_CONSENT_PROTOCOL,
      challengeId: row.id,
      challenge: challengeSchema.parse(input.challenge),
      actionDigest: row.action_digest,
      algorithm,
      deviceId,
      expiresAt: row.expires_at,
      issuedAt: row.issued_at,
      keyId,
      ownerUserId: row.owner_user_id,
      principalId: row.principal_id
    };
    if (
      !verify(
        "sha256",
        canonicalPeerCompanionConsentSignature(proof),
        createPeerCompanionPublicKey(publicKey),
        signature
      )
    ) {
      throw new Error("Companion consent signature is invalid.");
    }
    const verifiedAt = now.toISOString();
    const changed = getDatabase()
      .prepare(
        `UPDATE forge_human_presence_challenges
         SET status = 'consumed', consumed_at = ?, updated_at = ?,
             verified_credential_id = NULL
         WHERE id = ? AND status = 'pending'`
      )
      .run(verifiedAt, verifiedAt, row.id).changes;
    if (changed !== 1) {
      throw new Error("Companion consent challenge was already consumed.");
    }
    const capability = issuePeerPresenceCapability({
      id: `phc_${randomUUID().replaceAll("-", "")}`,
      action: input.action,
      principal,
      hashingKey: input.capabilityHashingKey,
      now
    });
    input.presenceStore.storeCapability(capability.record, row.id);
    return { capability, actionDigest, verifiedAt };
  });
}
