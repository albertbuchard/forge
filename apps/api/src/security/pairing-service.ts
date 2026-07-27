import { randomUUID } from "node:crypto";

import { PairingClientProofVerifier } from "./pairing-client-proof.js";
import {
  PairingOwnerAuthorizationService,
  type PairingOwnerAuthorization
} from "./pairing-owner-authorization.js";
import {
  PairingNetworkPartitionAuthority,
  type VerifiedNetworkPartition
} from "./pairing-network-partition.js";
import {
  createHumanUserCode,
  createOpaqueSecret,
  normalizeHumanUserCode,
  type OpaqueSecretSource,
  type SecurityClock,
  type KeyedSecretDigester
} from "./security-runtime.js";

export type PairingStatus =
  | "pending"
  | "approved"
  | "denied"
  | "cancelled"
  | "consumed"
  | "expired";

export type PairingRequest = {
  id: string;
  ownerId: string;
  ownerSecurityEpoch: number;
  installationId: string;
  clientName: string;
  clientType: "api" | "browser";
  clientKeyThumbprint: string;
  audience: string;
  requestedScopes: readonly string[];
  requestedProfile: string;
  deviceDigest: string;
  userCodeDigest: string;
  status: PairingStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  pollIntervalSeconds: number;
  nextPollAt: string;
  approval: {
    ownerId: string;
    ownerSecurityEpoch: number;
    scopes: readonly string[];
    profile: string;
    approvedAt: string;
  } | null;
};

export type PairingRepository = {
  readOwnerSecurityEpoch(ownerId: string): number | null;
  createPairingRequestWithCaps(input: {
    record: PairingRequest;
    maximumPendingPerInstallation: number;
    maximumPendingPerOwner: number;
    maximumPendingGlobally: number;
    admissionNetworkBucketKey: string;
    admissionInstallationBucketKey: string;
    admissionWindowSeconds: number;
    maximumAdmissionAttempts: number;
  }): boolean;
  findPairingByDeviceDigest(deviceDigest: string): PairingRequest | null;
  findPairingByUserCodeDigest(userCodeDigest: string): PairingRequest | null;
  readPairingRequest(id: string): PairingRequest | null;
  claimPairingApprovalAttempt(input: {
    bucketKey: string;
    now: string;
    windowSeconds: number;
    maximumAttempts: number;
  }): boolean;
  claimPairingPollNetworkAttempt(input: {
    bucketKey: string;
    now: string;
    windowSeconds: number;
    maximumAttempts: number;
  }): boolean;
  claimPairingPollClientAttempt(input: {
    installationBucketKey: string;
    clientBucketKey: string;
    now: string;
    windowSeconds: number;
    maximumInstallationAttempts: number;
    maximumClientAttempts: number;
  }): boolean;
  approvePairingRequest(input: {
    id: string;
    approval: NonNullable<PairingRequest["approval"]>;
    now: string;
  }): boolean;
  transitionPairingRequest(input: {
    id: string;
    fromStatuses: readonly PairingStatus[];
    toStatus: PairingStatus;
    now: string;
  }): boolean;
  updatePairingPoll(input: {
    id: string;
    expectedNextPollAt: string;
    pollIntervalSeconds: number;
    nextPollAt: string;
    now: string;
  }): boolean;
};

export type PairingPollResult =
  | { status: "authorization_pending"; intervalSeconds: number }
  | { status: "slow_down"; intervalSeconds: number }
  | { status: "access_denied" }
  | { status: "expired_token" }
  | {
      status: "approved";
      grant: {
        requestId: string;
        ownerId: string;
        ownerSecurityEpoch: number;
        installationId: string;
        clientType: "api" | "browser";
        clientKeyThumbprint: string;
        audience: string;
        scopes: readonly string[];
        profile: string;
      };
    };

const PAIRING_PROFILES = new Set([
  "viewer",
  "trusted_personal_assistant",
  "executor",
  "operator",
  "custom"
]);

