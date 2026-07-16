import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  closeDatabase,
  configureDatabase,
  getDatabase,
  initializeDatabase
} from "./db.js";
import {
  archivePreferenceCatalog,
  createPreferenceCatalog,
  createPreferenceCatalogItem,
  restorePreferenceCatalog
} from "./repositories/preferences.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "../../..");
const databaseModuleUrl = pathToFileURL(path.join(moduleDir, "db.ts")).href;
const repositoryModuleUrl = pathToFileURL(
  path.join(moduleDir, "repositories", "preferences.ts")
).href;
const zeroFeatureWeights = {
  novelty: 0,
  simplicity: 0,
  rigor: 0,
  aesthetics: 0,
  depth: 0,
  structure: 0,
  familiarity: 0,
  surprise: 0
};

type WorkerAction =
  | { kind: "create"; catalogId: string; label: string }
  | { kind: "update"; itemId: string; label: string }
  | { kind: "archiveCatalog"; catalogId: string }
  | { kind: "restoreCatalog"; catalogId: string }
  | { kind: "updateCatalog"; catalogId: string; description: string };

type WorkerResult = {
  ok: boolean;
  id?: string;
  label?: string;
  archived?: boolean;
  description?: string;
  code?: string;
  statusCode?: number;
  message?: string;
};

function spawnPreferenceWorker(dataRoot: string, action: WorkerAction) {
  const script = `
    import { closeDatabase, configureDatabase } from ${JSON.stringify(databaseModuleUrl)};
    import {
      archivePreferenceCatalog,
      createPreferenceCatalogItem,
      restorePreferenceCatalog,
      updatePreferenceCatalog,
      updatePreferenceCatalogItem
    } from ${JSON.stringify(repositoryModuleUrl)};

    configureDatabase({ dataRoot: ${JSON.stringify(dataRoot)} });
    const action = ${JSON.stringify(action)};
    process.stdout.write("READY\\n");
    await new Promise((resolve) => process.stdin.once("data", resolve));
    try {
      let entity;
      switch (action.kind) {
        case "create":
          entity = createPreferenceCatalogItem({
            catalogId: action.catalogId,
            label: action.label
          });
          break;
        case "update":
          entity = updatePreferenceCatalogItem(action.itemId, {
            label: action.label
          });
          break;
        case "archiveCatalog":
          entity = archivePreferenceCatalog(action.catalogId);
          break;
        case "restoreCatalog":
          entity = restorePreferenceCatalog(action.catalogId);
          break;
        case "updateCatalog":
          entity = updatePreferenceCatalog(action.catalogId, {
            description: action.description
          });
          break;
      }
      process.stdout.write("RESULT " + JSON.stringify({
        ok: true,
        id: entity.id,
        label: entity.label,
        archived: entity.archived,
        description: entity.description
      }) + "\\n");
    } catch (error) {
      process.stdout.write("RESULT " + JSON.stringify({
        ok: false,
        code: error?.code,
        statusCode: error?.statusCode,
        message: error instanceof Error ? error.message : String(error)
      }) + "\\n");
    } finally {
      closeDatabase();
    }
  `;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdout = "";
  let stderr = "";
  let readySeen = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    if (!readySeen && stdout.includes("READY\n")) {
      readySeen = true;
      resolveReady();
    }
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const result = new Promise<WorkerResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => {
      if (!readySeen) {
        rejectReady(
          new Error(
            `Preference worker exited before ready: ${stderr || stdout}`
          )
        );
      }
      if (exitCode !== 0) {
        reject(
          new Error(
            `Preference worker exited with ${exitCode}: ${stderr || stdout}`
          )
        );
        return;
      }
      const resultLine = stdout
        .split("\n")
        .find((line) => line.startsWith("RESULT "));
      if (!resultLine) {
        reject(new Error(`Preference worker returned no result: ${stdout}`));
        return;
      }
      resolve(JSON.parse(resultLine.slice("RESULT ".length)) as WorkerResult);
    });
  });

  return {
    ready,
    start() {
      child.stdin.end("go\n");
    },
    result
  };
}

