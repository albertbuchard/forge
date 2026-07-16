import assert from "node:assert/strict";
import { constants as fsConstants, existsSync } from "node:fs";
import { access, chmod, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";
import { SecretsManager } from "../managers/platform/secrets-manager.js";
import {
  PeerCoreIpcError,
  UnixSocketPeerCoreGateway
} from "./peer-core-ipc-gateway.js";
import {
  DerivedPeerCommandAuthorizer,
  peerCommandActionDigest
} from "./peer-command-authorization.js";
import { PeerDaemonSupervisor } from "./peer-daemon-supervisor.js";

const binaryCandidates = [
  path.resolve("packages/forge-peer/target/release/forge-peer"),
  path.resolve("packages/forge-peer/target/debug/forge-peer")
];
const rustBinary = binaryCandidates.find((candidate) => existsSync(candidate));

function frame(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(10);
  header.write("FGP1", 0, "ascii");
  header[4] = 2;
  header[5] = 0;
  header.writeUInt32BE(payload.byteLength, 6);
  return Buffer.concat([header, payload]);
}

async function rawExchange(
  socketPath: string,
  request: unknown,
  timeoutMs = 2_000
) {
  const socket = createConnection(socketPath);
  socket.setTimeout(timeoutMs, () => {
    socket.destroy(new Error("Timed out waiting for the Rust IPC response."));
  });
  try {
    await once(socket, "connect");
    socket.end(frame(request));
    const chunks: Buffer[] = [];
    for await (const chunk of socket) {
      chunks.push(Buffer.from(chunk));
    }
    const response = Buffer.concat(chunks);
    if (response.byteLength === 0) return null;
    assert.ok(
      response.byteLength >= 10,
      "Rust IPC returned no framed response"
    );
    assert.equal(response.subarray(0, 4).toString("ascii"), "FGP1");
    assert.equal(response[4], 2);
    assert.equal(response[5], 0);
    const length = response.readUInt32BE(6);
    assert.equal(response.byteLength, length + 10);
    return JSON.parse(response.subarray(10).toString("utf8")) as Record<
      string,
      unknown
    >;
  } finally {
    socket.destroy();
  }
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

if (!rustBinary) {
  test.skip("production Rust IPC accepts canonical queries and rejects schema drift", () => {});
} else {
  test("production Rust IPC accepts canonical queries and rejects schema drift", async () => {
    await access(rustBinary, fsConstants.X_OK);
    const temporaryRoot = await mkdtemp(
      path.join(await accessTemporaryRoot(), "forge-peer-rust-ipc-")
    );
    await chmod(temporaryRoot, 0o700);
    const stateDir = path.join(temporaryRoot, "state");
    const socketDir = path.join(temporaryRoot, "run");
    const socketPath = path.join(socketDir, "peer.sock");
    await mkdir(stateDir, { mode: 0o700 });
    await mkdir(socketDir, { mode: 0o700 });
    const ownerUserId = "user_peer_rust_ipc";
    const secrets = new SecretsManager();
    secrets.configure(temporaryRoot);
    const commandAuthorizer = new DerivedPeerCommandAuthorizer({
      ownerUserId,
      stateDir,
      secrets
    });
    const directPort = await reserveLoopbackPort();
    const supervisor = new PeerDaemonSupervisor({
      enabled: true,
      binaryPath: rustBinary,
      socketPath,
      stateDir,
      ownerUserId,
      commandAuthorityPublicKey: commandAuthorizer.publicKeyBase64Url,
      directEndpoints: [`127.0.0.1:${directPort}`],
      irohEnabled: true,
      allowLoopbackDirect: true,
      startupTimeoutMs: 30_000,
      healthProbeTimeoutMs: 2_000,
      maxRestarts: 0
    });
    try {
      const ready = await supervisor.start();
      assert.equal(ready.state, "ready");
      const gateway = new UnixSocketPeerCoreGateway({
        socketPath,
        ownerUserId,
        timeoutMs: 2_000,
        commandAuthorizer,
        commandJournal: null
      });
      await commandAuthorizer.initialize();
      const synchronized = await gateway.syncCommandAuthorizationState({
        ownerUserId
      });
      assert.equal(
        synchronized.authorityKeyId,
        commandAuthorizer.authorityKeyId
      );
      assert.equal(synchronized.invalidationEpoch, "0");
      const identity = await gateway.localIdentity({ ownerUserId });
      assert.ok(identity.device.capabilities.includes("iroh"));
      assert.ok(
        identity.device.transportEndpoints.some(
          (endpoint) => endpoint.kind === "iroh"
        )
      );
      const readiness = await gateway.transportReadiness({ ownerUserId });
      assert.equal(
        readiness.providers.find((provider) => provider.kind === "tor_onion")
          ?.state,
        "disabled"
      );
      assert.equal(
        readiness.providers.find((provider) => provider.kind === "http_mailbox")
          ?.state,
        "disabled"
      );

      const commandId = "command_rust_receipt_0001";
      const approvalDeadline = new Date(
        Math.floor((Date.now() + 5 * 60_000) / 1_000) * 1_000
      ).toISOString();
      const authorizationIssuedAt = new Date().toISOString();
      const invitationExpiresAt = new Date(
        Date.now() + 10 * 60_000
      ).toISOString();
      const invitationInput = {
        ownerUserId,
        label: "Rust receipt integration",
        expiresAt: invitationExpiresAt,
        privacyMode: "fastest" as const,
        transportKinds: ["local_direct"]
      };
      const actionDigest = peerCommandActionDigest({
        type: "create_invitation",
        requestId: "request_id_is_excluded_from_the_action_digest",
        commandId,
        approvalDeadline,
        input: invitationInput
      });
      const approval = {
        actorClass: "operator_session" as const,
        actorId: "user_peer_rust_ipc",
        sessionId: "session_peer_rust_ipc",
        deviceId: null,
        capabilityId: "capability_peer_rust_ipc",
        actionDigest,
        capabilityIssuedAt: new Date(Date.now() - 1_000).toISOString(),
        capabilityExpiresAt: approvalDeadline,
        authorizationIssuedAt
      };
      const invitation = await gateway.createInvitation({
        commandId,
        approvalDeadline,
        approval,
        ...invitationInput
      });
      assert.equal(invitation.invitation.ownerUserId, ownerUserId);
      const receipt = await gateway.commandReceipt({ ownerUserId, commandId });
      assert.equal(receipt.commandId, commandId);
      assert.equal(receipt.operation, "create_invitation");
      assert.equal(
        Date.parse(receipt.approvalDeadline ?? ""),
        Date.parse(approvalDeadline)
      );
      assert.equal(
        receipt.authorization?.authorityKeyId,
        commandAuthorizer.authorityKeyId
      );
      assert.equal(receipt.authorization?.actorClass, approval.actorClass);
      assert.equal(receipt.authorization?.sessionId, approval.sessionId);
      assert.equal(receipt.authorization?.capabilityId, approval.capabilityId);
      assert.equal(receipt.authorization?.actionDigest, approval.actionDigest);
      assert.ok(receipt.committedAt);
      assert.ok(
        Date.parse(receipt.committedAt!) <= Date.parse(approvalDeadline)
      );
      assert.match(receipt.requestHash, /^[a-f0-9]{64}$/);
      assert.equal(
        (receipt.result as { invitation?: { id?: unknown } }).invitation?.id,
        invitation.invitation.id
      );

      const workerId = "rust_query_worker";
      const workerCommandId = "command_rust_query_claim_0001";
      const workerIssuedAt = new Date().toISOString();
      const workerDeadline = new Date(Date.now() + 60_000).toISOString();
      const claimInput = {
        commandId: workerCommandId,
        approvalDeadline: workerDeadline,
        authorizationIssuedAt: workerIssuedAt,
        ownerUserId,
        workerId,
        leaseMs: 2_000
      };
      const firstClaim = await gateway.claimInboundQuery(claimInput);
      assert.equal(firstClaim.claim, null);
      assert.equal(firstClaim.provenance.ownerUserId, ownerUserId);
      assert.equal(firstClaim.provenance.relationshipId, null);
      assert.deepEqual(await gateway.claimInboundQuery(claimInput), firstClaim);

      const revocationPage = await gateway.listRevocationEvents({
        ownerUserId,
        consumerId: "rust_revocation_consumer",
        afterCursor: "0",
        limit: 16
      });
      assert.deepEqual(revocationPage.events, []);
      assert.equal(revocationPage.acknowledgedCursor, "0");
      assert.equal(revocationPage.nextCursor, "0");
      assert.equal(revocationPage.hasMore, false);
      assert.equal(
        revocationPage.evidence?.statementType,
        "revocation_event_page"
      );

      const interval = {
        startsAt: "2026-07-19T22:00:00.000Z",
        endsAt: "2026-07-20T22:00:00.000Z",
        timeZone: "Europe/Zurich"
      };
      const queries = [
        {
          projectionId: "calendar.availability.v1" as const,
          parameters: {},
          interval,
          entityIds: [],
          fields: ["start", "end", "busyState"] as const,
          precision: "fifteen_minutes" as const,
          maximumResultCount: 100
        },
        {
          projectionId: "goals.horizon_summary.v1" as const,
          parameters: {},
          interval,
          entityIds: [],
          fields: ["goalTitle", "goalSummary", "goalState"] as const,
          precision: "exact" as const,
          maximumResultCount: 100
        },
        {
          projectionId: "health.cycling.aggregate.v1" as const,
          parameters: { granularity: "week" as const, units: "metric" },
          interval,
          entityIds: [],
          fields: ["duration", "distance", "activityCount"] as const,
          precision: "exact" as const,
          maximumResultCount: 100
        }
      ];
      for (const query of queries) {
        await assert.rejects(
          gateway.executeQuery({
            ownerUserId,
            relationshipId: "11".repeat(16),
            personId: "person_rust_ipc",
            query,
            timeoutMs: 2_000
          }),
          (error: unknown) => {
            assert.ok(error instanceof PeerCoreIpcError);
            assert.notEqual(error.code, "invalid_request");
            assert.notEqual(error.code, "protocol");
            return true;
          }
        );
      }

      const rejected = await rawExchange(socketPath, {
        type: "execute_query",
        requestId: "rust_unknown_query_key_1",
        input: {
          ownerUserId,
          relationshipId: "11".repeat(16),
          personId: "person_rust_ipc",
          timeoutMs: 2_000,
          query: {
            projectionId: "calendar.availability.v1",
            parameters: {},
            interval,
            entityIds: [],
            fields: ["start"],
            precision: "fifteen_minutes",
            maximumResultCount: 100,
            unknownField: true
          }
        }
      });
      assert.deepEqual(rejected, {
        type: "rejected",
        requestId: "rust_unknown_query_key_1",
        code: "invalid_request",
        detail: "IPC request does not match the strict schema"
      });
    } finally {
      await supervisor.stop();
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
}

async function accessTemporaryRoot() {
  const root = await realpath(os.tmpdir());
  await access(root, fsConstants.R_OK | fsConstants.W_OK);
  return root;
}
