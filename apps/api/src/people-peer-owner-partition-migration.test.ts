import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migration098 =
  "098_artifact_recursive_sanitization_and_blob_retention.sql";
const migration099 = "099_people_owner_partition_identity.sql";
const now = "2026-07-16T08:00:00.000Z";
const later = "2026-07-16T09:00:00.000Z";

const identityGraphTables = [
  "forge_principals",
  "forge_devices",
  "peer_pairing_invites",
  "peer_relationships",
  "peer_relationship_devices",
  "peer_share_grants",
  "peer_grant_signatures",
  "peer_share_rules",
  "peer_grant_verifications",
  "peer_projection_changes",
  "peer_outbox",
  "peer_inbox",
  "peer_delivery_receipts",
  "peer_remote_records",
  "peer_query_audit",
  "peer_audit_events",
  "peer_pending_requests",
  "peer_mls_group_states",
  "peer_mls_state_checkpoints"
] as const;

type IdentityFixture = {
  localPrincipalId: string;
  remotePrincipalId: string;
  localDeviceId: string;
  remoteDeviceId: string;
  localRootKey: string;
  remoteRootKey: string;
  localSigningKey: string;
  remoteSigningKey: string;
  localAgreementKey: string;
  remoteAgreementKey: string;
  localCertificate: string;
  remoteCertificate: string;
  localCertificateHash: string;
  remoteCertificateHash: string;
};

const sharedIdentity: IdentityFixture = {
  localPrincipalId: "1".repeat(64),
  remotePrincipalId: "2".repeat(64),
  localDeviceId: "3".repeat(32),
  remoteDeviceId: "4".repeat(32),
  localRootKey: Buffer.alloc(32, 1).toString("base64url"),
  remoteRootKey: Buffer.alloc(32, 2).toString("base64url"),
  localSigningKey: Buffer.alloc(32, 3).toString("base64url"),
  remoteSigningKey: Buffer.alloc(32, 4).toString("base64url"),
  localAgreementKey: Buffer.alloc(32, 5).toString("base64url"),
  remoteAgreementKey: Buffer.alloc(32, 6).toString("base64url"),
  localCertificate: Buffer.alloc(96, 7).toString("base64url"),
  remoteCertificate: Buffer.alloc(96, 8).toString("base64url"),
  localCertificateHash: "a".repeat(64),
  remoteCertificateHash: "b".repeat(64)
};

function openDatabase(filePath: string): DatabaseSync {
  const database = new DatabaseSync(filePath);
  database.function(
    "forge_nfkc_lower",
    { deterministic: true },
    (value: unknown) =>
      String(value ?? "")
        .normalize("NFKC")
        .toLowerCase()
  );
  database.exec("PRAGMA foreign_keys = ON");
  return database;
}

