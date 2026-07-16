import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import {
  createArtifactFromUpload,
  decodeArtifactUploadBase64,
  enrichArtifactWithLlm,
  MAX_ARTIFACT_BYTES
} from "./services/artifacts.js";
import type { LlmManager } from "./managers/platform/llm-manager.js";

test("artifact base64 validation rejects decoded payloads above the byte limit before allocation", () => {
  assert.equal(MAX_ARTIFACT_BYTES, 100 * 1024 * 1024);
  assert.throws(
    () => decodeArtifactUploadBase64(Buffer.from("four").toString("base64"), 3),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "artifact_size_limit_exceeded"
      );
      assert.equal((error as { statusCode?: number }).statusCode, 413);
      return true;
    }
  );
});

test("failed plaintext metadata commits reconcile the journal and unreferenced bytes", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-plaintext-cleanup-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    await assert.rejects(
      createArtifactFromUpload(
        {
          idempotencyKey: "artifact-plaintext-cleanup-001",
          title: "Plaintext cleanup fixture",
          originalFileName: "cleanup.txt",
          contentBase64: Buffer.from("uncommitted artifact bytes").toString(
            "base64"
          )
        },
        { source: "ui", actor: "Artifact operator" },
        {
          beforeArtifactMetadataCommit: () => {
            throw Object.assign(new Error("simulated metadata failure"), {
              code: "artifact_test_metadata_failure"
            });
          }
        }
      ),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "artifact_test_metadata_failure"
        );
        return true;
      }
    );

    const counts = getDatabase()
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM artifacts) AS artifacts,
           (SELECT COUNT(*) FROM artifact_versions) AS versions,
           (SELECT COUNT(*) FROM artifact_blobs) AS blobs,
           (SELECT COUNT(*) FROM artifact_pending_blob_cleanups) AS pending`
      )
      .get() as {
      artifacts: number;
      versions: number;
      blobs: number;
      pending: number;
    };
    assert.deepEqual(
      { ...counts },
      {
        artifacts: 0,
        versions: 0,
        blobs: 0,
        pending: 0
      }
    );
    const blobDir = path.join(rootDir, "artifacts", "blobs");
    const storedFiles = await readdir(blobDir, { recursive: true }).catch(
      () => []
    );
    assert.equal(
      storedFiles.some((entry) => entry.endsWith(".bin")),
      false
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("hard-deleted retained blobs survive duplicate reuse followed by failed metadata commit", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-retained-duplicate-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const bytes = Buffer.from(
      "hard-deleted blob retention duplicate regression",
      "utf8"
    );
    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie },
      payload: {
        idempotencyKey: "artifact-retained-original-001",
        title: "Retained original",
        originalFileName: "retained.txt",
        contentBase64: bytes.toString("base64")
      }
    });
    assert.equal(upload.statusCode, 201, upload.body);
    const artifactId = (upload.json() as { artifact: { id: string } }).artifact
      .id;
    const stored = getDatabase()
      .prepare("SELECT storage_key, storage_path FROM artifacts WHERE id = ?")
      .get(artifactId) as { storage_key: string; storage_path: string };

    const hardDelete = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "artifact",
            id: artifactId,
            mode: "hard",
            reason: "Exact retained duplicate regression"
          }
        ]
      }
    });
    assert.equal(hardDelete.statusCode, 200, hardDelete.body);
    assert.equal(
      (hardDelete.json() as { results: Array<{ ok: boolean }> }).results[0]?.ok,
      true
    );
    const retention = getDatabase()
      .prepare(
        `SELECT reason
         FROM artifact_blob_retentions
         WHERE storage_key = ?`
      )
      .get(stored.storage_key) as { reason: string } | undefined;
    assert.equal(retention?.reason, "hard_deleted_metadata_blob_preserved");
    const deletionEvent = getDatabase()
      .prepare(
        `SELECT metadata_json
         FROM event_log
         WHERE entity_type = 'artifact'
           AND entity_id = ?
           AND event_kind = 'artifact.metadata_deleted'
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(artifactId) as { metadata_json: string };
    assert.equal(
      (JSON.parse(deletionEvent.metadata_json) as { blobPreserved: boolean })
        .blobPreserved,
      true
    );

    let removalCalls = 0;
    await assert.rejects(
      createArtifactFromUpload(
        {
          idempotencyKey: "artifact-retained-duplicate-001",
          title: "Retained duplicate",
          originalFileName: "retained.txt",
          contentBase64: bytes.toString("base64")
        },
        { source: "ui", actor: "Artifact operator" },
        {
          beforeArtifactMetadataCommit: () => {
            throw Object.assign(
              new Error("simulated duplicate commit failure"),
              {
                code: "artifact_test_duplicate_commit_failure"
              }
            );
          },
          removeArtifactUploadFile: async () => {
            removalCalls += 1;
          }
        }
      ),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "artifact_test_duplicate_commit_failure"
        );
        return true;
      }
    );
    assert.equal(removalCalls, 0);
    await access(stored.storage_path);
    const cleanupCounts = getDatabase()
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM artifact_pending_blob_cleanups) AS pending,
           (SELECT COUNT(*) FROM artifact_pending_blob_cleanup_provenance)
             AS provenance`
      )
      .get() as { pending: number; provenance: number };
    assert.deepEqual({ ...cleanupCounts }, { pending: 0, provenance: 0 });
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

async function issueOperatorSessionCookie(
  app: Awaited<ReturnType<typeof buildServer>>
) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: { host: "127.0.0.1:4317" }
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

async function createTrustedArtifactToken(input: {
  app: Awaited<ReturnType<typeof buildServer>>;
  cookie: string;
  scopeUserIds?: string[];
}) {
  const response = await input.app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie: input.cookie },
    payload: {
      label: "Artifact contract agent",
      agentLabel: "Artifact contract agent",
      trustLevel: "trusted",
      scopes: [
        "artifact.create",
        "artifact.uploadBytes",
        "artifact.readMetadata"
      ],
      scopePolicy: {
        userIds: input.scopeUserIds ?? [],
        projectIds: [],
        tagIds: []
      }
    }
  });
  assert.equal(response.statusCode, 201);
  return response.json() as {
    token: {
      token: string;
      tokenSummary: { agentId: string; id: string };
    };
  };
}

function artifactStorageKey(id: string) {
  const row = getDatabase()
    .prepare("SELECT storage_key FROM artifacts WHERE id = ?")
    .get(id) as { storage_key: string } | undefined;
  assert.ok(row);
  return row.storage_key;
}

test("artifact uploads reconcile retries, reject changed payloads, and deduplicate stored bytes", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-upload-contract-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const contentBase64 = Buffer.from("stable artifact bytes", "utf8").toString(
      "base64"
    );
    const payload = {
      title: "Stable upload",
      originalFileName: "stable.txt",
      declaredMimeType: "text/plain",
      contentBase64,
      shortDescription: "One exact retryable upload."
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: {
        cookie,
        "idempotency-key": "artifact-ui-stable-file-001"
      },
      payload
    });
    assert.equal(first.statusCode, 201);
    assert.equal(first.headers["idempotency-replayed"], "false");
    const firstArtifact = (
      first.json() as {
        artifact: {
          id: string;
          contentSha256: string;
          scanResults: Record<string, unknown>;
        };
      }
    ).artifact;
    assert.equal("extractedTextSample" in firstArtifact.scanResults, false);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: {
        cookie,
        "idempotency-key": "artifact-ui-stable-file-001"
      },
      payload
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.headers["idempotency-replayed"], "true");
    assert.equal(
      (replay.json() as { artifact: { id: string } }).artifact.id,
      firstArtifact.id
    );

    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: {
        cookie,
        "idempotency-key": "artifact-ui-stable-file-001"
      },
      payload: { ...payload, title: "Changed retry payload" }
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(
      (conflict.json() as { code: string }).code,
      "artifact_idempotency_conflict"
    );

    const duplicateMetadata = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie },
      payload: {
        ...payload,
        idempotencyKey: "artifact-ui-stable-file-002",
        title: "Separate record, same bytes",
        originalFileName: "stable-copy.txt"
      }
    });
    assert.equal(duplicateMetadata.statusCode, 201);
    const duplicateArtifact = (
      duplicateMetadata.json() as {
        artifact: { id: string; contentSha256: string };
      }
    ).artifact;
    assert.notEqual(duplicateArtifact.id, firstArtifact.id);
    assert.equal(
      artifactStorageKey(duplicateArtifact.id),
      artifactStorageKey(firstArtifact.id)
    );
    assert.equal(duplicateArtifact.contentSha256, firstArtifact.contentSha256);

    const counts = getDatabase()
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM artifacts) AS artifacts,
          (SELECT COUNT(*) FROM artifact_blobs) AS blobs,
          (SELECT COUNT(*) FROM artifact_versions) AS versions,
          (SELECT COUNT(*) FROM artifact_audit_events WHERE event_type = 'artifact.created') AS creates`
      )
      .get() as {
      artifacts: number;
      blobs: number;
      versions: number;
      creates: number;
    };
    assert.equal(counts.artifacts, 2);
    assert.equal(counts.blobs, 1);
    assert.equal(counts.versions, 2);
    assert.equal(counts.creates, 2);

    const conflictingKeyForms = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie, "idempotency-key": "artifact-header-key-001" },
      payload: { ...payload, idempotencyKey: "artifact-body-key-002" }
    });
    assert.equal(conflictingKeyForms.statusCode, 400);
    assert.equal(
      (conflictingKeyForms.json() as { code: string }).code,
      "artifact_idempotency_key_conflict"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("encrypted upload replays verify the password and preserve logical versus physical blob identity", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-encrypted-replay-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const bytes = Buffer.from("name,value\nprivate,42\n", "utf8");
    const password = "artifact replay passphrase";
    const wrongPassword = "artifact replay wrong passphrase";
    const payload = {
      title: "Encrypted replay fixture",
      originalFileName: "encrypted-replay.csv",
      declaredMimeType: "text/csv",
      contentBase64: bytes.toString("base64"),
      contentProtection: {
        mode: "password_encrypted" as const,
        password,
        passwordHint: "fixture hint"
      }
    };
    const headers = {
      cookie,
      "idempotency-key": "artifact-encrypted-replay-001"
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers,
      payload
    });
    assert.equal(first.statusCode, 201);
    assert.equal(first.headers["idempotency-replayed"], "false");
    const firstArtifact = (
      first.json() as {
        artifact: {
          id: string;
          contentSha256: string;
          storedContentSha256: string;
          scanResults: Record<string, unknown>;
        };
      }
    ).artifact;
    assert.equal("extractedTextSample" in firstArtifact.scanResults, false);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers,
      payload
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.headers["idempotency-replayed"], "true");
    assert.equal(
      (replay.json() as { artifact: { id: string } }).artifact.id,
      firstArtifact.id
    );

    const rejectedPassword = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers,
      payload: {
        ...payload,
        contentProtection: {
          ...payload.contentProtection,
          password: wrongPassword
        }
      }
    });
    assert.equal(rejectedPassword.statusCode, 403);
    assert.equal(rejectedPassword.headers["idempotency-replayed"], undefined);
    assert.equal(
      (rejectedPassword.json() as { code: string }).code,
      "artifact_wrong_password"
    );

    const originalDownload = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${firstArtifact.id}/download`,
      headers: { cookie },
      payload: { password }
    });
    assert.equal(originalDownload.statusCode, 200);
    assert.deepEqual(originalDownload.rawPayload, bytes);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: {
        cookie,
        "idempotency-key": "artifact-encrypted-replay-002"
      },
      payload: {
        ...payload,
        title: "Separate encrypted representation",
        originalFileName: "encrypted-replay-copy.csv"
      }
    });
    assert.equal(second.statusCode, 201);
    const secondArtifact = (
      second.json() as {
        artifact: {
          id: string;
          contentSha256: string;
          storedContentSha256: string;
        };
      }
    ).artifact;
    assert.notEqual(secondArtifact.id, firstArtifact.id);
    assert.equal(secondArtifact.contentSha256, firstArtifact.contentSha256);
    assert.notEqual(
      artifactStorageKey(secondArtifact.id),
      artifactStorageKey(firstArtifact.id)
    );
    assert.notEqual(
      secondArtifact.storedContentSha256,
      firstArtifact.storedContentSha256
    );

    const logicalIdentity = getDatabase()
      .prepare(
        `SELECT content_sha256, storage_key
         FROM artifact_blobs
         WHERE content_sha256 = ?`
      )
      .all(firstArtifact.contentSha256) as Array<{
      content_sha256: string;
      storage_key: string;
    }>;
    assert.equal(logicalIdentity.length, 1);
    assert.equal(
      logicalIdentity[0]?.storage_key,
      artifactStorageKey(firstArtifact.id)
    );
    const physicalRepresentations = getDatabase()
      .prepare(
        `SELECT storage_key, stored_content_sha256
         FROM artifacts
         WHERE content_sha256 = ?`
      )
      .all(firstArtifact.contentSha256) as Array<{
      storage_key: string;
      stored_content_sha256: string;
    }>;
    assert.equal(physicalRepresentations.length, 2);
    assert.equal(
      new Set(physicalRepresentations.map((row) => row.storage_key)).size,
      2
    );

    const persistedSecretSurfaces = JSON.stringify({
      artifacts: getDatabase()
        .prepare(
          `SELECT content_encryption_json, metadata_json, scan_results_json
           FROM artifacts
           WHERE content_sha256 = ?`
        )
        .all(firstArtifact.contentSha256),
      versions: getDatabase()
        .prepare(
          `SELECT scan_results_json
           FROM artifact_versions
           WHERE artifact_id IN (?, ?)`
        )
        .all(firstArtifact.id, secondArtifact.id),
      audit: getDatabase()
        .prepare(
          `SELECT metadata_json
           FROM artifact_audit_events
           WHERE artifact_id IN (?, ?)`
        )
        .all(firstArtifact.id, secondArtifact.id)
    });
    assert.equal(persistedSecretSurfaces.includes(password), false);
    assert.equal(persistedSecretSurfaces.includes(wrongPassword), false);
    assert.equal(persistedSecretSurfaces.includes("private,42"), false);

    const versionMetadata = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${firstArtifact.id}/versions`,
      headers: { cookie }
    });
    assert.equal(versionMetadata.statusCode, 200);
    assert.equal(versionMetadata.body.includes("private,42"), false);
    assert.equal(versionMetadata.body.includes("extractedTextSample"), false);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("LLM enrichment receives internal text only for plaintext artifacts", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-enrichment-boundary-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO wiki_llm_profiles (
           id, label, provider, base_url, model, secret_id, system_prompt,
           enabled, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, '', 1, '{}', ?, ?)`
      )
      .run(
        "wiki_llm_artifact_boundary",
        "Artifact boundary profile",
        "mock",
        "http://127.0.0.1.invalid",
        "artifact-boundary-model",
        now,
        now
      );
    const prompts: string[] = [];
    const llm = {
      runTextPrompt: async (
        _profile: unknown,
        input: { prompt: string },
        logger?: (entry: { level: string; message: string }) => void
      ) => {
        prompts.push(input.prompt);
        logger?.({ level: "info", message: secretText });
        return {
          outputText: JSON.stringify({
            title: "Generated artifact title",
            description: secretText,
            extractedTextSample: secretText,
            rawText: secretText
          })
        };
      }
    } as unknown as LlmManager;
    const context = { source: "ui" as const, actor: "Artifact operator" };
    const secretText = "bounded internal enrichment sample 84729";
    const plaintext = await createArtifactFromUpload(
      {
        idempotencyKey: "artifact-enrichment-plaintext",
        originalFileName: "plaintext.txt",
        contentBase64: Buffer.from(secretText).toString("base64")
      },
      context
    );
    const enrichedPlaintext = await enrichArtifactWithLlm(
      plaintext.artifact.id,
      { llmProfileId: "wiki_llm_artifact_boundary" },
      context,
      { llm }
    );
    assert.equal(prompts[0]?.includes(secretText), true);
    assert.equal(JSON.stringify(enrichedPlaintext).includes(secretText), false);
    const persistedPlaintextSurfaces = JSON.stringify({
      artifact: getDatabase()
        .prepare(
          `SELECT scan_results_json, enrichment_results_json
           FROM artifacts
           WHERE id = ?`
        )
        .get(plaintext.artifact.id),
      audit: getDatabase()
        .prepare(
          `SELECT metadata_json
           FROM artifact_audit_events
           WHERE artifact_id = ?`
        )
        .all(plaintext.artifact.id)
    });
    assert.equal(persistedPlaintextSurfaces.includes(secretText), false);
    assert.equal(
      persistedPlaintextSurfaces.includes("extractedTextSample"),
      false
    );
    assert.equal(persistedPlaintextSurfaces.includes("rawText"), false);

    const encrypted = await createArtifactFromUpload(
      {
        idempotencyKey: "artifact-enrichment-encrypted",
        originalFileName: "encrypted.txt",
        contentBase64: Buffer.from(secretText).toString("base64"),
        contentProtection: {
          mode: "password_encrypted",
          password: "enrichment boundary passphrase"
        }
      },
      context
    );
    await enrichArtifactWithLlm(
      encrypted.artifact.id,
      { llmProfileId: "wiki_llm_artifact_boundary" },
      context,
      { llm }
    );
    assert.equal(prompts[1]?.includes(secretText), false);
    assert.equal(
      JSON.stringify(encrypted.artifact.scanResults).includes(secretText),
      false
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("artifact enrichment failures persist only a stable code, never provider response text", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-provider-failure-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO wiki_llm_profiles (
           id, label, provider, base_url, model, secret_id, system_prompt,
           enabled, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, '', 1, '{}', ?, ?)`
      )
      .run(
        "wiki_llm_artifact_failure",
        "Artifact failure profile",
        "mock",
        "http://127.0.0.1.invalid",
        "artifact-failure-model",
        now,
        now
      );
    const rawProviderBody = "upstream-private-body-98421";
    const llm = {
      runTextPrompt: async () => {
        throw new Error(`Provider rejected request: ${rawProviderBody}`);
      }
    } as unknown as LlmManager;
    const result = await createArtifactFromUpload(
      {
        idempotencyKey: "artifact-provider-failure-001",
        originalFileName: "provider-failure.txt",
        contentBase64: Buffer.from("safe artifact content").toString("base64"),
        useLlmEnrichment: true,
        llmProfileId: "wiki_llm_artifact_failure"
      },
      { source: "ui", actor: "Artifact operator" },
      { llm }
    );
    const persisted = JSON.stringify({
      artifact: getDatabase()
        .prepare(
          `SELECT enrichment_results_json
           FROM artifacts WHERE id = ?`
        )
        .get(result.artifact.id),
      audit: getDatabase()
        .prepare(
          `SELECT metadata_json
           FROM artifact_audit_events WHERE artifact_id = ?`
        )
        .all(result.artifact.id),
      events: getDatabase()
        .prepare(
          `SELECT metadata_json
           FROM event_log WHERE entity_type = 'artifact' AND entity_id = ?`
        )
        .all(result.artifact.id)
    });
    assert.equal(persisted.includes(rawProviderBody), false);
    assert.equal(persisted.includes("Provider rejected request"), false);
    assert.equal(persisted.includes("artifact_llm_enrichment_failed"), true);
    assert.equal(
      JSON.stringify(result.artifact).includes(rawProviderBody),
      false
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("concurrent encrypted idempotent uploads leave no unreferenced ciphertext", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-encrypted-concurrency-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const payload = {
      title: "Concurrent encrypted upload",
      originalFileName: "concurrent-encrypted.txt",
      declaredMimeType: "text/plain",
      contentBase64: Buffer.from(
        "one encrypted payload submitted concurrently",
        "utf8"
      ).toString("base64"),
      contentProtection: {
        mode: "password_encrypted" as const,
        password: "concurrent artifact passphrase",
        passwordHint: "concurrency fixture"
      }
    };
    const request = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/artifacts",
        headers: {
          cookie,
          "idempotency-key": "artifact-encrypted-concurrent-001"
        },
        payload
      });

    const responses = await Promise.all([request(), request()]);
    assert.deepEqual(
      responses.map((response) => response.statusCode).sort(),
      [200, 201]
    );
    assert.deepEqual(
      responses
        .map((response) => response.headers["idempotency-replayed"])
        .sort(),
      ["false", "true"]
    );

    const referencedStorageKeys = new Set(
      (
        getDatabase()
          .prepare(
            `SELECT storage_key FROM artifacts
             UNION
             SELECT storage_key FROM artifact_versions
             UNION
             SELECT storage_key FROM artifact_blobs`
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

    assert.ok(storedFiles.length > 0);
    assert.deepEqual(
      storedFiles.filter(
        (relativePath) => !referencedStorageKeys.has(relativePath)
      ),
      []
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("failed encrypted replay cleanup is durable and recovers on the next exact replay", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-encrypted-cleanup-recovery-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const bytes = Buffer.from("cleanup recovery encrypted bytes", "utf8");
    const context = { source: "ui" as const, actor: "Artifact operator" };
    const basePayload = {
      title: "Encrypted cleanup recovery",
      originalFileName: "cleanup-recovery.txt",
      declaredMimeType: "text/plain",
      contentBase64: bytes.toString("base64"),
      contentProtection: {
        mode: "password_encrypted" as const,
        password: "cleanup recovery passphrase",
        passwordHint: "recovery fixture"
      }
    };

    await createArtifactFromUpload(
      { ...basePayload, idempotencyKey: "artifact-cleanup-canonical-001" },
      context
    );

    let failedRemovalPath: string | null = null;
    const upload = () =>
      createArtifactFromUpload(
        { ...basePayload, idempotencyKey: "artifact-cleanup-recovery-001" },
        context,
        {
          removeEncryptedUploadFile: async (storagePath) => {
            failedRemovalPath = storagePath;
            throw Object.assign(new Error("simulated cleanup failure"), {
              code: "EACCES"
            });
          }
        }
      );
    const concurrent = await Promise.all([upload(), upload()]);
    assert.deepEqual(concurrent.map((result) => result.replayed).sort(), [
      false,
      true
    ]);
    assert.ok(failedRemovalPath);
    await access(failedRemovalPath);

    const artifactId = concurrent[0]!.artifact.id;
    const pending = getDatabase()
      .prepare(
        `SELECT id, storage_key, stored_content_sha256, last_error_code
         FROM artifact_pending_blob_cleanups
         WHERE artifact_id = ?`
      )
      .get(artifactId) as
      | {
          id: string;
          storage_key: string;
          stored_content_sha256: string;
          last_error_code: string;
        }
      | undefined;
    assert.ok(pending);
    assert.equal(pending.last_error_code, "EACCES");
    assert.equal(
      JSON.stringify(pending).includes(basePayload.contentProtection.password),
      false
    );
    const publicCleanupEvents = getDatabase()
      .prepare(
        `SELECT metadata_json
         FROM artifact_audit_events
         WHERE artifact_id = ?
           AND event_type LIKE 'artifact.%cleanup%'`
      )
      .all(artifactId);
    assert.deepEqual(publicCleanupEvents, []);

    const replay = await createArtifactFromUpload(
      { ...basePayload, idempotencyKey: "artifact-cleanup-recovery-001" },
      context
    );
    assert.equal(replay.replayed, true);
    await assert.rejects(access(failedRemovalPath));
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM artifact_pending_blob_cleanups
             WHERE artifact_id = ?`
          )
          .get(artifactId) as { count: number }
      ).count,
      0
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("encrypted cleanup recovery preserves a blob that became referenced", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-encrypted-cleanup-reference-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const context = { source: "ui" as const, actor: "Artifact operator" };
    const basePayload = {
      title: "Encrypted cleanup reference",
      originalFileName: "cleanup-reference.txt",
      contentBase64: Buffer.from(
        "cleanup reference encrypted bytes",
        "utf8"
      ).toString("base64"),
      contentProtection: {
        mode: "password_encrypted" as const,
        password: "cleanup reference passphrase"
      }
    };
    const canonical = await createArtifactFromUpload(
      { ...basePayload, idempotencyKey: "artifact-cleanup-reference-base" },
      context
    );
    let failedRemovalPath: string | null = null;
    const upload = () =>
      createArtifactFromUpload(
        { ...basePayload, idempotencyKey: "artifact-cleanup-reference-race" },
        context,
        {
          removeEncryptedUploadFile: async (storagePath) => {
            failedRemovalPath = storagePath;
            throw Object.assign(new Error("simulated cleanup failure"), {
              code: "EBUSY"
            });
          }
        }
      );
    const concurrent = await Promise.all([upload(), upload()]);
    assert.ok(failedRemovalPath);
    const racedArtifactId = concurrent[0]!.artifact.id;
    const pending = getDatabase()
      .prepare(
        `SELECT storage_key, stored_content_sha256
         FROM artifact_pending_blob_cleanups
         WHERE artifact_id = ?`
      )
      .get(racedArtifactId) as {
      storage_key: string;
      stored_content_sha256: string;
    };

    getDatabase()
      .prepare(
        `UPDATE artifact_versions
         SET storage_key = ?, stored_content_sha256 = ?
         WHERE artifact_id = ?`
      )
      .run(
        pending.storage_key,
        pending.stored_content_sha256,
        canonical.artifact.id
      );

    const replay = await createArtifactFromUpload(
      { ...basePayload, idempotencyKey: "artifact-cleanup-reference-race" },
      context
    );
    assert.equal(replay.replayed, true);
    await access(failedRemovalPath);
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM artifact_pending_blob_cleanups
             WHERE artifact_id = ?`
          )
          .get(racedArtifactId) as { count: number }
      ).count,
      0
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("artifact uploads reject empty, whitespace, malformed, and non-canonical base64", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-invalid-base64-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const invalidValues = ["", "   ", "YQ==\n", "YQ", "YR==", "====", "%%%="];
    for (const [index, contentBase64] of invalidValues.entries()) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/artifacts",
        headers: { cookie },
        payload: {
          originalFileName: `invalid-${index}.txt`,
          contentBase64
        }
      });
      assert.equal(response.statusCode, 400, contentBase64);
      assert.equal(
        (response.json() as { code: string }).code,
        "artifact_invalid_base64",
        contentBase64
      );
    }
    const counts = getDatabase()
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM artifacts) AS artifacts,
          (SELECT COUNT(*) FROM artifact_blobs) AS logicalIdentities,
          (SELECT COUNT(*) FROM artifact_versions) AS versions`
      )
      .get() as {
      artifacts: number;
      logicalIdentities: number;
      versions: number;
    };
    assert.equal(counts.artifacts, 0);
    assert.equal(counts.logicalIdentities, 0);
    assert.equal(counts.versions, 0);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("trusted agent uploads keep token-bound provenance and user scope", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-upload-provenance-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const directory = await app.inject({
      method: "GET",
      url: "/api/v1/users/directory",
      headers: { cookie }
    });
    assert.equal(directory.statusCode, 200);
    const users = (
      directory.json() as {
        directory: { users: Array<{ id: string }> };
      }
    ).directory.users;
    const allowedUserId = users[0]!.id;
    const tokenPayload = await createTrustedArtifactToken({
      app,
      cookie,
      scopeUserIds: [allowedUserId]
    });
    const agentHeaders = {
      authorization: `Bearer ${tokenPayload.token.token}`,
      "x-forge-source": "agent",
      "x-forge-actor": "Caller-shaped label"
    };
    const basePayload = {
      originalFileName: "agent.txt",
      contentBase64: Buffer.from("agent bytes", "utf8").toString("base64")
    };

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: agentHeaders,
      payload: {
        ...basePayload,
        idempotencyKey: "artifact-agent-upload-001"
      }
    });
    assert.equal(created.statusCode, 201);
    const artifact = (
      created.json() as {
        artifact: {
          sourceKind: string;
          uploadedByAgentId: string | null;
          actingForUserId: string | null;
        };
      }
    ).artifact;
    assert.equal(artifact.sourceKind, "agent_upload");
    assert.equal(
      artifact.uploadedByAgentId,
      tokenPayload.token.tokenSummary.agentId
    );
    assert.equal(artifact.actingForUserId, allowedUserId);

    const forgedAgent = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: agentHeaders,
      payload: {
        ...basePayload,
        idempotencyKey: "artifact-agent-upload-002",
        uploadedByAgentId: "agent_someone_else"
      }
    });
    assert.equal(forgedAgent.statusCode, 403);
    assert.equal(
      (forgedAgent.json() as { code: string }).code,
      "artifact_agent_identity_mismatch"
    );

    const forgedSource = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: agentHeaders,
      payload: {
        ...basePayload,
        idempotencyKey: "artifact-agent-upload-003",
        sourceKind: "manual"
      }
    });
    assert.equal(forgedSource.statusCode, 403);
    assert.equal(
      (forgedSource.json() as { code: string }).code,
      "artifact_agent_provenance_required"
    );

    const outOfScope = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: agentHeaders,
      payload: {
        ...basePayload,
        idempotencyKey: "artifact-agent-upload-004",
        actingForUserId: "user_outside_scope"
      }
    });
    assert.equal(outOfScope.statusCode, 403);
    assert.equal(
      (outOfScope.json() as { code: string }).code,
      "artifact_user_scope_forbidden"
    );

    const humanClaimingAgent = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie },
      payload: {
        ...basePayload,
        idempotencyKey: "artifact-human-upload-001",
        sourceKind: "agent_upload"
      }
    });
    assert.equal(humanClaimingAgent.statusCode, 400);
    assert.equal(
      (humanClaimingAgent.json() as { code: string }).code,
      "artifact_provenance_conflict"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
