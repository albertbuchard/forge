import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  KeyedSecretDigester,
  type OpaqueSecretSource,
  type SecurityClock
} from "./security-runtime.js";
import {
  SECURITY_CREDENTIAL_SCHEMA_SQL,
  SECURITY_PAIRING_CLIENT_METADATA_SCHEMA_SQL,
  SqliteSecurityStore
} from "./sqlite-security-store.js";

const migrationRoots = [
  path.join(process.cwd(), "apps/api/migrations"),
  path.join(process.cwd(), "plugins/codex/runtime/server/migrations"),
  path.join(
    process.cwd(),
    "plugins/hermes/forge_hermes/runtime/apps/api/migrations"
  )
] as const;

const localCapabilityMigrationRoots = [
  path.join(process.cwd(), "apps/api/migrations"),
  path.join(process.cwd(), "plugins/codex/runtime/server/migrations"),
  path.join(
    process.cwd(),
    "plugins/codex/runtime/dist/server/apps/api/migrations"
  ),
  path.join(
    process.cwd(),
    "plugins/hermes/forge_hermes/runtime/apps/api/migrations"
  ),
  path.join(
    process.cwd(),
    "plugins/hermes/forge_hermes/runtime/dist/server/apps/api/migrations"
  )
] as const;

const allRuntimeMigrationRoots = [
  ...localCapabilityMigrationRoots,
  path.join(process.cwd(), "plugins/openclaw/server/migrations"),
  path.join(
    process.cwd(),
    "plugins/openclaw/dist/server/apps/api/migrations"
  )
] as const;

function tableNames(database: DatabaseSync) {
  return (
    database
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name LIKE 'security_%'
         ORDER BY name`
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

test("migration 116 is additive, replay-safe, and identical in all four runtime mirrors", async () => {
  const migrationName = "116_local_capability_approval.sql";
  const migrationCopies = await Promise.all(
    localCapabilityMigrationRoots.map((root) =>
      readFile(path.join(root, migrationName))
    )
  );
  for (const copy of migrationCopies.slice(1)) {
    assert.deepEqual(copy, migrationCopies[0]);
  }
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE security_owners (owner_id TEXT PRIMARY KEY);
      CREATE TABLE security_installation (installation_id TEXT PRIMARY KEY);
      INSERT INTO security_owners (owner_id) VALUES ('owner');
      INSERT INTO security_installation (installation_id) VALUES ('installation');
    `);
    const sql = migrationCopies[0]!.toString("utf8");
    database.exec(sql);
    database.exec(sql);
    database
      .prepare(
        `INSERT INTO security_local_capability_approvals (
           owner_id, installation_id, capability_id, warning_version,
           warning_sha256, approved_at, approved_by_subject_id, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "owner",
        "installation",
        "local_owner_legacy_host_execution",
        1,
        "a".repeat(64),
        "2026-07-26T20:00:00.000Z",
        "owner-session",
        "2026-07-26T20:00:00.000Z"
      );
    assert.equal(
      (
        database
          .prepare(
            "SELECT count(*) AS count FROM security_local_capability_approvals"
          )
          .get() as { count: number }
      ).count,
      1
    );
  } finally {
    database.close();
  }
});

test("migration 117 adds only an encrypted Google secret reference and is identical in all six runtime mirrors", async () => {
  const migrationName = "117_google_oauth_encrypted_secret_reference.sql";
  const migrationCopies = await Promise.all(
    allRuntimeMigrationRoots.map((root) =>
      readFile(path.join(root, migrationName))
    )
  );
  assert.equal(migrationCopies.length, 7);
  for (const copy of migrationCopies.slice(1)) {
    assert.deepEqual(copy, migrationCopies[0]);
  }

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE stored_secrets (
        id TEXT PRIMARY KEY,
        cipher_text TEXT NOT NULL
      );
      CREATE TABLE app_settings (
        id INTEGER PRIMARY KEY,
        google_client_secret TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO app_settings (id, google_client_secret)
      VALUES (1, 'synthetic-legacy-sentinel');
    `);
    database.exec(migrationCopies[0]!.toString("utf8"));

    const row = database
      .prepare(
        `SELECT google_client_secret, google_client_secret_id
         FROM app_settings
         WHERE id = 1`
      )
      .get() as {
      google_client_secret: string;
      google_client_secret_id: string | null;
    };
    assert.equal(row.google_client_secret, "synthetic-legacy-sentinel");
    assert.equal(row.google_client_secret_id, null);
    assert.equal(
      (
        database
          .prepare(`SELECT count(*) AS count FROM stored_secrets`)
          .get() as { count: number }
      ).count,
      0,
      "ordinary migration must not read or copy the legacy secret"
    );
  } finally {
    database.close();
  }
});

