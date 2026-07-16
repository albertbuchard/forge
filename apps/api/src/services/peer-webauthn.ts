import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type WebAuthnCredential
} from "@simplewebauthn/server";
import { z } from "zod";
import {
  digestPeerPresenceAction,
  issuePeerPresenceCapability,
  type PeerPresenceAction,
  type PeerPresenceCapabilityRecord,
  type PeerPresencePrincipal
} from "./peer-human-presence.js";

export const PEER_WEBAUTHN_CHALLENGE_TTL_SECONDS = 2 * 60;

const base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);
const canonicalBase64Schema = z
  .string()
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const transportSchema = z.enum([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb"
]);

const registrationResponseSchema = z
  .object({
    id: base64UrlSchema.max(2_048),
    rawId: base64UrlSchema.max(2_048),
    response: z
      .object({
        clientDataJSON: base64UrlSchema.max(16_384),
        attestationObject: base64UrlSchema.max(65_536),
        authenticatorData: base64UrlSchema.max(16_384).optional(),
        transports: z.array(transportSchema).max(16).optional(),
        publicKeyAlgorithm: z.number().int().optional(),
        publicKey: base64UrlSchema.max(16_384).optional()
      })
      .strict(),
    authenticatorAttachment: z
      .enum(["cross-platform", "platform"])
      .nullable()
      .optional(),
    clientExtensionResults: z.record(z.unknown()),
    type: z.literal("public-key")
  })
  .strict();

const authenticationResponseSchema = z
  .object({
    id: base64UrlSchema.max(2_048),
    rawId: base64UrlSchema.max(2_048),
    response: z
      .object({
        clientDataJSON: base64UrlSchema.max(16_384),
        authenticatorData: base64UrlSchema.max(16_384),
        signature: base64UrlSchema.max(16_384),
        userHandle: base64UrlSchema.max(2_048).optional()
      })
      .strict(),
    authenticatorAttachment: z
      .enum(["cross-platform", "platform"])
      .nullable()
      .optional(),
    clientExtensionResults: z.record(z.unknown()),
    type: z.literal("public-key")
  })
  .strict();

export type PeerWebAuthnCredentialRecord = {
  id: string;
  ownerUserId: string;
  rpId: string;
  credentialId: string;
  publicKeyBase64: string;
  counter: number;
  transports: AuthenticatorTransportFuture[];
  label: string;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  aaguid: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type PeerWebAuthnChallengeRecord = PeerPresencePrincipal & {
  id: string;
  ceremony: "register" | "authenticate";
  challengeHash: string;
  actionDigest: string;
  rpId: string;
  expectedOrigin: string;
  credentialSetVersion: string;
  credentialLabel: string | null;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

export type PeerWebAuthnStore = {
  listActiveCredentials(
    ownerUserId: string,
    rpId: string
  ): PeerWebAuthnCredentialRecord[];
  createChallenge(record: PeerWebAuthnChallengeRecord): void;
  claimChallenge(input: {
    id: string;
    principal: PeerPresencePrincipal;
    actionDigest: string;
    rpId: string;
    expectedOrigin: string;
    now: string;
  }): PeerWebAuthnChallengeRecord | null;
  createCredential(record: PeerWebAuthnCredentialRecord): boolean;
  updateCredentialAfterAuthentication(input: {
    id: string;
    expectedCounter: number;
    newCounter: number;
    deviceType: "singleDevice" | "multiDevice";
    backedUp: boolean;
    usedAt: string;
  }): boolean;
};

export type PeerWebAuthnRelyingParty = {
  origin: string;
  rpId: string;
  loopback: boolean;
};

export function resolvePeerWebAuthnRelyingParty(
  rawOrigin: string
): PeerWebAuthnRelyingParty {
  const parsed = new URL(rawOrigin);
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== rawOrigin
  ) {
    throw new Error(
      "WebAuthn requires an exact Forge origin without URL extras."
    );
  }
  const hostname = parsed.hostname.toLocaleLowerCase("en-US");
  const loopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]";
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && loopback)
  ) {
    throw new Error(
      "WebAuthn requires HTTPS except on a loopback Forge origin."
    );
  }
  return {
    origin: parsed.origin,
    rpId: hostname === "[::1]" ? "::1" : hostname,
    loopback
  };
}

function hashBoundSecret(value: string, key: Uint8Array): string {
  if (key.byteLength < 32) {
    throw new Error("WebAuthn challenge hashing requires a 32-byte key.");
  }
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

export function peerWebAuthnChallengeMatches(
  candidate: string,
  expectedHash: string,
  hashingKey: Uint8Array
): boolean {
  if (!base64UrlSchema.min(32).max(512).safeParse(candidate).success) {
    return false;
  }
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
    return false;
  }
  const actual = hashBoundSecret(candidate, hashingKey);
  return timingSafeEqual(
    Buffer.from(actual, "hex"),
    Buffer.from(expectedHash, "hex")
  );
}

