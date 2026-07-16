import assert from "node:assert/strict";
import { createServer } from "node:http";
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

async function uploadArtifact(app: TestApp, cookie: string, key: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/artifacts",
    headers: { cookie },
    payload: {
      idempotencyKey: key,
      originalFileName: `${key}.txt`,
      contentBase64: Buffer.from("verified direct enrichment text").toString(
        "base64"
      )
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { artifact: { id: string } }).artifact.id;
}

function insertProfile(input: {
  id: string;
  provider: string;
  baseUrl: string;
  model: string;
}) {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO wiki_llm_profiles (
         id, label, provider, base_url, model, secret_id, system_prompt,
         enabled, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, NULL, '', 1, '{}', ?, ?)`
    )
    .run(
      input.id,
      input.id,
      input.provider,
      input.baseUrl,
      input.model,
      now,
      now
    );
}

function fakeCodexToken() {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
    "base64url"
  );
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "artifact_direct_enrich_test"
      }
    })
  ).toString("base64url");
  return `${header}.${payload}.signature`;
}

test("direct enrich route persists one stable failed state for provider failure modes", async () => {
  const rawProviderContext = "private-provider-context-48219";
  const providerServer = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        model?: string;
      };
      if (body.model === "artifact-http-failure") {
        response.writeHead(502, { "content-type": "text/plain" });
        response.end(rawProviderContext);
        return;
      }
      if (body.model === "artifact-parse-failure") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(`not-json-${rawProviderContext}`);
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        `data: ${JSON.stringify({
          type: "response.failed",
          error: {
            message: rawProviderContext,
            responseBody: rawProviderContext
          }
        })}\n\n`
      );
    });
  });
  await new Promise<void>((resolve) =>
    providerServer.listen(0, "127.0.0.1", resolve)
  );
  const address = providerServer.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-artifact-direct-enrich-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const cookie = await operatorCookie(app);
    const scenarios = [
      {
        suffix: "http",
        provider: "openai-responses",
        model: "artifact-http-failure",
        apiKey: "test-platform-key"
      },
      {
        suffix: "parse",
        provider: "openai-responses",
        model: "artifact-parse-failure",
        apiKey: "test-platform-key"
      },
      {
        suffix: "stream",
        provider: "openai-codex",
        model: "artifact-stream-failure",
        apiKey: fakeCodexToken()
      }
    ];

    for (const scenario of scenarios) {
      const profileId = `wiki_llm_artifact_direct_${scenario.suffix}`;
      insertProfile({
        id: profileId,
        provider: scenario.provider,
        baseUrl,
        model: scenario.model
      });
      const artifactId = await uploadArtifact(
        app,
        cookie,
        `artifact-direct-enrich-${scenario.suffix}`
      );
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/artifacts/${artifactId}/enrich`,
        headers: { cookie },
        payload: {
          llmProfileId: profileId,
          explicitApiKey: scenario.apiKey
        }
      });
      assert.equal(response.statusCode, 500, response.body);
      assert.equal(response.body.includes(rawProviderContext), false);

      const row = getDatabase()
        .prepare(
          `SELECT enrichment_results_json
           FROM artifacts
           WHERE id = ?`
        )
        .get(artifactId) as { enrichment_results_json: string };
      assert.deepEqual(JSON.parse(row.enrichment_results_json), {
        generated: false,
        status: "failed",
        errorCode: "artifact_llm_enrichment_failed",
        generatedAt: (
          JSON.parse(row.enrichment_results_json) as { generatedAt: string }
        ).generatedAt
      });
      const failedAudit = getDatabase()
        .prepare(
          `SELECT metadata_json
           FROM artifact_audit_events
           WHERE artifact_id = ?
             AND event_type = 'artifact.enrichment_failed'
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .get(artifactId) as { metadata_json: string } | undefined;
      assert.deepEqual(JSON.parse(failedAudit?.metadata_json ?? "{}"), {
        errorCode: "artifact_llm_enrichment_failed"
      });
      const persisted = JSON.stringify({ row, failedAudit });
      assert.equal(persisted.includes(rawProviderContext), false);
    }
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) =>
      providerServer.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