function validatePairingStart(input: {
  ownerId: string;
  installationId: string;
  clientName: string;
  clientKeyThumbprint: string;
  audience: string;
  requestedScopes: readonly string[];
  requestedProfile: string;
}) {
  const identifier = /^[A-Za-z0-9._:-]+$/;
  let audience: URL;
  try {
    audience = new URL(input.audience);
  } catch {
    throw new Error("Forge pairing audience is not an absolute URL.");
  }
  const secureAudience =
    audience.protocol === "https:" ||
    (audience.protocol === "urn:" &&
      /^urn:forge:install_[A-Za-z0-9-]{16,160}:api$/.test(input.audience));
  if (
    input.ownerId.length < 1 ||
    input.ownerId.length > 128 ||
    !identifier.test(input.ownerId) ||
    input.installationId.length < 1 ||
    input.installationId.length > 128 ||
    !identifier.test(input.installationId) ||
    input.clientName.trim().length < 1 ||
    input.clientName.length > 120 ||
    input.clientName.includes("\0") ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(input.clientKeyThumbprint) ||
    !secureAudience ||
    audience.username ||
    audience.password ||
    audience.search ||
    audience.hash ||
    input.audience.length > 512 ||
    input.requestedScopes.length < 1 ||
    input.requestedScopes.length > 32 ||
    input.requestedScopes.some(
      (scope) =>
        scope.length < 1 || scope.length > 128 || !/^[a-z0-9._:-]+$/.test(scope)
    ) ||
    !PAIRING_PROFILES.has(input.requestedProfile)
  ) {
    throw new Error("Forge pairing request is malformed or unbounded.");
  }
}

export class PairingService<ServerContext = unknown> {
  constructor(
    private readonly clock: SecurityClock,
    private readonly secrets: OpaqueSecretSource,
    private readonly digester: KeyedSecretDigester,
    private readonly repository: PairingRepository,
    private readonly clientProofs: PairingClientProofVerifier,
    private readonly ownerAuthorizations: PairingOwnerAuthorizationService<ServerContext>,
    private readonly networkPartitions: PairingNetworkPartitionAuthority<ServerContext>,
    private readonly verificationUri: string,
    private readonly expectedAudience = new URL(
      "/api",
      verificationUri
    ).toString(),
    private readonly lifetimeSeconds = 600,
    private readonly maximumPendingPerInstallation = 3,
    private readonly maximumPendingPerOwner = 25,
    private readonly maximumPendingGlobally = 1_000,
    private readonly maximumAdmissionAttempts = 10,
    private readonly admissionWindowSeconds = 60,
    private readonly maximumNetworkPollAttempts = 600,
    private readonly maximumInstallationPollAttempts = 120,
    private readonly maximumClientPollAttempts = 30,
    private readonly pollRateWindowSeconds = 60
  ) {}

