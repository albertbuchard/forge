import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { createConnection, isIP, type Socket } from "node:net";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { peerTypedQuestionSchema } from "./peer-typed-query.js";
import {
  derivePeerQueryWorkerCapabilityId,
  derivePeerQueryWorkerSessionId,
  derivePeerRevocationConsumerCapabilityId,
  derivePeerRevocationConsumerSessionId,
  peerCommandActionDigest,
  peerCommandApprovalBindingSchema,
  peerCommandAuthorityStateHash,
  peerCommandAuthorizationSchema,
  peerCommandRequestHash,
  type PeerCommandAuthorizer
} from "./peer-command-authorization.js";
import {
  recordPeerCommandDaemonDispatch,
  verifyPeerCommandDaemonReceipt
} from "../repositories/peer-command-journal.js";
import { hashPeerApiValue } from "../repositories/peer-sharing.js";
import {
  PEER_PROTOCOL_VERSION,
  peerPairingInviteSchema,
  peerShareGrantVersionSchema,
  peerTransportKindSchema,
  peerTransportPrivacyModeSchema
} from "../peer-sharing-types.js";
import type {
  PeerCoreGateway,
  PeerCoreHealth,
  PeerDaemonEvidence,
  PeerDaemonCommandReceipt,
  PeerInboundQueryClaimResult,
  PeerInboundQueryResponseResult,
  PeerInvitationMaterial,
  PeerLocalIdentity,
  PeerPairingAcceptance,
  PeerPairingConfirmation,
  PeerQueryGatewayResult,
  PeerRevocationAckResult,
  PeerRevocationEventPage,
  PeerTransportReadiness
} from "./peer-core-gateway.js";

const IPC_MAGIC = Buffer.from("FGP1", "ascii");
const IPC_FRAME_TYPE = 2;
const IPC_HEADER_BYTES = 10;
const MAX_IPC_BODY_BYTES = 64 * 1024;
const MAX_UNIX_SOCKET_PATH_BYTES = 103;
const DEFAULT_TIMEOUT_MS = 12_000;
const DAEMON_STATEMENT_HASH_DOMAIN = Buffer.from(
  "forge-peer/daemon-statement/v1\0",
  "utf8"
);
const DAEMON_EVIDENCE_SIGNATURE_DOMAIN = Buffer.from(
  "forge-peer/daemon-evidence-signature/v1\0",
  "utf8"
);

const boundedIdSchema = z.string().trim().min(1).max(240);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const approvalDeadlineSchema = z.string().datetime({ offset: true });
const base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);
const requestIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

function canonicalEvidenceValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PeerCoreIpcError(
        "protocol",
        "Daemon evidence contains a non-finite number."
      );
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalEvidenceValue);
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new PeerCoreIpcError(
        "protocol",
        "Daemon evidence contains a non-plain object."
      );
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => {
          if (nested === undefined) {
            throw new PeerCoreIpcError(
              "protocol",
              "Daemon evidence contains undefined."
            );
          }
          return [key, canonicalEvidenceValue(nested)];
        })
    );
  }
  throw new PeerCoreIpcError(
    "protocol",
    "Daemon evidence contains a non-JSON value."
  );
}

function canonicalEvidenceBytes(value: unknown) {
  return Buffer.from(JSON.stringify(canonicalEvidenceValue(value)), "utf8");
}

function daemonStatementHash(input: {
  statementType: PeerDaemonEvidence["statementType"];
  statement: unknown;
}) {
  return createHash("sha256")
    .update(DAEMON_STATEMENT_HASH_DOMAIN)
    .update(input.statementType, "utf8")
    .update("\0", "utf8")
    .update(canonicalEvidenceBytes(input.statement))
    .digest("hex");
}

const provenanceSchema = z
  .object({
    protocolVersion: z.literal(PEER_PROTOCOL_VERSION),
    ownerUserId: boundedIdSchema,
    relationshipId: boundedIdSchema.nullable(),
    localPrincipalId: boundedIdSchema,
    localDeviceId: boundedIdSchema,
    remotePrincipalId: boundedIdSchema.nullable(),
    remoteDeviceId: boundedIdSchema.nullable(),
    evidenceHash: hashSchema,
    authenticatedAt: z.string().datetime({ offset: true })
  })
  .strict();

type AuthenticatedProvenance = z.infer<typeof provenanceSchema>;

const daemonEvidenceSchema = z
  .object({
    protocol: z.literal("forge-peer-daemon-evidence/v1"),
    statementType: z.enum(["command_receipt", "revocation_event_page"]),
    statementHash: hashSchema,
    ownerUserId: boundedIdSchema,
    localPrincipalId: boundedIdSchema,
    localDeviceId: boundedIdSchema,
    signingCertificateHash: hashSchema,
    issuedAt: z.string().datetime({ offset: true }),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/)
  })
  .strict();

const rejectionSchema = z
  .object({
    type: z.literal("rejected"),
    requestId: requestIdSchema,
    code: z.enum([
      "invalid_request",
      "verification_failed",
      "authentication_failed",
      "authorization_failed",
      "conflict",
      "unavailable"
    ]),
    detail: z
      .string()
      .min(1)
      .max(256)
      .refine((value) => !value.includes("\0"))
  })
  .strict();

const responseDiscriminatorSchema = z
  .object({
    type: z.string().min(1).max(80),
    requestId: requestIdSchema
  })
  .passthrough();

const healthResponseSchema = z
  .object({
    type: z.literal("health"),
    requestId: requestIdSchema,
    enabled: z.boolean(),
    healthy: z.boolean(),
    protocolVersion: z.literal(PEER_PROTOCOL_VERSION),
    reason: z.string().max(256).nullable(),
    provenance: provenanceSchema
  })
  .strict();

const transportProviderKinds = [
  "local_direct",
  "iroh",
  "tor_onion",
  "http_mailbox"
] as const;
const transportReadinessResponseSchema = z
  .object({
    type: z.literal("transport_readiness"),
    requestId: requestIdSchema,
    transports: z
      .array(
        z
          .object({
            kind: z.enum(transportProviderKinds),
            state: z.enum(["ready", "degraded", "stopped"]),
            detailCode: z.string().regex(/^[a-z_]{1,64}$/),
            checkedAt: z.number().int().safe().positive()
          })
          .strict()
      )
      .max(transportProviderKinds.length)
      .refine(
        (items) =>
          new Set(items.map((item) => item.kind)).size === items.length,
        "Transport readiness providers must be unique."
      ),
    provenance: provenanceSchema
  })
  .strict();

const invitationCreatedResponseSchema = z
  .object({
    type: z.literal("invitation_created"),
    requestId: requestIdSchema,
    material: z
      .object({
        invitation: peerPairingInviteSchema,
        bootstrapCiphertext: base64UrlSchema.max(MAX_IPC_BODY_BYTES),
        bootstrapNonce: base64UrlSchema.max(128),
        bootstrapHash: hashSchema,
        provenance: provenanceSchema
      })
      .strict()
  })
  .strict();

const pairingRequestPayloadSchema = z
  .object({
    protocolVersion: z.literal(PEER_PROTOCOL_VERSION),
    invitationId: boundedIdSchema,
    transcriptHash: hashSchema,
    verificationPhrase: z.string().trim().min(1).max(240),
    verificationPhraseHash: hashSchema,
    localPrincipalId: boundedIdSchema,
    localDeviceId: boundedIdSchema,
    remotePrincipalId: boundedIdSchema,
    remoteDeviceId: boundedIdSchema,
    stateBinding: hashSchema
  })
  .strict();

const invitationAcceptedResponseSchema = z
  .object({
    type: z.literal("invitation_accepted"),
    requestId: requestIdSchema,
    acceptance: z
      .object({
        requestId: boundedIdSchema,
        requestPayload: pairingRequestPayloadSchema,
        expiresAt: z.string().datetime({ offset: true }),
        provenance: provenanceSchema
      })
      .strict()
  })
  .strict();

const principalIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const deviceIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
const publicKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .refine((value) => {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === 32 && decoded.toString("base64url") === value;
  }, "Peer public keys must be canonical 32-byte base64url values.");
const pairingPrincipalSchema = z
  .object({
    id: principalIdSchema,
    rootPublicKey: publicKeySchema,
    trustState: z.literal("verified"),
    certificateHash: hashSchema
  })
  .strict();
const pairingDeviceCapabilities = [
  "direct_stream",
  "iroh",
  "tor",
  "http_mailbox",
  "query",
  "projection",
  "key_package"
] as const;
const pairingCertificateSchema = base64UrlSchema
  .min(64)
  .max(32_768)
  .refine((value) => {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length > 0 && decoded.toString("base64url") === value;
  }, "Peer certificates must be canonical base64url values.");
const certificateSerialSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,19}$/)
  .refine(
    (value) => BigInt(value) <= 18_446_744_073_709_551_615n,
    "Peer certificate serial exceeds the unsigned 64-bit range."
  );
const portSchema = z.number().int().min(1).max(65_535);
const httpsOriginSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return (
        parsed.protocol === "https:" &&
        parsed.username === "" &&
        parsed.password === "" &&
        parsed.pathname === "/" &&
        parsed.search === "" &&
        parsed.hash === "" &&
        parsed.origin === value
      );
    } catch {
      return false;
    }
  }, "Peer service endpoints must be canonical HTTPS origins.");
const pairingTransportEndpointSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("local_direct"),
      host: z
        .string()
        .min(1)
        .max(64)
        .refine((value) => isIP(value) !== 0),
      port: portSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("iroh"),
      endpointId: publicKeySchema,
      relayOrigin: httpsOriginSchema.nullable()
    })
    .strict(),
  z
    .object({
      kind: z.literal("tor_onion"),
      onionHost: z.string().regex(/^[a-z2-7]{56}\.onion$/),
      port: portSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("http_mailbox"),
      origin: httpsOriginSchema,
      opaqueChannel: publicKeySchema
    })
    .strict()
]);
const pairingTransportEndpointsSchema = z
  .array(pairingTransportEndpointSchema)
  .max(8)
  .refine(
    (values) =>
      new Set(values.map((value) => JSON.stringify(value))).size ===
      values.length,
    "Peer transport endpoints must be unique."
  );
const pairingDeviceSchema = z
  .object({
    id: deviceIdSchema,
    principalId: principalIdSchema,
    signingPublicKey: publicKeySchema,
    keyAgreementPublicKey: publicKeySchema,
    certificateSerial: certificateSerialSchema,
    certificate: pairingCertificateSchema,
    certificateHash: hashSchema,
    capabilities: z
      .array(z.enum(pairingDeviceCapabilities))
      .max(pairingDeviceCapabilities.length)
      .refine(
        (values) => new Set(values).size === values.length,
        "Peer device capabilities must be unique."
      )
      .refine(
        (values) =>
          values.every(
            (value, index) =>
              index === 0 ||
              pairingDeviceCapabilities.indexOf(values[index - 1]!) <
                pairingDeviceCapabilities.indexOf(value)
          ),
        "Peer device capabilities must use canonical order."
      ),
    transportEndpoints: pairingTransportEndpointsSchema,
    status: z.literal("approved")
  })
  .strict();

const localIdentityResponseSchema = z
  .object({
    type: z.literal("local_identity"),
    requestId: requestIdSchema,
    identity: z
      .object({
        principal: pairingPrincipalSchema,
        device: pairingDeviceSchema,
        provenance: provenanceSchema
      })
      .strict()
  })
  .strict();

const peerDaemonCommandOperationSchema = z.enum([
  "create_invitation",
  "cancel_invitation",
  "accept_invitation",
  "accept_pending_request",
  "confirm_pairing",
  "sign_grant",
  "accept_grant",
  "revoke_grant",
  "update_device",
  "revoke_relationship",
  "request_resync",
  "claim_inbound_query",
  "respond_inbound_query",
  "ack_revocation_events"
]);

