import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign as signBytes
} from "node:crypto";
import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PeerCoreIpcError,
  UnixSocketPeerCoreGateway
} from "./peer-core-ipc-gateway.js";
import {
  derivePeerCommandAuthorizationId,
  derivePeerQueryWorkerCapabilityId,
  derivePeerQueryWorkerSessionId,
  derivePeerRevocationConsumerCapabilityId,
  derivePeerRevocationConsumerSessionId,
  peerCommandAuthorityStateHash,
  peerCommandRequestHash
} from "./peer-command-authorization.js";
import type {
  PeerCommandApprovalBinding,
  PeerCommandAuthorization,
  PeerCommandAuthorizer
} from "./peer-command-authorization.js";

const ownerUserId = "user_peer_ipc_test";
const approvalDeadline = "2026-07-15T12:05:00.000Z";
const IPC_HEADER_BYTES = 10;
const MAX_IPC_BODY_BYTES = 64 * 1024;
const STALL = Symbol("stall");
const authorityKeyId = "A".repeat(43);
const daemonKeyPair = generateKeyPairSync("ed25519");
const daemonPublicJwk = daemonKeyPair.publicKey.export({ format: "jwk" });
if (!daemonPublicJwk.x) throw new Error("Test daemon key is not Ed25519.");
const daemonSigningPublicKey = daemonPublicJwk.x;
const daemonPrincipalId = "1".repeat(64);
const daemonDeviceId = "2".repeat(32);
const daemonCertificateHash = "3".repeat(64);
const approval: PeerCommandApprovalBinding = {
  actorClass: "operator_session",
  actorId: "user_peer_ipc_test",
  sessionId: "session_peer_ipc_test",
  deviceId: null,
  capabilityId: "capability_peer_ipc_test",
  actionDigest: "c".repeat(64),
  capabilityIssuedAt: "2026-07-15T11:59:00.000Z",
  capabilityExpiresAt: approvalDeadline,
  authorizationIssuedAt: "2026-07-15T12:00:00.000Z"
};

function authorityState() {
  return {
    protocol: "forge-peer-command-authority-state/v1" as const,
    authorityKeyId,
    ownerUserId,
    epoch: "0",
    invalidatedBefore: "1970-01-01T00:00:00.000Z",
    revokedAuthorizationIds: [] as string[],
    revokedSessionIds: [] as string[],
    revokedDeviceIds: [] as string[],
    signature: "S".repeat(86)
  };
}

function serviceAuthorization(input: {
  commandId: string;
  commandDigest: string;
  approvalDeadline: string;
  issuedAt: string;
  action:
    | "claim_inbound_query"
    | "respond_inbound_query"
    | "ack_revocation_events";
  actorId: string;
  capabilityKind: "query_worker" | "revocation_consumer";
}): PeerCommandAuthorization {
  const capabilityId =
    input.capabilityKind === "query_worker"
      ? derivePeerQueryWorkerCapabilityId({
          ownerUserId,
          workerId: input.actorId
        })
      : derivePeerRevocationConsumerCapabilityId({
          ownerUserId,
          consumerId: input.actorId
        });
  const sessionId =
    input.capabilityKind === "query_worker"
      ? derivePeerQueryWorkerSessionId({
          ownerUserId,
          workerId: input.actorId
        })
      : derivePeerRevocationConsumerSessionId({
          ownerUserId,
          consumerId: input.actorId
        });
  return {
    protocol: "forge-peer-command-authorization/v1",
    authorityKeyId,
    authorizationId: derivePeerCommandAuthorizationId({
      commandId: input.commandId,
      capabilityId,
      actionDigest: input.commandDigest
    }),
    ownerUserId,
    actor: {
      class: "service_worker",
      actorId: input.actorId,
      sessionId,
      deviceId: null
    },
    capability: {
      kind: input.capabilityKind,
      capabilityId,
      actionDigest: input.commandDigest,
      state: "active",
      issuedAt: input.issuedAt,
      expiresAt: input.approvalDeadline
    },
    action: input.action,
    commandId: input.commandId,
    commandDigest: input.commandDigest,
    approvalDeadline: input.approvalDeadline,
    issuedAt: input.issuedAt,
    invalidationEpoch: "0",
    signature: "S".repeat(86)
  } as PeerCommandAuthorization;
}

const commandAuthorizer: PeerCommandAuthorizer = {
  publicKeyBase64Url: "P".repeat(43),
  authorityKeyId,
  async initialize() {
    return authorityState();
  },
  async authorize(input) {
    return {
      protocol: "forge-peer-command-authorization/v1",
      authorityKeyId,
      authorizationId: `pca_${input.commandId}`,
      ownerUserId: input.ownerUserId,
      actor: {
        class: input.approval.actorClass,
        actorId: input.approval.actorId,
        sessionId: input.approval.sessionId,
        deviceId: input.approval.deviceId
      },
      capability: {
        kind: "human_approval",
        capabilityId: input.approval.capabilityId,
        actionDigest: input.approval.actionDigest,
        state: "consumed",
        issuedAt: input.approval.capabilityIssuedAt,
        expiresAt: input.approval.capabilityExpiresAt
      },
      action: input.action,
      commandId: input.commandId,
      commandDigest: input.commandDigest,
      approvalDeadline: input.approvalDeadline,
      issuedAt: input.approval.authorizationIssuedAt,
      invalidationEpoch: "0",
      signature: "S".repeat(86)
    };
  },
  async authorizeQueryWorker(input) {
    return serviceAuthorization({
      ...input,
      actorId: input.workerId,
      capabilityKind: "query_worker"
    });
  },
  async authorizeRevocationConsumer(input) {
    return serviceAuthorization({
      ...input,
      actorId: input.consumerId,
      capabilityKind: "revocation_consumer"
    });
  }
};

