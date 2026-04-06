import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

function nowIso(): string {
  return new Date().toISOString();
}

function dateOffsetIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationsDir = path.join(projectRoot, "server", "migrations");
const monorepoForgeDataRoot = path.resolve(projectRoot, "..", "..", "data", "forge");

export function resolveDefaultDataRoot(currentWorkingDir = process.cwd()): string {
  const configured = process.env.FORGE_DATA_ROOT?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  // Inside the private monorepo, prefer the tracked shared Forge data root so
  // the local app, Hermes, OpenClaw, and repo-managed data all point at the
  // same state by default.
  if (existsSync(path.join(monorepoForgeDataRoot, "data"))) {
    return monorepoForgeDataRoot;
  }

  return path.resolve(currentWorkingDir);
}

let dataRoot = resolveDefaultDataRoot();
let seedDemoDataEnabled = false;

let db: DatabaseSync | null = null;
let transactionDepth = 0;
let savepointCounter = 0;

function getDataDir(): string {
  return path.join(dataRoot, "data");
}

export function resolveDataDir(): string {
  return getDataDir();
}

function getDatabasePath(): string {
  return path.join(getDataDir(), "forge.sqlite");
}

export function getDatabase(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(getDatabasePath());
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("PRAGMA synchronous = FULL;");
    db.prepare("PRAGMA journal_mode = WAL;").get();
  }
  return db;
}

export function runInTransaction<T>(operation: () => T): T {
  const database = getDatabase();
  const isNested = transactionDepth > 0;
  const savepointName = isNested ? `forge_sp_${++savepointCounter}` : null;
  if (isNested) {
    database.exec(`SAVEPOINT ${savepointName}`);
  } else {
    database.exec("BEGIN IMMEDIATE");
  }
  transactionDepth += 1;
  try {
    const result = operation();
    if (isNested) {
      database.exec(`RELEASE SAVEPOINT ${savepointName}`);
    } else {
      database.exec("COMMIT");
    }
    return result;
  } catch (error) {
    if (isNested) {
      database.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      database.exec(`RELEASE SAVEPOINT ${savepointName}`);
    } else {
      database.exec("ROLLBACK");
    }
    throw error;
  } finally {
    transactionDepth = Math.max(0, transactionDepth - 1);
  }
}

export function configureDatabase(options: { dataRoot?: string; seedDemoData?: boolean } = {}): void {
  if (options.dataRoot) {
    dataRoot = path.resolve(options.dataRoot);
    closeDatabase();
  }
  if (typeof options.seedDemoData === "boolean") {
    seedDemoDataEnabled = options.seedDemoData;
  }
}

async function listMigrationFiles(): Promise<string[]> {
  const files = await readdir(migrationsDir);
  return files.filter((file) => file.endsWith(".sql")).sort();
}

function countRows(tableName: string): number {
  const row = getDatabase().prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as {
    count: number;
  };
  return row.count;
}

