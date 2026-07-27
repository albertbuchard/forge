import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, type Dirent } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import AdmZip from "adm-zip";
import {
  closeDatabase,
  configureDatabase,
  getDatabase,
  getEffectiveDataRoot,
  initializeDatabase,
  resolveDatabasePathForDataRoot
} from "../db.js";
import { HttpError } from "../errors.js";
import {
  createDataBackupSchema,
  dataBackupEntrySchema,
  dataBackupModeSchema,
  dataExportFormatSchema,
  dataExportOptionSchema,
  dataManagementSettingsSchema,
  dataManagementStateSchema,
  dataRecoveryCandidateSchema,
  dataRuntimeSnapshotSchema,
  restoreDataBackupSchema,
  switchDataRootSchema,
  updateDataManagementSettingsSchema,
  type CreateDataBackupInput,
  type DataBackupEntry,
  type DataBackupMode,
  type DataExportFormat,
  type DataManagementSettings,
  type DataManagementState,
  type DataRecoveryCandidate,
  type DataRuntimeSnapshot,
  type RestoreDataBackupInput,
  type SwitchDataRootInput,
  type UpdateDataManagementSettingsInput
} from "../data-management-types.js";
import type { SecretsManager } from "../managers/platform/secrets-manager.js";
import {
  syncLocalAdapterDataRoots,
  writeMonorepoPreferredDataRoot
} from "../runtime-data-root.js";

type DataManagementSettingsRow = {
  preferred_data_root: string;
  backup_directory: string;
  backup_frequency_hours: number | null;
  backup_retention_days: number | null;
  auto_repair_enabled: number;
  last_auto_backup_at: string | null;
  last_manual_backup_at: string | null;
  created_at: string;
  updated_at: string;
};

type ExportPayload = {
  body: Buffer;
  mimeType: string;
  fileName: string;
};

type ScanForDataRecoveryCandidatesOptions = {
  roots?: string[];
  maxDepth?: number;
};

type SwitchDataRootOptions = {
  secretsManager?: SecretsManager;
  persistPreferredDataRoot?: (dataRoot: string) => Promise<void>;
  syncAdapterDataRoots?: (dataRoot: string) => Promise<void>;
  simulateInterruptionAfterPhase?: "activated" | "persisted";
};

const EXPORT_OPTIONS = [
  {
    format: "sqlite",
    label: "SQLite snapshot",
    description: "A portable SQLite snapshot of the live Forge database.",
    mimeType: "application/vnd.sqlite3",
    extension: "sqlite"
  },
  {
    format: "json",
    label: "JSON bundle",
    description: "All user-visible tables exported as structured JSON.",
    mimeType: "application/json",
    extension: "json"
  },
  {
    format: "csv_bundle",
    label: "CSV bundle",
    description:
      "A zip archive with one CSV per table for spreadsheet workflows.",
    mimeType: "application/zip",
    extension: "zip"
  },
  {
    format: "schema_sql",
    label: "Schema SQL",
    description: "SQL DDL for the current database structure.",
    mimeType: "application/sql",
    extension: "sql"
  },
  {
    format: "schema_json",
    label: "Schema JSON",
    description:
      "Structured database schema metadata for tooling and inspection.",
    mimeType: "application/json",
    extension: "json"
  }
] as const;

const SKIP_SCAN_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  "backups"
]);

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const MAX_BACKUP_ARCHIVE_ENTRIES = 100_000;
const MAX_BACKUP_ARCHIVE_ENTRY_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_BACKUP_ARCHIVE_TOTAL_BYTES = 20 * 1024 * 1024 * 1024;
const RESTORE_JOURNAL_FILE = ".forge-restore-journal.json";
const SWITCH_ROOT_JOURNAL_FILE = ".forge-switch-root-journal.json";

type RestoreTargetName =
  | "forge.sqlite"
  | "forge.sqlite-wal"
  | "forge.sqlite-shm"
  | "wiki-ingest"
  | ".forge-secrets.key";

type RestoreJournal = {
  version: 1;
  phase: "prepared" | "installed";
  dataRoot: string;
  installDirectory: string;
  operations: Array<{
    name: RestoreTargetName;
    originalExisted: boolean;
    installIncoming: boolean;
  }>;
};

type SwitchRootJournal = {
  version: 1;
  phase: "prepared" | "activated" | "persisted";
  mode: "migrate_current" | "adopt_existing";
  currentRoot: string;
  targetRoot: string;
  targetOriginallyExisted: boolean;
  stagingDirectory: string | null;
  displacedTargetDirectory: string | null;
};
const CREDENTIAL_BACKUP_NOTICE =
  "HIGHLY SENSITIVE: This Forge backup contains personal data and may contain .forge-secrets.key together with encrypted credential records. Possession of both can permit recovery of stored provider credentials. Keep the archive and manifest owner-only, do not publish or attach them to support requests, and transfer them only through encrypted channels.";

function nowIso() {
  return new Date().toISOString();
}

function expandUserPath(value: string, baseDir = getEffectiveDataRoot()) {
  const trimmed = value.trim();
  if (!trimmed) {
    return baseDir;
  }
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(baseDir, trimmed);
}

function getDefaultBackupDirectory(dataRoot = getEffectiveDataRoot()) {
  return path.join(path.resolve(dataRoot), "backups");
}

