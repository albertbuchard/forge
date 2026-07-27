import { randomUUID } from "node:crypto";

import type { ForgePrincipal } from "./contracts.js";
import {
  createOpaqueSecret,
  type KeyedSecretDigester,
  type OpaqueSecretSource,
  type SecurityClock
} from "./security-runtime.js";

export type BrowserSessionRecord = {
  id: string;
  sessionDigest: string;
  csrfDigest: string;
  principal: ForgePrincipal;
  ownerSecurityEpoch: number;
  createdAt: string;
  lastUsedAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
};

export type BrowserSessionRepository = {
  createBrowserSession(record: BrowserSessionRecord): void;
  findBrowserSessionByDigest(
    sessionDigest: string
  ): BrowserSessionRecord | null;
  touchBrowserSession(input: {
    id: string;
    expectedSessionDigest: string;
    lastUsedAt: string;
    idleExpiresAt: string;
  }): boolean;
  rotateBrowserSession(input: {
    id: string;
    expectedSessionDigest: string;
    nextSessionDigest: string;
    nextCsrfDigest: string;
  }): boolean;
  revokeBrowserSession(id: string, revokedAt: string): boolean;
};

export type OwnerEpochReader = {
  readOwnerSecurityEpoch(ownerId: string): number | null;
};

export type BrowserClientStateReader = {
  readClient(clientId: string): {
    ownerId: string;
    installationId: string;
    audience: string;
    profile: ForgePrincipal["profile"];
    scopes: readonly string[];
    ownerSecurityEpoch: number;
    clientSecurityEpoch: number;
    revokedAt: string | null;
  } | null;
};

declare const verifiedBrowserSessionBrand: unique symbol;

export type VerifiedBrowserSession = {
  readonly sessionId: string;
  readonly principal: ForgePrincipal;
  readonly authenticatedAt: string;
  readonly absoluteExpiresAt: string;
  readonly [verifiedBrowserSessionBrand]: true;
};

export class BrowserSessionService {
  private readonly unusedAuthentications = new WeakSet<object>();
  private readonly runtimeBinding = randomUUID();

  constructor(
    private readonly clock: SecurityClock,
    private readonly secrets: OpaqueSecretSource,
    private readonly digester: KeyedSecretDigester,
    private readonly repository: BrowserSessionRepository,
    private readonly ownerEpochs: OwnerEpochReader,
    private readonly idleLifetimeSeconds = 12 * 60 * 60,
    private readonly absoluteLifetimeSeconds = 7 * 24 * 60 * 60,
    private readonly clientStates: BrowserClientStateReader | null = null
  ) {}

  create(
    principal: ForgePrincipal,
    options: {
      idleLifetimeSeconds?: number;
      absoluteLifetimeSeconds?: number;
      processBound?: boolean;
    } = {}
  ) {
    const ownerBrowserPrincipal =
      principal.kind === "operator_session" &&
      principal.clientId === null &&
      principal.installationId === null &&
      principal.clientSecurityEpoch === null;
    const localNativePrincipal =
      principal.kind === "local_service" &&
      principal.clientId === null &&
      principal.installationId !== null &&
      principal.clientSecurityEpoch === null &&
      principal.profile === "operator";
    const pairedBrowserPrincipal =
      principal.kind === "paired_client" &&
      principal.clientId !== null &&
      principal.installationId !== null &&
      principal.clientSecurityEpoch !== null;
    if (
      !ownerBrowserPrincipal &&
      !localNativePrincipal &&
      !pairedBrowserPrincipal
    ) {
      throw new Error(
        "Browser sessions require an owner browser or local-native principal."
      );
    }
    const currentOwnerEpoch = this.ownerEpochs.readOwnerSecurityEpoch(
      principal.ownerId
    );
    if (currentOwnerEpoch !== principal.ownerSecurityEpoch) {
      throw new Error("Browser session principal uses a stale owner epoch.");
    }
    if (
      pairedBrowserPrincipal &&
      !this.clientStateMatches(principal)
    ) {
      throw new Error("Browser session principal uses a stale client grant.");
    }
    const now = this.clock.now();
    const sessionToken = createOpaqueSecret(this.secrets, "fg_session");
    const csrfToken = createOpaqueSecret(this.secrets, "fg_csrf");
    const idleLifetimeSeconds =
      options.idleLifetimeSeconds ?? this.idleLifetimeSeconds;
    const absoluteLifetimeSeconds =
      options.absoluteLifetimeSeconds ?? this.absoluteLifetimeSeconds;
    if (
      !Number.isSafeInteger(idleLifetimeSeconds) ||
      !Number.isSafeInteger(absoluteLifetimeSeconds) ||
      idleLifetimeSeconds <= 0 ||
      absoluteLifetimeSeconds <= 0 ||
      idleLifetimeSeconds > absoluteLifetimeSeconds
    ) {
      throw new Error("Forge browser-session lifetimes are invalid.");
    }
    const recordPrincipal = options.processBound
      ? { ...principal, runtimeBinding: this.runtimeBinding }
      : principal;
    const record: BrowserSessionRecord = {
      id: `ses_${randomUUID()}`,
      sessionDigest: this.digester.digest("browser-session", sessionToken),
      csrfDigest: this.digester.digest("browser-csrf", csrfToken),
      principal: recordPrincipal,
      ownerSecurityEpoch: principal.ownerSecurityEpoch,
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      idleExpiresAt: new Date(
        now.getTime() + idleLifetimeSeconds * 1000
      ).toISOString(),
      absoluteExpiresAt: new Date(
        now.getTime() + absoluteLifetimeSeconds * 1000
      ).toISOString(),
      revokedAt: null
    };
    this.repository.createBrowserSession(record);
    return {
      sessionId: record.id,
      sessionToken,
      csrfToken,
      absoluteExpiresAt: record.absoluteExpiresAt
    };
  }

