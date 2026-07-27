import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { mkdtemp } from "node:fs/promises";
import {
  isClosedSecurityAuditStorageError,
  TamperEvidentGatewayAuditLedger
} from "./security-audit-ledger.js";
import type { GatewayAuditEvent } from "./access-gateway.js";

const BACKGROUND_AUTHORIZATION_MIGRATION = new URL(
  "../../../../apps/api/migrations/112_background_job_authorization.sql",
  import.meta.url
);
const MIGRATION = new URL(
  "../../../../apps/api/migrations/118_security_audit_chain.sql",
  import.meta.url
);
const CORRELATION_MIGRATION = new URL(
  "../../../../apps/api/migrations/119_security_audit_correlation.sql",
  import.meta.url
);

function event(overrides: Partial<GatewayAuditEvent> = {}): GatewayAuditEvent {
  return {
    requestId: "request_a",
    method: "GET",
    routePath: "/api/v1/notes",
    action: "notes.read",
    resource: "forge://route/api/v1/notes",
    outcome: "admitted",
    reason: "gateway_admitted",
    principalKind: "paired_client",
    subjectId: "subject_a",
    clientId: "client_a",
    policyVersion: "forge-access-gateway/1",
    ...overrides
  };
}

async function fixture() {
  const dataDirectory = await mkdtemp(
    path.join(tmpdir(), "forge-security-audit-")
  );
  const database = new DatabaseSync(":memory:");
  database.exec(await readFile(BACKGROUND_AUTHORIZATION_MIGRATION, "utf8"));
  database.exec(await readFile(MIGRATION, "utf8"));
  database.exec(await readFile(CORRELATION_MIGRATION, "utf8"));
  return { dataDirectory, database };
}

