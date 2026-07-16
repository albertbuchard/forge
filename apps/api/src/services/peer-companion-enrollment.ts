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
import { HttpError } from "../errors.js";
import {
  PEER_COMPANION_AUTHORIZED_OPERATION_IDS,
  PEER_COMPANION_CAPABILITIES,
  PEER_COMPANION_ENROLLMENT_PROTOCOL,
  PEER_COMPANION_SCOPES,
  createPeerCompanionPublicKey,
  decodeCanonicalPeerCompanionSignature,
  peerCompanionDeviceIdentitySchema,
  validatePeerCompanionDeviceIdentity,
  type PeerCompanionDeviceIdentity
} from "./peer-companion-contract.js";

export const PEER_COMPANION_ENROLLMENT_TTL_MS = 5 * 60_000;

const identifierSchema = z.string().trim().min(1).max(240);
const challengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const signatureHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const peerCompanionEnrollmentOptionsInputSchema = z
  .object({
    protocol: z.literal(PEER_COMPANION_ENROLLMENT_PROTOCOL),
    enrollmentAttemptId: identifierSchema,
    pairingSessionId: identifierSchema,
    device: peerCompanionDeviceIdentitySchema
  })
  .strict();

export const peerCompanionEnrollmentVerifyInputSchema = z
  .object({
    protocol: z.literal(PEER_COMPANION_ENROLLMENT_PROTOCOL),
    challengeId: identifierSchema,
    enrollmentAttemptId: identifierSchema,
    pairingSessionId: identifierSchema,
    signature: z.string().regex(/^[A-Za-z0-9_-]{88,108}$/)
  })
  .strict();

export type PeerCompanionEnrollmentOptionsInput = z.infer<
  typeof peerCompanionEnrollmentOptionsInputSchema
>;
export type PeerCompanionEnrollmentVerifyInput = z.infer<
  typeof peerCompanionEnrollmentVerifyInputSchema
>;

export type PeerCompanionEnrollmentOptions = {
  protocol: typeof PEER_COMPANION_ENROLLMENT_PROTOCOL;
  challengeId: string;
  challenge: string;
  enrollmentAttemptId: string;
  pairingSessionId: string;
  ownerUserId: string;
  device: PeerCompanionDeviceIdentity;
  issuedAt: string;
  expiresAt: string;
};

export type PeerCompanionEnrollmentProof = {
  algorithm: "ES256";
  challenge: string;
  challengeId: string;
  deviceId: string;
  enrollmentAttemptId: string;
  expiresAt: string;
  issuedAt: string;
  ownerUserId: string;
  pairingSessionId: string;
  protocol: typeof PEER_COMPANION_ENROLLMENT_PROTOCOL;
  publicKey: string;
  publicKeyFormat: "ansi-x963";
  protection: "secure-enclave-user-presence";
};

export type PeerCompanionEnrollmentReceipt = {
  protocol: typeof PEER_COMPANION_ENROLLMENT_PROTOCOL;
  enrollmentId: string;
  keyId: string;
  pairingSessionId: string;
  ownerUserId: string;
  device: PeerCompanionDeviceIdentity;
  scopes: string[];
  capabilities: string[];
  authorizedOperations: string[];
  enrolledAt: string;
  legacyBootstrapDisabledAt: string;
  legacyBootstrapAccepted: false;
};

type PairingRow = {
  id: string;
  user_id: string;
  status: string;
  paired_at: string | null;
  expires_at: string;
};

type ChallengeRow = {
  id: string;
  owner_user_id: string;
  operator_session_id: string;
  pairing_session_id: string;
  enrollment_attempt_id: string;
  device_id: string;
  signing_public_key: string;
  algorithm: "ES256";
  public_key_format: "ansi-x963";
  protection: "secure-enclave-user-presence";
  challenge: string;
  challenge_keyed_hash: string;
  status: "pending" | "consumed" | "expired" | "rejected";
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
  enrollment_id: string | null;
  verification_signature_hash: string | null;
};

