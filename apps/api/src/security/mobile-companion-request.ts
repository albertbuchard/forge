import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyRequest } from "fastify";

import { HttpError } from "../errors.js";
import type { VerifiedProtocolPrincipal } from "./application-security-runtime.js";
import type { MobilePairingCredentialVault } from "./mobile-pairing-credential-vault.js";

export const MOBILE_REQUEST_PROTOCOL = "forge-mobile-request/v1";
export const MOBILE_BACKGROUND_REQUEST_PROTOCOL = "forge-mobile-request/v2";
export const MOBILE_REQUEST_MAXIMUM_SKEW_MS = 2 * 60_000;
export const MOBILE_REQUEST_NONCE_TTL_MS = 5 * 60_000;
export const MOBILE_BACKGROUND_REQUEST_MAXIMUM_LIFETIME_MS = 24 * 60 * 60_000;

type PairingRow = {
  id: string;
  user_id: string;
  pairing_token: string;
  status: string;
  expires_at: string;
};

function header(request: FastifyRequest, name: string) {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    throw new HttpError(
      400,
      "mobile_request_header_ambiguous",
      "Mobile request authentication headers must be singular."
    );
  }
  return typeof value === "string" ? value.trim() : null;
}

function fixedLengthEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function canonicalMobileRequest(input: {
  method: string;
  path: string;
  sessionId: string;
  issuedAt: string;
  expiresAt?: string;
  nonce: string;
  bodySha256: string;
  protocol?:
    | typeof MOBILE_REQUEST_PROTOCOL
    | typeof MOBILE_BACKGROUND_REQUEST_PROTOCOL;
}) {
  const protocol = input.protocol ?? MOBILE_REQUEST_PROTOCOL;
  if (protocol === MOBILE_BACKGROUND_REQUEST_PROTOCOL) {
    if (!input.expiresAt) {
      throw new Error("A durable mobile request proof requires an expiry.");
    }
    return [
      "FORGE-MOBILE-REQUEST/2",
      input.method.toUpperCase(),
      input.path,
      input.sessionId,
      input.issuedAt,
      input.expiresAt,
      input.nonce,
      input.bodySha256
    ].join("\n");
  }
  return [
    "FORGE-MOBILE-REQUEST/1",
    input.method.toUpperCase(),
    input.path,
    input.sessionId,
    input.issuedAt,
    input.nonce,
    input.bodySha256
  ].join("\n");
}