type TestHandler = (
  request: Record<string, unknown>
) => unknown | Buffer | typeof STALL | Promise<unknown | Buffer | typeof STALL>;

type TestServer = {
  socketPath: string;
  setSocketMode(mode: number): Promise<void>;
  close(): Promise<void>;
};

function encodeFrame(value: unknown) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(IPC_HEADER_BYTES);
  header.write("FGP1", 0, "ascii");
  header[4] = 2;
  header[5] = 0;
  header.writeUInt32BE(body.length, 6);
  return Buffer.concat([header, body]);
}

function decodeRequest(frame: Buffer) {
  assert.equal(frame.subarray(0, 4).toString("ascii"), "FGP1");
  assert.equal(frame[4], 2);
  assert.equal(frame[5], 0);
  const bodyLength = frame.readUInt32BE(6);
  assert.equal(frame.length, IPC_HEADER_BYTES + bodyLength);
  return JSON.parse(
    frame.subarray(IPC_HEADER_BYTES).toString("utf8")
  ) as Record<string, unknown>;
}

async function startServer(handler: TestHandler): Promise<TestServer> {
  const temporaryRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(
    path.join(temporaryRoot, "forge-peer-ipc-test-")
  );
  await chmod(directory, 0o700);
  const socketPath = path.join(directory, "peer.sock");
  const sockets = new Set<Socket>();
  const server: Server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("end", () => {
      void Promise.resolve(handler(decodeRequest(Buffer.concat(chunks))))
        .then((response) => {
          if (response === STALL || socket.destroyed) return;
          socket.end(
            Buffer.isBuffer(response) ? response : encodeFrame(response)
          );
        })
        .catch(() => socket.destroy());
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await chmod(socketPath, 0o600);
  return {
    socketPath,
    setSocketMode: (mode) => chmod(socketPath, mode),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(directory, { recursive: true, force: true });
    }
  };
}

function provenance(relationshipId: string | null = null) {
  return {
    protocolVersion: "forge-peer/1",
    ownerUserId,
    relationshipId,
    localPrincipalId: "principal_peer_ipc_local",
    localDeviceId: "device_peer_ipc_local",
    remotePrincipalId:
      relationshipId === null ? null : "principal_peer_ipc_remote",
    remoteDeviceId: relationshipId === null ? null : "device_peer_ipc_remote",
    evidenceHash: "a".repeat(64),
    authenticatedAt: "2026-07-15T12:00:00.000Z"
  };
}

function canonicalJson(value: unknown): string {
  const canonical = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(canonical);
    if (candidate !== null && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, nested]) => [key, canonical(nested)])
      );
    }
    return candidate;
  };
  return JSON.stringify(canonical(value));
}

function daemonEvidence(
  statementType: "command_receipt" | "revocation_event_page",
  statement: unknown,
  overrides: Partial<{
    statementHash: string;
    ownerUserId: string;
    signature: string;
  }> = {}
) {
  const statementHash = createHash("sha256")
    .update("forge-peer/daemon-statement/v1\0", "utf8")
    .update(statementType, "utf8")
    .update("\0", "utf8")
    .update(canonicalJson(statement), "utf8")
    .digest("hex");
  const unsigned = {
    protocol: "forge-peer-daemon-evidence/v1" as const,
    statementType,
    statementHash: overrides.statementHash ?? statementHash,
    ownerUserId: overrides.ownerUserId ?? ownerUserId,
    localPrincipalId: daemonPrincipalId,
    localDeviceId: daemonDeviceId,
    signingCertificateHash: daemonCertificateHash,
    issuedAt: "2026-07-15T12:04:00.000Z"
  };
  return {
    ...unsigned,
    signature:
      overrides.signature ??
      signBytes(
        null,
        Buffer.concat([
          Buffer.from("forge-peer/daemon-evidence-signature/v1\0", "utf8"),
          Buffer.from(canonicalJson(unsigned), "utf8")
        ]),
        daemonKeyPair.privateKey
      ).toString("base64url")
  };
}

function pinnedIdentityResponse(requestId: unknown) {
  return {
    type: "local_identity",
    requestId,
    identity: {
      principal: {
        id: daemonPrincipalId,
        rootPublicKey: Buffer.alloc(32, 1).toString("base64url"),
        trustState: "verified",
        certificateHash: daemonCertificateHash
      },
      device: {
        id: daemonDeviceId,
        principalId: daemonPrincipalId,
        signingPublicKey: daemonSigningPublicKey,
        keyAgreementPublicKey: Buffer.alloc(32, 3).toString("base64url"),
        certificateSerial: "1",
        certificate: pairingCertificate(4),
        certificateHash: daemonCertificateHash,
        capabilities: ["direct_stream", "query", "projection"],
        transportEndpoints: [
          { kind: "local_direct", host: "127.0.0.1", port: 44321 }
        ],
        status: "approved"
      },
      provenance: {
        ...provenance(),
        localPrincipalId: daemonPrincipalId,
        localDeviceId: daemonDeviceId
      }
    }
  };
}