export type PeerCompanionEnrollmentRow = {
  enrollment_id: string;
  key_id: string;
  pairing_session_id: string;
  owner_user_id: string;
  device_id: string;
  signing_public_key: string;
  algorithm: "ES256";
  public_key_format: "ansi-x963";
  protection: "secure-enclave-user-presence";
  scopes_json: string;
  capabilities_json: string;
  authorized_operations_json: string;
  status: "active" | "revoked";
  enrolled_at: string;
  legacy_bootstrap_disabled_at: string;
  last_authenticated_at: string;
  revoked_at: string | null;
  updated_at: string;
};

function establishedPairing(
  pairingSessionId: string,
  ownerUserId: string,
  now: Date
): PairingRow {
  const row = getDatabase()
    .prepare(
      `SELECT id, user_id, status, paired_at, expires_at
       FROM companion_pairing_sessions
       WHERE id = ? AND user_id = ?
       LIMIT 1`
    )
    .get(pairingSessionId, ownerUserId) as PairingRow | undefined;
  if (
    !row ||
    !row.paired_at ||
    !["paired", "healthy", "stale", "permission_denied"].includes(
      row.status
    ) ||
    Date.parse(row.expires_at) <= now.getTime()
  ) {
    throw new HttpError(
      409,
      "peer_companion_pairing_not_established",
      "Secure companion enrollment requires a current established pairing."
    );
  }
  return row;
}

function challengeHash(challenge: string, key: Uint8Array): string {
  if (key.byteLength < 32) {
    throw new Error("Companion enrollment challenge hashing requires 32 bytes.");
  }
  return createHmac("sha256", key)
    .update("forge-peer/companion-enrollment-challenge/v2\0", "utf8")
    .update(challengeSchema.parse(challenge), "utf8")
    .digest("hex");
}

function challengeMatches(
  challenge: string,
  expectedHash: string,
  key: Uint8Array
): boolean {
  if (!signatureHashSchema.safeParse(expectedHash).success) return false;
  return timingSafeEqual(
    Buffer.from(challengeHash(challenge, key), "hex"),
    Buffer.from(expectedHash, "hex")
  );
}

function identityFromChallenge(row: ChallengeRow): PeerCompanionDeviceIdentity {
  return validatePeerCompanionDeviceIdentity({
    deviceId: row.device_id,
    publicKey: row.signing_public_key,
    algorithm: row.algorithm,
    publicKeyFormat: row.public_key_format,
    protection: row.protection
  });
}

function activeEnrollmentForPairing(
  pairingSessionId: string
): PeerCompanionEnrollmentRow | null {
  return (
    (getDatabase()
      .prepare(
        `SELECT enrollment_id, key_id, pairing_session_id, owner_user_id,
                device_id, signing_public_key, algorithm, public_key_format,
                protection, scopes_json, capabilities_json,
                authorized_operations_json, status, enrolled_at,
                legacy_bootstrap_disabled_at, last_authenticated_at,
                revoked_at, updated_at
         FROM peer_companion_enrollments
         WHERE pairing_session_id = ?
         LIMIT 1`
      )
      .get(pairingSessionId) as PeerCompanionEnrollmentRow | undefined) ?? null
  );
}

function assertEnrollmentBinding(
  enrollment: PeerCompanionEnrollmentRow,
  input: {
    ownerUserId: string;
    pairingSessionId: string;
    identity: PeerCompanionDeviceIdentity;
  }
) {
  if (
    enrollment.status !== "active" ||
    enrollment.owner_user_id !== input.ownerUserId ||
    enrollment.pairing_session_id !== input.pairingSessionId ||
    enrollment.device_id !== input.identity.deviceId ||
    enrollment.signing_public_key !== input.identity.publicKey ||
    enrollment.algorithm !== input.identity.algorithm ||
    enrollment.public_key_format !== input.identity.publicKeyFormat ||
    enrollment.protection !== input.identity.protection
  ) {
    throw new HttpError(
      409,
      "peer_companion_enrollment_binding_conflict",
      "This pairing is already bound to another secure companion enrollment."
    );
  }
}

