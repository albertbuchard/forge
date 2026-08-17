import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

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

import type { SecretsManager } from "../managers/platform/secrets-manager.js";
import { resolvePeerWebAuthnRelyingParty } from "../services/peer-webauthn.js";
import type { VerifiedBrowserSession } from "./browser-session-service.js";
import type { ForgePrincipal } from "./contracts.js";
import type { SqliteSecurityStore } from "./sqlite-security-store.js";
import type { SecurityClock } from "./security-runtime.js";

export const TRUSTED_BROWSER_CHALLENGE_TTL_SECONDS = 2 * 60;
const MAXIMUM_PENDING_TRUSTED_BROWSER_CHALLENGES = 64;

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

type TrustedBrowserCredentialRow = {
  id: string;
  credential_id: string;
  owner_id: string;
  installation_id: string;
  data_root_binding: string;
  client_id: string;
  client_subject_id: string;
  client_key_thumbprint: string;
  client_type: "browser";
  audience: string;
  profile: Exclude<ForgePrincipal["profile"], "operator">;
  scopes_json: string;
  selected_user_ids_json: string;
  owner_epoch: number;
  client_epoch: number;
  authority_digest: string;
  rp_id: string;
  origin: string;
  public_key_base64: string;
  counter: number;
  transports_json: string;
  label: string;
  device_type: "singleDevice" | "multiDevice";
  backed_up: number;
  aaguid: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
};

type TrustedBrowserChallengeRow = {
  id: string;
  ceremony: "register" | "authenticate";
  challenge_keyed_hash: string;
  expected_origin: string;
  rp_id: string;
  session_id: string | null;
  client_id: string | null;
  authority_digest: string | null;
  credential_set_version: string;
  credential_label: string | null;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
};

type TrustedBrowserCredential = ReturnType<typeof mapTrustedBrowserCredential>;

function parseCanonicalStringArray(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((entry) => typeof entry === "string") ||
    JSON.stringify([...new Set(parsed)].sort()) !== value
  ) {
    throw new Error("Forge trusted-browser authority storage is invalid.");
  }
  return parsed;
}

function mapTrustedBrowserCredential(row: TrustedBrowserCredentialRow) {
  const transports = JSON.parse(row.transports_json) as unknown;
  if (
    !Array.isArray(transports) ||
    !transports.every((entry) => transportSchema.safeParse(entry).success)
  ) {
    throw new Error("Forge trusted-browser transport storage is invalid.");
  }
  return {
    id: row.id,
    credentialId: row.credential_id,
    ownerId: row.owner_id,
    installationId: row.installation_id,
    dataRootBinding: row.data_root_binding,
    clientId: row.client_id,
    clientSubjectId: row.client_subject_id,
    clientKeyThumbprint: row.client_key_thumbprint,
    clientType: row.client_type,
    audience: row.audience,
    profile: row.profile,
    scopes: parseCanonicalStringArray(row.scopes_json),
    selectedUserIds: parseCanonicalStringArray(row.selected_user_ids_json),
    ownerSecurityEpoch: row.owner_epoch,
    clientSecurityEpoch: row.client_epoch,
    authorityDigest: row.authority_digest,
    rpId: row.rp_id,
    origin: row.origin,
    publicKeyBase64: row.public_key_base64,
    counter: row.counter,
    transports: transports as AuthenticatorTransportFuture[],
    label: row.label,
    deviceType: row.device_type,
    backedUp: Boolean(row.backed_up),
    aaguid: row.aaguid,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    revocationReason: row.revocation_reason
  };
}

function canonicalStringArray(values: readonly string[]) {
  return [...new Set(values)].sort();
}

export function trustedBrowserDataRootBinding(dataDirectory: string) {
  return createHash("sha256")
    .update("forge/trusted-browser-data-root/v1\0", "utf8")
    .update(path.resolve(dataDirectory), "utf8")
    .digest("hex");
}