function seedData(): void {
  if (countRows("goals") > 0) {
    return;
  }

  const database = getDatabase();
  const now = nowIso();
  const insertGoal = database.prepare(`
    INSERT INTO goals (id, title, description, horizon, status, target_points, theme_color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTag = database.prepare(`
    INSERT INTO tags (id, name, kind, color, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertGoalTag = database.prepare(`
    INSERT INTO goal_tags (goal_id, tag_id)
    VALUES (?, ?)
  `);
  const insertProject = database.prepare(`
    INSERT INTO projects (id, goal_id, title, description, status, theme_color, target_points, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTask = database.prepare(`
    INSERT INTO tasks (
      id, title, description, status, priority, owner, goal_id, project_id, due_date, effort, energy, points, sort_order, completed_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTaskTag = database.prepare(`
    INSERT INTO task_tags (task_id, tag_id)
    VALUES (?, ?)
  `);

  const goals = [
    {
      id: "goal_be_a_good_person",
      title: "Be a good person",
      description: "Live in a way that is kind, honest, and helpful to other people.",
      horizon: "lifetime",
      status: "active",
      targetPoints: 1000,
      themeColor: "#f5efe6"
    },
    {
      id: "goal_build_forge",
      title: "Build Forge into a premium operating system",
      description: "Turn Forge into a sharp, trustworthy life system with strong daily execution.",
      horizon: "year",
      status: "active",
      targetPoints: 720,
      themeColor: "#9dc4ff"
    },
    {
      id: "goal_train_body",
      title: "Train with consistency",
      description: "Keep health, training, and recovery visible in the weekly operating rhythm.",
      horizon: "quarter",
      status: "active",
      targetPoints: 360,
      themeColor: "#f4b97a"
    }
  ];

  for (const goal of goals) {
    insertGoal.run(
      goal.id,
      goal.title,
      goal.description,
      goal.horizon,
      goal.status,
      goal.targetPoints,
      goal.themeColor,
      now,
      now
    );
  }

  const tags = [
    ["tag_vitality", "Vitality", "value", "#f59e0b", "Health, training, and physical energy."],
    ["tag_deep_work", "Deep Work", "execution", "#8b5cf6", "Protected focus and cognitively demanding work."],
    ["tag_relationships", "Relationships", "value", "#ef4444", "Important human connection and maintenance."],
    ["tag_systems", "Systems", "category", "#14b8a6", "Operational scaffolding, review, and maintenance."],
    ["tag_craft", "Craft", "category", "#60a5fa", "Making the product sharper and more intentional."],
    ["tag_recovery", "Recovery", "execution", "#22c55e", "Recovery, decompression, and reset work."]
  ] as const;

  for (const [id, name, kind, color, description] of tags) {
    insertTag.run(id, name, kind, color, description, now);
  }

  insertGoalTag.run("goal_be_a_good_person", "tag_relationships");
  insertGoalTag.run("goal_build_forge", "tag_craft");
  insertGoalTag.run("goal_build_forge", "tag_systems");
  insertGoalTag.run("goal_train_body", "tag_vitality");
  insertGoalTag.run("goal_train_body", "tag_recovery");

  insertProject.run(
    "project_relationships_ritual",
    "goal_be_a_good_person",
    "Keep the relationship ritual visible",
    "Protect simple weekly actions that maintain important relationships and personal integrity.",
    "active",
    "#fb7185",
    90,
    now,
    now
  );
  insertProject.run(
    "project_forge_mobile",
    "goal_build_forge",
    "Ship the Forge flagship workflow",
    "Tighten the main execution loop, Kanban, and OpenClaw collaboration surface.",
    "active",
    "#7dd3fc",
    240,
    now,
    now
  );
  insertProject.run(
    "project_strength_cycle",
    "goal_train_body",
    "Run the current strength cycle",
    "Keep the training block visible with recovery and progression.",
    "active",
    "#f59e0b",
    120,
    now,
    now
  );

  const tasks = [
    {
      id: "task_flagship_review",
      title: "Review the Forge flagship flow",
      description: "Walk Overview, Today, Kanban, and Psyche to identify friction before the next pass.",
      status: "focus",
      priority: "high",
      owner: "Albert",
      goalId: "goal_build_forge",
      projectId: "project_forge_mobile",
      dueDate: dateOffsetIso(1),
      effort: "deep",
      energy: "high",
      points: 55,
      sortOrder: 100,
      completedAt: null
    },
    {
      id: "task_plugin_surface",
      title: "Slim the OpenClaw plugin surface",
      description: "Keep the plugin focused on overview, batch entities, insights, and UI entry.",
      status: "in_progress",
      priority: "high",
      owner: "Albert",
      goalId: "goal_build_forge",
      projectId: "project_forge_mobile",
      dueDate: dateOffsetIso(0),
      effort: "deep",
      energy: "high",
      points: 34,
      sortOrder: 200,
      completedAt: null
    },
    {
      id: "task_weekly_review",
      title: "Prepare the weekly review ritual",
      description: "Make sure the review captures drift, signals, and visible wins.",
      status: "backlog",
      priority: "medium",
      owner: "Albert",
      goalId: "goal_be_a_good_person",
      projectId: "project_relationships_ritual",
      dueDate: dateOffsetIso(3),
      effort: "deep",
      energy: "steady",
      points: 21,
      sortOrder: 300,
      completedAt: null
    },
    {
      id: "task_strength_session",
      title: "Complete the lower-body strength session",
      description: "Keep the training cycle alive with one deliberate session.",
      status: "blocked",
      priority: "medium",
      owner: "Albert",
      goalId: "goal_train_body",
      projectId: "project_strength_cycle",
      dueDate: dateOffsetIso(-1),
      effort: "deep",
      energy: "steady",
      points: 18,
      sortOrder: 400,
      completedAt: null
    },
    {
      id: "task_recovery_walk",
      title: "Take the recovery walk",
      description: "Short reset to keep energy stable after the work block.",
      status: "done",
      priority: "low",
      owner: "Albert",
      goalId: "goal_train_body",
      projectId: "project_strength_cycle",
      dueDate: dateOffsetIso(-2),
      effort: "light",
      energy: "low",
      points: 60,
      sortOrder: 500,
      completedAt: now
    }
  ];

  for (const task of tasks) {
    insertTask.run(
      task.id,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.owner,
      task.goalId,
      task.projectId,
      task.dueDate,
      task.effort,
      task.energy,
      task.points,
      task.sortOrder,
      task.completedAt,
      now,
      now
    );
  }

  const taskTags = [
    ["task_flagship_review", "tag_deep_work"],
    ["task_flagship_review", "tag_craft"],
    ["task_plugin_surface", "tag_systems"],
    ["task_plugin_surface", "tag_craft"],
    ["task_weekly_review", "tag_relationships"],
    ["task_strength_session", "tag_vitality"],
    ["task_recovery_walk", "tag_recovery"]
  ] as const;

  for (const [taskId, tagId] of taskTags) {
    insertTaskTag.run(taskId, tagId);
  }
}

export async function initializeDatabase(): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
  const database = getDatabase();
  const migrationFiles = await listMigrationFiles();

  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = database
    .prepare("SELECT id FROM migrations ORDER BY id")
    .all() as Array<{ id: string }>;
  const applied = new Set(appliedRows.map((row) => row.id));

  for (const file of migrationFiles) {
    if (applied.has(file)) {
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    database.exec("BEGIN");
    try {
      database.exec(sql);
      database
        .prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)")
        .run(file, nowIso());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  if (seedDemoDataEnabled) {
    seedData();
  }
}

export function configureDatabaseSeeding(enabled: boolean): void {
  seedDemoDataEnabled = enabled;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