export function peerWebAuthnCredentialSetVersion(
  credentials: PeerWebAuthnCredentialRecord[]
): string {
  const ids = credentials.map((credential) => credential.credentialId).sort();
  return createHash("sha256")
    .update("forge-peer/webauthn-credential-set/v1\0", "utf8")
    .update(JSON.stringify(ids), "utf8")
    .digest("hex");
}

function toWebAuthnCredential(
  credential: PeerWebAuthnCredentialRecord
): WebAuthnCredential {
  if (!canonicalBase64Schema.safeParse(credential.publicKeyBase64).success) {
    throw new Error("Stored WebAuthn credential key encoding is invalid.");
  }
  const publicKey = Buffer.from(credential.publicKeyBase64, "base64");
  if (publicKey.toString("base64") !== credential.publicKeyBase64) {
    throw new Error(
      "Stored WebAuthn credential key encoding is not canonical."
    );
  }
  return {
    id: credential.credentialId,
    publicKey: new Uint8Array(publicKey),
    counter: credential.counter,
    transports: credential.transports
  };
}

export async function createPeerWebAuthnOptions(input: {
  ceremony: "register" | "authenticate";
  action: PeerPresenceAction;
  principal: PeerPresencePrincipal;
  origin: string;
  credentialLabel?: string;
  additionalRegistrationAuthorized?: boolean;
  hashingKey: Uint8Array;
  store: PeerWebAuthnStore;
  now?: Date;
}) {
  if (input.principal.principalClass !== "operator_session") {
    throw new Error("Browser WebAuthn ceremonies require an operator session.");
  }
  const relyingParty = resolvePeerWebAuthnRelyingParty(input.origin);
  if (input.principal.origin !== relyingParty.origin) {
    throw new Error("WebAuthn origin does not match the operator session.");
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("WebAuthn ceremony issue time is invalid.");
  }
  const credentials = input.store.listActiveCredentials(
    input.principal.ownerUserId,
    relyingParty.rpId
  );
  if (input.ceremony === "authenticate" && credentials.length === 0) {
    throw new Error(
      "No approval credential is registered for this Forge origin."
    );
  }
  if (
    input.ceremony === "register" &&
    credentials.length === 0 &&
    !relyingParty.loopback
  ) {
    throw new Error(
      "The first approval credential must be registered on loopback."
    );
  }
  if (
    input.ceremony === "register" &&
    credentials.length > 0 &&
    !input.additionalRegistrationAuthorized
  ) {
    throw new Error(
      "Adding an approval credential requires a current approval."
    );
  }

  const challenge = randomBytes(32);
  const actionDigest = digestPeerPresenceAction(input.action);
  const options =
    input.ceremony === "register"
      ? await generateRegistrationOptions({
          rpName: "Forge",
          rpID: relyingParty.rpId,
          userName: "Forge operator",
          userDisplayName: "Forge operator",
          userID: createHash("sha256")
            .update("forge-peer/webauthn-user/v1\0", "utf8")
            .update(input.principal.ownerUserId, "utf8")
            .update("\0", "utf8")
            .update(relyingParty.rpId, "utf8")
            .digest(),
          challenge,
          timeout: PEER_WEBAUTHN_CHALLENGE_TTL_SECONDS * 1_000,
          attestationType: "none",
          excludeCredentials: credentials.map((credential) => ({
            id: credential.credentialId,
            transports: credential.transports
          })),
          authenticatorSelection: {
            residentKey: "preferred",
            userVerification: "required"
          }
        })
      : await generateAuthenticationOptions({
          rpID: relyingParty.rpId,
          challenge,
          timeout: PEER_WEBAUTHN_CHALLENGE_TTL_SECONDS * 1_000,
          userVerification: "required",
          allowCredentials: credentials.map((credential) => ({
            id: credential.credentialId,
            transports: credential.transports
          }))
        });

  const challengeRecord: PeerWebAuthnChallengeRecord = {
    ...input.principal,
    id: `pwc_${randomUUID().replaceAll("-", "")}`,
    ceremony: input.ceremony,
    challengeHash: hashBoundSecret(options.challenge, input.hashingKey),
    actionDigest,
    rpId: relyingParty.rpId,
    expectedOrigin: relyingParty.origin,
    credentialSetVersion: peerWebAuthnCredentialSetVersion(credentials),
    credentialLabel:
      input.ceremony === "register"
        ? z
            .string()
            .trim()
            .min(1)
            .max(120)
            .parse(input.credentialLabel ?? "Platform authenticator")
        : null,
    issuedAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + PEER_WEBAUTHN_CHALLENGE_TTL_SECONDS * 1_000
    ).toISOString(),
    consumedAt: null
  };

  input.store.createChallenge(challengeRecord);
  return {
    challengeId: challengeRecord.id,
    ceremony: input.ceremony,
    options
  };
}

