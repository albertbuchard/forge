import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { SecretsManager } from "../managers/platform/secrets-manager.js";
import {
  DerivedPeerCommandAuthorizer,
  derivePeerQueryWorkerCapabilityId,
  derivePeerQueryWorkerSessionId,
  derivePeerRevocationConsumerCapabilityId,
  derivePeerRevocationConsumerSessionId,
  peerCommandActionDigest,
  peerCommandAuthorizationSchema,
  peerCommandRequestHash
} from "./peer-command-authorization.js";

const ownerUserId = "owner_authorization_test";
const issuedAt = "2026-07-16T10:00:00.000Z";
const approvalDeadline = "2026-07-16T10:00:12.000Z";

function secrets(seed: number) {
  return {
    deriveKey: (_context: string, length: number) => Buffer.alloc(length, seed)
  } as unknown as SecretsManager;
}

async function authorizer(
  input: {
    ownerUserId?: string;
    stateDir?: string;
    seed?: number;
  } = {}
) {
  const stateDir =
    input.stateDir ??
    (await mkdtemp(path.join(os.tmpdir(), "forge-peer-auth-")));
  return {
    stateDir,
    value: new DerivedPeerCommandAuthorizer({
      ownerUserId: input.ownerUserId ?? ownerUserId,
      stateDir,
      secrets: secrets(input.seed ?? 7)
    })
  };
}

function serviceDigest(input: {
  type: "claim_inbound_query" | "ack_revocation_events";
  commandId: string;
  actorId: string;
}) {
  const request =
    input.type === "claim_inbound_query"
      ? {
          type: input.type,
          requestId: "request_service_auth",
          commandId: input.commandId,
          approvalDeadline,
          input: {
            ownerUserId,
            workerId: input.actorId,
            leaseMs: 30_000
          }
        }
      : {
          type: input.type,
          requestId: "request_service_auth",
          commandId: input.commandId,
          approvalDeadline,
          input: {
            ownerUserId,
            consumerId: input.actorId,
            throughCursor: "3",
            eventHash: "a".repeat(64)
          }
        };
  return peerCommandActionDigest(request);
}

test("command request hashing matches the Rust daemon fixed vector", () => {
  const request = {
    type: "revoke_relationship",
    requestId: "request_cross_language_hash",
    commandId: "command_cross_language_hash_0001",
    approvalDeadline: "2026-07-16T08:30:00.000Z",
    input: {
      ownerUserId: "owner_cross_language",
      relationshipId: "0123456789abcdef0123456789abcdef",
      reason: "Compromised remote identity"
    }
  };
  const expected =
    "bec08dd14e44e4f3cfe88410b5ffe982e536eaa4324d9f85d9cf977a937ba829";

  assert.equal(peerCommandRequestHash(request), expected);
  assert.equal(
    peerCommandRequestHash({
      ...request,
      requestId: "another_request_id",
      commandId: "another_command_id_0001"
    }),
    expected
  );
  assert.notEqual(
    peerCommandRequestHash({
      ...request,
      input: { ...request.input, reason: "Different reason" }
    }),
    expected
  );
  assert.equal(
    peerCommandRequestHash({
      ...request,
      input: { ...request.input, reason: "x".repeat(1_024) }
    }),
    "5b9e870c39574a14a5381f47b051978fcc34034997ca06caf71923551483a3e4"
  );
  assert.equal(
    peerCommandRequestHash({
      type: "request_resync",
      requestId: "request_cross_language_tree_hash",
      commandId: "command_cross_language_tree_hash_0001",
      approvalDeadline: request.approvalDeadline,
      input: {
        ownerUserId: request.input.ownerUserId,
        relationshipId: request.input.relationshipId,
        projectionIds: Array.from(
          { length: 128 },
          (_, index) =>
            `projection_${String(index).padStart(3, "0")}_${"z".repeat(40)}`
        )
      }
    }),
    "9cc1d511ad7211e7dc21ffd05210bad3542de2b6de8ad0620cf45a9f38b411d4"
  );

  const authorizedCommandId = "command_cross_language_auth_0001";
  const commandDigest = "d".repeat(64);
  assert.equal(
    peerCommandRequestHash({
      type: "claim_inbound_query",
      requestId: "request_cross_language_auth",
      commandId: authorizedCommandId,
      approvalDeadline: request.approvalDeadline,
      input: {
        ownerUserId: request.input.ownerUserId,
        workerId: "worker_cross_language",
        leaseMs: 5_000
      },
      authorization: {
        protocol: "forge-peer-command-authorization/v1",
        authorityKeyId: "A".repeat(43),
        authorizationId: "authorization_cross_language",
        ownerUserId: request.input.ownerUserId,
        actor: {
          class: "service_worker",
          actorId: "worker_cross_language",
          sessionId: "session_cross_language",
          deviceId: null
        },
        capability: {
          kind: "query_worker",
          capabilityId: "capability_cross_language",
          actionDigest: commandDigest,
          state: "active",
          issuedAt: "2026-07-16T08:29:00.000Z",
          expiresAt: request.approvalDeadline
        },
        action: "claim_inbound_query",
        commandId: authorizedCommandId,
        commandDigest,
        approvalDeadline: request.approvalDeadline,
        issuedAt: "2026-07-16T08:29:00.000Z",
        invalidationEpoch: "7",
        signature: "S".repeat(86)
      }
    }),
    "48e9800d2ca850b7da4a03031a6027f119a6c3d689ecb724bbefb58b754d68ac"
  );
});