function gateway(socketPath: string, timeoutMs = 1_000) {
  return new UnixSocketPeerCoreGateway({
    socketPath,
    ownerUserId,
    timeoutMs,
    commandAuthorizer,
    commandJournal: null
  });
}

function commandAuthorizationProvenance() {
  return {
    authorityKeyId,
    authorizationId: "pca_command_peer_ipc_receipt_0001",
    actorClass: approval.actorClass,
    actorId: approval.actorId,
    actorDeviceId: approval.deviceId,
    sessionId: approval.sessionId,
    capabilityId: approval.capabilityId,
    actionDigest: approval.actionDigest,
    invalidationEpoch: "0",
    authorityStateHash: peerCommandAuthorityStateHash(authorityState()),
    verifiedAt: "2026-07-15T12:03:00.000Z"
  };
}

function serviceAuthorizationProvenance(
  authorization: PeerCommandAuthorization,
  verifiedAt = "2026-07-15T12:03:00.000Z"
) {
  return {
    authorityKeyId: authorization.authorityKeyId,
    authorizationId: authorization.authorizationId,
    actorClass: authorization.actor.class,
    actorId: authorization.actor.actorId,
    actorDeviceId: authorization.actor.deviceId,
    sessionId: authorization.actor.sessionId,
    capabilityId: authorization.capability.capabilityId,
    actionDigest: authorization.capability.actionDigest,
    invalidationEpoch: authorization.invalidationEpoch,
    authorityStateHash: peerCommandAuthorityStateHash(authorityState()),
    verifiedAt
  };
}

function signedCommandReceipt(input: {
  commandId: string;
  operation:
    | "claim_inbound_query"
    | "respond_inbound_query"
    | "ack_revocation_events";
  approvalDeadline: string;
  authorization: PeerCommandAuthorization;
  result: unknown;
  requestHash: string;
}) {
  const statement = {
    commandId: input.commandId,
    operation: input.operation,
    requestHash: input.requestHash,
    approvalDeadline: input.approvalDeadline,
    committedAt: "2026-07-15T12:04:00.000Z",
    authorization: serviceAuthorizationProvenance(input.authorization),
    result: input.result
  };
  return {
    ...statement,
    evidence: daemonEvidence("command_receipt", statement)
  };
}

function pairingCertificate(fill: number) {
  return Buffer.alloc(96, fill).toString("base64url");
}

async function expectIpcError(
  promise: Promise<unknown>,
  code: PeerCoreIpcError["code"]
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PeerCoreIpcError);
    assert.equal(error.code, code);
    return true;
  });
}

test("assembled app imports with the strict peer receipt schema", async () => {
  const app = await import("../app.js");
  assert.equal(typeof app.buildServer, "function");
});

test("health accepts one owner-bound, authenticated response", async () => {
  const peer = await startServer((request) => ({
    type: "health",
    requestId: request.requestId,
    enabled: true,
    healthy: true,
    protocolVersion: "forge-peer/1",
    reason: null,
    provenance: provenance()
  }));
  try {
    assert.deepEqual(await gateway(peer.socketPath).health(), {
      enabled: true,
      healthy: true,
      protocolVersion: "forge-peer/1",
      reason: null
    });
  } finally {
    await peer.close();
  }
});

test("transport readiness reports configured and explicitly disabled providers", async () => {
  const checkedAt = Date.parse("2026-07-15T12:00:00.000Z") / 1_000;
  const peer = await startServer((request) => ({
    type: "transport_readiness",
    requestId: request.requestId,
    transports: [
      {
        kind: "local_direct",
        state: "ready",
        detailCode: "operational",
        checkedAt
      },
      {
        kind: "tor_onion",
        state: "degraded",
        detailCode: "restart_backoff",
        checkedAt
      }
    ],
    provenance: provenance()
  }));
  try {
    assert.deepEqual(
      await gateway(peer.socketPath).transportReadiness({ ownerUserId }),
      {
        providers: [
          {
            kind: "local_direct",
            configured: true,
            state: "ready",
            detailCode: "operational",
            checkedAt: "2026-07-15T12:00:00.000Z"
          },
          {
            kind: "iroh",
            configured: false,
            state: "disabled",
            detailCode: "not_configured",
            checkedAt: null
          },
          {
            kind: "tor_onion",
            configured: true,
            state: "degraded",
            detailCode: "restart_backoff",
            checkedAt: "2026-07-15T12:00:00.000Z"
          },
          {
            kind: "http_mailbox",
            configured: false,
            state: "disabled",
            detailCode: "not_configured",
            checkedAt: null
          }
        ],
        provenance: provenance()
      }
    );
  } finally {
    await peer.close();
  }
});

