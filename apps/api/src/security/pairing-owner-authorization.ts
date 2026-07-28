import type {
  BrowserSessionService,
  VerifiedBrowserSession
} from "./browser-session-service.js";
import type { PrivilegedPairingAuthorization } from "./owner-step-up-service.js";
import {
  PairingNetworkPartitionAuthority,
  type VerifiedNetworkPartition
} from "./pairing-network-partition.js";
import type { PairingRepository, PairingRequest } from "./pairing-service.js";
import type { ServerPairingReview } from "./pairing-review.js";
import {
  normalizeHumanUserCode,
  type KeyedSecretDigester,
  type SecurityClock
} from "./security-runtime.js";

declare const pairingOwnerAuthorizationBrand: unique symbol;

export type PairingOwnerAuthorization = {
  readonly decision: "approve" | "deny";
  readonly requestId: string;
  readonly ownerId: string;
  readonly ownerSecurityEpoch: number;
  readonly scopes: readonly string[];
  readonly profile: string;
  readonly authorizedBySessionId: string;
  readonly authorizedAt: string;
  readonly [pairingOwnerAuthorizationBrand]: true;
};

export type PrivilegedPairingAuthorizationConsumer = {
  consumePrivilegedPairingAuthorization(
    authorization: PrivilegedPairingAuthorization,
    expectedRequestId: string
  ): PrivilegedPairingAuthorization;
};

function requiresPrivilegedStepUp(
  request: PairingRequest,
  scopes: readonly string[]
) {
  return (
    ["executor", "operator", "custom"].includes(request.requestedProfile) ||
    scopes.some(
      (scope) =>
        scope === "*" ||
        scope.startsWith("machine.") ||
        scope.startsWith("secret.") ||
        scope.startsWith("admin.")
    )
  );
}

export class PairingOwnerAuthorizationService<ServerContext = unknown> {
  private readonly unusedAuthorizations = new WeakSet<object>();

  constructor(
    private readonly clock: SecurityClock,
    private readonly digester: KeyedSecretDigester,
    private readonly repository: PairingRepository,
    private readonly browserSessions: BrowserSessionService,
    private readonly privilegedAuthorizations: PrivilegedPairingAuthorizationConsumer,
    private readonly networkPartitions: PairingNetworkPartitionAuthority<ServerContext>,
    private readonly maximumCodeAttempts = 5,
    private readonly codeAttemptWindowSeconds = 60,
    private readonly createReview: (
      request: PairingRequest
    ) => ServerPairingReview = (request) => ({
      requestId: request.id,
      clientName: request.clientName,
      clientType: request.clientType,
      audience: request.audience,
      requestedScopes: request.requestedScopes,
      requestedProfile: request.requestedProfile,
      expiresAt: request.expiresAt,
      installationFingerprint: "UNAVAILABLE",
      endpoint: {
        origin: null,
        fingerprint: "UNAVAILABLE"
      },
      boundaries: {
        resources: {
          profile: request.requestedProfile,
          scopes: request.requestedScopes,
          enforcement: "profile_scopes_and_route_policy"
        },
        egress: {
          requestedScopes: [],
          enforcement: "capability_policy_and_destination_validation",
          default: "denied_unless_capability_explicitly_allows"
        }
      }
    })
  ) {}

  authorizeApproval(input: {
    session: VerifiedBrowserSession;
    userCode: string;
    networkPartition: VerifiedNetworkPartition;
    requestId?: string;
    scopes: readonly string[];
    profile: string;
    privilegedAuthorization?: PrivilegedPairingAuthorization;
  }) {
    const sessionPrincipal =
      this.browserSessions.consumeAuthenticatedOwnerSession(input.session);
    const request = this.resolvePendingRequest(
      input.userCode,
      input.networkPartition
    );
    if (input.requestId && request.id !== input.requestId) {
      throw new Error(
        "Forge pairing code does not match the selected request."
      );
    }
    this.requireRequestOwner(request, sessionPrincipal.ownerId);
    const requested = new Set(request.requestedScopes);
    if (input.scopes.some((scope) => !requested.has(scope))) {
      throw new Error("Forge pairing approval cannot expand requested scopes.");
    }
    if (input.profile !== request.requestedProfile) {
      throw new Error(
        "Forge pairing approval cannot expand the requested profile."
      );
    }
    if (requiresPrivilegedStepUp(request, input.scopes)) {
      if (!input.privilegedAuthorization) {
        throw new Error(
          "Forge elevated pairing approval requires current owner step-up."
        );
      }
      const stepUp =
        this.privilegedAuthorizations.consumePrivilegedPairingAuthorization(
          input.privilegedAuthorization,
          request.id
        );
      if (
        stepUp.ownerUserId !== sessionPrincipal.ownerId ||
        stepUp.ownerSecurityEpoch !== sessionPrincipal.ownerSecurityEpoch
      ) {
        throw new Error(
          "Forge pairing step-up belongs to another owner epoch."
        );
      }
    } else if (input.privilegedAuthorization) {
      throw new Error(
        "Forge pairing approval received an unnecessary step-up capability."
      );
    }
    return this.issue({
      decision: "approve",
      request,
      scopes: [...new Set(input.scopes)].sort(),
      profile: input.profile,
      sessionId: input.session.sessionId
    });
  }