test("query and revocation workers receive distinct active service capabilities", async () => {
  const { value } = await authorizer();
  const workerId = "query_worker_one";
  const consumerId = "revocation_consumer_one";
  const queryCommandId = `pq_claim_${"1".repeat(64)}`;
  const revocationCommandId = `pr_ack_${"2".repeat(64)}`;
  const queryDigest = serviceDigest({
    type: "claim_inbound_query",
    commandId: queryCommandId,
    actorId: workerId
  });
  const revocationDigest = serviceDigest({
    type: "ack_revocation_events",
    commandId: revocationCommandId,
    actorId: consumerId
  });

  const query = peerCommandAuthorizationSchema.parse(
    await value.authorizeQueryWorker({
      ownerUserId,
      workerId,
      action: "claim_inbound_query",
      commandId: queryCommandId,
      commandDigest: queryDigest,
      approvalDeadline,
      issuedAt
    })
  );
  const revocation = peerCommandAuthorizationSchema.parse(
    await value.authorizeRevocationConsumer({
      ownerUserId,
      consumerId,
      action: "ack_revocation_events",
      commandId: revocationCommandId,
      commandDigest: revocationDigest,
      approvalDeadline,
      issuedAt
    })
  );

  assert.equal(query.actor.class, "service_worker");
  assert.equal(query.capability.kind, "query_worker");
  assert.equal(query.capability.state, "active");
  assert.equal(query.capability.actionDigest, queryDigest);
  assert.equal(
    query.actor.sessionId,
    derivePeerQueryWorkerSessionId({ ownerUserId, workerId })
  );
  assert.equal(
    query.capability.capabilityId,
    derivePeerQueryWorkerCapabilityId({ ownerUserId, workerId })
  );
  assert.equal(revocation.actor.class, "service_worker");
  assert.equal(revocation.capability.kind, "revocation_consumer");
  assert.equal(revocation.capability.state, "active");
  assert.equal(revocation.capability.actionDigest, revocationDigest);
  assert.equal(
    revocation.actor.sessionId,
    derivePeerRevocationConsumerSessionId({ ownerUserId, consumerId })
  );
  assert.equal(
    revocation.capability.capabilityId,
    derivePeerRevocationConsumerCapabilityId({ ownerUserId, consumerId })
  );
  assert.notEqual(
    query.capability.capabilityId,
    revocation.capability.capabilityId
  );
});

test("service authorization is owner, action, body, and deadline bound", async () => {
  const { value } = await authorizer();
  const workerId = "query_worker_bounds";
  const commandId = `pq_claim_${"3".repeat(64)}`;
  const commandDigest = serviceDigest({
    type: "claim_inbound_query",
    commandId,
    actorId: workerId
  });

  await assert.rejects(
    value.authorizeQueryWorker({
      ownerUserId: "another_owner",
      workerId,
      action: "claim_inbound_query",
      commandId,
      commandDigest,
      approvalDeadline,
      issuedAt
    }),
    /another owner/
  );
  await assert.rejects(
    value.authorizeQueryWorker({
      ownerUserId,
      workerId,
      action: "claim_inbound_query",
      commandId,
      commandDigest: "f".repeat(64),
      approvalDeadline: "2026-07-17T10:00:13.000Z",
      issuedAt
    }),
    /window is invalid/
  );
});

test("authority invalidation is durable and blocks revoked sessions and devices", async () => {
  const created = await authorizer();
  const first = await created.value.initialize();
  const revokedSessionId = "revoked_operator_session";
  const revokedDeviceId = "revoked_companion_device";
  const next = await created.value.invalidateAuthority({
    ownerUserId,
    invalidatedAt: "2026-07-16T10:00:05.000Z",
    revokedSessionIds: [revokedSessionId],
    revokedDeviceIds: [revokedDeviceId]
  });

  assert.equal(first.epoch, "0");
  assert.equal(next.epoch, "1");
  assert.deepEqual(next.revokedSessionIds, [revokedSessionId]);
  assert.deepEqual(next.revokedDeviceIds, [revokedDeviceId]);

  const restarted = new DerivedPeerCommandAuthorizer({
    ownerUserId,
    stateDir: created.stateDir,
    secrets: secrets(7)
  });
  assert.deepEqual(await restarted.initialize(), next);

  const actionDigest = "a".repeat(64);
  await assert.rejects(
    restarted.authorize({
      ownerUserId,
      action: "update_device",
      commandId: `human_${"4".repeat(64)}`,
      commandDigest: actionDigest,
      approvalDeadline: "2026-07-16T10:01:00.000Z",
      approval: {
        actorClass: "companion_consent",
        actorId: "companion_actor",
        sessionId: revokedSessionId,
        deviceId: revokedDeviceId,
        capabilityId: "human_capability",
        actionDigest,
        capabilityIssuedAt: "2026-07-16T10:00:06.000Z",
        capabilityExpiresAt: "2026-07-16T10:01:00.000Z",
        authorizationIssuedAt: "2026-07-16T10:00:06.000Z"
      }
    }),
    /invalidated or revoked/
  );
});

test("authority invalidation is owner isolated", async () => {
  const left = await authorizer({ ownerUserId: "owner_left", seed: 11 });
  const right = await authorizer({ ownerUserId: "owner_right", seed: 12 });
  await left.value.invalidateAuthority({
    ownerUserId: "owner_left",
    invalidatedAt: issuedAt,
    revokedDeviceIds: ["shared_remote_device"]
  });

  assert.equal((await left.value.initialize()).epoch, "1");
  assert.equal((await right.value.initialize()).epoch, "0");
  await assert.rejects(
    left.value.invalidateAuthority({
      ownerUserId: "owner_right",
      invalidatedAt: issuedAt
    }),
    /another owner/
  );
});
