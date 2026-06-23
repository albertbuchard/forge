import path from "node:path";
import {
  closeDatabase,
  configureDatabase,
  configureDatabaseSeeding,
  getDatabase,
  initializeDatabase,
  resolveDatabasePathForDataRoot
} from "./db.js";

const PERSONAL_CONTENT_TABLES = [
  "goals",
  "projects",
  "tasks",
  "task_runs",
  "notes",
  "insights",
  "psyche_values",
  "belief_entries",
  "psyche_behaviors",
  "behavior_patterns",
  "mode_profiles",
  "trigger_reports"
] as const;

export type DemoSeedSummary = {
  dataRoot: string;
  databasePath: string;
  counts: Record<(typeof PERSONAL_CONTENT_TABLES)[number], number>;
};

function countRows(tableName: (typeof PERSONAL_CONTENT_TABLES)[number]) {
  const row = getDatabase().prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
  return row.count;
}

function getCounts(): DemoSeedSummary["counts"] {
  return Object.fromEntries(PERSONAL_CONTENT_TABLES.map((tableName) => [tableName, countRows(tableName)])) as DemoSeedSummary["counts"];
}

export async function seedDemoDataIntoRuntime(dataRoot = process.env.FORGE_DATA_ROOT ?? process.cwd()): Promise<DemoSeedSummary> {
  const resolvedDataRoot = path.resolve(dataRoot);
  const databasePath = resolveDatabasePathForDataRoot(resolvedDataRoot);

  closeDatabase();
  configureDatabase({ dataRoot: resolvedDataRoot });
  configureDatabaseSeeding(false);
  await initializeDatabase();

  const existingCounts = getCounts();
  const hasPersonalContent = Object.values(existingCounts).some((count) => count > 0);
  if (hasPersonalContent) {
    closeDatabase();
    throw new Error(
      `Refusing to seed demo data into a non-empty Forge runtime at ${databasePath}. Use a fresh FORGE_DATA_ROOT instead.`
    );
  }

  closeDatabase();
  configureDatabase({ dataRoot: resolvedDataRoot });
  configureDatabaseSeeding(true);
  await initializeDatabase();

  const counts = getCounts();
  closeDatabase();
  configureDatabaseSeeding(false);

  return {
    dataRoot: resolvedDataRoot,
    databasePath,
    counts
  };
}
