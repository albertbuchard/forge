import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import {
  createArtifactFromUpload,
  encryptExistingArtifact,
  readArtifactDownload
} from "./services/artifacts.js";

test(
  "ART-10 admits one concurrent encryption transition and preserves one coherent password, version, and audit trail",
  { timeout: 30_000 },
  async () => {
    const rootDir = await mkdtemp(
      path.join(os.tmpdir(), "forge-art-10-concurrent-encryption-")
    );
    const app = await buildServer({
      dataRoot: rootDir,
      seedDemoData: true,
      devrageMetricSync: false
    });
    const plaintext = Buffer.from(
      "ART-10 concurrent encryption keeps one authoritative password.",
      "utf8"
    );

    try {
      const context = {
        source: "ui" as const,
        actor: "ART-10 human operator"
      };
      const created = await createArtifactFromUpload(
        {
          title: "Concurrent encryption fixture",
          originalFileName: "art-10-race.txt",
          contentBase64: plaintext.toString("base64")
        },
        context
      );
      const artifactId = created.artifact.id;
      const contenders = [
        { password: "first ART-10 passphrase", passwordHint: "first hint" },
        { password: "second ART-10 passphrase", passwordHint: "second hint" }
      ] as const;

      const attempts = await Promise.allSettled(
        contenders.map((contender) =>
          encryptExistingArtifact(artifactId, contender, context)
        )
      );
      const fulfilled = attempts.filter(
        (
          attempt
        ): attempt is PromiseFulfilledResult<
          NonNullable<Awaited<ReturnType<typeof encryptExistingArtifact>>>
        > => attempt.status === "fulfilled" && Boolean(attempt.value)
      );
      const rejected = attempts.filter(
        (attempt): attempt is PromiseRejectedResult =>
          attempt.status === "rejected"
      );

      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal(
        (rejected[0]!.reason as { code?: string }).code,
        "artifact_already_encrypted"
      );

      const winningArtifact = fulfilled[0]!.value;
      const winningIndex = contenders.findIndex(
        (contender) =>
          contender.passwordHint ===
          winningArtifact.contentProtection.passwordHint
      );
      assert.notEqual(winningIndex, -1);
      const losingIndex = winningIndex === 0 ? 1 : 0;
      const winningPassword = contenders[winningIndex]!.password;
      const losingPassword = contenders[losingIndex]!.password;

      const download = await readArtifactDownload(
        artifactId,
        winningPassword,
        context
      );
      assert.ok(download);
      try {
        assert.deepEqual(download.bytes, plaintext);
      } finally {
        download.bytes.fill(0);
      }
      await assert.rejects(
        readArtifactDownload(artifactId, losingPassword, context),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "artifact_wrong_password"
          );
          return true;
        }
      );

      const persisted = getDatabase()
        .prepare(
          `SELECT artifacts.storage_key AS artifact_storage_key,
                  artifacts.content_password_hint AS artifact_hint,
                  artifacts.content_encryption_json AS artifact_envelope,
                  versions.storage_key AS version_storage_key,
                  versions.content_password_hint AS version_hint,
                  versions.content_encryption_json AS version_envelope
           FROM artifacts
           INNER JOIN artifact_versions AS versions
             ON versions.artifact_id = artifacts.id
           WHERE artifacts.id = ?`
        )
        .all(artifactId) as Array<{
        artifact_storage_key: string;
        artifact_hint: string;
        artifact_envelope: string;
        version_storage_key: string;
        version_hint: string;
        version_envelope: string;
      }>;
      assert.equal(persisted.length, 1);
      assert.equal(
        persisted[0]!.artifact_storage_key,
        persisted[0]!.version_storage_key
      );
      assert.equal(
        persisted[0]!.artifact_hint,
        contenders[winningIndex]!.passwordHint
      );
      assert.equal(persisted[0]!.artifact_hint, persisted[0]!.version_hint);
      assert.equal(
        persisted[0]!.artifact_envelope,
        persisted[0]!.version_envelope
      );

      const counts = getDatabase()
        .prepare(
          `SELECT
             (SELECT COUNT(*)
                FROM artifact_audit_events
               WHERE artifact_id = ? AND event_type = 'artifact.encrypted')
               AS encryption_audits,
             (SELECT COUNT(*)
                FROM artifact_pending_blob_cleanups
               WHERE artifact_id = ?) AS pending_cleanups`
        )
        .get(artifactId, artifactId) as {
        encryption_audits: number;
        pending_cleanups: number;
      };
      assert.deepEqual(
        { ...counts },
        { encryption_audits: 1, pending_cleanups: 0 }
      );

      const referencedStorageKeys = new Set(
        (
          getDatabase()
            .prepare(
              `SELECT storage_key FROM artifacts
               UNION SELECT storage_key FROM artifact_versions
               UNION SELECT storage_key FROM artifact_blobs
               UNION SELECT storage_key FROM artifact_blob_retentions`
            )
            .all() as Array<{ storage_key: string }>
        ).map((row) => row.storage_key)
      );
      const storedFiles = (
        await readdir(path.join(rootDir, "artifacts", "blobs"), {
          recursive: true
        })
      )
        .filter((entry) => entry.endsWith(".bin"))
        .map((entry) => entry.replaceAll(path.sep, "/"));
      assert.deepEqual(
        storedFiles.filter(
          (storageKey) => !referencedStorageKeys.has(storageKey)
        ),
        []
      );

      const serializedPersistence = JSON.stringify(persisted);
      for (const contender of contenders) {
        assert.equal(serializedPersistence.includes(contender.password), false);
      }
    } finally {
      plaintext.fill(0);
      await app.close();
      closeDatabase();
      await rm(rootDir, { recursive: true, force: true });
    }
  }
);