async function runConcurrentActions(
  dataRoot: string,
  leftAction: WorkerAction,
  rightAction: WorkerAction
) {
  const left = spawnPreferenceWorker(dataRoot, leftAction);
  const right = spawnPreferenceWorker(dataRoot, rightAction);
  await Promise.all([left.ready, right.ready]);
  left.start();
  right.start();
  return Promise.all([left.result, right.result]);
}

async function runConcurrentActionsBehindWriteLock(
  dataRoot: string,
  leftAction: WorkerAction,
  rightAction: WorkerAction
) {
  const left = spawnPreferenceWorker(dataRoot, leftAction);
  const right = spawnPreferenceWorker(dataRoot, rightAction);
  await Promise.all([left.ready, right.ready]);
  const database = getDatabase();
  let lockHeld = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    lockHeld = true;
    left.start();
    right.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    database.exec("COMMIT");
    lockHeld = false;
    return await Promise.all([left.result, right.result]);
  } finally {
    if (lockHeld) {
      database.exec("ROLLBACK");
    }
  }
}

function assertOneSuccessAndOneDuplicate(results: WorkerResult[]) {
  assert.equal(results.filter((result) => result.ok).length, 1);
  const conflict = results.find((result) => !result.ok);
  assert.equal(conflict?.statusCode, 409);
  assert.equal(conflict?.code, "preferences_catalog_item_duplicate");
}

