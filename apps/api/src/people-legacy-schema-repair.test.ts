import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { repairLegacyPeopleSchema } from "./db.js";

const REQUIRED_TABLES = [
  "forge_webauthn_credentials",
  "forge_human_presence_challenges",
  "forge_human_presence_capabilities",
  "forge_human_presence_audit_events",
  "peer_grant_signatures",
  "peer_grant_verifications",
  "peer_companion_credentials",
  "peer_companion_request_nonces"
] as const;

const OBSOLETE_GLOBAL_INDEXES = [
  "idx_forge_principals_public_id_global",
  "idx_forge_principals_root_key_global",
  "idx_forge_devices_signing_key_global",
  "idx_forge_devices_agreement_key_global",
  "idx_forge_devices_certificate_global",
  "idx_forge_devices_certificate_hash_global",
  "idx_forge_devices_private_key_handle_global"
] as const;

const REQUIRED_OWNER_INDEXES = [
  "idx_forge_principals_owner_root_key",
  "idx_forge_devices_owner_signing_key",
  "idx_forge_devices_owner_agreement_key",
  "idx_forge_devices_owner_certificate",
  "idx_forge_devices_owner_certificate_hash",
  "idx_forge_devices_owner_private_key_handle"
] as const;

test("legacy People schema repair restores final 087/088 objects idempotently", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (id TEXT PRIMARY KEY);
      INSERT INTO users (id) VALUES ('owner_a'), ('owner_b');
    `);
    await repairLegacyPeopleSchema(database);
    await repairLegacyPeopleSchema(database);

    const tables = new Set(
      (
        database
          .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name)
    );
    for (const table of REQUIRED_TABLES) {
      assert.equal(tables.has(table), true, `missing table ${table}`);
    }

    const columns = (table: string) =>
      new Set(
        (
          database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
            name: string;
          }>
        ).map((row) => row.name)
      );
    assert.ok(columns("peer_remote_records").has("query_hash"));
    assert.ok(columns("peer_remote_records").has("next_event_at"));
    assert.ok(columns("peer_idempotency_records").has("response_ciphertext"));
    assert.ok(columns("peer_idempotency_records").has("response_reference"));

    const indexes = new Set(
      (
        database
          .prepare("SELECT name FROM sqlite_schema WHERE type = 'index'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name)
    );
    for (const index of OBSOLETE_GLOBAL_INDEXES) {
      assert.equal(indexes.has(index), false, `obsolete index ${index}`);
    }
    for (const index of REQUIRED_OWNER_INDEXES) {
      assert.equal(indexes.has(index), true, `missing index ${index}`);
    }

    const insertPrincipal = database.prepare(`
      INSERT INTO forge_principals (
        id, owner_user_id, principal_kind, public_principal_id,
        root_public_key, root_key_secret_id, display_label, local_person_id,
        trust_state, minimum_protocol_version, maximum_protocol_version,
        first_verified_at, last_verified_at, revoked_at, metadata_json,
        created_at, updated_at
      ) VALUES (?, ?, 'remote', ?, ?, NULL, '', NULL, 'unverified', 1, 1,
                NULL, NULL, NULL, '{}', ?, ?)
    `);
    const sharedPublicId = "shared-public-id-01";
    const sharedRootKey = "r".repeat(32);
    const now = "2026-07-17T12:00:00.000Z";
    insertPrincipal.run(
      "principal_owner_a",
      "owner_a",
      sharedPublicId,
      sharedRootKey,
      now,
      now
    );
    insertPrincipal.run(
      "principal_owner_b",
      "owner_b",
      sharedPublicId,
      sharedRootKey,
      now,
      now
    );
    assert.throws(
      () =>
        insertPrincipal.run(
          "principal_owner_a_duplicate",
          "owner_a",
          "different-public-id",
          sharedRootKey,
          now,
          now
        ),
      /UNIQUE constraint failed/u
    );
  } finally {
    database.close();
  }
});

test("migration 105 removes stale global People indexes after an earlier 104", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (id TEXT PRIMARY KEY);
    `);
    await repairLegacyPeopleSchema(database);
    database.exec(`
      CREATE UNIQUE INDEX idx_forge_principals_public_id_global
        ON forge_principals (public_principal_id);
      CREATE UNIQUE INDEX idx_forge_principals_root_key_global
        ON forge_principals (root_public_key);
      CREATE UNIQUE INDEX idx_forge_devices_signing_key_global
        ON forge_devices (certified_public_key);
      CREATE UNIQUE INDEX idx_forge_devices_agreement_key_global
        ON forge_devices (key_agreement_public_key)
        WHERE key_agreement_public_key IS NOT NULL;
      CREATE UNIQUE INDEX idx_forge_devices_certificate_global
        ON forge_devices (certificate);
      CREATE UNIQUE INDEX idx_forge_devices_certificate_hash_global
        ON forge_devices (certificate_hash)
        WHERE certificate_hash IS NOT NULL;
      CREATE UNIQUE INDEX idx_forge_devices_private_key_handle_global
        ON forge_devices (private_key_secret_id)
        WHERE private_key_secret_id IS NOT NULL;
    `);

    const migration = await readFile(
      new URL(
        "../migrations/105_people_owner_partition_index_repair.sql",
        import.meta.url
      ),
      "utf8"
    );
    database.exec(migration);
    database.exec(migration);

    const indexes = new Set(
      (
        database
          .prepare("SELECT name FROM sqlite_schema WHERE type = 'index'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name)
    );
    for (const index of OBSOLETE_GLOBAL_INDEXES) {
      assert.equal(indexes.has(index), false, `obsolete index ${index}`);
    }
    for (const index of REQUIRED_OWNER_INDEXES) {
      assert.equal(indexes.has(index), true, `missing index ${index}`);
    }
  } finally {
    database.close();
  }
});
