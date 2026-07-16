import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migrationName = "089_preference_owner_scope.sql";

async function applyMigrationsBefore089(database: DatabaseSync) {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file < migrationName)
    .sort();
  for (const file of files) {
    database.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
}

test("migration 089 backfills preference ownership without changing records", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-owner-migration-")
  );
  const database = new DatabaseSync(path.join(rootDir, "forge.sqlite"));
  database.exec("PRAGMA foreign_keys = ON");
  try {
    await applyMigrationsBefore089(database);
    const timestamp = "2026-07-15T12:00:00.000Z";
    database
      .prepare(
        `INSERT INTO preference_profiles (
           id, user_id, domain, default_context_id, model_version,
           created_at, updated_at
         ) VALUES (?, 'user_operator', 'projects', NULL, 'pref-v1-bt-lite', ?, ?)`
      )
      .run("profile_pre089", timestamp, timestamp);
    database
      .prepare(
        `INSERT INTO preference_contexts (
           id, profile_id, name, description, share_mode, active, is_default,
           decay_days, created_at, updated_at
         ) VALUES (?, 'profile_pre089', 'Before migration', '', 'blended', 1, 1, 90, ?, ?)`
      )
      .run("context_pre089", timestamp, timestamp);
    database
      .prepare(
        `INSERT INTO preference_items (
           id, profile_id, label, description, tags_json,
           feature_weights_json, metadata_json, created_at, updated_at
         ) VALUES (?, 'profile_pre089', 'Existing choice', '', '[]', '{}', '{}', ?, ?)`
      )
      .run("item_pre089", timestamp, timestamp);
    database
      .prepare(
        `INSERT INTO absolute_signals (
           id, profile_id, context_id, user_id, item_id, signal_type,
           strength, source, created_at
         ) VALUES (
           ?, 'profile_pre089', 'context_pre089', 'user_operator',
           'item_pre089', 'favorite', 1, 'ui', ?
         )`
      )
      .run("signal_pre089", timestamp);

    const migration = await readFile(
      path.join(migrationsDir, migrationName),
      "utf8"
    );
    database.exec(migration);
    database.exec(migration);

    const owners = database
      .prepare(
        `SELECT entity_type, entity_id, user_id
         FROM entity_owners
         WHERE entity_id IN ('context_pre089', 'item_pre089', 'signal_pre089')
         ORDER BY entity_type ASC`
      )
      .all() as Array<{
      entity_type: string;
      entity_id: string;
      user_id: string;
    }>;
    assert.deepEqual(
      owners.map((owner) => ({ ...owner })),
      [
        {
          entity_type: "preference_context",
          entity_id: "context_pre089",
          user_id: "user_operator"
        },
        {
          entity_type: "preference_item",
          entity_id: "item_pre089",
          user_id: "user_operator"
        },
        {
          entity_type: "preference_signal",
          entity_id: "signal_pre089",
          user_id: "user_operator"
        }
      ]
    );
    const preserved = database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM preference_contexts WHERE id = 'context_pre089') AS context_count,
           (SELECT COUNT(*) FROM preference_items WHERE id = 'item_pre089') AS item_count,
           (SELECT COUNT(*) FROM absolute_signals WHERE id = 'signal_pre089') AS signal_count`
      )
      .get() as {
      context_count: number;
      item_count: number;
      signal_count: number;
    };
    assert.deepEqual(
      { ...preserved },
      {
        context_count: 1,
        item_count: 1,
        signal_count: 1
      }
    );
  } finally {
    database.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
