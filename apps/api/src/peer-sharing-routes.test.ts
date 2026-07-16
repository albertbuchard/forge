import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase
} from "./db.js";
import type { AuthContext } from "./managers/contracts.js";
import { AuthorizationManager } from "./managers/platform/authorization-manager.js";
import { SecretsManager } from "./managers/platform/secrets-manager.js";
import { PEER_ROUTE_CONTRACTS } from "./peer-route-contract.js";
import {
  recordPeerPresenceAudit,
  SqlitePeerPresenceStore
} from "./repositories/peer-presence.js";
import { createPeerPendingRequest } from "./repositories/peer-sharing.js";
import { getDefaultUser } from "./repositories/users.js";
import {
  registerPeerSharingRoutes,
  type PeerSharingRouteDependencies
} from "./routes/peer-sharing.js";
import {
  type PeerCoreGateway,
  type PeerCoreHealth,
  type PeerDaemonCommandReceipt,
  type PeerInvitationMaterial,
  UnavailablePeerCoreGateway
} from "./services/peer-core-gateway.js";
import {
  digestPeerPresenceAction,
  issuePeerPresenceCapability,
  peerPresenceCapabilityCookie,
  type PeerPresenceAction,
  type PeerPresencePrincipal
} from "./services/peer-human-presence.js";
import { derivePeerCommandAuthorizationId } from "./services/peer-command-authorization.js";
import { peerWebAuthnCredentialSetVersion } from "./services/peer-webauthn.js";

const fixedNow = new Date("2026-07-15T12:00:00.000Z");
const origin = "http://127.0.0.1";

function operatorContext(): AuthContext {
  return {
    now: fixedNow,
    correlationId: null,
    requestId: null,
    origin,
    host: "127.0.0.1",
    ip: "127.0.0.1",
    actor: "Peer route test",
    source: "ui",
    token: null,
    scope: { userIds: [], projectIds: [], tagIds: [] },
    session: {
      id: "session_peer_route_test",
      actorLabel: "Operator",
      expiresAt: "2026-07-15T13:00:00.000Z"
    }
  };
}

function agentContext(ownerUserId: string): AuthContext {
  return {
    ...operatorContext(),
    actor: "Peer route agent test",
    source: "agent",
    session: null,
    token: {
      id: "token_peer_route_test",
      agentId: "agent_peer_route_test",
      agentLabel: "Peer test agent",
      scopes: ["peer:status", "peer:query", "peer:grants:manage"],
      trustLevel: "trusted",
      autonomyMode: "supervised",
      approvalMode: "required",
      bootstrapPolicy: {
        mode: "disabled",
        goalsLimit: 0,
        projectsLimit: 0,
        tasksLimit: 0,
        habitsLimit: 0,
        strategiesLimit: 0,
        peoplePageLimit: 0,
        includePeoplePages: false
      },
      scopePolicy: {
        userIds: [ownerUserId],
        projectIds: [],
        tagIds: []
      }
    }
  };
}

class HealthyInvitationGateway implements PeerCoreGateway {
  createInvitationCalls = 0;
  commandReceiptCalls = 0;
  readonly commandIds: string[] = [];
  readonly invitationExpiries: string[] = [];
  private readonly invitations = new Map<string, PeerInvitationMaterial>();
  private readonly receipts = new Map<
    string,
    {
      operation: PeerDaemonCommandReceipt["operation"];
      result: unknown;
      approvalDeadline: string;
      approval: Parameters<PeerCoreGateway["createInvitation"]>[0]["approval"];
    }
  >();

  protected recordReceipt(input: {
    commandId: string;
    operation: PeerDaemonCommandReceipt["operation"];
    result: unknown;
    approvalDeadline: string;
    approval: Parameters<PeerCoreGateway["createInvitation"]>[0]["approval"];
  }) {
    this.receipts.set(input.commandId, input);
  }

  async health(): Promise<PeerCoreHealth> {
    return {
      enabled: true,
      healthy: true,
      protocolVersion: "forge-peer/1",
      reason: null
    };
  }

  async localIdentity(): Promise<never> {
    throw new Error("not used");
  }

  async commandReceipt(
    input: Parameters<PeerCoreGateway["commandReceipt"]>[0]
  ): ReturnType<PeerCoreGateway["commandReceipt"]> {
    this.commandReceiptCalls += 1;
    const receipt = this.receipts.get(input.commandId);
    if (!receipt) {
      throw new Error("command receipt not found");
    }
    return {
      commandId: input.commandId,
      operation: receipt.operation,
      requestHash: "a".repeat(64),
      approvalDeadline: receipt.approvalDeadline,
      committedAt: fixedNow.toISOString(),
      authorization: {
        authorityKeyId: "a".repeat(43),
        authorizationId: derivePeerCommandAuthorizationId({
          commandId: input.commandId,
          capabilityId: receipt.approval.capabilityId,
          actionDigest: receipt.approval.actionDigest
        }),
        actorClass: receipt.approval.actorClass,
        actorId: receipt.approval.actorId,
        actorDeviceId: receipt.approval.deviceId,
        sessionId: receipt.approval.sessionId,
        capabilityId: receipt.approval.capabilityId,
        actionDigest: receipt.approval.actionDigest,
        invalidationEpoch: "0",
        authorityStateHash: "c".repeat(64),
        verifiedAt: receipt.approval.authorizationIssuedAt
      },
      result: receipt.result
    };
  }

