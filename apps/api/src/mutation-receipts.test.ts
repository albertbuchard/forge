import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { buildOpenApiDocument } from "./openapi.js";
import { setEntityOwner } from "./repositories/entity-ownership.js";
import { createAgentToken } from "./repositories/settings.js";
import { getTaskById } from "./repositories/tasks.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import { createAgentTokenSchema } from "./types.js";
import type { MutationReceipt } from "./services/mutation-receipts.js";

type TestApp = Awaited<ReturnType<typeof buildServer>>;

async function withTestServer(run: (app: TestApp, cookie: string) => Promise<void>) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-receipts-"));
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    devrageMetricSync: false
  });
  const cookie = issueTestOperatorSessionCookie(app);
  try {
    await run(app, cookie);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function receiptFrom(body: unknown) {
  return (body as { mutationReceipt: MutationReceipt }).mutationReceipt;
}

function issueScopedToken(label: string) {
  return createAgentToken(
    createAgentTokenSchema.parse({
      label,
      agentLabel: label,
      scopes: ["read", "write"],
      scopePolicy: {
        userIds: ["user_operator"],
        projectIds: [],
        tagIds: []
      }
    }),
    { actor: "Mutation receipt test", source: "system" }
  ).token;
}

test("mutation receipt OpenAPI publishes bounded owner-scoped Undo", () => {
  const document = buildOpenApiDocument() as {
    tags?: Array<{ name: string }>;
    components?: { schemas?: Record<string, unknown> };
    paths?: Record<string, Record<string, unknown>>;
  };
  assert.ok(document.tags?.some((tag) => tag.name === "Mutation Receipts"));
  assert.ok(document.components?.schemas?.MutationReceipt);
  assert.ok(document.paths?.["/api/v1/mutation-receipts"]?.get);
  assert.ok(document.paths?.["/api/v1/mutation-receipts/{id}/undo"]?.post);
  const taskDelete = document.paths?.["/api/v1/tasks/{id}"]?.delete as {
    parameters?: Array<{ name?: string; in?: string }>;
  };
  assert.ok(
    taskDelete.parameters?.some(
      (parameter) => parameter.name === "mode" && parameter.in === "query"
    )
  );
});

test("task moves have expiring idempotent receipts and reject stale inverses", async () => {
  await withTestServer(async (app, cookie) => {
    const taskId = "task_flagship_review";
    setEntityOwner("task", taskId, "user_operator");
    const originalDescription = getTaskById(taskId)!.description;
    const original = getTaskById(taskId)!;
    const movedStatus = original.status === "focus" ? "backlog" : "focus";
    const moved = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      headers: { cookie },
      payload: { status: movedStatus }
    });
    assert.equal(moved.statusCode, 200, moved.body);
    const receipt = receiptFrom(moved.json());
    assert.equal(receipt.status, "available");
    assert.equal(receipt.operation, "task_update");
    assert.equal(receipt.ownerUserId, "user_operator");

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/mutation-receipts?limit=5&userIds=user_operator",
      headers: { cookie }
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(
      (listed.json() as { receipts: MutationReceipt[] }).receipts[0]?.id,
      receipt.id
    );

    const missingKey = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${receipt.id}/undo`,
      headers: { cookie }
    });
    assert.equal(missingKey.statusCode, 400);

    const undoHeaders = { cookie, "idempotency-key": "undo_task_move_1" };
    const undone = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${receipt.id}/undo`,
      headers: undoHeaders
    });
    assert.equal(undone.statusCode, 200, undone.body);
    assert.equal(
      (undone.json() as { receipt: MutationReceipt }).receipt.status,
      "undone"
    );
    assert.equal(getTaskById(taskId)?.status, original.status);

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${receipt.id}/undo`,
      headers: undoHeaders
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.headers["idempotency-replayed"], "true");
    assert.equal((replay.json() as { replayed: boolean }).replayed, true);

    const differentKey = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${receipt.id}/undo`,
      headers: { cookie, "idempotency-key": "undo_task_move_2" }
    });
    assert.equal(differentKey.statusCode, 409);

    const firstTitleChange = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      headers: { cookie },
      payload: { title: "Receipt title one" }
    });
    const firstTitleReceipt = receiptFrom(firstTitleChange.json());
    await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      headers: { cookie },
      payload: { title: "Receipt title two" }
    });
    const conflicted = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${firstTitleReceipt.id}/undo`,
      headers: { cookie, "idempotency-key": "undo_stale_title" }
    });
    assert.equal(conflicted.statusCode, 409, conflicted.body);
    assert.equal(
      (conflicted.json() as { receipt: MutationReceipt }).receipt.status,
      "conflicted"
    );
    assert.equal(getTaskById(taskId)?.title, "Receipt title two");
  });
});

test("metadata edits and soft deletes undo while permanent deletes explain the limit", async () => {
  await withTestServer(async (app, cookie) => {
    const metadataTaskId = "task_plugin_surface";
    setEntityOwner("task", metadataTaskId, "user_operator");
    const originalDescription = getTaskById(metadataTaskId)!.description;
    const metadataUpdate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers: { cookie },
      payload: {
        atomic: true,
        operations: [
          {
            entityType: "task",
            id: metadataTaskId,
            patch: { description: "Receipt metadata edit" }
          }
        ]
      }
    });
    assert.equal(metadataUpdate.statusCode, 200, metadataUpdate.body);
    const metadataReceipt = (
      metadataUpdate.json() as {
        results: Array<{ mutationReceipt: MutationReceipt }>;
      }
    ).results[0]!.mutationReceipt;
    assert.equal(metadataReceipt.operation, "entity_update");
    const metadataUndo = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${metadataReceipt.id}/undo`,
      headers: { cookie, "idempotency-key": "undo_metadata" }
    });
    assert.equal(metadataUndo.statusCode, 200, metadataUndo.body);
    assert.equal(getTaskById(metadataTaskId)?.description, originalDescription);

    const calendarCreate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "calendar_event",
            data: {
              title: "Receipt projection review",
              startAt: "2026-08-10T08:00:00.000Z",
              endAt: "2026-08-10T09:00:00.000Z",
              timezone: "Europe/Zurich",
              preferredCalendarId: null,
              links: []
            }
          }
        ]
      }
    });
    assert.equal(calendarCreate.statusCode, 200, calendarCreate.body);
    const calendarId = (
      calendarCreate.json() as {
        results: Array<{ entity?: { id?: string } }>;
      }
    ).results[0]?.entity?.id;
    assert.ok(calendarId);
    const calendarUpdate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "calendar_event",
            id: calendarId,
            patch: { title: "Receipt projection review moved" }
          }
        ]
      }
    });
    assert.equal(calendarUpdate.statusCode, 200, calendarUpdate.body);
    const calendarReceipt = (
      calendarUpdate.json() as {
        results: Array<{ mutationReceipt: MutationReceipt }>;
      }
    ).results[0]!.mutationReceipt;
    assert.equal(calendarReceipt.status, "not_reversible");
    assert.match(calendarReceipt.explanation, /remote calendar/i);
    const calendarUndo = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${calendarReceipt.id}/undo`,
      headers: { cookie, "idempotency-key": "undo_projected_calendar" }
    });
    assert.equal(calendarUndo.statusCode, 409, calendarUndo.body);

    const softTaskId = "task_weekly_review";
    setEntityOwner("task", softTaskId, "user_operator");
    const softDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/tasks/${softTaskId}`,
      headers: { cookie }
    });
    assert.equal(softDelete.statusCode, 200, softDelete.body);
    const softReceipt = receiptFrom(softDelete.json());
    assert.equal(softReceipt.operation, "entity_soft_delete");
    assert.equal(getTaskById(softTaskId), undefined);
    const softUndo = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${softReceipt.id}/undo`,
      headers: { cookie, "idempotency-key": "undo_soft_delete" }
    });
    assert.equal(softUndo.statusCode, 200, softUndo.body);
    assert.ok(getTaskById(softTaskId));

    const hardTaskId = "task_recovery_walk";
    setEntityOwner("task", hardTaskId, "user_operator");
    const hardDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/tasks/${hardTaskId}?mode=hard`,
      headers: { cookie }
    });
    assert.equal(hardDelete.statusCode, 200, hardDelete.body);
    const hardReceipt = receiptFrom(hardDelete.json());
    assert.equal(hardReceipt.status, "not_reversible");
    assert.match(hardReceipt.explanation, /permanently deleted/i);
    const hardUndo = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${hardReceipt.id}/undo`,
      headers: { cookie, "idempotency-key": "undo_hard_delete" }
    });
    assert.equal(hardUndo.statusCode, 409);
    assert.equal(getTaskById(hardTaskId), undefined);
  });
});

test("Attention receipts restore state and source changes stop unsafe Undo", async () => {
  await withTestServer(async (app, cookie) => {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO insights (
           id, origin_type, origin_agent_id, origin_label, visibility, status,
           entity_type, entity_id, timeframe_label, title, summary,
           recommendation, rationale, confidence, cta_label, evidence_json,
           created_at, updated_at
         ) VALUES (?, 'agent', NULL, 'Codex', 'visible', 'open', 'task', ?,
           'Today', ?, ?, ?, '', 0.9, 'Review insight', '[]', ?, ?)`
      )
      .run(
        "ins_receipt_review",
        "task_flagship_review",
        "Review receipt evidence",
        "A reversible Attention fixture.",
        "Review the evidence.",
        now,
        now
      );
    setEntityOwner("insight", "ins_receipt_review", "user_operator");
    const queue = await app.inject({
      method: "GET",
      url: "/api/v1/attention-inbox?limit=100",
      headers: { cookie }
    });
    const item = (
      queue.json() as {
        items: Array<{ id: string; allowedActions: string[] }>;
      }
    ).items.find((candidate) => candidate.id === "attn:insight:ins_receipt_review");
    assert.ok(item);
    assert.ok(item.allowedActions.includes("dismiss"));
    const dismissed = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(item.id)}/dismiss`,
      headers: { cookie },
      payload: { note: "Reviewed" }
    });
    assert.equal(dismissed.statusCode, 200, dismissed.body);
    const receipt = receiptFrom(dismissed.json());
    assert.equal(receipt.operation, "attention_state");
    const undone = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${receipt.id}/undo`,
      headers: { cookie, "idempotency-key": "undo_attention" }
    });
    assert.equal(undone.statusCode, 200, undone.body);
    assert.equal(
      (
        undone.json() as {
          result: { attentionState: { state: string } };
        }
      ).result.attentionState.state,
      "active"
    );

    const dismissedAgain = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(item.id)}/dismiss`,
      headers: { cookie },
      payload: {}
    });
    const staleReceipt = receiptFrom(dismissedAgain.json());
    getDatabase()
      .prepare("UPDATE insights SET updated_at = ? WHERE id = ?")
      .run(new Date(Date.now() + 1_000).toISOString(), "ins_receipt_review");
    const staleUndo = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${staleReceipt.id}/undo`,
      headers: { cookie, "idempotency-key": "undo_stale_attention" }
    });
    assert.equal(staleUndo.statusCode, 409, staleUndo.body);
    assert.equal(
      (staleUndo.json() as { receipt: MutationReceipt }).receipt.status,
      "conflicted"
    );
  });
});

