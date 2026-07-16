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
  applyPeerCommand,
  derivePeerCommandId,
  getPeerCommand,
  listRecoverablePeerCommands,
  markPeerCommandDispatched,
  markPeerCommandFailed,
  markPeerCommandReceiptRecovered,
  markPeerCommandReconciliationRequired,
  preparePeerCommand,
  recordPeerCommandDaemonDispatch,
  verifyPeerCommandDaemonReceipt,
  type PeerCommandApprovalJournalBinding
} from "./repositories/peer-command-journal.js";
import { getDefaultUser } from "./repositories/users.js";

async function withCommandDatabase(
  operation: (ownerUserId: string) => void | Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-peer-command-"));
  configureDatabase({ dataRoot: root, seedDemoData: false });
  configureLegacyWikiAutoImport(false);
  await initializeDatabase();
  try {
    await operation(getDefaultUser().id);
  } finally {
    closeDatabase();
    await rm(root, { recursive: true, force: true });
  }
}

function approvalBinding(
  ownerUserId: string,
  overrides: Partial<PeerCommandApprovalJournalBinding> = {}
): PeerCommandApprovalJournalBinding {
  return {
    ownerUserId,
    actorClass: "operator_session",
    actorId: "session_operator_command_test",
    sessionId: "session_operator_command_test",
    deviceId: null,
    capabilityId: "capability_command_test_0001",
    approvalMethod: "webauthn",
    approvalDeadline: "2099-07-15T12:05:00.000Z",
    authorizationId: "authorization_command_test_0001",
    authorizationStateHash: "1".repeat(64),
    ...overrides
  };
}

test("peer command preparation is deterministic and rejects binding conflicts", async () => {
  await withCommandDatabase((ownerUserId) => {
    const input = {
      ownerUserId,
      operationId: "revokePeerRelationship",
      targetType: "relationship",
      targetId: "relationship_1",
      requestHash: "a".repeat(64),
      retryKey: "reviewed-retry-key-0001"
    };
    const commandId = derivePeerCommandId(input);
    assert.equal(commandId, derivePeerCommandId(input));
    assert.notEqual(
      commandId,
      derivePeerCommandId({ ...input, retryKey: "other-key" })
    );
    const prepared = preparePeerCommand({
      commandId,
      ownerUserId,
      operationId: input.operationId,
      targetType: input.targetType,
      targetId: input.targetId,
      requestHash: input.requestHash,
      expectedVersion: "version_1",
      approval: approvalBinding(ownerUserId),
      now: new Date("2026-07-15T12:00:00.000Z")
    });
    assert.equal(prepared.inserted, true);
    assert.equal(
      preparePeerCommand({
        commandId,
        ownerUserId,
        operationId: input.operationId,
        targetType: input.targetType,
        targetId: input.targetId,
        requestHash: input.requestHash,
        expectedVersion: "version_1",
        approval: approvalBinding(ownerUserId)
      }).inserted,
      false
    );
    assert.throws(
      () =>
        preparePeerCommand({
          commandId,
          ownerUserId,
          operationId: input.operationId,
          targetType: input.targetType,
          targetId: input.targetId,
          requestHash: "b".repeat(64),
          expectedVersion: "version_1",
          approval: approvalBinding(ownerUserId)
        }),
      /conflicts with a different reviewed operation/i
    );
  });
});

