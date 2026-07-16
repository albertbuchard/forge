import assert from "node:assert/strict";
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  PEER_COMPANION_AUTHORIZED_OPERATION_IDS,
  PEER_COMPANION_CAPABILITIES,
  PEER_COMPANION_SCOPES
} from "./services/peer-companion-contract.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migration087 = "087_people_and_peer_sharing.sql";
const migration088 = "088_people_peer_identity_hardening.sql";
const migration093 = "093_gamification_incremental_reconciliation.sql";
const migration094 = "094_people_peer_authorization_and_companion_v2.sql";

const t0 = "2026-07-15T08:00:00.000Z";
const t1 = "2026-07-15T08:01:00.000Z";
const t2 = "2026-07-15T08:02:00.000Z";
const t3 = "2026-07-15T08:03:00.000Z";
const t4 = "2026-07-15T08:04:00.000Z";

type PrincipalInput = {
  id: string;
  ownerUserId: string;
  kind: "local" | "remote";
  publicPrincipalId: string;
  rootPublicKey: string;
  rootKeySecretId?: string | null;
  localPersonId?: string | null;
  trustState?:
    | "unverified"
    | "pending"
    | "verified"
    | "revoked"
    | "recovery_required";
  firstVerifiedAt?: string | null;
  lastVerifiedAt?: string | null;
  revokedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type DeviceInput = {
  id: string;
  ownerUserId: string;
  principalId: string;
  signingPublicKey: string;
  keyAgreementPublicKey?: string | null;
  privateKeySecretId?: string | null;
  certificate: string;
  certificateSerial?: string | number | null;
  certificateHash?: string | null;
  status?: "pending" | "approved" | "removed" | "revoked" | "compromised";
  addedAt?: string;
  lastSeenAt?: string | null;
  revokedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type RelationshipInput = {
  id: string;
  ownerUserId: string;
  localPrincipalId: string;
  remotePrincipalId: string;
  localPersonId?: string | null;
  status?:
    | "pending_verification"
    | "active"
    | "paused"
    | "revoked"
    | "recovery_required";
  establishedAt?: string | null;
  lastConnectedAt?: string | null;
  revokedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

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
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file <= lastMigration)
    .sort();
  for (const file of files) {
    const applied = database
      .prepare("SELECT 1 FROM migrations WHERE id = ?")
      .get(file);
    if (applied) {
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    database.exec("BEGIN");
    try {
      database.exec(sql);
      database
        .prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)")
        .run(file, t0);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

async function withDatabase(
  lastMigration: string,
  operation: (database: DatabaseSync) => void | Promise<void>
): Promise<void> {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-peer-hardening-")
  );
  const database = new DatabaseSync(path.join(rootDir, "forge.sqlite"));
  try {
    await applyMigrationsThrough(database, lastMigration);
    await operation(database);
  } finally {
    database.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

function key(byte: number): string {
  return Buffer.alloc(32, byte).toString("base64url");
}

function certificate(byte: number): string {
  return Buffer.alloc(96, byte).toString("base64url");
}

function hash(nibble: string): string {
  return nibble.repeat(64);
}

function seedUser(database: DatabaseSync, id: string, handle: string): void {
  database
    .prepare(
      `INSERT INTO users (
         id, kind, handle, display_name, description, accent_color,
         created_at, updated_at
       ) VALUES (?, 'human', ?, ?, '', '#123456', ?, ?)`
    )
    .run(id, handle, handle, t0, t0);
}

function seedPerson(
  database: DatabaseSync,
  id: string,
  ownerUserId: string
): void {
  database
    .prepare(
      `INSERT INTO people (
         id, user_id, display_name, normalized_display_name, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, ownerUserId, id, id, t0, t0);
}

function insertPrincipal(database: DatabaseSync, input: PrincipalInput): void {
  database
    .prepare(
      `INSERT INTO forge_principals (
         id, owner_user_id, principal_kind, public_principal_id,
         root_public_key, root_key_secret_id, display_label, local_person_id,
         trust_state, first_verified_at, last_verified_at, revoked_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.ownerUserId,
      input.kind,
      input.publicPrincipalId,
      input.rootPublicKey,
      input.rootKeySecretId === undefined
        ? input.kind === "local"
          ? `secret://${input.id}`
          : null
        : input.rootKeySecretId,
      input.localPersonId ?? null,
      input.trustState ?? "verified",
      input.firstVerifiedAt === undefined ? t0 : input.firstVerifiedAt,
      input.lastVerifiedAt === undefined ? t0 : input.lastVerifiedAt,
      input.revokedAt ?? null,
      input.createdAt ?? t0,
      input.updatedAt ?? t0
    );
}

function insertDevice(database: DatabaseSync, input: DeviceInput): void {
  database
    .prepare(
      `INSERT INTO forge_devices (
         id, owner_user_id, principal_id, certified_public_key,
         key_agreement_public_key, private_key_secret_id, certificate,
         certificate_serial, certificate_hash, label, device_type, status,
         added_at, last_seen_at, revoked_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'test', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.ownerUserId,
      input.principalId,
      input.signingPublicKey,
      input.keyAgreementPublicKey ?? null,
      input.privateKeySecretId ?? null,
      input.certificate,
      input.certificateSerial ?? null,
      input.certificateHash ?? null,
      input.status ?? "approved",
      input.addedAt ?? t0,
      input.lastSeenAt ?? null,
      input.revokedAt ?? null,
      input.createdAt ?? t0,
      input.updatedAt ?? t0
    );
}

function insertRelationship(
  database: DatabaseSync,
  input: RelationshipInput
): void {
  database
    .prepare(
      `INSERT INTO peer_relationships (
         id, owner_user_id, local_principal_id, remote_principal_id,
         local_person_id, status, verification_phrase_hash, established_at,
         last_connected_at, revoked_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.ownerUserId,
      input.localPrincipalId,
      input.remotePrincipalId,
      input.localPersonId ?? null,
      input.status ?? "active",
      hash("f"),
      input.establishedAt === undefined ? t0 : input.establishedAt,
      input.lastConnectedAt ?? null,
      input.revokedAt ?? null,
      input.createdAt ?? t0,
      input.updatedAt ?? t0
    );
}

function insertRelationshipDevice(
  database: DatabaseSync,
  input: {
    relationshipId: string;
    ownerUserId: string;
    deviceId: string;
    role: "local" | "remote";
    status?: "pending" | "approved" | "removed" | "revoked" | "compromised";
    approvedAt?: string | null;
    removedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
  }
): void {
  database
    .prepare(
      `INSERT INTO peer_relationship_devices (
         relationship_id, owner_user_id, device_id, principal_role, status,
         approved_at, removed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.relationshipId,
      input.ownerUserId,
      input.deviceId,
      input.role,
      input.status ?? "approved",
      input.approvedAt === undefined ? t0 : input.approvedAt,
      input.removedAt ?? null,
      input.createdAt ?? t0,
      input.updatedAt ?? t0
    );
}

function assertHealthy(database: DatabaseSync): void {
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

function seedOwnersAndPrincipals(database: DatabaseSync): {
  localA: string;
  remoteA: string;
  remoteA2: string;
  remoteA3: string;
  localB: string;
  remoteB: string;
} {
  seedUser(database, "owner_a", "owner-a");
  seedUser(database, "owner_b", "owner-b");
  seedPerson(database, "person_a", "owner_a");
  seedPerson(database, "person_a_2", "owner_a");
  seedPerson(database, "person_b", "owner_b");

  const principals = {
    localA: "1".repeat(64),
    remoteA: "2".repeat(64),
    remoteA2: "3".repeat(64),
    remoteA3: "4".repeat(64),
    localB: "5".repeat(64),
    remoteB: "6".repeat(64)
  };
  Object.entries(principals).forEach(([name, id], index) => {
    const local = name.startsWith("local");
    insertPrincipal(database, {
      id,
      ownerUserId: name.endsWith("B") ? "owner_b" : "owner_a",
      kind: local ? "local" : "remote",
      publicPrincipalId: id,
      rootPublicKey: key(index + 1),
      rootKeySecretId: local ? `secret://principal-${name}` : null
    });
  });
  return principals;
}

test("migration 088 upgrades the fresh chain without rewriting legacy peer rows", async () => {
  const migrationSql = await readFile(
    path.join(migrationsDir, migration088),
    "utf8"
  );
  assert.doesNotMatch(
    migrationSql,
    /^\s*(?:DROP|TRUNCATE|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\b/im
  );
  assert.deepEqual(
    Array.from(
      migrationSql.matchAll(/^CREATE TABLE IF NOT EXISTS ([a-z0-9_]+)\s*\(/gim),
      (match) => match[1]
    ),
    ["peer_companion_credentials", "peer_companion_request_nonces"]
  );

  await withDatabase(migration087, async (database) => {
    seedUser(database, "legacy_owner", "legacy-owner");
    seedPerson(database, "legacy_person", "legacy_owner");
    const localPrincipal = "a".repeat(64);
    const remotePrincipal = "b".repeat(64);
    insertPrincipal(database, {
      id: localPrincipal,
      ownerUserId: "legacy_owner",
      kind: "local",
      publicPrincipalId: "legacy-public-local",
      rootPublicKey: key(20),
      localPersonId: "legacy_person"
    });
    insertPrincipal(database, {
      id: remotePrincipal,
      ownerUserId: "legacy_owner",
      kind: "remote",
      publicPrincipalId: "legacy-public-remote",
      rootPublicKey: key(21)
    });
    const legacyDeviceId = "c".repeat(32);
    database
      .prepare(
        `INSERT INTO forge_devices (
           id, owner_user_id, principal_id, certified_public_key,
           private_key_secret_id, certificate, label, device_type, status,
           added_at, last_seen_at, revoked_at, created_at, updated_at
         ) VALUES (?, 'legacy_owner', ?, ?, 'secret://legacy-device', ?,
                   'Legacy device', 'desktop', 'approved', ?, ?, NULL, ?, ?)`
      )
      .run(
        legacyDeviceId,
        localPrincipal,
        key(22),
        certificate(22),
        t0,
        t0,
        t0,
        t0
      );
    insertRelationship(database, {
      id: "legacy_relationship",
      ownerUserId: "legacy_owner",
      localPrincipalId: localPrincipal,
      remotePrincipalId: remotePrincipal,
      localPersonId: "legacy_person",
      lastConnectedAt: t0
    });
    insertRelationshipDevice(database, {
      relationshipId: "legacy_relationship",
      ownerUserId: "legacy_owner",
      deviceId: legacyDeviceId,
      role: "local"
    });

    const legacyBefore = {
      principal: database
        .prepare("SELECT * FROM forge_principals WHERE id = ?")
        .get(localPrincipal),
      device: database
        .prepare("SELECT * FROM forge_devices WHERE id = ?")
        .get(legacyDeviceId),
      relationship: database
        .prepare(
          "SELECT * FROM peer_relationships WHERE id = 'legacy_relationship'"
        )
        .get(),
      link: database
        .prepare(
          "SELECT * FROM peer_relationship_devices WHERE relationship_id = 'legacy_relationship'"
        )
        .get()
    };

    await applyMigrationsThrough(database, migration088);

    const columns = new Map(
      (
        database.prepare("PRAGMA table_info(forge_devices)").all() as Array<{
          name: string;
          type: string;
          notnull: number;
        }>
      ).map((column) => [column.name, column])
    );
    for (const name of [
      "key_agreement_public_key",
      "certificate_serial",
      "certificate_hash"
    ]) {
      assert.equal(columns.get(name)?.type, "TEXT");
      assert.equal(columns.get(name)?.notnull, 0);
    }
    const replayColumns = new Map(
      (
        database
          .prepare("PRAGMA table_info(peer_idempotency_records)")
          .all() as Array<{ name: string; type: string; notnull: number }>
      ).map((column) => [column.name, column])
    );
    assert.equal(replayColumns.get("response_ciphertext")?.type, "TEXT");
    assert.equal(replayColumns.get("response_reference")?.type, "TEXT");
    const companionTables = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN (
           'peer_companion_credentials', 'peer_companion_request_nonces'
         ) ORDER BY name`
      )
      .all() as Array<{ name: string }>;
    assert.deepEqual(
      companionTables.map((row) => row.name),
      ["peer_companion_credentials", "peer_companion_request_nonces"]
    );

    const legacyAfter = {
      principal: database
        .prepare("SELECT * FROM forge_principals WHERE id = ?")
        .get(localPrincipal),
      device: database
        .prepare("SELECT * FROM forge_devices WHERE id = ?")
        .get(legacyDeviceId),
      relationship: database
        .prepare(
          "SELECT * FROM peer_relationships WHERE id = 'legacy_relationship'"
        )
        .get(),
      link: database
        .prepare(
          "SELECT * FROM peer_relationship_devices WHERE relationship_id = 'legacy_relationship'"
        )
        .get()
    };
    assert.deepEqual(legacyAfter.principal, legacyBefore.principal);
    assert.deepEqual(legacyAfter.relationship, legacyBefore.relationship);
    assert.deepEqual(legacyAfter.link, legacyBefore.link);
    assert.deepEqual(
      { ...(legacyAfter.device as Record<string, unknown>) },
      {
        ...(legacyBefore.device as Record<string, unknown>),
        key_agreement_public_key: null,
        certificate_serial: null,
        certificate_hash: null
      }
    );
    assertHealthy(database);
  });
});

test("migration 088 enforces canonical immutable device and principal identities globally", async () => {
  await withDatabase(migration088, (database) => {
    const principals = seedOwnersAndPrincipals(database);
    const invalidPeerPrincipal = (
      overrides: Partial<PrincipalInput>
    ): PrincipalInput => ({
      id: "7".repeat(64),
      ownerUserId: "owner_b",
      kind: "remote",
      publicPrincipalId: "7".repeat(64),
      rootPublicKey: key(30),
      rootKeySecretId: null,
      ...overrides
    });
    assert.throws(
      () =>
        insertPrincipal(
          database,
          invalidPeerPrincipal({ publicPrincipalId: "8".repeat(64) })
        ),
      /principal ID must equal its lowercase hexadecimal public principal ID/
    );
    assert.throws(
      () =>
        insertPrincipal(
          database,
          invalidPeerPrincipal({
            id: "A".repeat(64),
            publicPrincipalId: "A".repeat(64)
          })
        ),
      /principal ID must equal its lowercase hexadecimal public principal ID/
    );
    assert.throws(
      () =>
        insertPrincipal(
          database,
          invalidPeerPrincipal({ rootPublicKey: `${"A".repeat(42)}B` })
        ),
      /principal root public key is not canonical base64url/
    );
    assert.throws(
      () =>
        insertPrincipal(
          database,
          invalidPeerPrincipal({ kind: "local", rootKeySecretId: null })
        ),
      /principal secret handle does not match its principal kind/
    );
    assert.throws(
      () =>
        insertPrincipal(
          database,
          invalidPeerPrincipal({ rootKeySecretId: "secret://remote-root" })
        ),
      /principal secret handle does not match its principal kind/
    );
    insertPrincipal(database, {
      id: "legacy_fixture_principal",
      ownerUserId: "owner_b",
      kind: "remote",
      publicPrincipalId: "legacy-fixture-public-principal",
      rootPublicKey: "r".repeat(32),
      firstVerifiedAt: null,
      lastVerifiedAt: null
    });

    const localDeviceA = "a".repeat(32);
    const remoteDeviceA = "b".repeat(32);
    insertDevice(database, {
      id: localDeviceA,
      ownerUserId: "owner_a",
      principalId: principals.localA,
      signingPublicKey: key(40),
      keyAgreementPublicKey: key(41),
      privateKeySecretId: "secret://device-a-local",
      certificate: certificate(40),
      certificateSerial: "1",
      certificateHash: hash("a")
    });
    insertDevice(database, {
      id: remoteDeviceA,
      ownerUserId: "owner_a",
      principalId: principals.remoteA,
      signingPublicKey: key(42),
      keyAgreementPublicKey: key(43),
      certificate: certificate(42),
      certificateSerial: "1",
      certificateHash: hash("b")
    });

    const invalidDevice = (overrides: Partial<DeviceInput>): DeviceInput => ({
      id: "c".repeat(32),
      ownerUserId: "owner_b",
      principalId: principals.localB,
      signingPublicKey: key(44),
      keyAgreementPublicKey: key(45),
      privateKeySecretId: "secret://device-invalid",
      certificate: certificate(44),
      certificateSerial: "2",
      certificateHash: hash("c"),
      ...overrides
    });

    assert.throws(
      () => insertDevice(database, invalidDevice({ id: "C".repeat(32) })),
      /peer device ID is not lowercase hexadecimal/
    );
    for (const signingPublicKey of [
      "A".repeat(42),
      `+${"A".repeat(42)}`,
      `${"A".repeat(42)}B`
    ]) {
      assert.throws(
        () => insertDevice(database, invalidDevice({ signingPublicKey })),
        /signing public key is not canonical base64url/
      );
    }
    for (const keyAgreementPublicKey of [
      null,
      "A".repeat(42),
      `+${"A".repeat(42)}`,
      `${"A".repeat(42)}B`
    ]) {
      assert.throws(
        () => insertDevice(database, invalidDevice({ keyAgreementPublicKey })),
        /key-agreement public key is not canonical base64url/
      );
    }
    for (const encodedCertificate of [
      `${"A".repeat(127)}+`,
      "A".repeat(65),
      `${"A".repeat(125)}B`
    ]) {
      assert.throws(
        () =>
          insertDevice(
            database,
            invalidDevice({ certificate: encodedCertificate })
          ),
        /peer device certificate is not canonical base64url/
      );
    }
    for (const certificateSerial of [
      null,
      1,
      "0",
      "01",
      "-1",
      "1.0",
      "18446744073709551616",
      "999999999999999999999"
    ]) {
      assert.throws(
        () => insertDevice(database, invalidDevice({ certificateSerial })),
        /certificate serial is not a canonical positive u64 string/
      );
    }
    for (const certificateHash of [
      null,
      hash("A"),
      "a".repeat(63),
      `${"a".repeat(63)}z`
    ]) {
      assert.throws(
        () => insertDevice(database, invalidDevice({ certificateHash })),
        /certificate hash is not a lowercase BLAKE3 fingerprint/
      );
    }

    assert.throws(
      () =>
        insertDevice(
          database,
          invalidDevice({
            keyAgreementPublicKey: null,
            certificateSerial: null,
            certificateHash: null
          })
        ),
      /key-agreement public key is not canonical base64url/
    );
    insertDevice(database, {
      id: "legacy_fixture_device",
      ownerUserId: "owner_b",
      principalId: principals.localB,
      signingPublicKey: key(46),
      privateKeySecretId: "secret://legacy-fixture-device",
      certificate: certificate(46)
    });

    const maxSerialDevice = "d".repeat(32);
    insertDevice(database, {
      id: maxSerialDevice,
      ownerUserId: "owner_b",
      principalId: principals.localB,
      signingPublicKey: key(47),
      keyAgreementPublicKey: key(48),
      privateKeySecretId: "secret://device-b-max",
      certificate: certificate(47),
      certificateSerial: "18446744073709551615",
      certificateHash: hash("d")
    });
    assert.deepEqual(
      {
        ...(database
          .prepare(
            `SELECT certificate_serial, typeof(certificate_serial) AS storage_type
             FROM forge_devices WHERE id = ?`
          )
          .get(maxSerialDevice) as Record<string, unknown>)
      },
      {
        certificate_serial: "18446744073709551615",
        storage_type: "text"
      }
    );

    const principalMutations: Array<[string, SQLInputValue]> = [
      ["id", "7".repeat(64)],
      ["owner_user_id", "owner_b"],
      ["principal_kind", "local"],
      ["public_principal_id", "replacement-public-principal"],
      ["root_public_key", key(49)],
      ["root_key_secret_id", "secret://replacement-root"]
    ];
    for (const [column, value] of principalMutations) {
      assert.throws(
        () =>
          database
            .prepare(`UPDATE forge_principals SET ${column} = ? WHERE id = ?`)
            .run(value, principals.remoteA),
        /principal cryptographic identity is immutable/i
      );
    }

    const deviceMutations: Array<[string, SQLInputValue]> = [
      ["id", "e".repeat(32)],
      ["owner_user_id", "owner_b"],
      ["principal_id", principals.localA],
      ["certified_public_key", key(50)],
      ["key_agreement_public_key", key(51)],
      ["private_key_secret_id", "secret://replacement"],
      ["certificate", certificate(50)],
      ["certificate_serial", "2"],
      ["certificate_hash", hash("e")]
    ];
    for (const [column, value] of deviceMutations) {
      assert.throws(
        () =>
          database
            .prepare(`UPDATE forge_devices SET ${column} = ? WHERE id = ?`)
            .run(value, remoteDeviceA),
        /device cryptographic identity is immutable/i
      );
    }

    database
      .prepare(
        `UPDATE forge_principals
         SET display_label = 'Local A', last_verified_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(t1, t1, principals.localA);
    database
      .prepare(
        `UPDATE forge_devices
         SET label = 'Remote A', last_seen_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(t1, t1, remoteDeviceA);

    assert.throws(
      () =>
        insertPrincipal(database, {
          id: "legacy_fixture_principal_two",
          ownerUserId: "owner_b",
          kind: "remote",
          publicPrincipalId: "legacy-fixture-public-principal",
          rootPublicKey: "s".repeat(32),
          firstVerifiedAt: null,
          lastVerifiedAt: null
        }),
      /UNIQUE constraint failed: forge_principals\.public_principal_id/
    );
    assert.throws(
      () =>
        insertPrincipal(database, {
          id: "7".repeat(64),
          ownerUserId: "owner_b",
          kind: "remote",
          publicPrincipalId: "7".repeat(64),
          rootPublicKey: key(1)
        }),
      /UNIQUE constraint failed: forge_principals\.root_public_key/
    );
    assert.throws(
      () =>
        insertPrincipal(database, {
          id: principals.remoteA,
          ownerUserId: "owner_b",
          kind: "remote",
          publicPrincipalId: principals.remoteA,
          rootPublicKey: key(52)
        }),
      /UNIQUE constraint failed: forge_principals\.(?:id|public_principal_id)/
    );

    const globalConflictBase = invalidDevice({
      id: "e".repeat(32),
      signingPublicKey: key(53),
      keyAgreementPublicKey: key(54),
      privateKeySecretId: "secret://global-conflict-base",
      certificate: certificate(53),
      certificateSerial: "1",
      certificateHash: hash("e")
    });
    const globalDeviceConflicts: Array<[Partial<DeviceInput>, RegExp]> = [
      [{ id: localDeviceA }, /forge_devices\.id/],
      [{ signingPublicKey: key(40) }, /forge_devices\.certified_public_key/],
      [
        { keyAgreementPublicKey: key(41) },
        /forge_devices\.key_agreement_public_key/
      ],
      [
        { privateKeySecretId: "secret://device-a-local" },
        /forge_devices\.private_key_secret_id/
      ],
      [{ certificate: certificate(40) }, /forge_devices\.certificate/],
      [{ certificateHash: hash("a") }, /forge_devices\.certificate_hash/]
    ];
    for (const [overrides, pattern] of globalDeviceConflicts) {
      assert.throws(
        () => insertDevice(database, { ...globalConflictBase, ...overrides }),
        pattern
      );
    }

    insertDevice(database, globalConflictBase);
    assert.equal(
      (
        database
          .prepare("SELECT certificate_serial FROM forge_devices WHERE id = ?")
          .get(globalConflictBase.id) as { certificate_serial: string }
      ).certificate_serial,
      "1"
    );

    database
      .prepare(
        `INSERT INTO peer_audit_events (
           id, owner_user_id, event_type, actor_class, actor_id, outcome,
           metadata_json, evidence_json, created_at
         ) VALUES (
           'audit_immutable', 'owner_a', 'identity_test', 'system', NULL,
           'recorded', '{}', '{}', ?
         )`
      )
      .run(t0);
    assert.throws(
      () =>
        database
          .prepare(
            "UPDATE peer_audit_events SET outcome = 'allowed' WHERE id = 'audit_immutable'"
          )
          .run(),
      /Peer audit events are append-only/
    );
    assert.throws(
      () =>
        database
          .prepare("DELETE FROM peer_audit_events WHERE id = 'audit_immutable'")
          .run(),
      /Peer audit events are append-only/
    );
    assertHealthy(database);
  });
});

test("migration 088 enforces roles, lifecycle transitions, and live-person uniqueness", async () => {
  await withDatabase(migration088, (database) => {
    const principals = seedOwnersAndPrincipals(database);
    const localDevice = "7".repeat(32);
    const remoteDevice = "8".repeat(32);
    const secondRemoteDevice = "9".repeat(32);
    insertDevice(database, {
      id: localDevice,
      ownerUserId: "owner_a",
      principalId: principals.localA,
      signingPublicKey: key(60),
      keyAgreementPublicKey: key(61),
      privateKeySecretId: "secret://roles-local",
      certificate: certificate(60),
      certificateSerial: "1",
      certificateHash: hash("7")
    });
    insertDevice(database, {
      id: remoteDevice,
      ownerUserId: "owner_a",
      principalId: principals.remoteA,
      signingPublicKey: key(62),
      keyAgreementPublicKey: key(63),
      certificate: certificate(62),
      certificateSerial: "1",
      certificateHash: hash("8")
    });
    insertDevice(database, {
      id: secondRemoteDevice,
      ownerUserId: "owner_a",
      principalId: principals.remoteA,
      signingPublicKey: key(64),
      keyAgreementPublicKey: key(65),
      certificate: certificate(64),
      certificateSerial: "1",
      certificateHash: hash("9")
    });
    insertRelationship(database, {
      id: "relationship_main",
      ownerUserId: "owner_a",
      localPrincipalId: principals.localA,
      remotePrincipalId: principals.remoteA,
      localPersonId: "person_a",
      lastConnectedAt: t0
    });
    insertRelationshipDevice(database, {
      relationshipId: "relationship_main",
      ownerUserId: "owner_a",
      deviceId: localDevice,
      role: "local"
    });
    insertRelationshipDevice(database, {
      relationshipId: "relationship_main",
      ownerUserId: "owner_a",
      deviceId: remoteDevice,
      role: "remote"
    });

    assert.throws(
      () =>
        insertRelationshipDevice(database, {
          relationshipId: "relationship_main",
          ownerUserId: "owner_a",
          deviceId: secondRemoteDevice,
          role: "local"
        }),
      /device role does not match its principal/
    );
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE peer_relationship_devices
             SET principal_role = 'remote'
             WHERE relationship_id = 'relationship_main' AND device_id = ?`
          )
          .run(localDevice),
      /device role does not match its principal|device binding is immutable/
    );
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE peer_relationships SET remote_principal_id = ?
             WHERE id = 'relationship_main'`
          )
          .run(principals.remoteA2),
      /relationship principal binding is immutable/
    );

    insertRelationshipDevice(database, {
      relationshipId: "relationship_main",
      ownerUserId: "owner_a",
      deviceId: secondRemoteDevice,
      role: "remote",
      status: "pending",
      approvedAt: null
    });
    database
      .prepare(
        `UPDATE peer_relationship_devices
         SET status = 'approved', approved_at = ?, updated_at = ?
         WHERE relationship_id = 'relationship_main' AND device_id = ?`
      )
      .run(t1, t1, secondRemoteDevice);
    database
      .prepare(
        `UPDATE peer_relationship_devices
         SET status = 'removed', removed_at = ?, updated_at = ?
         WHERE relationship_id = 'relationship_main' AND device_id = ?`
      )
      .run(t2, t2, secondRemoteDevice);
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE peer_relationship_devices
             SET status = 'approved', removed_at = NULL, updated_at = ?
             WHERE relationship_id = 'relationship_main' AND device_id = ?`
          )
          .run(t3, secondRemoteDevice),
      /lifecycle transition is inconsistent/
    );

    assert.throws(
      () =>
        insertRelationshipDevice(database, {
          relationshipId: "relationship_main",
          ownerUserId: "owner_a",
          deviceId: secondRemoteDevice,
          role: "remote",
          status: "approved",
          approvedAt: null
        }),
      /UNIQUE constraint failed|lifecycle timestamps are inconsistent/
    );
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE peer_relationships
             SET status = 'revoked', revoked_at = NULL, updated_at = ?
             WHERE id = 'relationship_main'`
          )
          .run(t1),
      /lifecycle transition is inconsistent/
    );
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE peer_relationships
             SET last_connected_at = ?, updated_at = ?
             WHERE id = 'relationship_main'`
          )
          .run("2026-07-15T07:59:00.000Z", t1),
      /lifecycle transition is inconsistent/
    );
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE forge_devices SET status = 'revoked', updated_at = ?
             WHERE id = ?`
          )
          .run(t1, remoteDevice),
      /device lifecycle transition is inconsistent/
    );
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE forge_principals SET trust_state = 'revoked', updated_at = ?
             WHERE id = ?`
          )
          .run(t1, principals.remoteA),
      /principal lifecycle transition is inconsistent/
    );

    assert.throws(
      () =>
        insertRelationship(database, {
          id: "relationship_duplicate_person",
          ownerUserId: "owner_a",
          localPrincipalId: principals.localA,
          remotePrincipalId: principals.remoteA2,
          localPersonId: "person_a"
        }),
      /UNIQUE constraint failed: peer_relationships\.owner_user_id, peer_relationships\.local_person_id/
    );
    assert.throws(
      () =>
        insertRelationship(database, {
          id: "relationship_paused_person_conflict",
          ownerUserId: "owner_a",
          localPrincipalId: principals.localA,
          remotePrincipalId: principals.remoteA2,
          localPersonId: "person_a",
          status: "paused"
        }),
      /UNIQUE constraint failed: peer_relationships\.owner_user_id, peer_relationships\.local_person_id/
    );
    assert.throws(
      () =>
        insertRelationship(database, {
          id: "relationship_recovery_person_conflict",
          ownerUserId: "owner_a",
          localPrincipalId: principals.localA,
          remotePrincipalId: principals.remoteA2,
          localPersonId: "person_a",
          status: "recovery_required"
        }),
      /UNIQUE constraint failed: peer_relationships\.owner_user_id, peer_relationships\.local_person_id/
    );
    insertRelationship(database, {
      id: "relationship_pending_person",
      ownerUserId: "owner_a",
      localPrincipalId: principals.localA,
      remotePrincipalId: principals.remoteA2,
      localPersonId: "person_a",
      status: "pending_verification",
      establishedAt: null
    });
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE peer_relationships
             SET status = 'active', established_at = ?, updated_at = ?
             WHERE id = 'relationship_pending_person'`
          )
          .run(t1, t1),
      /UNIQUE constraint failed: peer_relationships\.owner_user_id, peer_relationships\.local_person_id/
    );

    database
      .prepare(
        `UPDATE peer_relationships
         SET status = 'revoked', revoked_at = ?, updated_at = ?
         WHERE id = 'relationship_main'`
      )
      .run(t1, t1);
    database
      .prepare(
        `UPDATE peer_relationships
         SET status = 'active', established_at = ?, updated_at = ?
         WHERE id = 'relationship_pending_person'`
      )
      .run(t2, t2);
    database
      .prepare(
        `UPDATE peer_relationships SET status = 'paused', updated_at = ?
         WHERE id = 'relationship_pending_person'`
      )
      .run(t3);
    database
      .prepare(
        `UPDATE peer_relationships SET status = 'recovery_required', updated_at = ?
         WHERE id = 'relationship_pending_person'`
      )
      .run(t4);
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE peer_relationships
             SET status = 'active', revoked_at = NULL, updated_at = ?
             WHERE id = 'relationship_main'`
          )
          .run(t2),
      /lifecycle transition is inconsistent/
    );

    insertRelationship(database, {
      id: "relationship_null_person_one",
      ownerUserId: "owner_a",
      localPrincipalId: principals.localA,
      remotePrincipalId: principals.remoteA3,
      localPersonId: null
    });
    insertPrincipal(database, {
      id: "a".repeat(64),
      ownerUserId: "owner_a",
      kind: "remote",
      publicPrincipalId: "a".repeat(64),
      rootPublicKey: key(66)
    });
    insertRelationship(database, {
      id: "relationship_null_person_two",
      ownerUserId: "owner_a",
      localPrincipalId: principals.localA,
      remotePrincipalId: "a".repeat(64),
      localPersonId: null,
      status: "recovery_required"
    });

    database
      .prepare(
        `UPDATE forge_devices
         SET status = 'compromised', revoked_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(t2, t2, remoteDevice);
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE forge_devices
             SET status = 'approved', revoked_at = NULL, updated_at = ?
             WHERE id = ?`
          )
          .run(t3, remoteDevice),
      /device lifecycle transition is inconsistent/
    );

    database
      .prepare(
        `UPDATE forge_principals
         SET trust_state = 'revoked', revoked_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(t3, t3, principals.remoteA3);
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE forge_principals
             SET trust_state = 'verified', revoked_at = NULL, updated_at = ?
             WHERE id = ?`
          )
          .run(t4, principals.remoteA3),
      /principal lifecycle transition is inconsistent/
    );

    assertHealthy(database);
  });
});

