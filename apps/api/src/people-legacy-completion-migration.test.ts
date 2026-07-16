import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const repairMigration = "093_people_peer_legacy_completion.sql";
const nextMigration = "094_people_peer_authorization_and_companion_v2.sql";
const latePeopleTables = [
  "peer_pending_requests",
  "peer_idempotency_records",
  "peer_command_journal",
  "people_wiki_association_previews",
  "peer_question_interpretations"
] as const;

async function applyMigrationsBeforeRepair(database: DatabaseSync) {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file < repairMigration)
    .sort();
  for (const file of files) {
    database.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
}

test("the People legacy completion migration restores late 087 tables before 094", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-people-093-repair-"));
  const database = new DatabaseSync(path.join(rootDir, "forge.sqlite"));
  database.exec("PRAGMA foreign_keys = ON");
  try {
    await applyMigrationsBeforeRepair(database);
    for (const table of latePeopleTables) {
      database.exec(`DROP TABLE ${table}`);
    }

    const migration = await readFile(
      path.join(migrationsDir, repairMigration),
      "utf8"
    );
    database.exec(migration);
    database.exec(migration);

    const tables = database
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name IN (${latePeopleTables.map(() => "?").join(", ")})
         ORDER BY name ASC`
      )
      .all(...latePeopleTables) as Array<{ name: string }>;
    assert.deepEqual(
      tables.map((row) => row.name),
      [...latePeopleTables].sort()
    );

    database.exec(
      await readFile(path.join(migrationsDir, nextMigration), "utf8")
    );
    const commandColumns = database
      .prepare("PRAGMA table_info(peer_command_journal)")
      .all() as Array<{ name: string }>;
    assert.ok(
      commandColumns.some((column) => column.name === "authorization_state")
    );
  } finally {
    database.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