const commandAuthorizationProvenanceSchema = z
  .object({
    authorityKeyId: base64UrlSchema,
    authorizationId: boundedIdSchema.nullable(),
    actorClass: z
      .enum(["operator_session", "companion_consent", "service_worker"])
      .nullable(),
    actorId: boundedIdSchema.nullable(),
    actorDeviceId: boundedIdSchema.nullable(),
    sessionId: boundedIdSchema.nullable(),
    capabilityId: boundedIdSchema.nullable(),
    actionDigest: hashSchema.nullable(),
    invalidationEpoch: z.string().regex(/^(0|[1-9][0-9]*)$/),
    authorityStateHash: hashSchema,
    verifiedAt: z.string().datetime({ offset: true })
  })
  .strict();

const commandReceiptResponseSchema = z
  .object({
    type: z.literal("command_receipt"),
    requestId: requestIdSchema,
    receipt: z
      .object({
        commandId: boundedIdSchema.min(16),
        operation: peerDaemonCommandOperationSchema,
        requestHash: hashSchema,
        approvalDeadline: approvalDeadlineSchema.nullable(),
        committedAt: z.string().datetime({ offset: true }).nullable(),
        authorization: commandAuthorizationProvenanceSchema.nullable(),
        result: z.unknown(),
        evidence: daemonEvidenceSchema
      })
      .strict()
  })
  .strict()
  .superRefine((value, context) => {
    if (!Object.prototype.hasOwnProperty.call(value.receipt, "result")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The command receipt must include its exact result.",
        path: ["receipt", "result"]
      });
    }
  });

const commandAuthorizationStateResponseSchema = z
  .object({
    type: z.literal("command_authorization_state_synchronized"),
    requestId: requestIdSchema,
    state: z
      .object({
        commandId: boundedIdSchema,
        authorityKeyId: base64UrlSchema,
        invalidationEpoch: z.string().regex(/^(0|[1-9][0-9]*)$/),
        stateHash: hashSchema,
        committedAt: z.string().datetime({ offset: true }),
        authorization: commandAuthorizationProvenanceSchema,
        provenance: provenanceSchema
      })
      .strict()
  })
  .strict();

const pairingConfirmedResponseSchema = z
  .object({
    type: z.literal("pairing_confirmed"),
    requestId: requestIdSchema,
    confirmation: z
      .object({
        relationship: z
          .object({
            id: boundedIdSchema,
            localPrincipal: pairingPrincipalSchema,
            remotePrincipal: pairingPrincipalSchema,
            localDevice: pairingDeviceSchema,
            remoteDevice: pairingDeviceSchema,
            negotiatedProtocolVersion: z.literal(PEER_PROTOCOL_VERSION),
            verificationPhraseHash: hashSchema,
            privacyMode: peerTransportPrivacyModeSchema
          })
          .strict(),
        outboundEnvelope: base64UrlSchema.max(MAX_IPC_BODY_BYTES).nullable(),
        provenance: provenanceSchema
      })
      .strict()
  })
  .strict();

const invitationCanceledResponseSchema = z
  .object({
    type: z.literal("invitation_canceled"),
    requestId: requestIdSchema,
    result: z
      .object({
        invitationId: boundedIdSchema,
        provenance: provenanceSchema
      })
      .strict()
  })
  .strict();

const pendingRequestSchema = z
  .object({
    id: boundedIdSchema,
    ownerUserId: boundedIdSchema,
    relationshipId: boundedIdSchema.nullable(),
    kind: z.enum(["pairing", "device", "grant"]),
    status: z.enum(["pending", "accepted", "rejected", "expired"]),
    version: z.number().int().positive().max(0xffff_ffff),
    payload: z.record(z.unknown()),
    payloadHash: hashSchema,
    expiresAt: z.string().datetime({ offset: true }),
    decidedAt: z.string().datetime({ offset: true }).nullable(),
    decisionReason: z.string().max(1_024),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true })
  })
  .strict();

const pendingRequestAcceptedResponseSchema = z
  .object({
    type: z.literal("pending_request_accepted"),
    requestId: requestIdSchema,
    result: z
      .object({
        requestId: boundedIdSchema,
        kind: z.enum(["pairing", "device", "grant"]),
        provenance: provenanceSchema
      })
      .strict()
  })
  .strict();

function grantOperationResponseSchema(
  type: "grant_signed" | "grant_accepted" | "grant_revoked"
) {
  return z
    .object({
      type: z.literal(type),
      requestId: requestIdSchema,
      result: z
        .object({
          grant: peerShareGrantVersionSchema,
          provenance: provenanceSchema
        })
        .strict()
    })
    .strict();
}

function mutationResponseSchema(
  type: "device_updated" | "relationship_revoked"
) {
  return z
    .object({
      type: z.literal(type),
      requestId: requestIdSchema,
      result: z.object({ provenance: provenanceSchema }).strict()
    })
    .strict();
}

const resyncResponseSchema = z
  .object({
    type: z.literal("resync_requested"),
    requestId: requestIdSchema,
    result: z
      .object({
        envelopeIds: z.array(boundedIdSchema).max(1_000),
        provenance: provenanceSchema
      })
      .strict()
  })
  .strict();

const canonicalU64Schema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine(
    (value) => BigInt(value) <= 18_446_744_073_709_551_615n,
    "Peer sequence exceeds the unsigned 64-bit range."
  );
const queryPayloadSchema = z
  .object({
    records: z
      .array(
        z
          .object({
            recordId: boundedIdSchema,
            fields: z.record(z.unknown())
          })
          .strict()
      )
      .max(1_000)
  })
  .strict();
const inboundQueryClaimSchema = z
  .object({
    claimId: z.string().regex(/^[a-f0-9]{32}$/),
    queryId: z.string().regex(/^[a-f0-9]{32}$/),
    relationshipId: boundedIdSchema,
    requester: z
      .object({
        principalId: boundedIdSchema,
        deviceId: boundedIdSchema,
        relationshipId: boundedIdSchema
      })
      .strict(),
    query: peerTypedQuestionSchema,
    entityIdsAreOpaque: z.boolean(),
    intervalTimeZoneAuthenticated: z.boolean(),
    grantId: boundedIdSchema,
    grantSequence: canonicalU64Schema,
    grantVerificationId: boundedIdSchema,
    verifiedGrantHash: hashSchema,
    ruleId: boundedIdSchema,
    maximumPayloadBytes: z.number().int().min(256).max(10_485_760),
    redactedFields: z
      .array(z.string().trim().min(1).max(120))
      .max(256)
      .refine(
        (values) => new Set(values).size === values.length,
        "Peer redacted fields must be unique."
      ),
    receivedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    leaseExpiresAt: z.string().datetime({ offset: true })
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.requester.relationshipId !== value.relationshipId ||
      Date.parse(value.receivedAt) > Date.parse(value.expiresAt) ||
      Date.parse(value.leaseExpiresAt) > Date.parse(value.expiresAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inbound query claim bindings are inconsistent."
      });
    }
    if (
      value.redactedFields.some((field) =>
        value.query.fields.includes(field as never)
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inbound query effective and redacted fields overlap.",
        path: ["redactedFields"]
      });
    }
    const hasEntityIds =
      "entityIds" in value.query && value.query.entityIds.length > 0;
    if (value.entityIdsAreOpaque && !hasEntityIds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inbound query marked absent entity identifiers as opaque.",
        path: ["entityIdsAreOpaque"]
      });
    }
    const expectedAuthenticatedTimeZone =
      value.query.projectionId === "calendar.availability.v1";
    if (value.intervalTimeZoneAuthenticated !== expectedAuthenticatedTimeZone) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Inbound query interval time-zone authentication is inconsistent.",
        path: ["intervalTimeZoneAuthenticated"]
      });
    }
  });
const inboundQueryClaimResultSchema = z
  .object({
    claim: inboundQueryClaimSchema.nullable(),
    provenance: provenanceSchema
  })
  .strict();
const inboundQueryClaimedResponseSchema = z
  .object({
    type: z.literal("inbound_query_claimed"),
    requestId: requestIdSchema,
    result: inboundQueryClaimResultSchema
  })
  .strict();
const inboundQueryResponseResultSchema = z
  .object({
    queryId: z.string().regex(/^[a-f0-9]{32}$/),
    envelopeId: boundedIdSchema,
    provenance: provenanceSchema
  })
  .strict();
const inboundQueryRespondedResponseSchema = z
  .object({
    type: z.literal("inbound_query_responded"),
    requestId: requestIdSchema,
    result: inboundQueryResponseResultSchema
  })
  .strict();

const positiveCanonicalU64Schema = canonicalU64Schema.refine(
  (value) => value !== "0",
  "Peer cursor must be positive."
);
const canonicalCertificateSchema = base64UrlSchema.min(64).max(32_768);
const revocationEventSchema = z
  .object({
    cursor: positiveCanonicalU64Schema,
    eventHash: hashSchema,
    previousEventHash: hashSchema,
    kind: z.enum(["grant", "device", "relationship", "credential_retirement"]),
    source: z.enum([
      "local_operator",
      "authenticated_peer",
      "certified_rotation"
    ]),
    relationshipId: z.string().regex(/^[a-f0-9]{32}$/),
    grantId: boundedIdSchema.nullable(),
    deviceId: boundedIdSchema.nullable(),
    targetCertificate: canonicalCertificateSchema.nullable(),
    targetCertificateHash: hashSchema.nullable(),
    targetCertificateSerial: positiveCanonicalU64Schema.nullable(),
    reason: z.string().trim().min(1).max(1_024),
    occurredAt: z.string().datetime({ offset: true }),
    authenticatedRemotePrincipalId: boundedIdSchema.nullable(),
    authenticatedRemoteDeviceId: boundedIdSchema.nullable(),
    signingDeviceId: boundedIdSchema,
    signingCertificate: canonicalCertificateSchema,
    signingCertificateHash: hashSchema,
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/)
  })
  .strict()
  .superRefine((value, context) => {
    const hasRemote =
      value.authenticatedRemotePrincipalId !== null &&
      value.authenticatedRemoteDeviceId !== null;
    const hasNoRemote =
      value.authenticatedRemotePrincipalId === null &&
      value.authenticatedRemoteDeviceId === null;
    if (
      (value.source === "authenticated_peer" && !hasRemote) ||
      (value.source !== "authenticated_peer" && !hasNoRemote)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Revocation event source authentication is inconsistent."
      });
    }
    const hasTargetCertificate =
      value.targetCertificate !== null &&
      value.targetCertificateHash !== null &&
      value.targetCertificateSerial !== null;
    const hasNoTargetCertificate =
      value.targetCertificate === null &&
      value.targetCertificateHash === null &&
      value.targetCertificateSerial === null;
    const targetIsValid =
      (value.kind === "grant" &&
        value.grantId !== null &&
        value.deviceId === null &&
        hasNoTargetCertificate) ||
      ((value.kind === "device" || value.kind === "credential_retirement") &&
        value.grantId === null &&
        value.deviceId !== null &&
        hasTargetCertificate) ||
      (value.kind === "relationship" &&
        value.grantId === null &&
        value.deviceId === null &&
        hasNoTargetCertificate);
    if (!targetIsValid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Revocation event target binding is inconsistent."
      });
    }
  });
const revocationEventPageSchema = z
  .object({
    events: z.array(revocationEventSchema).max(128),
    acknowledgedCursor: canonicalU64Schema,
    nextCursor: canonicalU64Schema,
    hasMore: z.boolean(),
    provenance: provenanceSchema,
    evidence: daemonEvidenceSchema
  })
  .strict()
  .superRefine((value, context) => {
    for (let index = 0; index < value.events.length; index += 1) {
      const event = value.events[index]!;
      if (index > 0) {
        const previous = value.events[index - 1]!;
        if (
          BigInt(event.cursor) !== BigInt(previous.cursor) + 1n ||
          event.previousEventHash !== previous.eventHash
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Revocation event page does not carry a contiguous hash chain.",
            path: ["events", index]
          });
        }
      }
      if (event.cursor === "1" && event.previousEventHash !== "0".repeat(64)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "The first revocation event has an invalid chain root.",
          path: ["events", index, "previousEventHash"]
        });
      }
    }
  });