async function applyMigrationsThrough(
  database: DatabaseSync,
  lastMigration: string
): Promise<void> {
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file <= lastMigration)
    .sort();
  for (const file of files) {
    if (database.prepare("SELECT 1 FROM migrations WHERE id = ?").get(file)) {
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    database.exec("BEGIN");
    try {
      database.exec(sql);
      database
        .prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)")
        .run(file, now);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

async function withDatabase(
  operation: (database: DatabaseSync) => void | Promise<void>
): Promise<void> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "forge-owner-partition-migration-")
  );
  const database = openDatabase(path.join(root, "forge.sqlite"));
  try {
    await operation(database);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

function seedUser(database: DatabaseSync, ownerUserId: string): void {
  database
    .prepare(
      `INSERT INTO users (
         id, kind, handle, display_name, description, accent_color,
         created_at, updated_at
       ) VALUES (?, 'human', ?, ?, '', '#123456', ?, ?)`
    )
    .run(ownerUserId, ownerUserId, ownerUserId, now, now);
}

function insertPrincipal(input: {
  database: DatabaseSync;
  ownerUserId: string;
  id: string;
  kind: "local" | "remote";
  rootPublicKey: string;
  secretHandle: string | null;
}): void {
  input.database
    .prepare(
      `INSERT INTO forge_principals (
         id, owner_user_id, principal_kind, public_principal_id,
         root_public_key, root_key_secret_id, display_label, trust_state,
         first_verified_at, last_verified_at, metadata_json, created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, '{}', ?, ?)`
    )
    .run(
      input.id,
      input.ownerUserId,
      input.kind,
      input.id,
      input.rootPublicKey,
      input.secretHandle,
      `${input.kind}-${input.ownerUserId}`,
      now,
      now,
      now,
      now
    );
}

function insertDevice(input: {
  database: DatabaseSync;
  ownerUserId: string;
  id: string;
  principalId: string;
  signingKey: string;
  agreementKey: string;
  certificate: string;
  certificateHash: string;
  secretHandle: string | null;
  serial: string;
}): void {
  input.database
    .prepare(
      `INSERT INTO forge_devices (
         id, owner_user_id, principal_id, certified_public_key,
         key_agreement_public_key, private_key_secret_id, certificate,
         certificate_serial, certificate_hash, label, device_type, status,
         transport_endpoints_json, capabilities_json, added_at, created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'forge_peer', 'approved',
                 '[]', '["query","projection"]', ?, ?, ?)`
    )
    .run(
      input.id,
      input.ownerUserId,
      input.principalId,
      input.signingKey,
      input.agreementKey,
      input.secretHandle,
      input.certificate,
      input.serial,
      input.certificateHash,
      `device-${input.ownerUserId}-${input.serial}`,
      now,
      now,
      now
    );
}

function seedOwnerIdentityGraph(input: {
  database: DatabaseSync;
  ownerUserId: string;
  suffix: string;
  identity?: IdentityFixture;
}): { relationshipId: string; grantId: string; groupStateId: string } {
  const identity = input.identity ?? sharedIdentity;
  seedUser(input.database, input.ownerUserId);
  insertPrincipal({
    database: input.database,
    ownerUserId: input.ownerUserId,
    id: identity.localPrincipalId,
    kind: "local",
    rootPublicKey: identity.localRootKey,
    secretHandle: "secret://shared-local-principal"
  });
  insertPrincipal({
    database: input.database,
    ownerUserId: input.ownerUserId,
    id: identity.remotePrincipalId,
    kind: "remote",
    rootPublicKey: identity.remoteRootKey,
    secretHandle: null
  });
  insertDevice({
    database: input.database,
    ownerUserId: input.ownerUserId,
    id: identity.localDeviceId,
    principalId: identity.localPrincipalId,
    signingKey: identity.localSigningKey,
    agreementKey: identity.localAgreementKey,
    certificate: identity.localCertificate,
    certificateHash: identity.localCertificateHash,
    secretHandle: "secret://shared-local-device",
    serial: "1"
  });
  insertDevice({
    database: input.database,
    ownerUserId: input.ownerUserId,
    id: identity.remoteDeviceId,
    principalId: identity.remotePrincipalId,
    signingKey: identity.remoteSigningKey,
    agreementKey: identity.remoteAgreementKey,
    certificate: identity.remoteCertificate,
    certificateHash: identity.remoteCertificateHash,
    secretHandle: null,
    serial: "2"
  });

  const relationshipId = `relationship_${input.suffix}`;
  const grantId = `grant_${input.suffix}`;
  const groupStateId = `mls_group_state_${input.suffix}`;
  input.database
    .prepare(
      `INSERT INTO peer_pairing_invites (
         id, owner_user_id, inviter_principal_id, inviter_device_id, status,
         bootstrap_ciphertext, bootstrap_nonce, bootstrap_hash,
         invitation_fingerprint, transport_kinds_json, expires_at, created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, '["iroh"]', ?, ?, ?)`
    )
    .run(
      `invite_${input.suffix}`,
      input.ownerUserId,
      identity.localPrincipalId,
      identity.localDeviceId,
      Buffer.alloc(32, 9),
      Buffer.alloc(12, 10),
      "c".repeat(64),
      `owner-partition-fingerprint-${input.suffix}`,
      later,
      now,
      now
    );
  input.database
    .prepare(
      `INSERT INTO peer_relationships (
         id, owner_user_id, local_principal_id, remote_principal_id, status,
         verification_phrase_hash, established_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`
    )
    .run(
      relationshipId,
      input.ownerUserId,
      identity.localPrincipalId,
      identity.remotePrincipalId,
      "d".repeat(64),
      now,
      now,
      now
    );
  const insertMembership = input.database.prepare(
    `INSERT INTO peer_relationship_devices (
       relationship_id, owner_user_id, device_id, principal_role, status,
       approved_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'approved', ?, ?, ?)`
  );
  insertMembership.run(
    relationshipId,
    input.ownerUserId,
    identity.localDeviceId,
    "local",
    now,
    now,
    now
  );
  insertMembership.run(
    relationshipId,
    input.ownerUserId,
    identity.remoteDeviceId,
    "remote",
    now,
    now,
    now
  );

  const grantHash = "e".repeat(64);
  input.database
    .prepare(
      `INSERT INTO peer_share_grants (
         id, sequence, owner_user_id, relationship_id, direction, status,
         version_hash, label, canonical_grant_json, cache_policy_json,
         signatures_json, verification_evidence_json, issued_at, accepted_at,
         effective_at, created_at
       ) VALUES (?, 1, ?, ?, 'remote_to_local', 'active', ?, ?, '{}', '{}',
                 '[]', '{}', ?, ?, ?, ?)`
    )
    .run(
      grantId,
      input.ownerUserId,
      relationshipId,
      grantHash,
      `Grant ${input.suffix}`,
      now,
      now,
      now,
      now
    );
  const insertSignature = input.database.prepare(
    `INSERT INTO peer_grant_signatures (
       grant_id, grant_sequence, owner_user_id, signer_device_id, party,
       algorithm, signature, signed_grant_hash, signed_at,
       verification_evidence_json, created_at
     ) VALUES (?, 1, ?, ?, ?, 'ed25519', ?, ?, ?, '{}', ?)`
  );
  insertSignature.run(
    grantId,
    input.ownerUserId,
    identity.localDeviceId,
    "grantor",
    "s".repeat(64),
    grantHash,
    now,
    now
  );
  insertSignature.run(
    grantId,
    input.ownerUserId,
    identity.remoteDeviceId,
    "grantee",
    "t".repeat(64),
    grantHash,
    now,
    now
  );
  input.database
    .prepare(
      `INSERT INTO peer_share_rules (
         grant_id, grant_sequence, owner_user_id, id, rule_position,
         projection_id, effect, field_policy_json, time_policy_json,
         approved_device_ids_json, created_at
       ) VALUES (?, 1, ?, ?, 0, 'calendar.next_event', 'allow', '{}', '{}',
                 ?, ?)`
    )
    .run(
      grantId,
      input.ownerUserId,
      `rule_${input.suffix}`,
      JSON.stringify([identity.remoteDeviceId]),
      now
    );
  input.database
    .prepare(
      `INSERT INTO peer_grant_verifications (
         id, owner_user_id, relationship_id, grant_id, grant_sequence,
         verified_grant_hash, verified_signatures_json,
         verified_signer_device_ids_json,
         approved_relationship_device_ids_json, requesting_device_id,
         verification_result, verified_at, created_at
       ) VALUES (?, ?, ?, ?, 1, ?, '[]', ?, ?, ?, 'valid', ?, ?)`
    )
    .run(
      `verification_${input.suffix}`,
      input.ownerUserId,
      relationshipId,
      grantId,
      grantHash,
      JSON.stringify([identity.localDeviceId, identity.remoteDeviceId]),
      JSON.stringify([identity.localDeviceId, identity.remoteDeviceId]),
      identity.remoteDeviceId,
      now,
      now
    );
  input.database
    .prepare(
      `INSERT INTO peer_mls_group_states (
         id, owner_user_id, relationship_id, group_id, epoch,
         checkpoint_counter, cipher_suite, encrypted_state, encryption_nonce,
         state_hash, secret_store_checkpoint_id, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 1, 1, 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
                 ?, ?, ?, ?, 'active', ?, ?)`
    )
    .run(
      groupStateId,
      input.ownerUserId,
      relationshipId,
      `group-${input.suffix}-identifier`,
      Buffer.alloc(32, 11),
      Buffer.alloc(12, 12),
      "f".repeat(64),
      `secret://mls/${input.suffix}`,
      now,
      now
    );
  input.database
    .prepare(
      `INSERT INTO peer_mls_state_checkpoints (
         id, owner_user_id, group_state_id, epoch, checkpoint_counter,
         state_hash, secret_store_checkpoint_id, created_at
       ) VALUES (?, ?, ?, 1, 1, ?, ?, ?)`
    )
    .run(
      `checkpoint_${input.suffix}`,
      input.ownerUserId,
      groupStateId,
      "f".repeat(64),
      `secret://mls/${input.suffix}`,
      now
    );
  return { relationshipId, grantId, groupStateId };
}

function normalizeSqlValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { bytes: Buffer.from(value).toString("hex") };
  }
  if (Array.isArray(value)) return value.map(normalizeSqlValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeSqlValue(nested)])
    );
  }
  return value;
}