test("local identity requires the exact owner, certificate, and provenance", async () => {
  const principalId = "1".repeat(64);
  const deviceId = "2".repeat(32);
  let substitutedDevice = false;
  const peer = await startServer((request) => ({
    type: "local_identity",
    requestId: request.requestId,
    identity: {
      principal: {
        id: principalId,
        rootPublicKey: Buffer.alloc(32, 1).toString("base64url"),
        trustState: "verified",
        certificateHash: "3".repeat(64)
      },
      device: {
        id: substitutedDevice ? "f".repeat(32) : deviceId,
        principalId,
        signingPublicKey: Buffer.alloc(32, 2).toString("base64url"),
        keyAgreementPublicKey: Buffer.alloc(32, 3).toString("base64url"),
        certificateSerial: "1",
        certificate: pairingCertificate(4),
        certificateHash: "3".repeat(64),
        capabilities: ["direct_stream", "iroh", "query"],
        transportEndpoints: [
          { kind: "local_direct", host: "127.0.0.1", port: 44321 }
        ],
        status: "approved"
      },
      provenance: {
        ...provenance(),
        localPrincipalId: principalId,
        localDeviceId: deviceId
      }
    }
  }));
  try {
    const identity = await gateway(peer.socketPath).localIdentity({
      ownerUserId
    });
    assert.equal(identity.principal.id, principalId);
    assert.equal(identity.device.id, deviceId);
    substitutedDevice = true;
    await expectIpcError(
      gateway(peer.socketPath).localIdentity({ ownerUserId }),
      "authentication_failed"
    );
  } finally {
    await peer.close();
  }
});

test("invitation creation preserves the command and verifies backup bytes", async () => {
  const ciphertext = Buffer.from("encrypted invitation backup", "utf8");
  const nonce = Buffer.alloc(24, 7);
  const observed: { current: Record<string, unknown> | null } = {
    current: null
  };
  const peer = await startServer((request) => {
    observed.current = request;
    return {
      type: "invitation_created",
      requestId: request.requestId,
      material: {
        invitation: {
          id: "invite_peer_ipc_test",
          ownerUserId,
          inviterPrincipalId: "principal_peer_ipc_local",
          inviterDeviceId: "device_peer_ipc_local",
          fingerprint: "ABCD-EFGH-JKLM-NPQR",
          expiresAt: "2026-07-15T12:10:00.000Z",
          protocolVersion: "forge-peer/1",
          transportKinds: ["iroh"],
          bootstrap: "B".repeat(48),
          signature: "S".repeat(86)
        },
        bootstrapCiphertext: ciphertext.toString("base64url"),
        bootstrapNonce: nonce.toString("base64url"),
        bootstrapHash: createHash("sha256").update(ciphertext).digest("hex"),
        provenance: provenance()
      }
    };
  });
  try {
    const result = await gateway(peer.socketPath).createInvitation({
      commandId: "command_peer_ipc_create_0001",
      approvalDeadline,
      approval,
      ownerUserId,
      label: "Jon's Forge",
      expiresAt: "2026-07-15T12:10:00.000Z",
      privacyMode: "hide_network_address",
      transportKinds: ["iroh"]
    });
    assert.equal(observed.current?.type, "create_invitation");
    assert.equal(observed.current?.commandId, "command_peer_ipc_create_0001");
    assert.equal(observed.current?.approvalDeadline, approvalDeadline);
    assert.deepEqual(Buffer.from(result.bootstrapCiphertext), ciphertext);
    assert.deepEqual(Buffer.from(result.bootstrapNonce), nonce);
  } finally {
    await peer.close();
  }
});

test("command receipts require exact command and bounded commit metadata", async () => {
  let mode:
    | "valid"
    | "missing_result"
    | "late"
    | "substituted"
    | "forged"
    | "stale_authority"
    | "tampered_result" = "valid";
  const commandId = "command_peer_ipc_receipt_0001";
  const peer = await startServer((request) => {
    if (request.type === "local_identity") {
      return pinnedIdentityResponse(request.requestId);
    }
    assert.equal(request.type, "command_receipt");
    const authorization = commandAuthorizationProvenance();
    if (mode === "stale_authority") {
      authorization.authorityStateHash = "d".repeat(64);
    }
    const receipt: Record<string, unknown> = {
      commandId:
        mode === "substituted" ? "command_peer_ipc_receipt_other" : commandId,
      operation: "create_invitation",
      requestHash: "b".repeat(64),
      approvalDeadline,
      committedAt:
        mode === "late"
          ? "2026-07-15T12:06:00.000Z"
          : "2026-07-15T12:04:00.000Z",
      authorization,
      result: { invitationId: "invite_receipt" }
    };
    if (mode === "missing_result") delete receipt.result;
    receipt.evidence = daemonEvidence("command_receipt", receipt, {
      signature:
        mode === "forged"
          ? Buffer.alloc(64, 9).toString("base64url")
          : undefined
    });
    if (mode === "tampered_result") {
      receipt.result = { invitationId: "invite_tampered" };
    }
    return {
      type: "command_receipt",
      requestId: request.requestId,
      receipt
    };
  });
  try {
    const receipt = await gateway(peer.socketPath).commandReceipt({
      ownerUserId,
      commandId
    });
    assert.equal(receipt.commandId, commandId);
    assert.equal(receipt.operation, "create_invitation");
    assert.equal(receipt.requestHash, "b".repeat(64));
    assert.equal(receipt.approvalDeadline, approvalDeadline);
    assert.equal(receipt.committedAt, "2026-07-15T12:04:00.000Z");
    assert.deepEqual(receipt.authorization, commandAuthorizationProvenance());
    assert.deepEqual(receipt.result, { invitationId: "invite_receipt" });
    assert.equal(receipt.evidence?.statementType, "command_receipt");
    mode = "missing_result";
    await expectIpcError(
      gateway(peer.socketPath).commandReceipt({ ownerUserId, commandId }),
      "protocol"
    );
    mode = "late";
    await expectIpcError(
      gateway(peer.socketPath).commandReceipt({ ownerUserId, commandId }),
      "authentication_failed"
    );
    mode = "substituted";
    await expectIpcError(
      gateway(peer.socketPath).commandReceipt({ ownerUserId, commandId }),
      "authentication_failed"
    );
    mode = "forged";
    await expectIpcError(
      gateway(peer.socketPath).commandReceipt({ ownerUserId, commandId }),
      "authentication_failed"
    );
    mode = "stale_authority";
    await expectIpcError(
      gateway(peer.socketPath).commandReceipt({ ownerUserId, commandId }),
      "authentication_failed"
    );
    mode = "tampered_result";
    await expectIpcError(
      gateway(peer.socketPath).commandReceipt({ ownerUserId, commandId }),
      "authentication_failed"
    );
  } finally {
    await peer.close();
  }
});

