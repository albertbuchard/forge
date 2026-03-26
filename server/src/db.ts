import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationsDir = path.join(projectRoot, "server", "migrations");

let dataRoot = process.cwd();

let db: DatabaseSync | null = null;
let transactionDepth = 0;
let savepointCounter = 0;

function getDataDir(): string {
  return path.join(dataRoot, "data");
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

export function configureDatabase(options: { dataRoot?: string } = {}): void {
  if (options.dataRoot) {
    dataRoot = path.resolve(options.dataRoot);
    closeDatabase();
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

  const tags = [
    { id: makeId("tag"), name: "Vitality", kind: "value", color: "#d6b98a", description: "Energy, health, and body stewardship." },
    { id: makeId("tag"), name: "Craft", kind: "value", color: "#f5efe6", description: "Deliberate skill building and quality." },
    { id: makeId("tag"), name: "Relationships", kind: "value", color: "#7dd3fc", description: "Shared presence, trust, and love." },
    { id: makeId("tag"), name: "Deep Work", kind: "execution", color: "#f97316", description: "Protected focus blocks and cognitively hard work." },
    { id: makeId("tag"), name: "Admin", kind: "category", color: "#71717a", description: "Operational tasks that keep life moving." },
    { id: makeId("tag"), name: "Momentum", kind: "execution", color: "#34d399", description: "Fast wins that keep the board moving." },
    { id: makeId("tag"), name: "Reflection", kind: "category", color: "#a78bfa", description: "Review, journaling, and strategy." },
    { id: makeId("tag"), name: "Health", kind: "category", color: "#ef4444", description: "Training, food, and recovery." }
  ];

  const insertTag = database.prepare(`
    INSERT INTO tags (id, name, kind, color, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const tag of tags) {
    insertTag.run(tag.id, tag.name, tag.kind, tag.color, tag.description, now);
  }

  const goals = [
    {
      id: makeId("goal"),
      title: "Build a durable body and calm energy",
      description: "Train, recover, and keep health rituals consistent enough that energy becomes an asset, not a bottleneck.",
      horizon: "year",
      status: "active",
      targetPoints: 480,
      themeColor: "#d6b98a",
      tagNames: ["Vitality", "Health"]
    },
    {
      id: makeId("goal"),
      title: "Ship meaningful creative work every week",
      description: "Turn strategic creative goals into visible output with protected deep-work blocks and honest review loops.",
      horizon: "quarter",
      status: "active",
      targetPoints: 520,
      themeColor: "#f5efe6",
      tagNames: ["Craft", "Deep Work", "Reflection"]
    },
    {
      id: makeId("goal"),
      title: "Strengthen shared life systems",
      description: "Reduce drag in shared obligations and keep admin, planning, and relationship care from slipping.",
      horizon: "year",
      status: "active",
      targetPoints: 360,
      themeColor: "#7dd3fc",
      tagNames: ["Relationships", "Admin", "Momentum"]
    }
  ] as const;

  const insertGoal = database.prepare(`
    INSERT INTO goals (id, title, description, horizon, status, target_points, theme_color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertGoalTag = database.prepare(`
    INSERT INTO goal_tags (goal_id, tag_id)
    VALUES (?, ?)
  `);

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
    for (const tagName of goal.tagNames) {
      const tag = tags.find((entry) => entry.name === tagName);
      if (tag) {
        insertGoalTag.run(goal.id, tag.id);
      }
    }
  }

  const tasks = [
    {
      title: "Lock four training sessions into the next 10 days",
      description: "Schedule sessions, recovery windows, and prep checklist so the week starts with certainty.",
      status: "focus",
      priority: "high",
      owner: "Albert",
      goalTitle: "Build a durable body and calm energy",
      dueDate: "2026-03-24",
      effort: "deep",
      energy: "steady",
      points: 65,
      projectTitle: "Energy Foundation Sprint",
      tagNames: ["Vitality", "Health", "Momentum"]
    },
    {
      title: "Draft the premium weekly review ritual",
      description: "Create a short review format that reconnects finished tasks to life goals and next moves.",
      status: "in_progress",
      priority: "critical",
      owner: "Aurel",
      goalTitle: "Ship meaningful creative work every week",
      dueDate: "2026-03-23",
      effort: "deep",
      energy: "high",
      points: 90,
      projectTitle: "Weekly Creative Shipping System",
      tagNames: ["Craft", "Reflection", "Deep Work"]
    },
    {
      title: "Consolidate shared bills and admin follow-ups",
      description: "Clear the lingering small obligations and tag what should be automated next.",
      status: "backlog",
      priority: "medium",
      owner: "Albert",
      goalTitle: "Strengthen shared life systems",
      dueDate: "2026-03-28",
      effort: "light",
      energy: "low",
      points: 35,
      projectTitle: "Shared Life Admin Reset",
      tagNames: ["Admin", "Relationships"]
    },
    {
      title: "Finish movement session and recovery log",
      description: "Complete the session, note soreness/energy, and mark the habit chain cleanly.",
      status: "done",
      priority: "high",
      owner: "Albert",
      goalTitle: "Build a durable body and calm energy",
      dueDate: "2026-03-21",
      effort: "deep",
      energy: "steady",
      points: 55,
      projectTitle: "Energy Foundation Sprint",
      completedAt: "2026-03-21T17:10:00.000Z",
      tagNames: ["Vitality", "Health"]
    },
    {
      title: "Prepare relationship night plan",
      description: "Choose the plan, reserve time, and remove logistics from the weekend.",
      status: "blocked",
      priority: "medium",
      owner: "Aurel",
      goalTitle: "Strengthen shared life systems",
      dueDate: "2026-03-26",
      effort: "light",
      energy: "steady",
      points: 45,
      projectTitle: "Shared Life Admin Reset",
      tagNames: ["Relationships", "Momentum"]
    }
  ] as const;

  const goalByTitle = new Map(goals.map((goal) => [goal.title, goal.id]));
  const projects = [
    {
      id: makeId("project"),
      goalTitle: "Build a durable body and calm energy",
      title: "Energy Foundation Sprint",
      description: "Build the routines, scheduling, and recovery rhythm that make consistent physical energy possible.",
      status: "active",
      themeColor: "#d6b98a",
      targetPoints: 240
    },
    {
      id: makeId("project"),
      goalTitle: "Ship meaningful creative work every week",
      title: "Weekly Creative Shipping System",
      description: "Create a repeatable system for deep work, reviews, and visible weekly output.",
      status: "active",
      themeColor: "#f5efe6",
      targetPoints: 260
    },
    {
      id: makeId("project"),
      goalTitle: "Strengthen shared life systems",
      title: "Shared Life Admin Reset",
      description: "Reduce friction in logistics, planning, and recurring obligations that support shared life.",
      status: "active",
      themeColor: "#7dd3fc",
      targetPoints: 180
    }
  ] as const;
  const tagByName = new Map(tags.map((tag) => [tag.name, tag.id]));
  const projectByTitle = new Map(projects.map((project) => [project.title, project.id]));
  const insertProject = database.prepare(`
    INSERT INTO projects (id, goal_id, title, description, status, theme_color, target_points, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTask = database.prepare(`
    INSERT INTO tasks (
      id, title, description, status, priority, owner, goal_id, project_id, due_date, effort, energy, points, sort_order,
      completed_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTaskTag = database.prepare(`
    INSERT INTO task_tags (task_id, tag_id)
    VALUES (?, ?)
  `);

  for (const project of projects) {
    insertProject.run(
      project.id,
      goalByTitle.get(project.goalTitle) ?? null,
      project.title,
      project.description,
      project.status,
      project.themeColor,
      project.targetPoints,
      now,
      now
    );
  }

  tasks.forEach((task, index) => {
    const taskId = makeId("task");
    insertTask.run(
      taskId,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.owner,
      goalByTitle.get(task.goalTitle) ?? null,
      projectByTitle.get(task.projectTitle) ?? null,
      task.dueDate,
      task.effort,
      task.energy,
      task.points,
      index,
      ("completedAt" in task ? task.completedAt : null) ?? null,
      now,
      now
    );
    for (const tagName of task.tagNames) {
      const tagId = tagByName.get(tagName);
      if (tagId) {
        insertTaskTag.run(taskId, tagId);
      }
    }
  });
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

  seedData();
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