test(
  "preference catalog item create and update serialize normalized uniqueness across processes",
  { timeout: 30_000 },
  async () => {
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), "forge-pref-catalog-concurrency-")
    );
    configureDatabase({ dataRoot: rootDir, seedDemoData: true });
    try {
      await initializeDatabase();
      const catalog = createPreferenceCatalog({
        userId: "user_operator",
        domain: "food",
        title: "Concurrent preference writes",
        description: "Exercise SQLite writer serialization.",
        scopeIn: "",
        scopeOut: "",
        links: []
      });

      const createResults = await runConcurrentActions(
        rootDir,
        {
          kind: "create",
          catalogId: catalog.id,
          label: "Concurrent concept"
        },
        {
          kind: "create",
          catalogId: catalog.id,
          label: "  concurrent CONCEPT  "
        }
      );
      assertOneSuccessAndOneDuplicate(createResults);
      const createdId = createResults.find((result) => result.ok)?.id;
      assert.ok(createdId);
      const createdRows = getDatabase()
        .prepare(
          `SELECT preference_catalog_items.id, entity_owners.user_id
           FROM preference_catalog_items
           INNER JOIN entity_owners
             ON entity_owners.entity_type = 'preference_catalog_item'
            AND entity_owners.entity_id = preference_catalog_items.id
           WHERE preference_catalog_items.catalog_id = ?
             AND lower(trim(preference_catalog_items.label)) = lower(trim(?))`
        )
        .all(catalog.id, "Concurrent concept") as Array<{
        id: string;
        user_id: string;
      }>;
      assert.deepEqual(
        createdRows.map((row) => ({ ...row })),
        [{ id: createdId, user_id: "user_operator" }]
      );

      const firstUpdateItem = createPreferenceCatalogItem({
        catalogId: catalog.id,
        label: "Update contender A",
        description: "",
        tags: [],
        featureWeights: zeroFeatureWeights
      });
      const secondUpdateItem = createPreferenceCatalogItem({
        catalogId: catalog.id,
        label: "Update contender B",
        description: "",
        tags: [],
        featureWeights: zeroFeatureWeights
      });
      const updateResults = await runConcurrentActions(
        rootDir,
        {
          kind: "update",
          itemId: firstUpdateItem.id,
          label: "Shared update target"
        },
        {
          kind: "update",
          itemId: secondUpdateItem.id,
          label: "  shared UPDATE target  "
        }
      );
      assertOneSuccessAndOneDuplicate(updateResults);
      const matchingUpdates = getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count
           FROM preference_catalog_items
           WHERE catalog_id = ?
             AND archived = 0
             AND lower(trim(label)) = lower(trim(?))`
        )
        .get(catalog.id, "Shared update target") as { count: number };
      assert.equal(matchingUpdates.count, 1);
    } finally {
      closeDatabase();
      await rm(rootDir, { recursive: true, force: true });
    }
  }
);

test(
  "concurrent catalog archives are idempotent and preserve restore membership",
  { timeout: 30_000 },
  async () => {
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), "forge-pref-catalog-archive-race-")
    );
    configureDatabase({ dataRoot: rootDir, seedDemoData: true });
    try {
      await initializeDatabase();
      const catalog = createPreferenceCatalog({
        userId: "user_operator",
        domain: "food",
        title: "Concurrent catalog archive",
        description: "The concepts must remain restorable.",
        scopeIn: "",
        scopeOut: "",
        links: []
      });
      const itemIds = [
        "First restorable concept",
        "Second restorable concept"
      ].map(
        (label) =>
          createPreferenceCatalogItem({
            catalogId: catalog.id,
            label,
            description: "",
            tags: [],
            featureWeights: zeroFeatureWeights
          }).id
      );

      const results = await runConcurrentActionsBehindWriteLock(
        rootDir,
        { kind: "archiveCatalog", catalogId: catalog.id },
        { kind: "archiveCatalog", catalogId: catalog.id }
      );
      assert.equal(results.filter((result) => result.ok).length, 2);
      assert.ok(results.every((result) => result.archived === true));

      const archiveState = getDatabase()
        .prepare(
          `SELECT
             (SELECT archived FROM preference_catalogs WHERE id = ?) AS catalog_archived,
             (SELECT COUNT(*) FROM preference_catalog_items
               WHERE catalog_id = ? AND archived = 1) AS archived_item_count,
             (SELECT COUNT(*) FROM preference_catalog_archive_members
               WHERE catalog_id = ?) AS restore_member_count`
        )
        .get(catalog.id, catalog.id, catalog.id) as {
        catalog_archived: number;
        archived_item_count: number;
        restore_member_count: number;
      };
      assert.deepEqual(
        { ...archiveState },
        {
          catalog_archived: 1,
          archived_item_count: itemIds.length,
          restore_member_count: itemIds.length
        }
      );

      const restored = restorePreferenceCatalog(catalog.id);
      assert.equal(restored.archived, false);
      assert.deepEqual(
        restored.items.map((item) => item.id).sort(),
        [...itemIds].sort()
      );
      const remainingMembers = getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count
           FROM preference_catalog_archive_members
           WHERE catalog_id = ?`
        )
        .get(catalog.id) as { count: number };
      assert.equal(remainingMembers.count, 0);
    } finally {
      closeDatabase();
      await rm(rootDir, { recursive: true, force: true });
    }
  }
);