test("migration 118 creates a replay-safe audit chain and is identical in every runtime mirror", async () => {
  const migrationName = "118_security_audit_chain.sql";
  const migrationCopies = await Promise.all(
    allRuntimeMigrationRoots.map((root) =>
      readFile(path.join(root, migrationName))
    )
  );
  assert.equal(migrationCopies.length, 7);
  for (const copy of migrationCopies.slice(1)) {
    assert.deepEqual(copy, migrationCopies[0]);
  }

  const database = new DatabaseSync(":memory:");
  try {
    const sql = migrationCopies[0]!.toString("utf8");
    database.exec(sql);
    database.exec(sql);
    database
      .prepare(
        `INSERT INTO security_audit_events (
          event_id, occurred_at, principal_kind, action, resource, outcome,
          reason, policy_version, detail_json, previous_mac, event_mac
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "audit_1",
        "2026-07-26T15:00:00.000Z",
        "operator_session",
        "notes.read",
        "forge://route/api/v1/notes",
        "admitted",
        "gateway_admitted",
        "forge-access-gateway/1",
        "{}",
        "0".repeat(64),
        "1".repeat(64)
      );
    assert.equal(
      (
        database
          .prepare(
            "SELECT count(*) AS count FROM security_audit_events"
          )
          .get() as { count: number }
      ).count,
      1
    );
  } finally {
    database.close();
  }
});

test("migration 119 adds nullable audit and background correlation and is identical in every runtime mirror", async () => {
  const migrationName = "119_security_audit_correlation.sql";
  const copies = await Promise.all(
    allRuntimeMigrationRoots.map((root) =>
      readFile(path.join(root, migrationName))
    )
  );
  for (const copy of copies.slice(1)) {
    assert.deepEqual(copy, copies[0]);
  }
  const canonical = copies[0]!.toString("utf8");
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(
      await readFile(
        path.join(
          allRuntimeMigrationRoots[0],
          "112_background_job_authorization.sql"
        ),
        "utf8"
      )
    );
    database.exec(
      await readFile(
        path.join(
          allRuntimeMigrationRoots[0],
          "118_security_audit_chain.sql"
        ),
        "utf8"
      )
    );
    database.exec(canonical);
    const auditColumns = database
      .prepare("PRAGMA table_info(security_audit_events)")
      .all() as Array<{ name: string }>;
    assert.ok(auditColumns.some((column) => column.name === "connection_id"));
    assert.ok(auditColumns.some((column) => column.name === "job_id"));
    const backgroundColumns = database
      .prepare("PRAGMA table_info(security_background_job_authorizations)")
      .all() as Array<{ name: string }>;
    assert.ok(
      backgroundColumns.some((column) => column.name === "origin_request_id")
    );
    assert.ok(
      backgroundColumns.some(
        (column) => column.name === "origin_connection_id"
      )
    );
  } finally {
    database.close();
  }
});

test("migration 111 is replay-safe, matches the runtime schema, and is mirrored byte-for-byte", async () => {
  const migrationName = "111_security_credential_foundation.sql";
  const migrationCopies = await Promise.all(
    migrationRoots.map((root) => readFile(path.join(root, migrationName)))
  );
  assert.ok(migrationCopies[0]!.byteLength > 0);
  assert.deepEqual(migrationCopies[1], migrationCopies[0]);
  assert.deepEqual(migrationCopies[2], migrationCopies[0]);

  const migrated = new DatabaseSync(":memory:");
  const runtime = new DatabaseSync(":memory:");
  try {
    const migrationSql = migrationCopies[0]!.toString("utf8");
    migrated.exec("PRAGMA foreign_keys = ON;");
    migrated.exec(migrationSql);
    migrated.exec(migrationSql);
    runtime.exec(SECURITY_CREDENTIAL_SCHEMA_SQL);
    assert.deepEqual(tableNames(migrated), tableNames(runtime));

    const clock: SecurityClock = {
      now: () => new Date("2026-07-25T20:00:00.000Z")
    };
    const secrets: OpaqueSecretSource = {
      bytes: (length) =>
        new Uint8Array(
          createHash("sha256")
            .update(`migration-secret-${length}`)
            .digest()
            .subarray(0, length)
        )
    };
    const store = new SqliteSecurityStore(
      migrated,
      clock,
      secrets,
      new KeyedSecretDigester(new Uint8Array(32).fill(31))
    );
    const firstInstallation = store.ensureInstallation();
    assert.match(firstInstallation, /^install_[0-9a-f-]{36}$/u);
    assert.equal(store.ensureInstallation(), firstInstallation);
  } finally {
    migrated.close();
    runtime.close();
  }
});

test("released course migrations 107 through 110 remain identical in every runtime mirror", async () => {
  for (const migrationName of [
    "107_course_release_history.sql",
    "108_course_voice_sessions_and_attempt_order.sql",
    "109_course_attempt_idempotency_scope.sql",
    "110_course_concept_revision_history.sql"
  ]) {
    const copies = await Promise.all(
      migrationRoots.map((root) => readFile(path.join(root, migrationName)))
    );
    assert.deepEqual(copies[1], copies[0], migrationName);
    assert.deepEqual(copies[2], copies[0], migrationName);
  }
});

test("released migration 112 remains replay-safe and mirrored byte-for-byte", async () => {
  const migrationName = "112_background_job_authorization.sql";
  const migrationCopies = await Promise.all(
    migrationRoots.map((root) => readFile(path.join(root, migrationName)))
  );
  assert.ok(migrationCopies[0]!.byteLength > 0);
  assert.deepEqual(migrationCopies[1], migrationCopies[0]);
  assert.deepEqual(migrationCopies[2], migrationCopies[0]);

  const migrated = new DatabaseSync(":memory:");
  const runtime = new DatabaseSync(":memory:");
  try {
    const migrationSql = migrationCopies[0]!.toString("utf8");
    migrated.exec(migrationSql);
    migrated.exec(migrationSql);
    const columns = migrated
      .prepare(`PRAGMA table_info(security_background_job_authorizations)`)
      .all() as Array<{ name: string }>;
    assert.equal(
      columns.some((column) => column.name === "budget_json"),
      false,
      "released migration 112 must not be rewritten after deployment"
    );
  } finally {
    migrated.close();
    runtime.close();
  }
});

test("migration 115 additively backfills enforceable background budgets and is mirrored byte-for-byte", async () => {
  const foundationName = "112_background_job_authorization.sql";
  const migrationName = "115_background_job_authorization_budget.sql";
  const [foundationSql, ...migrationCopies] = await Promise.all([
    readFile(path.join(migrationRoots[0], foundationName)),
    ...migrationRoots.map((root) => readFile(path.join(root, migrationName)))
  ]);
  assert.deepEqual(migrationCopies[1], migrationCopies[0]);
  assert.deepEqual(migrationCopies[2], migrationCopies[0]);

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(foundationSql.toString("utf8"));
    database
      .prepare(
        `INSERT INTO security_background_job_authorizations (
           job_id, principal_json, action, resource, policy_version, state,
           denial_reason, created_at, updated_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, 'queued', NULL, ?, ?, NULL)`
      )
      .run(
        "job_pre_115",
        "{}",
        "backup.execute",
        "forge://background/backup",
        "policy/1",
        "2026-07-26T00:00:00.000Z",
        "2026-07-26T00:00:00.000Z"
      );
    database.exec(migrationCopies[0]!.toString("utf8"));

    const row = database
      .prepare(
        `SELECT budget_json
         FROM security_background_job_authorizations
         WHERE job_id = ?`
      )
      .get("job_pre_115") as { budget_json: string };
    assert.deepEqual(JSON.parse(row.budget_json), {
      maximumRuntimeMilliseconds: 1_800_000,
      maximumEffectInvocations: 1,
      capabilities: ["backup.execute"]
    });
    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO security_background_job_authorizations (
             job_id, principal_json, action, resource, policy_version,
             budget_json, state, denial_reason, created_at, updated_at,
             completed_at
           ) VALUES ('job_without_budget', '{}', 'x', 'y', 'z', NULL,
                     'queued', NULL, '2026-07-26T00:00:00.000Z',
                     '2026-07-26T00:00:00.000Z', NULL)`
        )
        .run()
    );
  } finally {
    database.close();
  }
});

