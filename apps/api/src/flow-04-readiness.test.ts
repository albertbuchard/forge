import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { recoverInterruptedAiConnectorRuns } from "./repositories/ai-connectors.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

async function waitForRunningRun(flowId: string, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = getDatabase()
      .prepare(
        `SELECT id, deadline_at
         FROM ai_connector_runs
         WHERE connector_id = ? AND status = 'running'
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .get(flowId) as { id: string; deadline_at: string | null } | undefined;
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for active Workbench run for ${flowId}.`);
}

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

    const partialFlow = await app.inject({
      method: "POST",
      url: "/api/v1/workbench/flows",
      headers,
      payload: {
        title: "Partial failure evidence",
        description: "One branch completes before another branch fails.",
        kind: "functor",
        graph: {
          nodes: [
            {
              id: "good_value",
              type: "value",
              position: { x: 100, y: 80 },
              data: {
                label: "Good value",
                description: "Completes before the failing branch.",
                valueType: "string",
                valueLiteral: "preserved"
              }
            },
            {
              id: "good_output",
              type: "output",
              position: { x: 420, y: 80 },
              data: {
                label: "Good output",
                description: "Preserves completed evidence.",
                outputKey: "good"
              }
            },
            {
              id: "failing_model",
              type: "functor",
              position: { x: 100, y: 260 },
              data: {
                label: "Missing model",
                description: "Fails because no model connection is configured.",
                prompt: "This node must fail in the readiness fixture.",
                outputs: [{ key: "answer", label: "Answer", kind: "text" }]
              }
            },
            {
              id: "failed_output",
              type: "output",
              position: { x: 420, y: 260 },
              data: {
                label: "Failed output",
                description: "Receives the unavailable model output.",
                outputKey: "failed"
              }
            }
          ],
          edges: [
            {
              id: "good_edge",
              source: "good_value",
              target: "good_output",
              sourceHandle: "value",
              targetHandle: "result",
              label: null
            },
            {
              id: "failed_edge",
              source: "failing_model",
              target: "failed_output",
              sourceHandle: "answer",
              targetHandle: "result",
              label: null
            }
          ]
        }
      }
    });
    assert.equal(partialFlow.statusCode, 201, partialFlow.body);
    const partialFlowId = partialFlow.json().flow.id as string;
    const partialRun = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${partialFlowId}/run`,
      headers,
      payload: { idempotencyKey: "flow-04-partial", debug: true }
    });
    assert.equal(partialRun.statusCode, 422, partialRun.body);
    assert.equal(partialRun.json().code, "workbench_run_failed");
    const partialDetail = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${partialFlowId}/runs/${partialRun.json().runId}`,
      headers
    });
    assert.equal(partialDetail.statusCode, 200, partialDetail.body);
    assert.equal(partialDetail.json().run.status, "failed");
    assert.deepEqual(
      partialDetail
        .json()
        .run.result.nodeResults.map((node: { nodeId: string }) => node.nodeId),
      ["good_value", "good_output"]
    );
    assert.match(partialDetail.json().run.error, /model connection/i);
    assert.match(
      partialDetail.json().run.result.debugTrace.errors[0],
      /model connection/i
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("FLOW-04 cancellation and whole-flow deadlines stop active work and preserve completed-node evidence", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-flow-04-run-control-")
  );
  const previousMockEnv = process.env.FORGE_ENABLE_DEV_MOCKS;
  process.env.FORGE_ENABLE_DEV_MOCKS = "1";
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const headers = {
      cookie: issueTestOperatorSessionCookie(app),
      host: "127.0.0.1:4317"
    };
    const connection = await app.inject({
      method: "POST",
      url: "/api/v1/settings/models/connections",
      headers,
      payload: {
        label: "FLOW-04 cancellable mock",
        provider: "mock",
        model: "mock-ignore-abort"
      }
    });
    assert.equal(connection.statusCode, 201, connection.body);
    const connectionId = connection.json().connection.id as string;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/workbench/flows",
      headers,
      payload: {
        title: "Cancellable execution contract",
        description:
          "A completed branch precedes one cancellable model branch.",
        kind: "functor",
        graph: {
          nodes: [
            {
              id: "good_value",
              type: "value",
              position: { x: 60, y: 80 },
              data: {
                label: "Preserved value",
                description: "Completes before the slow branch.",
                valueType: "string",
                valueLiteral: "preserved"
              }
            },
            {
              id: "good_output",
              type: "output",
              position: { x: 360, y: 80 },
              data: {
                label: "Preserved output",
                description: "Publishes completed evidence.",
                outputKey: "preserved"
              }
            },
            {
              id: "slow_model",
              type: "functor",
              position: { x: 60, y: 260 },
              data: {
                label: "Cancellable model",
                description:
                  "Waits for cancellation or the whole-flow deadline.",
                prompt: "Return after the bounded mock delay.",
                enabledToolKeys: [],
                outputs: [{ key: "answer", label: "Answer", kind: "text" }],
                modelConfig: {
                  connectionId,
                  provider: "mock",
                  baseUrl: "mock://workbench",
                  model: "mock-ignore-abort",
                  thinking: null,
                  verbosity: null
                }
              }
            },
            {
              id: "slow_output",
              type: "output",
              position: { x: 360, y: 260 },
              data: {
                label: "Slow output",
                description: "Would publish only if the slow model finishes.",
                outputKey: "slow"
              }
            }
          ],
          edges: [
            {
              id: "good_edge",
              source: "good_value",
              target: "good_output",
              sourceHandle: "value",
              targetHandle: "result",
              label: null
            },
            {
              id: "slow_edge",
              source: "slow_model",
              target: "slow_output",
              sourceHandle: "answer",
              targetHandle: "result",
              label: null
            }
          ]
        }
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    const flowId = created.json().flow.id as string;

    const pendingCancellation = app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/run`,
      headers,
      payload: {
        timeoutMs: 60_000,
        idempotencyKey: "flow-04-cancelled",
        debug: true
      }
    });
    const activeCancellation = await waitForRunningRun(flowId);
    assert.ok(
      Date.parse(activeCancellation.deadline_at ?? "") > Date.now() + 50_000
    );

    const unauthenticatedCancel = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/runs/${activeCancellation.id}/cancel`,
      payload: { reason: "Must not be accepted" }
    });
    assert.equal(
      unauthenticatedCancel.statusCode,
      401,
      unauthenticatedCancel.body
    );

    const cancelledAt = Date.now();
    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/runs/${activeCancellation.id}/cancel`,
      headers,
      payload: { reason: "Operator stopped the slow branch." }
    });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.headers["idempotency-replayed"], "false");
    assert.equal(cancelled.json().run.status, "cancelled");
    assert.equal(
      cancelled.json().run.cancellationReason,
      "Operator stopped the slow branch."
    );
    assert.equal(cancelled.json().run.cancellationSource, "ui");
    assert.match(cancelled.json().run.cancellationActor ?? "", /.+/);

    const stoppedRequest = await pendingCancellation;
    assert.equal(stoppedRequest.statusCode, 409, stoppedRequest.body);
    assert.equal(stoppedRequest.json().code, "workbench_run_cancelled");
    assert.ok(Date.now() - cancelledAt < 3_000);

    const cancelReplay = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/runs/${activeCancellation.id}/cancel`,
      headers,
      payload: { reason: "A changed reason cannot replace the receipt." }
    });
    assert.equal(cancelReplay.statusCode, 200, cancelReplay.body);
    assert.equal(cancelReplay.headers["idempotency-replayed"], "true");
    assert.equal(
      cancelReplay.json().run.cancellationReason,
      "Operator stopped the slow branch."
    );

    const cancelledNodes = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${flowId}/runs/${activeCancellation.id}/nodes`,
      headers
    });
    assert.equal(cancelledNodes.statusCode, 200, cancelledNodes.body);
    assert.deepEqual(
      cancelledNodes
        .json()
        .nodeResults.map((node: { nodeId: string }) => node.nodeId),
      ["good_value", "good_output"]
    );

    const timedOutStartedAt = Date.now();
    const timedOut = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/run`,
      headers,
      payload: {
        timeoutMs: 1_000,
        idempotencyKey: "flow-04-timeout",
        debug: true
      }
    });
    assert.equal(timedOut.statusCode, 408, timedOut.body);
    assert.equal(timedOut.json().code, "workbench_run_timed_out");
    assert.ok(Date.now() - timedOutStartedAt < 4_000);
    const timedOutRunId = timedOut.json().runId as string;
    const timedOutDetail = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${flowId}/runs/${timedOutRunId}`,
      headers
    });
    assert.equal(timedOutDetail.statusCode, 200, timedOutDetail.body);
    assert.equal(timedOutDetail.json().run.status, "timed_out");
    assert.equal(timedOutDetail.json().run.cancellationRequestedAt, null);
    assert.equal(
      Date.parse(timedOutDetail.json().run.deadlineAt),
      Date.parse(timedOutDetail.json().run.createdAt) + 1_000
    );
    const timedOutNodes = await app.inject({
      method: "GET",
      url: `/api/v1/workbench/flows/${flowId}/runs/${timedOutRunId}/nodes`,
      headers
    });
    assert.equal(timedOutNodes.statusCode, 200, timedOutNodes.body);
    assert.deepEqual(
      timedOutNodes
        .json()
        .nodeResults.map((node: { nodeId: string }) => node.nodeId),
      ["good_value", "good_output"]
    );

    const timeoutReplay = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/run`,
      headers,
      payload: {
        timeoutMs: 1_000,
        idempotencyKey: "flow-04-timeout",
        debug: true
      }
    });
    assert.equal(timeoutReplay.statusCode, 408, timeoutReplay.body);
    assert.equal(timeoutReplay.json().replayed, true);
    assert.equal(timeoutReplay.json().runId, timedOutRunId);

    const changedTimeoutReplay = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/run`,
      headers,
      payload: {
        timeoutMs: 2_000,
        idempotencyKey: "flow-04-timeout",
        debug: true
      }
    });
    assert.equal(
      changedTimeoutReplay.statusCode,
      409,
      changedTimeoutReplay.body
    );
    assert.equal(
      changedTimeoutReplay.json().code,
      "workbench_run_idempotency_conflict"
    );

    const changedRetryTimeout = await app.inject({
      method: "POST",
      url: `/api/v1/workbench/flows/${flowId}/run`,
      headers,
      payload: {
        retryOfRunId: timedOutRunId,
        timeoutMs: 2_000,
        idempotencyKey: "flow-04-timeout-retry"
      }
    });
    assert.equal(changedRetryTimeout.statusCode, 409, changedRetryTimeout.body);
    assert.equal(
      changedRetryTimeout.json().code,
      "workbench_retry_input_conflict"
    );
  } finally {
    if (previousMockEnv === undefined) {
      delete process.env.FORGE_ENABLE_DEV_MOCKS;
    } else {
      process.env.FORGE_ENABLE_DEV_MOCKS = previousMockEnv;
    }
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
