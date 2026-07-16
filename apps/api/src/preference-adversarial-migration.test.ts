import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migrationName = "090_preference_adversarial_hardening.sql";

async function applyMigrationsBefore090(database: DatabaseSync) {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file < migrationName)
    .sort();
  for (const file of files) {
    database.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
}

test("migration 090 conservatively preserves legacy concept archives and repairs context owners", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-pref-090-"));
  const database = new DatabaseSync(path.join(rootDir, "forge.sqlite"));
  database.exec("PRAGMA foreign_keys = ON");
  try {
    await applyMigrationsBefore090(database);
    const timestamp = "2026-07-15T12:00:00.000Z";
    database
      .prepare(
        `INSERT INTO preference_profiles (
           id, user_id, domain, default_context_id, model_version,
           created_at, updated_at
         ) VALUES (?, 'user_operator', 'projects', NULL, 'pref-v1-bt-lite', ?, ?)`
      )
      .run("profile_pre090", timestamp, timestamp);
    database
      .prepare(
        `INSERT INTO preference_contexts (
           id, profile_id, name, description, share_mode, active, is_default,
           decay_days, created_at, updated_at
         ) VALUES (?, 'profile_pre090', 'Legacy owner gap', '', 'blended', 1, 1, 90, ?, ?)`
      )
      .run("context_pre090", timestamp, timestamp);
    database
      .prepare(
        `DELETE FROM entity_owners
         WHERE entity_type = 'preference_context' AND entity_id = 'context_pre090'`
      )
      .run();

    const insertCatalog = database.prepare(
      `INSERT INTO preference_catalogs (
         id, profile_id, domain, slug, title, description, source, scope_in,
         scope_out, created_source, created_by_actor, archived, created_at,
         updated_at
       ) VALUES (?, 'profile_pre090', 'projects', ?, ?, '', 'custom', '', '',
                 'unknown', NULL, ?, ?, ?)`
    );
    insertCatalog.run(
      "catalog_active_pre090",
      "active-pre090",
      "Active legacy catalog",
      0,
      timestamp,
      timestamp
    );
    insertCatalog.run(
      "catalog_archived_pre090",
      "archived-pre090",
      "Archived legacy catalog",
      1,
      timestamp,
      timestamp
    );
    const insertItem = database.prepare(
      `INSERT INTO preference_catalog_items (
         id, catalog_id, label, description, tags_json, feature_weights_json,
         position, archived, created_at, updated_at
       ) VALUES (?, ?, ?, '', '[]', '{}', ?, 1, ?, ?)`
    );
    insertItem.run(
      "item_active_parent_pre090",
      "catalog_active_pre090",
      "Independently archived under active parent",
      0,
      timestamp,
      timestamp
    );
    for (const [id, label, position] of [
      ["item_ambiguous_a_pre090", "Ambiguous archived concept A", 0],
      ["item_ambiguous_b_pre090", "Ambiguous archived concept B", 1]
    ] as const) {
      insertItem.run(
        id,
        "catalog_archived_pre090",
        label,
        position,
        timestamp,
        timestamp
      );
    }
    database
      .prepare(
        `INSERT INTO deleted_entities (
           entity_type, entity_id, title, subtitle, deleted_at,
           deleted_by_actor, deleted_source, delete_reason, snapshot_json
         ) VALUES (
           'preference_catalog', 'catalog_archived_pre090',
           'Archived legacy catalog', '', ?, NULL, 'system',
           'Converted from the legacy archived preference catalog state.', '{}'
         )`
      )
      .run(timestamp);
    const insertArchiveMember = database.prepare(
      `INSERT INTO preference_catalog_archive_members (catalog_id, catalog_item_id)
       VALUES ('catalog_archived_pre090', ?)`
    );
    insertArchiveMember.run("item_ambiguous_a_pre090");
    insertArchiveMember.run("item_ambiguous_b_pre090");

    const before = database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM preference_catalogs) AS catalogs,
           (SELECT COUNT(*) FROM preference_catalog_items) AS items,
           (SELECT COUNT(*) FROM preference_contexts) AS contexts`
      )
      .get() as { catalogs: number; items: number; contexts: number };
    const migration = await readFile(
      path.join(migrationsDir, migrationName),
      "utf8"
    );
    database.exec(migration);
    database.exec(migration);

    const owner = database
      .prepare(
        `SELECT user_id
         FROM entity_owners
         WHERE entity_type = 'preference_context' AND entity_id = 'context_pre090'`
      )
      .get() as { user_id: string } | undefined;
    assert.equal(owner?.user_id, "user_operator");

    const deletedItems = database
      .prepare(
        `SELECT entity_id, delete_reason
         FROM deleted_entities
         WHERE entity_type = 'preference_catalog_item'
           AND entity_id IN (
             'item_active_parent_pre090',
             'item_ambiguous_a_pre090',
             'item_ambiguous_b_pre090'
           )
         ORDER BY entity_id ASC`
      )
      .all() as Array<{ entity_id: string; delete_reason: string }>;
    assert.deepEqual(
      deletedItems.map((row) => ({ ...row })),
      [
        {
          entity_id: "item_active_parent_pre090",
          delete_reason:
            "Converted from an independently archived legacy preference concept."
        },
        {
          entity_id: "item_ambiguous_a_pre090",
          delete_reason:
            "Preserved as independently archived because the legacy parent archive did not record concept-level provenance."
        },
        {
          entity_id: "item_ambiguous_b_pre090",
          delete_reason:
            "Preserved as independently archived because the legacy parent archive did not record concept-level provenance."
        }
      ]
    );
    const remainingArchiveMembers = database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM preference_catalog_archive_members
         WHERE catalog_id = 'catalog_archived_pre090'`
      )
      .get() as { count: number };
    assert.equal(
      remainingArchiveMembers.count,
      0,
      "ambiguous legacy concepts must not be revived by restoring their parent"
    );
    const after = database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM preference_catalogs) AS catalogs,
           (SELECT COUNT(*) FROM preference_catalog_items) AS items,
           (SELECT COUNT(*) FROM preference_contexts) AS contexts`
      )
      .get() as typeof before;
    assert.deepEqual({ ...after }, { ...before });
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM sqlite_master
             WHERE type = 'table' AND name = 'preference_judgment_receipts'`
          )
          .get() as { count: number }
      ).count,
      1
    );
  } finally {
    database.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
