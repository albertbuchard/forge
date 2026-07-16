import {
  PEER_PROTOCOL_VERSION,
  type PeerPairingInvite,
  type PeerShareGrantVersion,
  type PeerTransportPrivacyMode
} from "../peer-sharing-types.js";
import type { PeerPendingRequest } from "../repositories/peer-sharing.js";
import type { PeerCommandApprovalBinding } from "./peer-command-authorization.js";
import type { PeerTypedQuestion } from "./peer-typed-query.js";

export type PeerCoreHealth = {
  enabled: boolean;
  healthy: boolean;
  protocolVersion: string | null;
  reason: string | null;
};

export type PeerTransportProviderKind =
  | "local_direct"
  | "iroh"
  | "tor_onion"
  | "http_mailbox";

export type PeerTransportReadiness = {
  providers: Array<{
    kind: PeerTransportProviderKind;
    configured: boolean;
    state: "ready" | "degraded" | "stopped" | "disabled";
    detailCode: string;
    checkedAt: string | null;
  }>;
  provenance: PeerAuthenticatedProvenance;
};

export type PeerDaemonEvidence = {
  protocol: "forge-peer-daemon-evidence/v1";
  statementType: "command_receipt" | "revocation_event_page";
  statementHash: string;
  ownerUserId: string;
  localPrincipalId: string;
  localDeviceId: string;
  signingCertificateHash: string;
  issuedAt: string;
  signature: string;
};

export type PeerInvitationMaterial = {
  invitation: PeerPairingInvite;
  bootstrapCiphertext: Uint8Array;
  bootstrapNonce: Uint8Array;
  bootstrapHash: string;
};

export type PeerPairingAcceptance = {
  requestId: string;
  requestPayload: Record<string, unknown>;
  expiresAt: string;
};

export type PeerPairingConfirmation = {
  relationship: {
    id: string;
    localPrincipal: PeerPairingPrincipal;
    remotePrincipal: PeerPairingPrincipal;
    localDevice: PeerPairingDevice;
    remoteDevice: PeerPairingDevice;
    negotiatedProtocolVersion: string;
    verificationPhraseHash: string;
    privacyMode: PeerTransportPrivacyMode;
  };
  outboundEnvelope: Uint8Array | null;
  provenance: PeerAuthenticatedProvenance;
};

export type PeerAuthenticatedProvenance = {
  protocolVersion: typeof PEER_PROTOCOL_VERSION;
  ownerUserId: string;
  relationshipId: string | null;
  localPrincipalId: string;
  localDeviceId: string;
  remotePrincipalId: string | null;
  remoteDeviceId: string | null;
  evidenceHash: string;
  authenticatedAt: string;
};

export type PeerPairingPrincipal = {
  id: string;
  rootPublicKey: string;
  trustState: "verified";
  certificateHash: string;
};

export type PeerPairingDevice = {
  id: string;
  principalId: string;
  signingPublicKey: string;
  keyAgreementPublicKey: string;
  certificateSerial: string;
  certificate: string;
  certificateHash: string;
  capabilities: PeerPairingDeviceCapability[];
  transportEndpoints: PeerTransportEndpoint[];
  status: "approved";
};

export type PeerPairingDeviceCapability =
  | "direct_stream"
  | "iroh"
  | "tor"
  | "http_mailbox"
  | "query"
  | "projection"
  | "key_package";

export type PeerTransportEndpoint =
  | { kind: "local_direct"; host: string; port: number }
  | { kind: "iroh"; endpointId: string; relayOrigin: string | null }
  | { kind: "tor_onion"; onionHost: string; port: number }
  | { kind: "http_mailbox"; origin: string; opaqueChannel: string };

export type PeerLocalIdentity = {
  principal: PeerPairingPrincipal;
  device: PeerPairingDevice;
  provenance: PeerAuthenticatedProvenance;
};

export type PeerQueryGatewayResult = {
  state: "live" | "cached" | "stale" | "unavailable";
  payload: unknown;
  metadata: Record<string, unknown>;
};

export type PeerQueryPayload = {
  records: Array<{
    recordId: string;
    fields: Record<string, unknown>;
  }>;
};

export type PeerInboundQueryClaim = {
  claimId: string;
  queryId: string;
  relationshipId: string;
  requester: {
    principalId: string;
    deviceId: string;
    relationshipId: string;
  };
  query: PeerTypedQuestion;
  entityIdsAreOpaque: boolean;
  intervalTimeZoneAuthenticated: boolean;
  grantId: string;
  grantSequence: string;
  grantVerificationId: string;
  verifiedGrantHash: string;
  ruleId: string;
  maximumPayloadBytes: number;
  redactedFields: string[];
  receivedAt: string;
  expiresAt: string;
  leaseExpiresAt: string;
};

export type PeerInboundQueryClaimResult = {
  claim: PeerInboundQueryClaim | null;
  provenance: PeerAuthenticatedProvenance;
};

export type PeerInboundQueryResponseResult = {
  queryId: string;
  envelopeId: string;
  provenance: PeerAuthenticatedProvenance;
};