function snapshotTables(
  database: DatabaseSync,
  tables: readonly string[] = identityGraphTables
): Record<string, unknown[]> {
  return Object.fromEntries(
    tables.map((table) => {
      const rows = database
        .prepare(`SELECT * FROM ${table}`)
        .all()
        .map(normalizeSqlValue)
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right))
        );
      return [table, rows];
    })
  );
}

function snapshotForeignKeyGraph(
  database: DatabaseSync
): Record<string, unknown[]> {
  return Object.fromEntries(
    identityGraphTables.map((table) => [
      table,
      (
        database.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
          id: number;
          seq: number;
        }>
      )
        .sort((left, right) => left.id - right.id || left.seq - right.seq)
        .map(normalizeSqlValue)
    ])
  );
}

function snapshotIdentityTriggers(
  database: DatabaseSync
): Array<{ name: string; sql: string }> {
  return (
    database
      .prepare(
        `SELECT name, sql FROM sqlite_schema
         WHERE type = 'trigger'
           AND (
             tbl_name IN ('forge_principals', 'forge_devices')
             OR name IN (
               'trg_peer_relationship_devices_role_insert',
               'trg_peer_relationship_devices_role_update'
             )
           )
         ORDER BY name`
      )
      .all() as Array<{ name: string; sql: string }>
  ).map((row) => ({
    name: row.name,
    sql: row.sql.replace(/\s+/g, " ").trim()
  }));
}

