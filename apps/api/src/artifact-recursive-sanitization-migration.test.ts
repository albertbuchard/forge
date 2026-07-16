import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migrationName =
  "098_artifact_recursive_sanitization_and_blob_retention.sql";

async function applyMigrationsBefore098(database: DatabaseSync) {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file < migrationName)
    .sort();
  for (const file of files) {
    database.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
}

test("migration 098 recursively sanitizes legacy Artifact JSON and records retention", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-recursive-migration-")
  );
  const database = new DatabaseSync(path.join(rootDir, "forge.sqlite"));
  database.exec("PRAGMA foreign_keys = ON");
  try {
    await applyMigrationsBefore098(database);
    const at = "2026-07-16T12:00:00.000Z";
    const secret = "nested-private-provider-context-98421";
    const storageKey = "sha256/aa/bb/retained-legacy.bin";
    const nestedFailure = {
      status: "failed",
      attempts: [
        {
          providerError: {
            message: secret,
            responseBody: secret,
            stackTrace: secret
          },
          retained: true
        }
      ]
    };
    database
      .prepare(
        `INSERT INTO artifact_blobs (
           content_sha256, storage_key, byte_size, detected_mime_type, created_at
         ) VALUES ('legacy-retained-hash', ?, 4, 'text/plain', ?)`
      )
      .run(storageKey, at);
    database
      .prepare(
        `INSERT INTO artifact_blobs (
           content_sha256, storage_key, byte_size, detected_mime_type, created_at
         ) VALUES (
           'current-hash', 'sha256/current.bin', 4, 'text/plain', ?
         )`
      )
      .run(at);
    database
      .prepare(
        `INSERT INTO artifacts (
           id, title, original_file_name, storage_key, storage_path,
           content_sha256, byte_size, detected_extension, detected_mime_type,
           format_family, scan_results_json, enrichment_results_json,
           metadata_json, created_at, updated_at
         ) VALUES (
           'artifact_nested_legacy', 'Nested legacy', 'legacy.txt',
           'sha256/current.bin', '/private/current.bin', 'current-hash', 4,
           'txt', 'text/plain', 'text', ?, ?, ?, ?, ?
         )`
      )
      .run(
        JSON.stringify({
          nested: [{ extracted_text_sample: "nested plaintext" }]
        }),
        JSON.stringify(nestedFailure),
        JSON.stringify({
          nested: {
            storage_path: "/private/nested.bin",
            retained: true
          }
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
           'artifact_version_nested_legacy', 'artifact_nested_legacy', 1,
           'current-hash', 'sha256/current.bin', 4, 'legacy.txt', ?, ?
         )`
      )
      .run(JSON.stringify({ nested: [{ errorContext: nestedFailure }] }), at);
    database
      .prepare(
        `INSERT INTO artifact_audit_events (
           id, artifact_id, event_type, source, metadata_json, created_at
         ) VALUES (
           'artifact_audit_nested_legacy', 'artifact_nested_legacy',
           'artifact.enrichment_failed', 'system', ?, ?
         )`
      )
      .run(
        JSON.stringify({
          nested: [{ rawProviderOutput: secret, retained: true }]
        }),
        at
      );
    database
      .prepare(
        `INSERT INTO deleted_entities (
           entity_type, entity_id, title, deleted_at, deleted_source,
           snapshot_json
         ) VALUES (
           'artifact', 'artifact_deleted_nested_legacy', 'Deleted nested',
           ?, 'system', ?
         )`
      )
      .run(
        at,
        JSON.stringify({
          id: "artifact_deleted_nested_legacy",
          nested: [
            {
              blobPath: "/private/deleted.bin",
              scan: { extractedTextSample: "deleted nested plaintext" },
              providerContext: { details: secret },
              retained: true
            }
          ]
        })
      );
    database
      .prepare(
        `INSERT INTO event_log (
           id, event_kind, entity_type, entity_id, source, metadata_json,
           created_at
         ) VALUES (
           'artifact_event_nested_legacy', 'artifact.enrichment_failed',
           'artifact', 'artifact_nested_legacy', 'system', ?, ?
         )`
      )
      .run(
        JSON.stringify({
          outer: { inner: { rawResponseBody: secret, retained: true } }
        }),
        at
      );

    const sql = await readFile(path.join(migrationsDir, migrationName), "utf8");
    database.exec(sql);
    const firstState = JSON.stringify({
      artifact: database
        .prepare(
          `SELECT scan_results_json, enrichment_results_json, metadata_json
           FROM artifacts WHERE id = 'artifact_nested_legacy'`
        )
        .get(),
      version: database
        .prepare(
          `SELECT enrichment_results_json FROM artifact_versions
           WHERE id = 'artifact_version_nested_legacy'`
        )
        .get(),
      audit: database
        .prepare(
          `SELECT metadata_json FROM artifact_audit_events
           WHERE id = 'artifact_audit_nested_legacy'`
        )
        .get(),
      deleted: database
        .prepare(
          `SELECT snapshot_json FROM deleted_entities
           WHERE entity_type = 'artifact'
             AND entity_id = 'artifact_deleted_nested_legacy'`
        )
        .get(),
      event: database
        .prepare(
          `SELECT metadata_json FROM event_log
           WHERE id = 'artifact_event_nested_legacy'`
        )
        .get(),
      retention: database
        .prepare(
          `SELECT storage_key, reason FROM artifact_blob_retentions
           WHERE storage_key = ?`
        )
        .get(storageKey)
    });
    database.exec(sql);
    const secondState = JSON.stringify({
      artifact: database
        .prepare(
          `SELECT scan_results_json, enrichment_results_json, metadata_json
           FROM artifacts WHERE id = 'artifact_nested_legacy'`
        )
        .get(),
      version: database
        .prepare(
          `SELECT enrichment_results_json FROM artifact_versions
           WHERE id = 'artifact_version_nested_legacy'`
        )
        .get(),
      audit: database
        .prepare(
          `SELECT metadata_json FROM artifact_audit_events
           WHERE id = 'artifact_audit_nested_legacy'`
        )
        .get(),
      deleted: database
        .prepare(
          `SELECT snapshot_json FROM deleted_entities
           WHERE entity_type = 'artifact'
             AND entity_id = 'artifact_deleted_nested_legacy'`
        )
        .get(),
      event: database
        .prepare(
          `SELECT metadata_json FROM event_log
           WHERE id = 'artifact_event_nested_legacy'`
        )
        .get(),
      retention: database
        .prepare(
          `SELECT storage_key, reason FROM artifact_blob_retentions
           WHERE storage_key = ?`
        )
        .get(storageKey)
    });

    assert.equal(secondState, firstState);
    for (const forbidden of [
      secret,
      "nested plaintext",
      "deleted nested plaintext",
      "/private/nested.bin",
      "/private/deleted.bin",
      "rawProviderOutput",
      "rawResponseBody",
      "providerError",
      "providerContext"
    ]) {
      assert.equal(firstState.includes(forbidden), false, forbidden);
    }
    assert.equal(firstState.includes("artifact_llm_enrichment_failed"), true);
    assert.equal(firstState.includes("extractedTextAvailable"), true);
    assert.equal(
      firstState.includes("legacy_unreferenced_blob_preserved"),
      true
    );
    const sanitizedState = JSON.parse(firstState) as {
      artifact: { metadata_json: string };
      audit: { metadata_json: string };
    };
    assert.equal(
      (
        JSON.parse(sanitizedState.artifact.metadata_json) as {
          nested: { retained: boolean };
        }
      ).nested.retained,
      true
    );
    assert.equal(
      (
        JSON.parse(sanitizedState.audit.metadata_json) as {
          nested: Array<{ retained: boolean }>;
        }
      ).nested[0]?.retained,
      true
    );
  } finally {
    database.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