  review(input: {
    session: VerifiedBrowserSession;
    userCode: string;
    networkPartition: VerifiedNetworkPartition;
  }) {
    const sessionPrincipal =
      this.browserSessions.consumeAuthenticatedOwnerSession(input.session);
    const request = this.resolvePendingRequest(
      input.userCode,
      input.networkPartition
    );
    this.requireRequestOwner(request, sessionPrincipal.ownerId);
    return this.createReview(request);
  }

  listActiveRequests(input: {
    session: VerifiedBrowserSession;
    limit?: number;
  }) {
    const sessionPrincipal =
      this.browserSessions.consumeAuthenticatedOwnerSession(input.session);
    const currentEpoch = this.repository.readOwnerSecurityEpoch(
      sessionPrincipal.ownerId
    );
    if (!currentEpoch || currentEpoch !== sessionPrincipal.ownerSecurityEpoch) {
      throw new Error("Forge pairing owner session is stale.");
    }
    const now = this.clock.now().toISOString();
    return this.repository
      .listActivePairingRequests({
        ownerId: sessionPrincipal.ownerId,
        ownerSecurityEpoch: currentEpoch,
        now,
        limit: input.limit ?? 25
      })
      .map((request) => ({
        ...this.createReview(request),
        status: request.status as "pending" | "approved",
        approvedAt: request.approval?.approvedAt ?? null
      }));
  }

  authorizeDenial(input: {
    session: VerifiedBrowserSession;
    userCode: string;
    networkPartition: VerifiedNetworkPartition;
  }) {
    const sessionPrincipal =
      this.browserSessions.consumeAuthenticatedOwnerSession(input.session);
    const request = this.resolvePendingRequest(
      input.userCode,
      input.networkPartition
    );
    this.requireRequestOwner(request, sessionPrincipal.ownerId);
    return this.issue({
      decision: "deny",
      request,
      scopes: [],
      profile: request.requestedProfile,
      sessionId: input.session.sessionId
    });
  }

  authorizeDenialByRequestId(input: {
    session: VerifiedBrowserSession;
    requestId: string;
  }) {
    const sessionPrincipal =
      this.browserSessions.consumeAuthenticatedOwnerSession(input.session);
    const request = this.repository.readPairingRequest(input.requestId);
    if (
      !request ||
      request.status !== "pending" ||
      Date.parse(request.expiresAt) <= this.clock.now().getTime()
    ) {
      throw new Error("Forge pairing request is unavailable.");
    }
    this.requireRequestOwner(request, sessionPrincipal.ownerId);
    return this.issue({
      decision: "deny",
      request,
      scopes: [],
      profile: request.requestedProfile,
      sessionId: input.session.sessionId
    });
  }

  consume(
    authorization: PairingOwnerAuthorization,
    expected: { requestId: string; decision: "approve" | "deny" }
  ) {
    if (
      !this.unusedAuthorizations.delete(authorization) ||
      authorization.requestId !== expected.requestId ||
      authorization.decision !== expected.decision ||
      this.repository.readOwnerSecurityEpoch(authorization.ownerId) !==
        authorization.ownerSecurityEpoch
    ) {
      throw new Error(
        "Forge pairing owner authorization is forged, replayed, mismatched, or stale."
      );
    }
    return authorization;
  }

  private resolvePendingRequest(
    userCode: string,
    networkPartition: VerifiedNetworkPartition
  ) {
    const networkIdentity = this.networkPartitions.consume(networkPartition);
    const now = this.clock.now().toISOString();
    if (
      !this.repository.claimPairingApprovalAttempt({
        bucketKey: this.digester.digest(
          "pairing-owner-approval-partition",
          networkIdentity
        ),
        now,
        windowSeconds: this.codeAttemptWindowSeconds,
        maximumAttempts: this.maximumCodeAttempts
      })
    ) {
      throw new Error("Forge pairing user-code attempts are rate limited.");
    }
    const request = this.repository.findPairingByUserCodeDigest(
      this.digester.digest("user-code", normalizeHumanUserCode(userCode))
    );
    if (
      !request ||
      request.status !== "pending" ||
      Date.parse(request.expiresAt) <= Date.parse(now)
    ) {
      throw new Error("Forge pairing code is invalid or unavailable.");
    }
    return request;
  }

  private requireRequestOwner(request: PairingRequest, ownerId: string) {
    if (
      request.ownerId !== ownerId ||
      request.ownerSecurityEpoch !==
        this.repository.readOwnerSecurityEpoch(ownerId)
    ) {
      throw new Error("Forge pairing request belongs to another owner epoch.");
    }
  }

  private issue(input: {
    decision: "approve" | "deny";
    request: PairingRequest;
    scopes: readonly string[];
    profile: string;
    sessionId: string;
  }) {
    const authorization = {
      decision: input.decision,
      requestId: input.request.id,
      ownerId: input.request.ownerId,
      ownerSecurityEpoch: input.request.ownerSecurityEpoch,
      scopes: input.scopes,
      profile: input.profile,
      authorizedBySessionId: input.sessionId,
      authorizedAt: this.clock.now().toISOString()
    } as PairingOwnerAuthorization;
    this.unusedAuthorizations.add(authorization);
    return authorization;
  }
}
