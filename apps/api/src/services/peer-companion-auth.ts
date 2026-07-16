import { createHash, verify } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import type { SecretsManager } from "../managers/platform/secrets-manager.js";
import { peerPresenceBindingHash } from "../repositories/peer-presence.js";
import type { PeerCompanionRouteContext } from "../routes/peer-sharing.js";
import {
  PEER_COMPANION_KEY_ALGORITHM,
  PEER_COMPANION_REQUEST_PROTOCOL,
  createPeerCompanionPublicKey,
  decodeCanonicalPeerCompanionSignature,
  peerCompanionDeviceIdSchema,
  peerCompanionEnrollmentIdSchema,
  peerCompanionKeyIdSchema,
  peerCompanionNonceSchema,
  peerCompanionSessionIdSchema
} from "./peer-companion-contract.js";
import {
  peerCompanionEnrollmentReceipt,
  type PeerCompanionEnrollmentRow
} from "./peer-companion-enrollment.js";
import {
  capabilitySecretMatches,
  readPeerPresenceCapabilityCookie,
  type PeerPresencePrincipal
} from "./peer-human-presence.js";

export {
  PEER_COMPANION_AUTHORIZED_OPERATION_IDS,
  PEER_COMPANION_CAPABILITIES,
  PEER_COMPANION_REQUEST_PROTOCOL,
  PEER_COMPANION_SCOPES,
  peerCompanionDeviceId
} from "./peer-companion-contract.js";

export const PEER_COMPANION_REQUEST_MAX_SKEW_MS = 2 * 60_000;
export const PEER_COMPANION_REQUEST_NONCE_TTL_MS = 5 * 60_000;

const headerValueSchema = z.string().trim().min(1).max(4_096);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export type PeerCompanionRequestProof = {
  bodySha256: string;
  deviceId: string;
  enrollmentId: string;
  issuedAt: string;
  keyId: string;
  method: string;
  nonce: string;
  ownerUserId: string;
  path: string;
  protocol: typeof PEER_COMPANION_REQUEST_PROTOCOL;
  sessionId: string;
};

type ActiveEnrollmentRow = PeerCompanionEnrollmentRow & {
  pairing_status: string;
  pairing_paired_at: string | null;
  pairing_expires_at: string;
  pairing_owner_user_id: string;
};

function canonicalJson(value: unknown, path = "$"): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Non-finite companion request number at ${path}.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      canonicalJson(entry, `${path}[${index}]`)
    );
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => {
          if (["__proto__", "constructor", "prototype"].includes(key)) {
            throw new Error(`Protected companion request key at ${path}.`);
          }
          if (nested === undefined) {
            throw new Error(
              `Undefined companion request value at ${path}.${key}.`
            );
          }
          return [key, canonicalJson(nested, `${path}.${key}`)];
        })
    );
  }
  throw new Error(`Non-JSON companion request value at ${path}.`);
}

export function hashPeerCompanionRequestBody(body: unknown): string {
  const bytes =
    body === undefined
      ? Buffer.alloc(0)
      : Buffer.from(JSON.stringify(canonicalJson(body)), "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalPeerCompanionRequest(
  input: PeerCompanionRequestProof
): Buffer {
  const parsed = {
    bodySha256: sha256Schema.parse(input.bodySha256),
    deviceId: peerCompanionDeviceIdSchema.parse(input.deviceId),
    enrollmentId: peerCompanionEnrollmentIdSchema.parse(input.enrollmentId),
    issuedAt: z.string().datetime({ offset: true }).parse(input.issuedAt),
    keyId: peerCompanionKeyIdSchema.parse(input.keyId),
    method: z.enum(["GET", "POST", "DELETE"]).parse(input.method),
    nonce: peerCompanionNonceSchema.parse(input.nonce),
    ownerUserId: peerCompanionSessionIdSchema.parse(input.ownerUserId),
    path: z.string().startsWith("/api/v1/").max(4_096).parse(input.path),
    protocol: z.literal(PEER_COMPANION_REQUEST_PROTOCOL).parse(input.protocol),
    sessionId: peerCompanionSessionIdSchema.parse(input.sessionId)
  };
  return Buffer.from(JSON.stringify(parsed), "utf8");
}

export function peerCompanionRequestDigest(
  input: PeerCompanionRequestProof
): string {
  return createHash("sha256")
    .update(canonicalPeerCompanionRequest(input))
    .digest("hex");
}

function requestHeader(
  request: FastifyRequest,
  name: string,
  required: boolean
): string | null {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    throw new HttpError(
      400,
      "peer_companion_header_ambiguous",
      "Companion authentication headers must be singular."
    );
  }
  if (value === undefined) {
    if (required) {
      throw new HttpError(
        401,
        "peer_companion_auth_incomplete",
        "Secure companion request authentication is incomplete."
      );
    }
    return null;
  }
  return headerValueSchema.parse(String(value));
}