function ensureDataManagementSettingsRow() {
  const now = nowIso();
  const dataRoot = getEffectiveDataRoot();
  const backupDirectory = getDefaultBackupDirectory(dataRoot);
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO data_management_settings (
        id,
        preferred_data_root,
        backup_directory,
        backup_frequency_hours,
        backup_retention_days,
        auto_repair_enabled,
        last_auto_backup_at,
        last_manual_backup_at,
        created_at,
        updated_at
      ) VALUES (1, ?, ?, NULL, 30, 1, NULL, NULL, ?, ?)`
    )
    .run(dataRoot, backupDirectory, now, now);
}

function readDataManagementSettingsRow(): DataManagementSettingsRow {
  ensureDataManagementSettingsRow();
  return getDatabase()
    .prepare(
      `SELECT
        preferred_data_root,
        backup_directory,
        backup_frequency_hours,
        backup_retention_days,
        auto_repair_enabled,
        last_auto_backup_at,
        last_manual_backup_at,
        created_at,
        updated_at
      FROM data_management_settings
      WHERE id = 1`
    )
    .get() as DataManagementSettingsRow;
}

function writeDataManagementSettingsRow(
  patch: Partial<DataManagementSettingsRow>
) {
  const current = readDataManagementSettingsRow();
  const next: DataManagementSettingsRow = {
    ...current,
    updated_at: nowIso()
  };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  getDatabase()
    .prepare(
      `UPDATE data_management_settings
       SET preferred_data_root = ?,
           backup_directory = ?,
           backup_frequency_hours = ?,
           backup_retention_days = ?,
           auto_repair_enabled = ?,
           last_auto_backup_at = ?,
           last_manual_backup_at = ?,
           updated_at = ?
       WHERE id = 1`
    )
    .run(
      next.preferred_data_root,
      next.backup_directory,
      next.backup_frequency_hours,
      next.backup_retention_days,
      next.auto_repair_enabled,
      next.last_auto_backup_at,
      next.last_manual_backup_at,
      next.updated_at
    );
}

function resolveCurrentDataManagementSettings(): DataManagementSettings {
  const row = readDataManagementSettingsRow();
  const preferredDataRoot =
    row.preferred_data_root.trim() || getEffectiveDataRoot();
  const backupDirectory =
    row.backup_directory.trim() || getDefaultBackupDirectory(preferredDataRoot);
  return dataManagementSettingsSchema.parse({
    preferredDataRoot,
    backupDirectory,
    backupFrequencyHours: row.backup_frequency_hours,
    backupRetentionDays: row.backup_retention_days,
    autoRepairEnabled: row.auto_repair_enabled === 1,
    lastAutoBackupAt: row.last_auto_backup_at,
    lastManualBackupAt: row.last_manual_backup_at
  });
}

function quoteSqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function detectLayoutForDatabasePath(databasePath: string) {
  if (!databasePath) {
    return "missing" as const;
  }
  if (path.basename(path.dirname(databasePath)) === "data") {
    return "legacy" as const;
  }
  return "flat" as const;
}

function deriveDataRootFromDatabasePath(databasePath: string) {
  const layout = detectLayoutForDatabasePath(databasePath);
  if (layout === "legacy") {
    return path.dirname(path.dirname(databasePath));
  }
  return path.dirname(databasePath);
}

function countRowsInDatabase(database: DatabaseSync, table: string) {
  try {
    const row = database
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as { count: number };
    return row.count;
  } catch {
    return 0;
  }
}

function collectCountsFromDatabase(database: DatabaseSync) {
  return {
    notes: countRowsInDatabase(database, "notes"),
    goals: countRowsInDatabase(database, "goals"),
    projects: countRowsInDatabase(database, "projects"),
    tasks: countRowsInDatabase(database, "tasks"),
    taskRuns: countRowsInDatabase(database, "task_runs"),
    tags: countRowsInDatabase(database, "tags")
  };
}

function checkIntegrity(database: DatabaseSync) {
  try {
    const row = database.prepare("PRAGMA quick_check;").get() as
      | Record<string, string>
      | undefined;
    const value = row ? Object.values(row)[0] : "ok";
    return {
      integrityOk: value === "ok",
      integrityMessage: value ?? "ok"
    };
  } catch (error) {
    return {
      integrityOk: false,
      integrityMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

async function statFileIfExists(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

export async function getCurrentDataRuntimeSnapshot(): Promise<DataRuntimeSnapshot> {
  const dataRoot = getEffectiveDataRoot();
  const databasePath = resolveDatabasePathForDataRoot(dataRoot);
  const databaseStat = await statFileIfExists(databasePath);
  const database = getDatabase();
  const integrity = checkIntegrity(database);
  return dataRuntimeSnapshotSchema.parse({
    dataRoot,
    databasePath,
    layout: databaseStat
      ? detectLayoutForDatabasePath(databasePath)
      : "missing",
    databaseSizeBytes: databaseStat?.size ?? 0,
    databaseLastModifiedAt: databaseStat?.mtime.toISOString() ?? null,
    integrityOk: integrity.integrityOk,
    integrityMessage: integrity.integrityMessage,
    counts: collectCountsFromDatabase(database)
  });
}

function listTables(database: DatabaseSync) {
  return (
    database
      .prepare(
        `SELECT name
         FROM sqlite_schema
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function buildSchemaSql(database: DatabaseSync) {
  const rows = database
    .prepare(
      `SELECT sql
       FROM sqlite_schema
       WHERE sql IS NOT NULL
       ORDER BY
         CASE type
           WHEN 'table' THEN 0
           WHEN 'index' THEN 1
           WHEN 'trigger' THEN 2
           WHEN 'view' THEN 3
           ELSE 4
         END,
         name`
    )
    .all() as Array<{ sql: string }>;
  return rows.map((row) => `${row.sql};`).join("\n\n");
}

function buildSchemaJson(database: DatabaseSync) {
  const tables = listTables(database).map((table) => {
    const columns = (
      database
        .prepare(`PRAGMA table_info(${quoteSqlString(table)});`)
        .all() as Array<{
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }>
    ).map((column) => ({
      cid: column.cid,
      name: column.name,
      type: column.type,
      notNull: column.notnull === 1,
      defaultValue: column.dflt_value,
      primaryKeyPosition: column.pk
    }));
    const foreignKeys = (
      database
        .prepare(`PRAGMA foreign_key_list(${quoteSqlString(table)});`)
        .all() as Array<{
        id: number;
        seq: number;
        table: string;
        from: string;
        to: string;
        on_update: string;
        on_delete: string;
      }>
    ).map((foreignKey) => ({
      id: foreignKey.id,
      sequence: foreignKey.seq,
      table: foreignKey.table,
      from: foreignKey.from,
      to: foreignKey.to,
      onUpdate: foreignKey.on_update,
      onDelete: foreignKey.on_delete
    }));
    const indexes = (
      database
        .prepare(`PRAGMA index_list(${quoteSqlString(table)});`)
        .all() as Array<{
        seq: number;
        name: string;
        unique: number;
        origin: string;
        partial: number;
      }>
    ).map((index) => ({
      sequence: index.seq,
      name: index.name,
      unique: index.unique === 1,
      origin: index.origin,
      partial: index.partial === 1,
      columns: (
        database
          .prepare(`PRAGMA index_info(${quoteSqlString(index.name)});`)
          .all() as Array<{
          seqno: number;
          cid: number;
          name: string;
        }>
      ).map((column) => ({
        sequence: column.seqno,
        cid: column.cid,
        name: column.name
      }))
    }));
    return {
      table,
      columns,
      foreignKeys,
      indexes
    };
  });
  return {
    generatedAt: nowIso(),
    tables
  };
}

function buildJsonExport(database: DatabaseSync) {
  const tables = listTables(database);
  const payload = Object.fromEntries(
    tables.map((table) => {
      const rows = database.prepare(`SELECT * FROM ${table}`).all();
      return [table, rows];
    })
  );
  return {
    generatedAt: nowIso(),
    tables: payload
  };
}

function csvEscape(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

function buildCsvForTable(database: DatabaseSync, table: string) {
  const rows = database.prepare(`SELECT * FROM ${table}`).all() as Array<
    Record<string, unknown>
  >;
  if (rows.length === 0) {
    return "";
  }
  const headers = Object.keys(rows[0]);
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => csvEscape(row[header])).join(",")
    )
  ].join("\n");
}

async function createSqliteSnapshot(database: DatabaseSync) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "forge-sqlite-export-"));
  try {
    await chmod(tempDir, PRIVATE_DIRECTORY_MODE);
    const snapshotPath = path.join(tempDir, "forge.sqlite");
    database.exec(`VACUUM INTO ${quoteSqlString(snapshotPath)};`);
    await chmod(snapshotPath, PRIVATE_FILE_MODE);
    return {
      tempDir,
      snapshotPath
    };
  } catch (error) {
    await removeIfExists(tempDir);
    throw error;
  }
}

async function ensurePrivateDirectory(directoryPath: string) {
  await mkdir(directoryPath, {
    recursive: true,
    mode: PRIVATE_DIRECTORY_MODE
  });
  const directoryStat = await lstat(directoryPath);
  const expectedOwner = process.getuid?.();
  if (
    directoryStat.isSymbolicLink() ||
    !directoryStat.isDirectory() ||
    (expectedOwner !== undefined && directoryStat.uid !== expectedOwner)
  ) {
    throw new HttpError(
      400,
      "private_directory_not_owner_controlled",
      "Forge refuses to use a symbolic-link or non-owner data directory."
    );
  }
  await chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
}