test("query-worker commands use active service capabilities and durable duplicate receipts", async () => {
  const workerId = "query_worker_peer_ipc";
  const relationshipId = "4".repeat(32);
  const requester = {
    principalId: "principal_peer_ipc_remote",
    deviceId: "device_peer_ipc_remote",
    relationshipId
  };
  const query = {
    projectionId: "calendar.availability.v1" as const,
    parameters: {},
    interval: {
      startsAt: "2026-07-15T12:00:00.000Z",
      endsAt: "2026-07-15T13:00:00.000Z",
      timeZone: "UTC"
    },
    entityIds: [] as string[],
    fields: ["start", "end"] as const,
    precision: "exact" as const,
    maximumResultCount: 4
  };
  const authenticatedProvenance = {
    ...provenance(relationshipId),
    localPrincipalId: daemonPrincipalId,
    localDeviceId: daemonDeviceId
  };
  const claimResult = {
    claim: {
      claimId: "5".repeat(32),
      queryId: "6".repeat(32),
      relationshipId,
      requester,
      query,
      entityIdsAreOpaque: false,
      intervalTimeZoneAuthenticated: true,
      grantId: "grant_peer_ipc_query",
      grantSequence: "7",
      grantVerificationId: "verification_peer_ipc_query",
      verifiedGrantHash: "7".repeat(64),
      ruleId: "rule_peer_ipc_query",
      maximumPayloadBytes: 4_096,
      redactedFields: ["eventTitle"],
      receivedAt: "2026-07-15T12:00:00.000Z",
      expiresAt: "2026-07-15T12:10:00.000Z",
      leaseExpiresAt: "2026-07-15T12:06:00.000Z"
    },
    provenance: authenticatedProvenance
  };
  const responseResult = {
    queryId: claimResult.claim.queryId,
    envelopeId: "envelope_peer_ipc_query",
    provenance: authenticatedProvenance
  };
  const receipts = new Map<string, ReturnType<typeof signedCommandReceipt>>();
  let tamperClaimReceiptRequestHash = false;
  let claimCommits = 0;
  let responseCommits = 0;
  const peer = await startServer((request) => {
    if (request.type === "local_identity") {
      return pinnedIdentityResponse(request.requestId);
    }
    if (request.type === "command_receipt") {
      const input = request.input as { commandId: string };
      const receipt = receipts.get(input.commandId);
      assert.ok(receipt);
      if (
        tamperClaimReceiptRequestHash &&
        receipt.operation === "claim_inbound_query"
      ) {
        const statement = {
          commandId: receipt.commandId,
          operation: receipt.operation,
          requestHash: "f".repeat(64),
          approvalDeadline: receipt.approvalDeadline,
          committedAt: receipt.committedAt,
          authorization: receipt.authorization,
          result: receipt.result
        };
        return {
          type: "command_receipt",
          requestId: request.requestId,
          receipt: {
            ...statement,
            evidence: daemonEvidence("command_receipt", statement)
          }
        };
      }
      return {
        type: "command_receipt",
        requestId: request.requestId,
        receipt
      };
    }
    assert.ok(
      request.type === "claim_inbound_query" ||
        request.type === "respond_inbound_query"
    );
    assert.equal(request.authorizationContext, undefined);
    assert.equal(request.queryWorkerAuthorizationContext, undefined);
    const authorization = request.authorization as PeerCommandAuthorization;
    assert.equal(authorization.actor.class, "service_worker");
    assert.equal(authorization.actor.actorId, workerId);
    assert.equal(authorization.capability.kind, "query_worker");
    assert.equal(authorization.capability.state, "active");
    const commandId = request.commandId as string;
    let receipt = receipts.get(commandId);
    if (!receipt) {
      const result =
        request.type === "claim_inbound_query" ? claimResult : responseResult;
      receipt = signedCommandReceipt({
        commandId,
        operation: request.type,
        approvalDeadline: request.approvalDeadline as string,
        authorization,
        result,
        requestHash: peerCommandRequestHash(request)
      });
      receipts.set(commandId, receipt);
      if (request.type === "claim_inbound_query") claimCommits += 1;
      else responseCommits += 1;
    }
    return {
      type:
        request.type === "claim_inbound_query"
          ? "inbound_query_claimed"
          : "inbound_query_responded",
      requestId: request.requestId,
      result: receipt.result
    };
  });
  try {
    const queryGateway = gateway(peer.socketPath);
    const claimInput = {
      commandId: "command_peer_query_claim_0001",
      approvalDeadline,
      authorizationIssuedAt: "2026-07-15T12:00:00.000Z",
      ownerUserId,
      workerId,
      leaseMs: 5_000
    };
    const firstClaim = await queryGateway.claimInboundQuery(claimInput);
    const duplicateClaim = await queryGateway.claimInboundQuery(claimInput);
    assert.deepEqual(duplicateClaim, firstClaim);
    assert.deepEqual(firstClaim.claim?.query.fields, ["start", "end"]);

    const responseInput = {
      commandId: "command_peer_query_respond_0001",
      approvalDeadline,
      authorizationIssuedAt: "2026-07-15T12:01:00.000Z",
      ownerUserId,
      workerId,
      claimId: claimResult.claim.claimId,
      queryId: claimResult.claim.queryId,
      payload: {
        records: [
          {
            recordId: "calendar_peer_ipc",
            fields: {
              start: "2026-07-15T12:15:00.000Z",
              end: "2026-07-15T12:45:00.000Z"
            }
          }
        ]
      },
      asOf: "2026-07-15T12:01:00.000Z",
      completeness: "complete" as const,
      redactedFields: ["eventTitle"]
    };
    const firstResponse = await queryGateway.respondInboundQuery(responseInput);
    const duplicateResponse =
      await queryGateway.respondInboundQuery(responseInput);
    assert.deepEqual(duplicateResponse, firstResponse);
    assert.equal(firstResponse.queryId, claimResult.claim.queryId);
    assert.equal(claimCommits, 1);
    assert.equal(responseCommits, 1);

    tamperClaimReceiptRequestHash = true;
    await expectIpcError(
      queryGateway.claimInboundQuery(claimInput),
      "authentication_failed"
    );
  } finally {
    await peer.close();
  }
});

