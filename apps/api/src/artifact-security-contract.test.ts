import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { getEntityOwnerId } from "./repositories/entity-ownership.js";

type TestApp = Awaited<ReturnType<typeof buildServer>>;

async function issueOperatorSessionCookie(app: TestApp) {
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

async function issueArtifactToken(
  app: TestApp,
  cookie: string,
  label: string,
  userIds: string[]
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label,
      agentLabel: label,
      trustLevel: "trusted",
      scopes: [
        "read",
        "write",
        "artifact.create",
        "artifact.uploadBytes",
        "artifact.readMetadata",
        "artifact.updateMetadata",
        "artifact.link",
        "artifact.manageTrust",
        "artifact.enrichWithLlm"
      ],
      scopePolicy: { userIds, projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { token: { token: string } }).token.token;
}

async function uploadArtifact(input: {
  app: TestApp;
  headers: Record<string, string>;
  title: string;
  bytes: Buffer;
  actingForUserId?: string;
  metadata?: Record<string, unknown>;
}) {
  const response = await input.app.inject({
    method: "POST",
    url: "/api/v1/artifacts",
    headers: input.headers,
    payload: {
      title: input.title,
      originalFileName: `${input.title.replaceAll(" ", "-")}.txt`,
      declaredMimeType: "text/plain",
      contentBase64: input.bytes.toString("base64"),
      actingForUserId: input.actingForUserId,
      metadata: input.metadata ?? {}
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  const artifact = (response.json() as { artifact: Record<string, unknown> })
    .artifact;
  assert.equal(typeof artifact.id, "string");
  return { response, artifact, id: artifact.id as string };
}

function assertArtifactPayloadIsPublic(value: unknown) {
  const body = JSON.stringify(value);
  assert.equal(body.includes("storagePath"), false, body);
  assert.equal(body.includes("storage_path"), false, body);
  assert.equal(body.includes("storageKey"), false, body);
  assert.equal(body.includes("storage_key"), false, body);
  assert.equal(body.includes("sha256/"), false, body);
  assert.equal(body.includes("extractedTextSample"), false, body);
  assert.equal(body.includes("/private/artifact-bytes/"), false, body);
}

function firstBatchResult(response: {
  statusCode: number;
  body: string;
  json: () => unknown;
}) {
  assert.equal(response.statusCode, 200, response.body);
  return (
    response.json() as {
      results: Array<{
        ok: boolean;
        entity?: unknown;
        matches?: unknown[];
        error?: { code: string; message: string };
      }>;
    }
  ).results[0]!;
}

test("Artifact routes enforce owner scope and redact physical paths and plaintext", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-security-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const scopedToken = await issueArtifactToken(
      app,
      cookie,
      "Artifact owner security",
      ["user_operator"]
    );
    const multiUserToken = await issueArtifactToken(
      app,
      cookie,
      "Artifact multi-user security",
      ["user_operator", "user_forge_bot"]
    );
    const tokenHeaders = { authorization: `Bearer ${scopedToken}` };
    const ownerBytes = Buffer.from("owner plaintext evidence 42", "utf8");
    const foreignBytes = Buffer.from("foreign plaintext evidence 84", "utf8");
    const own = await uploadArtifact({
      app,
      headers: { cookie },
      title: "ARTSEC common own artifact",
      bytes: ownerBytes,
      actingForUserId: "user_operator",
      metadata: {
        storagePath: "/private/artifact-bytes/owner.txt",
        nested: {
          filePath: "/private/artifact-bytes/owner-nested.txt",
          retained: true
        }
      }
    });
    const foreign = await uploadArtifact({
      app,
      headers: { cookie },
      title: "ARTSEC common foreign artifact",
      bytes: foreignBytes,
      actingForUserId: "user_forge_bot"
    });
    assert.equal(getEntityOwnerId("artifact", own.id), "user_operator");
    assert.equal(getEntityOwnerId("artifact", foreign.id), "user_forge_bot");
    assertArtifactPayloadIsPublic(own.artifact);
    assertArtifactPayloadIsPublic(foreign.artifact);
    assert.equal(
      (own.artifact.scanResults as Record<string, unknown>)
        .extractedTextAvailable,
      true
    );

    const maliciousCallerTicketImport = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/import-ticket",
      headers: tokenHeaders,
      payload: {
        artifactId: own.id,
        createDraft: false,
        extractedText: "LX 123 ZRH CDG 2026-07-20T10:00:00Z"
      }
    });
    assert.equal(
      maliciousCallerTicketImport.statusCode,
      400,
      maliciousCallerTicketImport.body
    );
    const ownTicketImport = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/import-ticket",
      headers: tokenHeaders,
      payload: {
        artifactId: own.id,
        createDraft: false
      }
    });
    assert.equal(ownTicketImport.statusCode, 200, ownTicketImport.body);
    assertArtifactPayloadIsPublic(ownTicketImport.json());
    assert.equal(
      (
        ownTicketImport.json() as {
          artifact: { id: string };
        }
      ).artifact.id,
      own.id
    );
    const foreignTicketImport = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/import-ticket",
      headers: tokenHeaders,
      payload: {
        artifactId: foreign.id,
        createDraft: false
      }
    });
    assert.equal(foreignTicketImport.statusCode, 404, foreignTicketImport.body);
    assertArtifactPayloadIsPublic(foreignTicketImport.json());

    const scopedList = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts?query=ARTSEC%20common&limit=1&offset=0",
      headers: tokenHeaders
    });
    assert.equal(scopedList.statusCode, 200, scopedList.body);
    const scopedListBody = scopedList.json() as {
      artifacts: Array<{ id: string }>;
      total: number;
      hasMore: boolean;
    };
    assert.deepEqual(
      scopedListBody.artifacts.map((artifact) => artifact.id),
      [own.id]
    );
    assert.equal(scopedListBody.total, 1);
    assert.equal(scopedListBody.hasMore, false);
    assertArtifactPayloadIsPublic(scopedListBody);

    const derivedUpload = await uploadArtifact({
      app,
      headers: tokenHeaders,
      title: "ARTSEC derived scoped owner",
      bytes: Buffer.from("derived owner", "utf8")
    });
    assert.equal(
      getEntityOwnerId("artifact", derivedUpload.id),
      "user_operator"
    );
    assert.equal(derivedUpload.artifact.actingForUserId, "user_operator");
    assertArtifactPayloadIsPublic(derivedUpload.artifact);

    const foreignOwnerUpload = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: tokenHeaders,
      payload: {
        title: "ARTSEC forbidden owner",
        originalFileName: "forbidden.txt",
        contentBase64: Buffer.from("forbidden", "utf8").toString("base64"),
        actingForUserId: "user_forge_bot"
      }
    });
    assert.equal(foreignOwnerUpload.statusCode, 403, foreignOwnerUpload.body);
    assert.equal(
      (foreignOwnerUpload.json() as { code: string }).code,
      "artifact_user_scope_forbidden"
    );
    const ambiguousUpload = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { authorization: `Bearer ${multiUserToken}` },
      payload: {
        title: "ARTSEC ambiguous owner",
        originalFileName: "ambiguous.txt",
        contentBase64: Buffer.from("ambiguous", "utf8").toString("base64")
      }
    });
    assert.equal(ambiguousUpload.statusCode, 400, ambiguousUpload.body);
    assert.equal(
      (ambiguousUpload.json() as { code: string }).code,
      "artifact_owner_required"
    );

    const unknownId = "artifact_unknown_security_contract";
    const dedicatedCalls = (id: string) => [
      app.inject({
        method: "GET",
        url: `/api/v1/artifacts/${id}`,
        headers: tokenHeaders
      }),
      app.inject({
        method: "PATCH",
        url: `/api/v1/artifacts/${id}`,
        headers: tokenHeaders,
        payload: { title: "Must remain undisclosed" }
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/artifacts/${id}/links`,
        headers: tokenHeaders,
        payload: { links: [] }
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/artifacts/${id}/trust`,
        headers: tokenHeaders,
        payload: {
          artifactState: "active",
          reason: "Adversarial owner boundary"
        }
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/artifacts/${id}/scan`,
        headers: tokenHeaders
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/artifacts/${id}/enrich`,
        headers: tokenHeaders,
        payload: {}
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/artifacts/${id}/versions`,
        headers: tokenHeaders
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/artifacts/${id}/audit`,
        headers: tokenHeaders
      })
    ];
    const [foreignCalls, unknownCalls] = await Promise.all([
      Promise.all(dedicatedCalls(foreign.id)),
      Promise.all(dedicatedCalls(unknownId))
    ]);
    assert.equal(foreignCalls.length, unknownCalls.length);
    for (let index = 0; index < foreignCalls.length; index += 1) {
      const foreignResponse = foreignCalls[index]!;
      const unknownResponse = unknownCalls[index]!;
      assert.equal(foreignResponse.statusCode, 404, foreignResponse.body);
      assert.equal(unknownResponse.statusCode, 404, unknownResponse.body);
      assert.deepEqual(foreignResponse.json(), unknownResponse.json());
    }

    const operatorPositiveCalls = await Promise.all([
      app.inject({
        method: "GET",
        url: `/api/v1/artifacts/${foreign.id}`,
        headers: { cookie }
      }),
      app.inject({
        method: "PATCH",
        url: `/api/v1/artifacts/${foreign.id}`,
        headers: { cookie },
        payload: { shortDescription: "Operator-visible foreign metadata" }
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/artifacts/${foreign.id}/links`,
        headers: { cookie },
        payload: {
          links: [
            {
              entityType: "goal",
              entityId: "goal_artifact_security",
              relationship: "evidence"
            }
          ]
        }
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/artifacts/${foreign.id}/trust`,
        headers: { cookie },
        payload: {
          artifactState: "active",
          reason: "Operator positive path"
        }
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/artifacts/${foreign.id}/scan`,
        headers: { cookie }
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/artifacts/${foreign.id}/enrich`,
        headers: { cookie },
        payload: {}
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/artifacts/${foreign.id}/versions`,
        headers: { cookie }
      }),
      app.inject({
        method: "GET",
        url: `/api/v1/artifacts/${foreign.id}/audit`,
        headers: { cookie }
      })
    ]);
    for (const response of operatorPositiveCalls) {
      assert.equal(response.statusCode, 200, response.body);
      assertArtifactPayloadIsPublic(response.json());
    }

    const batchSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: tokenHeaders,
      payload: {
        searches: [
          {
            entityTypes: ["artifact"],
            query: "ARTSEC common",
            limit: 1
          }
        ]
      }
    });
    const batchSearchResult = firstBatchResult(batchSearch);
    assert.equal(batchSearchResult.ok, true);
    assert.deepEqual(
      (batchSearchResult.matches as Array<{ id: string }>).map(
        (match) => match.id
      ),
      [own.id]
    );
    assertArtifactPayloadIsPublic(batchSearch.json());

    const batchMutation = async (
      route: "update" | "delete" | "restore",
      id: string,
      extra: Record<string, unknown> = {}
    ) => {
      const operation =
        route === "update"
          ? { entityType: "artifact", id, patch: { title: "Hidden update" } }
          : { entityType: "artifact", id, ...extra };
      return app.inject({
        method: "POST",
        url: `/api/v1/entities/${route}`,
        headers: tokenHeaders,
        payload: { operations: [operation] }
      });
    };
    for (const route of ["update", "delete", "restore"] as const) {
      const [foreignResponse, unknownResponse] = await Promise.all([
        batchMutation(route, foreign.id),
        batchMutation(route, unknownId)
      ]);
      const foreignResult = firstBatchResult(foreignResponse);
      const unknownResult = firstBatchResult(unknownResponse);
      assert.equal(foreignResult.ok, false);
      assert.equal(unknownResult.ok, false);
      assert.equal(foreignResult.error?.code, "not_found");
      assert.equal(unknownResult.error?.code, "not_found");
    }
    const foreignHardDelete = await batchMutation("delete", foreign.id, {
      mode: "hard"
    });
    const unknownHardDelete = await batchMutation("delete", unknownId, {
      mode: "hard"
    });
    assert.equal(firstBatchResult(foreignHardDelete).error?.code, "not_found");
    assert.equal(firstBatchResult(unknownHardDelete).error?.code, "not_found");

    const ownSoftDelete = await batchMutation("delete", own.id, {
      mode: "soft",
      reason: "Scoped lifecycle regression"
    });
    assert.equal(firstBatchResult(ownSoftDelete).ok, true);
    assertArtifactPayloadIsPublic(ownSoftDelete.json());
    const deletedSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: tokenHeaders,
      payload: {
        searches: [
          {
            entityTypes: ["artifact"],
            ids: [own.id, foreign.id],
            includeDeleted: true,
            limit: 10
          }
        ]
      }
    });
    const deletedMatches = firstBatchResult(deletedSearch).matches as Array<{
      id: string;
      deleted: boolean;
    }>;
    assert.deepEqual(
      deletedMatches.map((match) => ({ id: match.id, deleted: match.deleted })),
      [{ id: own.id, deleted: true }]
    );
    assertArtifactPayloadIsPublic(deletedSearch.json());
    const ownRestore = await batchMutation("restore", own.id);
    assert.equal(firstBatchResult(ownRestore).ok, true);
    assertArtifactPayloadIsPublic(ownRestore.json());

    const hardDeleteFixture = await uploadArtifact({
      app,
      headers: tokenHeaders,
      title: "ARTSEC scoped hard delete",
      bytes: Buffer.from("hard delete metadata", "utf8")
    });
    const ownHardDelete = await batchMutation("delete", hardDeleteFixture.id, {
      mode: "hard"
    });
    assert.equal(firstBatchResult(ownHardDelete).ok, true);
    assertArtifactPayloadIsPublic(ownHardDelete.json());

    getDatabase()
      .prepare(
        `INSERT INTO artifact_audit_events (
           id, artifact_id, event_type, actor, source, metadata_json, created_at
         ) VALUES (?, ?, 'artifact.legacy_sensitive_metadata', NULL, 'system', ?, ?)`
      )
      .run(
        "audit_artifact_security_sensitive",
        own.id,
        JSON.stringify({
          storagePath: "/private/artifact-bytes/audit.txt",
          storageKey: "sha256/private/audit.bin",
          nested: {
            extractedTextSample: "audit plaintext",
            extracted_text_sample: "legacy audit plaintext"
          },
          retained: true
        }),
        new Date().toISOString()
      );
    const safeAudit = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${own.id}/audit?limit=100`,
      headers: tokenHeaders
    });
    assert.equal(safeAudit.statusCode, 200, safeAudit.body);
    assertArtifactPayloadIsPublic(safeAudit.json());
    assert.equal(safeAudit.body.includes("extracted_text_sample"), false);
    const safeVersions = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${own.id}/versions`,
      headers: tokenHeaders
    });
    assert.equal(safeVersions.statusCode, 200, safeVersions.body);
    assertArtifactPayloadIsPublic(safeVersions.json());

    const persistedScans = getDatabase()
      .prepare(
        `SELECT scan_results_json
         FROM artifacts
         WHERE id IN (?, ?)`
      )
      .all(own.id, foreign.id) as Array<{ scan_results_json: string }>;
    assert.equal(persistedScans.length, 2);
    for (const row of persistedScans) {
      const scan = JSON.parse(row.scan_results_json) as Record<string, unknown>;
      assert.equal("extractedTextSample" in scan, false);
      assert.equal(typeof scan.extractedTextAvailable, "boolean");
    }

    const tokenDownload = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${foreign.id}/download`,
      headers: tokenHeaders
    });
    assert.equal(tokenDownload.statusCode, 401, tokenDownload.body);
    const operatorDownload = await app.inject({
      method: "GET",
      url: `/api/v1/artifacts/${foreign.id}/download`,
      headers: { cookie }
    });
    assert.equal(operatorDownload.statusCode, 200, operatorDownload.body);
    assert.equal(operatorDownload.rawPayload.equals(foreignBytes), true);

    getDatabase()
      .prepare(
        `INSERT INTO artifacts (
           id, title, original_file_name, storage_key, storage_path,
           content_sha256, byte_size, detected_extension, detected_mime_type,
           format_family, scan_results_json, created_at, updated_at,
           stored_content_sha256, stored_byte_size, content_protection_mode
         )
         SELECT ?, 'ARTSEC intentionally unowned legacy row', original_file_name,
           storage_key, storage_path, content_sha256, byte_size,
           detected_extension, detected_mime_type, format_family,
           scan_results_json, ?, ?, stored_content_sha256, stored_byte_size,
           content_protection_mode
         FROM artifacts
         WHERE id = ?`
      )
      .run(
        "artifact_unowned_legacy_security",
        new Date().toISOString(),
        new Date().toISOString(),
        foreign.id
      );
    const scopedLegacyRead = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts/artifact_unowned_legacy_security",
      headers: tokenHeaders
    });
    assert.equal(scopedLegacyRead.statusCode, 404, scopedLegacyRead.body);
    const operatorLegacyRead = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts/artifact_unowned_legacy_security",
      headers: { cookie }
    });
    assert.equal(operatorLegacyRead.statusCode, 200, operatorLegacyRead.body);
    assertArtifactPayloadIsPublic(operatorLegacyRead.json());
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