export function trustedBrowserAuthorityDigest(input: {
  ownerId: string;
  ownerSecurityEpoch: number;
  installationId: string;
  dataRootBinding: string;
  clientId: string;
  clientSubjectId: string;
  clientKeyThumbprint: string;
  clientType: "browser";
  audience: string;
  profile: Exclude<ForgePrincipal["profile"], "operator">;
  scopes: readonly string[];
  selectedUserIds: readonly string[];
  clientSecurityEpoch: number;
}) {
  return createHash("sha256")
    .update("forge/trusted-browser-authority/v1\0", "utf8")
    .update(
      JSON.stringify({
        ownerId: input.ownerId,
        ownerSecurityEpoch: input.ownerSecurityEpoch,
        installationId: input.installationId,
        dataRootBinding: input.dataRootBinding,
        clientId: input.clientId,
        clientSubjectId: input.clientSubjectId,
        clientKeyThumbprint: input.clientKeyThumbprint,
        clientType: input.clientType,
        audience: input.audience,
        profile: input.profile,
        scopes: canonicalStringArray(input.scopes),
        selectedUserIds: canonicalStringArray(input.selectedUserIds),
        clientSecurityEpoch: input.clientSecurityEpoch,
        lifecycleState: "active"
      }),
      "utf8"
    )
    .digest("hex");
}

function safeDigestEqual(left: string, right: string) {
  return (
    /^[a-f0-9]{64}$/.test(left) &&
    /^[a-f0-9]{64}$/.test(right) &&
    timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
  );
}

function toWebAuthnCredential(
  credential: TrustedBrowserCredential
): WebAuthnCredential {
  if (!canonicalBase64Schema.safeParse(credential.publicKeyBase64).success) {
    throw new Error("Stored trusted-browser public key is invalid.");
  }
  const publicKey = Buffer.from(credential.publicKeyBase64, "base64");
  if (publicKey.toString("base64") !== credential.publicKeyBase64) {
    throw new Error("Stored trusted-browser public key is not canonical.");
  }
  return {
    id: credential.credentialId,
    publicKey: new Uint8Array(publicKey),
    counter: credential.counter,
    transports: credential.transports
  };
}

export class TrustedBrowserService {
  private readonly challengeHashingKey: Uint8Array;
  private readonly dataRootBinding: string;

  constructor(
    private readonly database: DatabaseSync,
    private readonly clock: SecurityClock,
    secrets: SecretsManager,
    private readonly store: SqliteSecurityStore,
    private readonly installationId: string,
    dataDirectory: string
  ) {
    this.challengeHashingKey = secrets.deriveKey(
      "security-trusted-browser-webauthn-challenges/v1"
    );
    this.dataRootBinding = trustedBrowserDataRootBinding(dataDirectory);
  }