  authenticate(input: {
    sessionToken: string;
    csrfToken?: string;
    unsafeMethod: boolean;
  }) {
    const digest = this.digester.digest("browser-session", input.sessionToken);
    const record = this.repository.findBrowserSessionByDigest(digest);
    if (!record || record.revokedAt) {
      return null;
    }
    const now = this.clock.now();
    const currentOwnerEpoch = this.ownerEpochs.readOwnerSecurityEpoch(
      record.principal.ownerId
    );
    if (
      Date.parse(record.idleExpiresAt) <= now.getTime() ||
      Date.parse(record.absoluteExpiresAt) <= now.getTime() ||
      currentOwnerEpoch !== record.ownerSecurityEpoch ||
      (record.principal.kind === "paired_client" &&
        !this.clientStateMatches(record.principal)) ||
      (record.principal.runtimeBinding !== undefined &&
        record.principal.runtimeBinding !== this.runtimeBinding)
    ) {
      this.repository.revokeBrowserSession(record.id, now.toISOString());
      return null;
    }
    if (
      (input.unsafeMethod || record.principal.kind === "local_service") &&
      (!input.csrfToken ||
        !this.digester.matches(
          "browser-csrf",
          input.csrfToken,
          record.csrfDigest
        ))
    ) {
      throw new Error(
        "Forge browser session CSRF proof is missing or invalid."
      );
    }
    const storedIdleLifetimeMilliseconds =
      Date.parse(record.idleExpiresAt) - Date.parse(record.lastUsedAt);
    const recordedIdleLifetimeMilliseconds =
      Number.isFinite(storedIdleLifetimeMilliseconds) &&
      storedIdleLifetimeMilliseconds > 0
        ? Math.min(
            this.idleLifetimeSeconds * 1000,
            storedIdleLifetimeMilliseconds
          )
        : this.idleLifetimeSeconds * 1000;
    const admitted =
      record.principal.kind === "local_service"
        ? this.repository.revokeBrowserSession(
            record.id,
            now.toISOString()
          )
        : this.repository.touchBrowserSession({
            id: record.id,
            expectedSessionDigest: digest,
            lastUsedAt: now.toISOString(),
            idleExpiresAt: new Date(
              Math.min(
                now.getTime() + recordedIdleLifetimeMilliseconds,
                Date.parse(record.absoluteExpiresAt)
              )
            ).toISOString()
          });
    if (!admitted) {
      return null;
    }
    const authenticated = {
      sessionId: record.id,
      principal: record.principal,
      authenticatedAt: now.toISOString(),
      absoluteExpiresAt: record.absoluteExpiresAt
    } as VerifiedBrowserSession;
    this.unusedAuthentications.add(authenticated);
    return authenticated;
  }

  consumeAuthenticatedOwnerSession(session: VerifiedBrowserSession) {
    if (
      !this.unusedAuthentications.delete(session) ||
      session.principal.kind !== "operator_session" ||
      session.principal.profile !== "operator" ||
      session.principal.clientId !== null ||
      session.principal.installationId !== null ||
      session.principal.clientSecurityEpoch !== null ||
      this.ownerEpochs.readOwnerSecurityEpoch(session.principal.ownerId) !==
        session.principal.ownerSecurityEpoch
    ) {
      throw new Error(
        "Forge browser-session authority is forged, replayed, or stale."
      );
    }
    return session.principal;
  }

  rotate(sessionToken: string) {
    const digest = this.digester.digest("browser-session", sessionToken);
    const record = this.repository.findBrowserSessionByDigest(digest);
    if (!record || record.revokedAt) {
      return null;
    }
    const nextSessionToken = createOpaqueSecret(this.secrets, "fg_session");
    const nextCsrfToken = createOpaqueSecret(this.secrets, "fg_csrf");
    const rotated = this.repository.rotateBrowserSession({
      id: record.id,
      expectedSessionDigest: digest,
      nextSessionDigest: this.digester.digest(
        "browser-session",
        nextSessionToken
      ),
      nextCsrfDigest: this.digester.digest("browser-csrf", nextCsrfToken)
    });
    return rotated
      ? { sessionToken: nextSessionToken, csrfToken: nextCsrfToken }
      : null;
  }

  revoke(sessionToken: string) {
    const digest = this.digester.digest("browser-session", sessionToken);
    const record = this.repository.findBrowserSessionByDigest(digest);
    return record
      ? this.repository.revokeBrowserSession(
          record.id,
          this.clock.now().toISOString()
        )
      : false;
  }

  private clientStateMatches(principal: ForgePrincipal) {
    if (
      !this.clientStates ||
      !principal.clientId ||
      !principal.installationId ||
      principal.clientSecurityEpoch === null
    ) {
      return false;
    }
    const client = this.clientStates.readClient(principal.clientId);
    return Boolean(
      client &&
        !client.revokedAt &&
        client.ownerId === principal.ownerId &&
        client.installationId === principal.installationId &&
        client.audience === principal.audience &&
        client.profile === principal.profile &&
        client.ownerSecurityEpoch === principal.ownerSecurityEpoch &&
        client.clientSecurityEpoch === principal.clientSecurityEpoch &&
        principal.scopes.every((scope) => client.scopes.includes(scope))
    );
  }
}