const companionScopesJson = JSON.stringify(PEER_COMPANION_SCOPES);
const companionCapabilitiesJson = JSON.stringify(PEER_COMPANION_CAPABILITIES);
const companionOperationsJson = JSON.stringify(
  PEER_COMPANION_AUTHORIZED_OPERATION_IDS
);

function companionIdentifier(prefix: "pce_" | "pck_" | "ios_", nibble: string) {
  return `${prefix}${nibble.repeat(32)}`;
}

function companionPublicKey(byte: number): string {
  return Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, byte)]).toString(
    "base64url"
  );
}

function companionChallenge(byte: number): string {
  return Buffer.alloc(32, byte).toString("base64url");
}

function insertCompanionPairing(
  database: DatabaseSync,
  input: {
    id: string;
    ownerUserId: string;
    status?: string;
    pairedAt?: string | null;
    expiresAt?: string;
  }
): void {
  database
    .prepare(
      `INSERT INTO companion_pairing_sessions (
         id, user_id, pairing_token, status, capability_flags_json,
         api_base_url, paired_at, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, '[]', 'https://forge.test', ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.ownerUserId,
      `token_${input.id}`,
      input.status ?? "paired",
      input.pairedAt === undefined ? t0 : input.pairedAt,
      input.expiresAt ?? "2099-07-15T08:00:00.000Z",
      t0,
      t0
    );
}

type CompanionEnrollmentFixture = {
  enrollmentId: string;
  keyId: string;
  pairingSessionId: string;
  ownerUserId: string;
  deviceId: string;
  signingPublicKey: string;
  scopesJson: string;
  capabilitiesJson: string;
  operationsJson: string;
  status: "active" | "revoked";
  enrolledAt: string;
  legacyBootstrapDisabledAt: string;
  lastAuthenticatedAt: string;
  revokedAt: string | null;
  updatedAt: string;
};

function companionEnrollmentFixture(
  overrides: Partial<CompanionEnrollmentFixture> = {}
): CompanionEnrollmentFixture {
  return {
    enrollmentId: companionIdentifier("pce_", "a"),
    keyId: companionIdentifier("pck_", "b"),
    pairingSessionId: "pairing_094_a",
    ownerUserId: "owner_094_a",
    deviceId: companionIdentifier("ios_", "c"),
    signingPublicKey: companionPublicKey(1),
    scopesJson: companionScopesJson,
    capabilitiesJson: companionCapabilitiesJson,
    operationsJson: companionOperationsJson,
    status: "active",
    enrolledAt: t0,
    legacyBootstrapDisabledAt: t0,
    lastAuthenticatedAt: t0,
    revokedAt: null,
    updatedAt: t0,
    ...overrides
  };
}

function insertCompanionEnrollment(
  database: DatabaseSync,
  fixture: CompanionEnrollmentFixture
): void {
  database
    .prepare(
      `INSERT INTO peer_companion_enrollments (
         enrollment_id, key_id, pairing_session_id, owner_user_id, device_id,
         signing_public_key, algorithm, public_key_format, protection,
         scopes_json, capabilities_json, authorized_operations_json, status,
         enrolled_at, legacy_bootstrap_disabled_at, last_authenticated_at,
         revoked_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'ES256', 'ansi-x963',
                 'secure-enclave-user-presence', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fixture.enrollmentId,
      fixture.keyId,
      fixture.pairingSessionId,
      fixture.ownerUserId,
      fixture.deviceId,
      fixture.signingPublicKey,
      fixture.scopesJson,
      fixture.capabilitiesJson,
      fixture.operationsJson,
      fixture.status,
      fixture.enrolledAt,
      fixture.legacyBootstrapDisabledAt,
      fixture.lastAuthenticatedAt,
      fixture.revokedAt,
      fixture.updatedAt
    );
}

type CompanionChallengeFixture = {
  id: string;
  ownerUserId: string;
  pairingSessionId: string;
  deviceId: string;
  signingPublicKey: string;
  challenge: string;
  challengeHash: string;
  issuedAt: string;
  expiresAt: string;
  updatedAt: string;
};

function companionChallengeFixture(
  overrides: Partial<CompanionChallengeFixture> = {}
): CompanionChallengeFixture {
  return {
    id: `pec_${"d".repeat(32)}`,
    ownerUserId: "owner_094_a",
    pairingSessionId: "pairing_094_a",
    deviceId: companionIdentifier("ios_", "c"),
    signingPublicKey: companionPublicKey(1),
    challenge: companionChallenge(2),
    challengeHash: hash("3"),
    issuedAt: t0,
    expiresAt: t4,
    updatedAt: t0,
    ...overrides
  };
}

function insertCompanionChallenge(
  database: DatabaseSync,
  fixture: CompanionChallengeFixture
): void {
  database
    .prepare(
      `INSERT INTO peer_companion_enrollment_challenges (
         id, owner_user_id, operator_session_id, pairing_session_id,
         enrollment_attempt_id, device_id, signing_public_key, algorithm,
         public_key_format, protection, challenge, challenge_keyed_hash,
         status, issued_at, expires_at, consumed_at, enrollment_id,
         verification_signature_hash, updated_at
       ) VALUES (?, ?, 'operator_session_094', ?, 'attempt_094', ?, ?,
                 'ES256', 'ansi-x963', 'secure-enclave-user-presence', ?, ?,
                 'pending', ?, ?, NULL, NULL, NULL, ?)`
    )
    .run(
      fixture.id,
      fixture.ownerUserId,
      fixture.pairingSessionId,
      fixture.deviceId,
      fixture.signingPublicKey,
      fixture.challenge,
      fixture.challengeHash,
      fixture.issuedAt,
      fixture.expiresAt,
      fixture.updatedAt
    );
}

test("migration 094 preserves legacy commands but requires exact authority for every new command", async () => {
  await withDatabase(migration093, async (database) => {
    const migrationSql = await readFile(
      path.join(migrationsDir, migration094),
      "utf8"
    );
    assert.doesNotMatch(
      migrationSql,
      /^\s*(?:DROP|TRUNCATE|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\b/im
    );
    seedUser(database, "owner_094", "owner-094");
    database
      .prepare(
        `INSERT INTO peer_command_journal (
           command_id, owner_user_id, operation_id, target_type, target_id,
           request_hash, expected_version, status, attempt_count,
           result_hash, result_reference, last_error, last_dispatched_at,
           applied_at, created_at, updated_at
         ) VALUES (?, ?, 'createPeerInvitation', 'invitation', ?, ?, NULL,
                   'failed', 1, NULL, NULL, 'legacy uncertain command', ?,
                   NULL, ?, ?)`
      )
      .run(
        "legacy_command_094",
        "owner_094",
        "legacy_target_094",
        hash("a"),
        t1,
        t0,
        t1
      );

    await applyMigrationsThrough(database, migration094);

    const legacy = database
      .prepare(
        `SELECT status, attempt_count AS attemptCount, last_error AS lastError,
                authorization_state AS authorizationState,
                approval_owner_user_id AS approvalOwnerUserId,
                authorization_id AS authorizationId
         FROM peer_command_journal WHERE command_id = ?`
      )
      .get("legacy_command_094") as Record<string, unknown>;
    assert.deepEqual(
      { ...legacy },
      {
        status: "failed",
        attemptCount: 1,
        lastError: "legacy uncertain command",
        authorizationState: "legacy_unverifiable",
        approvalOwnerUserId: null,
        authorizationId: null
      }
    );

    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO peer_command_journal (
               command_id, owner_user_id, operation_id, target_type, target_id,
               request_hash, expected_version, status, attempt_count,
               last_error, created_at, updated_at
             ) VALUES (?, ?, 'revokePeerGrant', 'grant', 'old_binary', ?, NULL,
                       'prepared', 0, '', ?, ?)`
          )
          .run("old_binary_command_094", "owner_094", hash("b"), t2, t2),
      /exact current approval binding/
    );

    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE peer_command_journal
             SET authorization_state = 'approved',
                 approval_owner_user_id = 'owner_094',
                 approval_actor_class = 'operator_session',
                 approval_actor_id = 'session_legacy_094',
                 approval_session_id = 'session_legacy_094',
                 approval_capability_id = 'capability_legacy_094',
                 approval_method = 'webauthn', approval_deadline = ?,
                 authorization_id = 'authorization_legacy_094',
                 authorization_state_hash = ?
             WHERE command_id = 'legacy_command_094'`
          )
          .run("2099-07-15T12:05:00.000Z", hash("c")),
      /binding is immutable|invalid peer command authorization transition/
    );

    database
      .prepare(
        `INSERT INTO peer_command_journal (
           command_id, owner_user_id, operation_id, target_type, target_id,
           request_hash, expected_version, status, attempt_count,
           result_hash, result_reference, authorization_state,
           approval_owner_user_id, approval_actor_class, approval_actor_id,
           approval_session_id, approval_device_id, approval_capability_id,
           approval_method, approval_deadline, authorization_id,
           authorization_state_hash, invalidated_at, invalidation_reason,
           daemon_committed_at, receipt_checked_at, quarantine_reason,
           last_error, last_dispatched_at, applied_at, created_at, updated_at
         ) VALUES (?, ?, 'createPeerInvitation', 'invitation', ?, ?, NULL,
                   'prepared', 0, NULL, NULL, 'approved', ?,
                   'operator_session', 'session_current_094',
                   'session_current_094', NULL, 'capability_current_094',
                   'webauthn', ?, 'authorization_current_094', ?,
                   NULL, NULL, NULL, NULL, NULL, '', NULL, NULL, ?, ?)`
      )
      .run(
        "bound_command_094",
        "owner_094",
        "bound_target_094",
        hash("d"),
        "owner_094",
        "2099-07-15T12:05:00.000Z",
        hash("e"),
        t3,
        t3
      );

    const bound = database
      .prepare(
        `SELECT authorization_state AS authorizationState,
                approval_owner_user_id AS approvalOwnerUserId,
                approval_capability_id AS capabilityId,
                approval_deadline AS approvalDeadline
         FROM peer_command_journal WHERE command_id = ?`
      )
      .get("bound_command_094") as Record<string, unknown>;
    assert.deepEqual(
      { ...bound },
      {
        authorizationState: "approved",
        approvalOwnerUserId: "owner_094",
        capabilityId: "capability_current_094",
        approvalDeadline: "2099-07-15T12:05:00.000Z"
      }
    );

    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO peer_command_journal (
               command_id, owner_user_id, operation_id, target_type, target_id,
               request_hash, status, authorization_state,
               approval_owner_user_id, approval_actor_class, approval_actor_id,
               approval_session_id, approval_capability_id, approval_method,
               approval_deadline, authorization_id, authorization_state_hash,
               created_at, updated_at
             ) VALUES (?, ?, 'createPeerInvitation', 'invitation', 'duplicate',
                       ?, 'prepared', 'approved', ?, 'operator_session',
                       'session_duplicate_094', 'session_duplicate_094',
                       'capability_duplicate_094', 'webauthn', ?,
                       'authorization_current_094', ?, ?, ?)`
          )
          .run(
            "duplicate_auth_094",
            "owner_094",
            hash("f"),
            "owner_094",
            "2099-07-15T12:05:00.000Z",
            hash("1"),
            t4,
            t4
          ),
      /UNIQUE constraint failed: peer_command_journal\.owner_user_id, peer_command_journal\.authorization_id/
    );

    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM sqlite_master
             WHERE type = 'table' AND name IN (
               'peer_companion_enrollments',
               'peer_companion_enrollment_challenges',
               'peer_companion_v2_request_nonces'
             )`
          )
          .get() as { count: number }
      ).count,
      3
    );

    await applyMigrationsThrough(database, migration094);
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM peer_command_journal")
          .get() as { count: number }
      ).count,
      2
    );
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM migrations WHERE id = ?")
          .get(migration094) as { count: number }
      ).count,
      1
    );
    assertHealthy(database);
  });
});

