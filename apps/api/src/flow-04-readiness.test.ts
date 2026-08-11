import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { recoverInterruptedAiConnectorRuns } from "./repositories/ai-connectors.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("FLOW-04 preserves one durable run receipt across replay, contention, restart, and retry", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-flow-04-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const headers = { cookie: issueTestOperatorSessionCookie(app) };
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/workbench/flows",
      headers,
      payload: {
        title: "Durable execution contract",
        description: "FLOW-04 readiness fixture",
        kind: "functor",
        graph: {
          nodes: [
            {
              id: "value",
              type: "value",
              position: { x: 100, y: 100 },
              data: {
                label: "Value",
                description: "Stable execution value",
                valueType: "string",
                valueLiteral: "completed"
              }
            },
            {
              id: "output",
              type: "output",
              position: { x: 420, y: 100 },
              data: {
                label: "Output",
                description: "Publishes the value",
                outputKey: "answer"
              }
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
    const exactPayload = {
      userInput: "first input",
      inputs: {},
      context: { origin: "FLOW-04" },
      idempotencyKey: "flow-04-exact-run",
      debug: true
    };

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/run`,
      headers,
      payload: exactPayload
    });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.headers["idempotency-replayed"], "false");
    const firstRunId = first.json().run.id as string;

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/run`,
      headers,
      payload: exactPayload
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.headers["idempotency-replayed"], "true");
    assert.equal(replay.json().run.id, firstRunId);

    const changedReplay = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/run`,
      headers,
      payload: { ...exactPayload, userInput: "changed input" }
    });
    assert.equal(changedReplay.statusCode, 409, changedReplay.body);
    assert.equal(
      changedReplay.json().code,
      "workbench_run_idempotency_conflict"
    );

    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO ai_connector_runs (
          id, connector_id, mode, status, user_input, inputs_json, context_json,
          conversation_id, retry_of_run_id, flow_snapshot_json, flow_updated_at,
          result_json, error, created_at, completed_at
        ) VALUES (?, ?, 'run', 'running', ?, '{}', ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL)`
      )
      .run(
        "aicr_interrupted",
        flowId,
        "stored interrupted input",
        JSON.stringify({ durable: true }),
        now
      );

    const overlapping = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/run`,
      headers,
      payload: { idempotencyKey: "flow-04-overlap" }
    });
    assert.equal(overlapping.statusCode, 409, overlapping.body);
    assert.equal(overlapping.json().code, "workbench_run_in_progress");
    assert.equal(overlapping.json().runId, "aicr_interrupted");

    assert.equal(recoverInterruptedAiConnectorRuns(), 1);
    const interrupted = getDatabase()
      .prepare(
        `SELECT status, error, completed_at
         FROM ai_connector_runs
         WHERE id = 'aicr_interrupted'`
      )
      .get() as { status: string; error: string; completed_at: string | null };
    assert.equal(interrupted.status, "failed");
    assert.equal(
      interrupted.error,
      "Forge restarted before this Workbench run completed."
    );
    assert.match(interrupted.completed_at ?? "", /^\d{4}-/);

    const changedRetry = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/run`,
      headers,
      payload: {
        retryOfRunId: "aicr_interrupted",
        userInput: "different input",
        idempotencyKey: "flow-04-retry"
      }
    });
    assert.equal(changedRetry.statusCode, 409, changedRetry.body);
    assert.equal(changedRetry.json().code, "workbench_retry_input_conflict");

    const exactRetry = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/run`,
      headers,
      payload: {
        retryOfRunId: "aicr_interrupted",
        idempotencyKey: "flow-04-retry"
      }
    });
    assert.equal(exactRetry.statusCode, 200, exactRetry.body);
    assert.equal(exactRetry.json().run.retryOfRunId, "aicr_interrupted");
    assert.equal(exactRetry.json().run.userInput, "stored interrupted input");
    assert.deepEqual(exactRetry.json().run.context, { durable: true });

    const receipts = getDatabase()
      .prepare(
        `SELECT id, status, idempotency_key, request_fingerprint
         FROM ai_connector_runs
         WHERE connector_id = ?
         ORDER BY created_at, id`
      )
      .all(flowId) as Array<Record<string, unknown>>;
    assert.equal(receipts.length, 3);
    assert.deepEqual(
      receipts.map((row) => row.status),
      ["completed", "failed", "completed"]
    );
    assert.equal(receipts[0]?.idempotency_key, "flow-04-exact-run");
    assert.match(String(receipts[0]?.request_fingerprint), /^[0-9a-f]{64}$/);
    assert.equal(receipts[2]?.idempotency_key, "flow-04-retry");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
