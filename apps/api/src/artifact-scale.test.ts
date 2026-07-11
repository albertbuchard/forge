import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";

const ARTIFACT_COUNT = 10_000;

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

function seedArtifactMetadata() {
  const database = getDatabase();
  database
    .prepare(
      `INSERT INTO artifact_blobs (
        content_sha256, storage_key, byte_size, detected_mime_type, created_at,
        stored_content_sha256, stored_byte_size, content_protection_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "scale-hash",
      "sha256/sc/al/scale-hash.bin",
      2048,
      "application/pdf",
      "2026-01-01T00:00:00.000Z",
      "scale-hash",
      2048,
      "plaintext"
    );
  const insertArtifact = database.prepare(
    `INSERT INTO artifacts (
      id, title, short_description, description, original_file_name,
      storage_key, storage_path, content_sha256, byte_size, detected_extension,
      declared_mime_type, detected_mime_type, format_family, source_kind,
      source_label, artifact_state, danger_score, danger_level, download_policy,
      scan_results_json, enrichment_results_json, metadata_json, created_at,
      updated_at, stored_content_sha256, stored_byte_size, content_protection_mode
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )`
  );
  const insertLink = database.prepare(
    `INSERT INTO entity_links (
      source_entity_type, source_entity_id, target_entity_type, target_entity_id,
      anchor_key, relationship, created_by_actor, created_at
    ) VALUES ('artifact', ?, 'goal', 'goal_artifact_scale', '', 'evidence',
      'scale-test', ?)`
  );

  database.exec("BEGIN");
  try {
    for (let index = 0; index < ARTIFACT_COUNT; index += 1) {
      const suffix = String(index).padStart(5, "0");
      const dangerLevel = ["low", "moderate", "high", "blocked"][index % 4];
      const artifactState = [
        "active",
        "quarantined",
        "blocked",
        "archived",
        "metadata_only"
      ][index % 5];
      const formatFamily = [
        "spreadsheet",
        "document",
        "presentation",
        "pdf",
        "text",
        "structured_text",
        "image"
      ][index % 7];
      const timestamp = new Date(
        Date.UTC(2026, 0, 1, 0, 0, index)
      ).toISOString();
      insertArtifact.run(
        `artifact_scale_${suffix}`,
        `Quarterly evidence ${suffix}`,
        `Summary ${suffix}`,
        `Long searchable description for record ${suffix}`,
        `evidence-${suffix}.${formatFamily === "image" ? "png" : "pdf"}`,
        "sha256/sc/al/scale-hash.bin",
        "/tmp/scale-hash.bin",
        "scale-hash",
        2048,
        formatFamily === "image" ? "png" : "pdf",
        "application/pdf",
        "application/pdf",
        formatFamily,
        "upload",
        `Imported source ${index % 100}`,
        artifactState,
        index % 101,
        dangerLevel,
        "human_only",
        JSON.stringify({
          findings: [
            {
              code: `risk_${index % 12}`,
              severity: dangerLevel,
              message: "Synthetic scan result ".repeat(8)
            }
          ],
          extractedTextSample: "sample ".repeat(60)
        }),
        JSON.stringify({
          status: "complete",
          summary: "enrichment ".repeat(30)
        }),
        JSON.stringify({
          owner: `owner_${index % 20}`,
          period: `Q${(index % 4) + 1}`,
          notes: "metadata ".repeat(20)
        }),
        timestamp,
        timestamp,
        "scale-hash",
        2048,
        "plaintext"
      );
      if (index === 9999) {
        insertLink.run(`artifact_scale_${suffix}`, timestamp);
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

test("artifact metadata lists stay bounded and indexed at 10,000 records", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-scale-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    seedArtifactMetadata();

    const firstStartedAt = performance.now();
    const firstPage = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts?limit=50&offset=0",
      headers: { cookie }
    });
    const firstPageMs = performance.now() - firstStartedAt;
    assert.equal(firstPage.statusCode, 200);
    const firstBody = firstPage.json() as {
      artifacts: Array<Record<string, unknown>>;
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };
    assert.equal(firstBody.total, ARTIFACT_COUNT);
    assert.equal(firstBody.artifacts.length, 50);
    assert.equal(firstBody.limit, 50);
    assert.equal(firstBody.offset, 0);
    assert.equal(firstBody.hasMore, true);
    assert.ok(Buffer.byteLength(firstPage.body) < 60_000);
    assert.equal(firstBody.artifacts[0]?.description, undefined);
    assert.equal(firstBody.artifacts[0]?.scanResults, undefined);
    assert.equal(firstBody.artifacts[0]?.storagePath, undefined);
    assert.ok(firstPageMs < 1_000);

    const deepStartedAt = performance.now();
    const deepPage = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts?limit=50&offset=9500",
      headers: { cookie }
    });
    const deepPageMs = performance.now() - deepStartedAt;
    assert.equal(deepPage.statusCode, 200);
    assert.equal(
      (deepPage.json() as { artifacts: unknown[] }).artifacts.length,
      50
    );
    assert.ok(deepPageMs < 1_000);

    const searchStartedAt = performance.now();
    const searchPage = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts?query=quarterly%20evidence%2009999&limit=50",
      headers: { cookie }
    });
    const searchPageMs = performance.now() - searchStartedAt;
    assert.equal(searchPage.statusCode, 200);
    const searchBody = searchPage.json() as {
      artifacts: Array<{
        id: string;
        links: Array<{ targetEntityId: string }>;
      }>;
      total: number;
    };
    assert.equal(searchBody.total, 1);
    assert.equal(searchBody.artifacts[0]?.id, "artifact_scale_09999");
    assert.ok(searchPageMs < 1_000);

    const linkedPage = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts?linkedEntityType=goal&linkedEntityId=goal_artifact_scale",
      headers: { cookie }
    });
    assert.equal(linkedPage.statusCode, 200);
    const linkedBody = linkedPage.json() as {
      artifacts: Array<{ links: Array<{ targetEntityId: string }> }>;
      total: number;
    };
    assert.equal(linkedBody.total, 1);
    assert.equal(
      linkedBody.artifacts[0]?.links[0]?.targetEntityId,
      "goal_artifact_scale"
    );

    const mixedStatePage = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts?artifactState=quarantined&dangerLevel=high&formatFamily=pdf&limit=50",
      headers: { cookie }
    });
    assert.equal(mixedStatePage.statusCode, 200);
    assert.ok((mixedStatePage.json() as { total: number }).total > 0);

    const oversizedPage = await app.inject({
      method: "GET",
      url: "/api/v1/artifacts?limit=101",
      headers: { cookie }
    });
    assert.equal(oversizedPage.statusCode, 400);

    const database = getDatabase();
    const orderedPlan = database
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id FROM artifacts
         WHERE NOT EXISTS (
           SELECT 1 FROM deleted_entities
           WHERE deleted_entities.entity_type = 'artifact'
             AND deleted_entities.entity_id = artifacts.id
         )
         ORDER BY updated_at DESC, id ASC LIMIT 50 OFFSET 9500`
      )
      .all() as Array<{ detail: string }>;
    assert.ok(
      orderedPlan.some((step) =>
        step.detail.includes("idx_artifacts_updated_id")
      )
    );
    assert.equal(
      orderedPlan.some((step) => step.detail.includes("TEMP B-TREE")),
      false
    );
    const searchPlan = database
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT rowid FROM artifact_search
         WHERE artifact_search MATCH ?`
      )
      .all('"quarterly"* AND "09999"*') as Array<{ detail: string }>;
    assert.ok(
      searchPlan.some((step) => step.detail.includes("VIRTUAL TABLE INDEX"))
    );

    console.info(
      JSON.stringify({
        artifactCount: ARTIFACT_COUNT,
        firstPageMs: Number(firstPageMs.toFixed(2)),
        deepPageMs: Number(deepPageMs.toFixed(2)),
        searchPageMs: Number(searchPageMs.toFixed(2)),
        firstPageBytes: Buffer.byteLength(firstPage.body)
      })
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