export async function verifyPeerWebAuthnCeremony(input: {
  challengeId: string;
  action: PeerPresenceAction;
  principal: PeerPresencePrincipal;
  origin: string;
  response: unknown;
  capabilityId: string;
  capabilityHashingKey: Uint8Array;
  challengeHashingKey: Uint8Array;
  store: PeerWebAuthnStore;
  now?: Date;
}): Promise<{
  capability: { secret: string; record: PeerPresenceCapabilityRecord };
  credential: PeerWebAuthnCredentialRecord;
}> {
  const relyingParty = resolvePeerWebAuthnRelyingParty(input.origin);
  if (
    input.principal.principalClass !== "operator_session" ||
    input.principal.origin !== relyingParty.origin
  ) {
    throw new Error(
      "WebAuthn verification requires the initiating operator session."
    );
  }
  const now = input.now ?? new Date();
  const actionDigest = digestPeerPresenceAction(input.action);
  const challenge = input.store.claimChallenge({
    id: input.challengeId,
    principal: input.principal,
    actionDigest,
    rpId: relyingParty.rpId,
    expectedOrigin: relyingParty.origin,
    now: now.toISOString()
  });
  if (!challenge) {
    throw new Error("WebAuthn challenge is invalid, expired, or already used.");
  }
  const credentials = input.store.listActiveCredentials(
    input.principal.ownerUserId,
    relyingParty.rpId
  );
  if (
    peerWebAuthnCredentialSetVersion(credentials) !==
    challenge.credentialSetVersion
  ) {
    throw new Error(
      "Approval credentials changed during the WebAuthn ceremony."
    );
  }
  const expectedChallenge = (candidate: string) =>
    peerWebAuthnChallengeMatches(
      candidate,
      challenge.challengeHash,
      input.challengeHashingKey
    );

  let credentialRecord: PeerWebAuthnCredentialRecord;
  if (challenge.ceremony === "register") {
    const response = registrationResponseSchema.parse(
      input.response
    ) as RegistrationResponseJSON;
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: challenge.expectedOrigin,
      expectedRPID: challenge.rpId,
      requireUserPresence: true,
      requireUserVerification: true
    });
    if (!verification.verified || !verification.registrationInfo.userVerified) {
      throw new Error("WebAuthn registration did not verify user presence.");
    }
    const registered = verification.registrationInfo;
    credentialRecord = {
      id: `pwc_${randomUUID().replaceAll("-", "")}`,
      ownerUserId: input.principal.ownerUserId,
      rpId: challenge.rpId,
      credentialId: registered.credential.id,
      publicKeyBase64: Buffer.from(registered.credential.publicKey).toString(
        "base64"
      ),
      counter: registered.credential.counter,
      transports: response.response.transports ?? [],
      label: challenge.credentialLabel ?? "Platform authenticator",
      deviceType: registered.credentialDeviceType,
      backedUp: registered.credentialBackedUp,
      aaguid: registered.aaguid,
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString()
    };
    if (!input.store.createCredential(credentialRecord)) {
      throw new Error(
        "WebAuthn credential already exists or could not be stored."
      );
    }
  } else {
    const response = authenticationResponseSchema.parse(
      input.response
    ) as AuthenticationResponseJSON;
    const credential = credentials.find(
      (candidate) => candidate.credentialId === response.id
    );
    if (!credential) {
      throw new Error(
        "WebAuthn credential is not registered for this Forge origin."
      );
    }
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: challenge.expectedOrigin,
      expectedRPID: challenge.rpId,
      credential: toWebAuthnCredential(credential),
      requireUserVerification: true
    });
    if (
      !verification.verified ||
      !verification.authenticationInfo.userVerified
    ) {
      throw new Error("WebAuthn authentication did not verify the operator.");
    }
    if (
      !input.store.updateCredentialAfterAuthentication({
        id: credential.id,
        expectedCounter: credential.counter,
        newCounter: verification.authenticationInfo.newCounter,
        deviceType: verification.authenticationInfo.credentialDeviceType,
        backedUp: verification.authenticationInfo.credentialBackedUp,
        usedAt: now.toISOString()
      })
    ) {
      throw new Error(
        "WebAuthn credential counter changed during verification."
      );
    }
    credentialRecord = {
      ...credential,
      counter: verification.authenticationInfo.newCounter,
      deviceType: verification.authenticationInfo.credentialDeviceType,
      backedUp: verification.authenticationInfo.credentialBackedUp,
      lastUsedAt: now.toISOString()
    };
  }

  return {
    capability: issuePeerPresenceCapability({
      id: input.capabilityId,
      action: input.action,
      principal: input.principal,
      hashingKey: input.capabilityHashingKey,
      now
    }),
    credential: credentialRecord
  };
}
