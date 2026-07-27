import { randomUUID } from "node:crypto";

import type { CompatibilityAuthorization } from "./access-credential.js";
import type {
  BrowserSessionService,
  VerifiedBrowserSession
} from "./browser-session-service.js";
import type { ForgePrincipal } from "./contracts.js";
import type { SecurityClock } from "./security-runtime.js";

type RegisteredClient = {
  id: string;
  ownerId: string;
  subjectId: string;
  installationId: string;
  keyThumbprint: string;
  audience: string;
  profile: ForgePrincipal["profile"];
  scopes: readonly string[];
  ownerSecurityEpoch: number;
  clientSecurityEpoch: number;
  createdAt: string;
  revokedAt: string | null;
};

export type CompatibilityAuthorizationRepository = {
  readClient(clientId: string): RegisteredClient | null;
  createCompatibilityAuthorization(
    authorization: CompatibilityAuthorization
  ): void;
  readCompatibilityAuthorization(
    authorizationId: string
  ): CompatibilityAuthorization | null;
  revokeCompatibilityAuthorization(id: string, reason: string): boolean;
};

export class CompatibilityMigrationService {
  constructor(
    private readonly clock: SecurityClock,
    private readonly browserSessions: BrowserSessionService,
    private readonly repository: CompatibilityAuthorizationRepository,
    private readonly maximumAuthorizationLifetimeSeconds = 30 * 24 * 60 * 60
  ) {}

  authorize(input: {
    session: VerifiedBrowserSession;
    clientId: string;
    scopes: readonly string[];
    reason: string;
    expiresAt: string;
  }) {
    const principal = this.browserSessions.consumeAuthenticatedOwnerSession(
      input.session
    );
    const client = this.repository.readClient(input.clientId);
    const expiresAt = Date.parse(input.expiresAt);
    const maximumExpiry =
      this.clock.now().getTime() +
      this.maximumAuthorizationLifetimeSeconds * 1000;
    if (
      !client ||
      client.revokedAt ||
      client.ownerId !== principal.ownerId ||
      client.ownerSecurityEpoch !== principal.ownerSecurityEpoch ||
      client.profile !== "viewer" ||
      input.scopes.length === 0 ||
      input.scopes.some(
        (scope) => scope !== "read" || !client.scopes.includes(scope)
      ) ||
      !input.reason.trim() ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= this.clock.now().getTime() ||
      expiresAt > maximumExpiry
    ) {
      throw new Error(
        "Forge compatibility migration must be an owner-authorized, bounded, read-only legacy viewer grant."
      );
    }
    const authorization: CompatibilityAuthorization = {
      id: `compat_${randomUUID()}`,
      clientId: client.id,
      ownerId: client.ownerId,
      audience: client.audience,
      profile: "viewer",
      scopes: [...new Set(input.scopes)].sort(),
      mode: "compatibility_bearer",
      reason: input.reason.trim(),
      authorizedBy: input.session.sessionId,
      authorizedAt: this.clock.now().toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      revokedAt: null
    };
    this.repository.createCompatibilityAuthorization(authorization);
    return authorization;
  }

  revoke(input: {
    session: VerifiedBrowserSession;
    authorizationId: string;
    reason: string;
  }) {
    const principal = this.browserSessions.consumeAuthenticatedOwnerSession(
      input.session
    );
    const authorization = this.repository.readCompatibilityAuthorization(
      input.authorizationId
    );
    if (
      !authorization ||
      authorization.ownerId !== principal.ownerId ||
      authorization.revokedAt ||
      !input.reason.trim()
    ) {
      throw new Error(
        "Forge compatibility authorization is unavailable to this owner."
      );
    }
    return this.repository.revokeCompatibilityAuthorization(
      authorization.id,
      input.reason.trim()
    );
  }
}