test("migration 113 is additive, replay-safe, and mirrored byte-for-byte", async () => {
  const foundationName = "111_security_credential_foundation.sql";
  const migrationName = "113_security_pairing_client_type.sql";
  const [foundationSql, ...migrationCopies] = await Promise.all([
    readFile(path.join(migrationRoots[0], foundationName)),
    ...migrationRoots.map((root) => readFile(path.join(root, migrationName)))
  ]);
  assert.ok(migrationCopies[0]!.byteLength > 0);
  assert.deepEqual(migrationCopies[1], migrationCopies[0]);
  assert.deepEqual(migrationCopies[2], migrationCopies[0]);

  const migrated = new DatabaseSync(":memory:");
  try {
    migrated.exec("PRAGMA foreign_keys = ON;");
    migrated.exec(foundationSql.toString("utf8"));
    const migrationSql = migrationCopies[0]!.toString("utf8");
    migrated.exec(migrationSql);
    migrated.exec(migrationSql);
    const runtime = new DatabaseSync(":memory:");
    try {
      runtime.exec(SECURITY_CREDENTIAL_SCHEMA_SQL);
      runtime.exec(SECURITY_PAIRING_CLIENT_METADATA_SCHEMA_SQL);
      assert.deepEqual(tableNames(migrated), tableNames(runtime));
    } finally {
      runtime.close();
    }
    const columns = migrated
      .prepare(`PRAGMA table_info(security_pairing_client_metadata)`)
      .all() as Array<{ name: string }>;
    assert.deepEqual(
      columns.map((column) => column.name),
      ["pairing_request_id", "client_type"]
    );
  } finally {
    migrated.close();
  }
});

