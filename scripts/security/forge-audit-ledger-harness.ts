import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { constants as sqliteConstants, DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { SecretsManager } from "../../apps/api/src/managers/platform/secrets-manager.js";
import { TamperEvidentGatewayAuditLedger } from "../../apps/api/src/security/security-audit-ledger.js";
import { runSecurityAuditLedgerRecovery } from "./forge-audit-ledger-recovery.js";

function sha256(filePath: string) {
  const digest = createHash("sha256");
  const handle = openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        digest.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    closeSync(handle);
  }
  return digest.digest("hex");
}

function parseFixtureRoots(argv: readonly string[]) {
  if (
    argv.length !== 4 ||
    argv[0] !== "--fixture-root" ||
    !path.isAbsolute(argv[1] ?? "") ||
    argv[2] !== "--tamper-root" ||
    !path.isAbsolute(argv[3] ?? "")
  ) {
    throw new Error(
      "Usage: forge-audit-ledger-harness --fixture-root /absolute/disposable/path --tamper-root /absolute/disposable/tamper-path"
    );
  }
  return {
    fixtureRoot: path.resolve(argv[1]),
    tamperRoot: path.resolve(argv[3])
  };
}

export function runSecurityAuditLedgerHarness(argv: readonly string[]) {
  const { fixtureRoot, tamperRoot } = parseFixtureRoots(argv);
  const databasePath = path.join(fixtureRoot, "forge.sqlite");
  const keyPath = path.join(fixtureRoot, ".forge-secrets.key");
  const initialFiles = readdirSync(fixtureRoot).sort();
  const anchorName = ".forge-security-audit-anchor.json";
  assert.ok(initialFiles.includes(".forge-secrets.key"));
  assert.ok(initialFiles.includes("forge.sqlite"));
  assert.ok(
    initialFiles.every((fileName) =>
      new Set([".forge-secrets.key", anchorName, "forge.sqlite"]).has(fileName)
    )
  );
  assert.equal(statSync(fixtureRoot).mode & 0o777, 0o700);
  assert.equal(statSync(databasePath).mode & 0o777, 0o600);
  assert.equal(statSync(keyPath).mode & 0o777, 0o600);
  const databaseBefore = sha256(databasePath);
  const keyBefore = sha256(keyPath);

  let outboundAttempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    outboundAttempts += 1;
    throw new Error("Network access is forbidden in the audit harness.");
  }) as typeof fetch;
  try {
    const inspection = runSecurityAuditLedgerRecovery([
      "inspect",
      "--data-root",
      fixtureRoot
    ]);
    assert.equal(inspection.recoveryRequired, true);
    assert.ok(inspection.forkSequences.length > 0);
    if (inspection.lastSequence >= 100) {
      assert.ok(
        initialFiles.includes(anchorName),
        "The live-specific rehearsal must include the real audit anchor."
      );
    }
    assert.equal(sha256(databasePath), databaseBefore);
    assert.equal(sha256(keyPath), keyBefore);
    assert.deepEqual(readdirSync(fixtureRoot).sort(), initialFiles);

    const recovery = runSecurityAuditLedgerRecovery([
      "recover",
      "--data-root",
      fixtureRoot,
      "--apply"
    ]);
    assert.equal(recovery.recoveryRequired, false);
    assert.equal(recovery.recoveryReceiptExists, true);
    assert.equal(sha256(databasePath), databaseBefore);
    assert.equal(sha256(keyPath), keyBefore);

    const secrets = new SecretsManager();
    secrets.configure(fixtureRoot);
    const auditKey = secrets.deriveExistingCanonicalKey(
      "security-audit-ledger/v1"
    );
    const database = new DatabaseSync(databasePath);
    let beforeCount = 0;
    let beforeSequence = 0;
    let beforeMac = "";
    try {
      const before = database
        .prepare(
          `SELECT COUNT(*) AS count, MAX(sequence) AS sequence
             FROM security_audit_events`
        )
        .get() as { count: number; sequence: number };
      beforeCount = Number(before.count);
      beforeSequence = Number(before.sequence);
      beforeMac = (
        database
          .prepare(
            "SELECT event_mac FROM security_audit_events WHERE sequence = ?"
          )
          .get(beforeSequence) as { event_mac: string }
      ).event_mac;
      database.setAuthorizer((actionCode, tableName) => {
        if (
          actionCode === sqliteConstants.SQLITE_INSERT ||
          actionCode === sqliteConstants.SQLITE_UPDATE ||
          actionCode === sqliteConstants.SQLITE_DELETE
        ) {
          return tableName === "security_audit_events" ||
            tableName === "security_audit_retention_state"
            ? sqliteConstants.SQLITE_OK
            : sqliteConstants.SQLITE_DENY;
        }
        return sqliteConstants.SQLITE_OK;
      });
      const ledger = new TamperEvidentGatewayAuditLedger(
        database,
        auditKey,
        fixtureRoot
      );
      ledger.record({
        requestId: "audit-recovery-harness",
        method: "GET",
        routePath: "/api/v1/health",
        action: "system.health.read",
        resource: "forge://route/api/v1/health",
        outcome: "admitted",
        reason: "audit_recovery_harness",
        principalKind: "local_owner",
        subjectId: "local-owner",
        clientId: "audit-recovery-harness",
        policyVersion: "forge-access-gateway/1"
      });
      database.setAuthorizer(null);
      const appended = database
        .prepare(
          `SELECT sequence, previous_mac
             FROM security_audit_events
            WHERE sequence = ?`
        )
        .get(beforeSequence + 1) as
        | { sequence: number; previous_mac: string }
        | undefined;
      assert.equal(appended?.sequence, beforeSequence + 1);
      assert.equal(appended?.previous_mac, beforeMac);
      const after = database
        .prepare("SELECT COUNT(*) AS count FROM security_audit_events")
        .get() as { count: number };
      assert.equal(Number(after.count), beforeCount + 1);
    } finally {
      database.setAuthorizer(null);
      database.close();
    }

    const reopened = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.doesNotThrow(
        () =>
          new TamperEvidentGatewayAuditLedger(reopened, auditKey, fixtureRoot)
      );
    } finally {
      reopened.close();
    }

    const allowedMainFiles = new Set([
      ".forge-secrets.key",
      anchorName,
      ".forge-security-audit-fork-recovery.json",
      "forge.sqlite",
      "forge.sqlite-shm",
      "forge.sqlite-wal"
    ]);
    for (const fileName of readdirSync(fixtureRoot)) {
      assert.ok(
        allowedMainFiles.has(fileName),
        `Unexpected harness artifact: ${fileName}`
      );
    }
    assert.equal(sha256(keyPath), keyBefore);

    const tamperDatabase = path.join(tamperRoot, "forge.sqlite");
    const tamperKey = path.join(tamperRoot, ".forge-secrets.key");
    const receiptName = ".forge-security-audit-fork-recovery.json";
    const tamperReceipt = path.join(tamperRoot, receiptName);
    assert.deepEqual(readdirSync(tamperRoot).sort(), initialFiles);
    assert.equal(statSync(tamperRoot).mode & 0o777, 0o700);
    assert.equal(statSync(tamperDatabase).mode & 0o777, 0o600);
    assert.equal(statSync(tamperKey).mode & 0o777, 0o600);
    const tamperKeyBefore = sha256(tamperKey);
    runSecurityAuditLedgerRecovery([
      "recover",
      "--data-root",
      tamperRoot,
      "--apply"
    ]);
    chmodSync(tamperReceipt, 0o600);
    const receipt = JSON.parse(readFileSync(tamperReceipt, "utf8")) as Record<
      string,
      unknown
    >;
    const originalReceiptMac = String(receipt.receiptMac);
    receipt.receiptMac = `${
      originalReceiptMac.startsWith("0") ? "1" : "0"
    }${originalReceiptMac.slice(1)}`;
    writeFileSync(tamperReceipt, `${JSON.stringify(receipt)}\n`, {
      mode: 0o600
    });
    const tamperedDatabase = new DatabaseSync(tamperDatabase, {
      readOnly: true
    });
    try {
      assert.throws(
        () =>
          new TamperEvidentGatewayAuditLedger(
            tamperedDatabase,
            auditKey,
            tamperRoot
          ),
        /receipt is corrupt/u
      );
    } finally {
      tamperedDatabase.close();
    }
    assert.equal(sha256(tamperKey), tamperKeyBefore);
    assert.equal(outboundAttempts, 0);
    return {
      inspectedForkSequences: inspection.forkSequences,
      recoveredThroughSequence: recovery.lastSequence,
      appendedSequence: beforeSequence + 1,
      nonAuditWritesDeniedByAuthorizer: true,
      outboundAttempts,
      anchorPresent: initialFiles.includes(anchorName)
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const executablePath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (executablePath === import.meta.url) {
  try {
    process.stdout.write(
      `${JSON.stringify(runSecurityAuditLedgerHarness(process.argv.slice(2)))}\n`
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