function claimNonce(
  database: DatabaseSync,
  input: {
    sessionId: string;
    nonce: string;
    issuedAt: string;
    expiresAt: string;
    now: Date;
  }
) {
  const nonceDigest = createHash("sha256")
    .update("forge-mobile-request-nonce/v1\0", "utf8")
    .update(input.nonce, "utf8")
    .digest("hex");
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `DELETE FROM security_mobile_request_nonces
         WHERE pairing_session_id = ? AND expires_at <= ?`
      )
      .run(input.sessionId, input.now.toISOString());
    database
      .prepare(
        `INSERT INTO security_mobile_request_nonces (
           pairing_session_id, nonce_digest, issued_at, expires_at, created_at
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        input.sessionId,
        nonceDigest,
        input.issuedAt,
        input.expiresAt,
        input.now.toISOString()
      );
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the original SQLite result when BEGIN or the transaction failed.
    }
    const sqliteError = error as {
      code?: unknown;
      errno?: unknown;
      message?: unknown;
    };
    const sqliteCode =
      typeof sqliteError?.code === "string" ? sqliteError.code : "";
    const sqliteErrno =
      typeof sqliteError?.errno === "number" ? sqliteError.errno : null;
    const sqliteMessage =
      typeof sqliteError?.message === "string"
        ? sqliteError.message.toLowerCase()
        : "";
    if (
      sqliteCode === "SQLITE_BUSY" ||
      sqliteCode === "SQLITE_LOCKED" ||
      sqliteErrno === 5 ||
      sqliteErrno === 6 ||
      sqliteMessage.includes("database is locked") ||
      sqliteMessage.includes("database table is locked")
    ) {
      throw new HttpError(
        503,
        "mobile_request_auth_busy",
        "Forge is temporarily busy authenticating this mobile request. It can be retried safely."
      );
    }
    throw new HttpError(
      409,
      "mobile_request_replayed",
      "This mobile request nonce was already used."
    );
  }
}

function injectCompatibilityPairing(
  request: FastifyRequest,
  pairing: PairingRow,
  pairingToken: string
) {
  if (request.body && typeof request.body === "object") {
    Object.assign(request.body as Record<string, unknown>, {
      sessionId: pairing.id,
      pairingToken
    });
  }
  if (request.query && typeof request.query === "object") {
    Object.assign(request.query as Record<string, unknown>, {
      sessionId: pairing.id,
      pairingToken
    });
  }
}

export function authenticateMobileCompanionRequest(
  request: FastifyRequest,
  input: {
    database: DatabaseSync;
    credentials: MobilePairingCredentialVault;
    now?: () => Date;
  }
): VerifiedProtocolPrincipal | null {
  const protocol = header(request, "x-forge-mobile-request-protocol");
  if (!protocol) {
    return null;
  }
  if (
    protocol !== MOBILE_REQUEST_PROTOCOL &&
    protocol !== MOBILE_BACKGROUND_REQUEST_PROTOCOL
  ) {
    throw new HttpError(
      401,
      "mobile_request_protocol_unsupported",
      "Forge requires the registered mobile request protocol."
    );
  }
  const sessionId = header(request, "x-forge-mobile-session-id");
  const issuedAt = header(request, "x-forge-mobile-request-issued-at");
  const expiresAt = header(request, "x-forge-mobile-request-expires-at");
  const nonce = header(request, "x-forge-mobile-request-nonce");
  const bodySha256 = header(request, "x-forge-mobile-body-sha256");
  const signature = header(request, "x-forge-mobile-request-signature");
  if (
    !sessionId ||
    !/^pair_[a-zA-Z0-9_-]{6,128}$/.test(sessionId) ||
    !issuedAt ||
    !nonce ||
    !/^[a-zA-Z0-9_-]{20,160}$/.test(nonce) ||
    !bodySha256 ||
    !/^[a-f0-9]{64}$/.test(bodySha256) ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature)
  ) {
    throw new HttpError(
      401,
      "mobile_request_auth_incomplete",
      "Secure mobile request authentication is incomplete."
    );
  }
  const now = input.now?.() ?? new Date();
  const issuedAtMs = Date.parse(issuedAt);
  const durableBackgroundProof = protocol === MOBILE_BACKGROUND_REQUEST_PROTOCOL;
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const invalidV1Proof =
    !durableBackgroundProof &&
    (!Number.isFinite(issuedAtMs) ||
      Math.abs(now.getTime() - issuedAtMs) > MOBILE_REQUEST_MAXIMUM_SKEW_MS);
  const invalidV2Proof =
    durableBackgroundProof &&
    (!Number.isFinite(issuedAtMs) ||
      !Number.isFinite(expiresAtMs) ||
      issuedAtMs > now.getTime() + MOBILE_REQUEST_MAXIMUM_SKEW_MS ||
      expiresAtMs <= now.getTime() ||
      expiresAtMs <= issuedAtMs ||
      expiresAtMs - issuedAtMs > MOBILE_BACKGROUND_REQUEST_MAXIMUM_LIFETIME_MS);
  if (invalidV1Proof || invalidV2Proof) {
    throw new HttpError(
      401,
      "mobile_request_expired",
      "The mobile request proof is outside the accepted time window."
    );
  }
  const pairing = input.database
    .prepare(`SELECT * FROM companion_pairing_sessions WHERE id = ? LIMIT 1`)
    .get(sessionId) as PairingRow | undefined;
  if (
    !pairing ||
    pairing.status === "revoked" ||
    Date.parse(pairing.expires_at) <= now.getTime()
  ) {
    throw new HttpError(
      401,
      "mobile_request_pairing_invalid",
      "The mobile pairing is invalid, revoked, or expired."
    );
  }
  const pairingToken = input.credentials.readPlaintext(
    pairing.id,
    pairing.pairing_token
  );
  if (!pairingToken) {
    throw new HttpError(
      401,
      "mobile_request_pairing_invalid",
      "The mobile pairing credential is unavailable or revoked."
    );
  }
  const path = request.raw.url ?? request.url;
  const expectedSignature = createHmac("sha256", pairingToken)
    .update(
      canonicalMobileRequest({
        method: request.method,
        path,
        sessionId,
        issuedAt,
        expiresAt: durableBackgroundProof ? expiresAt ?? undefined : undefined,
        nonce,
        bodySha256,
        protocol
      }),
      "utf8"
    )
    .digest("hex");
  if (!fixedLengthEqual(signature, expectedSignature)) {
    throw new HttpError(
      401,
      "mobile_request_signature_invalid",
      "The mobile request signature is invalid."
    );
  }
  claimNonce(input.database, {
    sessionId,
    nonce,
    issuedAt,
    expiresAt: durableBackgroundProof
      ? new Date(expiresAtMs).toISOString()
      : new Date(issuedAtMs + MOBILE_REQUEST_NONCE_TTL_MS).toISOString(),
    now
  });

  return {
    kind: "companion_session",
    subjectId: pairing.id,
    ownerId: pairing.user_id,
    scopes: ["companion"],
    authenticatedAt: now.toISOString(),
    verifyBody(verifiedRequest) {
      const receivedBodySha256 =
        verifiedRequest.forgeSecurity?.receivedBodySha256;
      if (
        !receivedBodySha256 ||
        !fixedLengthEqual(receivedBodySha256, bodySha256)
      ) {
        throw new HttpError(
          401,
          "mobile_request_body_mismatch",
          "The mobile request body does not match its signed digest."
        );
      }
      injectCompatibilityPairing(verifiedRequest, pairing, pairingToken);
    }
  };
}
