import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import AdmZip from "adm-zip";
import { closeDatabase, configureDatabase, getDatabase, getEffectiveDataRoot, initializeDatabase, resolveDatabasePathForDataRoot } from "../db.js";
import { HttpError } from "../errors.js";
import { createDataBackupSchema, dataBackupEntrySchema, dataBackupModeSchema, dataExportFormatSchema, dataExportOptionSchema, dataManagementSettingsSchema, dataManagementStateSchema, dataRecoveryCandidateSchema, dataRuntimeSnapshotSchema, restoreDataBackupSchema, switchDataRootSchema, updateDataManagementSettingsSchema } from "../data-management-types.js";
import { syncLocalAdapterDataRoots, writeMonorepoPreferredDataRoot } from "../runtime-data-root.js";
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
        description: "A zip archive with one CSV per table for spreadsheet workflows.",
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
        description: "Structured database schema metadata for tooling and inspection.",
        mimeType: "application/json",
        extension: "json"
    }
];
const SKIP_SCAN_DIRECTORIES = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    "backups"
]);
function nowIso() {
    return new Date().toISOString();
}
function expandUserPath(value, baseDir = getEffectiveDataRoot()) {
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
        .prepare(`INSERT OR IGNORE INTO data_management_settings (
        id,
        preferred_data_root,
        backup_directory,
        backup_frequency_hours,
        auto_repair_enabled,
        last_auto_backup_at,
        last_manual_backup_at,
        created_at,
        updated_at
      ) VALUES (1, ?, ?, NULL, 1, NULL, NULL, ?, ?)`)
        .run(dataRoot, backupDirectory, now, now);
}
function readDataManagementSettingsRow() {
    ensureDataManagementSettingsRow();
    return getDatabase()
        .prepare(`SELECT
        preferred_data_root,
        backup_directory,
        backup_frequency_hours,
        auto_repair_enabled,
        last_auto_backup_at,
        last_manual_backup_at,
        created_at,
        updated_at
      FROM data_management_settings
      WHERE id = 1`)
        .get();
}
function writeDataManagementSettingsRow(patch) {
    const current = readDataManagementSettingsRow();
    const next = {
        ...current,
        updated_at: nowIso()
    };
    for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) {
            next[key] = value;
        }
    }
    getDatabase()
        .prepare(`UPDATE data_management_settings
       SET preferred_data_root = ?,
           backup_directory = ?,
           backup_frequency_hours = ?,
           auto_repair_enabled = ?,
           last_auto_backup_at = ?,
           last_manual_backup_at = ?,
           updated_at = ?
       WHERE id = 1`)
        .run(next.preferred_data_root, next.backup_directory, next.backup_frequency_hours, next.auto_repair_enabled, next.last_auto_backup_at, next.last_manual_backup_at, next.updated_at);
}
function resolveCurrentDataManagementSettings() {
    const row = readDataManagementSettingsRow();
    const preferredDataRoot = row.preferred_data_root.trim() || getEffectiveDataRoot();
    const backupDirectory = row.backup_directory.trim() || getDefaultBackupDirectory(preferredDataRoot);
    return dataManagementSettingsSchema.parse({
        preferredDataRoot,
        backupDirectory,
        backupFrequencyHours: row.backup_frequency_hours,
        autoRepairEnabled: row.auto_repair_enabled === 1,
        lastAutoBackupAt: row.last_auto_backup_at,
        lastManualBackupAt: row.last_manual_backup_at
    });
}
function quoteSqlString(value) {
    return `'${value.replaceAll("'", "''")}'`;
}
function detectLayoutForDatabasePath(databasePath) {
    if (!databasePath) {
        return "missing";
    }
    if (path.basename(path.dirname(databasePath)) === "data") {
        return "legacy";
    }
    return "flat";
}
function deriveDataRootFromDatabasePath(databasePath) {
    const layout = detectLayoutForDatabasePath(databasePath);
    if (layout === "legacy") {
        return path.dirname(path.dirname(databasePath));
    }
    return path.dirname(databasePath);
}
function emptyCounts() {
    return {
        notes: 0,
        goals: 0,
        projects: 0,
        tasks: 0,
        taskRuns: 0,
        tags: 0
    };
}
function countRowsInDatabase(database, table) {
    try {
        const row = database
            .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
            .get();
        return row.count;
    }
    catch {
        return 0;
    }
}
function collectCountsFromDatabase(database) {
    return {
        notes: countRowsInDatabase(database, "notes"),
        goals: countRowsInDatabase(database, "goals"),
        projects: countRowsInDatabase(database, "projects"),
        tasks: countRowsInDatabase(database, "tasks"),
        taskRuns: countRowsInDatabase(database, "task_runs"),
        tags: countRowsInDatabase(database, "tags")
    };
}
function checkIntegrity(database) {
    try {
        const row = database
            .prepare("PRAGMA quick_check;")
            .get();
        const value = row ? Object.values(row)[0] : "ok";
        return {
            integrityOk: value === "ok",
            integrityMessage: value ?? "ok"
        };
    }
    catch (error) {
        return {
            integrityOk: false,
            integrityMessage: error instanceof Error ? error.message : String(error)
        };
    }
}
async function statFileIfExists(filePath) {
    try {
        return await stat(filePath);
    }
    catch {
        return null;
    }
}
export async function getCurrentDataRuntimeSnapshot() {
    const dataRoot = getEffectiveDataRoot();
    const databasePath = resolveDatabasePathForDataRoot(dataRoot);
    const databaseStat = await statFileIfExists(databasePath);
    const database = getDatabase();
    const integrity = checkIntegrity(database);
    return dataRuntimeSnapshotSchema.parse({
        dataRoot,
        databasePath,
        layout: databaseStat ? detectLayoutForDatabasePath(databasePath) : "missing",
        databaseSizeBytes: databaseStat?.size ?? 0,
        databaseLastModifiedAt: databaseStat?.mtime.toISOString() ?? null,
        integrityOk: integrity.integrityOk,
        integrityMessage: integrity.integrityMessage,
        counts: collectCountsFromDatabase(database)
    });
}
function listTables(database) {
    return database
        .prepare(`SELECT name
         FROM sqlite_schema
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name`)
        .all().map((row) => row.name);
}
function buildSchemaSql(database) {
    const rows = database
        .prepare(`SELECT sql
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
         name`)
        .all();
    return rows.map((row) => `${row.sql};`).join("\n\n");
}
function buildSchemaJson(database) {
    const tables = listTables(database).map((table) => {
        const columns = database.prepare(`PRAGMA table_info(${quoteSqlString(table)});`).all().map((column) => ({
            cid: column.cid,
            name: column.name,
            type: column.type,
            notNull: column.notnull === 1,
            defaultValue: column.dflt_value,
            primaryKeyPosition: column.pk
        }));
        const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${quoteSqlString(table)});`).all().map((foreignKey) => ({
            id: foreignKey.id,
            sequence: foreignKey.seq,
            table: foreignKey.table,
            from: foreignKey.from,
            to: foreignKey.to,
            onUpdate: foreignKey.on_update,
            onDelete: foreignKey.on_delete
        }));
        const indexes = database.prepare(`PRAGMA index_list(${quoteSqlString(table)});`).all().map((index) => ({
            sequence: index.seq,
            name: index.name,
            unique: index.unique === 1,
            origin: index.origin,
            partial: index.partial === 1,
            columns: database.prepare(`PRAGMA index_info(${quoteSqlString(index.name)});`).all().map((column) => ({
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
function buildJsonExport(database) {
    const tables = listTables(database);
    const payload = Object.fromEntries(tables.map((table) => {
        const rows = database.prepare(`SELECT * FROM ${table}`).all();
        return [table, rows];
    }));
    return {
        generatedAt: nowIso(),
        tables: payload
    };
}
function csvEscape(value) {
    if (value === null || value === undefined) {
        return "";
    }
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    if (/[",\n]/.test(raw)) {
        return `"${raw.replaceAll('"', '""')}"`;
    }
    return raw;
}
function buildCsvForTable(database, table) {
    const rows = database.prepare(`SELECT * FROM ${table}`).all();
    if (rows.length === 0) {
        return "";
    }
    const headers = Object.keys(rows[0]);
    return [
        headers.join(","),
        ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
    ].join("\n");
}
async function createSqliteSnapshot(database) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "forge-sqlite-export-"));
    const snapshotPath = path.join(tempDir, "forge.sqlite");
    database.exec(`VACUUM INTO ${quoteSqlString(snapshotPath)};`);
    return {
        tempDir,
        snapshotPath
    };
}
async function removeIfExists(targetPath) {
    try {
        await rm(targetPath, { recursive: true, force: true });
    }
    catch {
        // Ignore cleanup failures for missing files.
    }
}
async function copyIfExists(sourcePath, targetPath) {
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
    }
    catch {
        // The runtime can continue even if checkpointing fails.
    }
}
function buildBackupBaseName(createdAt, id) {
    return `forge-backup-${createdAt.replaceAll(/[:.]/g, "-")}-${id}`;
}
function manifestPathForBaseName(backupDirectory, baseName) {
    return path.join(backupDirectory, `${baseName}.manifest.json`);
}
function archivePathForBaseName(backupDirectory, baseName) {
    return path.join(backupDirectory, `${baseName}.zip`);
}
export async function listDataBackups() {
    const settings = resolveCurrentDataManagementSettings();
    await mkdir(settings.backupDirectory, { recursive: true });
    const entries = await readdir(settings.backupDirectory);
    const manifests = entries
        .filter((entry) => entry.endsWith(".manifest.json"))
        .sort()
        .reverse();
    const backups = [];
    for (const manifestName of manifests) {
        const manifestPath = path.join(settings.backupDirectory, manifestName);
        try {
            const raw = await readFile(manifestPath, "utf8");
            backups.push(dataBackupEntrySchema.parse(JSON.parse(raw)));
        }
        catch {
            // Ignore malformed backup manifests so one bad file does not break the page.
        }
    }
    return backups;
}
export async function createDataBackup(input = {}, options = {}) {
    const parsed = createDataBackupSchema.parse(input);
    const mode = dataBackupModeSchema.parse(options.mode ?? "manual");
    const settings = resolveCurrentDataManagementSettings();
    const snapshot = await getCurrentDataRuntimeSnapshot();
    await mkdir(settings.backupDirectory, { recursive: true });
    const backupId = `bkp_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const createdAt = nowIso();
    const baseName = buildBackupBaseName(createdAt, backupId);
    const archivePath = archivePathForBaseName(settings.backupDirectory, baseName);
    const manifestPath = manifestPathForBaseName(settings.backupDirectory, baseName);
    const database = getDatabase();
    const sqliteSnapshot = await createSqliteSnapshot(database);
    try {
        const zip = new AdmZip();
        zip.addLocalFile(sqliteSnapshot.snapshotPath, "", "forge.sqlite");
        zip.addFile("schema.sql", Buffer.from(buildSchemaSql(database), "utf8"));
        zip.addFile("schema.json", Buffer.from(JSON.stringify(buildSchemaJson(database), null, 2), "utf8"));
        zip.addFile("snapshot-summary.json", Buffer.from(JSON.stringify({
            generatedAt: createdAt,
            mode,
            note: parsed.note,
            current: snapshot
        }, null, 2), "utf8"));
        const currentRoot = getEffectiveDataRoot();
        const wikiPath = path.join(currentRoot, "wiki");
        if (existsSync(wikiPath)) {
            zip.addLocalFolder(wikiPath, "wiki");
        }
        const wikiIngestPath = path.join(currentRoot, "wiki-ingest");
        if (existsSync(wikiIngestPath)) {
            zip.addLocalFolder(wikiIngestPath, "wiki-ingest");
        }
        const secretsKeyPath = path.join(currentRoot, ".forge-secrets.key");
        if (existsSync(secretsKeyPath)) {
            zip.addLocalFile(secretsKeyPath, "", ".forge-secrets.key");
        }
        zip.writeZip(archivePath);
        const archiveStat = await stat(archivePath);
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
            includesWiki: existsSync(wikiPath),
            includesSecretsKey: existsSync(secretsKeyPath),
            counts: snapshot.counts
        });
        await writeFile(manifestPath, `${JSON.stringify(backup, null, 2)}\n`, "utf8");
        if (mode === "manual") {
            writeDataManagementSettingsRow({ last_manual_backup_at: createdAt });
        }
        if (mode === "automatic") {
            writeDataManagementSettingsRow({ last_auto_backup_at: createdAt });
        }
        return backup;
    }
    finally {
        await rm(sqliteSnapshot.tempDir, { recursive: true, force: true });
    }
}
async function openDatabaseSnapshot(databasePath) {
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA busy_timeout = 250;");
    return database;
}
async function inspectDatabaseCandidate(databasePath, current) {
    const dbStat = await statFileIfExists(databasePath);
    if (!dbStat) {
        return null;
    }
    const database = await openDatabaseSnapshot(databasePath);
    try {
        const integrity = checkIntegrity(database);
        const counts = collectCountsFromDatabase(database);
        const dataRoot = deriveDataRootFromDatabasePath(databasePath);
        const sameAsCurrent = path.resolve(dataRoot) === path.resolve(current.dataRoot);
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
            newerThanCurrent: (current.databaseLastModifiedAt
                ? dbStat.mtime.getTime() > new Date(current.databaseLastModifiedAt).getTime()
                : true) && !sameAsCurrent,
            sameAsCurrent
        });
    }
    finally {
        database.close();
    }
}
function gatherScanRoots(explicitRoots) {
    if (explicitRoots && explicitRoots.length > 0) {
        return Array.from(new Set(explicitRoots.map((entry) => path.resolve(entry)))).filter((entry) => existsSync(entry));
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
    return Array.from(new Set(roots.map((entry) => path.resolve(entry)))).filter((entry) => existsSync(entry));
}
function walkForForgeSqlite(rootDir, maxDepth = 5) {
    const matches = [];
    const visit = (dir, depth) => {
        if (depth > maxDepth) {
            return;
        }
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        }
        catch {
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
export async function scanForDataRecoveryCandidates(options = {}) {
    const current = await getCurrentDataRuntimeSnapshot();
    const candidates = new Map();
    for (const scanRoot of gatherScanRoots(options.roots)) {
        for (const databasePath of walkForForgeSqlite(scanRoot, options.maxDepth ?? 5)) {
            const candidate = await inspectDatabaseCandidate(databasePath, current);
            if (!candidate) {
                continue;
            }
            if (candidate.counts.notes === 0 && candidate.counts.goals === 0 && candidate.counts.tasks === 0) {
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
function runtimeAssetPaths(dataRoot) {
    const resolvedRoot = path.resolve(dataRoot);
    return {
        dataRoot: resolvedRoot,
        databasePath: resolveDatabasePathForDataRoot(resolvedRoot),
        wikiPath: path.join(resolvedRoot, "wiki"),
        wikiIngestPath: path.join(resolvedRoot, "wiki-ingest"),
        secretsKeyPath: path.join(resolvedRoot, ".forge-secrets.key")
    };
}
async function copyRuntimeAssets(sourceRoot, targetRoot) {
    const source = runtimeAssetPaths(sourceRoot);
    const target = runtimeAssetPaths(targetRoot);
    await mkdir(target.dataRoot, { recursive: true });
    if (existsSync(target.databasePath) || existsSync(target.wikiPath) || existsSync(target.secretsKeyPath)) {
        throw new HttpError(409, "target_data_root_not_empty", `Forge found existing runtime data under ${target.dataRoot}. Pick another folder or adopt the existing runtime instead.`);
    }
    await copyIfExists(source.databasePath, target.databasePath);
    await copyIfExists(source.wikiPath, target.wikiPath);
    await copyIfExists(source.wikiIngestPath, target.wikiIngestPath);
    await copyIfExists(source.secretsKeyPath, target.secretsKeyPath);
}
async function applyRuntimeRootSwitch(targetDataRoot, secretsManager) {
    closeDatabase();
    configureDatabase({ dataRoot: targetDataRoot });
    await initializeDatabase();
    secretsManager?.configure(targetDataRoot);
}
export async function switchDataRoot(input, options = {}) {
    const parsed = switchDataRootSchema.parse(input);
    const currentRoot = getEffectiveDataRoot();
    const previousSettings = resolveCurrentDataManagementSettings();
    const targetDataRoot = expandUserPath(parsed.targetDataRoot, currentRoot);
    if (path.resolve(targetDataRoot) === path.resolve(currentRoot)) {
        return getDataManagementState();
    }
    if (parsed.createSafetyBackup) {
        await createDataBackup({ note: `Safety backup before switching Forge to ${targetDataRoot}` }, { mode: "pre_switch_root" });
    }
    await checkpointCurrentDatabase();
    if (parsed.mode === "migrate_current") {
        await copyRuntimeAssets(currentRoot, targetDataRoot);
    }
    else {
        const existingDatabasePath = resolveDatabasePathForDataRoot(targetDataRoot);
        if (!existsSync(existingDatabasePath)) {
            throw new HttpError(404, "target_data_root_missing", `Forge could not find an existing database under ${targetDataRoot}.`);
        }
    }
    await applyRuntimeRootSwitch(targetDataRoot, options.secretsManager);
    const nextBackupDirectory = path.resolve(previousSettings.backupDirectory) ===
        path.resolve(getDefaultBackupDirectory(currentRoot))
        ? getDefaultBackupDirectory(targetDataRoot)
        : previousSettings.backupDirectory;
    writeDataManagementSettingsRow({
        preferred_data_root: targetDataRoot,
        backup_directory: nextBackupDirectory,
        backup_frequency_hours: previousSettings.backupFrequencyHours,
        auto_repair_enabled: previousSettings.autoRepairEnabled ? 1 : 0
    });
    await (options.persistPreferredDataRoot ?? writeMonorepoPreferredDataRoot)(targetDataRoot);
    await (options.syncAdapterDataRoots ?? syncLocalAdapterDataRoots)(targetDataRoot);
    return getDataManagementState();
}
export async function restoreDataBackup(backupId, input, options = {}) {
    const parsed = restoreDataBackupSchema.parse(input);
    const backup = (await listDataBackups()).find((entry) => entry.id === backupId);
    if (!backup) {
        throw new HttpError(404, "backup_not_found", `Forge could not find backup ${backupId}.`);
    }
    if (parsed.createSafetyBackup) {
        await createDataBackup({ note: `Safety backup before restoring ${backup.id}` }, { mode: "pre_restore" });
    }
    const currentRoot = getEffectiveDataRoot();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "forge-restore-"));
    try {
        const zip = new AdmZip(backup.archivePath);
        zip.extractAllTo(tempDir, true);
        const restoredDatabasePath = path.join(tempDir, "forge.sqlite");
        if (!existsSync(restoredDatabasePath)) {
            throw new HttpError(500, "backup_missing_database", "The selected backup archive does not contain a forge.sqlite snapshot.");
        }
        await checkpointCurrentDatabase();
        closeDatabase();
        await removeIfExists(path.join(currentRoot, "forge.sqlite"));
        await removeIfExists(path.join(currentRoot, "forge.sqlite-wal"));
        await removeIfExists(path.join(currentRoot, "forge.sqlite-shm"));
        await removeIfExists(path.join(currentRoot, "wiki"));
        await removeIfExists(path.join(currentRoot, "wiki-ingest"));
        const restoredSecretsPath = path.join(tempDir, ".forge-secrets.key");
        if (existsSync(restoredSecretsPath)) {
            await removeIfExists(path.join(currentRoot, ".forge-secrets.key"));
        }
        await copyIfExists(restoredDatabasePath, path.join(currentRoot, "forge.sqlite"));
        await copyIfExists(path.join(tempDir, "wiki"), path.join(currentRoot, "wiki"));
        await copyIfExists(path.join(tempDir, "wiki-ingest"), path.join(currentRoot, "wiki-ingest"));
        await copyIfExists(restoredSecretsPath, path.join(currentRoot, ".forge-secrets.key"));
        await applyRuntimeRootSwitch(currentRoot, options.secretsManager);
        return getDataManagementState();
    }
    finally {
        await rm(tempDir, { recursive: true, force: true });
    }
}
export async function updateDataManagementSettings(input) {
    const parsed = updateDataManagementSettingsSchema.parse(input);
    const currentRoot = getEffectiveDataRoot();
    writeDataManagementSettingsRow({
        backup_directory: parsed.backupDirectory !== undefined
            ? expandUserPath(parsed.backupDirectory, currentRoot)
            : undefined,
        backup_frequency_hours: parsed.backupFrequencyHours !== undefined
            ? parsed.backupFrequencyHours
            : undefined,
        auto_repair_enabled: parsed.autoRepairEnabled !== undefined
            ? parsed.autoRepairEnabled
                ? 1
                : 0
            : undefined
    });
    return resolveCurrentDataManagementSettings();
}
export async function getDataManagementState() {
    return dataManagementStateSchema.parse({
        generatedAt: nowIso(),
        current: await getCurrentDataRuntimeSnapshot(),
        settings: resolveCurrentDataManagementSettings(),
        backups: await listDataBackups(),
        exportOptions: EXPORT_OPTIONS.map((entry) => dataExportOptionSchema.parse(entry))
    });
}
export async function maybeRunAutomaticBackup() {
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
    return createDataBackup({ note: "Automatic Forge data backup" }, { mode: "automatic" });
}
export async function exportData(format) {
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
        }
        finally {
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
            body: Buffer.from(JSON.stringify(buildSchemaJson(database), null, 2), "utf8"),
            mimeType: "application/json",
            fileName: `forge-schema-${stamp}.json`
        };
    }
    if (parsedFormat === "json") {
        return {
            body: Buffer.from(JSON.stringify(buildJsonExport(database), null, 2), "utf8"),
            mimeType: "application/json",
            fileName: `forge-export-${stamp}.json`
        };
    }
    const zip = new AdmZip();
    for (const table of listTables(database)) {
        zip.addFile(`${table}.csv`, Buffer.from(buildCsvForTable(database, table), "utf8"));
    }
    zip.addFile("schema.json", Buffer.from(JSON.stringify(buildSchemaJson(database), null, 2), "utf8"));
    return {
        body: zip.toBuffer(),
        mimeType: "application/zip",
        fileName: `forge-csv-export-${stamp}.zip`
    };
}