export type PeerRevocationEvent = {
  cursor: string;
  eventHash: string;
  previousEventHash: string;
  kind: "grant" | "device" | "relationship" | "credential_retirement";
  source: "local_operator" | "authenticated_peer" | "certified_rotation";
  relationshipId: string;
  grantId: string | null;
  deviceId: string | null;
  targetCertificate: string | null;
  targetCertificateHash: string | null;
  targetCertificateSerial: string | null;
  reason: string;
  occurredAt: string;
  authenticatedRemotePrincipalId: string | null;
  authenticatedRemoteDeviceId: string | null;
  signingDeviceId: string;
  signingCertificate: string;
  signingCertificateHash: string;
  signature: string;
};

export type PeerRevocationEventPage = {
  events: PeerRevocationEvent[];
  acknowledgedCursor: string;
  nextCursor: string;
  hasMore: boolean;
  provenance: PeerAuthenticatedProvenance;
  evidence?: PeerDaemonEvidence;
};

export type PeerRevocationAckResult = {
  consumerId: string;
  acknowledgedCursor: string;
  eventHash: string;
  acknowledgedAt: string;
  provenance: PeerAuthenticatedProvenance;
};

export type PeerDaemonCommandOperation =
  | "create_invitation"
  | "cancel_invitation"
  | "accept_invitation"
  | "accept_pending_request"
  | "confirm_pairing"
  | "sign_grant"
  | "accept_grant"
  | "revoke_grant"
  | "update_device"
  | "revoke_relationship"
  | "request_resync"
  | "claim_inbound_query"
  | "respond_inbound_query"
  | "ack_revocation_events";

export type PeerDaemonCommandReceipt = {
  commandId: string;
  operation: PeerDaemonCommandOperation;
  requestHash: string;
  approvalDeadline: string | null;
  committedAt: string | null;
  authorization: PeerCommandAuthorizationProvenance | null;
  result: unknown;
  evidence?: PeerDaemonEvidence;
};

export type PeerCommandAuthorizationProvenance = {
  authorityKeyId: string;
  authorizationId: string | null;
  actorClass:
    | "operator_session"
    | "companion_consent"
    | "service_worker"
    | null;
  actorId: string | null;
  actorDeviceId: string | null;
  sessionId: string | null;
  capabilityId: string | null;
  actionDigest: string | null;
  invalidationEpoch: string;
  authorityStateHash: string;
  verifiedAt: string;
};

export type PeerCommandAuthoritySync = {
  commandId: string;
  authorityKeyId: string;
  invalidationEpoch: string;
  stateHash: string;
  committedAt: string;
  authorization: PeerCommandAuthorizationProvenance;
  provenance: PeerAuthenticatedProvenance;
};

