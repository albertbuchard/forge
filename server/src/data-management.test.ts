import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import {
  closeDatabase,
  configureDatabase,
  getDatabase,
  getEffectiveDataRoot,
  initializeDatabase
} from "./db.js";
import {
  createDataBackup,
  exportData,
  listDataBackups,
  maybeRunAutomaticBackup,
  restoreDataBackup,
  scanForDataRecoveryCandidates,
  switchDataRoot,
  updateDataManagementSettings
} from "./services/data-management.js";

const originalDataRoot = getEffectiveDataRoot();

async function createRuntimeRoot(prefix: string) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  configureDatabase({ dataRoot, seedDemoData: false });
  closeDatabase();
  await initializeDatabase();
  return dataRoot;
}

function insertTag(id: string, name: string) {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO tags (id, name, kind, color, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, name, "manual", "#6aa6ff", `${name} tag`, now);
}

function insertGoal(id: string, title: string) {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO goals (
         id, title, description, horizon, status, target_points, theme_color, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, title, `${title} description`, "quarter", "active", 10, "#6aa6ff", now, now);
}

function listTagIds() {
  return (
    getDatabase()
      .prepare("SELECT id FROM tags ORDER BY id")
      .all() as Array<{ id: string }>
  ).map((row) => row.id);
}

async function writeRuntimeArtifacts(dataRoot: string, suffix: string) {
  await mkdir(path.join(dataRoot, "wiki"), { recursive: true });
  await writeFile(
    path.join(dataRoot, "wiki", "index.md"),
    `# Wiki ${suffix}\n`,
    "utf8"
  );
  await writeFile(
    path.join(dataRoot, ".forge-secrets.key"),
    `secret-${suffix}`,
    "utf8"
  );
}

test.afterEach(async () => {
  closeDatabase();
  configureDatabase({ dataRoot: originalDataRoot, seedDemoData: false });
  closeDatabase();
});

