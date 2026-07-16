import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migrationName = "091_task_timebox_adversarial_hardening.sql";

async function applyMigrationsBefore091(database: DatabaseSync) {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file < migrationName)
    .sort();
  for (const file of files) {
    database.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
}

test("migration 091 repairs stale task-timebox project and owner state without deleting records", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-plan10-migration-")
  );
  const database = new DatabaseSync(path.join(rootDir, "forge.sqlite"));
  database.exec("PRAGMA foreign_keys = ON");
  try {
    await applyMigrationsBefore091(database);
    const timestamp = "2031-05-01T12:00:00.000Z";
    database
      .prepare(
        `INSERT INTO goals (
           id, title, description, horizon, status, target_points, theme_color, created_at, updated_at
         ) VALUES ('goal_plan10_migration', 'Migration goal', '', 'year', 'active', 1, '#336699', ?, ?)`
      )
      .run(timestamp, timestamp);
    for (const projectId of ["project_plan10_old", "project_plan10_new"]) {
      database
        .prepare(
          `INSERT INTO projects (
             id, goal_id, title, description, status, theme_color, target_points, created_at, updated_at
           ) VALUES (?, 'goal_plan10_migration', ?, '', 'active', '#336699', 1, ?, ?)`
        )
        .run(projectId, projectId, timestamp, timestamp);
    }
    database
      .prepare(
        `INSERT INTO tasks (
           id, title, description, status, priority, owner, goal_id, project_id,
           due_date, effort, energy, points, sort_order, created_at, updated_at
         ) VALUES (
           'task_plan10_migration', 'Migration task', '', 'focus', 'medium', 'Operator',
           'goal_plan10_migration', 'project_plan10_new', NULL, 'medium', 'medium', 1, 0, ?, ?
         )`
      )
      .run(timestamp, timestamp);
    database
      .prepare(
        `INSERT INTO entity_owners (
           entity_type, entity_id, user_id, role, created_at, updated_at
         ) VALUES ('task', 'task_plan10_migration', 'user_operator', 'owner', ?, ?)`
      )
      .run(timestamp, timestamp);
    database
      .prepare(
        `INSERT INTO task_timeboxes (
           id, task_id, project_id, status, source, title, starts_at, ends_at, created_at, updated_at
         ) VALUES (
           'timebox_plan10_migration', 'task_plan10_migration', 'project_plan10_old',
           'planned', 'manual', 'Stale timebox', '2031-05-02T09:00:00.000Z',
           '2031-05-02T10:00:00.000Z', ?, ?
         )`
      )
      .run(timestamp, timestamp);

    database.exec(
      await readFile(path.join(migrationsDir, migrationName), "utf8")
    );

    const timebox = database
      .prepare(
        `SELECT project_id, deletion_requested_at
         FROM task_timeboxes
         WHERE id = 'timebox_plan10_migration'`
      )
      .get() as {
      project_id: string | null;
      deletion_requested_at: string | null;
    };
    assert.deepEqual(
      { ...timebox },
      { project_id: "project_plan10_new", deletion_requested_at: null }
    );
    const owner = database
      .prepare(
        `SELECT user_id FROM entity_owners
         WHERE entity_type = 'task_timebox' AND entity_id = 'timebox_plan10_migration'`
      )
      .get() as { user_id: string };
    assert.equal(owner.user_id, "user_operator");
    const operation = database
      .prepare(
        `SELECT operation, state
         FROM task_timebox_provider_operations
         WHERE timebox_id = 'timebox_plan10_migration'`
      )
      .get() as { operation: string; state: string };
    assert.deepEqual(
      { ...operation },
      { operation: "upsert", state: "pending" }
    );
    const searchPlan = database
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id
         FROM task_timeboxes
         WHERE rowid IN (
           SELECT rowid
           FROM task_timebox_search
           WHERE task_timebox_search MATCH ?
         )
         LIMIT 25`
      )
      .all('"stale"*') as Array<{ detail: string }>;
    assert.ok(
      searchPlan.some((step) =>
        step.detail.toLowerCase().includes("virtual table index")
      ),
      JSON.stringify(searchPlan)
    );
    const countSearchMatches = (query: string) =>
      Number(
        (
          database
            .prepare(
              `SELECT COUNT(*) AS count
               FROM task_timebox_search
               WHERE task_timebox_search MATCH ?`
            )
            .get(query) as { count: number }
        ).count
      );
    assert.equal(countSearchMatches('"stale"*'), 1);
    database
      .prepare(
        `UPDATE task_timeboxes SET title = 'Indexed rename'
         WHERE id = 'timebox_plan10_migration'`
      )
      .run();
    assert.equal(countSearchMatches('"stale"*'), 0);
    assert.equal(countSearchMatches('"indexed"*'), 1);
    database
      .prepare(
        `INSERT INTO task_timeboxes (
           id, task_id, project_id, status, source, title, starts_at, ends_at, created_at, updated_at
         ) VALUES (
           'timebox_plan10_search_delete', 'task_plan10_migration', 'project_plan10_new',
           'planned', 'manual', 'Disposable search row', '2031-05-03T09:00:00.000Z',
           '2031-05-03T10:00:00.000Z', ?, ?
         )`
      )
      .run(timestamp, timestamp);
    assert.equal(countSearchMatches('"disposable"*'), 1);
    database
      .prepare(
        `DELETE FROM task_timeboxes WHERE id = 'timebox_plan10_search_delete'`
      )
      .run();
    assert.equal(countSearchMatches('"disposable"*'), 0);
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM task_timeboxes
           WHERE id = 'timebox_plan10_migration'`
        )
        .get()!.count,
      1
    );
  } finally {
    database.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
