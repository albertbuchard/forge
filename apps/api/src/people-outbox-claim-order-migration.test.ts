import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { PEER_OUTBOX_CANDIDATE_STATEMENTS } from "./repositories/peer-delivery.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migration100 = "100_people_read_model_revision.sql";
const migration101 = "101_preference_integrity_and_signal_idempotency.sql";
const migration102 = "102_people_outbox_claim_order_indexes.sql";
const timestamp = "2026-07-16T12:00:00.000Z";
const expiry = "2026-07-17T12:00:00.000Z";
const ownerUserId = "user_outbox_order";

async function migrationFilesThrough(lastMigration: string): Promise<string[]> {
  return (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file <= lastMigration)
    .sort();
}

async function applyMigrationsThrough(
  database: DatabaseSync,
  lastMigration: string
): Promise<void> {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  for (const file of await migrationFilesThrough(lastMigration)) {
    if (database.prepare("SELECT 1 FROM migrations WHERE id = ?").get(file)) {
      continue;
    }
    database.exec("BEGIN");
    try {
      database.exec(await readFile(path.join(migrationsDir, file), "utf8"));
      database
        .prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)")
        .run(file, timestamp);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

async function withDatabase(
  operation: (database: DatabaseSync) => Promise<void> | void
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-outbox-order-"));
  const database = new DatabaseSync(path.join(root, "forge.sqlite"));
  try {
    await operation(database);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

function seedDeliveryIdentity(database: DatabaseSync): {
  relationshipId: string;
  remoteDeviceId: string;
} {
  const relationshipId = "relationship_outbox_order";
  const localPrincipalId = "principal_outbox_order_local";
  const remotePrincipalId = "principal_outbox_order_remote";
  const remoteDeviceId = "device_outbox_order_remote";
  database
    .prepare(
      `INSERT INTO users (
         id, kind, handle, display_name, description, accent_color,
         created_at, updated_at
       ) VALUES (?, 'human', ?, ?, '', '#123456', ?, ?)`
    )
    .run(ownerUserId, ownerUserId, ownerUserId, timestamp, timestamp);
  const insertPrincipal = database.prepare(
    `INSERT INTO forge_principals (
       id, owner_user_id, principal_kind, public_principal_id,
       root_public_key, root_key_secret_id, display_label, trust_state,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?)`
  );
  insertPrincipal.run(
    localPrincipalId,
    ownerUserId,
    "local",
    "public_outbox_order_local",
    "a".repeat(64),
    "secret_outbox_order_local",
    "Local Forge",
    timestamp,
    timestamp
  );
  insertPrincipal.run(
    remotePrincipalId,
    ownerUserId,
    "remote",
    "public_outbox_order_remote",
    "b".repeat(64),
    null,
    "Remote Forge",
    timestamp,
    timestamp
  );
  database
    .prepare(
      `INSERT INTO forge_devices (
         id, owner_user_id, principal_id, certified_public_key,
         private_key_secret_id, certificate, label, device_type, status,
         transport_endpoints_json, capabilities_json, added_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'test', 'approved', '[]', '[]', ?, ?, ?)`
    )
    .run(
      remoteDeviceId,
      ownerUserId,
      remotePrincipalId,
      "c".repeat(64),
      "d".repeat(128),
      "Remote device",
      timestamp,
      timestamp,
      timestamp
    );
  database
    .prepare(
      `INSERT INTO peer_relationships (
         id, owner_user_id, local_principal_id, remote_principal_id,
         local_person_id, status, negotiated_protocol_version,
         verification_phrase_hash, transport_privacy_mode,
         highest_received_sequence, highest_sent_sequence,
         established_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, 'active', 'forge-peer/1', ?, 'fastest',
                 0, 0, ?, ?, ?)`
    )
    .run(
      relationshipId,
      ownerUserId,
      localPrincipalId,
      remotePrincipalId,
      "e".repeat(64),
      timestamp,
      timestamp,
      timestamp
    );
  return { relationshipId, remoteDeviceId };
}

function seedOutboxRows(
  database: DatabaseSync,
  options: { legacyLeaseState?: boolean } = {}
): void {
  const { relationshipId, remoteDeviceId } = seedDeliveryIdentity(database);
  const insert = database.prepare(
    `INSERT INTO peer_outbox (
       envelope_id, owner_user_id, relationship_id, recipient_device_id,
       channel_id, sequence, previous_acknowledgement, message_kind,
       mls_epoch, ciphertext, ciphertext_hash, size_bytes, status,
       attempt_count, next_attempt_at, last_attempt_at, acknowledged_at,
       expires_at, last_error, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 0, 'typed_query_response', 1, ?, ?, 1,
               ?, 0, ?, ?, NULL, ?, '', ?, ?)`
  );
  const rows = [
    ["candidate_A", "pending", timestamp, null],
    ["candidate_a", "failed", timestamp, timestamp],
    [
      "candidate_stale",
      "in_flight",
      options.legacyLeaseState ? timestamp : "2026-07-16T11:01:00.000Z",
      "2026-07-16T11:00:00.000Z"
    ],
    [
      "candidate_fresh",
      "in_flight",
      options.legacyLeaseState ? timestamp : "2026-07-16T12:01:00.000Z",
      timestamp
    ]
  ] as const;
  for (const [
    index,
    [envelopeId, status, nextAttemptAt, lastAttemptAt]
  ] of rows.entries()) {
    insert.run(
      envelopeId,
      ownerUserId,
      relationshipId,
      remoteDeviceId,
      "channel_outbox_order_0001",
      index + 1,
      Buffer.from([index + 1]),
      String(index + 1).padStart(64, "0"),
      status,
      nextAttemptAt,
      lastAttemptAt,
      expiry,
      timestamp,
      timestamp
    );
  }
}

function queueSnapshot(database: DatabaseSync): unknown[] {
  return database
    .prepare(
      `SELECT envelope_id, status, attempt_count, next_attempt_at,
              last_attempt_at, expires_at, hex(ciphertext) AS ciphertext
       FROM peer_outbox ORDER BY envelope_id`
    )
    .all();
}

test("migration 101 preserves a valid default pointer and deterministically repairs an invalid one", async () => {
  await withDatabase(async (database) => {
    await applyMigrationsThrough(database, migration100);
    const insertProfile = database.prepare(
      `INSERT INTO preference_profiles (
         id, user_id, domain, default_context_id, model_version,
         created_at, updated_at
       ) VALUES (?, 'user_operator', ?, ?, 'v1', ?, ?)`
    );
    insertProfile.run(
      "profile_declared",
      "migration-101-declared",
      "context_declared",
      timestamp,
      timestamp
    );
    insertProfile.run(
      "profile_fallback",
      "migration-101-fallback",
      "context_missing",
      timestamp,
      timestamp
    );
    const insertContext = database.prepare(
      `INSERT INTO preference_contexts (
         id, profile_id, name, description, share_mode, active, is_default,
         decay_days, created_at, updated_at
       ) VALUES (?, ?, ?, '', 'blended', ?, ?, 90, ?, ?)`
    );
    insertContext.run(
      "context_declared",
      "profile_declared",
      "Declared context",
      0,
      0,
      "2026-07-16T10:00:00.000Z",
      timestamp
    );
    insertContext.run(
      "context_other",
      "profile_declared",
      "Other active context",
      1,
      1,
      "2026-07-16T09:00:00.000Z",
      timestamp
    );
    insertContext.run(
      "context_fallback_active",
      "profile_fallback",
      "Active fallback",
      1,
      0,
      "2026-07-16T11:00:00.000Z",
      timestamp
    );
    insertContext.run(
      "context_fallback_default",
      "profile_fallback",
      "Declared active default",
      1,
      1,
      "2026-07-16T12:00:00.000Z",
      timestamp
    );

    await applyMigrationsThrough(database, migration101);

    const profiles = database
      .prepare(
        `SELECT id, default_context_id
         FROM preference_profiles
         WHERE id IN ('profile_declared', 'profile_fallback')
         ORDER BY id`
      )
      .all()
      .map((row) => ({ ...row }));
    assert.deepEqual(profiles, [
      {
        id: "profile_declared",
        default_context_id: "context_declared"
      },
      {
        id: "profile_fallback",
        default_context_id: "context_fallback_default"
      }
    ]);
    const defaults = database
      .prepare(
        `SELECT profile_id, id, active, is_default
         FROM preference_contexts
         WHERE profile_id IN ('profile_declared', 'profile_fallback')
           AND is_default = 1
         ORDER BY profile_id`
      )
      .all()
      .map((row) => ({ ...row }));
    assert.deepEqual(defaults, [
      {
        profile_id: "profile_declared",
        id: "context_declared",
        active: 1,
        is_default: 1
      },
      {
        profile_id: "profile_fallback",
        id: "context_fallback_default",
        active: 1,
        is_default: 1
      }
    ]);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  });
});

test("migration 102 preserves populated delivery rows and installs exact partial indexes", async () => {
  await withDatabase(async (database) => {
    await applyMigrationsThrough(database, migration101);
    seedOutboxRows(database, { legacyLeaseState: true });
    const before = queueSnapshot(database);

    await applyMigrationsThrough(database, migration102);

    const after = queueSnapshot(database) as Array<{
      envelope_id: string;
      status: string;
      attempt_count: number;
      next_attempt_at: string;
      last_attempt_at: string | null;
      expires_at: string;
      ciphertext: string;
    }>;
    assert.deepEqual(
      after.map(({ status: _status, next_attempt_at: _next, ...row }) => row),
      (before as typeof after).map(
        ({ status: _status, next_attempt_at: _next, ...row }) => row
      )
    );
    assert.equal(
      after.find((row) => row.envelope_id === "candidate_stale")
        ?.next_attempt_at,
      "2026-07-16T11:01:00.000Z"
    );
    assert.equal(
      after.find((row) => row.envelope_id === "candidate_fresh")
        ?.next_attempt_at,
      "2026-07-16T12:01:00.000Z"
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    const indexes = database
      .prepare(
        `SELECT name, sql FROM sqlite_master
         WHERE type = 'index' AND name IN (
           'idx_peer_outbox_due_claim_order',
           'idx_peer_outbox_in_flight_claim_order',
           'idx_peer_outbox_active_expiry'
         ) ORDER BY name`
      )
      .all() as Array<{ name: string; sql: string }>;
    assert.deepEqual(
      indexes.map((row) => row.name),
      [
        "idx_peer_outbox_active_expiry",
        "idx_peer_outbox_due_claim_order",
        "idx_peer_outbox_in_flight_claim_order"
      ]
    );
    assert.match(
      indexes[0]!.sql,
      /where status in \('pending', 'in_flight', 'failed'\)/iu
    );
    assert.match(indexes[1]!.sql, /attempt_count < 12/iu);
    assert.match(indexes[2]!.sql, /attempt_count < 12/iu);
  });
});

test("production claim statements stream exact order without scans or temporary sorting", async () => {
  await withDatabase(async (database) => {
    await applyMigrationsThrough(database, migration102);
    seedOutboxRows(database);
    const definitions = [
      {
        name: "due",
        sql: PEER_OUTBOX_CANDIDATE_STATEMENTS.due,
        parameters: [ownerUserId, timestamp, timestamp, 50],
        index: "idx_peer_outbox_due_claim_order",
        expected: ["candidate_A", "candidate_a"]
      },
      {
        name: "inFlight",
        sql: PEER_OUTBOX_CANDIDATE_STATEMENTS.inFlight,
        parameters: [ownerUserId, timestamp, timestamp, 50],
        index: "idx_peer_outbox_in_flight_claim_order",
        expected: ["candidate_stale"]
      }
    ] as const;
    for (const definition of definitions) {
      const plan = database
        .prepare(`EXPLAIN QUERY PLAN ${definition.sql}`)
        .all(...definition.parameters) as Array<{ detail: string }>;
      assert.ok(
        plan.some((row) => row.detail.includes(definition.index)),
        `${definition.name} must use ${definition.index}: ${JSON.stringify(plan)}`
      );
      assert.equal(
        plan.some(
          (row) =>
            /\bSCAN peer_outbox\b/u.test(row.detail) ||
            row.detail.includes("USE TEMP B-TREE")
        ),
        false,
        `${definition.name} must remain ordered and bounded: ${JSON.stringify(plan)}`
      );
      const rows = database
        .prepare(definition.sql)
        .all(...definition.parameters) as Array<{ envelope_id: string }>;
      assert.deepEqual(
        rows.map((row) => row.envelope_id),
        definition.expected
      );
    }
  });
});

test("migration 102 index creation rolls back atomically on a later failure", async () => {
  await withDatabase(async (database) => {
    await applyMigrationsThrough(database, migration101);
    const sql = await readFile(path.join(migrationsDir, migration102), "utf8");
    database.exec("BEGIN");
    assert.throws(() => {
      database.exec(sql);
      database.exec("INSERT INTO table_that_does_not_exist VALUES (1)");
    });
    database.exec("ROLLBACK");
    const indexes = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND name LIKE 'idx_peer_outbox_%_claim_order'`
      )
      .all();
    assert.deepEqual(indexes, []);
  });
});

test("migration 102 rejects unsafe legacy ids and same-name index collisions atomically", async () => {
  await withDatabase(async (database) => {
    await applyMigrationsThrough(database, migration101);
    seedOutboxRows(database, { legacyLeaseState: true });
    database
      .prepare(
        `UPDATE peer_outbox SET envelope_id = ? WHERE envelope_id = 'candidate_A'`
      )
      .run("unsafe\0legacy");
    const before = queueSnapshot(database);
    await assert.rejects(
      () => applyMigrationsThrough(database, migration102),
      /CHECK constraint failed|safe ASCII/i
    );
    assert.deepEqual(queueSnapshot(database), before);
    assert.equal(
      database
        .prepare("SELECT 1 FROM migrations WHERE id = ?")
        .get(migration102),
      undefined
    );
  });

  await withDatabase(async (database) => {
    await applyMigrationsThrough(database, migration101);
    seedOutboxRows(database, { legacyLeaseState: true });
    const before = queueSnapshot(database);
    database.exec(
      "CREATE INDEX idx_peer_outbox_due_claim_order ON peer_outbox (owner_user_id)"
    );
    await assert.rejects(
      () => applyMigrationsThrough(database, migration102),
      /index idx_peer_outbox_due_claim_order already exists/i
    );
    assert.deepEqual(queueSnapshot(database), before);
    assert.equal(
      database
        .prepare("SELECT 1 FROM migrations WHERE id = ?")
        .get(migration102),
      undefined
    );
    const definition = database
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type = 'index' AND name = 'idx_peer_outbox_due_claim_order'`
      )
      .get() as { sql: string };
    assert.match(definition.sql, /\(owner_user_id\)$/u);
  });
});
