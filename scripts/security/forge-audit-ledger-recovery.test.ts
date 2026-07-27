import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { SecretsManager } from "../../apps/api/src/managers/platform/secrets-manager.js";
import { TamperEvidentGatewayAuditLedger } from "../../apps/api/src/security/security-audit-ledger.js";
import { runSecurityAuditLedgerHarness } from "./forge-audit-ledger-harness.js";
import { runSecurityAuditLedgerRecovery } from "./forge-audit-ledger-recovery.js";

const BACKGROUND_AUTHORIZATION_MIGRATION = new URL(
  "../../apps/api/migrations/112_background_job_authorization.sql",
  import.meta.url
);
const AUDIT_MIGRATION = new URL(
  "../../apps/api/migrations/118_security_audit_chain.sql",
  import.meta.url
);
const CORRELATION_MIGRATION = new URL(
  "../../apps/api/migrations/119_security_audit_correlation.sql",
  import.meta.url
);

function digest(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function insertSignedRow(input: {
  database: DatabaseSync;
  key: Uint8Array;
  sequence: number;
  previousMac: string;
}) {
  const row = {
    event_id: `security_audit_recovery_${input.sequence}`,
    occurred_at: "2026-07-27T21:00:00.000Z",
    principal_kind: "paired_client",
    subject_id: "subject_a",
    client_id: "client_a",
    action: "notes.read",
    resource: "forge://route/api/v1/notes",
    outcome: "admitted",
    reason: "gateway_admitted",
    policy_version: "forge-access-gateway/1",
    request_id: `request_${input.sequence}`,
    detail_json: JSON.stringify({
      method: "GET",
      routePath: "/api/v1/notes"
    }),
    previous_mac: input.previousMac
  };
  const eventMac = createHmac("sha256", input.key)
    .update(
      JSON.stringify([
        row.event_id,
        row.occurred_at,
        row.principal_kind,
        row.subject_id,
        row.client_id,
        row.action,
        row.resource,
        row.outcome,
        row.reason,
        row.policy_version,
        row.request_id,
        row.detail_json,
        row.previous_mac
      ]),
      "utf8"
    )
    .digest("hex");
  input.database
    .prepare(
      `INSERT INTO security_audit_events (
         sequence, event_id, occurred_at, principal_kind, subject_id, client_id,
         action, resource, outcome, reason, policy_version, request_id,
         connection_id, job_id, detail_json, previous_mac, event_mac, checkpoint
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 0)`
    )
    .run(
      input.sequence,
      row.event_id,
      row.occurred_at,
      row.principal_kind,
      row.subject_id,
      row.client_id,
      row.action,
      row.resource,
      row.outcome,
      row.reason,
      row.policy_version,
      row.request_id,
      row.detail_json,
      row.previous_mac,
      eventMac
    );
  return eventMac;
}

test("the recovery command is read-only during inspection and writes only an explicit receipt", async () => {
  const dataRoot = await mkdtemp(
    path.join(tmpdir(), "forge-audit-recovery-command-")
  );
  const databasePath = path.join(dataRoot, "forge.sqlite");
  const keyPath = path.join(dataRoot, ".forge-secrets.key");
  const rawKey = randomBytes(32);
  await writeFile(keyPath, rawKey.toString("base64"), { mode: 0o600 });
  const secrets = new SecretsManager();
  secrets.configure(dataRoot);
  const auditKey = secrets.deriveExistingCanonicalKey(
    "security-audit-ledger/v1"
  );
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(await readFile(BACKGROUND_AUTHORIZATION_MIGRATION, "utf8"));
    database.exec(await readFile(AUDIT_MIGRATION, "utf8"));
    database.exec(await readFile(CORRELATION_MIGRATION, "utf8"));
    const firstMac = insertSignedRow({
      database,
      key: auditKey,
      sequence: 1,
      previousMac: "0".repeat(64)
    });
    insertSignedRow({
      database,
      key: auditKey,
      sequence: 2,
      previousMac: firstMac
    });
    insertSignedRow({
      database,
      key: auditKey,
      sequence: 3,
      previousMac: firstMac
    });
  } finally {
    database.close();
  }
  await chmod(databasePath, 0o600);
  const harnessRoot = await mkdtemp(
    path.join(tmpdir(), "forge-audit-recovery-harness-")
  );
  const harnessTamperRoot = await mkdtemp(
    path.join(tmpdir(), "forge-audit-recovery-harness-tamper-")
  );
  await copyFile(databasePath, path.join(harnessRoot, "forge.sqlite"));
  await copyFile(keyPath, path.join(harnessRoot, ".forge-secrets.key"));
  await copyFile(databasePath, path.join(harnessTamperRoot, "forge.sqlite"));
  await copyFile(keyPath, path.join(harnessTamperRoot, ".forge-secrets.key"));
  await chmod(path.join(harnessRoot, "forge.sqlite"), 0o600);
  await chmod(path.join(harnessRoot, ".forge-secrets.key"), 0o600);
  await chmod(path.join(harnessTamperRoot, "forge.sqlite"), 0o600);
  await chmod(path.join(harnessTamperRoot, ".forge-secrets.key"), 0o600);

  try {
    const rehearsed = runSecurityAuditLedgerHarness([
      "--fixture-root",
      harnessRoot,
      "--tamper-root",
      harnessTamperRoot
    ]);
    assert.equal(rehearsed.appendedSequence, 4);
    assert.equal(rehearsed.outboundAttempts, 0);
    assert.equal(rehearsed.nonAuditWritesDeniedByAuthorizer, true);

    const filesBefore = await readdir(dataRoot);
    const databaseBefore = digest(await readFile(databasePath));
    const keyBefore = digest(await readFile(keyPath));
    const inspected = runSecurityAuditLedgerRecovery([
      "inspect",
      "--data-root",
      dataRoot
    ]);
    assert.deepEqual(inspected.forkSequences, [3]);
    assert.equal(inspected.recoveryRequired, true);
    assert.deepEqual(await readdir(dataRoot), filesBefore);
    assert.equal(digest(await readFile(databasePath)), databaseBefore);
    assert.equal(digest(await readFile(keyPath)), keyBefore);

    const recovered = runSecurityAuditLedgerRecovery([
      "recover",
      "--data-root",
      dataRoot,
      "--apply"
    ]);
    assert.equal(recovered.recoveryRequired, false);
    assert.equal(recovered.recoveryReceiptExists, true);
    assert.equal(digest(await readFile(databasePath)), databaseBefore);
    assert.equal(digest(await readFile(keyPath)), keyBefore);
    const receiptPath = path.join(
      dataRoot,
      ".forge-security-audit-fork-recovery.json"
    );
    assert.equal((await stat(receiptPath)).mode & 0o777, 0o600);
    const verified = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.doesNotThrow(
        () => new TamperEvidentGatewayAuditLedger(verified, auditKey, dataRoot)
      );
    } finally {
      verified.close();
    }
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(harnessRoot, { recursive: true, force: true });
    await rm(harnessTamperRoot, { recursive: true, force: true });
  }
});