test(
  "catalog archive and restore races retain a complete serial state",
  { timeout: 30_000 },
  async () => {
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), "forge-pref-catalog-restore-race-")
    );
    configureDatabase({ dataRoot: rootDir, seedDemoData: true });
    try {
      await initializeDatabase();
      const catalog = createPreferenceCatalog({
        userId: "user_operator",
        domain: "food",
        title: "Concurrent catalog restore",
        description: "Lifecycle data must stay coherent.",
        scopeIn: "",
        scopeOut: "",
        links: []
      });
      const itemIds = ["Restore race A", "Restore race B"].map(
        (label) =>
          createPreferenceCatalogItem({
            catalogId: catalog.id,
            label,
            description: "",
            tags: [],
            featureWeights: zeroFeatureWeights
          }).id
      );
      archivePreferenceCatalog(catalog.id);

      const results = await runConcurrentActionsBehindWriteLock(
        rootDir,
        { kind: "archiveCatalog", catalogId: catalog.id },
        { kind: "restoreCatalog", catalogId: catalog.id }
      );
      assert.equal(results.filter((result) => result.ok).length, 2);

      const state = getDatabase()
        .prepare(
          `SELECT
             (SELECT archived FROM preference_catalogs WHERE id = ?) AS catalog_archived,
             (SELECT COUNT(*) FROM preference_catalog_items
               WHERE catalog_id = ? AND archived = 0) AS active_item_count,
             (SELECT COUNT(*) FROM preference_catalog_items
               WHERE catalog_id = ? AND archived = 1) AS archived_item_count,
             (SELECT COUNT(*) FROM preference_catalog_archive_members
               WHERE catalog_id = ?) AS restore_member_count`
        )
        .get(catalog.id, catalog.id, catalog.id, catalog.id) as {
        catalog_archived: number;
        active_item_count: number;
        archived_item_count: number;
        restore_member_count: number;
      };
      const expected = state.catalog_archived
        ? {
            catalog_archived: 1,
            active_item_count: 0,
            archived_item_count: itemIds.length,
            restore_member_count: itemIds.length
          }
        : {
            catalog_archived: 0,
            active_item_count: itemIds.length,
            archived_item_count: 0,
            restore_member_count: 0
          };
      assert.deepEqual({ ...state }, expected);
    } finally {
      closeDatabase();
      await rm(rootDir, { recursive: true, force: true });
    }
  }
);

test(
  "catalog update and archive races preserve the winning serial state",
  { timeout: 30_000 },
  async () => {
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), "forge-pref-catalog-update-race-")
    );
    configureDatabase({ dataRoot: rootDir, seedDemoData: true });
    try {
      await initializeDatabase();
      const originalDescription = "Description before the race.";
      const updatedDescription = "Description committed before archival.";
      const catalog = createPreferenceCatalog({
        userId: "user_operator",
        domain: "food",
        title: "Concurrent catalog update",
        description: originalDescription,
        scopeIn: "",
        scopeOut: "",
        links: []
      });
      const itemIds = ["Update race A", "Update race B"].map(
        (label) =>
          createPreferenceCatalogItem({
            catalogId: catalog.id,
            label,
            description: "",
            tags: [],
            featureWeights: zeroFeatureWeights
          }).id
      );

      const results = await runConcurrentActionsBehindWriteLock(
        rootDir,
        {
          kind: "updateCatalog",
          catalogId: catalog.id,
          description: updatedDescription
        },
        { kind: "archiveCatalog", catalogId: catalog.id }
      );
      const updateResult = results[0]!;
      const archiveResult = results[1]!;
      assert.equal(archiveResult.ok, true);
      assert.equal(archiveResult.archived, true);
      if (!updateResult.ok) {
        assert.equal(updateResult.statusCode, 404);
        assert.equal(updateResult.code, "preferences_catalog_not_found");
      }

      const state = getDatabase()
        .prepare(
          `SELECT
             (SELECT archived FROM preference_catalogs WHERE id = ?) AS catalog_archived,
             (SELECT description FROM preference_catalogs WHERE id = ?) AS description,
             (SELECT COUNT(*) FROM preference_catalog_items
               WHERE catalog_id = ? AND archived = 1) AS archived_item_count,
             (SELECT COUNT(*) FROM preference_catalog_archive_members
               WHERE catalog_id = ?) AS restore_member_count`
        )
        .get(catalog.id, catalog.id, catalog.id, catalog.id) as {
        catalog_archived: number;
        description: string;
        archived_item_count: number;
        restore_member_count: number;
      };
      assert.deepEqual(
        { ...state },
        {
          catalog_archived: 1,
          description: updateResult.ok
            ? updatedDescription
            : originalDescription,
          archived_item_count: itemIds.length,
          restore_member_count: itemIds.length
        }
      );
    } finally {
      closeDatabase();
      await rm(rootDir, { recursive: true, force: true });
    }
  }
);