async function assertOwnerRegularFile(filePath: string) {
  const fileStat = await lstat(filePath);
  const expectedOwner = process.getuid?.();
  if (
    fileStat.isSymbolicLink() ||
    !fileStat.isFile() ||
    (expectedOwner !== undefined && fileStat.uid !== expectedOwner)
  ) {
    throw new HttpError(
      400,
      "backup_source_not_owner_controlled",
      "Forge refuses to back up a symbolic-link or non-owner source file."
    );
  }
}

async function assertBackupTreeHasNoLinks(rootPath: string) {
  let visited = 0;
  const visit = async (directoryPath: string): Promise<void> => {
    for (const entry of await readdir(directoryPath, {
      withFileTypes: true
    })) {
      visited += 1;
      if (visited > MAX_BACKUP_ARCHIVE_ENTRIES) {
        throw new HttpError(
          400,
          "backup_source_entry_limit",
          "The backup source contains too many entries."
        );
      }
      const entryPath = path.join(directoryPath, entry.name);
      const entryStat = await lstat(entryPath);
      if (entryStat.isSymbolicLink()) {
        throw new HttpError(
          400,
          "backup_source_symlink_forbidden",
          "Forge refuses to follow symbolic links into a credential-bearing backup."
        );
      }
      if (entryStat.isDirectory()) {
        await visit(entryPath);
      } else if (!entryStat.isFile()) {
        throw new HttpError(
          400,
          "backup_source_type_forbidden",
          "Forge backups accept only regular files and directories."
        );
      }
    }
  };
  await visit(rootPath);
}

function isPathInside(parentPath: string, candidatePath: string) {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

async function assertOwnerControlledPath(input: {
  targetPath: string;
  rootPath: string;
  kind: "file" | "directory";
}) {
  const root = path.resolve(input.rootPath);
  const target = path.resolve(input.targetPath);
  if (!isPathInside(root, target)) {
    throw new HttpError(
      400,
      "backup_path_outside_root",
      "The backup artifact is outside the configured backup directory."
    );
  }
  const [rootStat, targetStat, realRoot, realTarget] = await Promise.all([
    lstat(root),
    lstat(target),
    realpath(root),
    realpath(target)
  ]);
  const expectedOwner = process.getuid?.();
  if (
    rootStat.isSymbolicLink() ||
    targetStat.isSymbolicLink() ||
    !isPathInside(realRoot, realTarget) ||
    (input.kind === "file"
      ? !targetStat.isFile()
      : !targetStat.isDirectory()) ||
    (expectedOwner !== undefined &&
      (rootStat.uid !== expectedOwner || targetStat.uid !== expectedOwner)) ||
    (rootStat.mode & 0o077) !== 0 ||
    (targetStat.mode & 0o077) !== 0
  ) {
    throw new HttpError(
      400,
      "backup_path_not_owner_controlled",
      "The backup artifact is not an owner-only regular path."
    );
  }
}

function safeArchiveEntryPath(entryName: string) {
  if (
    !entryName ||
    entryName.includes("\0") ||
    entryName.includes("\\") ||
    path.posix.isAbsolute(entryName)
  ) {
    throw new HttpError(
      400,
      "backup_archive_entry_invalid",
      "The backup archive contains an invalid path."
    );
  }
  const withoutTrailingSlash = entryName.replace(/\/+$/u, "");
  const normalized = path.posix.normalize(withoutTrailingSlash);
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized !== withoutTrailingSlash
  ) {
    throw new HttpError(
      400,
      "backup_archive_entry_invalid",
      "The backup archive contains a traversal path."
    );
  }
  return normalized;
}

async function extractVerifiedBackupArchive(input: {
  backup: DataBackupEntry;
  backupDirectory: string;
  targetDirectory: string;
}) {
  const baseName = buildBackupBaseName(input.backup.createdAt, input.backup.id);
  const expectedArchivePath = archivePathForBaseName(
    input.backupDirectory,
    baseName
  );
  const expectedManifestPath = manifestPathForBaseName(
    input.backupDirectory,
    baseName
  );
  if (
    path.resolve(input.backup.archivePath) !== path.resolve(expectedArchivePath) ||
    path.resolve(input.backup.manifestPath) !==
      path.resolve(expectedManifestPath)
  ) {
    throw new HttpError(
      400,
      "backup_manifest_path_mismatch",
      "The backup manifest does not match its owner-controlled archive path."
    );
  }
  await assertOwnerControlledPath({
    targetPath: input.backupDirectory,
    rootPath: input.backupDirectory,
    kind: "directory"
  });
  await assertOwnerControlledPath({
    targetPath: expectedArchivePath,
    rootPath: input.backupDirectory,
    kind: "file"
  });
  await assertOwnerControlledPath({
    targetPath: expectedManifestPath,
    rootPath: input.backupDirectory,
    kind: "file"
  });

  const archive = new AdmZip(await readFile(expectedArchivePath));
  const entries = archive.getEntries();
  if (entries.length === 0 || entries.length > MAX_BACKUP_ARCHIVE_ENTRIES) {
    throw new HttpError(
      400,
      "backup_archive_size_invalid",
      "The backup archive has an unsafe entry count."
    );
  }
  let totalBytes = 0;
  let hasDatabase = false;
  for (const entry of entries) {
    const zipEntry = entry as unknown as {
      attr: number;
      header: { size: number };
    };
    const entryPath = safeArchiveEntryPath(entry.entryName);
    const mode = (zipEntry.attr >>> 16) & 0o170000;
    if (mode === 0o120000) {
      throw new HttpError(
        400,
        "backup_archive_symlink_forbidden",
        "The backup archive contains a symbolic link."
      );
    }
    const size = Number(zipEntry.header.size);
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > MAX_BACKUP_ARCHIVE_ENTRY_BYTES
    ) {
      throw new HttpError(
        400,
        "backup_archive_size_invalid",
        "The backup archive contains an oversized entry."
      );
    }
    totalBytes += size;
    if (totalBytes > MAX_BACKUP_ARCHIVE_TOTAL_BYTES) {
      throw new HttpError(
        400,
        "backup_archive_size_invalid",
        "The backup archive exceeds the restore size limit."
      );
    }
    if (entryPath === "forge.sqlite") {
      hasDatabase = true;
    }
  }
  if (!hasDatabase) {
    throw new HttpError(
      500,
      "backup_missing_database",
      "The selected backup archive does not contain a forge.sqlite snapshot."
    );
  }
  for (const entry of entries) {
    const entryPath = safeArchiveEntryPath(entry.entryName);
    const targetPath = path.join(input.targetDirectory, ...entryPath.split("/"));
    if (entry.isDirectory) {
      await mkdir(targetPath, {
        recursive: true,
        mode: PRIVATE_DIRECTORY_MODE
      });
      continue;
    }
    await mkdir(path.dirname(targetPath), {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE
    });
    await writeFile(targetPath, entry.getData(), {
      flag: "wx",
      mode: PRIVATE_FILE_MODE
    });
  }
}

