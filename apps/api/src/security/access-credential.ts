import { randomUUID } from "node:crypto";
import type { JWTPayload } from "jose";

import type { ForgePrincipal } from "./contracts.js";
import type { SecurityClock } from "./security-runtime.js";
import type { SigningKeyProvider } from "./signing-key-provider.js";

type AccessCredentialClaims = JWTPayload & {
  client_id: string;
  installation_id: string;
  owner_id: string;
  profile: ForgePrincipal["profile"];
  scopes: string[];
  owner_epoch: number;
  client_epoch: number;
  principal_kind: ForgePrincipal["kind"];
  credential_mode: "sender_constrained" | "compatibility_bearer";
  cnf?: { jkt: string };
  compatibility_authorization_id?: string;
  compatibility_reason?: string;
};

export type CompatibilityAuthorization = {
  id: string;
  clientId: string;
  ownerId: string;
  audience: string;
  profile: "viewer";
  scopes: readonly string[];
  mode: "compatibility_bearer";
  reason: string;
  authorizedBy: string;
  authorizedAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type CredentialStateReader = {
  isCredentialActive(input: {
    tokenId: string;
    subjectId: string;
    clientId: string;
    installationId: string;
    ownerId: string;
    audience: string;
    profile: ForgePrincipal["profile"];
    scopes: readonly string[];
    keyThumbprint: string | null;
    compatibilityAuthorizationId: string | null;
    ownerSecurityEpoch: number;
    clientSecurityEpoch: number;
  }): boolean;
  readCompatibilityAuthorization(
    authorizationId: string
  ): CompatibilityAuthorization | null;
};

type SenderConstrainedIssuance = {
  mode: "sender_constrained";
  confirmationJkt: string;
  tokenId?: string;
};

type CompatibilityBearerIssuance = {
  mode: "compatibility_bearer";
  tokenId?: string;
  authorizationId: string;
};

export type AccessCredentialIssuance =
  | SenderConstrainedIssuance
  | CompatibilityBearerIssuance;

const COMPATIBILITY_BEARER_SCOPES = new Set(["read"]);

export class AccessCredentialService {
  constructor(
    private readonly keys: SigningKeyProvider,
    private readonly clock: SecurityClock,
    private readonly state: CredentialStateReader,
    private readonly lifetimeSeconds = 600,
    private readonly compatibilityLifetimeSeconds = 120
  ) {}

  async issue(principal: ForgePrincipal, issuance: AccessCredentialIssuance) {
    if (
      !principal.clientId ||
      !principal.installationId ||
      principal.clientSecurityEpoch === null ||
      principal.ownerSecurityEpoch < 1 ||
      principal.clientSecurityEpoch < 1
    ) {
      throw new Error(
        "Access credentials require an active registered client."
      );
    }
    let lifetimeSeconds = this.lifetimeSeconds;
    let compatibilityAuthorization: CompatibilityAuthorization | null = null;
    if (issuance.mode === "sender_constrained") {
      if (!issuance.confirmationJkt.trim()) {
        throw new Error("Sender-constrained credentials require a client key.");
      }
    } else {
      const authorization = this.state.readCompatibilityAuthorization(
        issuance.authorizationId
      );
      compatibilityAuthorization = authorization;
      const migrationExpiry = Date.parse(authorization?.expiresAt ?? "");
      if (
        !authorization ||
        authorization.clientId !== principal.clientId ||
        authorization.ownerId !== principal.ownerId ||
        authorization.audience !== principal.audience ||
        authorization.profile !== principal.profile ||
        authorization.mode !== "compatibility_bearer" ||
        authorization.revokedAt ||
        principal.scopes.some(
          (scope) => !authorization.scopes.includes(scope)
        ) ||
        principal.kind !== "legacy_agent_token" ||
        principal.profile !== "viewer" ||
        principal.scopes.some(
          (scope) => !COMPATIBILITY_BEARER_SCOPES.has(scope)
        ) ||
        !authorization.reason.trim() ||
        !authorization.authorizedBy.trim() ||
        !Number.isFinite(migrationExpiry) ||
        migrationExpiry <= this.clock.now().getTime()
      ) {
        throw new Error(
          "Compatibility bearer credentials require an allowlisted, expiring, read-only legacy viewer migration."
        );
      }
      lifetimeSeconds = Math.min(
        this.compatibilityLifetimeSeconds,
        Math.max(
          1,
          Math.floor((migrationExpiry - this.clock.now().getTime()) / 1000)
        )
      );
    }

    const issuedAtSeconds = Math.floor(this.clock.now().getTime() / 1000);
    const tokenId = issuance.tokenId ?? `atk_${randomUUID()}`;
    const claims: AccessCredentialClaims = {
      client_id: principal.clientId,
      installation_id: principal.installationId,
      owner_id: principal.ownerId,
      profile: principal.profile,
      scopes: [...principal.scopes],
      owner_epoch: principal.ownerSecurityEpoch,
      client_epoch: principal.clientSecurityEpoch,
      principal_kind: principal.kind,
      credential_mode: issuance.mode,
      ...(issuance.mode === "sender_constrained"
        ? { cnf: { jkt: issuance.confirmationJkt } }
        : {
            compatibility_authorization_id: issuance.authorizationId,
            compatibility_reason: compatibilityAuthorization!.reason
          })
    };
    if (
      !this.state.isCredentialActive({
        tokenId,
        subjectId: principal.subjectId,
        clientId: principal.clientId,
        installationId: principal.installationId,
        ownerId: principal.ownerId,
        audience: principal.audience,
        profile: principal.profile,
        scopes: principal.scopes,
        keyThumbprint:
          issuance.mode === "sender_constrained"
            ? issuance.confirmationJkt
            : null,
        compatibilityAuthorizationId:
          issuance.mode === "compatibility_bearer"
            ? issuance.authorizationId
            : null,
        ownerSecurityEpoch: principal.ownerSecurityEpoch,
        clientSecurityEpoch: principal.clientSecurityEpoch
      })
    ) {
      throw new Error(
        "Forge access credential issuance exceeds the registered client grant or uses stale state."
      );
    }
    const token = await this.keys.sign({
      audience: principal.audience,
      subject: principal.subjectId,
      tokenId,
      issuedAtSeconds,
      expiresAtSeconds: issuedAtSeconds + lifetimeSeconds,
      claims
    });
    return {
      token,
      tokenId,
      credentialMode: issuance.mode,
      expiresAt: new Date(
        (issuedAtSeconds + lifetimeSeconds) * 1000
      ).toISOString()
    };
  }

  async verify(input: {
    token: string;
    audience: string;
    requiredScopes?: readonly string[];
    requireSenderConstraint?: boolean;
  }) {
    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    const verified = await this.keys.verify(input.token, {
      audience: input.audience,
      nowSeconds
    });
    const payload = verified.payload as AccessCredentialClaims;
    if (
      !payload.sub ||
      !payload.jti ||
      typeof payload.client_id !== "string" ||
      typeof payload.installation_id !== "string" ||
      typeof payload.owner_id !== "string" ||
      typeof payload.owner_epoch !== "number" ||
      typeof payload.client_epoch !== "number" ||
      !Array.isArray(payload.scopes) ||
      !payload.scopes.every((scope) => typeof scope === "string") ||
      !["sender_constrained", "compatibility_bearer"].includes(
        payload.credential_mode
      )
    ) {
      throw new Error("Forge access credential claims are incomplete.");
    }
    if (payload.credential_mode === "sender_constrained" && !payload.cnf?.jkt) {
      throw new Error("Forge sender-constrained credential has no client key.");
    }
    if (
      payload.credential_mode === "compatibility_bearer" &&
      !payload.compatibility_authorization_id
    ) {
      throw new Error(
        "Forge compatibility bearer credential has no persisted authorization."
      );
    }
    if (
      input.requireSenderConstraint &&
      payload.credential_mode !== "sender_constrained"
    ) {
      throw new Error("Forge route requires a sender-constrained credential.");
    }
    if (
      !this.state.isCredentialActive({
        tokenId: payload.jti,
        subjectId: payload.sub,
        clientId: payload.client_id,
        installationId: payload.installation_id,
        ownerId: payload.owner_id,
        audience: input.audience,
        profile: payload.profile,
        scopes: payload.scopes,
        keyThumbprint: payload.cnf?.jkt ?? null,
        compatibilityAuthorizationId:
          payload.compatibility_authorization_id ?? null,
        ownerSecurityEpoch: payload.owner_epoch,
        clientSecurityEpoch: payload.client_epoch
      })
    ) {
      throw new Error("Forge access credential is revoked or stale.");
    }
    const missingScopes = (input.requiredScopes ?? []).filter(
      (scope) => !payload.scopes.includes(scope)
    );
    if (missingScopes.length > 0) {
      throw new Error(
        `Forge access credential lacks scopes: ${missingScopes.join(", ")}.`
      );
    }
    return payload;
  }
}
