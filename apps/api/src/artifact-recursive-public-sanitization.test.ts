import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";

type TestApp = Awaited<ReturnType<typeof buildServer>>;

async function operatorCookie(app: TestApp) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: { host: "127.0.0.1:4317" }
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

async function upload(app: TestApp, cookie: string, key: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/artifacts",
    headers: { cookie },
    payload: {
      idempotencyKey: key,
      title: key,
      originalFileName: `${key}.txt`,
      contentBase64: Buffer.from("recursive sanitizer fixture").toString(
        "base64"
      )
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { artifact: { id: string } }).artifact.id;
}

function assertSanitized(value: unknown, secret: string) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    secret,
    "providerError",
    "providerContext",
    "rawResponseBody",
    "extractedTextSample",
    "/private/artifact/nested.bin"
  ]) {
    assert.equal(serialized.includes(forbidden), false, serialized);
  }
  assert.equal(serialized.includes("artifact_llm_enrichment_failed"), true);
  assert.equal(serialized.includes('"retained":true'), true);
}

test("Artifact public DTOs recursively sanitize live, history, audit, and deleted snapshots", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-recursive-public-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });
  try {
    const cookie = await operatorCookie(app);
    const secret = "nested-provider-secret-78124";
    const liveId = await upload(app, cookie, "artifact-recursive-public-live");
    const nestedFailure = {
      status: "failed",
      attempts: [
        {
          providerError: {
            message: secret,
            rawResponseBody: secret
          },
          errorCode: secret,
          retained: true
        }
      ]
    };
    getDatabase()
      .prepare(
        `UPDATE artifacts
         SET enrichment_results_json = ?, metadata_json = ?, scan_results_json = ?
         WHERE id = ?`
      )
      .run(
        JSON.stringify(nestedFailure),
        JSON.stringify({
          nested: {
            storagePath: "/private/artifact/nested.bin",
            retained: true
          }
        }),
        JSON.stringify({
          nested: [{ extractedTextSample: secret, retained: true }]
        }),
        liveId
      );
    getDatabase()
      .prepare(
        `UPDATE artifact_versions
         SET enrichment_results_json = ?, scan_results_json = ?
         WHERE artifact_id = ?`
      )
      .run(
        JSON.stringify({ providerContext: nestedFailure, retained: true }),
        JSON.stringify({ extractedTextSample: secret, retained: true }),
        liveId
      );
    getDatabase()
      .prepare(
        `INSERT INTO artifact_audit_events (
           id, artifact_id, event_type, source, metadata_json, created_at
         ) VALUES (?, ?, 'artifact.enrichment_failed', 'system', ?, ?)`
      )
      .run(
        "artifact_audit_recursive_public",
        liveId,
        JSON.stringify({
          nested: [{ providerError: nestedFailure, retained: true }]
        }),
        new Date().toISOString()
      );

    const live = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${liveId}`,
      headers: { cookie }
    });
    assert.equal(live.statusCode, 200, live.body);
    assertSanitized(live.json(), secret);
    const versions = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${liveId}/versions`,
      headers: { cookie }
    });
    assert.equal(versions.statusCode, 200, versions.body);
    assertSanitized(versions.json(), secret);
    const audit = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${liveId}/audit?limit=100`,
      headers: { cookie }
    });
    assert.equal(audit.statusCode, 200, audit.body);
    assertSanitized(audit.json(), secret);

    const deletedId = await upload(
      app,
      cookie,
      "artifact-recursive-public-deleted"
    );
    const softDelete = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        operations: [{ entityType: "artifact", id: deletedId, mode: "soft" }]
      }
    });
    assert.equal(softDelete.statusCode, 200, softDelete.body);
    getDatabase()
      .prepare(
        `UPDATE deleted_entities
         SET snapshot_json = ?
         WHERE entity_type = 'artifact' AND entity_id = ?`
      )
      .run(
        JSON.stringify({
          id: deletedId,
          title: "Deleted recursive fixture",
          nested: [
            {
              providerError: { message: secret, responseBody: secret },
              storagePath: "/private/artifact/nested.bin",
              extractedTextSample: secret,
              retained: true
            }
          ]
        }),
        deletedId
      );
    const deletedSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { cookie },
      payload: {
        searches: [
          {
            entityTypes: ["artifact"],
            ids: [deletedId],
            includeDeleted: true,
            limit: 10
          }
        ]
      }
    });
    assert.equal(deletedSearch.statusCode, 200, deletedSearch.body);
    assertSanitized(deletedSearch.json(), secret);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