test("migration 114 bounds legacy tokens, enforces one security owner, and is mirrored byte-for-byte", async () => {
  const foundationName = "111_security_credential_foundation.sql";
  const migrationName = "114_legacy_token_migration_and_single_owner.sql";
  const [foundationSql, ...migrationCopies] = await Promise.all([
    readFile(path.join(migrationRoots[0], foundationName)),
    ...migrationRoots.map((root) => readFile(path.join(root, migrationName)))
  ]);
  assert.ok(migrationCopies[0]!.byteLength > 0);
  assert.deepEqual(migrationCopies[1], migrationCopies[0]);
  assert.deepEqual(migrationCopies[2], migrationCopies[0]);

  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON;");
    database.exec(`
      CREATE TABLE agent_tokens (
        id TEXT PRIMARY KEY
      ) STRICT;
    `);
    database.exec(foundationSql.toString("utf8"));
    const migrationSql = migrationCopies[0]!.toString("utf8");
    database.exec(migrationSql);
    database.exec(migrationSql);
    database
      .prepare(
        `INSERT INTO security_owners (
           owner_id, security_epoch, created_at, recovered_at
         ) VALUES (?, 1, ?, NULL)`
      )
      .run("owner-primary", "2026-07-26T20:00:00.000Z");
    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO security_owners (
               owner_id, security_epoch, created_at, recovered_at
             ) VALUES (?, 1, ?, NULL)`
          )
          .run("owner-forbidden", "2026-07-26T20:00:00.000Z"),
      /single-owner mode/
    );
    const columns = database
      .prepare(`PRAGMA table_info(security_legacy_token_migrations)`)
      .all() as Array<{ name: string }>;
    assert.deepEqual(
      columns.map((column) => column.name),
      [
        "token_id",
        "owner_id",
        "installation_id",
        "audience",
        "profile",
        "scopes_json",
        "migrated_at",
        "expires_at",
        "revoked_at"
      ]
    );
  } finally {
    database.close();
  }
});
