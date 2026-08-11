import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("FLOW-07 rejects missing and foreign conversations identically before creating a run", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-flow-07-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const headers = { cookie: issueTestOperatorSessionCookie(app) };
    const createFlow = async (title: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/workbench/flows",
        headers,
        payload: {
          title,
          kind: "chat",
          graph: {
            nodes: [
              {
                id: "value",
                type: "value",
                position: { x: 100, y: 100 },
                data: {
                  label: "Value",
                  valueType: "string",
                  valueLiteral: "reply"
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
      assert.equal(response.statusCode, 201, response.body);
      return response.json().flow.id as string;
    };
    const sourceFlowId = await createFlow("Source chat flow");
    const targetFlowId = await createFlow("Target chat flow");
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO ai_connector_conversations (
          id, connector_id, provider, external_conversation_id,
          transcript_json, created_at, updated_at
        ) VALUES (?, ?, NULL, NULL, ?, ?, ?)`
      )
      .run(
        "aicv_foreign",
        sourceFlowId,
        JSON.stringify([
          { role: "user", text: "source-only context", createdAt: now }
        ]),
        now,
        now
      );

    const attempt = (conversationId: string, idempotencyKey: string) =>
      app.inject({
        method: "POST",
        url: `/api/v1/workbench/flows/${targetFlowId}/chat`,
        headers,
        payload: { conversationId, idempotencyKey, userInput: "continue" }
      });
    const foreign = await attempt("aicv_foreign", "flow-07-foreign");
    const missing = await attempt("aicv_missing", "flow-07-missing");
    assert.equal(foreign.statusCode, 404, foreign.body);
    assert.equal(missing.statusCode, 404, missing.body);
    assert.deepEqual(foreign.json(), missing.json());
    assert.equal(foreign.json().code, "workbench_conversation_not_found");
    assert.equal(
      foreign.json().error,
      "The Workbench conversation is unavailable for this flow."
    );
    const targetRuns = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM ai_connector_runs
         WHERE connector_id = ?`
      )
      .get(targetFlowId) as { count: number };
    assert.equal(targetRuns.count, 0);
    const retained = getDatabase()
      .prepare(
        `SELECT connector_id, transcript_json
         FROM ai_connector_conversations
         WHERE id = 'aicv_foreign'`
      )
      .get() as { connector_id: string; transcript_json: string };
    assert.equal(retained.connector_id, sourceFlowId);
    assert.deepEqual(JSON.parse(retained.transcript_json), [
      { role: "user", text: "source-only context", createdAt: now }
    ]);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