function exactStringArray(value: string, expected: readonly string[]) {
  const parsed = z.array(z.string()).safeParse(JSON.parse(value));
  return (
    parsed.success &&
    parsed.data.length === expected.length &&
    parsed.data.every((entry, index) => entry === expected[index])
  );
}

export function peerCompanionEnrollmentReceipt(
  row: PeerCompanionEnrollmentRow
): PeerCompanionEnrollmentReceipt {
  if (
    row.status !== "active" ||
    !exactStringArray(row.scopes_json, PEER_COMPANION_SCOPES) ||
    !exactStringArray(row.capabilities_json, PEER_COMPANION_CAPABILITIES) ||
    !exactStringArray(
      row.authorized_operations_json,
      PEER_COMPANION_AUTHORIZED_OPERATION_IDS
    )
  ) {
    throw new HttpError(
      403,
      "peer_companion_enrollment_policy_invalid",
      "The secure companion enrollment policy binding is invalid."
    );
  }
  return {
    protocol: PEER_COMPANION_ENROLLMENT_PROTOCOL,
    enrollmentId: row.enrollment_id,
    keyId: row.key_id,
    pairingSessionId: row.pairing_session_id,
    ownerUserId: row.owner_user_id,
    device: validatePeerCompanionDeviceIdentity({
      deviceId: row.device_id,
      publicKey: row.signing_public_key,
      algorithm: row.algorithm,
      publicKeyFormat: row.public_key_format,
      protection: row.protection
    }),
    scopes: [...PEER_COMPANION_SCOPES],
    capabilities: [...PEER_COMPANION_CAPABILITIES],
    authorizedOperations: [...PEER_COMPANION_AUTHORIZED_OPERATION_IDS],
    enrolledAt: row.enrolled_at,
    legacyBootstrapDisabledAt: row.legacy_bootstrap_disabled_at,
    legacyBootstrapAccepted: false
  };
}

export function canonicalPeerCompanionEnrollmentProof(
  input: PeerCompanionEnrollmentProof
): Buffer {
  const parsed = {
    algorithm: z.literal("ES256").parse(input.algorithm),
    challenge: challengeSchema.parse(input.challenge),
    challengeId: identifierSchema.parse(input.challengeId),
    deviceId: identifierSchema.parse(input.deviceId),
    enrollmentAttemptId: identifierSchema.parse(input.enrollmentAttemptId),
    expiresAt: z.string().datetime({ offset: true }).parse(input.expiresAt),
    issuedAt: z.string().datetime({ offset: true }).parse(input.issuedAt),
    ownerUserId: identifierSchema.parse(input.ownerUserId),
    pairingSessionId: identifierSchema.parse(input.pairingSessionId),
    protocol: z
      .literal(PEER_COMPANION_ENROLLMENT_PROTOCOL)
      .parse(input.protocol),
    publicKey: z.string().parse(input.publicKey),
    publicKeyFormat: z.literal("ansi-x963").parse(input.publicKeyFormat),
    protection: z
      .literal("secure-enclave-user-presence")
      .parse(input.protection)
  };
  return Buffer.from(JSON.stringify(parsed), "utf8");
}