function hasCompanionHeader(request: FastifyRequest) {
  return Object.keys(request.headers).some((name) =>
    name.toLowerCase().startsWith("x-forge-companion-")
  );
}

function rejectLegacyBootstrapHeaders(request: FastifyRequest) {
  for (const name of [
    "x-forge-companion-pairing-token",
    "x-forge-companion-public-key"
  ]) {
    if (request.headers[name] !== undefined) {
      throw new HttpError(
        401,
        "peer_companion_legacy_bootstrap_disabled",
        "Legacy caller-selected companion key bootstrap is disabled."
      );
    }
  }
}

function activeEnrollment(input: {
  sessionId: string;
  enrollmentId: string;
  keyId: string;
  deviceId: string;
}): ActiveEnrollmentRow | null {
  return (
    (getDatabase()
      .prepare(
        `SELECT enrollment.enrollment_id, enrollment.key_id,
                enrollment.pairing_session_id, enrollment.owner_user_id,
                enrollment.device_id, enrollment.signing_public_key,
                enrollment.algorithm, enrollment.public_key_format,
                enrollment.protection, enrollment.scopes_json,
                enrollment.capabilities_json,
                enrollment.authorized_operations_json, enrollment.status,
                enrollment.enrolled_at,
                enrollment.legacy_bootstrap_disabled_at,
                enrollment.last_authenticated_at, enrollment.revoked_at,
                enrollment.updated_at, pairing.status AS pairing_status,
                pairing.paired_at AS pairing_paired_at,
                pairing.expires_at AS pairing_expires_at,
                pairing.user_id AS pairing_owner_user_id
         FROM peer_companion_enrollments AS enrollment
         JOIN companion_pairing_sessions AS pairing
           ON pairing.id = enrollment.pairing_session_id
          AND pairing.user_id = enrollment.owner_user_id
         WHERE enrollment.pairing_session_id = ?
           AND enrollment.enrollment_id = ? AND enrollment.key_id = ?
           AND enrollment.device_id = ?
         LIMIT 1`
      )
      .get(
        input.sessionId,
        input.enrollmentId,
        input.keyId,
        input.deviceId
      ) as ActiveEnrollmentRow | undefined) ?? null
  );
}

function assertCurrentEnrollment(row: ActiveEnrollmentRow | null, now: Date) {
  if (
    !row ||
    row.status !== "active" ||
    row.pairing_owner_user_id !== row.owner_user_id ||
    !row.pairing_paired_at ||
    !["paired", "healthy", "stale", "permission_denied"].includes(
      row.pairing_status
    ) ||
    Date.parse(row.pairing_expires_at) <= now.getTime()
  ) {
    throw new HttpError(
      401,
      "peer_companion_enrollment_invalid",
      "The secure companion enrollment is invalid, revoked, or expired."
    );
  }
}

function verifyRequestSignature(input: {
  row: ActiveEnrollmentRow;
  proof: PeerCompanionRequestProof;
  signature: string;
}): boolean {
  return verify(
    "sha256",
    canonicalPeerCompanionRequest(input.proof),
    createPeerCompanionPublicKey(input.row.signing_public_key),
    decodeCanonicalPeerCompanionSignature(input.signature)
  );
}

