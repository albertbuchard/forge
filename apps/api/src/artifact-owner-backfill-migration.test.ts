import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(moduleDir, "..", "migrations");
const migrationName = "095_artifact_security_ownership.sql";

async function applyMigrationsBefore095(database: DatabaseSync) {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql") && file < migrationName)
    .sort();
  for (const file of files) {
    database.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  }
}

test("migration 095 backfills deterministic artifact owners and purges persisted text samples", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-owner-migration-")
  );
  const database = new DatabaseSync(path.join(rootDir, "forge.sqlite"));
  database.exec("PRAGMA foreign_keys = ON");
  try {
    await applyMigrationsBefore095(database);
    const at = "2026-07-16T08:00:00.000Z";
    database
      .prepare(
        `INSERT INTO artifact_blobs (
           content_sha256, storage_key, byte_size, detected_mime_type, created_at
         ) VALUES ('legacy-artifact-hash', 'sha256/le/ga/legacy.bin', 4, 'text/plain', ?)`
      )
      .run(at);
    const insertArtifact = database.prepare(
      `INSERT INTO artifacts (
         id, title, original_file_name, storage_key, storage_path,
         content_sha256, byte_size, detected_extension, detected_mime_type,
         format_family, uploaded_by_user_id, acting_for_user_id,
         scan_results_json, created_at, updated_at, content_protection_mode
       ) VALUES (?, ?, 'legacy.txt', 'sha256/le/ga/legacy.bin', ?,
         'legacy-artifact-hash', 4, 'txt', 'text/plain', 'text', ?, ?, ?, ?, ?, ?)`
    );
    const sample = JSON.stringify({
      scannerVersion: "legacy",
      findings: [],
      extractedTextSample: "private legacy plaintext",
      extractedTextTruncated: false
    });
    const emptySample = JSON.stringify({
      findings: [],
      extractedTextSample: "",
      extractedTextTruncated: false
    });
    const rows = [
      [
        "artifact_existing_owner",
        "Existing owner wins",
        "user_operator",
        "user_operator",
        sample,
        "plaintext"
      ],
      [
        "artifact_acting_priority",
        "Acting user wins",
        "user_forge_bot",
        "user_operator",
        sample,
        "plaintext"
      ],
      [
        "artifact_uploader_fallback",
        "Uploader fallback",
        "user_forge_bot",
        null,
        emptySample,
        "plaintext"
      ],
      [
        "artifact_invalid_acting_fallback",
        "Invalid acting fallback",
        "user_operator",
        "user_missing",
        sample,
        "plaintext"
      ],
      [
        "artifact_null_owner",
        "Null owner remains unowned",
        null,
        null,
        sample,
        "plaintext"
      ],
      [
        "artifact_encrypted_sample",
        "Encrypted sample is unavailable",
        "user_operator",
        null,
        sample,
        "password_encrypted"
      ]
    ] as const;
    for (const [
      id,
      title,
      uploadedBy,
      actingFor,
      scanJson,
      protection
    ] of rows) {
      insertArtifact.run(
        id,
        title,
        `/private/legacy/${id}.bin`,
        uploadedBy,
        actingFor,
        scanJson,
        at,
        at,
        protection
      );
    }
    database
      .prepare(
        `INSERT INTO entity_owners (
           entity_type, entity_id, user_id, role, created_at, updated_at
         ) VALUES ('artifact', 'artifact_existing_owner', 'user_forge_bot', 'owner', ?, ?)`
      )
      .run(at, at);
    database
      .prepare(
        `INSERT INTO artifact_versions (
           id, artifact_id, version_number, content_sha256, storage_key,
           byte_size, original_file_name, scan_results_json,
           enrichment_results_json, created_at, content_protection_mode
         ) VALUES (
           'artifact_version_legacy', 'artifact_acting_priority', 1,
           'legacy-artifact-hash', 'sha256/le/ga/legacy.bin', 4,
           'legacy.txt', ?, '{}', ?, 'plaintext'
         )`
      )
      .run(sample, at);

    const countBefore = (
      database.prepare("SELECT COUNT(*) AS count FROM artifacts").get() as {
        count: number;
      }
    ).count;
    const migration = await readFile(
      path.join(migrationsDir, migrationName),
      "utf8"
    );
    database.exec(migration);
    database.exec(migration);

    const owners = database
      .prepare(
        `SELECT entity_id, user_id
         FROM entity_owners
         WHERE entity_type = 'artifact'
           AND entity_id LIKE 'artifact_%'
         ORDER BY entity_id`
      )
      .all() as Array<{ entity_id: string; user_id: string }>;
    assert.deepEqual(
      owners.map((row) => ({ ...row })),
      [
        {
          entity_id: "artifact_acting_priority",
          user_id: "user_operator"
        },
        {
          entity_id: "artifact_encrypted_sample",
          user_id: "user_operator"
        },
        {
          entity_id: "artifact_existing_owner",
          user_id: "user_forge_bot"
        },
        {
          entity_id: "artifact_invalid_acting_fallback",
          user_id: "user_operator"
        },
        {
          entity_id: "artifact_uploader_fallback",
          user_id: "user_forge_bot"
        }
      ]
    );
    assert.equal(
      owners.some((row) => row.entity_id === "artifact_null_owner"),
      false
    );
    assert.equal(
      (
        database.prepare("SELECT COUNT(*) AS count FROM artifacts").get() as {
          count: number;
        }
      ).count,
      countBefore
    );

    const scans = database
      .prepare(
        `SELECT id, scan_results_json
         FROM artifacts
         WHERE id IN (
           'artifact_acting_priority',
           'artifact_uploader_fallback',
           'artifact_encrypted_sample'
         )
         ORDER BY id`
      )
      .all() as Array<{ id: string; scan_results_json: string }>;
    const scansById = new Map(
      scans.map((row) => [
        row.id,
        JSON.parse(row.scan_results_json) as Record<string, unknown>
      ])
    );
    assert.equal(
      scansById.get("artifact_acting_priority")?.extractedTextAvailable,
      true
    );
    assert.equal(
      scansById.get("artifact_uploader_fallback")?.extractedTextAvailable,
      false
    );
    assert.equal(
      scansById.get("artifact_encrypted_sample")?.extractedTextAvailable,
      false
    );
    for (const scan of scansById.values()) {
      assert.equal("extractedTextSample" in scan, false);
    }
    const versionScan = JSON.parse(
      (
        database
          .prepare(
            `SELECT scan_results_json
             FROM artifact_versions
             WHERE id = 'artifact_version_legacy'`
          )
          .get() as { scan_results_json: string }
      ).scan_results_json
    ) as Record<string, unknown>;
    assert.equal(versionScan.extractedTextAvailable, true);
    assert.equal("extractedTextSample" in versionScan, false);
  } finally {
    database.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
