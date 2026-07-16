import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migrationName = "093_gamification_incremental_reconciliation.sql";

async function applyMigrationsBefore093(database: DatabaseSync) {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file < migrationName)
    .sort();
  for (const file of files) {
    database.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
}

test("migration 093 preserves rewards and backfills indexed owner provenance", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-game-reconcile-migration-")
  );
  const database = new DatabaseSync(path.join(rootDir, "forge.sqlite"));
  database.exec("PRAGMA foreign_keys = ON");
  try {
    await applyMigrationsBefore093(database);
    const timestamp = "2026-07-15T12:00:00.000Z";
    database
      .prepare(
        `INSERT INTO reward_ledger (
           id, rule_id, event_log_id, entity_type, entity_id, actor, source,
           delta_xp, reason_title, reason_summary, reversible_group,
           reversed_by_reward_id, metadata_json, created_at
         ) VALUES (?, NULL, NULL, 'system', ?, NULL, 'system', 3, ?, '', NULL, NULL, ?, ?)`
      )
      .run(
        "rwd_pre093_owned",
        "pre093-owned",
        "Owned legacy reward",
        JSON.stringify({ ownerUserId: "user_operator" }),
        timestamp
      );
    database
      .prepare(
        `INSERT INTO reward_ledger (
           id, rule_id, event_log_id, entity_type, entity_id, actor, source,
           delta_xp, reason_title, reason_summary, reversible_group,
           reversed_by_reward_id, metadata_json, created_at
         ) VALUES (?, NULL, NULL, 'system', ?, NULL, 'system', 2, ?, '', NULL, NULL, ?, ?)`
      )
      .run(
        "rwd_pre093_unknown",
        "pre093-unknown",
        "Unknown legacy reward",
        JSON.stringify({ ownerUserId: "user_missing" }),
        timestamp
      );
    const countBefore = (
      database.prepare("SELECT COUNT(*) AS count FROM reward_ledger").get() as {
        count: number;
      }
    ).count;

    database.exec(
      await readFile(path.join(migrationsDir, migrationName), "utf8")
    );

    const rewards = database
      .prepare(
        `SELECT id, owner_user_id
         FROM reward_ledger
         WHERE id LIKE 'rwd_pre093_%'
         ORDER BY id`
      )
      .all() as Array<{ id: string; owner_user_id: string | null }>;
    assert.deepEqual(
      rewards.map((row) => ({ ...row })),
      [
        { id: "rwd_pre093_owned", owner_user_id: "user_operator" },
        { id: "rwd_pre093_unknown", owner_user_id: null }
      ]
    );
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM reward_ledger")
          .get() as {
          count: number;
        }
      ).count,
      countBefore
    );
    assert.ok(
      database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index' AND name = 'idx_reward_ledger_owner_created'`
        )
        .get()
    );
    assert.ok(
      database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name = 'gamification_reconciliation_state'`
        )
        .get()
    );
  } finally {
    database.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