function recordRequestNonce(input: {
  row: ActiveEnrollmentRow;
  proof: PeerCompanionRequestProof;
  requestDigest: string;
  authenticatedAt: string;
}) {
  return runInTransaction(() => {
    getDatabase()
      .prepare(
        `DELETE FROM peer_companion_v2_request_nonces
         WHERE rowid IN (
           SELECT rowid FROM peer_companion_v2_request_nonces
           WHERE enrollment_id = ? AND expires_at <= ?
           ORDER BY expires_at ASC LIMIT 1000
         )`
      )
      .run(input.row.enrollment_id, input.authenticatedAt);
    const nonceHash = createHash("sha256")
      .update("forge-peer/companion-request-nonce/v2\0", "utf8")
      .update(input.proof.nonce, "utf8")
      .digest("hex");
    try {
      getDatabase()
        .prepare(
          `INSERT INTO peer_companion_v2_request_nonces (
             enrollment_id, nonce_hash, request_digest, issued_at,
             expires_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.row.enrollment_id,
          nonceHash,
          input.requestDigest,
          input.proof.issuedAt,
          new Date(
            Date.parse(input.proof.issuedAt) +
              PEER_COMPANION_REQUEST_NONCE_TTL_MS
          ).toISOString(),
          input.authenticatedAt
        );
    } catch {
      throw new HttpError(
        409,
        "peer_companion_request_replayed",
        "This secure companion request nonce was already used."
      );
    }
    const changed = getDatabase()
      .prepare(
        `UPDATE peer_companion_enrollments
         SET last_authenticated_at = ?, updated_at = ?
         WHERE enrollment_id = ? AND key_id = ? AND status = 'active'`
      )
      .run(
        input.authenticatedAt,
        input.authenticatedAt,
        input.row.enrollment_id,
        input.row.key_id
      ).changes;
    if (changed !== 1) {
      throw new HttpError(
        401,
        "peer_companion_enrollment_invalid",
        "The secure companion enrollment changed during authentication."
      );
    }
  });
}

function consentCapabilityContext(input: {
  request: FastifyRequest;
  ownerUserId: string;
  principalId: string;
  secrets: SecretsManager;
  now: Date;
}): {
  principalClass: "companion_session" | "companion_consent";
  userPresenceAt: string | null;
  presenceCapability: { capabilityId: string; secret: string } | null;
} {
  const cookie = readPeerPresenceCapabilityCookie(
    requestHeader(input.request, "cookie", false)
  );
  if (!cookie) {
    return {
      principalClass: "companion_session",
      userPresenceAt: null,
      presenceCapability: null
    };
  }
  const principal: PeerPresencePrincipal = {
    principalClass: "companion_consent",
    principalId: input.principalId,
    ownerUserId: input.ownerUserId,
    origin: null
  };
  const row = getDatabase()
    .prepare(
      `SELECT issued_at AS issuedAt,
              capability_keyed_hash AS capabilityKeyedHash,
              session_binding_keyed_hash AS sessionBindingKeyedHash
       FROM forge_human_presence_capabilities
       WHERE id = ? AND owner_user_id = ?
         AND principal_class = 'companion_consent' AND principal_id = ?
         AND principal_origin IS NULL AND status IN ('active', 'consumed')
         AND expires_at > ?
       LIMIT 1`
    )
    .get(
      cookie.capabilityId,
      input.ownerUserId,
      input.principalId,
      input.now.toISOString()
    ) as
    | {
        issuedAt: string;
        capabilityKeyedHash: string;
        sessionBindingKeyedHash: string;
      }
    | undefined;
  if (
    !row ||
    row.sessionBindingKeyedHash !==
      peerPresenceBindingHash(
        principal,
        input.secrets.deriveKey("peer-presence-session-binding/v1")
      ) ||
    !capabilitySecretMatches(
      cookie.secret,
      row.capabilityKeyedHash,
      input.secrets.deriveKey("peer-presence-capabilities/v1")
    )
  ) {
    return {
      principalClass: "companion_session",
      userPresenceAt: null,
      presenceCapability: null
    };
  }
  return {
    principalClass: "companion_consent",
    userPresenceAt: row.issuedAt,
    presenceCapability: cookie
  };
}

export function authenticatePeerCompanionRequest(
  request: FastifyRequest,
  dependencies: { secrets: SecretsManager; now?: () => Date }
): PeerCompanionRouteContext | null {
  const sessionId = requestHeader(
    request,
    "x-forge-companion-session-id",
    false
  );
  if (!sessionId) {
    if (hasCompanionHeader(request)) {
      throw new HttpError(
        401,
        "peer_companion_auth_incomplete",
        "Secure companion request authentication is incomplete."
      );
    }
    return null;
  }
  rejectLegacyBootstrapHeaders(request);
  const now = dependencies.now?.() ?? new Date();
  const requestProtocol = requestHeader(
    request,
    "x-forge-companion-request-protocol",
    true
  );
  if (requestProtocol !== PEER_COMPANION_REQUEST_PROTOCOL) {
    throw new HttpError(
      401,
      "peer_companion_protocol_unsupported",
      "Only the registered Secure Enclave companion request protocol is accepted."
    );
  }
  if (
    requestHeader(request, "x-forge-companion-key-algorithm", true) !==
    PEER_COMPANION_KEY_ALGORITHM
  ) {
    throw new HttpError(
      401,
      "peer_companion_key_algorithm_invalid",
      "The companion request must use its registered ES256 key."
    );
  }
  const parsedSessionId = peerCompanionSessionIdSchema.parse(sessionId);
  const enrollmentId = peerCompanionEnrollmentIdSchema.parse(
    requestHeader(request, "x-forge-companion-enrollment-id", true)
  );
  const keyId = peerCompanionKeyIdSchema.parse(
    requestHeader(request, "x-forge-companion-key-id", true)
  );
  const deviceId = peerCompanionDeviceIdSchema.parse(
    requestHeader(request, "x-forge-companion-device-id", true)
  );
  const nonce = peerCompanionNonceSchema.parse(
    requestHeader(request, "x-forge-companion-request-nonce", true)
  );
  const issuedAt = z.string().datetime({ offset: true }).parse(
    requestHeader(request, "x-forge-companion-request-issued-at", true)
  );
  const signature = requestHeader(
    request,
    "x-forge-companion-request-signature",
    true
  )!;
  const issuedAtMs = Date.parse(issuedAt);
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(issuedAtMs) ||
    Math.abs(now.getTime() - issuedAtMs) > PEER_COMPANION_REQUEST_MAX_SKEW_MS
  ) {
    throw new HttpError(
      401,
      "peer_companion_request_expired",
      "The signed companion request is outside the accepted time window."
    );
  }
  const row = activeEnrollment({
    sessionId: parsedSessionId,
    enrollmentId,
    keyId,
    deviceId
  });
  assertCurrentEnrollment(row, now);
  const current = row!;
  const receipt = peerCompanionEnrollmentReceipt(current);
  const path = request.raw.url ?? request.url;
  const proof: PeerCompanionRequestProof = {
    bodySha256: hashPeerCompanionRequestBody(request.body),
    deviceId,
    enrollmentId,
    issuedAt,
    keyId,
    method: request.method,
    nonce,
    ownerUserId: current.owner_user_id,
    path,
    protocol: PEER_COMPANION_REQUEST_PROTOCOL,
    sessionId: parsedSessionId
  };
  if (!verifyRequestSignature({ row: current, proof, signature })) {
    throw new HttpError(
      401,
      "peer_companion_request_signature_invalid",
      "The secure companion request signature is invalid."
    );
  }
  const authenticatedAt = now.toISOString();
  recordRequestNonce({
    row: current,
    proof,
    requestDigest: peerCompanionRequestDigest(proof),
    authenticatedAt
  });
  const consent = consentCapabilityContext({
    request,
    ownerUserId: current.owner_user_id,
    principalId: parsedSessionId,
    secrets: dependencies.secrets,
    now
  });
  return {
    principalClass: consent.principalClass,
    principalId: parsedSessionId,
    ownerUserId: current.owner_user_id,
    deviceId: current.device_id,
    enrollmentId: current.enrollment_id,
    keyId: current.key_id,
    scopes: receipt.scopes,
    authorizedOperations: receipt.authorizedOperations,
    authenticatedAt,
    userPresenceAt: consent.userPresenceAt,
    presenceCapability: consent.presenceCapability
  };
}