  async syncCommandAuthorizationState(): Promise<never> {
    throw new Error("not used");
  }

  async createInvitation(
    input: Parameters<PeerCoreGateway["createInvitation"]>[0]
  ): Promise<PeerInvitationMaterial> {
    this.createInvitationCalls += 1;
    this.commandIds.push(input.commandId);
    this.invitationExpiries.push(input.expiresAt);
    const existing = this.invitations.get(input.commandId);
    if (existing) return existing;
    const material: PeerInvitationMaterial = {
      invitation: {
        id: `invite_${input.commandId.slice(-24)}`,
        ownerUserId: input.ownerUserId,
        inviterPrincipalId: "principal_peer_route_local",
        inviterDeviceId: "device_peer_route_local",
        fingerprint: "ABCD-EFGH-JKLM-NPQR",
        expiresAt: input.expiresAt,
        protocolVersion: "forge-peer/1",
        transportKinds: input.transportKinds as Array<
          "local_direct" | "iroh" | "tor_onion" | "http_mailbox"
        >,
        bootstrap: "B".repeat(48),
        signature: "S".repeat(86)
      },
      bootstrapCiphertext: new Uint8Array(48).fill(7),
      bootstrapNonce: new Uint8Array(24).fill(8),
      bootstrapHash: "a".repeat(64)
    };
    this.invitations.set(input.commandId, material);
    this.recordReceipt({
      commandId: input.commandId,
      operation: "create_invitation",
      result: material,
      approvalDeadline: input.approvalDeadline,
      approval: input.approval
    });
    return material;
  }

  async acceptInvitation(
    _input: Parameters<PeerCoreGateway["acceptInvitation"]>[0]
  ): ReturnType<PeerCoreGateway["acceptInvitation"]> {
    throw new Error("not used");
  }

  async confirmPairing(
    _input: Parameters<PeerCoreGateway["confirmPairing"]>[0]
  ): ReturnType<PeerCoreGateway["confirmPairing"]> {
    throw new Error("not used");
  }

  async signGrant(): Promise<never> {
    throw new Error("not used");
  }

  async acceptGrant(): Promise<never> {
    throw new Error("not used");
  }

  async updateDevice(): Promise<never> {
    throw new Error("not used");
  }

  async revokeRelationship(): Promise<never> {
    throw new Error("not used");
  }

  async requestResync(): Promise<never> {
    throw new Error("not used");
  }

  async executeQuery(): Promise<never> {
    throw new Error("not used");
  }
}

class TimeoutAfterInvitationGateway extends HealthyInvitationGateway {
  private timedOut = false;

  override async createInvitation(
    input: Parameters<PeerCoreGateway["createInvitation"]>[0]
  ): Promise<PeerInvitationMaterial> {
    const material = await super.createInvitation(input);
    if (!this.timedOut) {
      this.timedOut = true;
      throw new Error("simulated timeout after durable daemon application");
    }
    return material;
  }
}

class PairingAcceptanceGateway extends HealthyInvitationGateway {
  acceptInvitationCalls = 0;

  override async acceptInvitation(
    input: Parameters<PeerCoreGateway["acceptInvitation"]>[0]
  ) {
    this.acceptInvitationCalls += 1;
    const result = {
      requestId: `request_${input.commandId.slice(-24)}`,
      requestPayload: {
        invitationId: input.invitation.id,
        remoteFingerprint: input.invitation.fingerprint
      },
      expiresAt: new Date(fixedNow.getTime() + 5 * 60_000).toISOString()
    };
    this.recordReceipt({
      commandId: input.commandId,
      operation: "accept_invitation",
      result,
      approvalDeadline: input.approvalDeadline,
      approval: input.approval
    });
    return result;
  }
}

class PairingConfirmationGateway extends HealthyInvitationGateway {
  confirmPairingCalls = 0;