test("migration 094 binds companion enrollment to its owner, pairing, device, and key", async () => {
  await withDatabase(migration094, (database) => {
    seedUser(database, "owner_094_a", "owner-094-a");
    seedUser(database, "owner_094_b", "owner-094-b");
    insertCompanionPairing(database, {
      id: "pairing_094_a",
      ownerUserId: "owner_094_a"
    });
    insertCompanionPairing(database, {
      id: "pairing_094_b",
      ownerUserId: "owner_094_b"
    });

    assert.throws(
      () =>
        insertCompanionEnrollment(
          database,
          companionEnrollmentFixture({ ownerUserId: "owner_094_b" })
        ),
      /requires an established pairing/
    );
    assert.throws(
      () =>
        insertCompanionEnrollment(
          database,
          companionEnrollmentFixture({ scopesJson: '["peer:status"]' })
        ),
      /CHECK constraint failed/
    );
    assert.throws(
      () =>
        insertCompanionEnrollment(
          database,
          companionEnrollmentFixture({
            operationsJson: companionOperationsJson.replace(
              ',"requestPeerResync"',
              ""
            )
          })
        ),
      /CHECK constraint failed/
    );
    assert.throws(
      () =>
        insertCompanionEnrollment(
          database,
          companionEnrollmentFixture({
            keyId: companionIdentifier("pck_", "A")
          })
        ),
      /CHECK constraint failed/
    );
    assert.throws(
      () =>
        insertCompanionEnrollment(
          database,
          companionEnrollmentFixture({
            signingPublicKey: `${companionPublicKey(1).slice(0, -1)}B`
          })
        ),
      /CHECK constraint failed/
    );
    assert.throws(
      () =>
        insertCompanionEnrollment(
          database,
          companionEnrollmentFixture({ enrolledAt: "not-a-timestamp" })
        ),
      /CHECK constraint failed/
    );

    const enrollment = companionEnrollmentFixture();
    insertCompanionEnrollment(database, enrollment);
    for (const mutation of [
      `device_id = '${companionIdentifier("ios_", "d")}'`,
      `signing_public_key = '${companionPublicKey(4)}'`,
      "owner_user_id = 'owner_094_b'",
      "pairing_session_id = 'pairing_094_b'"
    ]) {
      assert.throws(
        () =>
          database
            .prepare(
              `UPDATE peer_companion_enrollments SET ${mutation}
               WHERE enrollment_id = ?`
            )
            .run(enrollment.enrollmentId),
        /binding is immutable/
      );
    }
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE companion_pairing_sessions SET user_id = 'owner_094_b'
             WHERE id = 'pairing_094_a'`
          )
          .run(),
      /pairing owner binding is immutable/
    );

    database
      .prepare(
        `UPDATE peer_companion_enrollments
         SET status = 'revoked', revoked_at = ?, updated_at = ?
         WHERE enrollment_id = ?`
      )
      .run(t2, t2, enrollment.enrollmentId);
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE peer_companion_enrollments
             SET status = 'active', revoked_at = NULL, updated_at = ?
             WHERE enrollment_id = ?`
          )
          .run(t3, enrollment.enrollmentId),
      /revocation is terminal|lifecycle is inconsistent/
    );
    assert.equal(
      (
        database
          .prepare(
            `SELECT status FROM peer_companion_enrollments
             WHERE enrollment_id = ?`
          )
          .get(enrollment.enrollmentId) as { status: string }
      ).status,
      "revoked"
    );
    assertHealthy(database);
  });
});