  begin(input: {
    ownerId: string;
    networkPartition: VerifiedNetworkPartition;
    installationId: string;
    clientName: string;
    clientType?: "api" | "browser";
    clientKeyThumbprint: string;
    audience: string;
    requestedScopes: readonly string[];
    requestedProfile: string;
  }) {
    validatePairingStart(input);
    if (input.audience !== this.expectedAudience) {
      throw new Error(
        "Forge pairing audience does not match this server installation."
      );
    }
    const networkIdentity = this.networkPartitions.consume(
      input.networkPartition
    );
    const ownerSecurityEpoch = this.repository.readOwnerSecurityEpoch(
      input.ownerId
    );
    if (!ownerSecurityEpoch) {
      throw new Error("Forge pairing owner state is unavailable.");
    }
    const now = this.clock.now();
    const deviceCode = createOpaqueSecret(this.secrets, "fg_device");
    const userCode = createHumanUserCode(this.secrets);
    const request: PairingRequest = {
      id: `pair_${randomUUID()}`,
      ownerId: input.ownerId,
      ownerSecurityEpoch,
      installationId: input.installationId,
      clientName: input.clientName,
      clientType: input.clientType ?? "api",
      clientKeyThumbprint: input.clientKeyThumbprint,
      audience: input.audience,
      requestedScopes: [...new Set(input.requestedScopes)].sort(),
      requestedProfile: input.requestedProfile,
      deviceDigest: this.digester.digest("device-code", deviceCode),
      userCodeDigest: this.digester.digest(
        "user-code",
        normalizeHumanUserCode(userCode)
      ),
      status: "pending",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + this.lifetimeSeconds * 1000
      ).toISOString(),
      pollIntervalSeconds: 5,
      nextPollAt: new Date(now.getTime() + 5_000).toISOString(),
      approval: null
    };
    if (
      !this.repository.createPairingRequestWithCaps({
        record: request,
        maximumPendingPerInstallation: this.maximumPendingPerInstallation,
        maximumPendingPerOwner: this.maximumPendingPerOwner,
        maximumPendingGlobally: this.maximumPendingGlobally,
        admissionNetworkBucketKey: this.digester.digest(
          "pairing-admission-network",
          networkIdentity
        ),
        admissionInstallationBucketKey: this.digester.digest(
          "pairing-admission-installation",
          `${input.ownerId}\0${input.installationId}`
        ),
        admissionWindowSeconds: this.admissionWindowSeconds,
        maximumAdmissionAttempts: this.maximumAdmissionAttempts
      })
    ) {
      throw new Error(
        "Forge pairing has reached its bounded pending-request cap."
      );
    }
    return {
      requestId: request.id,
      deviceCode,
      userCode,
      verificationUri: this.verificationUri,
      expiresIn: this.lifetimeSeconds,
      interval: request.pollIntervalSeconds
    };
  }

  approve(input: { authorization: PairingOwnerAuthorization }) {
    const now = this.clock.now().toISOString();
    const request = this.repository.readPairingRequest(
      input.authorization.requestId
    );
    if (!request || request.status !== "pending") {
      throw new Error("Forge pairing code is invalid or unavailable.");
    }
    const authorization = this.ownerAuthorizations.consume(
      input.authorization,
      { requestId: request.id, decision: "approve" }
    );
    if (Date.parse(request.expiresAt) <= Date.parse(now)) {
      this.repository.transitionPairingRequest({
        id: request.id,
        fromStatuses: ["pending"],
        toStatus: "expired",
        now
      });
      throw new Error("Forge pairing request is no longer pending.");
    }
    const requested = new Set(request.requestedScopes);
    if (authorization.scopes.some((scope) => !requested.has(scope))) {
      throw new Error("Forge pairing approval cannot expand requested scopes.");
    }
    if (authorization.profile !== request.requestedProfile) {
      throw new Error(
        "Forge pairing approval cannot expand the requested profile."
      );
    }
    if (
      authorization.ownerId !== request.ownerId ||
      authorization.ownerSecurityEpoch !== request.ownerSecurityEpoch
    ) {
      throw new Error(
        "Forge pairing approval uses a stale or different owner."
      );
    }
    const approval: NonNullable<PairingRequest["approval"]> = {
      ownerId: authorization.ownerId,
      ownerSecurityEpoch: authorization.ownerSecurityEpoch,
      scopes: [
        ...new Set([
          ...authorization.scopes,
          `profile:${authorization.profile}`
        ])
      ].sort(),
      profile: authorization.profile,
      approvedAt: now
    };
    if (
      !this.repository.approvePairingRequest({
        id: request.id,
        approval,
        now
      })
    ) {
      throw new Error("Forge pairing approval lost a concurrent state change.");
    }
    return {
      requestId: request.id,
      clientName: request.clientName,
      audience: request.audience,
      scopes: approval.scopes,
      profile: approval.profile
    };
  }

  deny(input: { authorization: PairingOwnerAuthorization }) {
    const request = this.repository.readPairingRequest(
      input.authorization.requestId
    );
    if (!request) {
      throw new Error("Forge pairing request is unavailable.");
    }
    this.ownerAuthorizations.consume(input.authorization, {
      requestId: request.id,
      decision: "deny"
    });
    if (
      !this.repository.transitionPairingRequest({
        id: request.id,
        fromStatuses: ["pending"],
        toStatus: "denied",
        now: this.clock.now().toISOString()
      })
    ) {
      throw new Error("Forge pairing request is unavailable.");
    }
  }

  async cancel(input: { deviceCode: string; clientProof: string }) {
    const request = this.repository.findPairingByDeviceDigest(
      this.digester.digest("device-code", input.deviceCode)
    );
    if (!request) {
      return false;
    }
    await this.clientProofs.verify({
      proof: input.clientProof,
      expectedKeyThumbprint: request.clientKeyThumbprint,
      expectedRequestId: request.id,
      expectedOperation: "cancel"
    });
    return this.repository.transitionPairingRequest({
      id: request.id,
      fromStatuses: ["pending", "approved"],
      toStatus: "cancelled",
      now: this.clock.now().toISOString()
    });
  }

  async poll(input: {
    deviceCode: string;
    clientProof: string;
    networkPartition: VerifiedNetworkPartition;
  }): Promise<PairingPollResult> {
    const now = this.clock.now().toISOString();
    const networkIdentity = this.networkPartitions.consume(
      input.networkPartition
    );
    if (
      !this.repository.claimPairingPollNetworkAttempt({
        bucketKey: this.digester.digest(
          "pairing-poll-network",
          networkIdentity
        ),
        now,
        windowSeconds: this.pollRateWindowSeconds,
        maximumAttempts: this.maximumNetworkPollAttempts
      })
    ) {
      return { status: "slow_down", intervalSeconds: 60 };
    }
    const digest = this.digester.digest("device-code", input.deviceCode);
    const request = this.repository.findPairingByDeviceDigest(digest);
    if (!request) {
      return { status: "expired_token" };
    }
    await this.clientProofs.verify({
      proof: input.clientProof,
      expectedKeyThumbprint: request.clientKeyThumbprint,
      expectedRequestId: request.id,
      expectedOperation: "poll"
    });
    if (
      !this.repository.claimPairingPollClientAttempt({
        installationBucketKey: this.digester.digest(
          "pairing-poll-installation",
          `${request.ownerId}\0${request.installationId}`
        ),
        clientBucketKey: this.digester.digest(
          "pairing-poll-client",
          request.clientKeyThumbprint
        ),
        now,
        windowSeconds: this.pollRateWindowSeconds,
        maximumInstallationAttempts: this.maximumInstallationPollAttempts,
        maximumClientAttempts: this.maximumClientPollAttempts
      })
    ) {
      return { status: "slow_down", intervalSeconds: 60 };
    }
    return this.pollVerified(request);
  }

  private pollVerified(request: PairingRequest): PairingPollResult {
    const now = this.clock.now();
    if (
      Date.parse(request.expiresAt) <= now.getTime() &&
      !["consumed", "expired", "cancelled"].includes(request.status)
    ) {
      this.repository.transitionPairingRequest({
        id: request.id,
        fromStatuses: ["pending", "approved", "denied"],
        toStatus: "expired",
        now: now.toISOString()
      });
      return { status: "expired_token" };
    }
    if (
      request.status === "expired" ||
      request.status === "consumed" ||
      request.status === "cancelled"
    ) {
      return { status: "expired_token" };
    }
    if (request.status === "denied") {
      return { status: "access_denied" };
    }
    if (now.getTime() < Date.parse(request.nextPollAt)) {
      const intervalSeconds = request.pollIntervalSeconds + 5;
      this.repository.updatePairingPoll({
        id: request.id,
        expectedNextPollAt: request.nextPollAt,
        pollIntervalSeconds: intervalSeconds,
        nextPollAt: new Date(
          now.getTime() + intervalSeconds * 1000
        ).toISOString(),
        now: now.toISOString()
      });
      return { status: "slow_down", intervalSeconds };
    }
    this.repository.updatePairingPoll({
      id: request.id,
      expectedNextPollAt: request.nextPollAt,
      pollIntervalSeconds: request.pollIntervalSeconds,
      nextPollAt: new Date(
        now.getTime() + request.pollIntervalSeconds * 1000
      ).toISOString(),
      now: now.toISOString()
    });
    if (request.status === "pending") {
      return {
        status: "authorization_pending",
        intervalSeconds: request.pollIntervalSeconds
      };
    }
    if (!request.approval) {
      throw new Error("Approved Forge pairing request has no approval.");
    }
    if (
      !this.repository.transitionPairingRequest({
        id: request.id,
        fromStatuses: ["approved"],
        toStatus: "consumed",
        now: now.toISOString()
      })
    ) {
      return { status: "expired_token" };
    }
    return {
      status: "approved",
      grant: {
        requestId: request.id,
        ownerId: request.approval.ownerId,
        ownerSecurityEpoch: request.approval.ownerSecurityEpoch,
        installationId: request.installationId,
        clientType: request.clientType,
        clientKeyThumbprint: request.clientKeyThumbprint,
        audience: request.audience,
        scopes: request.approval.scopes,
        profile: request.approval.profile
      }
    };
  }
}
