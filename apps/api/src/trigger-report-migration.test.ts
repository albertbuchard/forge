import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migrationName = "092_trigger_report_story_contract.sql";

async function applyMigrationsBefore092(database: DatabaseSync) {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file < migrationName)
    .sort();
  for (const file of files) {
    database.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
}

test("migration 092 preserves trigger reports and backfills canonical links", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-trigger-report-migration-")
  );
  const database = new DatabaseSync(path.join(rootDir, "forge.sqlite"));
  database.exec("PRAGMA foreign_keys = ON");

  try {
    await applyMigrationsBefore092(database);
    const timestamp = "2026-07-15T09:00:00.000Z";
    database.exec(`
      INSERT INTO event_types (
        id, domain_id, label, created_at, updated_at
      ) VALUES (
        'event_trigger_migration', 'domain_psyche', 'Preserved event',
        '${timestamp}', '${timestamp}'
      );
      INSERT INTO behavior_patterns (
        id, domain_id, title, created_at, updated_at
      ) VALUES (
        'pattern_trigger_migration', 'domain_psyche', 'Preserved pattern',
        '${timestamp}', '${timestamp}'
      );
      INSERT INTO psyche_values (
        id, domain_id, title, created_at, updated_at
      ) VALUES (
        'value_trigger_migration', 'domain_psyche', 'Preserved value',
        '${timestamp}', '${timestamp}'
      );
      INSERT INTO goals (
        id, title, description, horizon, status, target_points, theme_color,
        created_at, updated_at
      ) VALUES (
        'goal_trigger_migration', 'Preserved goal', '', 'year', 'active', 1,
        '#336699', '${timestamp}', '${timestamp}'
      );
      INSERT INTO projects (
        id, goal_id, title, status, theme_color, target_points,
        created_at, updated_at
      ) VALUES (
        'project_trigger_migration', 'goal_trigger_migration',
        'Preserved project', 'active', '#336699', 1,
        '${timestamp}', '${timestamp}'
      );
      INSERT INTO tasks (
        id, title, status, priority, owner, goal_id, project_id, effort,
        energy, points, sort_order, created_at, updated_at
      ) VALUES (
        'task_trigger_migration', 'Preserved task', 'backlog', 'medium',
        'Operator', 'goal_trigger_migration', 'project_trigger_migration',
        'medium', 'focus', 1, 0, '${timestamp}', '${timestamp}'
      );
      INSERT INTO psyche_behaviors (
        id, domain_id, kind, title, created_at, updated_at
      ) VALUES (
        'behavior_trigger_migration', 'domain_psyche', 'away',
        'Preserved behavior', '${timestamp}', '${timestamp}'
      );
      INSERT INTO belief_entries (
        id, domain_id, statement, belief_type, created_at, updated_at
      ) VALUES (
        'belief_trigger_migration', 'domain_psyche', 'Preserved belief',
        'absolute', '${timestamp}', '${timestamp}'
      );
      INSERT INTO mode_profiles (
        id, domain_id, family, title, created_at, updated_at
      ) VALUES (
        'mode_trigger_migration', 'domain_psyche', 'coping',
        'Preserved mode', '${timestamp}', '${timestamp}'
      );
      INSERT INTO emotion_definitions (
        id, domain_id, label, created_at, updated_at
      ) VALUES (
        'emotion_trigger_migration', 'domain_psyche', 'Preserved emotion',
        '${timestamp}', '${timestamp}'
      );
    `);
    database
      .prepare(
        `INSERT INTO trigger_reports (
          id, domain_id, title, status, event_type_id, custom_event_type,
          event_situation, occurred_at, emotions_json, thoughts_json,
          behaviors_json, consequences_json, linked_pattern_ids_json,
          linked_value_ids_json, linked_goal_ids_json,
          linked_project_ids_json, linked_task_ids_json,
          linked_behavior_ids_json, linked_belief_ids_json,
          linked_mode_ids_json, mode_overlays_json, schema_links_json,
          mode_timeline_json, next_moves_json, created_at, updated_at
        ) VALUES (
          'trigger_pre092', 'domain_psyche', 'Preserved episode', 'draft',
          'event_trigger_migration', '', 'A legacy situation', ?,
          '[{"emotionDefinitionId":"emotion_trigger_migration"},{"emotionDefinitionId":"emotion_trigger_migration"}]',
          '[{"beliefId":"belief_trigger_migration"}]',
          '[{"behaviorId":"behavior_trigger_migration"}]',
          '{"selfShortTerm":[],"selfLongTerm":[],"othersShortTerm":[],"othersLongTerm":[]}',
          '["pattern_trigger_migration","pattern_trigger_migration","pattern_missing"]',
          '["value_trigger_migration"]',
          '["goal_trigger_migration"]',
          '["project_trigger_migration"]',
          '["task_trigger_migration"]',
          '["behavior_trigger_migration"]',
          '["belief_trigger_migration"]',
          '["mode_trigger_migration"]',
          '[]', '[]',
          '[{"modeId":"mode_trigger_migration"}]',
          '[]', ?, ?
        )`
      )
      .run(timestamp, timestamp, timestamp);
    database.exec(`
      INSERT INTO trigger_reports (
        id, domain_id, title, event_type_id, emotions_json, thoughts_json,
        behaviors_json, linked_pattern_ids_json, linked_value_ids_json,
        linked_goal_ids_json, linked_project_ids_json, linked_task_ids_json,
        linked_behavior_ids_json, linked_belief_ids_json,
        linked_mode_ids_json, mode_timeline_json, created_at, updated_at
      ) VALUES (
        'trigger_pre092_malformed', 'domain_psyche', 'Malformed legacy episode',
        NULL, '{', '{', '{', '{', '{', '{', '{', '{', '{', '{', '{', '{',
        '${timestamp}', '${timestamp}'
      );
      INSERT INTO trigger_reports (
        id, domain_id, title, event_type_id, emotions_json, thoughts_json,
        behaviors_json, linked_pattern_ids_json, linked_value_ids_json,
        linked_goal_ids_json, linked_project_ids_json, linked_task_ids_json,
        linked_behavior_ids_json, linked_belief_ids_json,
        linked_mode_ids_json, mode_timeline_json, created_at, updated_at
      ) VALUES (
        'trigger_pre092_mixed', 'domain_psyche', 'Mixed legacy episode', NULL,
        '["bad",7,null,{"emotionDefinitionId":"emotion_trigger_migration"}]',
        '["bad",7,null,{"beliefId":"belief_trigger_migration"}]',
        '["bad",7,null,{"behaviorId":"behavior_trigger_migration"}]',
        '[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]',
        '["bad",7,null,{"modeId":"mode_trigger_migration"}]',
        '${timestamp}', '${timestamp}'
      );
    `);
    database
      .prepare(
        `INSERT INTO entity_owners (
          entity_type, entity_id, user_id, role, created_at, updated_at
        ) VALUES (
          'trigger_report', 'trigger_pre092', 'user_operator', 'owner', ?, ?
        )`
      )
      .run(timestamp, timestamp);

    const countBefore = (
      database
        .prepare("SELECT COUNT(*) AS count FROM trigger_reports")
        .get() as { count: number }
    ).count;
    const migrationSql = await readFile(
      path.join(migrationsDir, migrationName),
      "utf8"
    );
    database.exec(migrationSql);

    const row = database
      .prepare(
        `SELECT
          title, event_situation, body_cues_json, memory_clarity, reflection,
          hypothesis, hypothesis_fit, hypothesis_correction,
          interpretation_consent, revision
         FROM trigger_reports
         WHERE id = 'trigger_pre092'`
      )
      .get() as Record<string, unknown>;
    assert.deepEqual(
      { ...row },
      {
        title: "Preserved episode",
        event_situation: "A legacy situation",
        body_cues_json: "[]",
        memory_clarity: "unspecified",
        reflection: "",
        hypothesis: "",
        hypothesis_fit: "not_reviewed",
        hypothesis_correction: "",
        interpretation_consent: 0,
        revision: 1
      }
    );
    const countAfter = (
      database
        .prepare("SELECT COUNT(*) AS count FROM trigger_reports")
        .get() as { count: number }
    ).count;
    assert.equal(countAfter, countBefore);
    const links = database
      .prepare(
        `SELECT target_entity_type, target_entity_id, relationship
         FROM entity_links
         WHERE source_entity_type = 'trigger_report'
           AND source_entity_id = 'trigger_pre092'
         ORDER BY target_entity_type, target_entity_id, relationship`
      )
      .all() as Array<{
      target_entity_type: string;
      target_entity_id: string;
      relationship: string;
    }>;
    assert.deepEqual(
      links.map((link) => ({ ...link })),
      [
        ["behavior", "behavior_trigger_migration", "behavior_context"],
        ["behavior", "behavior_trigger_migration", "observed_behavior"],
        ["behavior_pattern", "pattern_trigger_migration", "pattern_context"],
        ["belief_entry", "belief_trigger_migration", "belief_context"],
        ["belief_entry", "belief_trigger_migration", "thought_belief"],
        ["emotion_definition", "emotion_trigger_migration", "emotion_context"],
        ["event_type", "event_trigger_migration", "event_context"],
        ["goal", "goal_trigger_migration", "goal_context"],
        ["mode_profile", "mode_trigger_migration", "mode_context"],
        ["mode_profile", "mode_trigger_migration", "mode_timeline"],
        ["project", "project_trigger_migration", "project_context"],
        ["psyche_value", "value_trigger_migration", "value_context"],
        ["task", "task_trigger_migration", "task_context"]
      ].map(([target_entity_type, target_entity_id, relationship]) => ({
        target_entity_type,
        target_entity_id,
        relationship
      }))
    );
    const malformedLinkCount = (
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM entity_links
           WHERE source_entity_type = 'trigger_report'
             AND source_entity_id = 'trigger_pre092_malformed'`
        )
        .get() as { count: number }
    ).count;
    assert.equal(malformedLinkCount, 0);
    const mixedLinks = database
      .prepare(
        `SELECT target_entity_type, target_entity_id, relationship
         FROM entity_links
         WHERE source_entity_type = 'trigger_report'
           AND source_entity_id = 'trigger_pre092_mixed'
         ORDER BY target_entity_type, target_entity_id, relationship`
      )
      .all() as Array<{
      target_entity_type: string;
      target_entity_id: string;
      relationship: string;
    }>;
    assert.deepEqual(
      mixedLinks.map((link) => ({ ...link })),
      [
        ["behavior", "behavior_trigger_migration", "observed_behavior"],
        ["belief_entry", "belief_trigger_migration", "thought_belief"],
        ["emotion_definition", "emotion_trigger_migration", "emotion_context"],
        ["mode_profile", "mode_trigger_migration", "mode_timeline"]
      ].map(([target_entity_type, target_entity_id, relationship]) => ({
        target_entity_type,
        target_entity_id,
        relationship
      }))
    );
    const linkCountBeforeReplay = (
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM entity_links
           WHERE source_entity_type = 'trigger_report'`
        )
        .get() as { count: number }
    ).count;
    const backfillOffset = migrationSql.indexOf(
      "INSERT OR IGNORE INTO entity_links"
    );
    assert.ok(backfillOffset >= 0);
    database.exec(migrationSql.slice(backfillOffset));
    const linkCountAfterReplay = (
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM entity_links
           WHERE source_entity_type = 'trigger_report'`
        )
        .get() as { count: number }
    ).count;
    assert.equal(linkCountAfterReplay, linkCountBeforeReplay);
    const indexNames = (
      database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index'
             AND name = 'idx_trigger_reports_created_page'`
        )
        .all() as Array<{ name: string }>
    ).map((entry) => entry.name);
    assert.deepEqual(indexNames, ["idx_trigger_reports_created_page"]);
    const receiptTable = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name = 'trigger_report_create_idempotency'`
      )
      .get() as { name: string } | undefined;
    assert.equal(receiptTable?.name, "trigger_report_create_idempotency");
  } finally {
    database.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