const revocationEventsListedResponseSchema = z
  .object({
    type: z.literal("revocation_events_listed"),
    requestId: requestIdSchema,
    page: revocationEventPageSchema
  })
  .strict();
const revocationAckResultSchema = z
  .object({
    consumerId: boundedIdSchema,
    acknowledgedCursor: positiveCanonicalU64Schema,
    eventHash: hashSchema,
    acknowledgedAt: z.string().datetime({ offset: true }),
    provenance: provenanceSchema
  })
  .strict();
const revocationEventsAcknowledgedResponseSchema = z
  .object({
    type: z.literal("revocation_events_acknowledged"),
    requestId: requestIdSchema,
    result: revocationAckResultSchema
  })
  .strict();

const queryMetadataSchema = z
  .object({
    source: z
      .object({
        principalId: boundedIdSchema,
        deviceId: boundedIdSchema,
        relationshipId: boundedIdSchema
      })
      .strict(),
    projectionId: z.enum([
      "calendar.availability.v1",
      "calendar.selected_events.v1",
      "goals.horizon_summary.v1",
      "health.cycling.aggregate.v1",
      "person.profile.v1",
      "life_events.selected.v1",
      "movement.aggregate.v1",
      "custom.selected_entities.v1"
    ]),
    projectionVersion: z.literal(1),
    grantId: boundedIdSchema,
    grantSequence: z.number().int().positive(),
    grantVerificationId: boundedIdSchema,
    verifiedGrantHash: hashSchema,
    asOf: z.string().datetime({ offset: true }),
    receivedAt: z.string().datetime({ offset: true }),
    validUntil: z.string().datetime({ offset: true }).nullable(),
    completeness: z.number().min(0).max(1),
    precision: z.string().trim().min(1).max(80),
    redactedFields: z.array(z.string().trim().min(1).max(120)).max(256),
    state: z.enum(["live", "unavailable"])
  })
  .strict();

const queryExecutedResponseSchema = z
  .object({
    type: z.literal("query_executed"),
    requestId: requestIdSchema,
    result: z
      .object({
        state: z.enum(["live", "unavailable"]),
        payload: z
          .object({
            records: z
              .array(
                z
                  .object({
                    recordId: boundedIdSchema,
                    fields: z.record(z.unknown())
                  })
                  .strict()
              )
              .max(64)
          })
          .strict(),
        metadata: queryMetadataSchema,
        provenance: provenanceSchema
      })
      .strict()
  })
  .strict();

export type PeerCoreIpcErrorCode =
  | "configuration"
  | "socket_security"
  | "timeout"
  | "protocol"
  | "transport"
  | z.infer<typeof rejectionSchema>["code"];

export class PeerCoreIpcError extends Error {
  constructor(
    readonly code: PeerCoreIpcErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "PeerCoreIpcError";
  }
}

type SocketIdentity = {
  dev: number;
  ino: number;
  uid: number;
};

type GatewayOptions = {
  socketPath: string;
  ownerUserId: string;
  timeoutMs?: number;
  commandAuthorizer?: PeerCommandAuthorizer;
  commandJournal?: PeerCommandJournalBridge | null;
};

type PeerCommandJournalBridge = {
  recordDispatch: typeof recordPeerCommandDaemonDispatch;
  verifyReceipt: typeof verifyPeerCommandDaemonReceipt;
};

const defaultCommandJournalBridge: PeerCommandJournalBridge = {
  recordDispatch: recordPeerCommandDaemonDispatch,
  verifyReceipt: verifyPeerCommandDaemonReceipt
};

const mutationActionByType = {
  create_invitation: "create_invitation",
  cancel_invitation: "cancel_invitation",
  accept_invitation: "accept_invitation",
  accept_pending_request: "accept_pending_request",
  confirm_pairing: "confirm_pairing",
  sign_grant: "sign_grant",
  accept_grant: "accept_grant",
  revoke_grant: "revoke_grant",
  update_device: "update_device",
  revoke_relationship: "revoke_relationship",
  request_resync: "request_resync"
} as const;

const queryWorkerActionByType = {
  claim_inbound_query: "claim_inbound_query",
  respond_inbound_query: "respond_inbound_query"
} as const;

const revocationConsumerActionByType = {
  ack_revocation_events: "ack_revocation_events"
} as const;

const queryWorkerAuthorizationContextSchema = z
  .object({
    workerId: boundedIdSchema,
    issuedAt: z.string().datetime({ offset: true })
  })
  .strict();

const revocationConsumerAuthorizationContextSchema = z
  .object({
    consumerId: boundedIdSchema,
    issuedAt: z.string().datetime({ offset: true })
  })
  .strict();

function requestId() {
  return `req_${randomUUID().replaceAll("-", "")}`;
}

function encodeFrame(value: unknown) {
  let body: Buffer;
  try {
    body = Buffer.from(JSON.stringify(value), "utf8");
  } catch (error) {
    throw new PeerCoreIpcError(
      "protocol",
      "The forge-peer request could not be encoded.",
      { cause: error }
    );
  }
  if (body.length > MAX_IPC_BODY_BYTES) {
    throw new PeerCoreIpcError(
      "protocol",
      "The forge-peer request exceeds the local IPC limit."
    );
  }
  const header = Buffer.alloc(IPC_HEADER_BYTES);
  IPC_MAGIC.copy(header, 0);
  header[4] = IPC_FRAME_TYPE;
  header[5] = 0;
  header.writeUInt32BE(body.length, 6);
  return Buffer.concat([header, body]);
}

function decodeFrame(frame: Buffer): unknown {
  if (
    frame.length < IPC_HEADER_BYTES ||
    !frame.subarray(0, 4).equals(IPC_MAGIC)
  ) {
    throw new PeerCoreIpcError(
      "protocol",
      "The forge-peer response has an invalid frame header."
    );
  }
  if (frame[4] !== IPC_FRAME_TYPE || frame[5] !== 0) {
    throw new PeerCoreIpcError(
      "protocol",
      "The forge-peer response has an unsupported frame type or flags."
    );
  }
  const bodyLength = frame.readUInt32BE(6);
  if (
    bodyLength > MAX_IPC_BODY_BYTES ||
    frame.length !== IPC_HEADER_BYTES + bodyLength
  ) {
    throw new PeerCoreIpcError(
      "protocol",
      "The forge-peer response frame length is invalid."
    );
  }
  try {
    return JSON.parse(
      frame.subarray(IPC_HEADER_BYTES).toString("utf8")
    ) as unknown;
  } catch (error) {
    throw new PeerCoreIpcError(
      "protocol",
      "The forge-peer response is not valid JSON.",
      { cause: error }
    );
  }
}

function decodeCanonicalBase64Url(value: string, label: string) {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value) {
    throw new PeerCoreIpcError(
      "protocol",
      `The forge-peer ${label} is not canonical base64url.`
    );
  }
  return new Uint8Array(decoded);
}

function assertSafePayload(value: unknown) {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > 10_000 || current.depth > 16) {
      throw new PeerCoreIpcError(
        "protocol",
        "The forge-peer query payload exceeds structural limits."
      );
    }
    if (current.value === null || typeof current.value !== "object") continue;
    if (Array.isArray(current.value)) {
      if (current.value.length > 1_000) {
        throw new PeerCoreIpcError(
          "protocol",
          "The forge-peer query payload contains an oversized list."
        );
      }
      for (const child of current.value) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }
    const prototype = Object.getPrototypeOf(current.value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new PeerCoreIpcError(
        "protocol",
        "The forge-peer query payload contains a non-plain object."
      );
    }
    const entries = Object.entries(current.value as Record<string, unknown>);
    if (entries.length > 256) {
      throw new PeerCoreIpcError(
        "protocol",
        "The forge-peer query payload contains an oversized object."
      );
    }
    for (const [key, child] of entries) {
      if (
        key.length === 0 ||
        key.length > 240 ||
        key === "__proto__" ||
        key === "prototype" ||
        key === "constructor"
      ) {
        throw new PeerCoreIpcError(
          "protocol",
          "The forge-peer query payload contains an unsafe field name."
        );
      }
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function assertProvenance(input: {
  provenance: AuthenticatedProvenance;
  ownerUserId: string;
  relationshipId: string | null;
}) {
  if (
    input.provenance.ownerUserId !== input.ownerUserId ||
    input.provenance.relationshipId !== input.relationshipId
  ) {
    throw new PeerCoreIpcError(
      "authentication_failed",
      "The forge-peer response provenance does not match the request."
    );
  }
}

function normalizeSocketPath(socketPath: string) {
  if (
    socketPath.trim() !== socketPath ||
    socketPath.includes("\0") ||
    !path.isAbsolute(socketPath) ||
    path.normalize(socketPath) !== socketPath ||
    path.basename(socketPath) === "." ||
    path.basename(socketPath) === path.sep ||
    Buffer.byteLength(socketPath) > MAX_UNIX_SOCKET_PATH_BYTES
  ) {
    throw new PeerCoreIpcError(
      "configuration",
      "The forge-peer socket path must be a normalized absolute path."
    );
  }
  return socketPath;
}

async function inspectOwnerSocket(socketPath: string): Promise<SocketIdentity> {
  if (typeof process.getuid !== "function") {
    throw new PeerCoreIpcError(
      "configuration",
      "forge-peer local IPC requires a Unix owner identity."
    );
  }
  const expectedUid = process.getuid();
  const parentPath = path.dirname(socketPath);
  try {
    const [resolvedParent, parent, socket] = await Promise.all([
      realpath(parentPath),
      lstat(parentPath),
      lstat(socketPath)
    ]);
    if (
      resolvedParent !== parentPath ||
      parent.isSymbolicLink() ||
      !parent.isDirectory() ||
      parent.uid !== expectedUid ||
      (parent.mode & 0o700) !== 0o700 ||
      (parent.mode & 0o077) !== 0
    ) {
      throw new PeerCoreIpcError(
        "socket_security",
        "The forge-peer socket directory is not private to the current owner."
      );
    }
    if (
      socket.isSymbolicLink() ||
      !socket.isSocket() ||
      socket.uid !== expectedUid ||
      (socket.mode & 0o177) !== 0
    ) {
      throw new PeerCoreIpcError(
        "socket_security",
        "The forge-peer IPC endpoint is not an owner-only Unix socket."
      );
    }
    return { dev: socket.dev, ino: socket.ino, uid: socket.uid };
  } catch (error) {
    if (error instanceof PeerCoreIpcError) throw error;
    throw new PeerCoreIpcError(
      "transport",
      "The forge-peer IPC endpoint is unavailable.",
      { cause: error }
    );
  }
}

function sameSocketIdentity(left: SocketIdentity, right: SocketIdentity) {
  return (
    left.dev === right.dev && left.ino === right.ino && left.uid === right.uid
  );
}

async function exchangeFrame(input: {
  socketPath: string;
  frame: Buffer;
  timeoutMs: number;
}) {
  const before = await inspectOwnerSocket(input.socketPath);
  return await new Promise<Buffer>((resolve, reject) => {
    let socket: Socket | null = null;
    let settled = false;
    let received = Buffer.alloc(0);
    let expectedLength: number | null = null;

    const finish = (error: unknown, response?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket) {
        socket.removeAllListeners();
        socket.destroy();
      }
      if (error) reject(error);
      else resolve(response!);
    };

    const timer = setTimeout(() => {
      finish(
        new PeerCoreIpcError(
          "timeout",
          "The forge-peer IPC operation timed out."
        )
      );
    }, input.timeoutMs);
    timer.unref();

    try {
      socket = createConnection({ path: input.socketPath });
    } catch (error) {
      finish(
        new PeerCoreIpcError(
          "transport",
          "The forge-peer IPC connection could not be created.",
          { cause: error }
        )
      );
      return;
    }

    socket.once("connect", () => {
      void inspectOwnerSocket(input.socketPath)
        .then((after) => {
          if (!sameSocketIdentity(before, after)) {
            throw new PeerCoreIpcError(
              "socket_security",
              "The forge-peer IPC endpoint changed during connection."
            );
          }
          socket!.end(input.frame);
        })
        .catch((error) => finish(error));
    });
    socket.on("data", (chunk: Buffer) => {
      if (settled) return;
      received = Buffer.concat([received, chunk]);
      if (received.length > IPC_HEADER_BYTES + MAX_IPC_BODY_BYTES) {
        finish(
          new PeerCoreIpcError(
            "protocol",
            "The forge-peer response exceeds the local IPC limit."
          )
        );
        return;
      }
      if (expectedLength === null && received.length >= IPC_HEADER_BYTES) {
        if (
          !received.subarray(0, 4).equals(IPC_MAGIC) ||
          received[4] !== IPC_FRAME_TYPE ||
          received[5] !== 0
        ) {
          finish(
            new PeerCoreIpcError(
              "protocol",
              "The forge-peer response has an invalid frame header."
            )
          );
          return;
        }
        const bodyLength = received.readUInt32BE(6);
        if (bodyLength > MAX_IPC_BODY_BYTES) {
          finish(
            new PeerCoreIpcError(
              "protocol",
              "The forge-peer response exceeds the local IPC limit."
            )
          );
          return;
        }
        expectedLength = IPC_HEADER_BYTES + bodyLength;
      }
      if (expectedLength !== null && received.length > expectedLength) {
        finish(
          new PeerCoreIpcError(
            "protocol",
            "The forge-peer response contains trailing frame data."
          )
        );
      }
    });
    socket.once("end", () => {
      if (expectedLength === null || received.length !== expectedLength) {
        finish(
          new PeerCoreIpcError(
            "protocol",
            "The forge-peer response frame is truncated."
          )
        );
        return;
      }
      finish(null, received);
    });
    socket.once("error", (error) => {
      finish(
        new PeerCoreIpcError(
          "transport",
          "The forge-peer IPC connection failed.",
          { cause: error }
        )
      );
    });
    socket.once("close", () => {
      if (!settled) {
        finish(
          new PeerCoreIpcError(
            "transport",
            "The forge-peer IPC connection closed without a response."
          )
        );
      }
    });
  });
}