test("uncertain peer commands require receipt recovery and apply local state exactly once", async () => {
  await withCommandDatabase((ownerUserId) => {
    getDatabase().exec(
      "CREATE TABLE command_effects (id TEXT PRIMARY KEY, value TEXT NOT NULL)"
    );
    const commandId = derivePeerCommandId({
      ownerUserId,
      operationId: "createPeerInvitation",
      targetType: "invitation",
      targetId: "idempotency_key_0001",
      requestHash: "c".repeat(64)
    });
    preparePeerCommand({
      commandId,
      ownerUserId,
      operationId: "createPeerInvitation",
      targetType: "invitation",
      targetId: "idempotency_key_0001",
      requestHash: "c".repeat(64),
      approval: approvalBinding(ownerUserId)
    });
    assert.equal(
      markPeerCommandDispatched({ commandId, ownerUserId }).attemptCount,
      1
    );
    assert.equal(
      markPeerCommandFailed({
        commandId,
        ownerUserId,
        error: "daemon unavailable"
      }),
      true
    );
    assert.throws(
      () => markPeerCommandDispatched({ commandId, ownerUserId }),
      /not dispatchable/i
    );
    assert.equal(
      markPeerCommandReceiptRecovered({ commandId, ownerUserId }).attemptCount,
      1
    );
    const applied = applyPeerCommand({
      commandId,
      ownerUserId,
      resultHash: "d".repeat(64),
      apply: () => {
        getDatabase()
          .prepare(
            "INSERT INTO command_effects (id, value) VALUES ('effect_1', 'applied')"
          )
          .run();
        return "first";
      }
    });
    assert.equal(applied.applied, true);
    assert.equal(applied.value, "first");
    const replay = applyPeerCommand({
      commandId,
      ownerUserId,
      resultHash: "d".repeat(64),
      apply: () => {
        throw new Error("replay callback must not execute");
      }
    });
    assert.equal(replay.applied, false);
    assert.equal(replay.value, null);
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM command_effects")
          .get() as {
          count: number;
        }
      ).count,
      1
    );
    assert.throws(
      () =>
        applyPeerCommand({
          commandId,
          ownerUserId,
          resultHash: "e".repeat(64),
          apply: () => null
        }),
      /result hash does not match/i
    );
  });
});

test("failed local application rolls back both business state and terminal command state", async () => {
  await withCommandDatabase((ownerUserId) => {
    getDatabase().exec("CREATE TABLE command_effects (id TEXT PRIMARY KEY)");
    const commandId = derivePeerCommandId({
      ownerUserId,
      operationId: "removePeerDevice",
      targetType: "device",
      targetId: "device_1",
      requestHash: "f".repeat(64)
    });
    preparePeerCommand({
      commandId,
      ownerUserId,
      operationId: "removePeerDevice",
      targetType: "device",
      targetId: "device_1",
      requestHash: "f".repeat(64),
      approval: approvalBinding(ownerUserId, {
        authorizationId: "authorization_command_test_0002",
        capabilityId: "capability_command_test_0002",
        authorizationStateHash: "2".repeat(64)
      })
    });
    markPeerCommandDispatched({ commandId, ownerUserId });
    assert.throws(
      () =>
        applyPeerCommand({
          commandId,
          ownerUserId,
          apply: () => {
            getDatabase()
              .prepare(
                "INSERT INTO command_effects (id) VALUES ('rolled_back')"
              )
              .run();
            throw new Error("local CAS conflict");
          }
        }),
      /local CAS conflict/i
    );
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM command_effects")
          .get() as {
          count: number;
        }
      ).count,
      0
    );
    assert.equal(getPeerCommand(commandId)?.status, "dispatched");
    assert.equal(
      markPeerCommandReconciliationRequired({
        commandId,
        ownerUserId,
        reason: "daemon applied but local CAS failed"
      }),
      true
    );
    assert.deepEqual(
      listRecoverablePeerCommands({ ownerUserId, limit: 10 }).map(
        (entry) => entry.status
      ),
      ["reconciliation_required"]
    );
  });
});