test("revocation pages and acknowledgements require signed owner-bound durable evidence", async () => {
  const consumerId = "revocation_consumer_peer_ipc";
  const relationshipId = "8".repeat(32);
  const event = {
    cursor: "1",
    eventHash: "9".repeat(64),
    previousEventHash: "0".repeat(64),
    kind: "grant" as const,
    source: "local_operator" as const,
    relationshipId,
    grantId: "grant_peer_ipc_revoked",
    deviceId: null,
    targetCertificate: null,
    targetCertificateHash: null,
    targetCertificateSerial: null,
    reason: "Grant revoked by its owner",
    occurredAt: "2026-07-15T11:59:00.000Z",
    authenticatedRemotePrincipalId: null,
    authenticatedRemoteDeviceId: null,
    signingDeviceId: daemonDeviceId,
    signingCertificate: pairingCertificate(9),
    signingCertificateHash: daemonCertificateHash,
    signature: Buffer.alloc(64, 10).toString("base64url")
  };
  const pageStatement = {
    events: [event],
    acknowledgedCursor: "0",
    nextCursor: "1",
    hasMore: false,
    provenance: {
      ...provenance(),
      localPrincipalId: daemonPrincipalId,
      localDeviceId: daemonDeviceId
    }
  };
  const receipts = new Map<string, ReturnType<typeof signedCommandReceipt>>();
  let tamperPageAfterSigning = false;
  let ackCommits = 0;
  const peer = await startServer((request) => {
    if (request.type === "local_identity") {
      return pinnedIdentityResponse(request.requestId);
    }
    if (request.type === "list_revocation_events") {
      const page = {
        ...structuredClone(pageStatement),
        evidence: daemonEvidence("revocation_event_page", pageStatement)
      };
      if (tamperPageAfterSigning) {
        page.events[0]!.reason = "Tampered after daemon signature";
      }
      return {
        type: "revocation_events_listed",
        requestId: request.requestId,
        page
      };
    }
    if (request.type === "command_receipt") {
      const input = request.input as { commandId: string };
      const receipt = receipts.get(input.commandId);
      assert.ok(receipt);
      return {
        type: "command_receipt",
        requestId: request.requestId,
        receipt
      };
    }
    assert.equal(request.type, "ack_revocation_events");
    const authorization = request.authorization as PeerCommandAuthorization;
    assert.equal(authorization.actor.class, "service_worker");
    assert.equal(authorization.actor.actorId, consumerId);
    assert.equal(authorization.capability.kind, "revocation_consumer");
    assert.equal(authorization.capability.state, "active");
    const input = request.input as {
      throughCursor: string;
      eventHash: string;
    };
    const result = {
      consumerId,
      acknowledgedCursor: input.throughCursor,
      eventHash: input.eventHash,
      acknowledgedAt: "2026-07-15T12:04:00.000Z",
      provenance: pageStatement.provenance
    };
    const commandId = request.commandId as string;
    let receipt = receipts.get(commandId);
    if (!receipt) {
      receipt = signedCommandReceipt({
        commandId,
        operation: "ack_revocation_events",
        approvalDeadline: request.approvalDeadline as string,
        authorization,
        result,
        requestHash: peerCommandRequestHash(request)
      });
      receipts.set(commandId, receipt);
      ackCommits += 1;
    }
    return {
      type: "revocation_events_acknowledged",
      requestId: request.requestId,
      result: receipt.result
    };
  });
  try {
    const revocationGateway = gateway(peer.socketPath);
    const page = await revocationGateway.listRevocationEvents({
      ownerUserId,
      consumerId,
      afterCursor: "0",
      limit: 64
    });
    assert.equal(page.events[0]?.eventHash, event.eventHash);
    const ackInput = {
      commandId: "command_peer_revocation_ack_0001",
      approvalDeadline,
      authorizationIssuedAt: "2026-07-15T12:01:00.000Z",
      ownerUserId,
      consumerId,
      throughCursor: page.nextCursor,
      eventHash: event.eventHash
    };
    const firstAck = await revocationGateway.ackRevocationEvents(ackInput);
    const duplicateAck = await revocationGateway.ackRevocationEvents(ackInput);
    assert.deepEqual(duplicateAck, firstAck);
    assert.equal(ackCommits, 1);

    tamperPageAfterSigning = true;
    await expectIpcError(
      revocationGateway.listRevocationEvents({
        ownerUserId,
        consumerId,
        afterCursor: "0",
        limit: 64
      }),
      "authentication_failed"
    );
  } finally {
    await peer.close();
  }
});

