import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("FLOW-06 never publishes partial node evidence from a failed latest run", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-flow-06-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const headers = { cookie: issueTestOperatorSessionCookie(app) };
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/workbench/flows",
      headers,
      payload: {
        title: "Published node boundary",
        graph: {
          nodes: [
            {
              id: "value",
              type: "value",
              position: { x: 100, y: 100 },
              data: {
                label: "Value",
                valueType: "string",
                valueLiteral: "published"
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
    const flow = created.json().flow as {
      id: string;
      title: string;
      updatedAt: string;
      graph: Record<string, unknown>;
      publicInputs: unknown[];
      publishedOutputs: unknown[];
    };
    const flowSnapshot = JSON.stringify({
      title: flow.title,
      updatedAt: flow.updatedAt,
      graph: flow.graph,
      publicInputs: flow.publicInputs,
      publishedOutputs: flow.publishedOutputs
    });
    const database = getDatabase();
    const insertRun = database.prepare(
      `INSERT INTO ai_connector_runs (
        id, connector_id, mode, status, user_input, inputs_json, context_json,
        conversation_id, retry_of_run_id, flow_snapshot_json, flow_updated_at,
        result_json, error, created_at, completed_at
      ) VALUES (?, ?, 'run', ?, '', '{}', '{}', NULL, NULL, ?, ?, ?, ?, ?, ?)`
    );
    const nodeResult = (text: string) => ({
      nodeId: "value",
      nodeType: "value",
      label: "Value",
      input: [],
      primaryText: text,
      payload: null,
      outputMap: { value: { text, json: null } },
      tools: [],
      logs: [],
      error: null,
      timingMs: 1
    });
    const result = (text: string) => ({
      primaryText: text,
      outputs: {},
      nodeResults: [nodeResult(text)]
    });
    insertRun.run(
      "aicr_completed_source",
      flow.id,
      "completed",
      flowSnapshot,
      flow.updatedAt,
      JSON.stringify(result("published")),
      null,
      "2026-08-11T10:00:00.000Z",
      "2026-08-11T10:00:01.000Z"
    );
    insertRun.run(
      "aicr_failed_latest",
      flow.id,
      "failed",
      flowSnapshot,
      flow.updatedAt,
      JSON.stringify(result("partial-not-published")),
      "Later branch failed.",
      "2026-08-11T11:00:00.000Z",
      "2026-08-11T11:00:01.000Z"
    );
    const insertNode = database.prepare(
      `INSERT INTO ai_connector_node_results (
        run_id, connector_id, node_id, node_type, label, result_json, created_at
      ) VALUES (?, ?, 'value', 'value', 'Value', ?, ?)`
    );
    insertNode.run(
      "aicr_completed_source",
      flow.id,
      JSON.stringify(nodeResult("published")),
      "2026-08-11T10:00:01.000Z"
    );
    insertNode.run(
      "aicr_failed_latest",
      flow.id,
      JSON.stringify(nodeResult("partial-not-published")),
      "2026-08-11T11:00:01.000Z"
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${flow.id}/nodes/value/output`,
      headers
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().state, "available");
    assert.equal(response.json().latestRun.id, "aicr_failed_latest");
    assert.equal(response.json().latestRun.status, "failed");
    assert.equal(response.json().run.id, "aicr_completed_source");
    assert.equal(response.json().run.status, "completed");
    assert.equal(response.json().nodeResult.primaryText, "published");
    assert.notEqual(
      response.json().nodeResult.primaryText,
      "partial-not-published"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