function assertDatabaseHealthy(database: DatabaseSync): void {
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.deepEqual(
    (
      database.prepare("PRAGMA integrity_check").all() as Array<{
        integrity_check: string;
      }>
    ).map((row) => row.integrity_check),
    ["ok"]
  );
}

test("migration 099 applies through the real transaction runner without weakening foreign keys", async () => {
  const sql = await readFile(path.join(migrationsDir, migration099), "utf8");
  assert.doesNotMatch(sql, /PRAGMA\s+foreign_keys\s*=\s*OFF/i);
  assert.doesNotMatch(sql, /\b(?:DELETE\s+FROM|TRUNCATE|REPLACE\s+INTO)\b/i);
  assert.match(sql, /PRAGMA\s+defer_foreign_keys\s*=\s*ON/i);
  assert.match(sql, /FROM\s+pragma_foreign_key_check/i);

  await withDatabase(async (database) => {
    await applyMigrationsThrough(database, migration099);
    const primaryKey = (table: string) =>
      (
        database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
          name: string;
          pk: number;
        }>
      )
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name);
    assert.deepEqual(primaryKey("forge_principals"), ["owner_user_id", "id"]);
    assert.deepEqual(primaryKey("forge_devices"), ["owner_user_id", "id"]);

    const indexes = database
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'index' AND tbl_name IN ('forge_principals', 'forge_devices')
           AND sql IS NOT NULL
         ORDER BY name`
      )
      .all() as Array<{ name: string }>;
    const names = indexes.map((row) => row.name);
    assert.ok(names.includes("idx_forge_principals_owner_root_key"));
    assert.ok(names.includes("idx_forge_devices_owner_signing_key"));
    assert.ok(names.includes("idx_forge_devices_owner_certificate_hash"));
    assert.ok(!names.some((name) => name.endsWith("_global")));
    assertDatabaseHealthy(database);

    await applyMigrationsThrough(database, migration099);
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM migrations WHERE id = ?")
          .get(migration099) as { count: number }
      ).count,
      1
    );
  });
});

test("migration 099 preserves a populated 098 graph and permits the same peer identity per owner", async () => {
  await withDatabase(async (database) => {
    await applyMigrationsThrough(database, migration098);
    const ownerA = seedOwnerIdentityGraph({
      database,
      ownerUserId: "owner_a",
      suffix: "a"
    });
    const before = snapshotTables(database);
    const foreignKeysBefore = snapshotForeignKeyGraph(database);
    const triggersBefore = snapshotIdentityTriggers(database);

    await applyMigrationsThrough(database, migration099);
    assert.deepEqual(snapshotTables(database), before);
    assert.deepEqual(snapshotForeignKeyGraph(database), foreignKeysBefore);
    assert.deepEqual(snapshotIdentityTriggers(database), triggersBefore);
    assertDatabaseHealthy(database);

    const ownerB = seedOwnerIdentityGraph({
      database,
      ownerUserId: "owner_b",
      suffix: "b"
    });
    assert.notEqual(ownerA.relationshipId, ownerB.relationshipId);
    assert.notEqual(ownerA.grantId, ownerB.grantId);
    assert.notEqual(ownerA.groupStateId, ownerB.groupStateId);

    for (const [table, id] of [
      ["forge_principals", sharedIdentity.remotePrincipalId],
      ["forge_devices", sharedIdentity.remoteDeviceId]
    ] as const) {
      assert.deepEqual(
        database
          .prepare(
            `SELECT owner_user_id AS ownerUserId FROM ${table}
             WHERE id = ? ORDER BY owner_user_id`
          )
          .all(id)
          .map((row) => ({ ...row })),
        [{ ownerUserId: "owner_a" }, { ownerUserId: "owner_b" }]
      );
    }

    assert.throws(
      () =>
        insertPrincipal({
          database,
          ownerUserId: "owner_b",
          id: "5".repeat(64),
          kind: "remote",
          rootPublicKey: sharedIdentity.remoteRootKey,
          secretHandle: null
        }),
      /forge_principals\.owner_user_id, forge_principals\.root_public_key/
    );
    assert.throws(
      () =>
        insertDevice({
          database,
          ownerUserId: "owner_b",
          id: "6".repeat(32),
          principalId: sharedIdentity.remotePrincipalId,
          signingKey: sharedIdentity.remoteSigningKey,
          agreementKey: Buffer.alloc(32, 16).toString("base64url"),
          certificate: Buffer.alloc(96, 17).toString("base64url"),
          certificateHash: "6".repeat(64),
          secretHandle: null,
          serial: "3"
        }),
      /forge_devices\.owner_user_id, forge_devices\.certified_public_key/
    );
    assertDatabaseHealthy(database);

    const beforeReplay = snapshotTables(database);
    const sql = await readFile(path.join(migrationsDir, migration099), "utf8");
    database.exec("BEGIN");
    try {
      database.exec(sql);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    assert.deepEqual(snapshotTables(database), beforeReplay);
    assertDatabaseHealthy(database);
  });
});

test("migration 099 fails closed and rolls back every schema and row change on an invalid 098 graph", async () => {
  await withDatabase(async (database) => {
    await applyMigrationsThrough(database, migration098);
    seedOwnerIdentityGraph({
      database,
      ownerUserId: "owner_a",
      suffix: "rollback"
    });

    database.exec("PRAGMA foreign_keys = OFF");
    database
      .prepare(
        `INSERT INTO peer_pairing_invites (
           id, owner_user_id, inviter_principal_id, inviter_device_id, status,
           bootstrap_ciphertext, bootstrap_nonce, bootstrap_hash,
           invitation_fingerprint, transport_kinds_json, expires_at,
           created_at, updated_at
         ) VALUES ('invite_orphan', 'owner_a', 'missing-principal',
                   'missing-device', 'active', ?, ?, ?, 'orphan-fingerprint',
                   '[]', ?, ?, ?)`
      )
      .run(
        Buffer.alloc(32, 20),
        Buffer.alloc(12, 21),
        "9".repeat(64),
        later,
        now,
        now
      );
    database.exec("PRAGMA foreign_keys = ON");

    const before = snapshotTables(database);
    const principalSchemaBefore = (
      database
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'forge_principals'"
        )
        .get() as { sql: string }
    ).sql;
    const deviceSchemaBefore = (
      database
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'forge_devices'"
        )
        .get() as { sql: string }
    ).sql;

    await assert.rejects(
      () => applyMigrationsThrough(database, migration099),
      /CHECK constraint failed: violation_count = 0/
    );
    assert.deepEqual(snapshotTables(database), before);
    assert.equal(
      (
        database
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'forge_principals'"
          )
          .get() as { sql: string }
      ).sql,
      principalSchemaBefore
    );
    assert.equal(
      (
        database
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'forge_devices'"
          )
          .get() as { sql: string }
      ).sql,
      deviceSchemaBefore
    );
    assert.equal(
      database
        .prepare("SELECT 1 FROM migrations WHERE id = ?")
        .get(migration099),
      undefined
    );
    assert.equal(database.prepare("PRAGMA foreign_key_check").all().length, 2);
    assert.deepEqual(
      (
        database.prepare("PRAGMA integrity_check").all() as Array<{
          integrity_check: string;
        }>
      ).map((row) => row.integrity_check),
      ["ok"]
    );
  });
});
