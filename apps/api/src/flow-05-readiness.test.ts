import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import { buildWorkbenchNodeDetail } from "./services/workbench-read-model.js";
import type { AiConnectorRunResult } from "./types.js";

test("FLOW-05 redacts compound credentials and distinguishes missing run and node evidence", async () => {
  const sensitiveNode = {
    nodeId: "sensitive_node",
    nodeType: "box" as const,
    label: "Sensitive result",
    input: [],
    primaryText: "bounded",
    payload: {
      apiKey: "api-secret",
      client_secret: "client-secret",
      refreshToken: "refresh-secret",
      authorizationHeader: "Bearer secret",
      "set-cookie": "session=secret",
      "x-api-key": "header-secret",
      passwordHash: "password-hash",
      csrfToken: "csrf-secret",
      webhookSecret: "webhook-secret",
      secretAccessKey: "cloud-secret",
      tokenCount: 42,
      nested: { session_token: "nested-secret", safe: "visible" }
    },
    outputMap: {},
    tools: [],
    logs: [],
    error: null,
    timingMs: 1
  } satisfies AiConnectorRunResult["nodeResults"][number];
  const bounded = buildWorkbenchNodeDetail(sensitiveNode);
  assert.deepEqual(bounded.nodeResult.payload, {
    apiKey: "[redacted]",
    client_secret: "[redacted]",
    refreshToken: "[redacted]",
    authorizationHeader: "[redacted]",
    "set-cookie": "[redacted]",
    "x-api-key": "[redacted]",
    passwordHash: "[redacted]",
    csrfToken: "[redacted]",
    webhookSecret: "[redacted]",
    secretAccessKey: "[redacted]",
    tokenCount: 42,
    nested: { session_token: "[redacted]", safe: "visible" }
  });
  assert.equal(bounded.readMetadata.redacted, true);
  assert.deepEqual(bounded.readMetadata.redactedPaths, [
    "$.payload.apiKey",
    "$.payload.client_secret",
    "$.payload.refreshToken",
    "$.payload.authorizationHeader",
    "$.payload.set-cookie",
    "$.payload.x-api-key",
    "$.payload.passwordHash",
    "$.payload.csrfToken",
    "$.payload.webhookSecret",
    "$.payload.secretAccessKey",
    "$.payload.nested.session_token"
  ]);

  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-flow-05-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });
  try {
    const headers = { cookie: issueTestOperatorSessionCookie(app) };
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/workbench/flows",
      headers,
      payload: {
        title: "Run evidence identity",
        graph: {
          nodes: [
            {
              id: "value",
              type: "value",
              position: { x: 100, y: 100 },
              data: {
                label: "Value",
                valueType: "string",
                valueLiteral: "complete"
              }
            },
            {
              id: "output",
              type: "output",
              position: { x: 400, y: 100 },
              data: { label: "Output", outputKey: "answer" }
            }
          ],
          edges: [
            {
              id: "value_output",
              source: "value",
              target: "output",
              sourceHandle: "value",
              targetHandle: "result",
              label: null
            }
          ]
        }
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    const flowId = created.json().flow.id as string;
    const run = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/run`,
      headers,
      payload: { idempotencyKey: "flow-05-run" }
    });
    assert.equal(run.statusCode, 200, run.body);
    const runId = run.json().run.id as string;

    const missingRun = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${flowId}/runs/missing_run/nodes/missing_node`,
      headers
    });
    assert.equal(missingRun.statusCode, 404, missingRun.body);
    assert.equal(missingRun.json().error, "Workbench flow run not found");

    const missingNode = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${flowId}/runs/${runId}/nodes/missing_node`,
      headers
    });
    assert.equal(missingNode.statusCode, 404, missingNode.body);
    assert.equal(
      missingNode.json().error,
      "Workbench flow node result not found"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