test("management mutations bind canceled and accepted records to provenance", async () => {
  const relationshipId = "relationship_peer_ipc";
  const pendingRequest = {
    id: "pending_peer_ipc_0001",
    ownerUserId,
    relationshipId,
    kind: "device" as const,
    status: "pending" as const,
    version: 1,
    payload: { deviceId: "device_peer_ipc_remote" },
    payloadHash: "b".repeat(64),
    expiresAt: "2026-07-15T12:10:00.000Z",
    decidedAt: null,
    decisionReason: "",
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z"
  };
  const peer = await startServer((request) => {
    if (request.type === "cancel_invitation") {
      const input = request.input as { invitationId: string };
      return {
        type: "invitation_canceled",
        requestId: request.requestId,
        result: {
          invitationId: input.invitationId,
          provenance: provenance()
        }
      };
    }
    assert.equal(request.type, "accept_pending_request");
    return {
      type: "pending_request_accepted",
      requestId: request.requestId,
      result: {
        requestId: pendingRequest.id,
        kind: pendingRequest.kind,
        provenance: provenance(relationshipId)
      }
    };
  });
  try {
    await gateway(peer.socketPath).cancelInvitation({
      commandId: "command_peer_ipc_cancel_0001",
      approvalDeadline,
      approval,
      ownerUserId,
      invitationId: "invite_peer_ipc_0001"
    });
    await gateway(peer.socketPath).acceptPendingRequest({
      commandId: "command_peer_ipc_pending_001",
      approvalDeadline,
      approval,
      ownerUserId,
      request: pendingRequest
    });
  } finally {
    await peer.close();
  }
});

test("pairing confirmation accepts exact identities and rejects substitution", async () => {
  const localPrincipalId = "1".repeat(64);
  const remotePrincipalId = "2".repeat(64);
  const localDeviceId = "3".repeat(32);
  const remoteDeviceId = "4".repeat(32);
  const relationshipId = "5".repeat(32);
  const transcriptHash = "6".repeat(64);
  const phraseHash = "7".repeat(64);
  const requestPayload = {
    protocolVersion: "forge-peer/1" as const,
    invitationId: "8".repeat(32),
    transcriptHash,
    verificationPhrase: "amber cedar river",
    verificationPhraseHash: phraseHash,
    localPrincipalId,
    localDeviceId,
    remotePrincipalId,
    remoteDeviceId,
    stateBinding: "9".repeat(64)
  };
  let substituteRemoteDevice = false;
  const peer = await startServer((request) => ({
    type: "pairing_confirmed",
    requestId: request.requestId,
    confirmation: {
      relationship: {
        id: relationshipId,
        localPrincipal: {
          id: localPrincipalId,
          rootPublicKey: Buffer.alloc(32, 1).toString("base64url"),
          trustState: "verified",
          certificateHash: "a".repeat(64)
        },
        remotePrincipal: {
          id: remotePrincipalId,
          rootPublicKey: Buffer.alloc(32, 2).toString("base64url"),
          trustState: "verified",
          certificateHash: "b".repeat(64)
        },
        localDevice: {
          id: localDeviceId,
          principalId: localPrincipalId,
          signingPublicKey: Buffer.alloc(32, 3).toString("base64url"),
          keyAgreementPublicKey: Buffer.alloc(32, 4).toString("base64url"),
          certificateSerial: "1",
          certificate: pairingCertificate(7),
          certificateHash: "a".repeat(64),
          capabilities: ["direct_stream", "iroh", "query"],
          transportEndpoints: [
            { kind: "local_direct", host: "127.0.0.1", port: 44321 }
          ],
          status: "approved"
        },
        remoteDevice: {
          id: substituteRemoteDevice ? "f".repeat(32) : remoteDeviceId,
          principalId: remotePrincipalId,
          signingPublicKey: Buffer.alloc(32, 5).toString("base64url"),
          keyAgreementPublicKey: Buffer.alloc(32, 6).toString("base64url"),
          certificateSerial: "1",
          certificate: pairingCertificate(8),
          certificateHash: "b".repeat(64),
          capabilities: ["direct_stream", "iroh", "query"],
          transportEndpoints: [
            {
              kind: "iroh",
              endpointId: Buffer.alloc(32, 9).toString("base64url"),
              relayOrigin: "https://relay.example"
            }
          ],
          status: "approved"
        },
        negotiatedProtocolVersion: "forge-peer/1",
        verificationPhraseHash: phraseHash,
        privacyMode: "hide_network_address"
      },
      outboundEnvelope: null,
      provenance: {
        ...provenance(relationshipId),
        localPrincipalId,
        localDeviceId,
        remotePrincipalId,
        remoteDeviceId
      }
    }
  }));
  const input = {
    commandId: "command_peer_ipc_pairing_0001",
    approvalDeadline,
    approval,
    ownerUserId,
    pairingId: "c".repeat(32),
    requestPayload,
    transcriptHash,
    verificationPhrase: requestPayload.verificationPhrase
  };
  try {
    const confirmation = await gateway(peer.socketPath).confirmPairing(input);
    assert.equal(confirmation.relationship.id, relationshipId);
    substituteRemoteDevice = true;
    await expectIpcError(
      gateway(peer.socketPath).confirmPairing({
        ...input,
        commandId: "command_peer_ipc_pairing_0002"
      }),
      "authentication_failed"
    );
  } finally {
    await peer.close();
  }
});