test("migration 094 enforces challenge pairing, encoding, and terminal transitions", async () => {
  await withDatabase(migration094, (database) => {
    seedUser(database, "owner_094_a", "owner-094-a");
    seedUser(database, "owner_094_b", "owner-094-b");
    insertCompanionPairing(database, {
      id: "pairing_094_a",
      ownerUserId: "owner_094_a"
    });
    insertCompanionPairing(database, {
      id: "pairing_094_b",
      ownerUserId: "owner_094_b"
    });
    const enrollment = companionEnrollmentFixture();
    insertCompanionEnrollment(database, enrollment);

    assert.throws(
      () =>
        insertCompanionChallenge(
          database,
          companionChallengeFixture({ pairingSessionId: "pairing_094_b" })
        ),
      /requires an established pairing/
    );
    for (const malformed of [
      companionChallengeFixture({ expiresAt: t0 }),
      companionChallengeFixture({ challengeHash: hash("A") }),
      companionChallengeFixture({ challenge: `${"a".repeat(42)}B` }),
      companionChallengeFixture({
        signingPublicKey: `${companionPublicKey(1).slice(0, -1)}B`
      })
    ]) {
      assert.throws(
        () => insertCompanionChallenge(database, malformed),
        /CHECK constraint failed/
      );
    }

    const consumed = companionChallengeFixture();
    insertCompanionChallenge(database, consumed);
    for (const mutation of [
      `device_id = '${companionIdentifier("ios_", "e")}'`,
      `signing_public_key = '${companionPublicKey(5)}'`,
      `challenge = '${companionChallenge(6)}'`
    ]) {
      assert.throws(
        () =>
          database
            .prepare(
              `UPDATE peer_companion_enrollment_challenges SET ${mutation}
               WHERE id = ?`
            )
            .run(consumed.id),
        /binding is immutable/
      );
    }
    database
      .prepare(
        `UPDATE peer_companion_enrollment_challenges
         SET status = 'consumed', consumed_at = ?, enrollment_id = ?,
             verification_signature_hash = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(t1, enrollment.enrollmentId, hash("7"), t1, consumed.id);
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE peer_companion_enrollment_challenges
             SET status = 'rejected', updated_at = ? WHERE id = ?`
          )
          .run(t2, consumed.id),
      /challenge is terminal/
    );

    const expired = companionChallengeFixture({
      id: `pec_${"e".repeat(32)}`,
      challenge: companionChallenge(8),
      challengeHash: hash("8")
    });
    insertCompanionChallenge(database, expired);
    database
      .prepare(
        `UPDATE peer_companion_enrollment_challenges
         SET status = 'expired', updated_at = ? WHERE id = ?`
      )
      .run(t1, expired.id);
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE peer_companion_enrollment_challenges
             SET status = 'pending', updated_at = ? WHERE id = ?`
          )
          .run(t2, expired.id),
      /challenge is terminal/
    );
    assertHealthy(database);
  });
});

test("migration 094 makes companion request nonces replay-safe and immutable", async () => {
  await withDatabase(migration094, async (database) => {
    seedUser(database, "owner_094_a", "owner-094-a");
    insertCompanionPairing(database, {
      id: "pairing_094_a",
      ownerUserId: "owner_094_a"
    });
    const enrollment = companionEnrollmentFixture();
    insertCompanionEnrollment(database, enrollment);

    const insertNonce = database.prepare(
      `INSERT INTO peer_companion_v2_request_nonces (
         enrollment_id, nonce_hash, request_digest, issued_at, expires_at,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`
    );
    insertNonce.run(enrollment.enrollmentId, hash("1"), hash("2"), t0, t4, t1);
    assert.throws(
      () =>
        insertNonce.run(
          enrollment.enrollmentId,
          hash("1"),
          hash("3"),
          t0,
          t4,
          t1
        ),
      /UNIQUE constraint failed/
    );
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE peer_companion_v2_request_nonces SET request_digest = ?
             WHERE enrollment_id = ? AND nonce_hash = ?`
          )
          .run(hash("4"), enrollment.enrollmentId, hash("1")),
      /request nonce is immutable/
    );
    for (const malformed of [
      [hash("A"), hash("5"), t0, t4, t1],
      [hash("6"), "short", t0, t4, t1],
      [hash("7"), hash("7"), "not-a-timestamp", t4, t1],
      [hash("8"), hash("8"), t1, t0, t1]
    ] as const) {
      assert.throws(
        () => insertNonce.run(enrollment.enrollmentId, ...malformed),
        /CHECK constraint failed/
      );
    }

    await applyMigrationsThrough(database, migration094);
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM peer_companion_v2_request_nonces`
          )
          .get() as { count: number }
      ).count,
      1
    );
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM migrations WHERE id = ?")
          .get(migration094) as { count: number }
      ).count,
      1
    );
    assertHealthy(database);
  });
});