async function removeIfExists(targetPath: string) {
  try {
    await rm(targetPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures for missing files.
  }
}

async function copyIfExists(sourcePath: string, targetPath: string) {
  if (!existsSync(sourcePath)) {
    return;
  }
  const sourceStat = await stat(sourcePath);
  if (sourceStat.isDirectory()) {
    await cp(sourcePath, targetPath, { recursive: true });
    return;
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath);
}

async function checkpointCurrentDatabase() {
  try {
    getDatabase().exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {
    // The runtime can continue even if checkpointing fails.
  }
}

function buildBackupBaseName(createdAt: string, id: string) {
  return `forge-backup-${createdAt.replaceAll(/[:.]/g, "-")}-${id}`;
}

function manifestPathForBaseName(backupDirectory: string, baseName: string) {
  return path.join(backupDirectory, `${baseName}.manifest.json`);
}

function archivePathForBaseName(backupDirectory: string, baseName: string) {
  return path.join(backupDirectory, `${baseName}.zip`);
}

export async function listDataBackups(): Promise<DataBackupEntry[]> {
  const settings = resolveCurrentDataManagementSettings();
  await ensurePrivateDirectory(settings.backupDirectory);
  const entries = await readdir(settings.backupDirectory);
  const manifests = entries
    .filter((entry) => entry.endsWith(".manifest.json"))
    .sort()
    .reverse();
  const backups: DataBackupEntry[] = [];
  for (const manifestName of manifests) {
    const manifestPath = path.join(settings.backupDirectory, manifestName);
    try {
      const raw = await readFile(manifestPath, "utf8");
      backups.push(dataBackupEntrySchema.parse(JSON.parse(raw)));
    } catch {
      // Ignore malformed backup manifests so one bad file does not break the page.
    }
  }
  return backups;
}

export async function createDataBackup(
  input: CreateDataBackupInput = { note: "" },
  options: {
    mode?: DataBackupMode;
    archiveWriter?: (archive: AdmZip, targetPath: string) => void;
  } = {}
): Promise<DataBackupEntry> {
  const parsed = createDataBackupSchema.parse(input);
  const mode = dataBackupModeSchema.parse(options.mode ?? "manual");
  const settings = resolveCurrentDataManagementSettings();
  const snapshot = await getCurrentDataRuntimeSnapshot();
  await ensurePrivateDirectory(settings.backupDirectory);
  const backupId = `bkp_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const createdAt = nowIso();
  const baseName = buildBackupBaseName(createdAt, backupId);
  const archivePath = archivePathForBaseName(
    settings.backupDirectory,
    baseName
  );
  const manifestPath = manifestPathForBaseName(
    settings.backupDirectory,
    baseName
  );
  const database = getDatabase();
  const sqliteSnapshot = await createSqliteSnapshot(database);
  let stageDirectory: string | null = null;
  let archiveFinalized = false;
  let manifestFinalized = false;
  try {
    stageDirectory = await mkdtemp(
      path.join(settings.backupDirectory, ".forge-backup-stage-")
    );
    await chmod(stageDirectory, PRIVATE_DIRECTORY_MODE);
    const stagedArchivePath = path.join(stageDirectory, `${baseName}.zip`);
    const stagedManifestPath = path.join(
      stageDirectory,
      `${baseName}.manifest.json`
    );
    const zip = new AdmZip();
    zip.addLocalFile(sqliteSnapshot.snapshotPath, "", "forge.sqlite");
    zip.addFile("schema.sql", Buffer.from(buildSchemaSql(database), "utf8"));
    zip.addFile(
      "schema.json",
      Buffer.from(JSON.stringify(buildSchemaJson(database), null, 2), "utf8")
    );
    zip.addFile(
      "snapshot-summary.json",
      Buffer.from(
        JSON.stringify(
          {
            generatedAt: createdAt,
            mode,
            note: parsed.note,
            current: snapshot,
            sensitivity: {
              classification: "credential-bearing-backup",
              notice: CREDENTIAL_BACKUP_NOTICE
            }
          },
          null,
          2
        ),
        "utf8"
      )
    );
    const currentRoot = getEffectiveDataRoot();
    const wikiIngestPath = path.join(currentRoot, "wiki-ingest");
    if (existsSync(wikiIngestPath)) {
      await assertBackupTreeHasNoLinks(wikiIngestPath);
      zip.addLocalFolder(wikiIngestPath, "wiki-ingest");
    }
    const secretsKeyPath = path.join(currentRoot, ".forge-secrets.key");
    if (existsSync(secretsKeyPath)) {
      await assertOwnerRegularFile(secretsKeyPath);
      zip.addLocalFile(secretsKeyPath, "", ".forge-secrets.key");
    }
    zip.addFile(
      "BACKUP-SENSITIVITY.txt",
      Buffer.from(`${CREDENTIAL_BACKUP_NOTICE}\n`, "utf8")
    );
    if (options.archiveWriter) {
      options.archiveWriter(zip, stagedArchivePath);
    } else {
      zip.writeZip(stagedArchivePath);
    }
    await chmod(stagedArchivePath, PRIVATE_FILE_MODE);
    const archiveStat = await stat(stagedArchivePath);
    const backup = dataBackupEntrySchema.parse({
      id: backupId,
      createdAt,
      mode,
      note: parsed.note,
      sourceDataRoot: currentRoot,
      backupDirectory: settings.backupDirectory,
      archivePath,
      manifestPath,
      databasePath: snapshot.databasePath,
      sizeBytes: archiveStat.size,
      includesWiki: false,
      includesSecretsKey: existsSync(secretsKeyPath),
      counts: snapshot.counts
    });
    const manifest = {
      ...backup,
      sensitivity: {
        classification: "credential-bearing-backup",
        credentialMaterialIncluded: backup.includesSecretsKey,
        notice: CREDENTIAL_BACKUP_NOTICE
      }
    };
    await writeFile(
      stagedManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", mode: PRIVATE_FILE_MODE }
    );
    await chmod(stagedManifestPath, PRIVATE_FILE_MODE);

    await rename(stagedArchivePath, archivePath);
    archiveFinalized = true;
    await rename(stagedManifestPath, manifestPath);
    manifestFinalized = true;
    if (mode === "manual") {
      writeDataManagementSettingsRow({ last_manual_backup_at: createdAt });
    }
    if (mode === "automatic") {
      writeDataManagementSettingsRow({ last_auto_backup_at: createdAt });
      await pruneExpiredAutomaticBackups(
        settings.backupDirectory,
        settings.backupRetentionDays
      );
    }
    return backup;
  } finally {
    if (!manifestFinalized && archiveFinalized) {
      await removeIfExists(archivePath);
    }
    if (!manifestFinalized) {
      await removeIfExists(manifestPath);
    }
    if (stageDirectory) {
      await removeIfExists(stageDirectory);
    }
    await rm(sqliteSnapshot.tempDir, { recursive: true, force: true });
  }
}

async function pruneExpiredAutomaticBackups(
  backupDirectory: string,
  retentionDays: number | null
) {
  if (!retentionDays) {
    return;
  }
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const backups = await listDataBackups();
  for (const backup of backups) {
    if (backup.mode !== "automatic") {
      continue;
    }
    if (
      path.resolve(backup.backupDirectory) !== path.resolve(backupDirectory)
    ) {
      continue;
    }
    const createdAtMs = new Date(backup.createdAt).getTime();
    if (!Number.isFinite(createdAtMs) || createdAtMs >= cutoff) {
      continue;
    }
    await rm(backup.archivePath, { force: true });
    await rm(backup.manifestPath, { force: true });
  }
}

async function openDatabaseSnapshot(databasePath: string) {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 250;");
  return database;
}

async function inspectDatabaseCandidate(
  databasePath: string,
  current: DataRuntimeSnapshot
) {
  const dbStat = await statFileIfExists(databasePath);
  if (!dbStat) {
    return null;
  }
  const database = await openDatabaseSnapshot(databasePath);
  try {
    const integrity = checkIntegrity(database);
    const counts = collectCountsFromDatabase(database);
    const dataRoot = deriveDataRootFromDatabasePath(databasePath);
    const sameAsCurrent =
      path.resolve(dataRoot) === path.resolve(current.dataRoot);
    const sourceHint = dataRoot.includes(`${path.sep}.openclaw${path.sep}`)
      ? "OpenClaw"
      : dataRoot.includes(`${path.sep}.hermes${path.sep}`)
        ? "Hermes"
        : dataRoot.includes(`${path.sep}backups${path.sep}`)
          ? "Backup copy"
          : dataRoot.includes(`${path.sep}projects${path.sep}`)
            ? "Project-local"
            : dataRoot.includes(`${path.sep}data${path.sep}`)
              ? "Shared data"
              : "Disk candidate";
    return dataRecoveryCandidateSchema.parse({
      id: createHash("sha1").update(databasePath).digest("hex").slice(0, 12),
      dataRoot,
      databasePath,
      layout: detectLayoutForDatabasePath(databasePath),
      sourceHint,
      databaseSizeBytes: dbStat.size,
      databaseLastModifiedAt: dbStat.mtime.toISOString(),
      integrityOk: integrity.integrityOk,
      integrityMessage: integrity.integrityMessage,
      counts,
      newerThanCurrent:
        (current.databaseLastModifiedAt
          ? dbStat.mtime.getTime() >
            new Date(current.databaseLastModifiedAt).getTime()
          : true) && !sameAsCurrent,
      sameAsCurrent
    });
  } finally {
    database.close();
  }
}

function gatherScanRoots(explicitRoots?: string[]) {
  if (explicitRoots && explicitRoots.length > 0) {
    return Array.from(
      new Set(explicitRoots.map((entry) => path.resolve(entry)))
    ).filter((entry) => existsSync(entry));
  }
  const currentRoot = getEffectiveDataRoot();
  const roots = [
    currentRoot,
    path.dirname(currentRoot),
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.join(os.homedir(), ".openclaw"),
    path.join(os.homedir(), ".hermes"),
    path.join(os.homedir(), "Documents")
  ];
  return Array.from(new Set(roots.map((entry) => path.resolve(entry)))).filter(
    (entry) => existsSync(entry)
  );
}

function walkForForgeSqlite(rootDir: string, maxDepth = 5) {
  const matches: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) {
      return;
    }
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { encoding: "utf8", withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "forge.sqlite" && entry.isFile()) {
        matches.push(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isDirectory()) {
        continue;
      }
      if (SKIP_SCAN_DIRECTORIES.has(entry.name)) {
        continue;
      }
      visit(path.join(dir, entry.name), depth + 1);
    }
  };
  visit(rootDir, 0);
  return matches;
}

export async function scanForDataRecoveryCandidates(
  options: ScanForDataRecoveryCandidatesOptions = {}
): Promise<DataRecoveryCandidate[]> {
  const current = await getCurrentDataRuntimeSnapshot();
  const candidates = new Map<string, DataRecoveryCandidate>();
  for (const scanRoot of gatherScanRoots(options.roots)) {
    for (const databasePath of walkForForgeSqlite(
      scanRoot,
      options.maxDepth ?? 5
    )) {
      const candidate = await inspectDatabaseCandidate(databasePath, current);
      if (!candidate) {
        continue;
      }
      if (
        candidate.counts.notes === 0 &&
        candidate.counts.goals === 0 &&
        candidate.counts.tasks === 0
      ) {
        continue;
      }
      candidates.set(candidate.databasePath, candidate);
    }
  }
  return Array.from(candidates.values()).sort((left, right) => {
    const rightTime = right.databaseLastModifiedAt
      ? new Date(right.databaseLastModifiedAt).getTime()
      : 0;
    const leftTime = left.databaseLastModifiedAt
      ? new Date(left.databaseLastModifiedAt).getTime()
      : 0;
    return rightTime - leftTime;
  });
}

function runtimeAssetPaths(dataRoot: string) {
  const resolvedRoot = path.resolve(dataRoot);
  return {
    dataRoot: resolvedRoot,
    databasePath: resolveDatabasePathForDataRoot(resolvedRoot),
    wikiIngestPath: path.join(resolvedRoot, "wiki-ingest"),
    secretsKeyPath: path.join(resolvedRoot, ".forge-secrets.key")
  };
}

async function copyRuntimeAssets(sourceRoot: string, targetRoot: string) {
  const source = runtimeAssetPaths(sourceRoot);
  const target = runtimeAssetPaths(targetRoot);
  await mkdir(target.dataRoot, {
    recursive: true,
    mode: PRIVATE_DIRECTORY_MODE
  });
  await chmod(target.dataRoot, PRIVATE_DIRECTORY_MODE);
  if (existsSync(target.databasePath) || existsSync(target.secretsKeyPath)) {
    throw new HttpError(
      409,
      "target_data_root_not_empty",
      `Forge found existing runtime data under ${target.dataRoot}. Pick another folder or adopt the existing runtime instead.`
    );
  }
  await copyIfExists(source.databasePath, target.databasePath);
  await copyIfExists(source.wikiIngestPath, target.wikiIngestPath);
  await copyIfExists(source.secretsKeyPath, target.secretsKeyPath);
}

async function assertSecureDataRootTarget(
  targetRoot: string,
  options: { mustExist: boolean; requireEmpty: boolean }
) {
  const resolvedTarget = path.resolve(targetRoot);
  const expectedUid = process.getuid?.();
  const components: string[] = [];
  let cursor = resolvedTarget;
  while (true) {
    components.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  for (const component of components.reverse()) {
    if (!existsSync(component)) continue;
    const linkMetadata = await lstat(component);
    const isTarget = component === resolvedTarget;
    if (
      linkMetadata.isSymbolicLink() &&
      (isTarget || linkMetadata.uid !== 0)
    ) {
      throw new HttpError(
        400,
        "target_data_root_not_owner_controlled",
        "The selected data-root path traverses an unsafe directory."
      );
    }
    const metadata = linkMetadata.isSymbolicLink()
      ? await stat(component)
      : linkMetadata;
    const stickySharedDirectory =
      metadata.isDirectory() &&
      metadata.uid === 0 &&
      (metadata.mode & 0o1000) !== 0;
    if (
      !metadata.isDirectory() ||
      ((metadata.mode & 0o022) !== 0 && !stickySharedDirectory)
    ) {
      throw new HttpError(
        400,
        "target_data_root_not_owner_controlled",
        "The selected data-root path traverses an unsafe directory."
      );
    }
  }
  if (!existsSync(resolvedTarget)) {
    if (options.mustExist) {
      throw new HttpError(
        404,
        "target_data_root_missing",
        `Forge could not find an existing data root under ${resolvedTarget}.`
      );
    }
    return { existed: false };
  }
  const metadata = await lstat(resolvedTarget);
  const resolvedRealTarget = await realpath(resolvedTarget);
  const resolvedRealParent = await realpath(path.dirname(resolvedTarget));
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    !isPathInside(resolvedRealParent, resolvedRealTarget) ||
    (expectedUid !== undefined && metadata.uid !== expectedUid) ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new HttpError(
      400,
      "target_data_root_not_owner_controlled",
      "The selected data root must be an owner-only real directory."
    );
  }
  if (options.requireEmpty && (await readdir(resolvedTarget)).length > 0) {
    throw new HttpError(
      409,
      "target_data_root_not_empty",
      `Forge found existing content under ${resolvedTarget}. Pick an empty folder or adopt the existing runtime instead.`
    );
  }
  return { existed: true };
}

async function secureAdoptedDatabase(targetDataRoot: string) {
  const databasePath = resolveDatabasePathForDataRoot(targetDataRoot);
  const metadata = await lstat(databasePath);
  const expectedUid = process.getuid?.();
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    (expectedUid !== undefined && metadata.uid !== expectedUid) ||
    (metadata.mode & 0o022) !== 0 ||
    !isPathInside(await realpath(targetDataRoot), await realpath(databasePath))
  ) {
    throw new HttpError(
      400,
      "target_data_root_not_owner_controlled",
      "The selected Forge database is not an owner-controlled regular file."
    );
  }
  await chmod(databasePath, PRIVATE_FILE_MODE);
}

function switchRootJournalPath(dataRoot: string) {
  return path.join(dataRoot, SWITCH_ROOT_JOURNAL_FILE);
}

async function writeSwitchRootJournal(
  journal: SwitchRootJournal,
  roots: readonly string[]
) {
  for (const dataRoot of new Set(roots.map((root) => path.resolve(root)))) {
    if (!existsSync(dataRoot)) continue;
    const journalPath = switchRootJournalPath(dataRoot);
    const temporaryPath = `${journalPath}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", PRIVATE_FILE_MODE);
    try {
      await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, journalPath);
    await chmod(journalPath, PRIVATE_FILE_MODE);
    await syncDirectory(dataRoot);
  }
}

async function removeSwitchRootJournals(roots: readonly string[]) {
  for (const dataRoot of new Set(roots.map((root) => path.resolve(root)))) {
    if (!existsSync(dataRoot)) continue;
    await rm(switchRootJournalPath(dataRoot), { force: true });
    await syncDirectory(dataRoot);
  }
}

async function readSwitchRootJournal(
  dataRoot: string
): Promise<SwitchRootJournal | null> {
  const journalPath = switchRootJournalPath(dataRoot);
  if (!existsSync(journalPath)) return null;
  await assertOwnerRegularFile(journalPath);
  const parsed = JSON.parse(
    await readFile(journalPath, "utf8")
  ) as Partial<SwitchRootJournal>;
  if (
    parsed.version !== 1 ||
    !["prepared", "activated", "persisted"].includes(parsed.phase ?? "") ||
    !["migrate_current", "adopt_existing"].includes(parsed.mode ?? "") ||
    !parsed.currentRoot ||
    !parsed.targetRoot ||
    path.resolve(parsed.currentRoot) === path.resolve(parsed.targetRoot)
  ) {
    throw new HttpError(
      500,
      "switch_root_journal_invalid",
      "Forge found an invalid data-root recovery journal and stopped before changing data."
    );
  }
  return parsed as SwitchRootJournal;
}

async function rollbackDataRootSwitch(
  journal: SwitchRootJournal,
  options: SwitchDataRootOptions
) {
  await applyRuntimeRootSwitch(journal.currentRoot, options.secretsManager);
  await (options.persistPreferredDataRoot ?? writeMonorepoPreferredDataRoot)(
    journal.currentRoot
  );
  await (options.syncAdapterDataRoots ?? syncLocalAdapterDataRoots)(
    journal.currentRoot
  );
  if (journal.mode === "migrate_current") {
    if (journal.displacedTargetDirectory) {
      await rm(journal.targetRoot, { recursive: true, force: true });
      if (existsSync(journal.displacedTargetDirectory)) {
        await rename(journal.displacedTargetDirectory, journal.targetRoot);
      }
    } else if (!journal.targetOriginallyExisted) {
      await rm(journal.targetRoot, { recursive: true, force: true });
    }
    if (journal.stagingDirectory) {
      await rm(journal.stagingDirectory, { recursive: true, force: true });
    }
  }
  await removeSwitchRootJournals([
    journal.currentRoot,
    journal.targetRoot
  ]);
}

async function applyRuntimeRootSwitch(
  targetDataRoot: string,
  secretsManager?: SecretsManager
) {
  closeDatabase();
  configureDatabase({ dataRoot: targetDataRoot });
  await initializeDatabase();
  secretsManager?.configure(targetDataRoot);
}

function restoreJournalPath(dataRoot: string) {
  return path.join(dataRoot, RESTORE_JOURNAL_FILE);
}

async function syncDirectory(directoryPath: string) {
  const handle = await open(directoryPath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeRestoreJournal(journal: RestoreJournal) {
  const journalPath = restoreJournalPath(journal.dataRoot);
  const temporaryPath = `${journalPath}.tmp`;
  const handle = await open(temporaryPath, "w", PRIVATE_FILE_MODE);
  try {
    await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, journalPath);
  await syncDirectory(journal.dataRoot);
}

async function removeRestoreJournal(dataRoot: string) {
  await rm(restoreJournalPath(dataRoot), { force: true });
  await syncDirectory(dataRoot);
}

async function readRestoreJournal(
  dataRoot: string
): Promise<RestoreJournal | null> {
  const journalPath = restoreJournalPath(dataRoot);
  if (!existsSync(journalPath)) {
    return null;
  }
  await assertOwnerRegularFile(journalPath);
  const parsed = JSON.parse(await readFile(journalPath, "utf8")) as Partial<
    RestoreJournal
  >;
  const allowedTargets = new Set<RestoreTargetName>([
    "forge.sqlite",
    "forge.sqlite-wal",
    "forge.sqlite-shm",
    "wiki-ingest",
    ".forge-secrets.key"
  ]);
  if (
    parsed.version !== 1 ||
    !["prepared", "installed"].includes(parsed.phase ?? "") ||
    path.resolve(parsed.dataRoot ?? "") !== path.resolve(dataRoot) ||
    !parsed.installDirectory ||
    !isPathInside(dataRoot, parsed.installDirectory) ||
    !path.basename(parsed.installDirectory).startsWith(
      ".forge-restore-stage-"
    ) ||
    !Array.isArray(parsed.operations) ||
    parsed.operations.some(
      (operation) =>
        !operation ||
        !allowedTargets.has(operation.name) ||
        typeof operation.originalExisted !== "boolean" ||
        typeof operation.installIncoming !== "boolean"
    )
  ) {
    throw new HttpError(
      500,
      "restore_journal_invalid",
      "Forge found an invalid restore recovery journal and stopped before changing data."
    );
  }
  return parsed as RestoreJournal;
}

export async function recoverInterruptedDataRestore(
  options: SwitchDataRootOptions = {}
) {
  const dataRoot = getEffectiveDataRoot();
  const switchJournal = await readSwitchRootJournal(dataRoot);
  if (switchJournal) {
    await rollbackDataRootSwitch(switchJournal, options);
    return { recovered: true, action: "switch_root_rolled_back" as const };
  }
  const journal = await readRestoreJournal(dataRoot);
  if (!journal) {
    return { recovered: false, action: "none" as const };
  }
  await assertOwnerControlledPath({
    targetPath: journal.installDirectory,
    rootPath: dataRoot,
    kind: "directory"
  });
  if (journal.phase === "installed") {
    await rm(journal.installDirectory, { recursive: true, force: true });
    await removeRestoreJournal(dataRoot);
    await applyRuntimeRootSwitch(dataRoot, options.secretsManager);
    return { recovered: true, action: "finalized" as const };
  }

  closeDatabase();
  const rollbackDirectory = path.join(journal.installDirectory, "rollback");
  for (const operation of [...journal.operations].reverse()) {
    const currentPath = path.join(dataRoot, operation.name);
    const rollbackPath = path.join(rollbackDirectory, operation.name);
    if (operation.originalExisted) {
      if (existsSync(rollbackPath)) {
        await removeIfExists(currentPath);
        await rename(rollbackPath, currentPath);
      }
    } else {
      await removeIfExists(currentPath);
    }
  }
  await rm(journal.installDirectory, { recursive: true, force: true });
  await removeRestoreJournal(dataRoot);
  await applyRuntimeRootSwitch(dataRoot, options.secretsManager);
  return { recovered: true, action: "rolled_back" as const };
}

export async function switchDataRoot(
  input: SwitchDataRootInput,
  options: SwitchDataRootOptions = {}
): Promise<DataManagementState> {
  const parsed = switchDataRootSchema.parse(input);
  const currentRoot = getEffectiveDataRoot();
  const previousSettings = resolveCurrentDataManagementSettings();
  const targetDataRoot = expandUserPath(parsed.targetDataRoot, currentRoot);
  if (path.resolve(targetDataRoot) === path.resolve(currentRoot)) {
    return getDataManagementState();
  }
  const targetParent = path.dirname(targetDataRoot);
  await mkdir(targetParent, {
    recursive: true,
    mode: PRIVATE_DIRECTORY_MODE
  });
  const targetInspection = await assertSecureDataRootTarget(targetDataRoot, {
    mustExist: parsed.mode === "adopt_existing",
    requireEmpty: parsed.mode === "migrate_current"
  });
  if (parsed.mode === "adopt_existing") {
    await secureAdoptedDatabase(targetDataRoot);
  }
  if (parsed.createSafetyBackup) {
    await createDataBackup(
      { note: `Safety backup before switching Forge to ${targetDataRoot}` },
      { mode: "pre_switch_root" }
    );
  }
  await checkpointCurrentDatabase();
  let journal: SwitchRootJournal = {
    version: 1,
    phase: "prepared",
    mode: parsed.mode,
    currentRoot,
    targetRoot: targetDataRoot,
    targetOriginallyExisted: targetInspection.existed,
    stagingDirectory: null,
    displacedTargetDirectory: null
  };
  if (parsed.mode === "migrate_current") {
    const stagingDirectory = await mkdtemp(
      path.join(targetParent, ".forge-switch-stage-")
    );
    await chmod(stagingDirectory, PRIVATE_DIRECTORY_MODE);
    journal = { ...journal, stagingDirectory };
    try {
      await copyRuntimeAssets(currentRoot, stagingDirectory);
      await syncDirectory(stagingDirectory);
      await writeSwitchRootJournal(journal, [currentRoot]);
      if (targetInspection.existed) {
        const displacedTargetDirectory = path.join(
          targetParent,
          `.forge-switch-original-${randomUUID()}`
        );
        await rename(targetDataRoot, displacedTargetDirectory);
        journal = { ...journal, displacedTargetDirectory };
        await writeSwitchRootJournal(journal, [currentRoot]);
      }
      await rename(stagingDirectory, targetDataRoot);
      journal = { ...journal, stagingDirectory: null };
      await writeSwitchRootJournal(journal, [currentRoot, targetDataRoot]);
      await syncDirectory(targetParent);
    } catch (error) {
      if (existsSync(stagingDirectory)) {
        await rm(stagingDirectory, { recursive: true, force: true });
      }
      if (
        journal.displacedTargetDirectory &&
        existsSync(journal.displacedTargetDirectory) &&
        !existsSync(targetDataRoot)
      ) {
        await rename(journal.displacedTargetDirectory, targetDataRoot);
      }
      await removeSwitchRootJournals([currentRoot, targetDataRoot]);
      throw error;
    }
  } else {
    await writeSwitchRootJournal(journal, [currentRoot, targetDataRoot]);
  }
  try {
    await applyRuntimeRootSwitch(targetDataRoot, options.secretsManager);
    const nextBackupDirectory =
      path.resolve(previousSettings.backupDirectory) ===
      path.resolve(getDefaultBackupDirectory(currentRoot))
        ? getDefaultBackupDirectory(targetDataRoot)
        : previousSettings.backupDirectory;
    writeDataManagementSettingsRow({
      preferred_data_root: targetDataRoot,
      backup_directory: nextBackupDirectory,
      backup_frequency_hours: previousSettings.backupFrequencyHours,
      backup_retention_days: previousSettings.backupRetentionDays,
      auto_repair_enabled: previousSettings.autoRepairEnabled ? 1 : 0
    });
    journal = { ...journal, phase: "activated" };
    await writeSwitchRootJournal(journal, [currentRoot, targetDataRoot]);
    if (options.simulateInterruptionAfterPhase === "activated") {
      throw new Error("simulated data-root switch interruption after activation");
    }
    await (options.persistPreferredDataRoot ?? writeMonorepoPreferredDataRoot)(
      targetDataRoot
    );
    journal = { ...journal, phase: "persisted" };
    await writeSwitchRootJournal(journal, [currentRoot, targetDataRoot]);
    if (options.simulateInterruptionAfterPhase === "persisted") {
      throw new Error("simulated data-root switch interruption after persistence");
    }
    await (options.syncAdapterDataRoots ?? syncLocalAdapterDataRoots)(
      targetDataRoot
    );
    if (
      journal.displacedTargetDirectory &&
      existsSync(journal.displacedTargetDirectory)
    ) {
      await rm(journal.displacedTargetDirectory, {
        recursive: true,
        force: true
      });
    }
    await removeSwitchRootJournals([currentRoot, targetDataRoot]);
    return getDataManagementState();
  } catch (error) {
    if (options.simulateInterruptionAfterPhase === journal.phase) {
      throw error;
    }
    try {
      await rollbackDataRootSwitch(journal, options);
    } catch (rollbackError) {
      throw new HttpError(
        500,
        "switch_data_root_rollback_failed",
        `Forge could not complete or safely roll back the data-root switch: ${
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError)
        }`
      );
    }
    throw error;
  }
}

export async function restoreDataBackup(
  backupId: string,
  input: RestoreDataBackupInput,
  options: {
    secretsManager?: SecretsManager;
    verifyInstalledRuntime?: () => Promise<void> | void;
    simulateInterruptionAfterTarget?: RestoreTargetName;
  } = {}
): Promise<DataManagementState> {
  const parsed = restoreDataBackupSchema.parse(input);
  const backup = (await listDataBackups()).find(
    (entry) => entry.id === backupId
  );
  if (!backup) {
    throw new HttpError(
      404,
      "backup_not_found",
      `Forge could not find backup ${backupId}.`
    );
  }
  if (parsed.createSafetyBackup) {
    await createDataBackup(
      { note: `Safety backup before restoring ${backup.id}` },
      { mode: "pre_restore" }
    );
  }
  const currentRoot = getEffectiveDataRoot();
  const settings = resolveCurrentDataManagementSettings();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "forge-restore-"));
  let installDirectory: string | null = null;
  let preserveRecoveryState = false;
  try {
    await chmod(tempDir, PRIVATE_DIRECTORY_MODE);
    await extractVerifiedBackupArchive({
      backup,
      backupDirectory: settings.backupDirectory,
      targetDirectory: tempDir
    });
    const restoredDatabasePath = path.join(tempDir, "forge.sqlite");
    const candidateDatabase = new DatabaseSync(restoredDatabasePath, {
      readOnly: true
    });
    try {
      const integrity = candidateDatabase
        .prepare("PRAGMA integrity_check")
        .get() as { integrity_check: string };
      if (integrity.integrity_check !== "ok") {
        throw new HttpError(
          400,
          "backup_database_integrity_failed",
          "The selected backup database failed its integrity check."
        );
      }
    } finally {
      candidateDatabase.close();
    }

    installDirectory = await mkdtemp(
      path.join(currentRoot, ".forge-restore-stage-")
    );
    await chmod(installDirectory, PRIVATE_DIRECTORY_MODE);
    const incomingDirectory = path.join(installDirectory, "incoming");
    const rollbackDirectory = path.join(installDirectory, "rollback");
    await mkdir(incomingDirectory, { mode: PRIVATE_DIRECTORY_MODE });
    await mkdir(rollbackDirectory, { mode: PRIVATE_DIRECTORY_MODE });
    await copyIfExists(
      restoredDatabasePath,
      path.join(incomingDirectory, "forge.sqlite")
    );
    await copyIfExists(
      path.join(tempDir, "wiki-ingest"),
      path.join(incomingDirectory, "wiki-ingest")
    );
    await copyIfExists(
      path.join(tempDir, ".forge-secrets.key"),
      path.join(incomingDirectory, ".forge-secrets.key")
    );

    const targets = [
      {
        name: "forge.sqlite",
        replaceWhenMissing: true
      },
      {
        name: "forge.sqlite-wal",
        replaceWhenMissing: true
      },
      {
        name: "forge.sqlite-shm",
        replaceWhenMissing: true
      },
      {
        name: "wiki-ingest",
        replaceWhenMissing: true
      },
      {
        name: ".forge-secrets.key",
        replaceWhenMissing: false
      }
    ] as const;
    await checkpointCurrentDatabase();
    const journal: RestoreJournal = {
      version: 1,
      phase: "prepared",
      dataRoot: currentRoot,
      installDirectory,
      operations: targets.map((target) => ({
        name: target.name,
        originalExisted: existsSync(path.join(currentRoot, target.name)),
        installIncoming: existsSync(
          path.join(incomingDirectory, target.name)
        )
      }))
    };
    await writeRestoreJournal(journal);
    closeDatabase();
    try {
      for (const target of targets) {
        const currentPath = path.join(currentRoot, target.name);
        const incomingPath = path.join(incomingDirectory, target.name);
        const rollbackPath = path.join(rollbackDirectory, target.name);
        if (!existsSync(incomingPath) && !target.replaceWhenMissing) {
          continue;
        }
        if (existsSync(currentPath)) {
          await rename(currentPath, rollbackPath);
        }
        if (existsSync(incomingPath)) {
          await rename(incomingPath, currentPath);
        }
        await syncDirectory(currentRoot);
        await syncDirectory(rollbackDirectory);
        if (options.simulateInterruptionAfterTarget === target.name) {
          preserveRecoveryState = true;
          throw new Error(
            `simulated restore interruption after ${target.name}`
          );
        }
      }
      await applyRuntimeRootSwitch(currentRoot, options.secretsManager);
      await options.verifyInstalledRuntime?.();
    } catch (error) {
      if (preserveRecoveryState) {
        throw error;
      }
      await recoverInterruptedDataRestore({
        secretsManager: options.secretsManager
      });
      installDirectory = null;
      throw error;
    }

    if (!existsSync(path.join(currentRoot, "forge.sqlite"))) {
      throw new HttpError(
        500,
        "backup_restore_install_failed",
        "Forge could not install the restored database."
      );
    }
    await writeRestoreJournal({ ...journal, phase: "installed" });
    await rm(installDirectory, { recursive: true, force: true });
    await removeRestoreJournal(currentRoot);
    installDirectory = null;
    return getDataManagementState();
  } finally {
    if (installDirectory && !preserveRecoveryState) {
      await rm(installDirectory, { recursive: true, force: true });
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function updateDataManagementSettings(
  input: UpdateDataManagementSettingsInput
): Promise<DataManagementSettings> {
  const parsed = updateDataManagementSettingsSchema.parse(input);
  const currentRoot = getEffectiveDataRoot();
  writeDataManagementSettingsRow({
    backup_directory:
      parsed.backupDirectory !== undefined
        ? expandUserPath(parsed.backupDirectory, currentRoot)
        : undefined,
    backup_frequency_hours:
      parsed.backupFrequencyHours !== undefined
        ? parsed.backupFrequencyHours
        : undefined,
    backup_retention_days:
      parsed.backupRetentionDays !== undefined
        ? parsed.backupRetentionDays
        : undefined,
    auto_repair_enabled:
      parsed.autoRepairEnabled !== undefined
        ? parsed.autoRepairEnabled
          ? 1
          : 0
        : undefined
  });
  return resolveCurrentDataManagementSettings();
}

export async function getDataManagementState(): Promise<DataManagementState> {
  return dataManagementStateSchema.parse({
    generatedAt: nowIso(),
    current: await getCurrentDataRuntimeSnapshot(),
    settings: resolveCurrentDataManagementSettings(),
    backups: await listDataBackups(),
    exportOptions: EXPORT_OPTIONS.map((entry) =>
      dataExportOptionSchema.parse(entry)
    )
  });
}

export async function maybeRunAutomaticBackup(): Promise<DataBackupEntry | null> {
  const settings = resolveCurrentDataManagementSettings();
  if (!settings.backupFrequencyHours) {
    return null;
  }
  const lastAuto = settings.lastAutoBackupAt
    ? new Date(settings.lastAutoBackupAt).getTime()
    : 0;
  const dueMs = settings.backupFrequencyHours * 60 * 60 * 1000;
  if (lastAuto !== 0 && Date.now() - lastAuto < dueMs) {
    return null;
  }
  return createDataBackup(
    { note: "Automatic Forge data backup" },
    { mode: "automatic" }
  );
}

export async function exportData(
  format: DataExportFormat
): Promise<ExportPayload> {
  const parsedFormat = dataExportFormatSchema.parse(format);
  const database = getDatabase();
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  if (parsedFormat === "sqlite") {
    const snapshot = await createSqliteSnapshot(database);
    try {
      const body = await readFile(snapshot.snapshotPath);
      return {
        body,
        mimeType: "application/vnd.sqlite3",
        fileName: `forge-${stamp}.sqlite`
      };
    } finally {
      await rm(snapshot.tempDir, { recursive: true, force: true });
    }
  }
  if (parsedFormat === "schema_sql") {
    return {
      body: Buffer.from(buildSchemaSql(database), "utf8"),
      mimeType: "application/sql",
      fileName: `forge-schema-${stamp}.sql`
    };
  }
  if (parsedFormat === "schema_json") {
    return {
      body: Buffer.from(
        JSON.stringify(buildSchemaJson(database), null, 2),
        "utf8"
      ),
      mimeType: "application/json",
      fileName: `forge-schema-${stamp}.json`
    };
  }
  if (parsedFormat === "json") {
    return {
      body: Buffer.from(
        JSON.stringify(buildJsonExport(database), null, 2),
        "utf8"
      ),
      mimeType: "application/json",
      fileName: `forge-export-${stamp}.json`
    };
  }
  const zip = new AdmZip();
  for (const table of listTables(database)) {
    zip.addFile(
      `${table}.csv`,
      Buffer.from(buildCsvForTable(database, table), "utf8")
    );
  }
  zip.addFile(
    "schema.json",
    Buffer.from(JSON.stringify(buildSchemaJson(database), null, 2), "utf8")
  );
  return {
    body: zip.toBuffer(),
    mimeType: "application/zip",
    fileName: `forge-csv-export-${stamp}.zip`
  };
}