async function fileFixture() {
  const dataDirectory = await mkdtemp(
    path.join(tmpdir(), "forge-security-audit-file-")
  );
  const databasePath = path.join(dataDirectory, "forge.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec(await readFile(BACKGROUND_AUTHORIZATION_MIGRATION, "utf8"));
  database.exec(await readFile(MIGRATION, "utf8"));
  database.exec(await readFile(CORRELATION_MIGRATION, "utf8"));
  await chmod(databasePath, 0o600);
  return { dataDirectory, database, databasePath };
}

function insertAuthenticatedRow(input: {
  database: DatabaseSync;
  key: Buffer;
  sequence: number;
  previousMac: string;
  requestId: string;
  checkpoint?: 0 | 1;
}) {
  const row = {
    event_id: `security_audit_${input.requestId}`,
    occurred_at: "2026-07-27T20:00:00.000Z",
    principal_kind: "paired_client",
    subject_id: "subject_a",
    client_id: "client_a",
    action: "notes.read",
    resource: "forge://route/api/v1/notes",
    outcome: "admitted",
    reason: "gateway_admitted",
    policy_version: "forge-access-gateway/1",
    request_id: input.requestId,
    connection_id: null,
    job_id: null,
    detail_json: JSON.stringify({
      method: "GET",
      routePath: "/api/v1/notes"
    }),
    previous_mac: input.previousMac
  };
  const payload = JSON.stringify([
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
  ]);
  const eventMac = createHmac("sha256", input.key)
    .update(payload, "utf8")
    .digest("hex");
  input.database
    .prepare(
      `INSERT INTO security_audit_events (
         sequence, event_id, occurred_at, principal_kind, subject_id, client_id,
         action, resource, outcome, reason, policy_version, request_id,
         connection_id, job_id, detail_json, previous_mac, event_mac, checkpoint
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      row.connection_id,
      row.job_id,
      row.detail_json,
      row.previous_mac,
      eventMac,
      input.checkpoint ?? 0
    );
  return eventMac;
}

test("only an already-closed SQLite audit store is a safe shutdown condition", () => {
  const closed = Object.assign(new Error("database is not open"), {
    code: "ERR_INVALID_STATE"
  });
  const writeFailure = Object.assign(new Error("disk I/O error"), {
    code: "SQLITE_IOERR"
  });

  assert.equal(isClosedSecurityAuditStorageError(closed), true);
  assert.equal(isClosedSecurityAuditStorageError(writeFailure), false);
  assert.equal(
    isClosedSecurityAuditStorageError(new Error("database is not open")),
    false
  );
});

test("security audit records are chained, redacted, and checkpointed", async () => {
  const { dataDirectory, database } = await fixture();
  try {
    const ledger = new TamperEvidentGatewayAuditLedger(
      database,
      Buffer.alloc(32, 7),
      dataDirectory,
      {
        checkpointInterval: 2,
        now: () => new Date("2026-07-26T15:00:00.000Z")
      }
    );
    ledger.record(
      event({
        connectionId: "forge-connection:request_a",
        jobId: "job_a"
      })
    );
    ledger.record(
      event({
        requestId: "request_b",
        outcome: "denied",
        reason: "gateway_scope_forbidden"
      })
    );

    assert.deepEqual(ledger.verify(), { entries: 2, lastSequence: 2 });
    const rows = database
      .prepare(
        `SELECT sequence, connection_id, job_id, detail_json, previous_mac,
                event_mac, checkpoint
           FROM security_audit_events
          ORDER BY sequence`
      )
      .all() as Array<{
      sequence: number;
      connection_id: string | null;
      job_id: string | null;
      detail_json: string;
      previous_mac: string;
      event_mac: string;
      checkpoint: number;
    }>;
    assert.equal(rows[0]?.previous_mac, "0".repeat(64));
    assert.equal(rows[0]?.connection_id, "forge-connection:request_a");
    assert.equal(rows[0]?.job_id, "job_a");
    assert.equal(rows[1]?.previous_mac, rows[0]?.event_mac);
    assert.equal(rows[1]?.checkpoint, 1);
    assert.doesNotMatch(JSON.stringify(rows), /authorization|cookie|secret/u);
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(dataDirectory, ".forge-security-audit-anchor.json"),
          "utf8"
        )
      ).sequence,
      2
    );
  } finally {
    database.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("security audit verification detects row changes and checkpoint truncation", async () => {
  for (const corruption of ["row", "checkpoint"] as const) {
    const { dataDirectory, database } = await fixture();
    try {
      const key = Buffer.alloc(32, 9);
      const ledger = new TamperEvidentGatewayAuditLedger(
        database,
        key,
        dataDirectory,
        { checkpointInterval: 2 }
      );
      ledger.record(event());
      ledger.record(event({ requestId: "request_b" }));
      if (corruption === "row") {
        database
          .prepare(
            "UPDATE security_audit_events SET outcome = 'allowed' WHERE sequence = 1"
          )
          .run();
      } else {
        database
          .prepare("DELETE FROM security_audit_events WHERE sequence = 2")
          .run();
      }

      assert.throws(
        () =>
          new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
            checkpointInterval: 2
          }),
        /corruption|truncation|mismatch/u
      );
    } finally {
      database.close();
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }
});

test("security audit verification rejects checkpoint flags and non-latest anchors", async () => {
  const { dataDirectory, database } = await fixture();
  try {
    const key = Buffer.alloc(32, 10);
    const ledger = new TamperEvidentGatewayAuditLedger(
      database,
      key,
      dataDirectory,
      { checkpointInterval: 2 }
    );
    for (let index = 1; index <= 4; index += 1) {
      ledger.record(event({ requestId: `request_${index}` }));
    }
    const anchorPath = path.join(
      dataDirectory,
      ".forge-security-audit-anchor.json"
    );
    const latestAnchor = await readFile(anchorPath, "utf8");

    database
      .prepare(
        "UPDATE security_audit_events SET checkpoint = 1 WHERE sequence = 3"
      )
      .run();
    assert.throws(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 2
        }),
      /checkpoint corruption at sequence 3/u
    );
    database
      .prepare(
        "UPDATE security_audit_events SET checkpoint = 0 WHERE sequence = 3"
      )
      .run();

    await rm(anchorPath);
    assert.throws(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 2
        }),
      /checkpoint truncation or mismatch/u
    );
    const sequenceTwo = database
      .prepare("SELECT event_mac FROM security_audit_events WHERE sequence = 2")
      .get() as { event_mac: string };
    await writeFile(
      anchorPath,
      `${JSON.stringify({
        version: 1,
        sequence: 2,
        eventMac: sequenceTwo.event_mac
      })}\n`,
      { mode: 0o600 }
    );
    assert.throws(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 2
        }),
      /checkpoint truncation or mismatch/u
    );
    await writeFile(anchorPath, latestAnchor, { mode: 0o600 });
    assert.doesNotThrow(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 2
        })
    );
  } finally {
    database.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("security audit retention seals deleted checkpoints and keeps verification bounded", async () => {
  const { dataDirectory, database } = await fixture();
  try {
    const key = Buffer.alloc(32, 11);
    const ledger = new TamperEvidentGatewayAuditLedger(
      database,
      key,
      dataDirectory,
      { checkpointInterval: 2, maximumRows: 4 }
    );
    for (let index = 1; index <= 8; index += 1) {
      ledger.record(event({ requestId: `request_${index}` }));
    }

    assert.deepEqual(ledger.verify(), { entries: 4, lastSequence: 8 });
    const retained = database
      .prepare(
        "SELECT sequence FROM security_audit_events ORDER BY sequence ASC"
      )
      .all() as Array<{ sequence: number }>;
    assert.deepEqual(
      retained.map((row) => row.sequence),
      [5, 6, 7, 8]
    );
    const receipt = JSON.parse(
      await readFile(
        path.join(dataDirectory, ".forge-security-audit-retention.json"),
        "utf8"
      )
    ) as { throughSequence: number };
    assert.equal(receipt.throughSequence, 4);
    assert.doesNotThrow(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 2,
          maximumRows: 4
        })
    );

    database
      .prepare(
        "UPDATE security_audit_retention_state SET base_sequence = 3 WHERE singleton = 1"
      )
      .run();
    assert.throws(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 2,
          maximumRows: 4
        }),
      /retention-state corruption/u
    );
  } finally {
    database.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("security audit retention rolls back a prepared receipt when the database rejects pruning", async () => {
  const { dataDirectory, database } = await fixture();
  try {
    const key = Buffer.alloc(32, 13);
    const ledger = new TamperEvidentGatewayAuditLedger(
      database,
      key,
      dataDirectory,
      { checkpointInterval: 2, maximumRows: 4 }
    );
    for (let index = 1; index <= 5; index += 1) {
      ledger.record(event({ requestId: `request_${index}` }));
    }
    database.exec(`
      CREATE TRIGGER reject_security_audit_retention
      BEFORE INSERT ON security_audit_retention_state
      BEGIN
        SELECT RAISE(ABORT, 'injected retention failure');
      END;
    `);
    assert.throws(
      () => ledger.record(event({ requestId: "request_6" })),
      /injected retention failure/u
    );
    assert.equal(
      await readFile(
        path.join(dataDirectory, ".forge-security-audit-anchor.json"),
        "utf8"
      ).then(() => true),
      true
    );
    await assert.rejects(
      readFile(
        path.join(
          dataDirectory,
          ".forge-security-audit-retention.json.pending"
        ),
        "utf8"
      ),
      /ENOENT/u
    );
    database.exec("DROP TRIGGER reject_security_audit_retention");
    assert.doesNotThrow(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 2,
          maximumRows: 4
        })
    );
  } finally {
    database.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("security audit retention refuses tampered checkpoint eligibility before pruning", async () => {
  const { dataDirectory, database } = await fixture();
  try {
    const key = Buffer.alloc(32, 14);
    const ledger = new TamperEvidentGatewayAuditLedger(
      database,
      key,
      dataDirectory,
      { checkpointInterval: 2, maximumRows: 4 }
    );
    for (let index = 1; index <= 5; index += 1) {
      ledger.record(event({ requestId: `request_${index}` }));
    }
    database
      .prepare(
        "UPDATE security_audit_events SET checkpoint = 1 WHERE sequence = 3"
      )
      .run();
    assert.throws(
      () => ledger.record(event({ requestId: "request_6" })),
      /checkpoint corruption at sequence 3/u
    );
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM security_audit_events")
          .get() as { count: number }
      ).count,
      5
    );
    assert.equal(
      database
        .prepare(
          "SELECT 1 FROM security_audit_retention_state WHERE singleton = 1"
        )
        .get(),
      undefined
    );
  } finally {
    database.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("separate Forge writers serialize against the current authenticated tail", async () => {
  const { dataDirectory, database, databasePath } = await fileFixture();
  const secondDatabase = new DatabaseSync(databasePath);
  try {
    const key = Buffer.alloc(32, 15);
    const first = new TamperEvidentGatewayAuditLedger(
      database,
      key,
      dataDirectory,
      { checkpointInterval: 2, maximumRows: 4 }
    );
    const second = new TamperEvidentGatewayAuditLedger(
      secondDatabase,
      key,
      dataDirectory,
      { checkpointInterval: 2, maximumRows: 4 }
    );
    for (let index = 1; index <= 8; index += 1) {
      (index % 2 === 0 ? second : first).record(
        event({ requestId: `request_${index}` })
      );
    }

    assert.deepEqual(first.verify(), { entries: 4, lastSequence: 8 });
    const rows = database
      .prepare(
        "SELECT sequence, previous_mac, event_mac FROM security_audit_events ORDER BY sequence"
      )
      .all() as Array<{
      sequence: number;
      previous_mac: string;
      event_mac: string;
    }>;
    const retainedBase = database
      .prepare(
        "SELECT base_sequence, base_mac FROM security_audit_retention_state WHERE singleton = 1"
      )
      .get() as { base_sequence: number; base_mac: string };
    let previousSequence = retainedBase.base_sequence;
    let previousMac = retainedBase.base_mac;
    for (const row of rows) {
      assert.equal(row.sequence, previousSequence + 1);
      assert.equal(row.previous_mac, previousMac);
      previousSequence = row.sequence;
      previousMac = row.event_mac;
    }
    const anchor = JSON.parse(
      await readFile(
        path.join(dataDirectory, ".forge-security-audit-anchor.json"),
        "utf8"
      )
    ) as { sequence: number };
    assert.equal(anchor.sequence, 8);
  } finally {
    secondDatabase.close();
    database.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("an authenticated legacy fork requires an explicit receipt and remains append-only", async () => {
  const { dataDirectory, database } = await fixture();
  try {
    const key = Buffer.alloc(32, 17);
    const initial = new TamperEvidentGatewayAuditLedger(
      database,
      key,
      dataDirectory,
      { checkpointInterval: 100 }
    );
    initial.record(event({ requestId: "request_1" }));
    initial.record(event({ requestId: "request_2" }));
    const sequenceTwo = database
      .prepare("SELECT event_mac FROM security_audit_events WHERE sequence = 2")
      .get() as { event_mac: string };
    const sequenceThree = insertAuthenticatedRow({
      database,
      key,
      sequence: 3,
      previousMac: sequenceTwo.event_mac,
      requestId: "request_3"
    });
    insertAuthenticatedRow({
      database,
      key,
      sequence: 4,
      previousMac: sequenceThree,
      requestId: "request_4"
    });
    const sequenceFive = insertAuthenticatedRow({
      database,
      key,
      sequence: 5,
      previousMac: sequenceTwo.event_mac,
      requestId: "request_5"
    });
    insertAuthenticatedRow({
      database,
      key,
      sequence: 6,
      previousMac: sequenceFive,
      requestId: "request_6"
    });

    assert.throws(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 100
        }),
      /corruption at sequence 5/u
    );
    const inspect = new TamperEvidentGatewayAuditLedger(
      database,
      key,
      dataDirectory,
      { checkpointInterval: 100, forkRecoveryMode: "inspect" }
    );
    assert.deepEqual(inspect.getForkInspection()?.forkSequences, [5]);
    assert.equal(inspect.getForkInspection()?.recoveryRequired, true);
    const receiptPath = path.join(
      dataDirectory,
      ".forge-security-audit-fork-recovery.json"
    );
    assert.equal(existsSync(receiptPath), false);

    new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
      checkpointInterval: 100,
      forkRecoveryMode: "apply"
    });
    assert.equal(existsSync(receiptPath), true);
    const recovered = new TamperEvidentGatewayAuditLedger(
      database,
      key,
      dataDirectory,
      { checkpointInterval: 100 }
    );
    recovered.record(event({ requestId: "request_7" }));
    const appended = database
      .prepare(
        "SELECT sequence, previous_mac FROM security_audit_events WHERE sequence = 7"
      )
      .get() as { sequence: number; previous_mac: string };
    const previous = database
      .prepare("SELECT event_mac FROM security_audit_events WHERE sequence = 6")
      .get() as { event_mac: string };
    assert.equal(appended.previous_mac, previous.event_mac);

    const originalReceipt = await readFile(receiptPath, "utf8");
    const tampered = JSON.parse(originalReceipt) as { rowSetSha256: string };
    tampered.rowSetSha256 = "f".repeat(64);
    await writeFile(receiptPath, `${JSON.stringify(tampered)}\n`, {
      mode: 0o600
    });
    assert.throws(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 100
        }),
      /receipt is corrupt/u
    );
    await writeFile(receiptPath, originalReceipt, { mode: 0o600 });
    database
      .prepare(
        "UPDATE security_audit_events SET outcome = 'changed' WHERE sequence = 4"
      )
      .run();
    assert.throws(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 100
        }),
      /chain corruption at sequence 4/u
    );
    database
      .prepare(
        "UPDATE security_audit_events SET outcome = 'admitted' WHERE sequence = 4"
      )
      .run();
    const sequenceSix = database
      .prepare("SELECT event_mac FROM security_audit_events WHERE sequence = 6")
      .get() as { event_mac: string };
    insertAuthenticatedRow({
      database,
      key,
      sequence: 8,
      previousMac: sequenceSix.event_mac,
      requestId: "request_8"
    });
    assert.throws(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 100
        }),
      /corruption at sequence 8/u
    );
    database
      .prepare("DELETE FROM security_audit_events WHERE sequence = 8")
      .run();
    await rm(receiptPath);
    assert.throws(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 100
        }),
      /corruption at sequence 5/u
    );
  } finally {
    database.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("fork recovery refuses clean ledgers and unreachable ancestry", async () => {
  const { dataDirectory, database } = await fixture();
  try {
    const key = Buffer.alloc(32, 18);
    const ledger = new TamperEvidentGatewayAuditLedger(
      database,
      key,
      dataDirectory
    );
    ledger.record(event({ requestId: "request_1" }));
    assert.throws(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          forkRecoveryMode: "apply"
        }),
      /refused an unnecessary/u
    );
    assert.equal(
      existsSync(
        path.join(dataDirectory, ".forge-security-audit-fork-recovery.json")
      ),
      false
    );
    insertAuthenticatedRow({
      database,
      key,
      sequence: 2,
      previousMac: "a".repeat(64),
      requestId: "request_2"
    });
    assert.throws(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          forkRecoveryMode: "inspect"
        }),
      /unreachable security audit ancestry at sequence 2/u
    );
  } finally {
    database.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("fork recovery binds the newest deterministic checkpoint anchor", async () => {
  const { dataDirectory, database } = await fixture();
  try {
    const key = Buffer.alloc(32, 23);
    const initial = new TamperEvidentGatewayAuditLedger(
      database,
      key,
      dataDirectory,
      { checkpointInterval: 2 }
    );
    initial.record(event({ requestId: "request_1" }));
    initial.record(event({ requestId: "request_2" }));
    const sequenceTwo = database
      .prepare("SELECT event_mac FROM security_audit_events WHERE sequence = 2")
      .get() as { event_mac: string };
    const sequenceThree = insertAuthenticatedRow({
      database,
      key,
      sequence: 3,
      previousMac: sequenceTwo.event_mac,
      requestId: "request_3"
    });
    const sequenceFour = insertAuthenticatedRow({
      database,
      key,
      sequence: 4,
      previousMac: sequenceThree,
      requestId: "request_4",
      checkpoint: 1
    });
    const sequenceFive = insertAuthenticatedRow({
      database,
      key,
      sequence: 5,
      previousMac: sequenceTwo.event_mac,
      requestId: "request_5"
    });
    const sequenceSix = insertAuthenticatedRow({
      database,
      key,
      sequence: 6,
      previousMac: sequenceFive,
      requestId: "request_6",
      checkpoint: 1
    });
    const anchorPath = path.join(
      dataDirectory,
      ".forge-security-audit-anchor.json"
    );
    await writeFile(
      anchorPath,
      `${JSON.stringify({
        version: 1,
        sequence: 6,
        eventMac: sequenceSix
      })}\n`,
      { mode: 0o600 }
    );
    new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
      checkpointInterval: 2,
      forkRecoveryMode: "apply"
    });
    const receipt = JSON.parse(
      await readFile(
        path.join(dataDirectory, ".forge-security-audit-fork-recovery.json"),
        "utf8"
      )
    ) as { anchorSequence: number; anchorEventMac: string };
    assert.equal(receipt.anchorSequence, 6);
    assert.equal(receipt.anchorEventMac, sequenceSix);

    await writeFile(
      anchorPath,
      `${JSON.stringify({
        version: 1,
        sequence: 4,
        eventMac: sequenceFour
      })}\n`,
      { mode: 0o600 }
    );
    assert.throws(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 2
        }),
      /checkpoint truncation or mismatch/u
    );
    await rm(anchorPath);
    assert.throws(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 2
        }),
      /checkpoint truncation or mismatch/u
    );
  } finally {
    database.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("retention hands a recovered fork into a versioned receipt before pruning", async () => {
  const { dataDirectory, database } = await fixture();
  try {
    const key = Buffer.alloc(32, 19);
    const initial = new TamperEvidentGatewayAuditLedger(
      database,
      key,
      dataDirectory,
      { checkpointInterval: 10 }
    );
    initial.record(event({ requestId: "request_1" }));
    initial.record(event({ requestId: "request_2" }));
    const sequenceTwo = database
      .prepare("SELECT event_mac FROM security_audit_events WHERE sequence = 2")
      .get() as { event_mac: string };
    const sequenceThree = insertAuthenticatedRow({
      database,
      key,
      sequence: 3,
      previousMac: sequenceTwo.event_mac,
      requestId: "request_3"
    });
    insertAuthenticatedRow({
      database,
      key,
      sequence: 4,
      previousMac: sequenceThree,
      requestId: "request_4"
    });
    const sequenceFive = insertAuthenticatedRow({
      database,
      key,
      sequence: 5,
      previousMac: sequenceTwo.event_mac,
      requestId: "request_5"
    });
    insertAuthenticatedRow({
      database,
      key,
      sequence: 6,
      previousMac: sequenceFive,
      requestId: "request_6"
    });
    new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
      checkpointInterval: 10,
      forkRecoveryMode: "apply"
    });
    const ledger = new TamperEvidentGatewayAuditLedger(
      database,
      key,
      dataDirectory,
      { checkpointInterval: 10, maximumRows: 20 }
    );
    for (let index = 7; index <= 40; index += 1) {
      ledger.record(event({ requestId: `request_${index}` }));
    }
    const state = database
      .prepare(
        "SELECT base_sequence FROM security_audit_retention_state WHERE singleton = 1"
      )
      .get() as { base_sequence: number };
    assert.ok(state.base_sequence >= 6);
    const receipt = JSON.parse(
      await readFile(
        path.join(dataDirectory, ".forge-security-audit-retention.json"),
        "utf8"
      )
    ) as {
      version: number;
      forkRecoveryReceiptMac?: string;
    };
    assert.equal(receipt.version, 2);
    assert.match(receipt.forkRecoveryReceiptMac ?? "", /^[0-9a-f]{64}$/u);
    assert.doesNotThrow(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 10,
          maximumRows: 20
        })
    );
  } finally {
    database.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test("pending anchor and retention receipts recover monotonically after a crash", async () => {
  const { dataDirectory, database } = await fixture();
  try {
    const key = Buffer.alloc(32, 21);
    const ledger = new TamperEvidentGatewayAuditLedger(
      database,
      key,
      dataDirectory,
      { checkpointInterval: 2, maximumRows: 4 }
    );
    for (let index = 1; index <= 8; index += 1) {
      ledger.record(event({ requestId: `request_${index}` }));
    }
    const anchorPath = path.join(
      dataDirectory,
      ".forge-security-audit-anchor.json"
    );
    const pendingAnchorPath = `${anchorPath}.pending`;
    const retentionPath = path.join(
      dataDirectory,
      ".forge-security-audit-retention.json"
    );
    await rename(anchorPath, pendingAnchorPath);
    await rename(retentionPath, `${retentionPath}.pending`);
    assert.doesNotThrow(
      () =>
        new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
          checkpointInterval: 2,
          maximumRows: 4
        })
    );
    assert.equal(existsSync(anchorPath), true);
    assert.equal(existsSync(retentionPath), true);

    const rowSix = database
      .prepare("SELECT event_mac FROM security_audit_events WHERE sequence = 6")
      .get() as { event_mac: string };
    await writeFile(
      pendingAnchorPath,
      `${JSON.stringify({
        version: 1,
        sequence: 6,
        eventMac: rowSix.event_mac
      })}\n`,
      { mode: 0o600 }
    );
    new TamperEvidentGatewayAuditLedger(database, key, dataDirectory, {
      checkpointInterval: 2,
      maximumRows: 4
    });
    assert.equal(
      (
        JSON.parse(await readFile(anchorPath, "utf8")) as {
          sequence: number;
        }
      ).sequence,
      8
    );
    assert.equal(existsSync(pendingAnchorPath), false);
  } finally {
    database.close();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
