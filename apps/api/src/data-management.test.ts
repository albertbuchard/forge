import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { existsSync, writeFileSync } from "node:fs";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import AdmZip from "adm-zip";
import { buildServer } from "./app.js";
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
  recoverInterruptedDataRestore,
  restoreDataBackup,
  scanForDataRecoveryCandidates,
  switchDataRoot,
  updateDataManagementSettings
} from "./services/data-management.js";
import type { ApplicationSecurityRuntime } from "./security/application-security-runtime.js";

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
    .run(
      id,
      title,
      `${title} description`,
      "quarter",
      "active",
      10,
      "#6aa6ff",
      now,
      now
    );
}

function listTagIds() {
  return (
    getDatabase().prepare("SELECT id FROM tags ORDER BY id").all() as Array<{
      id: string;
    }>
  ).map((row) => row.id);
}

async function writeRuntimeArtifacts(dataRoot: string, suffix: string) {
  await mkdir(path.join(dataRoot, "wiki-ingest"), { recursive: true });
  await writeFile(
    path.join(dataRoot, "wiki-ingest", "source.txt"),
    `Raw ingest ${suffix}\n`,
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

test("credential-bearing data routes require a recently authenticated operator", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-data-recent-owner-")
  );
  const captured: { security?: ApplicationSecurityRuntime } = {};
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    onSecurityRuntimeReady(runtime) {
      captured.security = runtime;
    }
  });
  try {
    const security = captured.security;
    assert.ok(security);
    const ownerEpoch = security.store.readOwnerSecurityEpoch("user_operator");
    assert.ok(ownerEpoch);
    const stale = security.browserSessions.create({
      kind: "operator_session",
      subjectId: "user_operator",
      ownerId: "user_operator",
      clientId: null,
      installationId: null,
      audience: security.audience,
      scopes: ["*"],
      profile: "operator",
      ownerSecurityEpoch: ownerEpoch,
      clientSecurityEpoch: null,
      authenticatedAt: new Date(Date.now() - 10 * 60_000).toISOString()
    });
    const headers = {
      cookie: `forge_session=${encodeURIComponent(stale.sessionToken)}`,
      "x-forge-csrf": stale.csrfToken
    };
    for (const request of [
      {
        method: "POST" as const,
        url: "/api/v1/settings/data/backups",
        payload: { note: "must not run" }
      },
      {
        method: "POST" as const,
        url: "/api/v1/settings/data/backups/nonexistent/restore",
        payload: { createSafetyBackup: false }
      },
      {
        method: "POST" as const,
        url: "/api/v1/settings/data/switch-root",
        payload: { targetDataRoot: path.join(dataRoot, "other") }
      },
      {
        method: "GET" as const,
        url: "/api/v1/settings/data/export?format=json"
      }
    ]) {
      const response = await app.inject({
        ...request,
        headers
      });
      assert.equal(response.statusCode, 403, response.body);
      assert.equal(
        response.json<{ code: string }>().code,
        "recent_owner_step_up_required"
      );
    }
    assert.deepEqual(await listDataBackups(), []);

    const pairedClientId = "client_data_admin_remote";
    security.store.registerClient({
      id: pairedClientId,
      ownerId: "user_operator",
      subjectId: "remote-operator",
      installationId: security.installationId,
      keyThumbprint: "a".repeat(64),
      audience: security.audience,
      profile: "operator",
      scopes: [
        "read",
        "write",
        "settings.data.export.read",
        "forge://route/api/v1/settings/data/export.read"
      ],
      clientSecurityEpoch: 1
    });
    const paired = security.browserSessions.create({
      kind: "paired_client",
      subjectId: "remote-operator",
      ownerId: "user_operator",
      clientId: pairedClientId,
      installationId: security.installationId,
      audience: security.audience,
      scopes: [
        "read",
        "write",
        "settings.data.export.read",
        "forge://route/api/v1/settings/data/export.read"
      ],
      profile: "operator",
      ownerSecurityEpoch: ownerEpoch,
      clientSecurityEpoch: 1,
      authenticatedAt: new Date().toISOString()
    });
    const pairedResponse = await app.inject({
      method: "GET",
      url: "/api/v1/settings/data/export?format=schema_json",
      headers: {
        cookie: `forge_session=${encodeURIComponent(paired.sessionToken)}`
      }
    });
    assert.equal(pairedResponse.statusCode, 403, pairedResponse.body);
    assert.equal(
      pairedResponse.json<{ code: string }>().code,
      "recent_owner_step_up_required"
    );

    const freshOwner = security.browserSessions.create({
      kind: "operator_session",
      subjectId: "user_operator",
      ownerId: "user_operator",
      clientId: null,
      installationId: null,
      audience: security.audience,
      scopes: ["*"],
      profile: "operator",
      ownerSecurityEpoch: ownerEpoch,
      clientSecurityEpoch: null,
      authenticatedAt: new Date().toISOString()
    });
    const freshResponse = await app.inject({
      method: "GET",
      url: "/api/v1/settings/data/export?format=schema_json",
      headers: {
        cookie: `forge_session=${encodeURIComponent(freshOwner.sessionToken)}`
      }
    });
    assert.equal(freshResponse.statusCode, 200, freshResponse.body);
    const exportOutcome = getDatabase()
      .prepare(
        `SELECT outcome, reason, request_id
           FROM security_audit_events
          WHERE reason = 'data_export_completed'
          ORDER BY sequence DESC
          LIMIT 1`
      )
      .get() as
      | { outcome: string; reason: string; request_id: string | null }
      | undefined;
    assert.deepEqual(
      {
        outcome: exportOutcome?.outcome,
        reason: exportOutcome?.reason,
        correlated: Boolean(exportOutcome?.request_id)
      },
      {
        outcome: "admitted",
        reason: "data_export_completed",
        correlated: true
      }
    );

    const freshFailureOwner = security.browserSessions.create({
      kind: "operator_session",
      subjectId: "user_operator",
      ownerId: "user_operator",
      clientId: null,
      installationId: null,
      audience: security.audience,
      scopes: ["*"],
      profile: "operator",
      ownerSecurityEpoch: ownerEpoch,
      clientSecurityEpoch: null,
      authenticatedAt: new Date().toISOString()
    });
    const failedRestore = await app.inject({
      method: "POST",
      url: "/api/v1/settings/data/backups/nonexistent/restore",
      headers: {
        cookie: `forge_session=${encodeURIComponent(
          freshFailureOwner.sessionToken
        )}`,
        "x-forge-csrf": freshFailureOwner.csrfToken
      },
      payload: { createSafetyBackup: false }
    });
    assert.equal(failedRestore.statusCode, 404, failedRestore.body);
    const restoreOutcome = getDatabase()
      .prepare(
        `SELECT outcome, reason, request_id
           FROM security_audit_events
          WHERE reason LIKE 'data_restore_failed_%'
          ORDER BY sequence DESC
          LIMIT 1`
      )
      .get() as
      | { outcome: string; reason: string; request_id: string | null }
      | undefined;
    assert.equal(restoreOutcome?.outcome, "denied");
    assert.equal(restoreOutcome?.reason, "data_restore_failed_backup_not_found");
    assert.ok(restoreOutcome?.request_id);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("createDataBackup captures the database, schema, ingest artifacts, and secrets key", async () => {
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
    const manifest = JSON.parse(
      await readFile(backup.manifestPath, "utf8")
    ) as {
      sensitivity: {
        classification: string;
        credentialMaterialIncluded: boolean;
        notice: string;
      };
    };
    const archiveMode = (await stat(backup.archivePath)).mode & 0o777;
    const manifestMode = (await stat(backup.manifestPath)).mode & 0o777;
    const backupDirectoryMode =
      (await stat(path.dirname(backup.archivePath))).mode & 0o777;

    assert.equal(backups.length, 1);
    assert.equal(backup.counts.tags, baselineTagCount + 1);
    assert.equal(backup.includesWiki, false);
    assert.equal(backup.includesSecretsKey, true);
    assert.ok(archiveEntries.includes("forge.sqlite"));
    assert.ok(archiveEntries.includes("schema.sql"));
    assert.ok(archiveEntries.includes("schema.json"));
    assert.ok(archiveEntries.includes("snapshot-summary.json"));
    assert.ok(archiveEntries.includes("wiki-ingest/source.txt"));
    assert.ok(archiveEntries.includes(".forge-secrets.key"));
    assert.ok(archiveEntries.includes("BACKUP-SENSITIVITY.txt"));
    assert.equal(archiveMode, 0o600);
    assert.equal(manifestMode, 0o600);
    assert.equal(backupDirectoryMode, 0o700);
    assert.equal(
      manifest.sensitivity.classification,
      "credential-bearing-backup"
    );
    assert.equal(manifest.sensitivity.credentialMaterialIncluded, true);
    assert.match(manifest.sensitivity.notice, /stored provider credentials/i);
    assert.match(
      archive
        .getEntries()
        .find((entry) => entry.entryName === "BACKUP-SENSITIVITY.txt")
        ?.getData()
        .toString("utf8") ?? "",
      /HIGHLY SENSITIVE/
    );
    assert.equal(
      (await readdir(path.dirname(backup.archivePath))).some((entry) =>
        entry.startsWith(".forge-backup-stage-")
      ),
      false
    );
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("createDataBackup removes staged and catalog artifacts after archive failure", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-backup-failure-");
  const backupDirectory = path.join(dataRoot, "backups");

  try {
    await updateDataManagementSettings({
      backupDirectory,
      autoRepairEnabled: true
    });
    await assert.rejects(
      createDataBackup(
        { note: "Must not publish" },
        {
          archiveWriter: (_archive, targetFileName) => {
            writeFileSync(targetFileName, "partial archive");
            throw new Error("simulated archive failure");
          }
        }
      ),
      /simulated archive failure/
    );

    assert.deepEqual(await readdir(backupDirectory), []);
    assert.deepEqual(await listDataBackups(), []);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("createDataBackup refuses symlinked destinations, secret keys, and ingest files", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-backup-symlink-");
  try {
    const redirectedBackupDirectory = path.join(dataRoot, "redirected-backups");
    await mkdir(redirectedBackupDirectory);
    const backupDirectoryLink = path.join(dataRoot, "backups-link");
    await symlink(redirectedBackupDirectory, backupDirectoryLink);
    await updateDataManagementSettings({
      backupDirectory: backupDirectoryLink,
      autoRepairEnabled: true
    });
    await assert.rejects(
      createDataBackup({ note: "must reject destination link" }),
      /symbolic-link or non-owner data directory/u
    );

    const backupDirectory = path.join(dataRoot, "backups");
    await updateDataManagementSettings({
      backupDirectory,
      autoRepairEnabled: true
    });
    const externalKey = path.join(dataRoot, "external-key");
    await writeFile(externalKey, "synthetic-external-key", "utf8");
    await symlink(externalKey, path.join(dataRoot, ".forge-secrets.key"));
    await assert.rejects(
      createDataBackup({ note: "must reject key link" }),
      /symbolic-link or non-owner source file/u
    );
    await rm(path.join(dataRoot, ".forge-secrets.key"));

    await mkdir(path.join(dataRoot, "wiki-ingest"), { recursive: true });
    const externalIngest = path.join(dataRoot, "external-ingest");
    await writeFile(externalIngest, "synthetic-ingest", "utf8");
    await symlink(
      externalIngest,
      path.join(dataRoot, "wiki-ingest", "linked-source")
    );
    await assert.rejects(
      createDataBackup({ note: "must reject ingest link" }),
      /refuses to follow symbolic links/u
    );
    assert.deepEqual(await listDataBackups(), []);
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
      await readFile(path.join(dataRoot, "wiki-ingest", "source.txt"), "utf8"),
      "Raw ingest before\n"
    );
    assert.equal(
      await readFile(path.join(dataRoot, ".forge-secrets.key"), "utf8"),
      "secret-before"
    );
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("restoreDataBackup rejects manifest path substitution, traversal entries, and symlinked archives", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-restore-unsafe-");
  try {
    await writeRuntimeArtifacts(dataRoot, "safe");
    await updateDataManagementSettings({
      backupDirectory: path.join(dataRoot, "backups"),
      autoRepairEnabled: true
    });

    const substituted = await createDataBackup({ note: "Path substitution" });
    const substitutedManifest = JSON.parse(
      await readFile(substituted.manifestPath, "utf8")
    );
    substitutedManifest.archivePath = path.join(
      dataRoot,
      "outside-owner-backup.zip"
    );
    await writeFile(
      substituted.manifestPath,
      `${JSON.stringify(substitutedManifest, null, 2)}\n`,
      "utf8"
    );
    await assert.rejects(
      restoreDataBackup(substituted.id, { createSafetyBackup: false }),
      /does not match its owner-controlled archive path/u
    );

    const traversal = await createDataBackup({ note: "Traversal" });
    const traversalArchive = new AdmZip(traversal.archivePath);
    traversalArchive.addFile(
      "aa/escape",
      Buffer.from("escape", "utf8")
    );
    traversalArchive.writeZip(traversal.archivePath);
    const traversalBytes = await readFile(traversal.archivePath);
    const safeName = Buffer.from("aa/escape", "utf8");
    const unsafeName = Buffer.from("../escape", "utf8");
    let replacementOffset = 0;
    let replacementCount = 0;
    while (
      (replacementOffset = traversalBytes.indexOf(
        safeName,
        replacementOffset
      )) !== -1
    ) {
      unsafeName.copy(traversalBytes, replacementOffset);
      replacementOffset += unsafeName.length;
      replacementCount += 1;
    }
    assert.equal(replacementCount, 2);
    await writeFile(traversal.archivePath, traversalBytes);
    await chmod(traversal.archivePath, 0o600);
    await assert.rejects(
      restoreDataBackup(traversal.id, { createSafetyBackup: false }),
      /traversal path/u
    );
    assert.equal(
      existsSync(path.join(path.dirname(dataRoot), "escape")),
      false
    );

    const linked = await createDataBackup({ note: "Symlink" });
    const realArchivePath = `${linked.archivePath}.real`;
    await rename(linked.archivePath, realArchivePath);
    await symlink(realArchivePath, linked.archivePath);
    await assert.rejects(
      restoreDataBackup(linked.id, { createSafetyBackup: false }),
      /not an owner-only regular path/u
    );
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("restoreDataBackup restores the prior runtime after an installation verification failure", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-restore-rollback-");
  try {
    insertTag("tag_before_failed_restore", "Before failed restore");
    await writeRuntimeArtifacts(dataRoot, "before");
    await updateDataManagementSettings({
      backupDirectory: path.join(dataRoot, "backups"),
      autoRepairEnabled: true
    });
    const backup = await createDataBackup({ note: "Rollback fixture" });

    insertTag("tag_after_failed_restore", "After failed restore");
    await writeRuntimeArtifacts(dataRoot, "after");
    await assert.rejects(
      restoreDataBackup(
        backup.id,
        { createSafetyBackup: false },
        {
          verifyInstalledRuntime() {
            throw new Error("simulated installed-runtime verification failure");
          }
        }
      ),
      /simulated installed-runtime verification failure/u
    );

    assert.ok(listTagIds().includes("tag_after_failed_restore"));
    assert.equal(
      await readFile(path.join(dataRoot, "wiki-ingest", "source.txt"), "utf8"),
      "Raw ingest after\n"
    );
    assert.equal(
      await readFile(path.join(dataRoot, ".forge-secrets.key"), "utf8"),
      "secret-after"
    );
    assert.equal(
      (await readdir(dataRoot)).some((entry) =>
        entry.startsWith(".forge-restore-stage-")
      ),
      false
    );
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("restore recovery rolls back every interrupted material install phase", async () => {
  for (const target of [
    "forge.sqlite",
    "forge.sqlite-wal",
    "forge.sqlite-shm",
    "wiki-ingest",
    ".forge-secrets.key"
  ] as const) {
    const dataRoot = await createRuntimeRoot(
      `forge-data-restore-interrupt-${target.replaceAll(".", "-")}-`
    );
    try {
      insertTag(`tag_before_${target}`, "Before interruption");
      await writeRuntimeArtifacts(dataRoot, "before");
      await updateDataManagementSettings({
        backupDirectory: path.join(dataRoot, "backups"),
        autoRepairEnabled: true
      });
      const backup = await createDataBackup({ note: `Interrupt ${target}` });

      insertTag(`tag_after_${target}`, "After interruption");
      await writeRuntimeArtifacts(dataRoot, "after");
      await assert.rejects(
        restoreDataBackup(
          backup.id,
          { createSafetyBackup: false },
          { simulateInterruptionAfterTarget: target }
        ),
        new RegExp(`simulated restore interruption after ${target}`)
      );
      const journalPath = path.join(dataRoot, ".forge-restore-journal.json");
      assert.equal(existsSync(journalPath), true);
      assert.equal((await stat(journalPath)).mode & 0o777, 0o600);

      const recovery = await recoverInterruptedDataRestore();
      assert.deepEqual(recovery, {
        recovered: true,
        action: "rolled_back"
      });
      assert.ok(listTagIds().includes(`tag_after_${target}`));
      assert.equal(
        await readFile(
          path.join(dataRoot, "wiki-ingest", "source.txt"),
          "utf8"
        ),
        "Raw ingest after\n"
      );
      assert.equal(
        await readFile(path.join(dataRoot, ".forge-secrets.key"), "utf8"),
        "secret-after"
      );
      assert.equal(existsSync(journalPath), false);
      assert.equal(
        (await readdir(dataRoot)).some((entry) =>
          entry.startsWith(".forge-restore-stage-")
        ),
        false
      );
    } finally {
      closeDatabase();
      await rm(dataRoot, { recursive: true, force: true });
    }
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

test("maybeRunAutomaticBackup prunes expired automatic backups without deleting manual backups", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-auto-retention-");

  try {
    insertTag("tag_auto_retention", "Auto retention");
    await updateDataManagementSettings({
      backupDirectory: path.join(dataRoot, "backups"),
      backupFrequencyHours: 1,
      backupRetentionDays: 1,
      autoRepairEnabled: true
    });

    const automatic = await createDataBackup(
      { note: "Old automatic" },
      { mode: "automatic" }
    );
    const manual = await createDataBackup({ note: "Manual should stay" });
    const oldCreatedAt = new Date(
      Date.now() - 3 * 24 * 60 * 60 * 1000
    ).toISOString();

    for (const backup of [automatic, manual]) {
      const manifest = JSON.parse(await readFile(backup.manifestPath, "utf8"));
      manifest.createdAt = oldCreatedAt;
      await writeFile(
        backup.manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8"
      );
    }
    getDatabase()
      .prepare(
        "UPDATE data_management_settings SET last_auto_backup_at = ? WHERE id = 1"
      )
      .run(new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString());

    const next = await maybeRunAutomaticBackup();

    assert.ok(next);
    assert.equal(existsSync(automatic.archivePath), false);
    assert.equal(existsSync(automatic.manifestPath), false);
    assert.equal(existsSync(manual.archivePath), true);
    assert.equal(existsSync(manual.manifestPath), true);
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
  const movedRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-data-switch-moved-")
  );
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
    assert.equal(
      existsSync(path.join(movedRoot, "wiki-ingest", "source.txt")),
      true
    );
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

test("switchDataRoot rejects symbolic-link targets before copying runtime data", async () => {
  const currentRoot = await createRuntimeRoot("forge-switch-symlink-current-");
  const targetParent = await mkdtemp(
    path.join(os.tmpdir(), "forge-switch-symlink-parent-")
  );
  const realTarget = path.join(targetParent, "real");
  const linkedTarget = path.join(targetParent, "linked");
  try {
    await mkdir(realTarget, { mode: 0o700 });
    await symlink(realTarget, linkedTarget);
    await assert.rejects(
      switchDataRoot({
        targetDataRoot: linkedTarget,
        mode: "migrate_current",
        createSafetyBackup: false
      }),
      /owner-only real directory|unsafe directory/
    );
    assert.equal(getEffectiveDataRoot(), currentRoot);
    assert.deepEqual(await readdir(realTarget), []);
  } finally {
    closeDatabase();
    configureDatabase({ dataRoot: originalDataRoot });
    await rm(currentRoot, { recursive: true, force: true });
    await rm(targetParent, { recursive: true, force: true });
  }
});

for (const failurePoint of ["persist", "sync"] as const) {
  test(`switchDataRoot rolls back runtime, configuration, and copied data after ${failurePoint} failure`, async () => {
    const currentRoot = await createRuntimeRoot(
      `forge-switch-${failurePoint}-current-`
    );
    const targetParent = await mkdtemp(
      path.join(os.tmpdir(), `forge-switch-${failurePoint}-parent-`)
    );
    const targetRoot = path.join(targetParent, "target");
    const persistedRoots: string[] = [];
    const syncedRoots: string[] = [];
    try {
      insertTag(`tag_${failurePoint}`, `Tag ${failurePoint}`);
      const expectedTagIds = listTagIds();
      await assert.rejects(
        switchDataRoot(
          {
            targetDataRoot: targetRoot,
            mode: "migrate_current",
            createSafetyBackup: false
          },
          {
            persistPreferredDataRoot: async (dataRoot) => {
              persistedRoots.push(dataRoot);
              if (failurePoint === "persist" && dataRoot === targetRoot) {
                throw new Error("synthetic persist failure");
              }
            },
            syncAdapterDataRoots: async (dataRoot) => {
              syncedRoots.push(dataRoot);
              if (failurePoint === "sync" && dataRoot === targetRoot) {
                throw new Error("synthetic sync failure");
              }
            }
          }
        ),
        new RegExp(`synthetic ${failurePoint} failure`)
      );
      assert.equal(getEffectiveDataRoot(), currentRoot);
      assert.deepEqual(listTagIds(), expectedTagIds);
      assert.equal(existsSync(targetRoot), false);
      assert.equal(
        existsSync(path.join(currentRoot, ".forge-switch-root-journal.json")),
        false
      );
      assert.equal(persistedRoots.at(-1), currentRoot);
      assert.equal(syncedRoots.at(-1), currentRoot);
    } finally {
      closeDatabase();
      configureDatabase({ dataRoot: originalDataRoot });
      await rm(currentRoot, { recursive: true, force: true });
      await rm(targetParent, { recursive: true, force: true });
    }
  });
}

test("startup recovery rolls back an interrupted activated data-root switch", async () => {
  const currentRoot = await createRuntimeRoot(
    "forge-switch-recovery-current-"
  );
  const targetParent = await mkdtemp(
    path.join(os.tmpdir(), "forge-switch-recovery-parent-")
  );
  const targetRoot = path.join(targetParent, "target");
  const persistedRoots: string[] = [];
  const syncedRoots: string[] = [];
  try {
    insertTag("tag_switch_recovery", "Recovery");
    await assert.rejects(
      switchDataRoot(
        {
          targetDataRoot: targetRoot,
          mode: "migrate_current",
          createSafetyBackup: false
        },
        {
          simulateInterruptionAfterPhase: "activated",
          persistPreferredDataRoot: async (dataRoot) => {
            persistedRoots.push(dataRoot);
          },
          syncAdapterDataRoots: async (dataRoot) => {
            syncedRoots.push(dataRoot);
          }
        }
      ),
      /simulated data-root switch interruption/
    );
    assert.equal(getEffectiveDataRoot(), targetRoot);
    assert.equal(
      existsSync(path.join(targetRoot, ".forge-switch-root-journal.json")),
      true
    );
    const recovered = await recoverInterruptedDataRestore({
      persistPreferredDataRoot: async (dataRoot) => {
        persistedRoots.push(dataRoot);
      },
      syncAdapterDataRoots: async (dataRoot) => {
        syncedRoots.push(dataRoot);
      }
    });
    assert.deepEqual(recovered, {
      recovered: true,
      action: "switch_root_rolled_back"
    });
    assert.equal(getEffectiveDataRoot(), currentRoot);
    assert.equal(existsSync(targetRoot), false);
    assert.equal(persistedRoots.at(-1), currentRoot);
    assert.equal(syncedRoots.at(-1), currentRoot);
  } finally {
    closeDatabase();
    configureDatabase({ dataRoot: originalDataRoot });
    await rm(currentRoot, { recursive: true, force: true });
    await rm(targetParent, { recursive: true, force: true });
  }
});