  async beginRegistration(input: {
    session: VerifiedBrowserSession;
    origin: string;
    directLocalTransport: boolean;
    clientId?: string;
    label?: string;
  }) {
    const relyingParty = resolvePeerWebAuthnRelyingParty(input.origin);
    const authority = this.registrationAuthority({
      ...input,
      origin: relyingParty.origin
    });
    const credentials = this.listActiveCredentialsForRp(relyingParty.rpId);
    const challenge = randomBytes(32);
    const options = await generateRegistrationOptions({
      rpName: "Forge",
      rpID: relyingParty.rpId,
      userName: "Forge trusted browser",
      userDisplayName: "Forge trusted browser",
      userID: createHash("sha256")
        .update("forge/trusted-browser-user/v1\0", "utf8")
        .update(authority.ownerId, "utf8")
        .update("\0", "utf8")
        .update(authority.clientId, "utf8")
        .update("\0", "utf8")
        .update(relyingParty.rpId, "utf8")
        .digest(),
      challenge,
      timeout: TRUSTED_BROWSER_CHALLENGE_TTL_SECONDS * 1_000,
      attestationType: "none",
      excludeCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports
      })),
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required"
      }
    });
    const challengeId = `tbc_${randomUUID().replaceAll("-", "")}`;
    const now = this.clock.now();
    this.createChallenge({
      id: challengeId,
      ceremony: "register",
      challengeKeyedHash: this.hashChallenge(options.challenge),
      expectedOrigin: relyingParty.origin,
      rpId: relyingParty.rpId,
      sessionId: input.session.sessionId,
      clientId: authority.clientId,
      authorityDigest: authority.authorityDigest,
      credentialSetVersion: this.credentialSetVersion(credentials),
      credentialLabel: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .parse(input.label ?? "Forge trusted device"),
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + TRUSTED_BROWSER_CHALLENGE_TTL_SECONDS * 1_000
      ).toISOString()
    });
    return { challengeId, options };
  }

  async finishRegistration(input: {
    session: VerifiedBrowserSession;
    origin: string;
    directLocalTransport: boolean;
    clientId?: string;
    challengeId: string;
    response: unknown;
  }) {
    const relyingParty = resolvePeerWebAuthnRelyingParty(input.origin);
    const authority = this.registrationAuthority({
      ...input,
      origin: relyingParty.origin
    });
    const challenge = this.claimChallenge({
      id: input.challengeId,
      ceremony: "register",
      expectedOrigin: relyingParty.origin,
      rpId: relyingParty.rpId,
      sessionId: input.session.sessionId,
      clientId: authority.clientId,
      authorityDigest: authority.authorityDigest
    });
    const credentials = this.listActiveCredentialsForRp(relyingParty.rpId);
    if (
      !challenge ||
      challenge.credential_set_version !==
        this.credentialSetVersion(credentials)
    ) {
      throw new Error(
        "Trusted-browser registration is missing, expired, replayed, or stale."
      );
    }
    const response = registrationResponseSchema.parse(
      input.response
    ) as RegistrationResponseJSON;
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: (candidate) =>
        this.challengeMatches(candidate, challenge.challenge_keyed_hash),
      expectedOrigin: challenge.expected_origin,
      expectedRPID: challenge.rp_id,
      requireUserPresence: true,
      requireUserVerification: true
    });
    if (!verification.verified || !verification.registrationInfo.userVerified) {
      throw new Error(
        "Trusted-browser registration did not verify the current user."
      );
    }
    const registered = verification.registrationInfo;
    const now = this.clock.now().toISOString();
    const created = this.createCredential({
      id: `tbr_${randomUUID().replaceAll("-", "")}`,
      credentialId: registered.credential.id,
      authority,
      rpId: relyingParty.rpId,
      origin: relyingParty.origin,
      publicKeyBase64: Buffer.from(registered.credential.publicKey).toString(
        "base64"
      ),
      counter: registered.credential.counter,
      transports: response.response.transports ?? [],
      label: challenge.credential_label!,
      deviceType: registered.credentialDeviceType,
      backedUp: registered.credentialBackedUp,
      aaguid: registered.aaguid,
      createdAt: now
    });
    if (!created) {
      throw new Error(
        "This trusted-browser credential already exists or could not be stored."
      );
    }
    return this.statusForCredential(created);
  }

  async beginAuthentication(input: {
    origin: string;
    networkPartition: string;
  }) {
    const relyingParty = resolvePeerWebAuthnRelyingParty(input.origin);
    const now = this.clock.now();
    const admitted = this.store.claimPairingPollNetworkAttempt({
      bucketKey: `trusted-browser:${createHmac(
        "sha256",
        this.challengeHashingKey
      )
        .update("forge/trusted-browser/network-partition/v1\0", "utf8")
        .update(input.networkPartition, "utf8")
        .digest("hex")}`,
      now: now.toISOString(),
      windowSeconds: TRUSTED_BROWSER_CHALLENGE_TTL_SECONDS,
      maximumAttempts: 12
    });
    if (!admitted) {
      throw new Error(
        "Forge is temporarily limiting trusted-device authentication attempts."
      );
    }
    const credentials = this.listActiveCredentialsForRp(relyingParty.rpId);
    const challenge = randomBytes(32);
    const options = await generateAuthenticationOptions({
      rpID: relyingParty.rpId,
      challenge,
      timeout: TRUSTED_BROWSER_CHALLENGE_TTL_SECONDS * 1_000,
      userVerification: "required",
      allowCredentials: []
    });
    const challengeId = `tbc_${randomUUID().replaceAll("-", "")}`;
    this.createChallenge({
      id: challengeId,
      ceremony: "authenticate",
      challengeKeyedHash: this.hashChallenge(options.challenge),
      expectedOrigin: relyingParty.origin,
      rpId: relyingParty.rpId,
      sessionId: null,
      clientId: null,
      authorityDigest: null,
      credentialSetVersion: this.credentialSetVersion(credentials),
      credentialLabel: null,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + TRUSTED_BROWSER_CHALLENGE_TTL_SECONDS * 1_000
      ).toISOString()
    });
    return { challengeId, options };
  }

  async finishAuthentication(input: {
    origin: string;
    challengeId: string;
    response: unknown;
  }) {
    const relyingParty = resolvePeerWebAuthnRelyingParty(input.origin);
    const challenge = this.claimChallenge({
      id: input.challengeId,
      ceremony: "authenticate",
      expectedOrigin: relyingParty.origin,
      rpId: relyingParty.rpId,
      sessionId: null,
      clientId: null,
      authorityDigest: null
    });
    const credentials = this.listActiveCredentialsForRp(relyingParty.rpId);
    if (
      !challenge ||
      challenge.credential_set_version !==
        this.credentialSetVersion(credentials)
    ) {
      throw new Error(
        "Trusted-browser authentication is missing, expired, replayed, or stale."
      );
    }
    const response = authenticationResponseSchema.parse(
      input.response
    ) as AuthenticationResponseJSON;
    const credential = credentials.find(
      (candidate) => candidate.credentialId === response.id
    );
    if (!credential) {
      throw new Error("Trusted-browser authentication was not accepted.");
    }
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (candidate) =>
        this.challengeMatches(candidate, challenge.challenge_keyed_hash),
      expectedOrigin: challenge.expected_origin,
      expectedRPID: challenge.rp_id,
      credential: toWebAuthnCredential(credential),
      requireUserVerification: true
    });
    if (
      !verification.verified ||
      !verification.authenticationInfo.userVerified
    ) {
      throw new Error("Trusted-browser authentication was not accepted.");
    }
    const authority = this.currentAuthority(credential.clientId);
    if (
      !authority ||
      !safeDigestEqual(authority.authorityDigest, credential.authorityDigest) ||
      credential.installationId !== this.installationId ||
      credential.dataRootBinding !== this.dataRootBinding ||
      credential.ownerId !== authority.ownerId ||
      credential.clientSubjectId !== authority.clientSubjectId ||
      credential.clientKeyThumbprint !== authority.clientKeyThumbprint ||
      credential.ownerSecurityEpoch !== authority.ownerSecurityEpoch ||
      credential.clientSecurityEpoch !== authority.clientSecurityEpoch ||
      credential.origin !== relyingParty.origin ||
      credential.rpId !== relyingParty.rpId
    ) {
      this.revokeCredentialInCurrentState(
        credential.id,
        "authority_binding_changed"
      );
      throw new Error("Trusted-browser authority is revoked or stale.");
    }
    const now = this.clock.now().toISOString();
    const updated = this.database
      .prepare(
        `UPDATE security_trusted_browser_credentials
         SET counter = ?, device_type = ?, backed_up = ?, last_used_at = ?
         WHERE id = ? AND counter = ? AND revoked_at IS NULL`
      )
      .run(
        verification.authenticationInfo.newCounter,
        verification.authenticationInfo.credentialDeviceType,
        verification.authenticationInfo.credentialBackedUp ? 1 : 0,
        now,
        credential.id,
        credential.counter
      );
    if (Number(updated.changes) !== 1) {
      throw new Error(
        "Trusted-browser credential state changed during verification."
      );
    }
    return {
      client: authority.client,
      credential: this.statusForCredential({
        ...credential,
        counter: verification.authenticationInfo.newCounter,
        deviceType: verification.authenticationInfo.credentialDeviceType,
        backedUp: verification.authenticationInfo.credentialBackedUp,
        lastUsedAt: now
      })
    };
  }

  list(ownerId: string) {
    const rows = this.database
      .prepare(
        `SELECT credential.*
         FROM security_trusted_browser_credentials credential
         WHERE credential.owner_id = ?
         ORDER BY credential.created_at DESC, credential.id ASC
         LIMIT 64`
      )
      .all(ownerId) as TrustedBrowserCredentialRow[];
    return rows.map((row) =>
      this.statusForCredential(mapTrustedBrowserCredential(row))
    );
  }

  status(input: { session: VerifiedBrowserSession; origin: string }) {
    const principal = input.session.principal;
    if (principal.kind !== "paired_client" || !principal.clientId) {
      return { available: false, credentials: [] };
    }
    const relyingParty = resolvePeerWebAuthnRelyingParty(input.origin);
    const rows = this.database
      .prepare(
        `SELECT * FROM security_trusted_browser_credentials
         WHERE owner_id = ? AND client_id = ? AND rp_id = ?
           AND revoked_at IS NULL
         ORDER BY created_at DESC, id ASC
         LIMIT 16`
      )
      .all(
        principal.ownerId,
        principal.clientId,
        relyingParty.rpId
      ) as TrustedBrowserCredentialRow[];
    return {
      available: rows.length > 0,
      credentials: rows.map((row) =>
        this.statusForCredential(mapTrustedBrowserCredential(row))
      )
    };
  }

  revoke(ownerId: string, credentialId: string) {
    const result = this.database
      .prepare(
        `UPDATE security_trusted_browser_credentials
         SET revoked_at = COALESCE(revoked_at, ?),
             revocation_reason = COALESCE(revocation_reason, 'owner_revoked')
         WHERE id = ? AND owner_id = ? AND revoked_at IS NULL`
      )
      .run(this.clock.now().toISOString(), credentialId, ownerId);
    return Number(result.changes) === 1;
  }

  private registrationAuthority(input: {
    session: VerifiedBrowserSession;
    origin: string;
    directLocalTransport: boolean;
    clientId?: string;
  }) {
    const principal = input.session.principal;
    const relyingParty = resolvePeerWebAuthnRelyingParty(input.origin);
    let clientId: string;
    if (principal.kind === "operator_session") {
      if (!relyingParty.loopback || !input.directLocalTransport) {
        throw new Error(
          "A local owner may register trusted-device access only on direct loopback."
        );
      }
      clientId = z
        .string()
        .regex(/^client_[A-Za-z0-9-]{16,180}$/)
        .parse(input.clientId);
    } else if (principal.kind === "paired_client" && principal.clientId) {
      if (relyingParty.loopback && !input.directLocalTransport) {
        throw new Error(
          "Loopback trusted-device registration requires a direct local connection."
        );
      }
      clientId = principal.clientId;
      if (input.clientId && input.clientId !== clientId) {
        throw new Error(
          "A paired browser may trust only its own current client authority."
        );
      }
    } else {
      throw new Error(
        "Trusted-device registration requires an owner or paired-browser session."
      );
    }
    const authority = this.currentAuthority(clientId);
    if (!authority || authority.ownerId !== principal.ownerId) {
      throw new Error("The selected paired-browser authority is unavailable.");
    }
    if (principal.kind === "paired_client") {
      const exactPrincipalDigest = trustedBrowserAuthorityDigest({
        ownerId: principal.ownerId,
        ownerSecurityEpoch: principal.ownerSecurityEpoch,
        installationId: principal.installationId!,
        dataRootBinding: this.dataRootBinding,
        clientId: principal.clientId!,
        clientSubjectId: principal.subjectId,
        clientKeyThumbprint: authority.clientKeyThumbprint,
        clientType: "browser",
        audience: principal.audience,
        profile: principal.profile as Exclude<
          ForgePrincipal["profile"],
          "operator"
        >,
        scopes: principal.scopes,
        selectedUserIds: [],
        clientSecurityEpoch: principal.clientSecurityEpoch!
      });
      if (!safeDigestEqual(exactPrincipalDigest, authority.authorityDigest)) {
        throw new Error(
          "The paired-browser session no longer matches its exact client authority."
        );
      }
    }
    return authority;
  }

  private currentAuthority(clientId: string) {
    const client = this.store.readClient(clientId);
    if (
      !client ||
      client.revokedAt ||
      client.installationId !== this.installationId ||
      client.clientType !== "browser" ||
      client.profile === "operator"
    ) {
      return null;
    }
    const pairing = this.store.readPairingRequest(client.subjectId);
    if (
      !pairing ||
      pairing.status !== "consumed" ||
      pairing.clientType !== "browser"
    ) {
      return null;
    }
    const authority = {
      ownerId: client.ownerId,
      ownerSecurityEpoch: client.ownerSecurityEpoch,
      installationId: client.installationId,
      dataRootBinding: this.dataRootBinding,
      clientId: client.id,
      clientSubjectId: client.subjectId,
      clientKeyThumbprint: client.keyThumbprint,
      clientType: "browser" as const,
      audience: client.audience,
      profile: client.profile as Exclude<ForgePrincipal["profile"], "operator">,
      scopes: canonicalStringArray(client.scopes),
      selectedUserIds: [] as string[],
      clientSecurityEpoch: client.clientSecurityEpoch,
      client
    };
    return {
      ...authority,
      authorityDigest: trustedBrowserAuthorityDigest(authority)
    };
  }

  private createChallenge(input: {
    id: string;
    ceremony: "register" | "authenticate";
    challengeKeyedHash: string;
    expectedOrigin: string;
    rpId: string;
    sessionId: string | null;
    clientId: string | null;
    authorityDigest: string | null;
    credentialSetVersion: string;
    credentialLabel: string | null;
    createdAt: string;
    expiresAt: string;
  }) {
    const staleConsumedAt = new Date(
      Date.parse(input.createdAt) - 60 * 60 * 1_000
    ).toISOString();
    this.database
      .prepare(
        `DELETE FROM security_trusted_browser_challenges
         WHERE expires_at <= ? OR (consumed_at IS NOT NULL AND consumed_at <= ?)`
      )
      .run(input.createdAt, staleConsumedAt);
    const pending = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM security_trusted_browser_challenges
         WHERE consumed_at IS NULL AND expires_at > ?`
      )
      .get(input.createdAt) as { count: number };
    if (pending.count >= MAXIMUM_PENDING_TRUSTED_BROWSER_CHALLENGES) {
      throw new Error(
        "Forge already has the maximum bounded trusted-browser ceremonies in progress."
      );
    }
    this.database
      .prepare(
        `INSERT INTO security_trusted_browser_challenges (
           id, ceremony, challenge_keyed_hash, expected_origin, rp_id,
           session_id, client_id, authority_digest, credential_set_version,
           credential_label, created_at, expires_at, consumed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        input.id,
        input.ceremony,
        input.challengeKeyedHash,
        input.expectedOrigin,
        input.rpId,
        input.sessionId,
        input.clientId,
        input.authorityDigest,
        input.credentialSetVersion,
        input.credentialLabel,
        input.createdAt,
        input.expiresAt
      );
  }

  private claimChallenge(input: {
    id: string;
    ceremony: "register" | "authenticate";
    expectedOrigin: string;
    rpId: string;
    sessionId: string | null;
    clientId: string | null;
    authorityDigest: string | null;
  }) {
    const now = this.clock.now().toISOString();
    const row = this.database
      .prepare(
        `SELECT * FROM security_trusted_browser_challenges
         WHERE id = ? AND ceremony = ? AND expected_origin = ? AND rp_id = ?
           AND COALESCE(session_id, '') = COALESCE(?, '')
           AND COALESCE(client_id, '') = COALESCE(?, '')
           AND COALESCE(authority_digest, '') = COALESCE(?, '')
           AND consumed_at IS NULL AND expires_at > ?`
      )
      .get(
        input.id,
        input.ceremony,
        input.expectedOrigin,
        input.rpId,
        input.sessionId,
        input.clientId,
        input.authorityDigest,
        now
      ) as TrustedBrowserChallengeRow | undefined;
    if (!row) return null;
    const consumed = this.database
      .prepare(
        `UPDATE security_trusted_browser_challenges
         SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`
      )
      .run(now, input.id);
    return Number(consumed.changes) === 1 ? { ...row, consumed_at: now } : null;
  }

  private createCredential(input: {
    id: string;
    credentialId: string;
    authority: NonNullable<
      ReturnType<TrustedBrowserService["currentAuthority"]>
    >;
    rpId: string;
    origin: string;
    publicKeyBase64: string;
    counter: number;
    transports: AuthenticatorTransportFuture[];
    label: string;
    deviceType: "singleDevice" | "multiDevice";
    backedUp: boolean;
    aaguid: string;
    createdAt: string;
  }) {
    const { authority } = input;
    const inserted = this.database
      .prepare(
        `INSERT INTO security_trusted_browser_credentials (
             id, credential_id, owner_id, installation_id, data_root_binding,
             client_id, client_subject_id, client_key_thumbprint, client_type,
             audience, profile, scopes_json, selected_user_ids_json,
             owner_epoch, client_epoch, authority_digest, rp_id, origin,
             public_key_base64, counter, transports_json, label, device_type,
             backed_up, aaguid, created_at, last_used_at, revoked_at,
             revocation_reason
           ) VALUES (
             $id, $credentialId, $ownerId, $installationId, $dataRootBinding,
             $clientId, $clientSubjectId, $clientKeyThumbprint, 'browser',
             $audience, $profile, $scopesJson, $selectedUserIdsJson,
             $ownerEpoch, $clientEpoch, $authorityDigest, $rpId, $origin,
             $publicKeyBase64, $counter, $transportsJson, $label, $deviceType,
             $backedUp, $aaguid, $createdAt, $lastUsedAt, NULL, NULL
           )`
      )
      .run({
        $id: input.id,
        $credentialId: input.credentialId,
        $ownerId: authority.ownerId,
        $installationId: authority.installationId,
        $dataRootBinding: authority.dataRootBinding,
        $clientId: authority.clientId,
        $clientSubjectId: authority.clientSubjectId,
        $clientKeyThumbprint: authority.clientKeyThumbprint,
        $audience: authority.audience,
        $profile: authority.profile,
        $scopesJson: JSON.stringify(authority.scopes),
        $selectedUserIdsJson: JSON.stringify(authority.selectedUserIds),
        $ownerEpoch: authority.ownerSecurityEpoch,
        $clientEpoch: authority.clientSecurityEpoch,
        $authorityDigest: authority.authorityDigest,
        $rpId: input.rpId,
        $origin: input.origin,
        $publicKeyBase64: input.publicKeyBase64,
        $counter: input.counter,
        $transportsJson: JSON.stringify(input.transports),
        $label: input.label,
        $deviceType: input.deviceType,
        $backedUp: input.backedUp ? 1 : 0,
        $aaguid: input.aaguid,
        $createdAt: input.createdAt,
        $lastUsedAt: input.createdAt
      });
    if (Number(inserted.changes) !== 1) return null;
    return this.readCredentialById(input.id);
  }

  private listActiveCredentialsForRp(rpId: string) {
    const rows = this.database
      .prepare(
        `SELECT * FROM security_trusted_browser_credentials
         WHERE rp_id = ? AND revoked_at IS NULL
         ORDER BY created_at, id LIMIT 64`
      )
      .all(rpId) as TrustedBrowserCredentialRow[];
    return rows.map(mapTrustedBrowserCredential);
  }

  private readCredentialById(id: string) {
    const row = this.database
      .prepare(
        `SELECT * FROM security_trusted_browser_credentials WHERE id = ?`
      )
      .get(id) as TrustedBrowserCredentialRow | undefined;
    return row ? mapTrustedBrowserCredential(row) : null;
  }

  private credentialSetVersion(credentials: TrustedBrowserCredential[]) {
    return createHash("sha256")
      .update("forge/trusted-browser-credential-set/v1\0", "utf8")
      .update(
        JSON.stringify(
          credentials
            .map((credential) => [
              credential.credentialId,
              credential.authorityDigest
            ])
            .sort((left, right) => left[0]!.localeCompare(right[0]!))
        ),
        "utf8"
      )
      .digest("hex");
  }

  private hashChallenge(challenge: string) {
    return createHmac("sha256", this.challengeHashingKey)
      .update(challenge, "utf8")
      .digest("hex");
  }

  private challengeMatches(candidate: string, expectedHash: string) {
    if (
      !base64UrlSchema.min(32).max(512).safeParse(candidate).success ||
      !/^[a-f0-9]{64}$/.test(expectedHash)
    ) {
      return false;
    }
    return safeDigestEqual(this.hashChallenge(candidate), expectedHash);
  }

  private revokeCredentialInCurrentState(id: string, reason: string) {
    this.database
      .prepare(
        `UPDATE security_trusted_browser_credentials
         SET revoked_at = COALESCE(revoked_at, ?),
             revocation_reason = COALESCE(revocation_reason, ?)
         WHERE id = ?`
      )
      .run(this.clock.now().toISOString(), reason, id);
  }

  private statusForCredential(credential: TrustedBrowserCredential) {
    const pairing = this.store.readPairingRequest(credential.clientSubjectId);
    return {
      id: credential.id,
      label: credential.label,
      clientId: credential.clientId,
      clientName: pairing?.clientName ?? "Paired Forge browser",
      profile: credential.profile,
      scopes: credential.scopes,
      selectedUserIds: credential.selectedUserIds,
      origin: credential.origin,
      relyingPartyId: credential.rpId,
      deviceType: credential.deviceType,
      backedUp: credential.backedUp,
      createdAt: credential.createdAt,
      lastUsedAt: credential.lastUsedAt,
      revokedAt: credential.revokedAt,
      revocationReason: credential.revocationReason
    };
  }
}