export function createPeerCompanionEnrollmentOptions(input: {
  body: PeerCompanionEnrollmentOptionsInput;
  ownerUserId: string;
  operatorSessionId: string;
  challengeHashingKey: Uint8Array;
  now?: Date;
}): PeerCompanionEnrollmentOptions {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Companion enrollment clock is invalid.");
  }
  const body = peerCompanionEnrollmentOptionsInputSchema.parse(input.body);
  const identity = validatePeerCompanionDeviceIdentity(body.device);
  const issuedAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + PEER_COMPANION_ENROLLMENT_TTL_MS
  ).toISOString();
  const challenge = randomBytes(32).toString("base64url");
  const challengeId = `pec_${randomUUID().replaceAll("-", "")}`;

  return runInTransaction(() => {
    establishedPairing(body.pairingSessionId, input.ownerUserId, now);
    const existing = activeEnrollmentForPairing(body.pairingSessionId);
    if (existing) {
      assertEnrollmentBinding(existing, {
        ownerUserId: input.ownerUserId,
        pairingSessionId: body.pairingSessionId,
        identity
      });
    }
    getDatabase()
      .prepare(
        `UPDATE peer_companion_enrollment_challenges
         SET status = 'expired', updated_at = ?
         WHERE owner_user_id = ? AND operator_session_id = ?
           AND pairing_session_id = ? AND enrollment_attempt_id = ?
           AND status = 'pending'`
      )
      .run(
        issuedAt,
        input.ownerUserId,
        input.operatorSessionId,
        body.pairingSessionId,
        body.enrollmentAttemptId
      );
    getDatabase()
      .prepare(
        `INSERT INTO peer_companion_enrollment_challenges (
           id, owner_user_id, operator_session_id, pairing_session_id,
           enrollment_attempt_id, device_id, signing_public_key, algorithm,
           public_key_format, protection, challenge, challenge_keyed_hash,
           status, issued_at, expires_at, consumed_at, enrollment_id,
           verification_signature_hash, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?,
                   NULL, NULL, NULL, ?)`
      )
      .run(
        challengeId,
        input.ownerUserId,
        input.operatorSessionId,
        body.pairingSessionId,
        body.enrollmentAttemptId,
        identity.deviceId,
        identity.publicKey,
        identity.algorithm,
        identity.publicKeyFormat,
        identity.protection,
        challenge,
        challengeHash(challenge, input.challengeHashingKey),
        issuedAt,
        expiresAt,
        issuedAt
      );
    return {
      protocol: PEER_COMPANION_ENROLLMENT_PROTOCOL,
      challengeId,
      challenge,
      enrollmentAttemptId: body.enrollmentAttemptId,
      pairingSessionId: body.pairingSessionId,
      ownerUserId: input.ownerUserId,
      device: identity,
      issuedAt,
      expiresAt
    };
  });
}

