import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  backupArchiveLimitsForTest,
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

async function removeRecordedArchiveChecksum(manifestPath: string) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
    string,
    unknown
  >;
  delete manifest.archiveSha256;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await chmod(manifestPath, 0o600);
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

function mutateCentralDirectoryEntry(
  archiveBytes: Buffer,
  entryName: string,
  mutate: (bytes: Buffer, centralDirectoryOffset: number) => void
) {
  const mutated = Buffer.from(archiveBytes);
  let offset = 0;
  let matches = 0;
  while (offset + 46 <= mutated.length) {
    if (mutated.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const fileNameLength = mutated.readUInt16LE(offset + 28);
    const extraLength = mutated.readUInt16LE(offset + 30);
    const commentLength = mutated.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > mutated.length) {
      break;
    }
    if (mutated.subarray(nameStart, nameEnd).toString("utf8") === entryName) {
      mutate(mutated, offset);
      matches += 1;
    }
    offset = nameEnd + extraLength + commentLength;
  }
  assert.equal(matches, 1);
  return mutated;
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
    assert.equal(
      restoreOutcome?.reason,
      "data_restore_failed_backup_not_found"
    );
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
      archiveSha256: string;
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
    assert.match(backup.archiveSha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.equal(manifest.archiveSha256, backup.archiveSha256);
    assert.equal(
      backup.archiveSha256,
      createHash("sha256")
        .update(await readFile(backup.archivePath))
        .digest("hex")
    );
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

test("backup archive policy admits one live-size database entry without removing the total ceiling", () => {
  const limits = backupArchiveLimitsForTest();
  assert.ok(limits.maximumEntryBytes > 3_260_907_520);
  assert.equal(limits.maximumEntryBytes, limits.maximumTotalBytes);
  assert.equal(limits.maximumTotalBytes, 20 * 1024 * 1024 * 1024);
});

test("streaming backups emit ZIP64-compatible archives that an independent reader validates", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-backup-zip64-");
  try {
    await updateDataManagementSettings({
      backupDirectory: path.join(dataRoot, "backups"),
      autoRepairEnabled: true
    });
    const backup = await createDataBackup(
      { note: "Forced ZIP64 fixture" },
      { forceZip64FormatForTest: true }
    );
    const archiveBytes = await readFile(backup.archivePath);
    assert.notEqual(
      archiveBytes.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06])),
      -1
    );
    const independentArchive = new AdmZip(archiveBytes);
    const databaseEntry = independentArchive
      .getEntries()
      .find((entry) => entry.entryName === "forge.sqlite");
    assert.ok(databaseEntry);
    assert.ok(databaseEntry.getData().byteLength > 0);
    assert.ok(
      independentArchive
        .getEntries()
        .some((entry) => entry.entryName === "schema.sql")
    );
    assert.ok(
      independentArchive
        .getEntries()
        .some((entry) => entry.entryName === "snapshot-summary.json")
    );
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("streaming restore remains compatible with the prior AdmZip backup layout", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-backup-legacy-");
  try {
    insertTag("tag_legacy_backup", "Legacy backup");
    await updateDataManagementSettings({
      backupDirectory: path.join(dataRoot, "backups"),
      autoRepairEnabled: true
    });
    const backup = await createDataBackup(
      { note: "Legacy AdmZip fixture" },
      {
        archiveWriter: (archive, targetPath) => archive.writeZip(targetPath)
      }
    );
    insertTag("tag_after_legacy_backup", "After legacy backup");
    await restoreDataBackup(backup.id, { createSafetyBackup: false });
    assert.ok(listTagIds().includes("tag_legacy_backup"));
    assert.equal(listTagIds().includes("tag_after_legacy_backup"), false);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("backup manifest facts come from the immutable SQLite snapshot", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-backup-provenance-");
  try {
    insertTag("tag_snapshot_before", "Snapshot before");
    await updateDataManagementSettings({
      backupDirectory: path.join(dataRoot, "backups"),
      autoRepairEnabled: true
    });
    const expectedTagCount = listTagIds().length;
    const backup = await createDataBackup(
      { note: "Snapshot provenance" },
      {
        archiveWriter: (archive, targetPath) => {
          insertTag("tag_snapshot_after", "Snapshot after");
          archive.writeZip(targetPath);
        }
      }
    );
    assert.equal(backup.counts.tags, expectedTagCount);
    assert.equal(listTagIds().length, expectedTagCount + 1);
    const archive = new AdmZip(backup.archivePath);
    const summaryEntry = archive
      .getEntries()
      .find((entry) => entry.entryName === "snapshot-summary.json");
    assert.ok(summaryEntry);
    const summary = JSON.parse(summaryEntry.getData().toString("utf8")) as {
      current: { counts: { tags: number } };
    };
    assert.equal(summary.current.counts.tags, expectedTagCount);
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

test("createDataBackup removes its credential-bearing SQLite snapshot after validation failure", async () => {
  const dataRoot = await createRuntimeRoot(
    "forge-data-backup-snapshot-failure-"
  );
  const backupDirectory = path.join(dataRoot, "backups");
  let snapshotPath = "";
  try {
    await updateDataManagementSettings({
      backupDirectory,
      autoRepairEnabled: true
    });
    await assert.rejects(
      createDataBackup(
        { note: "Reject invalid snapshot" },
        {
          beforeSnapshotValidationForTest(input) {
            snapshotPath = input.snapshotPath;
            throw new Error("simulated snapshot validation failure");
          }
        }
      ),
      /simulated snapshot validation failure/u
    );
    assert.ok(snapshotPath);
    assert.equal(existsSync(snapshotPath), false);
    assert.equal(existsSync(path.dirname(snapshotPath)), false);
    assert.deepEqual(await readdir(backupDirectory), []);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("streaming backup removes staged output after a raced source or destination failure", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-backup-stream-failure-");
  const backupDirectory = path.join(dataRoot, "backups");
  try {
    await writeRuntimeArtifacts(dataRoot, "stream-failure");
    await updateDataManagementSettings({
      backupDirectory,
      autoRepairEnabled: true
    });
    const ingestSource = path.join(dataRoot, "wiki-ingest", "source.txt");
    const displacedSource = path.join(
      dataRoot,
      "wiki-ingest",
      "source.original"
    );
    await assert.rejects(
      createDataBackup(
        { note: "Reject raced source" },
        {
          async beforeStreamingArchiveForTest() {
            await rename(ingestSource, displacedSource);
            await symlink(displacedSource, ingestSource);
          }
        }
      ),
      /symbolic link|ELOOP|changed after Forge verified/u
    );
    await rm(ingestSource);
    await rename(displacedSource, ingestSource);
    assert.deepEqual(await readdir(backupDirectory), []);

    await assert.rejects(
      createDataBackup(
        { note: "Reject destination collision" },
        {
          async beforeStreamingArchiveForTest({ stagedArchivePath }) {
            await mkdir(stagedArchivePath);
          }
        }
      ),
      /EEXIST/u
    );
    assert.deepEqual(await readdir(backupDirectory), []);
    assert.deepEqual(await listDataBackups(), []);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("streaming backup rejects raced wiki roots and parent directories outside the verified source tree", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-backup-tree-race-");
  const backupDirectory = path.join(dataRoot, "backups");
  const wikiRoot = path.join(dataRoot, "wiki-ingest");
  try {
    await mkdir(path.join(wikiRoot, "nested"), { recursive: true });
    await writeFile(
      path.join(wikiRoot, "nested", "source.txt"),
      "verified wiki source",
      "utf8"
    );
    await updateDataManagementSettings({
      backupDirectory,
      autoRepairEnabled: true
    });

    const displacedRoot = path.join(dataRoot, "wiki-ingest.original");
    const outsideRoot = path.join(dataRoot, "outside-wiki-root");
    await mkdir(path.join(outsideRoot, "nested"), { recursive: true });
    await writeFile(
      path.join(outsideRoot, "nested", "source.txt"),
      "outside root",
      "utf8"
    );
    await assert.rejects(
      createDataBackup(
        { note: "Reject replaced wiki root" },
        {
          async beforeStreamingArchiveForTest() {
            await rename(wikiRoot, displacedRoot);
            await symlink(outsideRoot, wikiRoot);
          }
        }
      ),
      /changed after Forge verified its path|replaced/u
    );
    await rm(wikiRoot);
    await rename(displacedRoot, wikiRoot);
    assert.deepEqual(await readdir(backupDirectory), []);

    const nestedRoot = path.join(wikiRoot, "nested");
    const displacedNestedRoot = path.join(wikiRoot, "nested.original");
    const outsideNestedRoot = path.join(dataRoot, "outside-wiki-parent");
    await mkdir(outsideNestedRoot);
    await writeFile(
      path.join(outsideNestedRoot, "source.txt"),
      "outside parent",
      "utf8"
    );
    await assert.rejects(
      createDataBackup(
        { note: "Reject replaced wiki parent" },
        {
          async beforeStreamingArchiveForTest() {
            await rename(nestedRoot, displacedNestedRoot);
            await symlink(outsideNestedRoot, nestedRoot);
          }
        }
      ),
      /changed after Forge verified its path|changed while Forge opened/u
    );
    await rm(nestedRoot);
    await rename(displacedNestedRoot, nestedRoot);
    assert.deepEqual(await readdir(backupDirectory), []);
    assert.deepEqual(await listDataBackups(), []);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("streaming backup tolerates unrelated data-root entry churn without weakening source identity", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-backup-root-churn-");
  const backupDirectory = path.join(dataRoot, "backups");
  try {
    await writeRuntimeArtifacts(dataRoot, "root-churn");
    await updateDataManagementSettings({
      backupDirectory,
      autoRepairEnabled: true
    });
    const backup = await createDataBackup(
      { note: "Allow unrelated root churn" },
      {
        async beforeStreamingArchiveForTest() {
          await writeFile(
            path.join(dataRoot, "unrelated-runtime-file"),
            "unrelated",
            "utf8"
          );
        }
      }
    );
    const archive = new AdmZip(backup.archivePath);
    assert.ok(
      archive
        .getEntries()
        .some((entry) => entry.entryName === ".forge-secrets.key")
    );
    assert.equal(
      archive
        .getEntries()
        .some((entry) => entry.entryName === "unrelated-runtime-file"),
      false
    );
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
    traversalArchive.addFile("aa/escape", Buffer.from("escape", "utf8"));
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
    const traversalManifest = JSON.parse(
      await readFile(traversal.manifestPath, "utf8")
    );
    traversalManifest.archiveSha256 = createHash("sha256")
      .update(traversalBytes)
      .digest("hex");
    await writeFile(
      traversal.manifestPath,
      `${JSON.stringify(traversalManifest, null, 2)}\n`,
      "utf8"
    );
    await chmod(traversal.manifestPath, 0o600);
    await assert.rejects(
      restoreDataBackup(traversal.id, { createSafetyBackup: false }),
      /traversal path|invalid relative path/u
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

test("restoreDataBackup rejects encrypted, unsupported, corrupt, and truncated entries without changing live data", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-restore-malformed-");
  try {
    insertTag("tag_live_before_malformed", "Live before malformed");
    const expectedTagIds = listTagIds();
    await updateDataManagementSettings({
      backupDirectory: path.join(dataRoot, "backups"),
      autoRepairEnabled: true
    });

    const encrypted = await createDataBackup({ note: "Encrypted flag" });
    const encryptedBytes = mutateCentralDirectoryEntry(
      await readFile(encrypted.archivePath),
      "forge.sqlite",
      (bytes, offset) => {
        bytes.writeUInt16LE(bytes.readUInt16LE(offset + 8) | 0x1, offset + 8);
      }
    );
    await writeFile(encrypted.archivePath, encryptedBytes);
    await chmod(encrypted.archivePath, 0o600);
    await removeRecordedArchiveChecksum(encrypted.manifestPath);
    await assert.rejects(
      restoreDataBackup(encrypted.id, { createSafetyBackup: false }),
      /does not restore encrypted/u
    );

    const unsupported = await createDataBackup({
      note: "Unsupported compression"
    });
    const unsupportedBytes = mutateCentralDirectoryEntry(
      await readFile(unsupported.archivePath),
      "forge.sqlite",
      (bytes, offset) => bytes.writeUInt16LE(99, offset + 10)
    );
    await writeFile(unsupported.archivePath, unsupportedBytes);
    await chmod(unsupported.archivePath, 0o600);
    await removeRecordedArchiveChecksum(unsupported.manifestPath);
    await assert.rejects(
      restoreDataBackup(unsupported.id, { createSafetyBackup: false }),
      /unsupported compression method/u
    );

    const corrupt = await createDataBackup({ note: "CRC mismatch" });
    const corruptBytes = mutateCentralDirectoryEntry(
      await readFile(corrupt.archivePath),
      "forge.sqlite",
      (bytes, offset) => {
        bytes.writeUInt32LE(
          (bytes.readUInt32LE(offset + 16) ^ 0xffffffff) >>> 0,
          offset + 16
        );
      }
    );
    await writeFile(corrupt.archivePath, corruptBytes);
    await chmod(corrupt.archivePath, 0o600);
    await removeRecordedArchiveChecksum(corrupt.manifestPath);
    await assert.rejects(
      restoreDataBackup(corrupt.id, { createSafetyBackup: false }),
      /size or checksum verification/u
    );

    const truncated = await createDataBackup({ note: "Truncated archive" });
    const completeBytes = await readFile(truncated.archivePath);
    await writeFile(
      truncated.archivePath,
      completeBytes.subarray(0, completeBytes.length - 22)
    );
    await chmod(truncated.archivePath, 0o600);
    await removeRecordedArchiveChecksum(truncated.manifestPath);
    await assert.rejects(
      restoreDataBackup(truncated.id, { createSafetyBackup: false }),
      /central directory|end of central directory|invalid zip/u
    );

    assert.deepEqual(listTagIds(), expectedTagIds);
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

test("restoreDataBackup rejects archive bytes that do not match the recorded SHA-256 without changing live data", async () => {
  const dataRoot = await createRuntimeRoot("forge-data-restore-checksum-");
  try {
    insertTag("tag_live_before_checksum", "Live before checksum failure");
    const expectedTagIds = listTagIds();
    await updateDataManagementSettings({
      backupDirectory: path.join(dataRoot, "backups"),
      autoRepairEnabled: true
    });

    const backup = await createDataBackup({ note: "Checksum fixture" });
    const archiveBytes = await readFile(backup.archivePath);
    archiveBytes[0] = archiveBytes[0] ^ 0xff;
    await writeFile(backup.archivePath, archiveBytes);
    await chmod(backup.archivePath, 0o600);

    await assert.rejects(
      restoreDataBackup(backup.id, { createSafetyBackup: false }),
      /does not match its recorded SHA-256 checksum/u
    );
    assert.deepEqual(listTagIds(), expectedTagIds);
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
  const currentRoot = await createRuntimeRoot("forge-switch-recovery-current-");
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