  override async confirmPairing(
    input: Parameters<PeerCoreGateway["confirmPairing"]>[0]
  ) {
    this.confirmPairingCalls += 1;
    const localPrincipal = {
      id: "principal_peer_route_local",
      rootPublicKey: "a".repeat(64),
      trustState: "verified" as const,
      certificateHash: "b".repeat(64)
    };
    const remotePrincipal = {
      id: "principal_peer_route_remote",
      rootPublicKey: "c".repeat(64),
      trustState: "verified" as const,
      certificateHash: "d".repeat(64)
    };
    const device = (id: string, principalId: string, fill: string) => ({
      id,
      principalId,
      signingPublicKey: fill.repeat(64),
      keyAgreementPublicKey: fill.repeat(64),
      certificateSerial: "1",
      certificate: fill.repeat(128),
      certificateHash: fill.repeat(64),
      capabilities: ["query" as const],
      transportEndpoints: [],
      status: "approved" as const
    });
    const result = {
      relationship: {
        id: "relationship_peer_route_confirmed",
        localPrincipal,
        remotePrincipal,
        localDevice: device("device_peer_route_local", localPrincipal.id, "e"),
        remoteDevice: device(
          "device_peer_route_remote",
          remotePrincipal.id,
          "f"
        ),
        negotiatedProtocolVersion: "forge-peer/1",
        verificationPhraseHash: "1".repeat(64),
        privacyMode: "fastest" as const
      },
      outboundEnvelope: new Uint8Array(32).fill(7),
      provenance: {
        protocolVersion: "forge-peer/1" as const,
        ownerUserId: input.ownerUserId,
        relationshipId: "relationship_peer_route_confirmed",
        localPrincipalId: localPrincipal.id,
        localDeviceId: "device_peer_route_local",
        remotePrincipalId: remotePrincipal.id,
        remoteDeviceId: "device_peer_route_remote",
        evidenceHash: "2".repeat(64),
        authenticatedAt: fixedNow.toISOString()
      }
    };
    this.recordReceipt({
      commandId: input.commandId,
      operation: "confirm_pairing",
      result,
      approvalDeadline: input.approvalDeadline,
      approval: input.approval
    });
    return result;
  }
}

class MissingReceiptGateway extends HealthyInvitationGateway {
  override async commandReceipt(): ReturnType<
    PeerCoreGateway["commandReceipt"]
  > {
    this.commandReceiptCalls += 1;
    throw new Error("simulated missing durable receipt");
  }
}

class TamperedReceiptGateway extends HealthyInvitationGateway {
  override async commandReceipt(
    input: Parameters<PeerCoreGateway["commandReceipt"]>[0]
  ): ReturnType<PeerCoreGateway["commandReceipt"]> {
    const receipt = await super.commandReceipt(input);
    return {
      ...receipt,
      authorization: receipt.authorization
        ? { ...receipt.authorization, actionDigest: "f".repeat(64) }
        : null
    };
  }
}

type TestContext = {
  app: ReturnType<typeof Fastify>;
  ownerUserId: string;
  secrets: SecretsManager;
  gateway: PeerCoreGateway;
};

async function withPeerApp(
  operation: (context: TestContext) => Promise<void>,
  options: {
    gateway?: PeerCoreGateway;
    authenticate?: PeerSharingRouteDependencies["authenticate"];
    persistPairingConfirmation?: PeerSharingRouteDependencies["persistPairingConfirmation"];
  } = {}
) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-peer-routes-"));
  configureDatabase({ dataRoot: rootDir, seedDemoData: false });
  configureLegacyWikiAutoImport(false);
  await initializeDatabase();
  const ownerUserId = getDefaultUser().id;
  const app = Fastify({ logger: false });
  const secrets = new SecretsManager();
  secrets.configure(rootDir);
  const gateway = options.gateway ?? new UnavailablePeerCoreGateway();
  await registerPeerSharingRoutes(app, {
    authenticate:
      options.authenticate ??
      ((headers) =>
        headers.authorization === "Bearer peer-agent"
          ? agentContext(ownerUserId)
          : operatorContext()),
    authorization: new AuthorizationManager(),
    secrets,
    peerCore: gateway,
    persistPairingConfirmation: options.persistPairingConfirmation,
    now: () => new Date(fixedNow)
  });
  try {
    await operation({ app, ownerUserId, secrets, gateway });
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
}

