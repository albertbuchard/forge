import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  getEffectiveDataRoot,
  initializeDatabase
} from "./db.js";

const migrationName = "121_course_definition_integrity.sql";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

test("migration 121 preserves historical release identities and never blesses later mutations", async () => {
  const originalDataRoot = getEffectiveDataRoot();
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-course-definition-integrity-")
  );
  const now = "2026-08-09T00:00:00.000Z";
  const courseId = "course.migration-integrity-fixture";
  const currentDefinition = JSON.stringify({ version: "2.0.0", lessons: [] });
  const historicalDefinition = JSON.stringify({
    version: "1.0.0",
    lessons: [{ id: "lesson.historical" }]
  });
  configureLegacyWikiAutoImport(false);
  configureDatabase({ dataRoot });

  try {
    await initializeDatabase();
    const database = getDatabase();
    database
      .prepare(
        `INSERT INTO courses (
           id, slug, version, schema_version, title, subtitle, description,
           language, authors_json, license, estimated_weeks,
           minutes_per_week, tags_json, entry_lesson_id,
           featured_lesson_id, source_url, content_hash, definition_json,
           definition_sha256, created_at, updated_at
         ) VALUES (?, ?, '2.0.0', 'forge.course/1', 'Migration fixture', '',
                   'Migration fixture', 'en', '[]', 'CC0-1.0', 1, 30, '[]',
                   'lesson.current', NULL, NULL, ?, ?, NULL, ?, ?)`
      )
      .run(
        courseId,
        "migration-integrity-fixture",
        "a".repeat(64),
        currentDefinition,
        now,
        now
      );
    database
      .prepare(
        `INSERT INTO course_releases (
           course_id, version, content_hash, definition_json,
           definition_sha256, published_at
         ) VALUES (?, '1.0.0', ?, ?, NULL, ?)`
      )
      .run(courseId, "b".repeat(64), historicalDefinition, now);
    database.exec(`
      DROP TRIGGER course_release_definition_integrity_invalidate;
      DROP TRIGGER course_definition_integrity_invalidate;
      ALTER TABLE course_releases DROP COLUMN definition_sha256;
      ALTER TABLE courses DROP COLUMN definition_sha256;
    `);
    database.prepare("DELETE FROM migrations WHERE id = ?").run(migrationName);
    closeDatabase();

    await initializeDatabase();
    const upgraded = getDatabase();
    const course = upgraded
      .prepare(
        `SELECT definition_json, definition_sha256
         FROM courses WHERE id = ?`
      )
      .get(courseId) as {
      definition_json: string;
      definition_sha256: string;
    };
    const historical = upgraded
      .prepare(
        `SELECT definition_json, definition_sha256
         FROM course_releases
         WHERE course_id = ? AND version = '1.0.0'`
      )
      .get(courseId) as {
      definition_json: string;
      definition_sha256: string;
    };
    assert.equal(course.definition_sha256, sha256(currentDefinition));
    assert.equal(historical.definition_sha256, sha256(historicalDefinition));
    assert.deepEqual(JSON.parse(historical.definition_json), {
      version: "1.0.0",
      lessons: [{ id: "lesson.historical" }]
    });

    upgraded
      .prepare(
        `UPDATE course_releases SET definition_json = ?
         WHERE course_id = ? AND version = '1.0.0'`
      )
      .run(JSON.stringify({ version: "1.0.0", tampered: true }), courseId);
    assert.equal(
      (
        upgraded
          .prepare(
            `SELECT definition_sha256 FROM course_releases
             WHERE course_id = ? AND version = '1.0.0'`
          )
          .get(courseId) as { definition_sha256: string | null }
      ).definition_sha256,
      null
    );
    closeDatabase();

    await initializeDatabase();
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT definition_sha256 FROM course_releases
             WHERE course_id = ? AND version = '1.0.0'`
          )
          .get(courseId) as { definition_sha256: string | null }
      ).definition_sha256,
      null
    );
    assert.ok(
      getDatabase()
        .prepare("SELECT 1 FROM migrations WHERE id = ?")
        .get(migrationName)
    );
  } finally {
    closeDatabase();
    configureDatabase({ dataRoot: originalDataRoot });
    configureLegacyWikiAutoImport(true);
    await rm(dataRoot, { recursive: true, force: true });
  }
});