export interface PeerCoreGateway {
  health(): Promise<PeerCoreHealth>;
  transportReadiness?(input: {
    ownerUserId: string;
  }): Promise<PeerTransportReadiness>;
  localIdentity(input: { ownerUserId: string }): Promise<PeerLocalIdentity>;
  commandReceipt(input: {
    ownerUserId: string;
    commandId: string;
  }): Promise<PeerDaemonCommandReceipt>;
  syncCommandAuthorizationState(input: {
    ownerUserId: string;
  }): Promise<PeerCommandAuthoritySync>;
  createInvitation(input: {
    commandId: string;
    approvalDeadline: string;
    approval: PeerCommandApprovalBinding;
    ownerUserId: string;
    label: string;
    expiresAt: string;
    privacyMode: PeerTransportPrivacyMode;
    transportKinds: string[];
  }): Promise<PeerInvitationMaterial>;
  cancelInvitation?(input: {
    commandId: string;
    approvalDeadline: string;
    approval: PeerCommandApprovalBinding;
    ownerUserId: string;
    invitationId: string;
  }): Promise<void>;
  acceptInvitation(input: {
    commandId: string;
    approvalDeadline: string;
    approval: PeerCommandApprovalBinding;
    ownerUserId: string;
    invitation: PeerPairingInvite;
    localDeviceId: string;
    privacyMode: PeerTransportPrivacyMode;
    scannedAt: string;
  }): Promise<PeerPairingAcceptance>;
  acceptPendingRequest?(input: {
    commandId: string;
    approvalDeadline: string;
    approval: PeerCommandApprovalBinding;
    ownerUserId: string;
    request: PeerPendingRequest;
  }): Promise<void>;
  confirmPairing(input: {
    commandId: string;
    approvalDeadline: string;
    approval: PeerCommandApprovalBinding;
    ownerUserId: string;
    pairingId: string;
    requestPayload: Record<string, unknown>;
    transcriptHash: string;
    verificationPhrase: string;
  }): Promise<PeerPairingConfirmation>;
  signGrant(input: {
    commandId: string;
    approvalDeadline: string;
    approval: PeerCommandApprovalBinding;
    ownerUserId: string;
    relationshipId: string;
    grant: PeerShareGrantVersion;
  }): Promise<PeerShareGrantVersion>;
  revokeGrant?(input: {
    commandId: string;
    approvalDeadline: string;
    approval: PeerCommandApprovalBinding;
    ownerUserId: string;
    grant: PeerShareGrantVersion;
    reason: string;
  }): Promise<PeerShareGrantVersion>;
  acceptGrant(input: {
    commandId: string;
    approvalDeadline: string;
    approval: PeerCommandApprovalBinding;
    ownerUserId: string;
    grant: PeerShareGrantVersion;
  }): Promise<PeerShareGrantVersion>;
  updateDevice(input: {
    commandId: string;
    approvalDeadline: string;
    approval: PeerCommandApprovalBinding;
    ownerUserId: string;
    relationshipId: string;
    deviceId: string;
    action: "approve" | "remove";
  }): Promise<void>;
  revokeRelationship(input: {
    commandId: string;
    approvalDeadline: string;
    approval: PeerCommandApprovalBinding;
    ownerUserId: string;
    relationshipId: string;
    reason: string;
  }): Promise<void>;
  requestResync(input: {
    commandId: string;
    approvalDeadline: string;
    approval: PeerCommandApprovalBinding;
    ownerUserId: string;
    relationshipId: string;
    projectionIds: string[];
  }): Promise<{ envelopeIds: string[] }>;
  claimInboundQuery?(input: {
    commandId: string;
    approvalDeadline: string;
    authorizationIssuedAt: string;
    ownerUserId: string;
    workerId: string;
    leaseMs: number;
  }): Promise<PeerInboundQueryClaimResult>;
  respondInboundQuery?(input: {
    commandId: string;
    approvalDeadline: string;
    authorizationIssuedAt: string;
    ownerUserId: string;
    workerId: string;
    claimId: string;
    queryId: string;
    payload: PeerQueryPayload;
    asOf: string;
    completeness: "complete" | "partial" | "unknown";
    redactedFields: string[];
  }): Promise<PeerInboundQueryResponseResult>;
  listRevocationEvents?(input: {
    ownerUserId: string;
    consumerId: string;
    afterCursor: string;
    limit: number;
  }): Promise<PeerRevocationEventPage>;
  ackRevocationEvents?(input: {
    commandId: string;
    approvalDeadline: string;
    authorizationIssuedAt: string;
    ownerUserId: string;
    consumerId: string;
    throughCursor: string;
    eventHash: string;
  }): Promise<PeerRevocationAckResult>;
  executeQuery(input: {
    ownerUserId: string;
    relationshipId: string;
    personId: string;
    query: Record<string, unknown>;
    timeoutMs: number;
  }): Promise<PeerQueryGatewayResult>;
}

export class UnavailablePeerCoreGateway implements PeerCoreGateway {
  constructor(
    private readonly reason = "The forge-peer daemon is not configured.",
    private readonly enabled = false
  ) {}

  async health(): Promise<PeerCoreHealth> {
    return {
      enabled: this.enabled,
      healthy: false,
      protocolVersion: null,
      reason: this.reason
    };
  }

  private unavailable(): never {
    throw new Error("The forge-peer daemon is unavailable.");
  }

  async localIdentity(): Promise<PeerLocalIdentity> {
    return this.unavailable();
  }

  async transportReadiness(): Promise<PeerTransportReadiness> {
    return this.unavailable();
  }

  async commandReceipt(): Promise<PeerDaemonCommandReceipt> {
    return this.unavailable();
  }

  async syncCommandAuthorizationState(): Promise<PeerCommandAuthoritySync> {
    return this.unavailable();
  }

  async createInvitation(): Promise<PeerInvitationMaterial> {
    return this.unavailable();
  }

  async acceptInvitation(): Promise<PeerPairingAcceptance> {
    return this.unavailable();
  }

  async confirmPairing(): Promise<PeerPairingConfirmation> {
    return this.unavailable();
  }

  async signGrant(): Promise<PeerShareGrantVersion> {
    return this.unavailable();
  }

  async acceptGrant(): Promise<PeerShareGrantVersion> {
    return this.unavailable();
  }

  async updateDevice(): Promise<void> {
    return this.unavailable();
  }

  async revokeRelationship(): Promise<void> {
    return this.unavailable();
  }

  async requestResync(): Promise<{ envelopeIds: string[] }> {
    return this.unavailable();
  }

  async claimInboundQuery(): Promise<PeerInboundQueryClaimResult> {
    return this.unavailable();
  }

  async respondInboundQuery(): Promise<PeerInboundQueryResponseResult> {
    return this.unavailable();
  }

  async listRevocationEvents(): Promise<PeerRevocationEventPage> {
    return this.unavailable();
  }

  async ackRevocationEvents(): Promise<PeerRevocationAckResult> {
    return this.unavailable();
  }

  async executeQuery(
    _input: Parameters<PeerCoreGateway["executeQuery"]>[0]
  ): Promise<PeerQueryGatewayResult> {
    return this.unavailable();
  }
}
