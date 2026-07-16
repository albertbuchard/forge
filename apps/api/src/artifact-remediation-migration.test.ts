import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migrationName = "096_artifact_cleanup_and_snapshot_sanitization.sql";

async function applyMigrationsBefore096(database: DatabaseSync) {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file < migrationName)
    .sort();
  for (const file of files) {
    database.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
}

test("migration 096 adds the private cleanup journal and sanitizes legacy Artifact persistence", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-remediation-migration-")
  );
  const database = new DatabaseSync(path.join(rootDir, "forge.sqlite"));
  database.exec("PRAGMA foreign_keys = ON");
  try {
    await applyMigrationsBefore096(database);
    const at = "2026-07-16T12:00:00.000Z";
    const rawProviderBody = "upstream-secret-response-84729";
    const storageKey = "sha256/aa/bb/legacy-sensitive.bin";
    database
      .prepare(
        `INSERT INTO artifact_blobs (
           content_sha256, storage_key, byte_size, detected_mime_type, created_at
         ) VALUES ('legacy-sensitive-hash', ?, 4, 'text/plain', ?)`
      )
      .run(storageKey, at);
    database
      .prepare(
        `INSERT INTO artifacts (
           id, title, original_file_name, storage_key, storage_path,
           content_sha256, byte_size, detected_extension, detected_mime_type,
           format_family, enrichment_results_json, created_at, updated_at
         ) VALUES (
           'artifact_legacy_sensitive', 'Legacy evidence', 'legacy.txt', ?, ?,
           'legacy-sensitive-hash', 4, 'txt', 'text/plain', 'text', ?, ?, ?
         )`
      )
      .run(
        storageKey,
        path.join(rootDir, "artifacts", "blobs", "legacy-sensitive.bin"),
        JSON.stringify({
          generated: false,
          status: "failed",
          error: `OpenAI failed: ${rawProviderBody}`
        }),
        at,
        at
      );
    database
      .prepare(
        `INSERT INTO artifact_versions (
           id, artifact_id, version_number, content_sha256, storage_key,
           byte_size, original_file_name, enrichment_results_json, created_at
         ) VALUES (
           'artifact_version_legacy_sensitive', 'artifact_legacy_sensitive', 1,
           'legacy-sensitive-hash', ?, 4, 'legacy.txt', ?, ?
         )`
      )
      .run(
        storageKey,
        JSON.stringify({ status: "failed", error: rawProviderBody }),
        at
      );
    database
      .prepare(
        `INSERT INTO deleted_entities (
           entity_type, entity_id, title, deleted_at, deleted_source,
           snapshot_json
         ) VALUES ('artifact', 'artifact_deleted_sensitive', 'Deleted evidence',
           ?, 'system', ?)`
      )
      .run(
        at,
        JSON.stringify({
          id: "artifact_deleted_sensitive",
          title: "Deleted evidence",
          storageKey,
          storagePath: "/private/legacy/artifact.bin",
          contentProtection: { mode: "plaintext" },
          scanResults: {
            extractedTextSample: "legacy extracted plaintext",
            extractedTextTruncated: false
          },
          enrichmentResults: {
            status: "failed",
            error: rawProviderBody
          },
          metadata: { retained: true }
        })
      );
    database
      .prepare(
        `INSERT INTO artifact_audit_events (
           id, artifact_id, event_type, source, metadata_json, created_at
         ) VALUES (
           'artifact_audit_legacy_sensitive', 'artifact_legacy_sensitive',
           'artifact.enrichment_failed', 'system', ?, ?
         )`
      )
      .run(
        JSON.stringify({ storageKey, error: rawProviderBody, retained: true }),
        at
      );
    database
      .prepare(
        `INSERT INTO event_log (
           id, event_kind, entity_type, entity_id, source, metadata_json, created_at
         ) VALUES (
           'log_artifact_legacy_sensitive', 'artifact.enrichment_failed',
           'artifact', 'artifact_legacy_sensitive', 'system', ?, ?
         )`
      )
      .run(
        JSON.stringify({
          storagePath: "/private/legacy",
          error: rawProviderBody
        }),
        at
      );

    const migrationSql = await readFile(
      path.join(migrationsDir, migrationName),
      "utf8"
    );
    database.exec(migrationSql);
    const firstState = JSON.stringify({
      artifact: database
        .prepare(
          "SELECT enrichment_results_json FROM artifacts WHERE id = 'artifact_legacy_sensitive'"
        )
        .get(),
      version: database
        .prepare(
          "SELECT enrichment_results_json FROM artifact_versions WHERE id = 'artifact_version_legacy_sensitive'"
        )
        .get(),
      deleted: database
        .prepare(
          "SELECT snapshot_json FROM deleted_entities WHERE entity_type = 'artifact' AND entity_id = 'artifact_deleted_sensitive'"
        )
        .get(),
      audit: database
        .prepare(
          "SELECT metadata_json FROM artifact_audit_events WHERE id = 'artifact_audit_legacy_sensitive'"
        )
        .get(),
      event: database
        .prepare(
          "SELECT metadata_json FROM event_log WHERE id = 'log_artifact_legacy_sensitive'"
        )
        .get()
    });
    database.exec(migrationSql);
    const secondState = JSON.stringify({
      artifact: database
        .prepare(
          "SELECT enrichment_results_json FROM artifacts WHERE id = 'artifact_legacy_sensitive'"
        )
        .get(),
      version: database
        .prepare(
          "SELECT enrichment_results_json FROM artifact_versions WHERE id = 'artifact_version_legacy_sensitive'"
        )
        .get(),
      deleted: database
        .prepare(
          "SELECT snapshot_json FROM deleted_entities WHERE entity_type = 'artifact' AND entity_id = 'artifact_deleted_sensitive'"
        )
        .get(),
      audit: database
        .prepare(
          "SELECT metadata_json FROM artifact_audit_events WHERE id = 'artifact_audit_legacy_sensitive'"
        )
        .get(),
      event: database
        .prepare(
          "SELECT metadata_json FROM event_log WHERE id = 'log_artifact_legacy_sensitive'"
        )
        .get()
    });

    assert.equal(secondState, firstState);
    assert.equal(firstState.includes(rawProviderBody), false);
    assert.equal(firstState.includes(storageKey), false);
    assert.equal(firstState.includes("/private/legacy"), false);
    assert.equal(firstState.includes("legacy extracted plaintext"), false);
    assert.equal(firstState.includes("artifact_llm_enrichment_failed"), true);
    const deleted = JSON.parse(
      (
        database
          .prepare(
            "SELECT snapshot_json FROM deleted_entities WHERE entity_type = 'artifact' AND entity_id = 'artifact_deleted_sensitive'"
          )
          .get() as { snapshot_json: string }
      ).snapshot_json
    ) as Record<string, unknown>;
    assert.equal(deleted.title, "Deleted evidence");
    assert.deepEqual(deleted.metadata, { retained: true });
    assert.equal(
      (deleted.scanResults as Record<string, unknown>).extractedTextAvailable,
      true
    );
    assert.equal(
      (
        database.prepare("SELECT COUNT(*) AS count FROM artifacts").get() as {
          count: number;
        }
      ).count,
      1
    );
    assert.equal(
      (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM artifact_pending_blob_cleanups"
          )
          .get() as { count: number }
      ).count,
      0
    );
  } finally {
    database.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