test("owner mismatch is rejected before any socket operation", async () => {
  const peer = await startServer(() => STALL);
  try {
    await expectIpcError(
      gateway(peer.socketPath).createInvitation({
        commandId: "command_peer_ipc_wrong_owner",
        approvalDeadline,
        approval,
        ownerUserId: "user_someone_else",
        label: "Wrong owner",
        expiresAt: "2026-07-15T12:10:00.000Z",
        privacyMode: "fastest",
        transportKinds: ["local_direct"]
      }),
      "authorization_failed"
    );
  } finally {
    await peer.close();
  }
});

test("typed daemon rejection is preserved without exposing its detail", async () => {
  const peer = await startServer((request) => ({
    type: "rejected",
    requestId: request.requestId,
    code: "conflict",
    detail: "internal relationship state"
  }));
  try {
    await expectIpcError(
      gateway(peer.socketPath).requestResync({
        commandId: "command_peer_ipc_resync_0001",
        approvalDeadline,
        approval,
        ownerUserId,
        relationshipId: "relationship_peer_ipc",
        projectionIds: []
      }),
      "conflict"
    );
  } finally {
    await peer.close();
  }
});

test("an insecure socket mode is rejected", async () => {
  const peer = await startServer(() => STALL);
  try {
    await peer.setSocketMode(0o666);
    await expectIpcError(
      gateway(peer.socketPath).requestResync({
        commandId: "command_peer_ipc_mode_0001",
        approvalDeadline,
        approval,
        ownerUserId,
        relationshipId: "relationship_peer_ipc",
        projectionIds: []
      }),
      "socket_security"
    );
  } finally {
    await peer.close();
  }
});

test("request id substitution is rejected", async () => {
  const peer = await startServer(() => ({
    type: "health",
    requestId: "req_substituted",
    enabled: true,
    healthy: true,
    protocolVersion: "forge-peer/1",
    reason: null,
    provenance: provenance()
  }));
  try {
    const result = await gateway(peer.socketPath).health();
    assert.equal(result.healthy, false);
    assert.equal(result.protocolVersion, null);
  } finally {
    await peer.close();
  }
});

test("trailing response bytes are rejected", async () => {
  const peer = await startServer((request) =>
    Buffer.concat([
      encodeFrame({
        type: "resync_requested",
        requestId: request.requestId,
        result: {
          envelopeIds: [],
          provenance: provenance("relationship_peer_ipc")
        }
      }),
      Buffer.from([0])
    ])
  );
  try {
    await expectIpcError(
      gateway(peer.socketPath).requestResync({
        commandId: "command_peer_ipc_trailing_001",
        approvalDeadline,
        approval,
        ownerUserId,
        relationshipId: "relationship_peer_ipc",
        projectionIds: []
      }),
      "protocol"
    );
  } finally {
    await peer.close();
  }
});

test("an oversized declared response is rejected before allocation", async () => {
  const peer = await startServer(() => {
    const header = Buffer.alloc(IPC_HEADER_BYTES);
    header.write("FGP1", 0, "ascii");
    header[4] = 2;
    header[5] = 0;
    header.writeUInt32BE(MAX_IPC_BODY_BYTES + 1, 6);
    return header;
  });
  try {
    await expectIpcError(
      gateway(peer.socketPath).requestResync({
        commandId: "command_peer_ipc_oversize_001",
        approvalDeadline,
        approval,
        ownerUserId,
        relationshipId: "relationship_peer_ipc",
        projectionIds: []
      }),
      "protocol"
    );
  } finally {
    await peer.close();
  }
});

test("a stalled daemon is bounded by the caller timeout", async () => {
  const peer = await startServer(() => STALL);
  try {
    const startedAt = Date.now();
    await expectIpcError(
      gateway(peer.socketPath, 100).requestResync({
        commandId: "command_peer_ipc_timeout_0001",
        approvalDeadline,
        approval,
        ownerUserId,
        relationshipId: "relationship_peer_ipc",
        projectionIds: []
      }),
      "timeout"
    );
    assert.ok(Date.now() - startedAt < 1_000);
  } finally {
    await peer.close();
  }
});