export class UnixSocketPeerCoreGateway implements PeerCoreGateway {
  private readonly socketPath: string;
  private readonly ownerUserId: string;
  private readonly timeoutMs: number;
  private readonly commandAuthorizer: PeerCommandAuthorizer | null;
  private readonly commandJournal: PeerCommandJournalBridge | null;
  private pinnedLocalIdentity: PeerLocalIdentity | null = null;
  private currentAuthorityStateHash: string | null = null;

  constructor(options: GatewayOptions) {
    this.socketPath = normalizeSocketPath(options.socketPath);
    this.ownerUserId = boundedIdSchema.parse(options.ownerUserId);
    this.commandAuthorizer = options.commandAuthorizer ?? null;
    this.commandJournal =
      options.commandJournal === undefined
        ? defaultCommandJournalBridge
        : options.commandJournal;
    this.timeoutMs = z
      .number()
      .int()
      .min(100)
      .max(30_000)
      .parse(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  private pinLocalIdentity(identity: PeerLocalIdentity) {
    const pinned = this.pinnedLocalIdentity;
    if (
      pinned &&
      (pinned.principal.id !== identity.principal.id ||
        pinned.principal.rootPublicKey !== identity.principal.rootPublicKey ||
        pinned.device.id !== identity.device.id ||
        pinned.device.principalId !== identity.device.principalId ||
        pinned.device.signingPublicKey !== identity.device.signingPublicKey ||
        pinned.device.certificate !== identity.device.certificate ||
        pinned.device.certificateHash !== identity.device.certificateHash ||
        pinned.device.certificateSerial !== identity.device.certificateSerial)
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The forge-peer daemon changed its pinned local device identity."
      );
    }
    this.pinnedLocalIdentity ??= identity;
    return this.pinnedLocalIdentity;
  }

  private async requirePinnedLocalIdentity() {
    return (
      this.pinnedLocalIdentity ??
      (await this.localIdentity({ ownerUserId: this.ownerUserId }))
    );
  }

  private async verifyDaemonEvidence(input: {
    evidence: PeerDaemonEvidence;
    statementType: PeerDaemonEvidence["statementType"];
    statement: unknown;
    notBefore?: string | null;
  }) {
    const identity = await this.requirePinnedLocalIdentity();
    const evidence = input.evidence;
    const expectedHash = daemonStatementHash({
      statementType: input.statementType,
      statement: input.statement
    });
    const issuedAt = Date.parse(evidence.issuedAt);
    const notBefore =
      input.notBefore === undefined || input.notBefore === null
        ? null
        : Date.parse(input.notBefore);
    const unsignedEvidence = { ...evidence } as Record<string, unknown>;
    delete unsignedEvidence.signature;
    let authentic = false;
    try {
      authentic = verify(
        null,
        Buffer.concat([
          DAEMON_EVIDENCE_SIGNATURE_DOMAIN,
          canonicalEvidenceBytes(unsignedEvidence)
        ]),
        createPublicKey({
          key: {
            kty: "OKP",
            crv: "Ed25519",
            x: identity.device.signingPublicKey
          },
          format: "jwk"
        }),
        Buffer.from(evidence.signature, "base64url")
      );
    } catch {
      authentic = false;
    }
    if (
      evidence.statementType !== input.statementType ||
      evidence.statementHash !== expectedHash ||
      evidence.ownerUserId !== this.ownerUserId ||
      evidence.localPrincipalId !== identity.principal.id ||
      evidence.localDeviceId !== identity.device.id ||
      evidence.signingCertificateHash !== identity.device.certificateHash ||
      !Number.isFinite(issuedAt) ||
      issuedAt > Date.now() + 5 * 60_000 ||
      (notBefore !== null &&
        (!Number.isFinite(notBefore) || issuedAt < notBefore)) ||
      !authentic
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The forge-peer daemon evidence is not authentic or statement-bound."
      );
    }
  }

  private async prepareOutboundRequest(
    request: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const type = request.type;
    const humanAction =
      typeof type === "string"
        ? mutationActionByType[type as keyof typeof mutationActionByType]
        : undefined;
    const queryWorkerAction =
      typeof type === "string"
        ? queryWorkerActionByType[type as keyof typeof queryWorkerActionByType]
        : undefined;
    const revocationConsumerAction =
      typeof type === "string"
        ? revocationConsumerActionByType[
            type as keyof typeof revocationConsumerActionByType
          ]
        : undefined;
    const rawApproval = request.authorizationContext;
    const rawQueryWorker = request.queryWorkerAuthorizationContext;
    const rawRevocationConsumer =
      request.revocationConsumerAuthorizationContext;
    if (!humanAction && !queryWorkerAction && !revocationConsumerAction) {
      if (
        rawApproval !== undefined ||
        rawQueryWorker !== undefined ||
        rawRevocationConsumer !== undefined
      ) {
        throw new PeerCoreIpcError(
          "protocol",
          "A non-mutating peer request cannot carry command authorization context."
        );
      }
      return request;
    }
    if (!this.commandAuthorizer) {
      throw new PeerCoreIpcError(
        "configuration",
        "The forge-peer command authority is not configured."
      );
    }
    const unsigned = { ...request };
    delete unsigned.authorizationContext;
    delete unsigned.queryWorkerAuthorizationContext;
    delete unsigned.revocationConsumerAuthorizationContext;
    const commandId = boundedIdSchema.min(16).parse(unsigned.commandId);
    const approvalDeadline = approvalDeadlineSchema.parse(
      unsigned.approvalDeadline
    );
    const commandDigest = peerCommandActionDigest(unsigned);
    let authorization;
    if (humanAction) {
      if (rawQueryWorker !== undefined || rawRevocationConsumer !== undefined) {
        throw new PeerCoreIpcError(
          "authorization_failed",
          "A human peer command cannot carry a service-worker capability."
        );
      }
      const approval = peerCommandApprovalBindingSchema.parse(rawApproval);
      authorization = await this.commandAuthorizer.authorize({
        ownerUserId: this.ownerUserId,
        action: humanAction,
        commandId,
        commandDigest,
        approvalDeadline,
        approval
      });
    } else if (queryWorkerAction) {
      if (
        rawApproval !== undefined ||
        rawRevocationConsumer !== undefined ||
        !this.commandAuthorizer.authorizeQueryWorker
      ) {
        throw new PeerCoreIpcError(
          "authorization_failed",
          "The query-worker command capability is unavailable or mismatched."
        );
      }
      const context =
        queryWorkerAuthorizationContextSchema.parse(rawQueryWorker);
      const workerInput = z
        .object({
          ownerUserId: boundedIdSchema,
          workerId: boundedIdSchema
        })
        .passthrough()
        .parse(unsigned.input);
      if (
        workerInput.ownerUserId !== this.ownerUserId ||
        workerInput.workerId !== context.workerId
      ) {
        throw new PeerCoreIpcError(
          "authorization_failed",
          "The query-worker actor does not match the exact IPC body."
        );
      }
      authorization = await this.commandAuthorizer.authorizeQueryWorker({
        ownerUserId: this.ownerUserId,
        workerId: context.workerId,
        action: queryWorkerAction,
        commandId,
        commandDigest,
        approvalDeadline,
        issuedAt: context.issuedAt
      });
    } else {
      if (
        rawApproval !== undefined ||
        rawQueryWorker !== undefined ||
        !revocationConsumerAction ||
        !this.commandAuthorizer.authorizeRevocationConsumer
      ) {
        throw new PeerCoreIpcError(
          "authorization_failed",
          "The revocation-consumer command capability is unavailable or mismatched."
        );
      }
      const context = revocationConsumerAuthorizationContextSchema.parse(
        rawRevocationConsumer
      );
      const consumerInput = z
        .object({
          ownerUserId: boundedIdSchema,
          consumerId: boundedIdSchema
        })
        .passthrough()
        .parse(unsigned.input);
      if (
        consumerInput.ownerUserId !== this.ownerUserId ||
        consumerInput.consumerId !== context.consumerId
      ) {
        throw new PeerCoreIpcError(
          "authorization_failed",
          "The revocation-consumer actor does not match the exact IPC body."
        );
      }
      authorization = await this.commandAuthorizer.authorizeRevocationConsumer({
        ownerUserId: this.ownerUserId,
        consumerId: context.consumerId,
        action: revocationConsumerAction,
        commandId,
        commandDigest,
        approvalDeadline,
        issuedAt: context.issuedAt
      });
    }
    const parsedAuthorization =
      peerCommandAuthorizationSchema.parse(authorization);
    const expectedAction =
      humanAction ?? queryWorkerAction ?? revocationConsumerAction!;
    if (
      parsedAuthorization.ownerUserId !== this.ownerUserId ||
      parsedAuthorization.action !== expectedAction ||
      parsedAuthorization.commandId !== commandId ||
      parsedAuthorization.approvalDeadline !== approvalDeadline ||
      parsedAuthorization.commandDigest !== commandDigest ||
      (humanAction !== undefined &&
        (parsedAuthorization.actor.class === "service_worker" ||
          parsedAuthorization.capability.kind !== "human_approval")) ||
      (queryWorkerAction !== undefined &&
        (parsedAuthorization.actor.class !== "service_worker" ||
          parsedAuthorization.capability.kind !== "query_worker")) ||
      (revocationConsumerAction !== undefined &&
        (parsedAuthorization.actor.class !== "service_worker" ||
          parsedAuthorization.capability.kind !== "revocation_consumer"))
    ) {
      throw new PeerCoreIpcError(
        "authorization_failed",
        "The Node command authorization is not bound to the exact IPC request."
      );
    }
    const outbound = { ...unsigned, authorization: parsedAuthorization };
    if (
      humanAction !== undefined &&
      parsedAuthorization.actor.class !== "service_worker" &&
      parsedAuthorization.capability.kind === "human_approval" &&
      this.commandJournal
    ) {
      try {
        const authorityState = await this.commandAuthorizer.initialize();
        const authorityStateHash =
          peerCommandAuthorityStateHash(authorityState);
        this.commandJournal.recordDispatch({
          ownerUserId: this.ownerUserId,
          commandId,
          operation: humanAction,
          requestHash: peerCommandRequestHash(outbound),
          authorization: {
            authorityKeyId: parsedAuthorization.authorityKeyId,
            authorizationId: parsedAuthorization.authorizationId,
            ownerUserId: parsedAuthorization.ownerUserId,
            actorClass: parsedAuthorization.actor.class,
            actorId: parsedAuthorization.actor.actorId,
            sessionId: parsedAuthorization.actor.sessionId,
            deviceId: parsedAuthorization.actor.deviceId,
            capabilityId: parsedAuthorization.capability.capabilityId,
            actionDigest: parsedAuthorization.capability.actionDigest,
            authorityStateHash,
            invalidationEpoch: parsedAuthorization.invalidationEpoch,
            approvalDeadline: parsedAuthorization.approvalDeadline,
            issuedAt: parsedAuthorization.issuedAt
          }
        });
        this.currentAuthorityStateHash = authorityStateHash;
      } catch (error) {
        throw new PeerCoreIpcError(
          "authorization_failed",
          "The peer command dispatch could not be bound to its durable journal.",
          { cause: error }
        );
      }
    }
    return outbound;
  }