test("receipts expire and remain isolated between token principals", async () => {
  await withTestServer(async (app, cookie) => {
    const taskId = "task_flagship_review";
    const originalDescription = getTaskById(taskId)?.description;
    setEntityOwner("task", taskId, "user_operator");
    const tokenA = issueScopedToken("Receipt agent A");
    const tokenB = issueScopedToken("Receipt agent B");
    const changed = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { description: "Token A receipt" }
    });
    assert.equal(changed.statusCode, 200, changed.body);
    const receipt = receiptFrom(changed.json());
    const ownList = await app.inject({
      method: "GET",
      url: "/api/v1/mutation-receipts",
      headers: { authorization: `Bearer ${tokenA}` }
    });
    assert.equal(ownList.statusCode, 200, ownList.body);
    assert.equal(
      (ownList.json() as { receipts: MutationReceipt[] }).receipts[0]?.id,
      receipt.id
    );
    const foreignList = await app.inject({
      method: "GET",
      url: "/api/v1/mutation-receipts",
      headers: { authorization: `Bearer ${tokenB}` }
    });
    assert.equal(foreignList.statusCode, 200, foreignList.body);
    assert.deepEqual(
      (foreignList.json() as { receipts: MutationReceipt[] }).receipts,
      []
    );
    const foreignUndo = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${receipt.id}/undo`,
      headers: {
        authorization: `Bearer ${tokenB}`,
        "idempotency-key": "foreign_undo"
      }
    });
    assert.equal(foreignUndo.statusCode, 404);
    const ownUndo = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${receipt.id}/undo`,
      headers: {
        authorization: `Bearer ${tokenA}`,
        "idempotency-key": "token_owner_undo"
      }
    });
    assert.equal(ownUndo.statusCode, 200, ownUndo.body);
    assert.equal(getTaskById(taskId)?.description, originalDescription);

    const operatorChange = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      headers: { cookie },
      payload: { description: "Expired receipt target" }
    });
    const expiredReceipt = receiptFrom(operatorChange.json());
    getDatabase()
      .prepare("UPDATE mutation_receipts SET expires_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", expiredReceipt.id);
    const expiredUndo = await app.inject({
      method: "POST",
      url: `/api/v1/mutation-receipts/${expiredReceipt.id}/undo`,
      headers: { cookie, "idempotency-key": "expired_undo" }
    });
    assert.equal(expiredUndo.statusCode, 409);
    assert.equal(
      (expiredUndo.json() as { receipt: MutationReceipt }).receipt.status,
      "expired"
    );
    assert.equal(getTaskById(taskId)?.description, "Expired receipt target");
  });
});
