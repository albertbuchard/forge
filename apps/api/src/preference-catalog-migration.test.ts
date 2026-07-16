import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { closeDatabase, configureDatabase } from "./db.js";
import {
  updatePreferenceCatalog,
  updatePreferenceCatalogItem
} from "./repositories/preferences.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migrationName = "086_preference_catalog_contract.sql";

async function applyMigrationsBefore086(database: DatabaseSync) {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file < migrationName)
    .sort();
  for (const file of files) {
    database.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
}

test("migration 086 upgrades existing preference catalogs without losing rows", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-catalog-migration-")
  );
  const databasePath = path.join(rootDir, "forge.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  try {
    await applyMigrationsBefore086(database);
    const timestamp = "2026-07-15T08:00:00.000Z";
    database
      .prepare(
        `INSERT INTO preference_profiles (
           id, user_id, domain, default_context_id, model_version, created_at, updated_at
         ) VALUES (?, ?, ?, NULL, ?, ?, ?)`
      )
      .run(
        "profile_pre086",
        "user_operator",
        "projects",
        "pref-v1-bt-lite",
        timestamp,
        timestamp
      );
    database
      .prepare(
        `INSERT INTO preference_catalogs (
           id, profile_id, domain, slug, title, description, source, archived,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        "catalog_pre086",
        "profile_pre086",
        "projects",
        "existing-catalog",
        "Existing catalog",
        "Must survive the upgrade.",
        "custom",
        timestamp,
        timestamp
      );
    database
      .prepare(
        `INSERT INTO preference_catalog_items (
           id, catalog_id, label, description, tags_json, feature_weights_json,
           position, archived, created_at, updated_at
         ) VALUES (?, ?, ?, ?, '[]', '{}', 0, 0, ?, ?)`
      )
      .run(
        "catalog_item_pre086",
        "catalog_pre086",
        "Existing concept",
        "Must survive the upgrade.",
        timestamp,
        timestamp
      );
    database
      .prepare(
        `INSERT INTO preference_catalogs (
           id, profile_id, domain, slug, title, description, source, archived,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        "catalog_pre086_duplicate",
        "profile_pre086",
        "projects",
        "existing-catalog-duplicate",
        "  existing CATALOG  ",
        "Historical duplicate that must not block the upgrade.",
        "custom",
        timestamp,
        timestamp
      );
    database
      .prepare(
        `INSERT INTO preference_catalog_items (
           id, catalog_id, label, description, tags_json, feature_weights_json,
           position, archived, created_at, updated_at
         ) VALUES (?, ?, ?, ?, '[]', '{}', 1, 0, ?, ?)`
      )
      .run(
        "catalog_item_pre086_duplicate",
        "catalog_pre086",
        "  existing CONCEPT  ",
        "Historical duplicate that must not block the upgrade.",
        timestamp,
        timestamp
      );
    database
      .prepare(
        `INSERT INTO preference_catalogs (
           id, profile_id, domain, slug, title, description, source, archived,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        "catalog_pre086_archived",
        "profile_pre086",
        "projects",
        "legacy-archived-catalog",
        "Legacy archived catalog",
        "Must remain recoverable after the upgrade.",
        "custom",
        timestamp,
        timestamp
      );
    for (const [id, label, position] of [
      ["catalog_item_pre086_archived_a", "Legacy choice A", 0],
      ["catalog_item_pre086_archived_b", "Legacy choice B", 1]
    ] as const) {
      database
        .prepare(
          `INSERT INTO preference_catalog_items (
             id, catalog_id, label, description, tags_json,
             feature_weights_json, position, archived, created_at, updated_at
           ) VALUES (?, 'catalog_pre086_archived', ?, '', '[]', '{}', ?, 1, ?, ?)`
        )
        .run(id, label, position, timestamp, timestamp);
    }

    database.exec(
      await readFile(path.join(migrationsDir, migrationName), "utf8")
    );

    const catalog = database
      .prepare(
        `SELECT title, description, scope_in, scope_out, created_source,
                created_by_actor
         FROM preference_catalogs
         WHERE id = ?`
      )
      .get("catalog_pre086") as Record<string, unknown> | undefined;
    assert.ok(catalog);
    assert.equal(catalog.title, "Existing catalog");
    assert.equal(catalog.description, "Must survive the upgrade.");
    assert.equal(catalog.scope_in, "");
    assert.equal(catalog.scope_out, "");
    assert.equal(catalog.created_source, "unknown");
    assert.equal(catalog.created_by_actor, null);

    const item = database
      .prepare("SELECT label FROM preference_catalog_items WHERE id = ?")
      .get("catalog_item_pre086") as { label: string } | undefined;
    assert.equal(item?.label, "Existing concept");

    const preservedDuplicates = database
      .prepare(
        `SELECT
           (SELECT COUNT(*)
              FROM preference_catalogs
              WHERE profile_id = 'profile_pre086'
                AND archived = 0
                AND lower(trim(title)) = 'existing catalog') AS catalog_count,
           (SELECT COUNT(*)
              FROM preference_catalog_items
              WHERE catalog_id = 'catalog_pre086'
                AND archived = 0
                AND lower(trim(label)) = 'existing concept') AS item_count`
      )
      .get() as { catalog_count: number; item_count: number };
    assert.deepEqual(
      { ...preservedDuplicates },
      {
        catalog_count: 2,
        item_count: 2
      }
    );

    configureDatabase({ dataRoot: rootDir });
    const updatedLegacyCatalog = updatePreferenceCatalog(
      "catalog_pre086_duplicate",
      {
        title: "EXISTING CATALOG",
        description: "Historical duplicate remains editable after migration."
      }
    );
    assert.equal(
      updatedLegacyCatalog.description,
      "Historical duplicate remains editable after migration."
    );
    const updatedLegacyItem = updatePreferenceCatalogItem(
      "catalog_item_pre086_duplicate",
      {
        label: "EXISTING CONCEPT",
        description: "Historical duplicate concept remains editable."
      }
    );
    assert.equal(
      updatedLegacyItem.description,
      "Historical duplicate concept remains editable."
    );
    const preservedDuplicateText = database
      .prepare(
        `SELECT
           (SELECT title FROM preference_catalogs WHERE id = ?) AS title,
           (SELECT description FROM preference_catalogs WHERE id = ?) AS description,
           (SELECT label FROM preference_catalog_items WHERE id = ?) AS label,
           (SELECT description FROM preference_catalog_items WHERE id = ?) AS item_description`
      )
      .get(
        "catalog_pre086_duplicate",
        "catalog_pre086_duplicate",
        "catalog_item_pre086_duplicate",
        "catalog_item_pre086_duplicate"
      ) as {
      title: string;
      description: string;
      label: string;
      item_description: string;
    };
    assert.deepEqual(
      { ...preservedDuplicateText },
      {
        title: "  existing CATALOG  ",
        description: "Historical duplicate remains editable after migration.",
        label: "  existing CONCEPT  ",
        item_description: "Historical duplicate concept remains editable."
      }
    );

    database
      .prepare(
        `UPDATE preference_catalogs
         SET title = ?, description = ?
         WHERE id = ?`
      )
      .run(
        " existing catalog ",
        "Equivalent normalized title updates must not trip the migration trigger.",
        "catalog_pre086_duplicate"
      );
    database
      .prepare(
        `UPDATE preference_catalog_items
         SET label = ?, description = ?
         WHERE id = ?`
      )
      .run(
        " existing concept ",
        "Equivalent normalized label updates must not trip the migration trigger.",
        "catalog_item_pre086_duplicate"
      );

    const owners = database
      .prepare(
        `SELECT entity_type, entity_id, user_id
         FROM entity_owners
         WHERE (entity_type = 'preference_catalog' AND entity_id = ?)
            OR (entity_type = 'preference_catalog_item' AND entity_id = ?)
         ORDER BY entity_type ASC`
      )
      .all("catalog_pre086", "catalog_item_pre086") as Array<{
      entity_type: string;
      entity_id: string;
      user_id: string;
    }>;
    assert.deepEqual(
      owners.map((owner) => ({ ...owner })),
      [
        {
          entity_type: "preference_catalog",
          entity_id: "catalog_pre086",
          user_id: "user_operator"
        },
        {
          entity_type: "preference_catalog_item",
          entity_id: "catalog_item_pre086",
          user_id: "user_operator"
        }
      ]
    );

    const receiptsTable = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'preference_catalog_create_receipts'`
      )
      .get();
    const archiveMembersTable = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'preference_catalog_archive_members'`
      )
      .get();
    assert.ok(receiptsTable);
    assert.ok(archiveMembersTable);

    const legacyArchiveMembers = database
      .prepare(
        `SELECT catalog_item_id
         FROM preference_catalog_archive_members
         WHERE catalog_id = ?
         ORDER BY catalog_item_id ASC`
      )
      .all("catalog_pre086_archived") as Array<{ catalog_item_id: string }>;
    assert.deepEqual(
      legacyArchiveMembers.map((row) => row.catalog_item_id),
      ["catalog_item_pre086_archived_a", "catalog_item_pre086_archived_b"]
    );

    const legacyDeletedRecord = database
      .prepare(
        `SELECT title, subtitle, deleted_at, deleted_source, delete_reason,
                snapshot_json
         FROM deleted_entities
         WHERE entity_type = 'preference_catalog' AND entity_id = ?`
      )
      .get("catalog_pre086_archived") as
      | {
          title: string;
          subtitle: string;
          deleted_at: string;
          deleted_source: string;
          delete_reason: string;
          snapshot_json: string;
        }
      | undefined;
    assert.ok(legacyDeletedRecord);
    assert.equal(legacyDeletedRecord.title, "Legacy archived catalog");
    assert.equal(
      legacyDeletedRecord.subtitle,
      "Must remain recoverable after the upgrade."
    );
    assert.equal(legacyDeletedRecord.deleted_at, timestamp);
    assert.equal(legacyDeletedRecord.deleted_source, "system");
    assert.match(legacyDeletedRecord.delete_reason, /legacy archived/i);
    assert.deepEqual(JSON.parse(legacyDeletedRecord.snapshot_json), {
      id: "catalog_pre086_archived",
      profileId: "profile_pre086",
      userId: "user_operator",
      domain: "projects",
      slug: "legacy-archived-catalog",
      title: "Legacy archived catalog",
      description: "Must remain recoverable after the upgrade.",
      scopeIn: "",
      scopeOut: "",
      source: "custom",
      createdSource: "unknown",
      createdByActor: null,
      archived: true,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO preference_catalogs (
               id, profile_id, domain, slug, title, description, source,
               archived, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, '', 'custom', 0, ?, ?)`
          )
          .run(
            "catalog_post086_duplicate",
            "profile_pre086",
            "projects",
            "post-upgrade-duplicate",
            "EXISTING catalog",
            timestamp,
            timestamp
          ),
      /active preference catalog title must be unique per profile/
    );

    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO preference_catalog_items (
               id, catalog_id, label, description, tags_json,
               feature_weights_json, position, archived, created_at, updated_at
             ) VALUES (?, ?, ?, '', '[]', '{}', 2, 0, ?, ?)`
          )
          .run(
            "catalog_item_post086_duplicate",
            "catalog_pre086",
            "EXISTING concept",
            timestamp,
            timestamp
          ),
      /active preference catalog item label must be unique per catalog/
    );

    database
      .prepare(
        `INSERT INTO preference_catalog_items (
           id, catalog_id, label, description, tags_json, feature_weights_json,
           position, archived, created_at, updated_at
         ) VALUES (?, ?, ?, '', '[]', '{}', 2, 0, ?, ?)`
      )
      .run(
        "catalog_item_post086_distinct",
        "catalog_pre086",
        "Distinct post-upgrade concept",
        timestamp,
        timestamp
      );
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE preference_catalog_items
             SET label = ?
             WHERE id = ?`
          )
          .run(" existing concept ", "catalog_item_post086_distinct"),
      /active preference catalog item label must be unique per catalog/
    );
    assert.equal(
      (
        database
          .prepare(`SELECT label FROM preference_catalog_items WHERE id = ?`)
          .get("catalog_item_post086_distinct") as { label: string }
      ).label,
      "Distinct post-upgrade concept"
    );
  } finally {
    closeDatabase();
    database.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
