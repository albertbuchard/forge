import { createHash, createPublicKey, type KeyObject } from "node:crypto";
import { z } from "zod";

export const PEER_COMPANION_ENROLLMENT_PROTOCOL =
  "forge-peer-companion-enrollment/v2" as const;
export const PEER_COMPANION_REQUEST_PROTOCOL =
  "forge-peer-companion-request/v2" as const;
export const PEER_COMPANION_CONSENT_PROTOCOL =
  "forge-peer-companion-consent/v2" as const;

export const PEER_COMPANION_KEY_ALGORITHM = "ES256" as const;
export const PEER_COMPANION_PUBLIC_KEY_FORMAT = "ansi-x963" as const;
export const PEER_COMPANION_KEY_PROTECTION =
  "secure-enclave-user-presence" as const;

export const PEER_COMPANION_SCOPES = [
  "peer:grants:manage",
  "peer:query",
  "peer:status"
] as const;

export const PEER_COMPANION_CAPABILITIES = [
  PEER_COMPANION_CONSENT_PROTOCOL,
  PEER_COMPANION_ENROLLMENT_PROTOCOL,
  PEER_COMPANION_REQUEST_PROTOCOL
] as const;

// This list mirrors PeerAPIRoute.allCases in the native companion. Enrollment
// routes are operator-only and are intentionally not companion capabilities.
export const PEER_COMPANION_AUTHORIZED_OPERATION_IDS = [
  "acceptPeerGrant",
  "acceptPeerRequest",
  "acceptScannedPeerPairing",
  "approvePeerDevice",
  "cancelPeerInvitation",
  "confirmPeerPairing",
  "counterPeerGrant",
  "createPeerHumanPresenceOptions",
  "createPeerInvitation",
  "getPeerDiagnostics",
  "getPeerHumanPresenceStatus",
  "getPeerInvitationStatus",
  "getPeerRelationship",
  "getPeerSyncStatus",
  "listPeerDevices",
  "listPeerGrants",
  "listPeerRelationships",
  "listPeerRequests",
  "previewPeerGrant",
  "proposePeerGrant",
  "rejectPeerRequest",
  "removePeerDevice",
  "requestPeerResync",
  "revokePeerGrant",
  "revokePeerRelationship",
  "verifyPeerHumanPresence"
] as const;

export const peerCompanionSessionIdSchema = z.string().trim().min(1).max(240);
export const peerCompanionEnrollmentIdSchema = z
  .string()
  .regex(/^pce_[a-f0-9]{32}$/);
export const peerCompanionKeyIdSchema = z.string().regex(/^pck_[a-f0-9]{32}$/);
export const peerCompanionDeviceIdSchema = z
  .string()
  .regex(/^ios_[a-f0-9]{32}$/);
export const peerCompanionPublicKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{87}$/);
export const peerCompanionNonceSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{22,128}$/);
export const peerCompanionP256SignatureSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{88,108}$/);

export const peerCompanionDeviceIdentitySchema = z
  .object({
    deviceId: peerCompanionDeviceIdSchema,
    publicKey: peerCompanionPublicKeySchema,
    algorithm: z.literal(PEER_COMPANION_KEY_ALGORITHM),
    publicKeyFormat: z.literal(PEER_COMPANION_PUBLIC_KEY_FORMAT),
    protection: z.literal(PEER_COMPANION_KEY_PROTECTION)
  })
  .strict();

export type PeerCompanionDeviceIdentity = z.infer<
  typeof peerCompanionDeviceIdentitySchema
>;

export function decodeCanonicalPeerCompanionPublicKey(value: string): Buffer {
  const parsed = peerCompanionPublicKeySchema.parse(value);
  const raw = Buffer.from(parsed, "base64url");
  if (
    raw.byteLength !== 65 ||
    raw[0] !== 0x04 ||
    raw.toString("base64url") !== parsed
  ) {
    throw new Error("Companion public key is not canonical P-256 ANSI X9.63.");
  }
  return raw;
}

export function peerCompanionDeviceId(publicKey: string): string {
  const raw = decodeCanonicalPeerCompanionPublicKey(publicKey);
  return `ios_${createHash("sha256")
    .update("forge-peer/companion-device/p256-secure-enclave/v2\0", "utf8")
    .update(raw)
    .digest("hex")
    .slice(0, 32)}`;
}

export function validatePeerCompanionDeviceIdentity(
  value: unknown
): PeerCompanionDeviceIdentity {
  const identity = peerCompanionDeviceIdentitySchema.parse(value);
  const key = createPeerCompanionPublicKey(identity.publicKey);
  if (!key.asymmetricKeyType || key.asymmetricKeyType !== "ec") {
    throw new Error("Companion public key is not an EC key.");
  }
  if (peerCompanionDeviceId(identity.publicKey) !== identity.deviceId) {
    throw new Error(
      "Companion device identifier does not match its Secure Enclave key."
    );
  }
  return identity;
}

export function createPeerCompanionPublicKey(publicKey: string): KeyObject {
  const raw = decodeCanonicalPeerCompanionPublicKey(publicKey);
  return createPublicKey({
    format: "jwk",
    key: {
      crv: "P-256",
      kty: "EC",
      x: raw.subarray(1, 33).toString("base64url"),
      y: raw.subarray(33, 65).toString("base64url")
    }
  });
}

export function decodeCanonicalPeerCompanionSignature(
  signature: string
): Buffer {
  const parsed = peerCompanionP256SignatureSchema.parse(signature);
  const raw = Buffer.from(parsed, "base64url");
  if (
    raw.byteLength < 66 ||
    raw.byteLength > 80 ||
    raw.toString("base64url") !== parsed
  ) {
    throw new Error("Companion P-256 signature is not canonical DER.");
  }
  return raw;
}