export function verifyPeerCompanionEnrollment(input: {
  body: PeerCompanionEnrollmentVerifyInput;
  ownerUserId: string;
  operatorSessionId: string;
  challengeHashingKey: Uint8Array;
  now?: Date;
}): PeerCompanionEnrollmentReceipt {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Companion enrollment clock is invalid.");
  }
  const body = peerCompanionEnrollmentVerifyInputSchema.parse(input.body);
  const nowIso = now.toISOString();
  const signature = decodeCanonicalPeerCompanionSignature(body.signature);
  const verificationSignatureHash = createHash("sha256")
    .update(signature)
    .digest("hex");

  return runInTransaction(() => {
    establishedPairing(body.pairingSessionId, input.ownerUserId, now);
    const row = getDatabase()
      .prepare(
        `SELECT id, owner_user_id, operator_session_id, pairing_session_id,
                enrollment_attempt_id, device_id, signing_public_key,
                algorithm, public_key_format, protection, challenge,
                challenge_keyed_hash, status, issued_at, expires_at,
                consumed_at, enrollment_id, verification_signature_hash
         FROM peer_companion_enrollment_challenges
         WHERE id = ? AND owner_user_id = ? AND operator_session_id = ?
           AND pairing_session_id = ? AND enrollment_attempt_id = ?
         LIMIT 1`
      )
      .get(
        body.challengeId,
        input.ownerUserId,
        input.operatorSessionId,
        body.pairingSessionId,
        body.enrollmentAttemptId
      ) as ChallengeRow | undefined;
    if (
      !row ||
      row.status !== "pending" ||
      Date.parse(row.expires_at) <= now.getTime() ||
      !challengeMatches(
        row.challenge,
        row.challenge_keyed_hash,
        input.challengeHashingKey
      )
    ) {
      throw new HttpError(
        409,
        "peer_companion_enrollment_challenge_invalid",
        "The secure companion enrollment challenge is invalid, expired, or already used."
      );
    }
    const identity = identityFromChallenge(row);
    const proof: PeerCompanionEnrollmentProof = {
      algorithm: identity.algorithm,
      challenge: row.challenge,
      challengeId: row.id,
      deviceId: identity.deviceId,
      enrollmentAttemptId: row.enrollment_attempt_id,
      expiresAt: row.expires_at,
      issuedAt: row.issued_at,
      ownerUserId: row.owner_user_id,
      pairingSessionId: row.pairing_session_id,
      protocol: PEER_COMPANION_ENROLLMENT_PROTOCOL,
      publicKey: identity.publicKey,
      publicKeyFormat: identity.publicKeyFormat,
      protection: identity.protection
    };
    if (
      !verify(
        "sha256",
        canonicalPeerCompanionEnrollmentProof(proof),
        createPeerCompanionPublicKey(identity.publicKey),
        signature
      )
    ) {
      throw new HttpError(
        401,
        "peer_companion_enrollment_signature_invalid",
        "The secure companion enrollment proof is invalid."
      );
    }

    let enrollment = activeEnrollmentForPairing(row.pairing_session_id);
    if (enrollment) {
      assertEnrollmentBinding(enrollment, {
        ownerUserId: row.owner_user_id,
        pairingSessionId: row.pairing_session_id,
        identity
      });
    } else {
      const enrollmentId = `pce_${randomUUID().replaceAll("-", "")}`;
      const keyId = `pck_${randomUUID().replaceAll("-", "")}`;
      getDatabase()
        .prepare(
          `INSERT INTO peer_companion_enrollments (
             enrollment_id, key_id, pairing_session_id, owner_user_id,
             device_id, signing_public_key, algorithm, public_key_format,
             protection, scopes_json, capabilities_json,
             authorized_operations_json, status, enrolled_at,
             legacy_bootstrap_disabled_at, last_authenticated_at,
             revoked_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?,
                     NULL, ?)`
        )
        .run(
          enrollmentId,
          keyId,
          row.pairing_session_id,
          row.owner_user_id,
          identity.deviceId,
          identity.publicKey,
          identity.algorithm,
          identity.publicKeyFormat,
          identity.protection,
          JSON.stringify(PEER_COMPANION_SCOPES),
          JSON.stringify(PEER_COMPANION_CAPABILITIES),
          JSON.stringify(PEER_COMPANION_AUTHORIZED_OPERATION_IDS),
          nowIso,
          nowIso,
          nowIso,
          nowIso
        );
      enrollment = activeEnrollmentForPairing(row.pairing_session_id);
    }
    if (!enrollment) {
      throw new Error("Secure companion enrollment was not persisted.");
    }
    getDatabase()
      .prepare(
        `UPDATE peer_companion_credentials
         SET status = 'revoked', revoked_at = ?, updated_at = ?
         WHERE pairing_session_id = ? AND status = 'active'`
      )
      .run(nowIso, nowIso, row.pairing_session_id);
    const consumed = getDatabase()
      .prepare(
        `UPDATE peer_companion_enrollment_challenges
         SET status = 'consumed', consumed_at = ?, enrollment_id = ?,
             verification_signature_hash = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(
        nowIso,
        enrollment.enrollment_id,
        verificationSignatureHash,
        nowIso,
        row.id
      ).changes;
    if (consumed !== 1) {
      throw new HttpError(
        409,
        "peer_companion_enrollment_challenge_replayed",
        "The secure companion enrollment challenge was already used."
      );
    }
    return peerCompanionEnrollmentReceipt(enrollment);
  });
}
