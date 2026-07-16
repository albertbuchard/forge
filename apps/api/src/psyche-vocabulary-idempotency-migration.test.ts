import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migrationName = "097_psyche_vocabulary_terminal_idempotency.sql";

async function applyMigrationsBefore097(database: DatabaseSync) {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file < migrationName)
    .sort();
  for (const file of files) {
    database.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
}

function deterministicVocabularyId(
  prefix: "evt" | "emo",
  ownerUserId: string,
  key: string
) {
  return `${prefix}_${createHash("sha256")
    .update(`${ownerUserId}:${key}`)
    .digest("hex")
    .slice(0, 16)}`;
}

test("migration 097 backfills retry-safe vocabulary and preserves terminal receipts", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-psyche-idempotency-migration-")
  );
  const database = new DatabaseSync(path.join(rootDir, "forge.sqlite"));
  database.exec("PRAGMA foreign_keys = ON");
  try {
    await applyMigrationsBefore097(database);
    const at = "2026-07-16T12:00:00.000Z";
    const eventId = deterministicVocabularyId(
      "evt",
      "user_operator",
      "legacy-event-key"
    );
    const emotionId = deterministicVocabularyId(
      "emo",
      "user_operator",
      "legacy-emotion-key"
    );
    database
      .prepare(
        `INSERT INTO event_types (
           id, domain_id, label, description, system, created_at, updated_at
         ) VALUES (?, 'domain_psyche', 'Legacy rupture', 'Original event payload', 0, ?, ?)`
      )
      .run(eventId, at, at);
    database
      .prepare(
        `INSERT INTO emotion_definitions (
           id, domain_id, label, description, category, system,
           created_at, updated_at
         ) VALUES (?, 'domain_psyche', 'Legacy alarm', 'Original emotion payload',
           'threat', 0, ?, ?)`
      )
      .run(emotionId, at, at);
    database
      .prepare(
        `INSERT INTO event_types (
           id, domain_id, label, description, system, created_at, updated_at
         ) VALUES ('evt_1234567890', 'domain_psyche', 'Random id', '', 0, ?, ?)`
      )
      .run(at, at);
    const insertOwner = database.prepare(
      `INSERT INTO entity_owners (
         entity_type, entity_id, user_id, role, created_at, updated_at
       ) VALUES (?, ?, 'user_operator', 'owner', ?, ?)`
    );
    insertOwner.run("event_type", eventId, at, at);
    insertOwner.run("emotion_definition", emotionId, at, at);
    insertOwner.run("event_type", "evt_1234567890", at, at);

    const migration = await readFile(
      path.join(migrationsDir, migrationName),
      "utf8"
    );
    database.exec(migration);
    database.exec(migration);

    const receipts = database
      .prepare(
        `SELECT owner_user_id, entity_type, idempotency_key,
                request_fingerprint, entity_id, payload_label,
                payload_description, payload_category, lifecycle_state
         FROM psyche_vocabulary_create_idempotency
         ORDER BY entity_type`
      )
      .all();
    assert.deepEqual(
      receipts.map((receipt) => ({ ...receipt })),
      [
        {
          owner_user_id: "user_operator",
          entity_type: "emotion_definition",
          idempotency_key: null,
          request_fingerprint: null,
          entity_id: emotionId,
          payload_label: "Legacy alarm",
          payload_description: "Original emotion payload",
          payload_category: "threat",
          lifecycle_state: "active"
        },
        {
          owner_user_id: "user_operator",
          entity_type: "event_type",
          idempotency_key: null,
          request_fingerprint: null,
          entity_id: eventId,
          payload_label: "Legacy rupture",
          payload_description: "Original event payload",
          payload_category: "",
          lifecycle_state: "active"
        }
      ]
    );

    database
      .prepare(
        `DELETE FROM entity_owners
         WHERE entity_type = 'event_type' AND entity_id = ?`
      )
      .run(eventId);
    database.prepare("DELETE FROM event_types WHERE id = ?").run(eventId);
    const terminal = database
      .prepare(
        `SELECT owner_user_id, entity_id, lifecycle_state,
                deleted_at IS NOT NULL AS has_deleted_at
         FROM psyche_vocabulary_create_idempotency
         WHERE entity_type = 'event_type' AND entity_id = ?`
      )
      .get(eventId);
    assert.deepEqual(
      { ...terminal },
      {
        owner_user_id: "user_operator",
        entity_id: eventId,
        lifecycle_state: "deleted",
        has_deleted_at: 1
      }
    );
  } finally {
    database.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