  private assertOwner(ownerUserId: string) {
    if (ownerUserId !== this.ownerUserId) {
      throw new PeerCoreIpcError(
        "authorization_failed",
        "The Forge user does not own the configured peer daemon."
      );
    }
  }

  private async request<S extends z.ZodTypeAny>(input: {
    request: Record<string, unknown>;
    requestId: string;
    expectedType: string;
    schema: S;
    timeoutMs?: number;
    captureRequestHash?: (requestHash: string) => void;
  }): Promise<z.output<S>> {
    const outboundRequest = await this.prepareOutboundRequest(input.request);
    if (input.captureRequestHash) {
      input.captureRequestHash(peerCommandRequestHash(outboundRequest));
    }
    const frame = await exchangeFrame({
      socketPath: this.socketPath,
      frame: encodeFrame(outboundRequest),
      timeoutMs: input.timeoutMs ?? this.timeoutMs
    });
    const decoded = decodeFrame(frame);
    let discriminator: z.infer<typeof responseDiscriminatorSchema>;
    try {
      discriminator = responseDiscriminatorSchema.parse(decoded);
    } catch (error) {
      throw new PeerCoreIpcError(
        "protocol",
        "The forge-peer response envelope is invalid.",
        { cause: error }
      );
    }
    if (discriminator.requestId !== input.requestId) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The forge-peer response request id does not match."
      );
    }
    if (discriminator.type === "rejected") {
      let rejection: z.infer<typeof rejectionSchema>;
      try {
        rejection = rejectionSchema.parse(decoded);
      } catch (error) {
        throw new PeerCoreIpcError(
          "protocol",
          "The forge-peer rejection envelope is invalid.",
          { cause: error }
        );
      }
      throw new PeerCoreIpcError(
        rejection.code,
        `forge-peer rejected the ${input.expectedType} operation.`
      );
    }
    if (discriminator.type !== input.expectedType) {
      throw new PeerCoreIpcError(
        "protocol",
        "The forge-peer response type does not match the request."
      );
    }
    try {
      return input.schema.parse(decoded);
    } catch (error) {
      throw new PeerCoreIpcError(
        "protocol",
        "The forge-peer response body is invalid.",
        { cause: error }
      );
    }
  }

  async health(): Promise<PeerCoreHealth> {
    const id = requestId();
    try {
      const response = await this.request({
        request: { type: "health", requestId: id },
        requestId: id,
        expectedType: "health",
        schema: healthResponseSchema
      });
      assertProvenance({
        provenance: response.provenance,
        ownerUserId: this.ownerUserId,
        relationshipId: null
      });
      return {
        enabled: response.enabled,
        healthy: response.healthy,
        protocolVersion: response.protocolVersion,
        reason: response.reason
      };
    } catch {
      return {
        enabled: true,
        healthy: false,
        protocolVersion: null,
        reason: "The configured forge-peer daemon is unavailable or untrusted."
      };
    }
  }

  async transportReadiness(input: {
    ownerUserId: string;
  }): Promise<PeerTransportReadiness> {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({ ownerUserId: boundedIdSchema })
      .strict()
      .parse(input);
    const id = requestId();
    const response = await this.request({
      request: {
        type: "transport_readiness",
        requestId: id,
        input: parsed
      },
      requestId: id,
      expectedType: "transport_readiness",
      schema: transportReadinessResponseSchema
    });
    assertProvenance({
      provenance: response.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: null
    });
    const configured = new Map(
      response.transports.map((provider) => [provider.kind, provider])
    );
    return {
      providers: transportProviderKinds.map((kind) => {
        const provider = configured.get(kind);
        if (!provider) {
          return {
            kind,
            configured: false,
            state: "disabled" as const,
            detailCode: "not_configured",
            checkedAt: null
          };
        }
        return {
          kind,
          configured: true,
          state: provider.state,
          detailCode: provider.detailCode,
          checkedAt: new Date(provider.checkedAt * 1_000).toISOString()
        };
      }),
      provenance: response.provenance
    };
  }

  async localIdentity(input: {
    ownerUserId: string;
  }): Promise<PeerLocalIdentity> {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({ ownerUserId: boundedIdSchema })
      .strict()
      .parse(input);
    const id = requestId();
    const response = await this.request({
      request: {
        type: "local_identity",
        requestId: id,
        input: { ownerUserId: parsed.ownerUserId }
      },
      requestId: id,
      expectedType: "local_identity",
      schema: localIdentityResponseSchema
    });
    assertProvenance({
      provenance: response.identity.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: null
    });
    const { principal, device, provenance } = response.identity;
    if (
      device.principalId !== principal.id ||
      device.certificateHash !== principal.certificateHash ||
      provenance.localPrincipalId !== principal.id ||
      provenance.localDeviceId !== device.id ||
      provenance.remotePrincipalId !== null ||
      provenance.remoteDeviceId !== null
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The forge-peer local identity does not match its authenticated provenance."
      );
    }
    return this.pinLocalIdentity({ principal, device, provenance });
  }

  async commandReceipt(
    input: Parameters<PeerCoreGateway["commandReceipt"]>[0]
  ): Promise<PeerDaemonCommandReceipt> {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        ownerUserId: boundedIdSchema,
        commandId: boundedIdSchema.min(16)
      })
      .strict()
      .parse(input);
    const id = requestId();
    const response = await this.request({
      request: {
        type: "command_receipt",
        requestId: id,
        input: parsed
      },
      requestId: id,
      expectedType: "command_receipt",
      schema: commandReceiptResponseSchema
    });
    if (response.receipt.commandId !== parsed.commandId) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The forge-peer receipt does not match the requested command."
      );
    }
    if (
      (response.receipt.approvalDeadline === null) !==
      (response.receipt.committedAt === null)
    ) {
      throw new PeerCoreIpcError(
        "protocol",
        "The forge-peer receipt has incomplete commit metadata."
      );
    }
    if (
      response.receipt.approvalDeadline !== null &&
      response.receipt.committedAt !== null &&
      Date.parse(response.receipt.committedAt) >
        Date.parse(response.receipt.approvalDeadline)
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The forge-peer receipt committed after its approval deadline."
      );
    }
    const receiptStatement = {
      commandId: response.receipt.commandId,
      operation: response.receipt.operation,
      requestHash: response.receipt.requestHash,
      approvalDeadline: response.receipt.approvalDeadline,
      committedAt: response.receipt.committedAt,
      authorization: response.receipt.authorization,
      result: response.receipt.result
    };
    await this.verifyDaemonEvidence({
      evidence: response.receipt.evidence,
      statementType: "command_receipt",
      statement: receiptStatement,
      notBefore: response.receipt.committedAt
    });
    let currentAuthorityStateHash: string | null = null;
    if (response.receipt.authorization !== null && this.commandAuthorizer) {
      const authorityState = await this.commandAuthorizer.initialize();
      const authorityStateHash = peerCommandAuthorityStateHash(authorityState);
      currentAuthorityStateHash = authorityStateHash;
      if (
        response.receipt.authorization.authorityKeyId !==
          this.commandAuthorizer.authorityKeyId ||
        response.receipt.authorization.invalidationEpoch !==
          authorityState.epoch ||
        response.receipt.authorization.authorityStateHash !==
          authorityStateHash ||
        (this.currentAuthorityStateHash !== null &&
          response.receipt.authorization.authorityStateHash !==
            this.currentAuthorityStateHash)
      ) {
        throw new PeerCoreIpcError(
          "authentication_failed",
          "The forge-peer receipt does not match the current command authority state."
        );
      }
    }
    const receiptAuthorization = response.receipt.authorization;
    if (
      receiptAuthorization !== null &&
      receiptAuthorization.actorClass !== "service_worker" &&
      this.commandJournal
    ) {
      if (
        currentAuthorityStateHash === null ||
        receiptAuthorization.authorizationId === null ||
        receiptAuthorization.actorClass === null ||
        receiptAuthorization.actorId === null ||
        receiptAuthorization.sessionId === null ||
        receiptAuthorization.capabilityId === null ||
        receiptAuthorization.actionDigest === null ||
        response.receipt.approvalDeadline === null ||
        response.receipt.committedAt === null
      ) {
        throw new PeerCoreIpcError(
          "authentication_failed",
          "The forge-peer receipt is missing its durable human-command binding."
        );
      }
      try {
        this.commandJournal.verifyReceipt({
          ownerUserId: this.ownerUserId,
          commandId: response.receipt.commandId,
          operation: response.receipt.operation,
          requestHash: response.receipt.requestHash,
          approvalDeadline: response.receipt.approvalDeadline,
          committedAt: response.receipt.committedAt,
          resultHash: hashPeerApiValue(response.receipt.result),
          currentAuthorityStateHash,
          authorization: {
            authorityKeyId: receiptAuthorization.authorityKeyId,
            authorizationId: receiptAuthorization.authorizationId,
            actorClass: receiptAuthorization.actorClass,
            actorId: receiptAuthorization.actorId,
            actorDeviceId: receiptAuthorization.actorDeviceId,
            sessionId: receiptAuthorization.sessionId,
            capabilityId: receiptAuthorization.capabilityId,
            actionDigest: receiptAuthorization.actionDigest,
            invalidationEpoch: receiptAuthorization.invalidationEpoch,
            authorityStateHash: receiptAuthorization.authorityStateHash,
            verifiedAt: receiptAuthorization.verifiedAt
          },
          evidence: {
            statementHash: response.receipt.evidence.statementHash,
            signature: response.receipt.evidence.signature
          }
        });
      } catch (error) {
        throw new PeerCoreIpcError(
          "authentication_failed",
          "The forge-peer receipt failed its durable journal binding.",
          { cause: error }
        );
      }
    }
    return {
      commandId: response.receipt.commandId,
      operation: response.receipt.operation,
      requestHash: response.receipt.requestHash,
      approvalDeadline: response.receipt.approvalDeadline,
      committedAt: response.receipt.committedAt,
      authorization: response.receipt.authorization,
      result: response.receipt.result,
      evidence: response.receipt.evidence
    };
  }

  private async verifyServiceWorkerReceipt<S extends z.ZodTypeAny>(input: {
    commandId: string;
    operation:
      | "claim_inbound_query"
      | "respond_inbound_query"
      | "ack_revocation_events";
    approvalDeadline: string;
    actorId: string;
    commandDigest: string;
    expectedRequestHash: string;
    capability: "query_worker" | "revocation_consumer";
    resultSchema: S;
    directResult?: unknown;
  }): Promise<z.output<S>> {
    if (!this.commandAuthorizer) {
      throw new PeerCoreIpcError(
        "configuration",
        "The forge-peer command authority is not configured."
      );
    }
    const receipt = await this.commandReceipt({
      ownerUserId: this.ownerUserId,
      commandId: input.commandId
    });
    const authorityState = await this.commandAuthorizer.initialize();
    const expectedSessionId =
      input.capability === "query_worker"
        ? derivePeerQueryWorkerSessionId({
            ownerUserId: this.ownerUserId,
            workerId: input.actorId
          })
        : derivePeerRevocationConsumerSessionId({
            ownerUserId: this.ownerUserId,
            consumerId: input.actorId
          });
    const expectedCapabilityId =
      input.capability === "query_worker"
        ? derivePeerQueryWorkerCapabilityId({
            ownerUserId: this.ownerUserId,
            workerId: input.actorId
          })
        : derivePeerRevocationConsumerCapabilityId({
            ownerUserId: this.ownerUserId,
            consumerId: input.actorId
          });
    const authorization = receipt.authorization;
    if (
      receipt.operation !== input.operation ||
      Date.parse(receipt.approvalDeadline ?? "") !==
        Date.parse(input.approvalDeadline) ||
      receipt.committedAt === null ||
      receipt.requestHash !== input.expectedRequestHash ||
      authorization === null ||
      authorization.authorityKeyId !== this.commandAuthorizer.authorityKeyId ||
      authorization.authorizationId === null ||
      authorization.actorClass !== "service_worker" ||
      authorization.actorId !== input.actorId ||
      authorization.actorDeviceId !== null ||
      authorization.sessionId !== expectedSessionId ||
      authorization.capabilityId !== expectedCapabilityId ||
      authorization.actionDigest !== input.commandDigest ||
      authorization.invalidationEpoch !== authorityState.epoch ||
      authorization.authorityStateHash === "0".repeat(64) ||
      Date.parse(authorization.verifiedAt) > Date.parse(receipt.committedAt)
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The forge-peer durable service-command receipt is not bound to the exact request."
      );
    }
    let result: z.output<S>;
    try {
      result = input.resultSchema.parse(receipt.result);
    } catch (error) {
      throw new PeerCoreIpcError(
        "protocol",
        "The forge-peer durable service-command result is invalid.",
        { cause: error }
      );
    }
    if (
      input.directResult !== undefined &&
      !isDeepStrictEqual(result, input.directResult)
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The forge-peer response differs from its durable command receipt."
      );
    }
    return result;
  }

  async syncCommandAuthorizationState(
    input: Parameters<PeerCoreGateway["syncCommandAuthorizationState"]>[0]
  ) {
    this.assertOwner(input.ownerUserId);
    if (!this.commandAuthorizer) {
      throw new PeerCoreIpcError(
        "configuration",
        "The forge-peer command authority is not configured."
      );
    }
    const state = await this.commandAuthorizer.initialize();
    const id = requestId();
    const response = await this.request({
      request: {
        type: "sync_command_authorization_state",
        requestId: id,
        input: { ownerUserId: input.ownerUserId }
      },
      requestId: id,
      expectedType: "command_authorization_state_synchronized",
      schema: commandAuthorizationStateResponseSchema
    });
    assertProvenance({
      provenance: response.state.provenance,
      ownerUserId: input.ownerUserId,
      relationshipId: null
    });
    const authorityStateHash = peerCommandAuthorityStateHash(state);
    if (
      response.state.authorityKeyId !== this.commandAuthorizer.authorityKeyId ||
      response.state.invalidationEpoch !== state.epoch ||
      response.state.stateHash !== authorityStateHash ||
      response.state.authorization.authorityKeyId !==
        this.commandAuthorizer.authorityKeyId ||
      response.state.authorization.invalidationEpoch !== state.epoch ||
      response.state.authorization.authorityStateHash !== authorityStateHash
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The forge-peer command authority state does not match Node."
      );
    }
    this.currentAuthorityStateHash = authorityStateHash;
    return response.state;
  }

  async createInvitation(
    input: Parameters<PeerCoreGateway["createInvitation"]>[0]
  ): Promise<PeerInvitationMaterial> {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        commandId: boundedIdSchema.min(16),
        approvalDeadline: approvalDeadlineSchema,
        approval: peerCommandApprovalBindingSchema,
        ownerUserId: boundedIdSchema,
        label: z.string().trim().min(1).max(160),
        expiresAt: z.string().datetime({ offset: true }),
        privacyMode: peerTransportPrivacyModeSchema,
        transportKinds: z.array(peerTransportKindSchema).min(1).max(4)
      })
      .strict()
      .parse(input);
    const id = requestId();
    const response = await this.request({
      request: {
        type: "create_invitation",
        requestId: id,
        commandId: parsed.commandId,
        approvalDeadline: parsed.approvalDeadline,
        authorizationContext: parsed.approval,
        input: {
          ownerUserId: parsed.ownerUserId,
          label: parsed.label,
          expiresAt: parsed.expiresAt,
          privacyMode: parsed.privacyMode,
          transportKinds: parsed.transportKinds
        }
      },
      requestId: id,
      expectedType: "invitation_created",
      schema: invitationCreatedResponseSchema
    });
    assertProvenance({
      provenance: response.material.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: null
    });
    if (
      response.material.invitation.ownerUserId !== parsed.ownerUserId ||
      response.material.invitation.inviterPrincipalId !==
        response.material.provenance.localPrincipalId ||
      response.material.invitation.inviterDeviceId !==
        response.material.provenance.localDeviceId
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The forge-peer invitation identity does not match its provenance."
      );
    }
    const bootstrapCiphertext = decodeCanonicalBase64Url(
      response.material.bootstrapCiphertext,
      "invitation bootstrap ciphertext"
    );
    const bootstrapNonce = decodeCanonicalBase64Url(
      response.material.bootstrapNonce,
      "invitation bootstrap nonce"
    );
    if (bootstrapNonce.byteLength !== 24) {
      throw new PeerCoreIpcError(
        "protocol",
        "The forge-peer invitation nonce has an invalid length."
      );
    }
    const actualHash = createHash("sha256")
      .update(bootstrapCiphertext)
      .digest("hex");
    if (actualHash !== response.material.bootstrapHash) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The forge-peer invitation backup hash does not match."
      );
    }
    return {
      invitation: response.material.invitation,
      bootstrapCiphertext,
      bootstrapNonce,
      bootstrapHash: response.material.bootstrapHash
    };
  }

  async cancelInvitation(
    input: Parameters<NonNullable<PeerCoreGateway["cancelInvitation"]>>[0]
  ): Promise<void> {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        commandId: boundedIdSchema.min(16),
        approvalDeadline: approvalDeadlineSchema,
        approval: peerCommandApprovalBindingSchema,
        ownerUserId: boundedIdSchema,
        invitationId: boundedIdSchema
      })
      .strict()
      .parse(input);
    const id = requestId();
    const response = await this.request({
      request: {
        type: "cancel_invitation",
        requestId: id,
        commandId: parsed.commandId,
        approvalDeadline: parsed.approvalDeadline,
        authorizationContext: parsed.approval,
        input: {
          ownerUserId: parsed.ownerUserId,
          invitationId: parsed.invitationId
        }
      },
      requestId: id,
      expectedType: "invitation_canceled",
      schema: invitationCanceledResponseSchema
    });
    assertProvenance({
      provenance: response.result.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: null
    });
    if (response.result.invitationId !== parsed.invitationId) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The canceled invitation does not match the requested invitation."
      );
    }
  }

  async acceptInvitation(
    input: Parameters<PeerCoreGateway["acceptInvitation"]>[0]
  ): Promise<PeerPairingAcceptance> {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        commandId: boundedIdSchema.min(16),
        approvalDeadline: approvalDeadlineSchema,
        approval: peerCommandApprovalBindingSchema,
        ownerUserId: boundedIdSchema,
        invitation: peerPairingInviteSchema,
        localDeviceId: boundedIdSchema,
        privacyMode: peerTransportPrivacyModeSchema,
        scannedAt: z.string().datetime({ offset: true })
      })
      .strict()
      .parse(input);
    const id = requestId();
    const response = await this.request({
      request: {
        type: "accept_invitation",
        requestId: id,
        commandId: parsed.commandId,
        approvalDeadline: parsed.approvalDeadline,
        authorizationContext: parsed.approval,
        input: {
          ownerUserId: parsed.ownerUserId,
          invitation: parsed.invitation,
          localDeviceId: parsed.localDeviceId,
          privacyMode: parsed.privacyMode,
          scannedAt: parsed.scannedAt
        }
      },
      requestId: id,
      expectedType: "invitation_accepted",
      schema: invitationAcceptedResponseSchema
    });
    const acceptance = response.acceptance;
    assertProvenance({
      provenance: acceptance.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: null
    });
    if (
      acceptance.requestPayload.invitationId !== parsed.invitation.id ||
      acceptance.requestPayload.localDeviceId !== parsed.localDeviceId ||
      acceptance.requestPayload.localPrincipalId !==
        acceptance.provenance.localPrincipalId ||
      acceptance.requestPayload.remotePrincipalId !==
        parsed.invitation.inviterPrincipalId ||
      acceptance.requestPayload.remoteDeviceId !==
        parsed.invitation.inviterDeviceId
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The forge-peer pairing request does not match the scanned invitation."
      );
    }
    return {
      requestId: acceptance.requestId,
      requestPayload: acceptance.requestPayload,
      expiresAt: acceptance.expiresAt
    };
  }

  async acceptPendingRequest(
    input: Parameters<NonNullable<PeerCoreGateway["acceptPendingRequest"]>>[0]
  ): Promise<void> {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        commandId: boundedIdSchema.min(16),
        approvalDeadline: approvalDeadlineSchema,
        approval: peerCommandApprovalBindingSchema,
        ownerUserId: boundedIdSchema,
        request: pendingRequestSchema
      })
      .strict()
      .parse(input);
    assertSafePayload(parsed.request.payload);
    const id = requestId();
    const response = await this.request({
      request: {
        type: "accept_pending_request",
        requestId: id,
        commandId: parsed.commandId,
        approvalDeadline: parsed.approvalDeadline,
        authorizationContext: parsed.approval,
        input: {
          ownerUserId: parsed.ownerUserId,
          request: parsed.request
        }
      },
      requestId: id,
      expectedType: "pending_request_accepted",
      schema: pendingRequestAcceptedResponseSchema
    });
    assertProvenance({
      provenance: response.result.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: parsed.request.relationshipId
    });
    if (
      response.result.requestId !== parsed.request.id ||
      response.result.kind !== parsed.request.kind
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The accepted peer request does not match the reviewed request."
      );
    }
  }

  async confirmPairing(
    input: Parameters<PeerCoreGateway["confirmPairing"]>[0]
  ): Promise<PeerPairingConfirmation> {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        commandId: boundedIdSchema.min(16),
        approvalDeadline: approvalDeadlineSchema,
        approval: peerCommandApprovalBindingSchema,
        ownerUserId: boundedIdSchema,
        pairingId: boundedIdSchema,
        requestPayload: pairingRequestPayloadSchema,
        transcriptHash: hashSchema,
        verificationPhrase: z.string().trim().min(1).max(240)
      })
      .strict()
      .parse(input);
    if (
      parsed.requestPayload.transcriptHash !== parsed.transcriptHash ||
      parsed.requestPayload.verificationPhrase !== parsed.verificationPhrase
    ) {
      throw new PeerCoreIpcError(
        "invalid_request",
        "The pairing confirmation does not match the reviewed transcript."
      );
    }
    const id = requestId();
    const response = await this.request({
      request: {
        type: "confirm_pairing",
        requestId: id,
        commandId: parsed.commandId,
        approvalDeadline: parsed.approvalDeadline,
        authorizationContext: parsed.approval,
        input: {
          ownerUserId: parsed.ownerUserId,
          pairingId: parsed.pairingId,
          requestPayload: parsed.requestPayload,
          transcriptHash: parsed.transcriptHash,
          verificationPhrase: parsed.verificationPhrase
        }
      },
      requestId: id,
      expectedType: "pairing_confirmed",
      schema: pairingConfirmedResponseSchema
    });
    const confirmation = response.confirmation;
    assertProvenance({
      provenance: confirmation.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: confirmation.relationship.id
    });
    if (
      confirmation.provenance.localPrincipalId !==
        parsed.requestPayload.localPrincipalId ||
      confirmation.relationship.localPrincipal.id !==
        parsed.requestPayload.localPrincipalId ||
      confirmation.relationship.localDevice.id !==
        parsed.requestPayload.localDeviceId ||
      confirmation.relationship.localDevice.principalId !==
        confirmation.relationship.localPrincipal.id ||
      confirmation.relationship.remotePrincipal.id !==
        parsed.requestPayload.remotePrincipalId ||
      confirmation.relationship.remoteDevice.id !==
        parsed.requestPayload.remoteDeviceId ||
      confirmation.relationship.remoteDevice.principalId !==
        confirmation.relationship.remotePrincipal.id ||
      confirmation.relationship.localPrincipal.certificateHash !==
        confirmation.relationship.localDevice.certificateHash ||
      confirmation.relationship.remotePrincipal.certificateHash !==
        confirmation.relationship.remoteDevice.certificateHash
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The confirmed pairing identities do not match the transcript."
      );
    }
    if (
      confirmation.provenance.localDeviceId !==
        parsed.requestPayload.localDeviceId ||
      confirmation.provenance.remotePrincipalId !==
        parsed.requestPayload.remotePrincipalId ||
      confirmation.provenance.remoteDeviceId !==
        parsed.requestPayload.remoteDeviceId ||
      confirmation.relationship.verificationPhraseHash !==
        parsed.requestPayload.verificationPhraseHash
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The confirmed pairing does not match the reviewed transcript."
      );
    }
    return {
      relationship: confirmation.relationship,
      outboundEnvelope:
        confirmation.outboundEnvelope === null
          ? null
          : decodeCanonicalBase64Url(
              confirmation.outboundEnvelope,
              "pairing envelope"
            ),
      provenance: confirmation.provenance
    };
  }

  async signGrant(input: Parameters<PeerCoreGateway["signGrant"]>[0]) {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        commandId: boundedIdSchema.min(16),
        approvalDeadline: approvalDeadlineSchema,
        approval: peerCommandApprovalBindingSchema,
        ownerUserId: boundedIdSchema,
        relationshipId: boundedIdSchema,
        grant: peerShareGrantVersionSchema
      })
      .strict()
      .parse(input);
    const id = requestId();
    const response = await this.request({
      request: {
        type: "sign_grant",
        requestId: id,
        commandId: parsed.commandId,
        approvalDeadline: parsed.approvalDeadline,
        authorizationContext: parsed.approval,
        input: {
          ownerUserId: parsed.ownerUserId,
          relationshipId: parsed.relationshipId,
          grant: parsed.grant
        }
      },
      requestId: id,
      expectedType: "grant_signed",
      schema: grantOperationResponseSchema("grant_signed")
    });
    assertProvenance({
      provenance: response.result.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: parsed.relationshipId
    });
    if (
      response.result.grant.ownerUserId !== parsed.ownerUserId ||
      response.result.grant.relationshipId !== parsed.relationshipId
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The signed grant does not match the requested relationship."
      );
    }
    return response.result.grant;
  }

  async acceptGrant(input: Parameters<PeerCoreGateway["acceptGrant"]>[0]) {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        commandId: boundedIdSchema.min(16),
        approvalDeadline: approvalDeadlineSchema,
        approval: peerCommandApprovalBindingSchema,
        ownerUserId: boundedIdSchema,
        grant: peerShareGrantVersionSchema
      })
      .strict()
      .parse(input);
    const id = requestId();
    const response = await this.request({
      request: {
        type: "accept_grant",
        requestId: id,
        commandId: parsed.commandId,
        approvalDeadline: parsed.approvalDeadline,
        authorizationContext: parsed.approval,
        input: { ownerUserId: parsed.ownerUserId, grant: parsed.grant }
      },
      requestId: id,
      expectedType: "grant_accepted",
      schema: grantOperationResponseSchema("grant_accepted")
    });
    assertProvenance({
      provenance: response.result.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: parsed.grant.relationshipId
    });
    if (
      response.result.grant.ownerUserId !== parsed.ownerUserId ||
      response.result.grant.relationshipId !== parsed.grant.relationshipId
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The accepted grant does not match the requested relationship."
      );
    }
    return response.result.grant;
  }

  async revokeGrant(
    input: Parameters<NonNullable<PeerCoreGateway["revokeGrant"]>>[0]
  ) {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        commandId: boundedIdSchema.min(16),
        approvalDeadline: approvalDeadlineSchema,
        approval: peerCommandApprovalBindingSchema,
        ownerUserId: boundedIdSchema,
        grant: peerShareGrantVersionSchema,
        reason: z.string().trim().min(1).max(1_024)
      })
      .strict()
      .parse(input);
    const id = requestId();
    const response = await this.request({
      request: {
        type: "revoke_grant",
        requestId: id,
        commandId: parsed.commandId,
        approvalDeadline: parsed.approvalDeadline,
        authorizationContext: parsed.approval,
        input: {
          ownerUserId: parsed.ownerUserId,
          grant: parsed.grant,
          reason: parsed.reason
        }
      },
      requestId: id,
      expectedType: "grant_revoked",
      schema: grantOperationResponseSchema("grant_revoked")
    });
    assertProvenance({
      provenance: response.result.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: parsed.grant.relationshipId
    });
    if (
      response.result.grant.id !== parsed.grant.id ||
      response.result.grant.ownerUserId !== parsed.ownerUserId ||
      response.result.grant.relationshipId !== parsed.grant.relationshipId ||
      response.result.grant.sequence !== parsed.grant.sequence ||
      response.result.grant.status !== "revoked" ||
      response.result.grant.revokedAt === null
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The revoked grant does not match the requested hash-chain transition."
      );
    }
    return response.result.grant;
  }

  async updateDevice(input: Parameters<PeerCoreGateway["updateDevice"]>[0]) {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        commandId: boundedIdSchema.min(16),
        approvalDeadline: approvalDeadlineSchema,
        approval: peerCommandApprovalBindingSchema,
        ownerUserId: boundedIdSchema,
        relationshipId: boundedIdSchema,
        deviceId: boundedIdSchema,
        action: z.enum(["approve", "remove"])
      })
      .strict()
      .parse(input);
    const id = requestId();
    const response = await this.request({
      request: {
        type: "update_device",
        requestId: id,
        commandId: parsed.commandId,
        approvalDeadline: parsed.approvalDeadline,
        authorizationContext: parsed.approval,
        input: {
          ownerUserId: parsed.ownerUserId,
          relationshipId: parsed.relationshipId,
          deviceId: parsed.deviceId,
          action: parsed.action
        }
      },
      requestId: id,
      expectedType: "device_updated",
      schema: mutationResponseSchema("device_updated")
    });
    assertProvenance({
      provenance: response.result.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: parsed.relationshipId
    });
  }

  async revokeRelationship(
    input: Parameters<PeerCoreGateway["revokeRelationship"]>[0]
  ) {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        commandId: boundedIdSchema.min(16),
        approvalDeadline: approvalDeadlineSchema,
        approval: peerCommandApprovalBindingSchema,
        ownerUserId: boundedIdSchema,
        relationshipId: boundedIdSchema,
        reason: z.string().trim().min(1).max(1_024)
      })
      .strict()
      .parse(input);
    const id = requestId();
    const response = await this.request({
      request: {
        type: "revoke_relationship",
        requestId: id,
        commandId: parsed.commandId,
        approvalDeadline: parsed.approvalDeadline,
        authorizationContext: parsed.approval,
        input: {
          ownerUserId: parsed.ownerUserId,
          relationshipId: parsed.relationshipId,
          reason: parsed.reason
        }
      },
      requestId: id,
      expectedType: "relationship_revoked",
      schema: mutationResponseSchema("relationship_revoked")
    });
    assertProvenance({
      provenance: response.result.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: parsed.relationshipId
    });
  }

  async requestResync(input: Parameters<PeerCoreGateway["requestResync"]>[0]) {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        commandId: boundedIdSchema.min(16),
        approvalDeadline: approvalDeadlineSchema,
        approval: peerCommandApprovalBindingSchema,
        ownerUserId: boundedIdSchema,
        relationshipId: boundedIdSchema,
        projectionIds: z.array(boundedIdSchema).max(1_000)
      })
      .strict()
      .parse(input);
    const id = requestId();
    const response = await this.request({
      request: {
        type: "request_resync",
        requestId: id,
        commandId: parsed.commandId,
        approvalDeadline: parsed.approvalDeadline,
        authorizationContext: parsed.approval,
        input: {
          ownerUserId: parsed.ownerUserId,
          relationshipId: parsed.relationshipId,
          projectionIds: parsed.projectionIds
        }
      },
      requestId: id,
      expectedType: "resync_requested",
      schema: resyncResponseSchema
    });
    assertProvenance({
      provenance: response.result.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: parsed.relationshipId
    });
    return { envelopeIds: response.result.envelopeIds };
  }

  private assertInboundQueryClaimResult(
    result: PeerInboundQueryClaimResult
  ): PeerInboundQueryClaimResult {
    const relationshipId = result.claim?.relationshipId ?? null;
    assertProvenance({
      provenance: result.provenance,
      ownerUserId: this.ownerUserId,
      relationshipId
    });
    if (result.claim === null) {
      if (
        result.provenance.remotePrincipalId !== null ||
        result.provenance.remoteDeviceId !== null
      ) {
        throw new PeerCoreIpcError(
          "authentication_failed",
          "An empty inbound claim carried remote peer provenance."
        );
      }
      return result;
    }
    const { claim, provenance } = result;
    if (
      claim.requester.relationshipId !== claim.relationshipId ||
      claim.requester.principalId !== provenance.remotePrincipalId ||
      claim.requester.deviceId !== provenance.remoteDeviceId ||
      Date.parse(claim.leaseExpiresAt) <= Date.parse(claim.receivedAt)
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The inbound query claim does not match its authenticated requester."
      );
    }
    return result;
  }

  async claimInboundQuery(
    input: Parameters<NonNullable<PeerCoreGateway["claimInboundQuery"]>>[0]
  ): Promise<PeerInboundQueryClaimResult> {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        commandId: boundedIdSchema.min(16),
        approvalDeadline: approvalDeadlineSchema,
        authorizationIssuedAt: z.string().datetime({ offset: true }),
        ownerUserId: boundedIdSchema,
        workerId: boundedIdSchema,
        leaseMs: z.number().int().min(100).max(30_000)
      })
      .strict()
      .parse(input);
    if (
      Date.parse(parsed.authorizationIssuedAt) >
      Date.parse(parsed.approvalDeadline)
    ) {
      throw new PeerCoreIpcError(
        "authorization_failed",
        "The query-worker authorization was issued after its deadline."
      );
    }
    const id = requestId();
    const daemonRequest = {
      type: "claim_inbound_query",
      requestId: id,
      commandId: parsed.commandId,
      approvalDeadline: parsed.approvalDeadline,
      input: {
        ownerUserId: parsed.ownerUserId,
        workerId: parsed.workerId,
        leaseMs: parsed.leaseMs
      }
    };
    const commandDigest = peerCommandActionDigest(daemonRequest);
    let expectedRequestHash: string | null = null;
    let directResult: PeerInboundQueryClaimResult | undefined;
    try {
      const response = await this.request({
        request: {
          ...daemonRequest,
          queryWorkerAuthorizationContext: {
            workerId: parsed.workerId,
            issuedAt: parsed.authorizationIssuedAt
          }
        },
        requestId: id,
        expectedType: "inbound_query_claimed",
        schema: inboundQueryClaimedResponseSchema,
        captureRequestHash: (requestHash) => {
          expectedRequestHash = requestHash;
        }
      });
      directResult = response.result;
    } catch (error) {
      if (
        !(error instanceof PeerCoreIpcError) ||
        (error.code !== "timeout" && error.code !== "transport")
      ) {
        throw error;
      }
      try {
        if (expectedRequestHash === null) throw error;
        return this.assertInboundQueryClaimResult(
          await this.verifyServiceWorkerReceipt({
            commandId: parsed.commandId,
            operation: "claim_inbound_query",
            approvalDeadline: parsed.approvalDeadline,
            actorId: parsed.workerId,
            commandDigest,
            expectedRequestHash,
            capability: "query_worker",
            resultSchema: inboundQueryClaimResultSchema
          })
        );
      } catch {
        throw error;
      }
    }
    if (expectedRequestHash === null) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The query-worker dispatch is missing its exact request hash."
      );
    }
    return this.assertInboundQueryClaimResult(
      await this.verifyServiceWorkerReceipt({
        commandId: parsed.commandId,
        operation: "claim_inbound_query",
        approvalDeadline: parsed.approvalDeadline,
        actorId: parsed.workerId,
        commandDigest,
        expectedRequestHash,
        capability: "query_worker",
        resultSchema: inboundQueryClaimResultSchema,
        directResult
      })
    );
  }

  async respondInboundQuery(
    input: Parameters<NonNullable<PeerCoreGateway["respondInboundQuery"]>>[0]
  ): Promise<PeerInboundQueryResponseResult> {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        commandId: boundedIdSchema.min(16),
        approvalDeadline: approvalDeadlineSchema,
        authorizationIssuedAt: z.string().datetime({ offset: true }),
        ownerUserId: boundedIdSchema,
        workerId: boundedIdSchema,
        claimId: z.string().regex(/^[a-f0-9]{32}$/),
        queryId: z.string().regex(/^[a-f0-9]{32}$/),
        payload: queryPayloadSchema,
        asOf: z.string().datetime({ offset: true }),
        completeness: z.enum(["complete", "partial", "unknown"]),
        redactedFields: z
          .array(z.string().trim().min(1).max(120))
          .max(256)
          .refine((values) => new Set(values).size === values.length)
      })
      .strict()
      .parse(input);
    if (
      Date.parse(parsed.authorizationIssuedAt) >
        Date.parse(parsed.approvalDeadline) ||
      Date.parse(parsed.asOf) > Date.parse(parsed.approvalDeadline)
    ) {
      throw new PeerCoreIpcError(
        "authorization_failed",
        "The query response falls outside its exact authorization window."
      );
    }
    assertSafePayload(parsed.payload);
    const id = requestId();
    const daemonRequest = {
      type: "respond_inbound_query",
      requestId: id,
      commandId: parsed.commandId,
      approvalDeadline: parsed.approvalDeadline,
      input: {
        ownerUserId: parsed.ownerUserId,
        workerId: parsed.workerId,
        claimId: parsed.claimId,
        queryId: parsed.queryId,
        payload: parsed.payload,
        asOf: parsed.asOf,
        completeness: parsed.completeness,
        redactedFields: parsed.redactedFields
      }
    };
    const commandDigest = peerCommandActionDigest(daemonRequest);
    let expectedRequestHash: string | null = null;
    let directResult: PeerInboundQueryResponseResult | undefined;
    try {
      const response = await this.request({
        request: {
          ...daemonRequest,
          queryWorkerAuthorizationContext: {
            workerId: parsed.workerId,
            issuedAt: parsed.authorizationIssuedAt
          }
        },
        requestId: id,
        expectedType: "inbound_query_responded",
        schema: inboundQueryRespondedResponseSchema,
        captureRequestHash: (requestHash) => {
          expectedRequestHash = requestHash;
        }
      });
      directResult = response.result;
    } catch (error) {
      if (
        !(error instanceof PeerCoreIpcError) ||
        (error.code !== "timeout" && error.code !== "transport")
      ) {
        throw error;
      }
      try {
        if (expectedRequestHash === null) throw error;
        directResult = await this.verifyServiceWorkerReceipt({
          commandId: parsed.commandId,
          operation: "respond_inbound_query",
          approvalDeadline: parsed.approvalDeadline,
          actorId: parsed.workerId,
          commandDigest,
          expectedRequestHash,
          capability: "query_worker",
          resultSchema: inboundQueryResponseResultSchema
        });
      } catch {
        throw error;
      }
    }
    if (expectedRequestHash === null) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The query-worker dispatch is missing its exact request hash."
      );
    }
    const result = await this.verifyServiceWorkerReceipt({
      commandId: parsed.commandId,
      operation: "respond_inbound_query",
      approvalDeadline: parsed.approvalDeadline,
      actorId: parsed.workerId,
      commandDigest,
      expectedRequestHash,
      capability: "query_worker",
      resultSchema: inboundQueryResponseResultSchema,
      directResult
    });
    assertProvenance({
      provenance: result.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: result.provenance.relationshipId
    });
    if (
      result.queryId !== parsed.queryId ||
      result.provenance.relationshipId === null ||
      result.provenance.remotePrincipalId === null ||
      result.provenance.remoteDeviceId === null
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The inbound query response does not match its durable claim."
      );
    }
    return result;
  }

  async listRevocationEvents(
    input: Parameters<NonNullable<PeerCoreGateway["listRevocationEvents"]>>[0]
  ): Promise<PeerRevocationEventPage> {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        ownerUserId: boundedIdSchema,
        consumerId: boundedIdSchema,
        afterCursor: canonicalU64Schema,
        limit: z.number().int().min(1).max(128)
      })
      .strict()
      .parse(input);
    const id = requestId();
    const response = await this.request({
      request: {
        type: "list_revocation_events",
        requestId: id,
        input: parsed
      },
      requestId: id,
      expectedType: "revocation_events_listed",
      schema: revocationEventsListedResponseSchema
    });
    assertProvenance({
      provenance: response.page.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: null
    });
    const expectedNext =
      BigInt(parsed.afterCursor) + BigInt(response.page.events.length);
    if (
      response.page.nextCursor !== expectedNext.toString() ||
      (response.page.events.length > 0 &&
        response.page.events[0]!.cursor !==
          (BigInt(parsed.afterCursor) + 1n).toString()) ||
      response.page.provenance.remotePrincipalId !== null ||
      response.page.provenance.remoteDeviceId !== null
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The revocation event page does not match its requested owner cursor."
      );
    }
    await this.verifyDaemonEvidence({
      evidence: response.page.evidence,
      statementType: "revocation_event_page",
      statement: {
        events: response.page.events,
        acknowledgedCursor: response.page.acknowledgedCursor,
        nextCursor: response.page.nextCursor,
        hasMore: response.page.hasMore,
        provenance: response.page.provenance
      },
      notBefore: response.page.provenance.authenticatedAt
    });
    return response.page;
  }

  async ackRevocationEvents(
    input: Parameters<NonNullable<PeerCoreGateway["ackRevocationEvents"]>>[0]
  ): Promise<PeerRevocationAckResult> {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        commandId: boundedIdSchema.min(16),
        approvalDeadline: approvalDeadlineSchema,
        authorizationIssuedAt: z.string().datetime({ offset: true }),
        ownerUserId: boundedIdSchema,
        consumerId: boundedIdSchema,
        throughCursor: positiveCanonicalU64Schema,
        eventHash: hashSchema
      })
      .strict()
      .parse(input);
    if (
      Date.parse(parsed.authorizationIssuedAt) >
      Date.parse(parsed.approvalDeadline)
    ) {
      throw new PeerCoreIpcError(
        "authorization_failed",
        "The revocation-consumer authorization was issued after its deadline."
      );
    }
    const id = requestId();
    const daemonRequest = {
      type: "ack_revocation_events",
      requestId: id,
      commandId: parsed.commandId,
      approvalDeadline: parsed.approvalDeadline,
      input: {
        ownerUserId: parsed.ownerUserId,
        consumerId: parsed.consumerId,
        throughCursor: parsed.throughCursor,
        eventHash: parsed.eventHash
      }
    };
    const commandDigest = peerCommandActionDigest(daemonRequest);
    let expectedRequestHash: string | null = null;
    let directResult: PeerRevocationAckResult | undefined;
    try {
      const response = await this.request({
        request: {
          ...daemonRequest,
          revocationConsumerAuthorizationContext: {
            consumerId: parsed.consumerId,
            issuedAt: parsed.authorizationIssuedAt
          }
        },
        requestId: id,
        expectedType: "revocation_events_acknowledged",
        schema: revocationEventsAcknowledgedResponseSchema,
        captureRequestHash: (requestHash) => {
          expectedRequestHash = requestHash;
        }
      });
      directResult = response.result;
    } catch (error) {
      if (
        !(error instanceof PeerCoreIpcError) ||
        (error.code !== "timeout" && error.code !== "transport")
      ) {
        throw error;
      }
      try {
        if (expectedRequestHash === null) throw error;
        directResult = await this.verifyServiceWorkerReceipt({
          commandId: parsed.commandId,
          operation: "ack_revocation_events",
          approvalDeadline: parsed.approvalDeadline,
          actorId: parsed.consumerId,
          commandDigest,
          expectedRequestHash,
          capability: "revocation_consumer",
          resultSchema: revocationAckResultSchema
        });
      } catch {
        throw error;
      }
    }
    if (expectedRequestHash === null) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The revocation-consumer dispatch is missing its exact request hash."
      );
    }
    const result = await this.verifyServiceWorkerReceipt({
      commandId: parsed.commandId,
      operation: "ack_revocation_events",
      approvalDeadline: parsed.approvalDeadline,
      actorId: parsed.consumerId,
      commandDigest,
      expectedRequestHash,
      capability: "revocation_consumer",
      resultSchema: revocationAckResultSchema,
      directResult
    });
    assertProvenance({
      provenance: result.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: null
    });
    if (
      result.consumerId !== parsed.consumerId ||
      result.acknowledgedCursor !== parsed.throughCursor ||
      result.eventHash !== parsed.eventHash ||
      result.provenance.remotePrincipalId !== null ||
      result.provenance.remoteDeviceId !== null
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The revocation acknowledgement does not match the applied event page."
      );
    }
    return result;
  }

  async executeQuery(
    input: Parameters<PeerCoreGateway["executeQuery"]>[0]
  ): Promise<PeerQueryGatewayResult> {
    this.assertOwner(input.ownerUserId);
    const parsed = z
      .object({
        ownerUserId: boundedIdSchema,
        relationshipId: boundedIdSchema,
        personId: boundedIdSchema,
        query: peerTypedQuestionSchema,
        timeoutMs: z.number().int().min(100).max(12_000)
      })
      .strict()
      .parse(input);
    const id = requestId();
    const response = await this.request({
      request: {
        type: "execute_query",
        requestId: id,
        input: parsed
      },
      requestId: id,
      expectedType: "query_executed",
      schema: queryExecutedResponseSchema,
      timeoutMs: Math.min(this.timeoutMs, parsed.timeoutMs)
    });
    assertProvenance({
      provenance: response.result.provenance,
      ownerUserId: parsed.ownerUserId,
      relationshipId: parsed.relationshipId
    });
    if (
      response.result.state !== response.result.metadata.state ||
      response.result.metadata.projectionId !== parsed.query.projectionId ||
      response.result.metadata.source.relationshipId !==
        parsed.relationshipId ||
      response.result.metadata.source.principalId !==
        response.result.provenance.remotePrincipalId ||
      response.result.metadata.source.deviceId !==
        response.result.provenance.remoteDeviceId
    ) {
      throw new PeerCoreIpcError(
        "authentication_failed",
        "The forge-peer query result does not match its authenticated source."
      );
    }
    assertSafePayload(response.result.payload);
    return {
      state: response.result.state,
      payload: response.result.payload,
      metadata: response.result.metadata
    };
  }
}