test("read-existing key derivation refuses missing, linked, or permissive key files without creating one", async () => {
  const dataRoot = await mkdtemp(
    path.join(tmpdir(), "forge-audit-existing-key-")
  );
  const keyPath = path.join(dataRoot, ".forge-secrets.key");
  const outsidePath = path.join(
    tmpdir(),
    `forge-key-${randomBytes(6).toString("hex")}`
  );
  const outsideDirectory = `${outsidePath}-directory`;
  const secrets = new SecretsManager();
  secrets.configure(dataRoot);
  try {
    assert.throws(
      () => secrets.deriveExistingCanonicalKey("security-audit-ledger/v1"),
      /was not found/u
    );
    await assert.rejects(readFile(keyPath), /ENOENT/u);

    await writeFile(keyPath, randomBytes(32).toString("base64"), {
      mode: 0o644
    });
    assert.throws(
      () => secrets.deriveExistingCanonicalKey("security-audit-ledger/v1"),
      /inaccessible to other users/u
    );

    await rm(keyPath);
    await writeFile(outsidePath, randomBytes(32).toString("base64"), {
      mode: 0o600
    });
    await symlink(outsidePath, keyPath);
    assert.throws(
      () => secrets.deriveExistingCanonicalKey("security-audit-ledger/v1"),
      /regular file, not a link/u
    );
    await rm(keyPath);
    await mkdir(outsideDirectory);
    await writeFile(
      path.join(outsideDirectory, ".forge-secrets.key"),
      randomBytes(32).toString("base64"),
      { mode: 0o600 }
    );
    await symlink(outsideDirectory, path.join(dataRoot, "data"));
    assert.throws(
      () => secrets.deriveExistingCanonicalKey("security-audit-ledger/v1"),
      /was not found/u
    );
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(outsidePath, { force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});

test("recovery refuses committed SQLite state that remains only in a write-ahead log", async () => {
  const dataRoot = await mkdtemp(
    path.join(tmpdir(), "forge-audit-recovery-wal-")
  );
  const databasePath = path.join(dataRoot, "forge.sqlite");
  const keyPath = path.join(dataRoot, ".forge-secrets.key");
  await writeFile(keyPath, randomBytes(32).toString("base64"), {
    mode: 0o600
  });
  const secrets = new SecretsManager();
  secrets.configure(dataRoot);
  const auditKey = secrets.deriveExistingCanonicalKey(
    "security-audit-ledger/v1"
  );
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(await readFile(BACKGROUND_AUTHORIZATION_MIGRATION, "utf8"));
    database.exec(await readFile(AUDIT_MIGRATION, "utf8"));
    database.exec(await readFile(CORRELATION_MIGRATION, "utf8"));
    database.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
    insertSignedRow({
      database,
      key: auditKey,
      sequence: 1,
      previousMac: "0".repeat(64)
    });
    await chmod(databasePath, 0o600);
    assert.ok((await stat(`${databasePath}-wal`)).size > 0);
    assert.throws(
      () =>
        runSecurityAuditLedgerRecovery(["inspect", "--data-root", dataRoot]),
      /fully checkpointed SQLite database/u
    );
  } finally {
    database.close();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("the recovery command has a bounded import surface", async () => {
  for (const fileName of [
    "forge-audit-ledger-recovery.ts",
    "forge-audit-ledger-harness.ts"
  ]) {
    const source = await readFile(
      new URL(`./${fileName}`, import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(
      source,
      /from ["'](?:node:(?:http|https|net|tls|dgram|child_process|worker_threads)|[^"']*(?:\/app(?:\.|\/)|runtime|settings))/u
    );
  }
  const recoverySource = await readFile(
    new URL("./forge-audit-ledger-recovery.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    recoverySource,
    /DatabaseSync\(immutableDatabaseUrl, \{ readOnly: true \}\)/u
  );
  const sandboxProfile = await readFile(
    new URL("./forge-audit-ledger-harness.sb", import.meta.url),
    "utf8"
  );
  assert.match(sandboxProfile, /\(deny default\)/u);
  assert.doesNotMatch(sandboxProfile, /\(allow network/u);
  assert.match(
    sandboxProfile,
    /\(allow file-write\*[\s\S]*FIXTURE_ONE[\s\S]*FIXTURE_TWO/u
  );
});