test("daemon receipt evidence advances only the exact authorization-bound journal", async () => {
  await withCommandDatabase((ownerUserId) => {
    getDatabase().exec("CREATE TABLE command_effects (id TEXT PRIMARY KEY)");
    const requestHash = "4".repeat(64);
    const resultHash = "5".repeat(64);
    const authorityStateHash = "2".repeat(64);
    const actionDigest = "3".repeat(64);
    const approval = approvalBinding(ownerUserId, {
      authorizationId: "authorization_daemon_receipt_0001",
      authorizationStateHash: "1".repeat(64)
    });
    const commandId = derivePeerCommandId({
      ownerUserId,
      operationId: "createPeerInvitation",
      targetType: "invitation",
      targetId: "receipt_binding_target",
      requestHash: "a".repeat(64)
    });
    preparePeerCommand({
      commandId,
      ownerUserId,
      operationId: "createPeerInvitation",
      targetType: "invitation",
      targetId: "receipt_binding_target",
      requestHash: "a".repeat(64),
      approval,
      now: new Date("2026-07-15T12:00:00.000Z")
    });
    markPeerCommandDispatched({
      commandId,
      ownerUserId,
      now: new Date("2026-07-15T12:00:00.000Z")
    });
    const dispatchAuthorization = {
      authorityKeyId: "A".repeat(43),
      authorizationId: approval.authorizationId,
      ownerUserId,
      actorClass: approval.actorClass,
      actorId: approval.actorId,
      sessionId: approval.sessionId,
      deviceId: approval.deviceId,
      capabilityId: approval.capabilityId,
      actionDigest,
      authorityStateHash,
      invalidationEpoch: "0",
      approvalDeadline: approval.approvalDeadline,
      issuedAt: "2026-07-15T12:00:00.000Z"
    } as const;
    assert.equal(
      recordPeerCommandDaemonDispatch({
        ownerUserId,
        commandId,
        operation: "create_invitation",
        requestHash,
        authorization: dispatchAuthorization
      })?.requestHash,
      requestHash
    );
    assert.equal(
      recordPeerCommandDaemonDispatch({
        ownerUserId,
        commandId,
        operation: "create_invitation",
        requestHash,
        authorization: dispatchAuthorization
      })?.requestHash,
      requestHash
    );
    assert.equal(
      markPeerCommandFailed({
        commandId,
        ownerUserId,
        error: "connection closed after dispatch",
        now: new Date("2026-07-15T12:00:30.000Z")
      }),
      true
    );
    assert.equal(
      getPeerCommand(commandId)?.authorizationState,
      "receipt_unresolved"
    );
    assert.throws(
      () => markPeerCommandReceiptRecovered({ commandId, ownerUserId }),
      /not been durably verified/i
    );

    const receiptInput = {
      ownerUserId,
      commandId,
      operation: "create_invitation",
      requestHash,
      approvalDeadline: approval.approvalDeadline,
      committedAt: "2026-07-15T12:01:00.000Z",
      resultHash,
      currentAuthorityStateHash: authorityStateHash,
      authorization: {
        authorityKeyId: dispatchAuthorization.authorityKeyId,
        authorizationId: approval.authorizationId,
        actorClass: approval.actorClass,
        actorId: approval.actorId,
        actorDeviceId: approval.deviceId,
        sessionId: approval.sessionId,
        capabilityId: approval.capabilityId,
        actionDigest,
        invalidationEpoch: "0",
        authorityStateHash,
        verifiedAt: "2026-07-15T12:00:30.000Z"
      },
      evidence: {
        statementHash: "6".repeat(64),
        signature: "R".repeat(86)
      },
      now: new Date("2026-07-15T12:02:00.000Z")
    } as const;
    assert.throws(
      () =>
        verifyPeerCommandDaemonReceipt({
          ...receiptInput,
          ownerUserId: "another_owner"
        }),
      /another journal owner/i
    );
    assert.throws(
      () =>
        verifyPeerCommandDaemonReceipt({
          ...receiptInput,
          requestHash: "7".repeat(64)
        }),
      /does not match/i
    );
    assert.throws(
      () =>
        verifyPeerCommandDaemonReceipt({
          ...receiptInput,
          currentAuthorityStateHash: "8".repeat(64)
        }),
      /does not match/i
    );
    assert.equal(
      getPeerCommand(commandId)?.authorizationState,
      "receipt_unresolved"
    );

    const verified = verifyPeerCommandDaemonReceipt({
      ...receiptInput,
      approvalDeadline: approval.approvalDeadline.replace(".000Z", "Z")
    });
    assert.equal(verified?.authorizationState, "receipt_committed");
    assert.equal(verified?.daemonCommittedAt, receiptInput.committedAt);
    assert.equal(verified?.receiptCheckedAt, receiptInput.now.toISOString());
    assert.equal(
      markPeerCommandReceiptRecovered({
        commandId,
        ownerUserId,
        now: new Date("2026-07-15T12:03:00.000Z")
      }).status,
      "dispatched"
    );
    assert.throws(
      () =>
        applyPeerCommand({
          commandId,
          ownerUserId,
          resultHash: "9".repeat(64),
          apply: () => assert.fail("tampered receipt result must not apply")
        }),
      /exact verified daemon receipt/i
    );
    const applied = applyPeerCommand({
      commandId,
      ownerUserId,
      resultHash,
      apply: () => {
        getDatabase()
          .prepare(
            "INSERT INTO command_effects (id) VALUES ('receipt_applied')"
          )
          .run();
        return "applied";
      }
    });
    assert.equal(applied.applied, true);
    assert.equal(applied.value, "applied");
    assert.equal(
      verifyPeerCommandDaemonReceipt({
        ...receiptInput,
        now: new Date("2026-07-15T12:04:00.000Z")
      })?.status,
      "applied"
    );
    assert.equal(
      applyPeerCommand({
        commandId,
        ownerUserId,
        resultHash,
        apply: () => assert.fail("applied receipt replay must not execute")
      }).applied,
      false
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count FROM peer_idempotency_records
             WHERE owner_user_id = ?
               AND operation_id IN (
                 'peer_command_daemon_dispatch_v1',
                 'peer_command_daemon_receipt_v1'
               )`
          )
          .get(ownerUserId) as { count: number }
      ).count,
      2
    );
  });
});

test("new command rows reject missing, cross-owner, expired, and malformed approval bindings", async () => {
  await withCommandDatabase((ownerUserId) => {
    const commandId = derivePeerCommandId({
      ownerUserId,
      operationId: "revokePeerGrant",
      targetType: "grant",
      targetId: "grant_approval_negative",
      requestHash: "9".repeat(64)
    });
    const base = {
      commandId,
      ownerUserId,
      operationId: "revokePeerGrant",
      targetType: "grant",
      targetId: "grant_approval_negative",
      requestHash: "9".repeat(64)
    };
    assert.throws(
      () =>
        preparePeerCommand({
          ...base,
          approval: approvalBinding("another_owner")
        }),
      /approval binding is invalid/i
    );
    assert.throws(
      () =>
        preparePeerCommand({
          ...base,
          approval: approvalBinding(ownerUserId, {
            approvalDeadline: "2020-01-01T00:00:00.000Z"
          })
        }),
      /approval binding is invalid/i
    );
    assert.throws(
      () =>
        preparePeerCommand({
          ...base,
          approval: approvalBinding(ownerUserId, {
            authorizationStateHash: "not-a-hash"
          })
        }),
      /approval binding is invalid/i
    );
    assert.throws(
      () =>
        getDatabase()
          .prepare(
            `INSERT INTO peer_command_journal (
               command_id, owner_user_id, operation_id, target_type, target_id,
               request_hash, expected_version, status, attempt_count,
               last_error, created_at, updated_at
             ) VALUES (?, ?, 'revokePeerGrant', 'grant', 'legacy', ?, NULL,
                       'prepared', 0, '', ?, ?)`
          )
          .run(
            `${commandId}_legacy`,
            ownerUserId,
            "8".repeat(64),
            "2026-07-15T12:00:00.000Z",
            "2026-07-15T12:00:00.000Z"
          ),
      /exact current approval binding/i
    );
  });
});
