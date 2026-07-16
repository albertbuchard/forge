import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase
} from "./db.js";
import {
  PEER_OUTBOX_CANDIDATE_STATEMENTS,
  claimDuePeerOutbox,
  claimPeerInbox,
  commitPeerProjectionChangeEnvelope,
  enqueuePeerOutboxEnvelope,
  finishPeerInboxEnvelope,
  listUnclaimedPeerProjectionChanges,
  markPeerOutboxFailed,
  receivePeerInboxEnvelope,
  recordPeerDeliveryReceipt,
  recordPeerProjectionChange
} from "./repositories/peer-delivery.js";
import { getDefaultUser } from "./repositories/users.js";

const baseNow = new Date("2026-07-15T12:00:00.000Z");

async function withPeerDeliveryDatabase(
  operation: (fixture: {
    ownerUserId: string;
    relationshipId: string;
    localDeviceId: string;
    remoteDeviceId: string;
  }) => void | Promise<void>
): Promise<void> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-peer-delivery-"));
  configureDatabase({ dataRoot: rootDir, seedDemoData: false });
  configureLegacyWikiAutoImport(false);
  await initializeDatabase();
  const ownerUserId = getDefaultUser().id;
  const relationshipId = "relationship_delivery_test";
  const localPrincipalId = "principal_delivery_local";
  const remotePrincipalId = "principal_delivery_remote";
  const localDeviceId = "device_delivery_local";
  const remoteDeviceId = "device_delivery_remote";
  const now = baseNow.toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO forge_principals (
         id, owner_user_id, principal_kind, public_principal_id,
         root_public_key, root_key_secret_id, display_label, local_person_id,
         trust_state, minimum_protocol_version, maximum_protocol_version,
         first_verified_at, last_verified_at, revoked_at, metadata_json,
         created_at, updated_at
       ) VALUES
         (?, ?, 'local', ?, ?, 'secret_delivery_local', 'Local Forge', NULL,
          'verified', 1, 1, ?, ?, NULL, '{}', ?, ?),
         (?, ?, 'remote', ?, ?, NULL, 'Remote Forge', NULL,
          'verified', 1, 1, ?, ?, NULL, '{}', ?, ?)`
    )
    .run(
      localPrincipalId,
      ownerUserId,
      `public_${localPrincipalId}`,
      "a".repeat(64),
      now,
      now,
      now,
      now,
      remotePrincipalId,
      ownerUserId,
      `public_${remotePrincipalId}`,
      "b".repeat(64),
      now,
      now,
      now,
      now
    );
  const insertDevice = getDatabase().prepare(
    `INSERT INTO forge_devices (
       id, owner_user_id, principal_id, certified_public_key,
       private_key_secret_id, certificate, label, device_type, status,
       transport_endpoints_json, capabilities_json, added_at, last_seen_at,
       revoked_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'test', 'approved', '[]', '[]', ?, ?, NULL, ?, ?)`
  );
  insertDevice.run(
    localDeviceId,
    ownerUserId,
    localPrincipalId,
    "c".repeat(64),
    "secret_delivery_device",
    "d".repeat(128),
    "Local test device",
    now,
    now,
    now,
    now
  );
  insertDevice.run(
    remoteDeviceId,
    ownerUserId,
    remotePrincipalId,
    "e".repeat(64),
    null,
    "f".repeat(128),
    "Remote test device",
    now,
    now,
    now,
    now
  );
  getDatabase()
    .prepare(
      `INSERT INTO peer_relationships (
         id, owner_user_id, local_principal_id, remote_principal_id,
         local_person_id, status, negotiated_protocol_version,
         verification_phrase_hash, transport_privacy_mode,
         highest_received_sequence, highest_sent_sequence, established_at,
         last_connected_at, revoked_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, 'active', 'forge-peer/1', ?, 'fastest',
                 0, 0, ?, ?, NULL, ?, ?)`
    )
    .run(
      relationshipId,
      ownerUserId,
      localPrincipalId,
      remotePrincipalId,
      "1".repeat(64),
      now,
      now,
      now,
      now
    );
  const linkDevice = getDatabase().prepare(
    `INSERT INTO peer_relationship_devices (
       relationship_id, owner_user_id, device_id, principal_role, status,
       approved_at, removed_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'approved', ?, NULL, ?, ?)`
  );
  linkDevice.run(
    relationshipId,
    ownerUserId,
    localDeviceId,
    "local",
    now,
    now,
    now
  );
  linkDevice.run(
    relationshipId,
    ownerUserId,
    remoteDeviceId,
    "remote",
    now,
    now,
    now
  );
  try {
    await operation({
      ownerUserId,
      relationshipId,
      localDeviceId,
      remoteDeviceId
    });
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
}

function payload(byte: number): Uint8Array {
  return new Uint8Array(64).fill(byte);
}

test("projection changes are monotonic and become claimed only with a durable outbox envelope", async () => {
  await withPeerDeliveryDatabase(
    ({ ownerUserId, relationshipId, remoteDeviceId }) => {
      const first = recordPeerProjectionChange({
        id: "change_1",
        ownerUserId,
        relationshipId,
        projectionId: "calendar.availability.v1",
        projectionVersion: 1,
        sourceEntityType: "calendar_event",
        sourceEntityId: "event_1",
        sourceVersion: "version_1",
        operation: "upsert",
        now: baseNow
      });
      const second = recordPeerProjectionChange({
        id: "change_2",
        ownerUserId,
        relationshipId,
        projectionId: "calendar.availability.v1",
        projectionVersion: 1,
        sourceEntityType: "calendar_event",
        sourceEntityId: "event_2",
        sourceVersion: "version_1",
        operation: "tombstone",
        now: new Date(baseNow.getTime() + 1)
      });
      assert.equal(first.changeSequence, 1);
      assert.equal(second.changeSequence, 2);
      assert.deepEqual(
        listUnclaimedPeerProjectionChanges({
          ownerUserId,
          relationshipId,
          limit: 20
        }).map((change) => change.id),
        ["change_1", "change_2"]
      );

      const envelope = commitPeerProjectionChangeEnvelope({
        ownerUserId,
        relationshipId,
        changeIds: ["change_1", "change_2", "change_1"],
        envelope: {
          envelopeId: "projection_envelope_1",
          recipientDeviceId: remoteDeviceId,
          channelId: "channel_projection_test_0001",
          sequence: 1,
          messageKind: "projection_delta",
          mlsEpoch: 3,
          ciphertext: payload(7),
          expiresAt: new Date(baseNow.getTime() + 86_400_000)
        },
        now: baseNow
      });
      assert.equal(envelope.status, "pending");
      assert.equal(
        listUnclaimedPeerProjectionChanges({
          ownerUserId,
          relationshipId,
          limit: 20
        }).length,
        0
      );
      assert.throws(
        () =>
          commitPeerProjectionChangeEnvelope({
            ownerUserId,
            relationshipId,
            changeIds: ["change_1"],
            envelope: {
              envelopeId: "projection_envelope_2",
              recipientDeviceId: remoteDeviceId,
              channelId: "channel_projection_test_0001",
              sequence: 2,
              messageKind: "projection_delta",
              mlsEpoch: 3,
              ciphertext: payload(8),
              expiresAt: new Date(baseNow.getTime() + 86_400_000)
            },
            now: baseNow
          }),
        /already claimed|out of scope/i
      );
      const rows = getDatabase()
        .prepare("SELECT envelope_id FROM peer_outbox ORDER BY envelope_id")
        .all() as Array<{ envelope_id: string }>;
      assert.deepEqual(
        rows.map((row) => row.envelope_id),
        ["projection_envelope_1"]
      );
    }
  );
});

test("outbox claims recover stale leases and cumulative receipts cannot roll back", async () => {
  await withPeerDeliveryDatabase(
    ({ ownerUserId, relationshipId, remoteDeviceId }) => {
      for (let sequence = 1; sequence <= 3; sequence += 1) {
        const result = enqueuePeerOutboxEnvelope({
          envelopeId: `outbox_${sequence}`,
          ownerUserId,
          relationshipId,
          recipientDeviceId: remoteDeviceId,
          channelId: "channel_delivery_test_0001",
          sequence,
          messageKind: "typed_query_response",
          mlsEpoch: 4,
          ciphertext: payload(sequence),
          expiresAt: new Date(baseNow.getTime() + 86_400_000),
          now: baseNow
        });
        assert.equal(result.inserted, true);
      }
      const replay = enqueuePeerOutboxEnvelope({
        envelopeId: "outbox_1",
        ownerUserId,
        relationshipId,
        recipientDeviceId: remoteDeviceId,
        channelId: "channel_delivery_test_0001",
        sequence: 1,
        messageKind: "typed_query_response",
        mlsEpoch: 4,
        ciphertext: payload(1),
        expiresAt: new Date(baseNow.getTime() + 86_400_000),
        now: baseNow
      });
      assert.equal(replay.inserted, false);
      assert.throws(
        () =>
          enqueuePeerOutboxEnvelope({
            envelopeId: "outbox_1",
            ownerUserId,
            relationshipId,
            recipientDeviceId: remoteDeviceId,
            channelId: "channel_delivery_test_0001",
            sequence: 1,
            messageKind: "typed_query_response",
            mlsEpoch: 4,
            ciphertext: payload(9),
            expiresAt: new Date(baseNow.getTime() + 86_400_000),
            now: baseNow
          }),
        /different immutable content/i
      );

      const firstClaim = claimDuePeerOutbox({
        ownerUserId,
        limit: 2,
        now: baseNow
      });
      assert.deepEqual(
        firstClaim.map((row) => row.envelopeId),
        ["outbox_1", "outbox_2"]
      );
      assert.ok(firstClaim.every((row) => row.attemptCount === 1));
      assert.deepEqual(
        claimDuePeerOutbox({ ownerUserId, limit: 3, now: baseNow }).map(
          (row) => row.envelopeId
        ),
        ["outbox_3"]
      );
      assert.equal(
        markPeerOutboxFailed({
          ownerUserId,
          envelopeId: "outbox_1",
          expectedAttemptCount: 1,
          error: "provider unavailable",
          nextAttemptAt: new Date(baseNow.getTime() + 120_000),
          now: new Date(baseNow.getTime() + 1_000)
        }),
        true
      );
      const staleReclaim = claimDuePeerOutbox({
        ownerUserId,
        limit: 3,
        now: new Date(baseNow.getTime() + 61_000),
        leaseMs: 60_000
      });
      assert.deepEqual(
        staleReclaim.map((row) => [row.envelopeId, row.attemptCount]),
        [
          ["outbox_2", 2],
          ["outbox_3", 2]
        ]
      );

      const receipt = recordPeerDeliveryReceipt({
        id: "receipt_2",
        ownerUserId,
        relationshipId,
        acknowledgingDeviceId: remoteDeviceId,
        channelId: "channel_delivery_test_0001",
        highestContiguousSequence: 2,
        acknowledgementSignature: "s".repeat(64),
        receivedAt: new Date(baseNow.getTime() + 62_000)
      });
      assert.deepEqual(receipt, {
        inserted: true,
        acknowledgedCount: 2,
        stale: false
      });
      assert.deepEqual(
        recordPeerDeliveryReceipt({
          ownerUserId,
          relationshipId,
          acknowledgingDeviceId: remoteDeviceId,
          channelId: "channel_delivery_test_0001",
          highestContiguousSequence: 1,
          acknowledgementSignature: "t".repeat(64),
          receivedAt: new Date(baseNow.getTime() + 63_000)
        }),
        { inserted: false, acknowledgedCount: 0, stale: true }
      );
      assert.deepEqual(
        recordPeerDeliveryReceipt({
          ownerUserId,
          relationshipId,
          acknowledgingDeviceId: remoteDeviceId,
          channelId: "channel_delivery_test_0001",
          highestContiguousSequence: 2,
          acknowledgementSignature: "s".repeat(64),
          receivedAt: new Date(baseNow.getTime() + 64_000)
        }),
        { inserted: false, acknowledgedCount: 0, stale: false }
      );
      assert.throws(
        () =>
          recordPeerDeliveryReceipt({
            ownerUserId,
            relationshipId,
            acknowledgingDeviceId: remoteDeviceId,
            channelId: "channel_delivery_test_0001",
            highestContiguousSequence: 2,
            acknowledgementSignature: "u".repeat(64),
            receivedAt: new Date(baseNow.getTime() + 65_000)
          }),
        /different signature/i
      );
    }
  );
});

test("outbox claim merges indexed status branches in the original global order", async () => {
  await withPeerDeliveryDatabase(
    ({ ownerUserId, relationshipId, remoteDeviceId }) => {
      const ids = [
        "candidate_pending_due",
        "candidate_failed_due",
        "candidate_in_flight_stale",
        "candidate_pending_future",
        "candidate_in_flight_fresh"
      ];
      for (const [index, envelopeId] of ids.entries()) {
        enqueuePeerOutboxEnvelope({
          envelopeId,
          ownerUserId,
          relationshipId,
          recipientDeviceId: remoteDeviceId,
          channelId: "channel_ordering_test_0001",
          sequence: index + 1,
          messageKind: "typed_query_response",
          mlsEpoch: 1,
          ciphertext: payload(index + 1),
          expiresAt: new Date(baseNow.getTime() + 86_400_000),
          now: baseNow
        });
      }
      const claimAt = new Date(baseNow.getTime() + 120_000);
      const setState = getDatabase().prepare(
        `UPDATE peer_outbox
         SET status = ?, next_attempt_at = ?, last_attempt_at = ?, created_at = ?
         WHERE envelope_id = ? AND owner_user_id = ?`
      );
      setState.run(
        "pending",
        new Date(baseNow.getTime() + 1_000).toISOString(),
        null,
        baseNow.toISOString(),
        "candidate_pending_due",
        ownerUserId
      );
      setState.run(
        "failed",
        new Date(baseNow.getTime() + 500).toISOString(),
        baseNow.toISOString(),
        baseNow.toISOString(),
        "candidate_failed_due",
        ownerUserId
      );
      setState.run(
        "in_flight",
        new Date(baseNow.getTime() + 750).toISOString(),
        baseNow.toISOString(),
        baseNow.toISOString(),
        "candidate_in_flight_stale",
        ownerUserId
      );
      setState.run(
        "pending",
        new Date(baseNow.getTime() + 180_000).toISOString(),
        null,
        baseNow.toISOString(),
        "candidate_pending_future",
        ownerUserId
      );
      setState.run(
        "in_flight",
        new Date(baseNow.getTime() + 150_000).toISOString(),
        new Date(baseNow.getTime() + 90_000).toISOString(),
        baseNow.toISOString(),
        "candidate_in_flight_fresh",
        ownerUserId
      );

      assert.deepEqual(
        claimDuePeerOutbox({
          ownerUserId,
          limit: 2,
          now: claimAt,
          leaseMs: 60_000
        }).map((row) => row.envelopeId),
        ["candidate_failed_due", "candidate_in_flight_stale"]
      );
      assert.deepEqual(
        claimDuePeerOutbox({
          ownerUserId,
          limit: 5,
          now: claimAt,
          leaseMs: 60_000
        }).map((row) => row.envelopeId),
        ["candidate_pending_due"]
      );
    }
  );
});

test("outbox branch merge uses SQLite BINARY ordering for exact tie breaks", async () => {
  await withPeerDeliveryDatabase(
    ({ ownerUserId, relationshipId, remoteDeviceId }) => {
      for (const [index, envelopeId] of [
        "candidate_A",
        "candidate_a"
      ].entries()) {
        enqueuePeerOutboxEnvelope({
          envelopeId,
          ownerUserId,
          relationshipId,
          recipientDeviceId: remoteDeviceId,
          channelId: "channel_binary_order_0001",
          sequence: index + 1,
          messageKind: "typed_query_response",
          mlsEpoch: 1,
          ciphertext: payload(index + 1),
          expiresAt: new Date(baseNow.getTime() + 86_400_000),
          now: baseNow
        });
      }
      getDatabase()
        .prepare(
          `UPDATE peer_outbox
           SET status = 'in_flight', last_attempt_at = ?
           WHERE envelope_id = ? AND owner_user_id = ?`
        )
        .run(baseNow.toISOString(), "candidate_a", ownerUserId);

      assert.deepEqual(
        claimDuePeerOutbox({
          ownerUserId,
          limit: 2,
          now: new Date(baseNow.getTime() + 61_000),
          leaseMs: 60_000
        }).map((row) => row.envelopeId),
        ["candidate_A", "candidate_a"]
      );
    }
  );
});

test("outbox claims reject unsafe scheduling and close terminal or expired envelopes", async () => {
  await withPeerDeliveryDatabase(
    ({ ownerUserId, relationshipId, remoteDeviceId }) => {
      const baseInput = {
        ownerUserId,
        relationshipId,
        recipientDeviceId: remoteDeviceId,
        channelId: "channel_claim_guard_0001",
        messageKind: "typed_query_response",
        mlsEpoch: 1,
        ciphertext: payload(1),
        now: baseNow
      } as const;
      assert.throws(
        () =>
          enqueuePeerOutboxEnvelope({
            ...baseInput,
            envelopeId: "unsafe\0envelope",
            sequence: 1,
            expiresAt: new Date(baseNow.getTime() + 86_400_000)
          }),
        /safe ASCII|ASCII letters/i
      );
      for (const leaseMs of [0, -1, 1.5, 86_400_001]) {
        assert.throws(
          () =>
            claimDuePeerOutbox({
              ownerUserId,
              limit: 1,
              now: baseNow,
              leaseMs
            }),
          /lease must be an integer between/i
        );
      }

      enqueuePeerOutboxEnvelope({
        ...baseInput,
        envelopeId: "terminal_attempt",
        sequence: 2,
        expiresAt: new Date(baseNow.getTime() + 86_400_000)
      });
      getDatabase()
        .prepare(
          `UPDATE peer_outbox SET attempt_count = 11
           WHERE owner_user_id = ? AND envelope_id = 'terminal_attempt'`
        )
        .run(ownerUserId);
      const terminal = claimDuePeerOutbox({
        ownerUserId,
        limit: 1,
        now: baseNow
      });
      assert.equal(terminal[0]?.attemptCount, 12);
      assert.equal(
        markPeerOutboxFailed({
          ownerUserId,
          envelopeId: "terminal_attempt",
          expectedAttemptCount: 12,
          error: "terminal transport failure",
          nextAttemptAt: new Date(baseNow.getTime() + 120_000),
          now: new Date(baseNow.getTime() + 1_000)
        }),
        true
      );
      assert.equal(
        (
          getDatabase()
            .prepare(
              `SELECT status FROM peer_outbox
               WHERE owner_user_id = ? AND envelope_id = 'terminal_attempt'`
            )
            .get(ownerUserId) as { status: string }
        ).status,
        "canceled"
      );
      assert.equal(
        recordPeerDeliveryReceipt({
          ownerUserId,
          relationshipId,
          acknowledgingDeviceId: remoteDeviceId,
          channelId: baseInput.channelId,
          highestContiguousSequence: 2,
          acknowledgementSignature: "z".repeat(64),
          receivedAt: new Date(baseNow.getTime() + 2_000)
        }).acknowledgedCount,
        1
      );

      enqueuePeerOutboxEnvelope({
        ...baseInput,
        envelopeId: "expired_before_claim",
        sequence: 3,
        expiresAt: new Date(baseNow.getTime() + 30_000)
      });
      assert.deepEqual(
        claimDuePeerOutbox({
          ownerUserId,
          limit: 1,
          now: new Date(baseNow.getTime() + 31_000)
        }),
        []
      );
      assert.equal(
        (
          getDatabase()
            .prepare(
              `SELECT status FROM peer_outbox
               WHERE owner_user_id = ? AND envelope_id = 'expired_before_claim'`
            )
            .get(ownerUserId) as { status: string }
        ).status,
        "expired"
      );
    }
  );
});

test("inbox reception deduplicates exact envelopes, rejects replay changes, and uses claim CAS", async () => {
  await withPeerDeliveryDatabase(
    ({ ownerUserId, relationshipId, remoteDeviceId }) => {
      const input = {
        envelopeId: "inbox_1",
        ownerUserId,
        relationshipId,
        senderDeviceId: remoteDeviceId,
        channelId: "channel_inbox_test_00001",
        sequence: 1,
        messageKind: "grant_proposal",
        mlsEpoch: 5,
        ciphertext: payload(4),
        receivedAt: baseNow,
        expiresAt: new Date(baseNow.getTime() + 86_400_000)
      };
      assert.equal(receivePeerInboxEnvelope(input).duplicate, false);
      assert.equal(receivePeerInboxEnvelope(input).duplicate, true);
      assert.throws(
        () =>
          receivePeerInboxEnvelope({
            ...input,
            envelopeId: "inbox_replayed_sequence",
            ciphertext: payload(5)
          }),
        /sequence replay/i
      );
      const firstClaim = claimPeerInbox({
        ownerUserId,
        limit: 10,
        now: baseNow
      });
      assert.equal(firstClaim.length, 1);
      assert.equal(firstClaim[0]!.processingState, "processing");
      assert.equal(
        claimPeerInbox({ ownerUserId, limit: 10, now: baseNow }).length,
        0
      );
      const reclaimed = claimPeerInbox({
        ownerUserId,
        limit: 10,
        now: new Date(baseNow.getTime() + 61_000),
        leaseMs: 60_000
      });
      assert.equal(reclaimed.length, 1);
      assert.equal(
        finishPeerInboxEnvelope({
          ownerUserId,
          envelopeId: "inbox_1",
          claimedAt: firstClaim[0]!.updatedAt,
          outcome: "processed",
          now: new Date(baseNow.getTime() + 62_000)
        }),
        false
      );
      assert.equal(
        finishPeerInboxEnvelope({
          ownerUserId,
          envelopeId: "inbox_1",
          claimedAt: reclaimed[0]!.updatedAt,
          outcome: "processed",
          now: new Date(baseNow.getTime() + 62_000)
        }),
        true
      );
      assert.equal(claimPeerInbox({ ownerUserId, limit: 10 }).length, 0);
    }
  );
});

test("delivery queues enforce bounded batches, ciphertext hashes, and indexed claim plans", async () => {
  await withPeerDeliveryDatabase(
    ({ ownerUserId, relationshipId, remoteDeviceId }) => {
      assert.throws(
        () => claimDuePeerOutbox({ ownerUserId, limit: 0 }),
        /between 1 and 200/i
      );
      assert.throws(
        () =>
          enqueuePeerOutboxEnvelope({
            envelopeId: "bad_hash",
            ownerUserId,
            relationshipId,
            recipientDeviceId: remoteDeviceId,
            channelId: "channel_hash_test_000001",
            sequence: 1,
            messageKind: "acknowledgement",
            mlsEpoch: 1,
            ciphertext: payload(1),
            ciphertextHash: "0".repeat(64),
            expiresAt: new Date(baseNow.getTime() + 60_000),
            now: baseNow
          }),
        /hash does not match/i
      );
      const indexes = getDatabase()
        .prepare(
          `SELECT name FROM sqlite_master
         WHERE type = 'index' AND name IN (
           'idx_peer_outbox_due_claim_order',
           'idx_peer_outbox_in_flight_claim_order',
           'idx_peer_outbox_active_expiry',
           'idx_peer_inbox_pending', 'idx_peer_inbox_processing_lease'
         ) ORDER BY name`
        )
        .all() as Array<{ name: string }>;
      assert.deepEqual(
        indexes.map((row) => row.name),
        [
          "idx_peer_inbox_pending",
          "idx_peer_inbox_processing_lease",
          "idx_peer_outbox_active_expiry",
          "idx_peer_outbox_due_claim_order",
          "idx_peer_outbox_in_flight_claim_order"
        ]
      );

      const queryArguments = {
        due: [ownerUserId, baseNow.toISOString(), baseNow.toISOString(), 50],
        inFlight: [
          ownerUserId,
          baseNow.toISOString(),
          baseNow.toISOString(),
          50
        ]
      } as const;
      for (const [branch, sql] of Object.entries(
        PEER_OUTBOX_CANDIDATE_STATEMENTS
      )) {
        const plan = getDatabase()
          .prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .all(
            ...queryArguments[branch as keyof typeof queryArguments]
          ) as Array<{
          detail: string;
        }>;
        assert.equal(
          plan.some((row) => /^SCAN peer_outbox(?:\s|$)/.test(row.detail)),
          false,
          `${branch} claim branch must not scan peer_outbox: ${JSON.stringify(plan)}`
        );
        assert.ok(
          plan.some((row) =>
            row.detail.includes(
              branch === "inFlight"
                ? "idx_peer_outbox_in_flight_claim_order"
                : "idx_peer_outbox_due_claim_order"
            )
          ),
          `${branch} claim branch must use its partial index: ${JSON.stringify(plan)}`
        );
        assert.equal(
          plan.some((row) => row.detail.includes("USE TEMP B-TREE")),
          false,
          `${branch} claim branch must stream exact queue order: ${JSON.stringify(plan)}`
        );
      }
    }
  );
});