test("createDataBackup captures the database, schema, wiki files, and secrets key", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-backup-");

  try {
    const baselineTagCount = listTagIds().length;
    insertTag("tag_backup", "Backup");
    await writeRuntimeArtifacts(dataRoot, "backup");
    await updateDataManagementSettings({
      backupDirectory: path.join(dataRoot, "backups"),
      backupFrequencyHours: 24,
      autoRepairEnabled: true
    });

    const backup = await createDataBackup({ note: "Golden state" });
    const backups = await listDataBackups();
    const archive = new AdmZip(backup.archivePath);
    const archiveEntries = archive.getEntries().map((entry) => entry.entryName);

    assert.equal(backups.length, 1);
    assert.equal(backup.counts.tags, baselineTagCount + 1);
    assert.equal(backup.includesWiki, true);
    assert.equal(backup.includesSecretsKey, true);
    assert.ok(archiveEntries.includes("forge.sqlite"));
    assert.ok(archiveEntries.includes("schema.sql"));
    assert.ok(archiveEntries.includes("schema.json"));
    assert.ok(archiveEntries.includes("snapshot-summary.json"));
    assert.ok(archiveEntries.includes("wiki/index.md"));
    assert.ok(archiveEntries.includes(".forge-secrets.key"));
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("restoreDataBackup rolls the database and runtime files back to the selected backup", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-restore-");

  try {
    insertTag("tag_before_restore", "Before restore");
    const expectedTagIds = listTagIds();
    await writeRuntimeArtifacts(dataRoot, "before");
    await updateDataManagementSettings({
      backupDirectory: path.join(dataRoot, "backups"),
      autoRepairEnabled: true
    });

    const backup = await createDataBackup({ note: "Before change" });

    insertTag("tag_after_restore", "After restore");
    await writeRuntimeArtifacts(dataRoot, "after");

    await restoreDataBackup(backup.id, { createSafetyBackup: false });

    assert.deepEqual(listTagIds(), expectedTagIds);
    assert.equal(
      await readFile(path.join(dataRoot, "wiki", "index.md"), "utf8"),
      "# Wiki before\n"
    );
    assert.equal(
      await readFile(path.join(dataRoot, ".forge-secrets.key"), "utf8"),
      "secret-before"
    );
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("maybeRunAutomaticBackup respects the backup cadence", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-auto-backup-");

  try {
    insertTag("tag_auto_backup", "Auto backup");
    await updateDataManagementSettings({
      backupDirectory: path.join(dataRoot, "backups"),
      backupFrequencyHours: 1,
      autoRepairEnabled: true
    });

    const first = await maybeRunAutomaticBackup();
    const second = await maybeRunAutomaticBackup();

    assert.ok(first);
    assert.equal(second, null);

    getDatabase()
      .prepare(
        "UPDATE data_management_settings SET last_auto_backup_at = ? WHERE id = 1"
      )
      .run(new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString());

    const third = await maybeRunAutomaticBackup();
    assert.ok(third);
    assert.notEqual(first?.id, third?.id);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("exportData returns the expected snapshot and structure formats", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-export-");

  try {
    insertTag("tag_export", "Export");

    const sqlite = await exportData("sqlite");
    const schemaSql = await exportData("schema_sql");
    const schemaJson = await exportData("schema_json");
    const json = await exportData("json");
    const csvBundle = await exportData("csv_bundle");
    const csvArchive = new AdmZip(csvBundle.body);
    const csvEntries = csvArchive.getEntries().map((entry) => entry.entryName);

    assert.equal(sqlite.mimeType, "application/vnd.sqlite3");
    assert.ok(sqlite.body.byteLength > 0);
    assert.equal(schemaSql.mimeType, "application/sql");
    assert.match(schemaSql.body.toString("utf8"), /CREATE TABLE/i);
    assert.equal(schemaJson.mimeType, "application/json");
    assert.ok(
      JSON.parse(schemaJson.body.toString("utf8")).tables.some(
        (table: { table: string }) => table.table === "tags"
      )
    );
    assert.equal(json.mimeType, "application/json");
    assert.ok(
      JSON.parse(json.body.toString("utf8")).tables.tags.some(
        (row: { id: string }) => row.id === "tag_export"
      )
    );
    assert.equal(csvBundle.mimeType, "application/zip");
    assert.ok(csvEntries.includes("tags.csv"));
    assert.ok(csvEntries.includes("schema.json"));
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("scanForDataRecoveryCandidates finds populated newer copies and ignores empty ones", async () => {
  const currentRoot = await createRuntimeRoot("forge-data-scan-current-");
  const newerRoot = await createRuntimeRoot("forge-data-scan-newer-");
  const emptyRoot = await createRuntimeRoot("forge-data-scan-empty-");

  try {
    configureDatabase({ dataRoot: currentRoot, seedDemoData: false });
    closeDatabase();
    await initializeDatabase();
    insertGoal("goal_current_scan", "Current scan");

    configureDatabase({ dataRoot: newerRoot, seedDemoData: false });
    closeDatabase();
    await initializeDatabase();
    insertGoal("goal_newer_scan", "Newer scan");

    await utimes(
      path.join(currentRoot, "forge.sqlite"),
      new Date(Date.now() - 5 * 60 * 1000),
      new Date(Date.now() - 5 * 60 * 1000)
    );
    await utimes(
      path.join(newerRoot, "forge.sqlite"),
      new Date(Date.now() + 60 * 1000),
      new Date(Date.now() + 60 * 1000)
    );

    configureDatabase({ dataRoot: currentRoot, seedDemoData: false });
    closeDatabase();

    const candidates = await scanForDataRecoveryCandidates({
      roots: [currentRoot, newerRoot, emptyRoot],
      maxDepth: 2
    });

    assert.ok(
      candidates.some(
        (candidate) =>
          candidate.dataRoot === currentRoot && candidate.sameAsCurrent
      )
    );
    assert.ok(
      candidates.some(
        (candidate) =>
          candidate.dataRoot === newerRoot && candidate.newerThanCurrent
      )
    );
    assert.equal(
      candidates.some((candidate) => candidate.dataRoot === emptyRoot),
      false
    );
  } finally {
    await rm(currentRoot, { recursive: true, force: true });
    await rm(newerRoot, { recursive: true, force: true });
    await rm(emptyRoot, { recursive: true, force: true });
  }
});

test("switchDataRoot can both move the current data and adopt an existing data folder", async () => {
  const currentRoot = await createRuntimeRoot("forge-data-switch-current-");
  const movedRoot = await mkdtemp(path.join(os.tmpdir(), "forge-data-switch-moved-"));
  const adoptedRoot = await createRuntimeRoot("forge-data-switch-adopted-");
  const persistedRoots: string[] = [];
  const syncedRoots: string[] = [];

  try {
    configureDatabase({ dataRoot: currentRoot, seedDemoData: false });
    closeDatabase();
    await initializeDatabase();
    insertTag("tag_switch_current", "Current");
    const expectedMovedTagIds = listTagIds();
    await writeRuntimeArtifacts(currentRoot, "current");
    await updateDataManagementSettings({
      backupDirectory: path.join(currentRoot, "backups"),
      backupFrequencyHours: 24,
      autoRepairEnabled: true
    });

    const movedState = await switchDataRoot(
      {
        targetDataRoot: movedRoot,
        mode: "migrate_current",
        createSafetyBackup: false
      },
      {
        persistPreferredDataRoot: async (dataRoot) => {
          persistedRoots.push(dataRoot);
        },
        syncAdapterDataRoots: async (dataRoot) => {
          syncedRoots.push(dataRoot);
        }
      }
    );

    assert.equal(getEffectiveDataRoot(), movedRoot);
    assert.deepEqual(listTagIds(), expectedMovedTagIds);
    assert.equal(existsSync(path.join(movedRoot, "forge.sqlite")), true);
    assert.equal(existsSync(path.join(movedRoot, "wiki", "index.md")), true);
    assert.equal(
      movedState.settings.backupDirectory,
      path.join(movedRoot, "backups")
    );

    configureDatabase({ dataRoot: adoptedRoot, seedDemoData: false });
    closeDatabase();
    await initializeDatabase();
    insertTag("tag_switch_adopted", "Adopted");
    const expectedAdoptedTagIds = listTagIds();

    configureDatabase({ dataRoot: movedRoot, seedDemoData: false });
    closeDatabase();
    await initializeDatabase();

    await switchDataRoot(
      {
        targetDataRoot: adoptedRoot,
        mode: "adopt_existing",
        createSafetyBackup: false
      },
      {
        persistPreferredDataRoot: async (dataRoot) => {
          persistedRoots.push(dataRoot);
        },
        syncAdapterDataRoots: async (dataRoot) => {
          syncedRoots.push(dataRoot);
        }
      }
    );

    assert.equal(getEffectiveDataRoot(), adoptedRoot);
    assert.deepEqual(listTagIds(), expectedAdoptedTagIds);
    assert.deepEqual(persistedRoots, [movedRoot, adoptedRoot]);
    assert.deepEqual(syncedRoots, [movedRoot, adoptedRoot]);
  } finally {
    await rm(currentRoot, { recursive: true, force: true });
    await rm(movedRoot, { recursive: true, force: true });
    await rm(adoptedRoot, { recursive: true, force: true });
  }
});
