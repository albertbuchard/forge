import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";

import { digestBase64Url } from "../../src/encoding.js";
import { ServiceError } from "../../src/errors.js";
import {
  CURRENT_STORAGE_SCHEMA_VERSION,
  STORAGE_MIGRATIONS
} from "../../src/storage/migrations.js";
import { SqliteConnectivityStore } from "../../src/storage/sqlite.js";

describe("SQLite upgrades", () => {
  it("upgrades a version-1 database without changing live ciphertext", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "forge-connectivity-upgrade-")
    );
    const databasePath = path.join(directory, "connectivity.sqlite");
    const ciphertext = Buffer.alloc(64, 0xa5);
    const nowMs = Date.UTC(2026, 6, 15, 12, 0, 0);
    const channelHash = digestBase64Url("upgrade-channel");
    const messageId = digestBase64Url("upgrade-message");
    const nonceHash = digestBase64Url("upgrade-nonce");

    try {
      const oldDatabase = new DatabaseSync(databasePath);
      oldDatabase.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          applied_at INTEGER NOT NULL
        ) STRICT;
      `);
      const initialMigration = STORAGE_MIGRATIONS[0];
      assert.ok(initialMigration);
      oldDatabase.exec(initialMigration.sql);
      oldDatabase
        .prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
        )
        .run(initialMigration.version, initialMigration.name, nowMs);
      oldDatabase
        .prepare(
          `INSERT INTO envelopes (
             channel_hash, message_id, ciphertext, ciphertext_bytes, content_digest,
             expires_at, retain_until, state, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
        )
        .run(
          channelHash,
          messageId,
          ciphertext,
          ciphertext.length,
          digestBase64Url(ciphertext),
          nowMs + 120_000,
          nowMs + 240_000,
          nowMs
        );
      oldDatabase
        .prepare(
          `INSERT INTO auth_nonces (channel_hash, nonce_hash, expires_at)
           VALUES (?, ?, ?)`
        )
        .run(channelHash, nonceHash, nowMs + 300_000);
      oldDatabase.close();

      const upgraded = new SqliteConnectivityStore({
        busyTimeoutMs: 1_000,
        databasePath
      });
      assert.equal(upgraded.schemaVersion, CURRENT_STORAGE_SCHEMA_VERSION);
      assert.deepEqual(upgraded.healthCheck(), {
        ok: true,
        schemaVersion: CURRENT_STORAGE_SCHEMA_VERSION
      });
      const page = upgraded.listEnvelopes(channelHash, 0, 10, nowMs);
      assert.equal(page.records.length, 1);
      const upgradedRecord = page.records[0];
      assert.ok(upgradedRecord);
      assert.deepEqual(upgradedRecord.ciphertext, ciphertext);
      assert.equal(upgradedRecord.messageId, messageId);
      const usage = upgraded.getUsage(channelHash);
      assert.equal(usage.channel.nonceCount, 1);
      assert.equal(usage.globalNonceCount, 1);
      assert.equal(usage.globalRetainedEnvelopeCount, 1);
      upgraded.close();

      const planDatabase = new DatabaseSync(databasePath, { readOnly: true });
      const envelopePlan = planDatabase
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id, message_id, ciphertext, expires_at, created_at
           FROM envelopes
           WHERE channel_hash = ? AND state = 'pending' AND expires_at > ? AND id > ?
           ORDER BY id ASC LIMIT ?`
        )
        .all(channelHash, nowMs, 0, 10) as unknown as { detail: string }[];
      const keyPackagePlan = planDatabase
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id, package_id, ciphertext, expires_at, created_at
           FROM key_packages
           WHERE channel_hash = ? AND expires_at > ? AND id > ?
           ORDER BY id ASC LIMIT ?`
        )
        .all(channelHash, nowMs, 0, 10) as unknown as { detail: string }[];
      planDatabase.close();
      assert.match(
        envelopePlan.map((row) => row.detail).join("\n"),
        /idx_envelopes_channel_pending_page/
      );
      assert.match(
        keyPackagePlan.map((row) => row.detail).join("\n"),
        /idx_key_packages_channel_page/
      );

      const reopened = new SqliteConnectivityStore({
        busyTimeoutMs: 1_000,
        databasePath
      });
      assert.equal(
        reopened.listEnvelopes(channelHash, 0, 10, nowMs).records.length,
        1
      );
      reopened.close();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("fails closed when the database schema is newer than the binary", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "forge-connectivity-newer-schema-")
    );
    const databasePath = path.join(directory, "connectivity.sqlite");
    try {
      const database = new DatabaseSync(databasePath);
      database.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          applied_at INTEGER NOT NULL
        ) STRICT;
        INSERT INTO schema_migrations (version, name, applied_at) VALUES (999, 'future', 0);
      `);
      database.close();

      assert.throws(
        () =>
          new SqliteConnectivityStore({ busyTimeoutMs: 1_000, databasePath }),
        (error: unknown) =>
          error instanceof ServiceError && error.code === "STORAGE_UNAVAILABLE"
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("fails closed when the ordered migration ledger is forged", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "forge-connectivity-forged-ledger-")
    );
    const databasePath = path.join(directory, "connectivity.sqlite");
    try {
      const database = new DatabaseSync(databasePath);
      database.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          applied_at INTEGER NOT NULL
        ) STRICT;
      `);
      const initialMigration = STORAGE_MIGRATIONS[0];
      assert.ok(initialMigration);
      database.exec(initialMigration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
        )
        .run(initialMigration.version, "forged_migration_name", 0);
      database.close();

      assert.throws(
        () =>
          new SqliteConnectivityStore({ busyTimeoutMs: 1_000, databasePath }),
        (error: unknown) =>
          error instanceof ServiceError && error.code === "STORAGE_UNAVAILABLE"
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it(
    "rejects an insecure existing data directory without changing its mode",
    { skip: process.platform === "win32" },
    async () => {
      const directory = await mkdtemp(
        path.join(tmpdir(), "forge-connectivity-path-mode-")
      );
      const sharedDirectory = path.join(directory, "shared");
      await mkdir(sharedDirectory, { mode: 0o755 });
      await chmod(sharedDirectory, 0o755);
      try {
        assert.throws(
          () =>
            new SqliteConnectivityStore({
              busyTimeoutMs: 1_000,
              databasePath: path.join(sharedDirectory, "connectivity.sqlite")
            }),
          (error: unknown) =>
            error instanceof ServiceError &&
            error.code === "STORAGE_UNAVAILABLE"
        );
        assert.equal((await stat(sharedDirectory)).mode & 0o777, 0o755);
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    }
  );
});
