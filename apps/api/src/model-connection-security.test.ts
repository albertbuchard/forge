import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

test("saved model credentials stay bound to their stored target and require an operator", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-model-connection-security-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        output: [{ content: [{ type: "output_text", text: "ok" }] }],
        choices: [{ message: { content: "ok" } }]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const connectionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/models/connections",
      headers: { cookie },
      payload: {
        label: "Stored OpenAI",
        provider: "openai-api",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4-mini",
        apiKey: "stored-secret-key"
      }
    });
    assert.equal(connectionResponse.statusCode, 201);
    const connectionId = (
      connectionResponse.json() as { connection: { id: string } }
    ).connection.id;

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: { cookie },
      payload: {
        label: "Model settings writer",
        agentLabel: "Model settings writer",
        scopes: ["write"]
      }
    });
    assert.equal(tokenResponse.statusCode, 201);
    const token = (tokenResponse.json() as { token: { token: string } }).token
      .token;

    const agentAttempt = await app.inject({
      method: "POST",
      url: "/api/v1/settings/models/connections/test",
      headers: { authorization: `Bearer ${token}` },
      payload: { connectionId, model: "gpt-5.4-mini" }
    });
    assert.equal(agentAttempt.statusCode, 403);
    assert.equal(fetchCalls.length, 0);

    const overriddenWithoutKey = await app.inject({
      method: "POST",
      url: "/api/v1/settings/models/connections/test",
      headers: { cookie },
      payload: {
        connectionId,
        provider: "openai-compatible",
        baseUrl: "https://attacker.example.test/v1",
        model: "attacker-model"
      }
    });
    assert.equal(overriddenWithoutKey.statusCode, 400);
    assert.equal(
      (overriddenWithoutKey.json() as { code: string }).code,
      "saved_model_credential_binding_mismatch"
    );
    assert.equal(fetchCalls.length, 0);

    const overriddenWithFreshKey = await app.inject({
      method: "POST",
      url: "/api/v1/settings/models/connections/test",
      headers: { cookie },
      payload: {
        connectionId,
        provider: "openai-compatible",
        baseUrl: "https://attacker.example.test/v1",
        model: "attacker-model",
        apiKey: "caller-supplied-key"
      }
    });
    assert.equal(overriddenWithFreshKey.statusCode, 200);
    assert.equal(fetchCalls.length, 1);
    assert.match(
      fetchCalls[0]!.url,
      /^https:\/\/attacker\.example\.test\/v1\//
    );
    const headers = new Headers(fetchCalls[0]!.init?.headers);
    assert.equal(headers.get("authorization"), "Bearer caller-supplied-key");
    assert.notEqual(headers.get("authorization"), "Bearer stored-secret-key");
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
