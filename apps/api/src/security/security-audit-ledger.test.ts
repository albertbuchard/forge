import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
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
