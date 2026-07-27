import type {
  BackgroundJobAuthorization,
  BackgroundJobAuthorizationPolicy
} from "../managers/platform/background-job-manager.js";
import type { ForgePrincipal } from "./contracts.js";
import { forgeAccessGatewayPolicyVersion } from "./access-gateway.js";

type RegisteredClientState = {
  id: string;
  ownerId: string;
  subjectId: string;
  installationId: string;
  audience: string;
  profile: ForgePrincipal["profile"];
  scopes: readonly string[];
  ownerSecurityEpoch: number;
  clientSecurityEpoch: number;
  revokedAt: string | null;
};

type LegacyTokenState = {
  id: string;
  agentId: string | null;
  scopes: readonly string[];
  revokedAt: string | null;
};

type BrowserSessionState = {
  id: string;
  principal: ForgePrincipal;
  ownerSecurityEpoch: number;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
};

type BackgroundAuthorizationDependencies = {
  ownerId: string;
  installationId: string;
  audience: string;
  readOwnerSecurityEpoch(ownerId: string): number | null;
  readClient(clientId: string): RegisteredClientState | null;
  readLegacyToken(tokenId: string): LegacyTokenState | null | undefined;
  readBrowserSession(sessionId: string): BrowserSessionState | null;
  now?: () => Date;
};

function hasDispatchScope(
  principal: ForgePrincipal,
  authorization: BackgroundJobAuthorization
) {
  const accepted =
    principal.kind === "legacy_agent_token"
      ? new Set([
          "*",
          "write",
          authorization.action,
          `${authorization.resource}.write`
        ])
      : new Set([
          authorization.action,
          `${authorization.resource}.write`,
          `profile:${principal.profile}`
        ]);
  return principal.scopes.some((scope) => accepted.has(scope));
}

function matchesRuntimeBoundary(
  authorization: BackgroundJobAuthorization,
  dependencies: BackgroundAuthorizationDependencies
) {
  const principal = authorization.principal;
  return (
    authorization.policyVersion === forgeAccessGatewayPolicyVersion &&
    authorization.action.length > 0 &&
    authorization.resource.length > 0 &&
    authorization.budget.maximumRuntimeMilliseconds > 0 &&
    authorization.budget.maximumEffectInvocations === 1 &&
    authorization.budget.capabilities.includes(authorization.action) &&
    principal.ownerId === dependencies.ownerId &&
    principal.audience === dependencies.audience &&
    principal.ownerSecurityEpoch ===
      dependencies.readOwnerSecurityEpoch(principal.ownerId)
  );
}

export function createBackgroundJobAdmissionPolicy(
  dependencies: BackgroundAuthorizationDependencies
): BackgroundJobAuthorizationPolicy {
  return (authorization) => {
    const principal = authorization.principal;
    if (!matchesRuntimeBoundary(authorization, dependencies)) {
      return false;
    }

    if (principal.kind === "system") {
      return (
        principal.subjectId === "forge-background-system" &&
        principal.installationId === dependencies.installationId &&
        principal.clientId === null &&
        principal.profile === "executor" &&
        hasDispatchScope(principal, authorization)
      );
    }

    if (principal.kind === "operator_session") {
      const session = dependencies.readBrowserSession(principal.subjectId);
      const now = (dependencies.now ?? (() => new Date()))().getTime();
      return (
        principal.clientId === null &&
        principal.installationId === null &&
        principal.clientSecurityEpoch === null &&
        principal.profile === "operator" &&
        Boolean(
          session &&
          !session.revokedAt &&
          session.id === principal.subjectId &&
          session.ownerSecurityEpoch === principal.ownerSecurityEpoch &&
          session.principal.kind === "operator_session" &&
          session.principal.ownerId === principal.ownerId &&
          session.principal.ownerSecurityEpoch ===
            principal.ownerSecurityEpoch &&
          session.principal.runtimeBinding === principal.runtimeBinding &&
          Date.parse(session.idleExpiresAt) > now &&
          Date.parse(session.absoluteExpiresAt) > now
        )
      );
    }

    if (principal.kind === "legacy_agent_token") {
      if (
        !principal.clientId ||
        principal.clientSecurityEpoch === null ||
        principal.installationId !== dependencies.installationId ||
        principal.profile === "viewer"
      ) {
        return false;
      }
      const token = dependencies.readLegacyToken(principal.clientId);
      return Boolean(
        token &&
        !token.revokedAt &&
        token.id === principal.clientId &&
        token.agentId === principal.subjectId &&
        token.scopes.length === principal.scopes.length &&
        token.scopes.every((scope) => principal.scopes.includes(scope)) &&
        hasDispatchScope(principal, authorization)
      );
    }

    if (principal.kind === "paired_client") {
      if (
        !principal.clientId ||
        principal.clientSecurityEpoch === null ||
        principal.installationId !== dependencies.installationId ||
        principal.profile === "viewer"
      ) {
        return false;
      }
      const client = dependencies.readClient(principal.clientId);
      return Boolean(
        client &&
        !client.revokedAt &&
        client.id === principal.clientId &&
        client.ownerId === principal.ownerId &&
        client.subjectId === principal.subjectId &&
        client.installationId === principal.installationId &&
        client.audience === principal.audience &&
        client.profile === principal.profile &&
        client.ownerSecurityEpoch === principal.ownerSecurityEpoch &&
        client.clientSecurityEpoch === principal.clientSecurityEpoch &&
        client.scopes.length === principal.scopes.length &&
        client.scopes.every((scope) => principal.scopes.includes(scope)) &&
        hasDispatchScope(principal, authorization)
      );
    }

    return false;
  };
}

export function systemBackgroundPrincipal(input: {
  ownerId: string;
  installationId: string;
  audience: string;
  ownerSecurityEpoch: number;
}): ForgePrincipal {
  return Object.freeze({
    kind: "system",
    subjectId: "forge-background-system",
    ownerId: input.ownerId,
    clientId: null,
    installationId: input.installationId,
    audience: input.audience,
    scopes: Object.freeze([
      "wiki.ingest.execute",
      "ai_processor.cron.execute",
      "data_backup.automatic.execute",
      "devrage.sync.execute"
    ]),
    profile: "executor",
    ownerSecurityEpoch: input.ownerSecurityEpoch,
    clientSecurityEpoch: null,
    authenticatedAt: new Date().toISOString()
  });
}