function seedLocalPeerIdentity(ownerUserId: string) {
  const now = fixedNow.toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO forge_principals (
         id, owner_user_id, principal_kind, public_principal_id,
         root_public_key, root_key_secret_id, display_label, local_person_id,
         trust_state, minimum_protocol_version, maximum_protocol_version,
         first_verified_at, last_verified_at, revoked_at, metadata_json,
         created_at, updated_at
       ) VALUES (?, ?, 'local', ?, ?, 'secret_peer_route', 'Local Forge', NULL,
                 'verified', 1, 1, ?, ?, NULL, '{}', ?, ?)`
    )
    .run(
      "principal_peer_route_local",
      ownerUserId,
      "public_principal_peer_route_local",
      "a".repeat(64),
      now,
      now,
      now,
      now
    );
  getDatabase()
    .prepare(
      `INSERT INTO forge_devices (
         id, owner_user_id, principal_id, certified_public_key,
         private_key_secret_id, certificate, label, device_type, status,
         transport_endpoints_json, capabilities_json, added_at, last_seen_at,
         revoked_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'secret_device_peer_route', ?, 'Mac', 'desktop',
                 'approved', '[]', '[]', ?, ?, NULL, ?, ?)`
    )
    .run(
      "device_peer_route_local",
      ownerUserId,
      "principal_peer_route_local",
      "b".repeat(64),
      "c".repeat(128),
      now,
      now,
      now,
      now
    );
}

function issueCapability(input: {
  ownerUserId: string;
  secrets: SecretsManager;
  action: PeerPresenceAction;
  suffix: string;
}) {
  const principal: PeerPresencePrincipal = {
    principalClass: "operator_session",
    principalId: "session_peer_route_test",
    ownerUserId: input.ownerUserId,
    origin
  };
  const store = new SqlitePeerPresenceStore(
    input.secrets.deriveKey("peer-presence-session-binding/v1")
  );
  const challengeId = `challenge_${input.suffix}`;
  store.createChallenge({
    ...principal,
    id: challengeId,
    ceremony: "authenticate",
    challengeHash: createHash("sha256").update(input.suffix).digest("hex"),
    actionDigest: digestPeerPresenceAction(input.action),
    rpId: "127.0.0.1",
    expectedOrigin: origin,
    credentialSetVersion: "e".repeat(64),
    credentialLabel: null,
    issuedAt: fixedNow.toISOString(),
    expiresAt: new Date(fixedNow.getTime() + 120_000).toISOString(),
    consumedAt: null
  });
  assert.ok(
    store.claimChallenge({
      id: challengeId,
      principal,
      actionDigest: digestPeerPresenceAction(input.action),
      rpId: "127.0.0.1",
      expectedOrigin: origin,
      now: fixedNow.toISOString()
    })
  );
  const capability = issuePeerPresenceCapability({
    id: `capability_${input.suffix}`,
    action: input.action,
    principal,
    hashingKey: input.secrets.deriveKey("peer-presence-capabilities/v1"),
    now: fixedNow
  });
  store.storeCapability(capability.record, challengeId);
  return {
    capability,
    principal,
    cookie: peerPresenceCapabilityCookie({
      capabilityId: capability.record.id,
      secret: capability.secret,
      secure: false
    })
  };
}

function invitationBody(overrides: Record<string, unknown> = {}) {
  return {
    label: "Jon's Forge",
    expiresInSeconds: 300,
    privacyMode: "fastest",
    transportKinds: ["iroh"],
    idempotencyKey: "peer-invite-idempotency-0001",
    ...overrides
  };
}

function invitationAction(
  ownerUserId: string,
  body: unknown
): PeerPresenceAction {
  return {
    ownerUserId,
    method: "POST",
    routePath: "/api/v1/peers/invitations",
    pathParams: {},
    expectedVersion: null,
    body
  };
}

test("agent tokens can read bounded peer state but cannot invoke human-only mutations", async () => {
  await withPeerApp(async ({ app }) => {
    const read = await app.inject({
      method: "GET",
      url: "/api/v1/peers/requests?limit=1",
      headers: { authorization: "Bearer peer-agent" }
    });
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json().requests, []);

    const mutate = await app.inject({
      method: "POST",
      url: "/api/v1/peers/invitations",
      headers: { authorization: "Bearer peer-agent" },
      payload: invitationBody()
    });
    assert.equal(mutate.statusCode, 403);
    assert.equal(mutate.json().code, "peer_principal_forbidden");
  });
});

test("all 29 peer-management route contracts are registered", async () => {
  await withPeerApp(async ({ app }) => {
    const contracts = PEER_ROUTE_CONTRACTS.filter(
      (contract) => !contract.path.startsWith("/api/v1/people")
    );
    assert.equal(contracts.length, 29);
    for (const contract of contracts) {
      assert.equal(
        app.hasRoute({ method: contract.method, url: contract.path }),
        true,
        `${contract.method} ${contract.path}`
      );
    }
  });
});

test("unavailable peer core fails closed before approval consumption or local mutation", async () => {
  await withPeerApp(async ({ app, ownerUserId, secrets }) => {
    const body = invitationBody();
    const issued = issueCapability({
      ownerUserId,
      secrets,
      action: invitationAction(ownerUserId, body),
      suffix: "unavailable"
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/peers/invitations",
      headers: { cookie: issued.cookie },
      payload: body
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, "peer_core_unavailable");
    const invitationCount = getDatabase()
      .prepare("SELECT COUNT(*) AS count FROM peer_pairing_invites")
      .get() as { count: number };
    assert.equal(invitationCount.count, 0);
    const stored = getDatabase()
      .prepare(
        "SELECT status, consumed_at AS consumedAt FROM forge_human_presence_capabilities WHERE id = ?"
      )
      .get(issued.capability.record.id) as {
      status: string;
      consumedAt: string | null;
    };
    assert.equal(stored.status, "active");
    assert.equal(stored.consumedAt, null);
  });
});

test("invitation idempotency replays success and rejects key reuse or approval replay", async () => {
  const gateway = new HealthyInvitationGateway();
  await withPeerApp(
    async ({ app, ownerUserId, secrets }) => {
      seedLocalPeerIdentity(ownerUserId);
      const body = invitationBody();
      const issued = issueCapability({
        ownerUserId,
        secrets,
        action: invitationAction(ownerUserId, body),
        suffix: "idempotency"
      });
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/peers/invitations",
        headers: { cookie: issued.cookie },
        payload: body
      });
      assert.equal(first.statusCode, 201);
      assert.equal(gateway.createInvitationCalls, 1);
      assert.equal(gateway.commandReceiptCalls, 1);

      const replay = await app.inject({
        method: "POST",
        url: "/api/v1/peers/invitations",
        headers: { cookie: issued.cookie },
        payload: body
      });
      assert.equal(replay.statusCode, 201);
      assert.equal(replay.headers["x-forge-idempotent-replay"], "true");
      assert.deepEqual(replay.json(), first.json());
      assert.equal(gateway.createInvitationCalls, 1);
      assert.equal(gateway.commandReceiptCalls, 1);

      const keyConflict = await app.inject({
        method: "POST",
        url: "/api/v1/peers/invitations",
        headers: { cookie: issued.cookie },
        payload: invitationBody({ label: "Changed label" })
      });
      assert.equal(keyConflict.statusCode, 409);
      assert.equal(keyConflict.json().code, "peer_idempotency_conflict");

      const replayedApproval = await app.inject({
        method: "POST",
        url: "/api/v1/peers/invitations",
        headers: { cookie: issued.cookie },
        payload: invitationBody({
          idempotencyKey: "peer-invite-idempotency-0002"
        })
      });
      assert.equal(replayedApproval.statusCode, 409);
      assert.equal(replayedApproval.json().code, "peer_human_approval_invalid");
      assert.equal(gateway.createInvitationCalls, 1);
    },
    { gateway }
  );
});

test("successful daemon dispatch cannot mutate local state without a durable receipt", async () => {
  const gateway = new MissingReceiptGateway();
  await withPeerApp(
    async ({ app, ownerUserId, secrets }) => {
      seedLocalPeerIdentity(ownerUserId);
      const body = invitationBody({
        idempotencyKey: "peer-invite-missing-receipt-0001"
      });
      const approval = issueCapability({
        ownerUserId,
        secrets,
        action: invitationAction(ownerUserId, body),
        suffix: "missing_receipt"
      });
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/peers/invitations",
        headers: { cookie: approval.cookie },
        payload: body
      });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().code, "peer_command_recovery_required");
      assert.equal(gateway.createInvitationCalls, 1);
      assert.equal(gateway.commandReceiptCalls, 1);
      assert.equal(
        (
          getDatabase()
            .prepare("SELECT COUNT(*) AS count FROM peer_pairing_invites")
            .get() as { count: number }
        ).count,
        0
      );
      const command = getDatabase()
        .prepare(
          `SELECT status FROM peer_command_journal
           WHERE owner_user_id = ? AND operation_id = 'createPeerInvitation'`
        )
        .get(ownerUserId) as { status: string };
      assert.equal(command.status, "reconciliation_required");
    },
    { gateway }
  );
});

test("a tampered durable receipt is quarantined before local application", async () => {
  const gateway = new TamperedReceiptGateway();
  await withPeerApp(
    async ({ app, ownerUserId, secrets }) => {
      seedLocalPeerIdentity(ownerUserId);
      const body = invitationBody({
        idempotencyKey: "peer-invite-tampered-receipt-0001"
      });
      const approval = issueCapability({
        ownerUserId,
        secrets,
        action: invitationAction(ownerUserId, body),
        suffix: "tampered_receipt"
      });
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/peers/invitations",
        headers: { cookie: approval.cookie },
        payload: body
      });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().code, "peer_command_security_incident");
      assert.equal(
        (
          getDatabase()
            .prepare("SELECT COUNT(*) AS count FROM peer_pairing_invites")
            .get() as { count: number }
        ).count,
        0
      );
      const command = getDatabase()
        .prepare(
          `SELECT status, last_error AS lastError FROM peer_command_journal
           WHERE owner_user_id = ? AND operation_id = 'createPeerInvitation'`
        )
        .get(ownerUserId) as { status: string; lastError: string };
      assert.equal(command.status, "reconciliation_required");
      assert.match(command.lastError, /SECURITY QUARANTINE/);
    },
    { gateway }
  );
});

test("a timeout after daemon application recovers the durable receipt without redispatch", async () => {
  const gateway = new TimeoutAfterInvitationGateway();
  await withPeerApp(
    async ({ app, ownerUserId, secrets }) => {
      seedLocalPeerIdentity(ownerUserId);
      const body = invitationBody({
        idempotencyKey: "peer-invite-crash-retry-0001"
      });
      const firstApproval = issueCapability({
        ownerUserId,
        secrets,
        action: invitationAction(ownerUserId, body),
        suffix: "crash_retry_first"
      });
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/peers/invitations",
        headers: { cookie: firstApproval.cookie },
        payload: body
      });
      assert.equal(first.statusCode, 201, first.body);

      const replay = await app.inject({
        method: "POST",
        url: "/api/v1/peers/invitations",
        payload: body
      });
      assert.equal(replay.statusCode, 201, replay.body);
      assert.equal(replay.headers["x-forge-idempotent-replay"], "true");
      assert.equal(gateway.createInvitationCalls, 1);
      assert.equal(new Set(gateway.commandIds).size, 1);
      assert.equal(new Set(gateway.invitationExpiries).size, 1);
      const command = getDatabase()
        .prepare(
          `SELECT status, attempt_count AS attemptCount
           FROM peer_command_journal WHERE command_id = ?`
        )
        .get(gateway.commandIds[0]!) as {
        status: string;
        attemptCount: number;
      };
      assert.equal(command.status, "applied");
      assert.equal(command.attemptCount, 1);
      assert.equal(
        (
          getDatabase()
            .prepare("SELECT COUNT(*) AS count FROM peer_pairing_invites")
            .get() as { count: number }
        ).count,
        1
      );
    },
    { gateway }
  );
});

test("pairing acceptance replays a committed response with stable scan and operation identity", async () => {
  const gateway = new PairingAcceptanceGateway();
  await withPeerApp(
    async ({ app, ownerUserId, secrets }) => {
      seedLocalPeerIdentity(ownerUserId);
      const body = {
        invitation: {
          id: "invite_remote_response_loss",
          ownerUserId: "remote_owner",
          inviterPrincipalId: "5".repeat(64),
          inviterDeviceId: "6".repeat(32),
          fingerprint: "ABCD-EFGH-JKLM-NPQR",
          expiresAt: new Date(fixedNow.getTime() + 5 * 60_000).toISOString(),
          protocolVersion: "forge-peer/1",
          transportKinds: ["iroh"],
          bootstrap: "B".repeat(43),
          signature: "S".repeat(86)
        },
        scannedAt: fixedNow.toISOString(),
        localDeviceId: "device_peer_route_local",
        privacyMode: "fastest",
        idempotencyKey: "pairing-accept-response-loss-0001"
      };
      const action: PeerPresenceAction = {
        ownerUserId,
        method: "POST",
        routePath: "/api/v1/peers/pairings/accept",
        pathParams: {},
        expectedVersion: null,
        body
      };
      const approval = issueCapability({
        ownerUserId,
        secrets,
        action,
        suffix: "pairing_accept_response_loss"
      });
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/peers/pairings/accept",
        headers: { cookie: approval.cookie },
        payload: body
      });
      assert.equal(first.statusCode, 202, first.body);
      assert.equal(gateway.acceptInvitationCalls, 1);

      const replay = await app.inject({
        method: "POST",
        url: "/api/v1/peers/pairings/accept",
        headers: { cookie: approval.cookie },
        payload: body
      });
      assert.equal(replay.statusCode, 202, replay.body);
      assert.equal(replay.headers["x-forge-idempotent-replay"], "true");
      assert.deepEqual(replay.json(), first.json());
      assert.equal(gateway.acceptInvitationCalls, 1);

      const changedScan = await app.inject({
        method: "POST",
        url: "/api/v1/peers/pairings/accept",
        headers: { cookie: approval.cookie },
        payload: {
          ...body,
          scannedAt: new Date(fixedNow.getTime() + 1_000).toISOString()
        }
      });
      assert.equal(changedScan.statusCode, 409, changedScan.body);
      assert.equal(changedScan.json().code, "peer_idempotency_conflict");
    },
    { gateway }
  );
});

test("pairing confirmation returns the accepted record from the atomic persistence CAS", async () => {
  const gateway = new PairingConfirmationGateway();
  let persistenceCalls = 0;
  const persistPairingConfirmation: NonNullable<
    PeerSharingRouteDependencies["persistPairingConfirmation"]
  > = (input) => {
    persistenceCalls += 1;
    const at = input.now.toISOString();
    const changed = getDatabase()
      .prepare(
        `UPDATE peer_pending_requests
         SET status = 'accepted', version = version + 1, decided_at = ?,
             decision_reason = 'pairing_confirmed', updated_at = ?
         WHERE id = ? AND owner_user_id = ? AND request_kind = 'pairing'
           AND status = 'pending' AND version = ? AND expires_at > ?`
      )
      .run(
        at,
        at,
        input.pairingId,
        input.ownerUserId,
        input.expectedPendingVersion,
        at
      );
    assert.equal(changed.changes, 1);
    return { relationshipId: input.confirmation.relationship.id };
  };
  await withPeerApp(
    async ({ app, ownerUserId, secrets }) => {
      const pending = createPeerPendingRequest({
        ownerUserId,
        kind: "pairing",
        payload: {
          transcriptHash: "3".repeat(64),
          stateBinding: "4".repeat(64)
        },
        expiresAt: new Date(fixedNow.getTime() + 300_000).toISOString(),
        id: "pairing_route_atomic_0001",
        now: fixedNow
      });
      const body = {
        expectedVersion: String(pending.version),
        transcriptHash: "3".repeat(64),
        verificationPhrase: "amber cedar harbor",
        personId: null,
        createPersonDisplayName: null,
        idempotencyKey: "pairing-confirm-atomic-cas-0001"
      };
      const action: PeerPresenceAction = {
        ownerUserId,
        method: "POST",
        routePath: "/api/v1/peers/pairings/:pairingId/confirm",
        pathParams: { pairingId: pending.id },
        expectedVersion: String(pending.version),
        body
      };
      const approval = issueCapability({
        ownerUserId,
        secrets,
        action,
        suffix: "pairing_confirm_atomic_cas"
      });
      const first = await app.inject({
        method: "POST",
        url: `/api/v1/peers/pairings/${pending.id}/confirm`,
        headers: { cookie: approval.cookie },
        payload: body
      });
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(
        first.json().relationshipId,
        "relationship_peer_route_confirmed"
      );
      assert.equal(first.json().request.status, "accepted");
      assert.equal(first.json().request.version, pending.version + 1);
      assert.equal(first.json().request.decisionReason, "pairing_confirmed");
      assert.equal(persistenceCalls, 1);
      assert.equal(gateway.confirmPairingCalls, 1);

      const stored = getDatabase()
        .prepare(
          `SELECT status, version, decided_at AS decidedAt,
                  decision_reason AS decisionReason
           FROM peer_pending_requests WHERE id = ? AND owner_user_id = ?`
        )
        .get(pending.id, ownerUserId) as {
        status: string;
        version: number;
        decidedAt: string;
        decisionReason: string;
      };
      assert.equal(stored.status, "accepted");
      assert.equal(stored.version, pending.version + 1);
      assert.equal(stored.decidedAt, fixedNow.toISOString());
      assert.equal(stored.decisionReason, "pairing_confirmed");
      assert.equal(
        (
          getDatabase()
            .prepare(
              `SELECT status FROM peer_command_journal
               WHERE owner_user_id = ? AND operation_id = 'confirmPeerPairing'`
            )
            .get(ownerUserId) as { status: string }
        ).status,
        "applied"
      );

      const replay = await app.inject({
        method: "POST",
        url: `/api/v1/peers/pairings/${pending.id}/confirm`,
        headers: { cookie: approval.cookie },
        payload: body
      });
      assert.equal(replay.statusCode, 200, replay.body);
      assert.equal(replay.headers["x-forge-idempotent-replay"], "true");
      assert.deepEqual(replay.json(), first.json());
      assert.equal(persistenceCalls, 1);
      assert.equal(gateway.confirmPairingCalls, 1);
    },
    { gateway, persistPairingConfirmation }
  );
});

test("human approval rejects body and path changes before allowing the exact request once", async () => {
  await withPeerApp(async ({ app, ownerUserId, secrets }) => {
    const first = createPeerPendingRequest({
      ownerUserId,
      kind: "device",
      payload: { label: "Jon's phone", publicKey: "must-not-be-returned" },
      expiresAt: new Date(fixedNow.getTime() + 300_000).toISOString(),
      id: "request_exact_a",
      now: fixedNow
    });
    createPeerPendingRequest({
      ownerUserId,
      kind: "device",
      payload: { label: "Jon's tablet" },
      expiresAt: new Date(fixedNow.getTime() + 300_000).toISOString(),
      id: "request_exact_b",
      now: fixedNow
    });
    const body = {
      expectedVersion: String(first.version),
      reason: "Not this device"
    };
    const action: PeerPresenceAction = {
      ownerUserId,
      method: "POST",
      routePath: "/api/v1/peers/requests/:requestId/reject",
      pathParams: { requestId: first.id },
      expectedVersion: String(first.version),
      body
    };
    const issued = issueCapability({
      ownerUserId,
      secrets,
      action,
      suffix: "exact_binding"
    });

    const bodyMismatch = await app.inject({
      method: "POST",
      url: `/api/v1/peers/requests/${first.id}/reject`,
      headers: { cookie: issued.cookie },
      payload: { ...body, reason: "A changed reason" }
    });
    assert.equal(bodyMismatch.statusCode, 409);
    assert.equal(bodyMismatch.json().code, "peer_human_approval_invalid");

    const pathMismatch = await app.inject({
      method: "POST",
      url: "/api/v1/peers/requests/request_exact_b/reject",
      headers: { cookie: issued.cookie },
      payload: body
    });
    assert.equal(pathMismatch.statusCode, 409);
    assert.equal(pathMismatch.json().code, "peer_human_approval_invalid");

    const exact = await app.inject({
      method: "POST",
      url: `/api/v1/peers/requests/${first.id}/reject`,
      headers: { cookie: issued.cookie },
      payload: body
    });
    assert.equal(exact.statusCode, 200);
    assert.equal(exact.json().request.status, "rejected");
    const untouched = getDatabase()
      .prepare(
        "SELECT status FROM peer_pending_requests WHERE id = 'request_exact_b'"
      )
      .get() as { status: string };
    assert.equal(untouched.status, "pending");
  });
});

function seedWebAuthnCredential(input: {
  ownerUserId: string;
  id: string;
  credentialId: string;
  createdAt: string;
}) {
  getDatabase()
    .prepare(
      `INSERT INTO forge_webauthn_credentials (
         id, owner_user_id, rp_id, credential_id, public_key_base64, counter,
         transports_json, label, device_type, backed_up, aaguid, status,
         created_at, updated_at, last_used_at, revoked_at
       ) VALUES (?, ?, '127.0.0.1', ?, ?, 0, '["internal"]', ?,
                 'singleDevice', 0, '', 'active', ?, ?, ?, NULL)`
    )
    .run(
      input.id,
      input.ownerUserId,
      input.credentialId,
      Buffer.alloc(48, input.id === "credential_a" ? 1 : 2).toString("base64"),
      input.id,
      input.createdAt,
      input.createdAt,
      input.createdAt
    );
}

test("credential deletion preserves a credential and cannot self-authorize", async () => {
  await withPeerApp(async ({ app, ownerUserId, secrets }) => {
    seedWebAuthnCredential({
      ownerUserId,
      id: "credential_a",
      credentialId: "credential-public-id-a",
      createdAt: "2026-07-15T10:00:00.000Z"
    });
    seedWebAuthnCredential({
      ownerUserId,
      id: "credential_b",
      credentialId: "credential-public-id-b",
      createdAt: "2026-07-15T10:01:00.000Z"
    });
    const store = new SqlitePeerPresenceStore(
      secrets.deriveKey("peer-presence-session-binding/v1")
    );
    const version = peerWebAuthnCredentialSetVersion(
      store.listActiveCredentials(ownerUserId, "127.0.0.1")
    );
    const action: PeerPresenceAction = {
      ownerUserId,
      method: "DELETE",
      routePath: "/api/v1/peers/human-presence/credentials/:credentialId",
      pathParams: { credentialId: "credential_a" },
      expectedVersion: version,
      body: {}
    };
    const self = issueCapability({
      ownerUserId,
      secrets,
      action,
      suffix: "credential_self"
    });
    recordPeerPresenceAudit({
      ownerUserId,
      eventType: "peer_webauthn_verified",
      outcome: "allowed",
      principal: self.principal,
      credentialId: "credential_a",
      challengeId: "challenge_credential_self",
      capabilityId: self.capability.record.id,
      actionDigest: self.capability.record.actionDigest,
      now: fixedNow
    });
    const selfDelete = await app.inject({
      method: "DELETE",
      url: "/api/v1/peers/human-presence/credentials/credential_a",
      headers: { cookie: self.cookie }
    });
    assert.equal(selfDelete.statusCode, 409);
    assert.equal(
      selfDelete.json().code,
      "peer_presence_self_revocation_forbidden"
    );

    const other = issueCapability({
      ownerUserId,
      secrets,
      action,
      suffix: "credential_other"
    });
    recordPeerPresenceAudit({
      ownerUserId,
      eventType: "peer_webauthn_verified",
      outcome: "allowed",
      principal: other.principal,
      credentialId: "credential_b",
      challengeId: "challenge_credential_other",
      capabilityId: other.capability.record.id,
      actionDigest: other.capability.record.actionDigest,
      now: fixedNow
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/v1/peers/human-presence/credentials/credential_a",
      headers: { cookie: other.cookie }
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json().revoked, true);
    const active = getDatabase()
      .prepare(
        "SELECT id FROM forge_webauthn_credentials WHERE owner_user_id = ? AND status = 'active' ORDER BY id"
      )
      .all(ownerUserId) as Array<{ id: string }>;
    assert.deepEqual(
      active.map((row) => row.id),
      ["credential_b"]
    );
  });
});
