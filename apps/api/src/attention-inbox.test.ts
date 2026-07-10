import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase, runInTransaction } from "./db.js";
import { buildOpenApiDocument } from "./openapi.js";
import { setEntityOwner } from "./repositories/entity-ownership.js";
import { listTasks } from "./repositories/tasks.js";
import { listAttentionInbox } from "./services/attention-inbox.js";
import type { AttentionInboxPayload } from "./types.js";

test("attention inbox OpenAPI documents its bounded read and action contract", () => {
  const document = buildOpenApiDocument() as {
    tags?: Array<{ name: string }>;
    components?: { schemas?: Record<string, unknown> };
    paths?: Record<
      string,
      {
        get?: { tags?: string[]; description?: string };
        post?: { description?: string };
      }
    >;
  };
  assert.ok(document.tags?.some((tag) => tag.name === "Attention"));
  assert.ok(document.components?.schemas?.AttentionInboxItem);
  assert.ok(document.components?.schemas?.AttentionInboxPayload);
  assert.deepEqual(document.paths?.["/api/v1/attention-inbox"]?.get?.tags, [
    "Attention"
  ]);
  assert.match(
    document.paths?.["/api/v1/attention-inbox"]?.get?.description ?? "",
    /Tokens receive only task and insight records allowed by their user, project, and tag scope/
  );
  assert.match(
    document.paths?.["/api/v1/attention-inbox/{id}/dismiss"]?.post
      ?.description ?? "",
    /Blocked and overdue work cannot be dismissed/
  );
  assert.ok(document.paths?.["/api/v1/attention-inbox/{id}/snooze"]);
  assert.ok(document.paths?.["/api/v1/attention-inbox/{id}/restore"]);
});

test("attention audit repair migration preserves existing state after a partial historical migration", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-attention-repair-")
  );
  let app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO attention_inbox_states (
           actor_key, item_id, status, snoozed_until, source_updated_at, note,
           created_at, updated_at
         ) VALUES ('operator', 'attn:test:preserved', 'dismissed', NULL, ?, '', ?, ?)`
      )
      .run(now, now, now);
    getDatabase().exec("DROP TABLE attention_inbox_state_events");
    getDatabase()
      .prepare("DELETE FROM migrations WHERE id = ?")
      .run("077_attention_inbox_audit_repair.sql");
    await app.close();
    closeDatabase();

    app = await buildServer({ dataRoot: rootDir, seedDemoData: false });
    const repairedTable = getDatabase()
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table' AND name = 'attention_inbox_state_events'`
      )
      .get() as { name: string } | undefined;
    assert.equal(repairedTable?.name, "attention_inbox_state_events");
    const preservedState = getDatabase()
      .prepare(
        `SELECT status
         FROM attention_inbox_states
         WHERE actor_key = 'operator' AND item_id = 'attn:test:preserved'`
      )
      .get() as { status: string } | undefined;
    assert.equal(preservedState?.status, "dismissed");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("attention state repair migration preserves legacy rows and permits restore to active", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-attention-state-repair-")
  );
  let app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const now = new Date().toISOString();
    getDatabase().exec(`
      DROP INDEX idx_attention_inbox_states_actor_status;
      DROP TABLE attention_inbox_states;
      CREATE TABLE attention_inbox_states (
        actor_key TEXT NOT NULL,
        item_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('snoozed', 'dismissed')),
        snoozed_until TEXT,
        source_updated_at TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (actor_key, item_id)
      );
      CREATE INDEX idx_attention_inbox_states_actor_status
        ON attention_inbox_states(actor_key, status, snoozed_until, updated_at DESC);
    `);
    getDatabase()
      .prepare(
        `INSERT INTO attention_inbox_states (
           actor_key, item_id, status, snoozed_until, source_updated_at, note,
           created_at, updated_at
         ) VALUES ('operator', 'attn:test:legacy', 'snoozed', ?, ?, '', ?, ?)`
      )
      .run(new Date(Date.now() + 60_000).toISOString(), now, now, now);
    getDatabase()
      .prepare("DELETE FROM migrations WHERE id = ?")
      .run("078_attention_inbox_active_state_repair.sql");
    await app.close();
    closeDatabase();

    app = await buildServer({ dataRoot: rootDir, seedDemoData: false });
    const beforeRestore = getDatabase()
      .prepare(
        `SELECT status
         FROM attention_inbox_states
         WHERE actor_key = 'operator' AND item_id = 'attn:test:legacy'`
      )
      .get() as { status: string } | undefined;
    assert.equal(beforeRestore?.status, "snoozed");

    getDatabase()
      .prepare(
        `UPDATE attention_inbox_states
         SET status = 'active', snoozed_until = NULL, updated_at = ?
         WHERE actor_key = 'operator' AND item_id = 'attn:test:legacy'`
      )
      .run(new Date().toISOString());
    const afterRestore = getDatabase()
      .prepare(
        `SELECT status, snoozed_until AS snoozedUntil
         FROM attention_inbox_states
         WHERE actor_key = 'operator' AND item_id = 'attn:test:legacy'`
      )
      .get() as { status: string; snoozedUntil: string | null } | undefined;
    assert.equal(afterRestore?.status, "active");
    assert.equal(afterRestore?.snoozedUntil, null);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

async function withTestServer(
  run: (app: Awaited<ReturnType<typeof buildServer>>) => Promise<void>
) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-attention-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    await run(app);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
}

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

function seedAttentionSources() {
  const database = getDatabase();
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  database
    .prepare(
      `UPDATE tasks
       SET status = 'blocked', due_date = '2000-01-01', updated_at = ?
       WHERE id = 'task_flagship_review'`
    )
    .run(now);
  setEntityOwner("task", "task_flagship_review", "user_operator");

  database
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
      "ins_attention_review",
      "task_flagship_review",
      "Review the blocked plan",
      "The current task cannot advance without a decision.",
      "Review the blocker and choose the next move.",
      old,
      now
    );
  setEntityOwner("insight", "ins_attention_review", "user_operator");

  database
    .prepare(
      `INSERT INTO approval_requests (
         id, action_type, status, title, summary, entity_type, entity_id,
         requested_by_agent_id, requested_by_token_id, requested_payload_json,
         approved_by, approved_at, rejected_by, rejected_at, resolution_note,
         created_at, updated_at
       ) VALUES (?, 'update_task', 'pending', ?, ?, 'task', ?, NULL, NULL, '{}',
         NULL, NULL, NULL, NULL, '', ?, ?)`
    )
    .run(
      "apr_attention_review",
      "Approve the task update",
      "A trusted agent prepared a material task change.",
      "task_flagship_review",
      old,
      now
    );

  database
    .prepare(
      `INSERT INTO agent_runtime_sessions (
         id, agent_id, agent_label, agent_type, provider, session_key,
         session_label, actor_label, connection_mode, status, base_url, web_url,
         data_root, external_session_id, stale_after_seconds, reconnect_count,
         reconnect_requested_at, last_error, last_seen_at, last_heartbeat_at,
         started_at, ended_at, metadata_json, created_at, updated_at
       ) VALUES (?, NULL, 'Codex', 'coding_agent', 'codex', 'attention-test',
         'Attention test', 'Codex', 'unknown', 'error', NULL, NULL, NULL, NULL,
         120, 0, NULL, 'Runtime unavailable', ?, ?, ?, NULL, '{}', ?, ?)`
    )
    .run("agrs_attention_error", old, old, old, old, now);
  const olderRuntime = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  database
    .prepare(
      `INSERT INTO agent_runtime_sessions (
         id, agent_id, agent_label, agent_type, provider, session_key,
         session_label, actor_label, connection_mode, status, base_url, web_url,
         data_root, external_session_id, stale_after_seconds, reconnect_count,
         reconnect_requested_at, last_error, last_seen_at, last_heartbeat_at,
         started_at, ended_at, metadata_json, created_at, updated_at
       ) VALUES (?, NULL, 'Codex', 'coding_agent', 'codex', 'attention-test-old',
         'Attention test old', 'Codex', 'unknown', 'error',
         'http://old-forge.local', NULL, NULL, NULL, 120, 0, NULL,
         'Older runtime unavailable', ?, ?, ?, NULL, '{}', ?, ?)`
    )
    .run(
      "agrs_attention_error_old",
      olderRuntime,
      olderRuntime,
      olderRuntime,
      olderRuntime,
      olderRuntime
    );
  database
    .prepare(
      `INSERT INTO agent_runtime_sessions (
         id, agent_id, agent_label, agent_type, provider, session_key,
         session_label, actor_label, connection_mode, status, base_url, web_url,
         data_root, external_session_id, stale_after_seconds, reconnect_count,
         reconnect_requested_at, last_error, last_seen_at, last_heartbeat_at,
         started_at, ended_at, metadata_json, created_at, updated_at
       ) VALUES (?, NULL, 'Hermes', 'assistant', 'hermes', ?, ?, 'Hermes',
         'unknown', ?, ?, NULL, NULL, NULL, 120, 0, NULL, ?, ?, ?, ?, NULL,
         '{}', ?, ?)`
    )
    .run(
      "agrs_attention_hermes_old",
      "attention-hermes-old",
      "Attention Hermes old",
      "error",
      "http://old-forge.local",
      "Older Hermes runtime unavailable",
      olderRuntime,
      olderRuntime,
      olderRuntime,
      olderRuntime,
      olderRuntime
    );
  database
    .prepare(
      `INSERT INTO agent_runtime_sessions (
         id, agent_id, agent_label, agent_type, provider, session_key,
         session_label, actor_label, connection_mode, status, base_url, web_url,
         data_root, external_session_id, stale_after_seconds, reconnect_count,
         reconnect_requested_at, last_error, last_seen_at, last_heartbeat_at,
         started_at, ended_at, metadata_json, created_at, updated_at
       ) VALUES (?, NULL, 'Hermes', 'assistant', 'hermes', ?, ?, 'Hermes',
         'unknown', 'connected', ?, NULL, NULL, NULL, 120, 0, NULL, NULL, ?, ?,
         ?, NULL, '{}', ?, ?)`
    )
    .run(
      "agrs_attention_hermes_current",
      "attention-hermes-current",
      "Attention Hermes current",
      "http://127.0.0.1:4317",
      now,
      now,
      old,
      old,
      now
    );

  database
    .prepare(
      `INSERT INTO companion_pairing_sessions (
         id, user_id, label, pairing_token, status, capability_flags_json,
         device_name, platform, app_version, api_base_url, last_seen_at,
         last_sync_at, last_sync_error, paired_at, expires_at, created_at,
         updated_at
       ) VALUES (?, 'user_operator', 'Test phone', ?, 'verified', '[]',
         'iPhone', 'ios', '1', '', ?, NULL, NULL, ?, ?, ?, ?)`
    )
    .run(
      "pair_attention",
      "pair_attention_token",
      now,
      old,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      old,
      now
    );

  const insertSync = database.prepare(
    `INSERT INTO health_mobile_sync_sessions (
       id, pairing_session_id, user_id, status, schema_version,
       requested_families_json, source_metadata_json, expected_counts_json,
       received_counts_json, byte_totals_json, affected_workout_ids_json,
       error_json, started_at, completed_at, failed_at, aborted_at, expired_at,
       created_at, updated_at
     ) VALUES (?, 'pair_attention', 'user_operator', ?, 'healthkit-sync-v2',
       '[]', '{}', '{}', '{}', '{}', '[]', ?, ?, ?, ?, NULL, NULL, ?, ?)`
  );
  const failedStarted = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  insertSync.run(
    "sync_resolved_failure",
    "failed",
    '{"message":"Old failure"}',
    failedStarted,
    null,
    failedStarted,
    failedStarted,
    failedStarted
  );
  const completionStarted = new Date(
    Date.now() - 5 * 60 * 60 * 1000
  ).toISOString();
  insertSync.run(
    "sync_later_success",
    "completed",
    "{}",
    completionStarted,
    completionStarted,
    null,
    completionStarted,
    completionStarted
  );
  const unresolvedStarted = new Date(
    Date.now() - 3 * 60 * 60 * 1000
  ).toISOString();
  const olderUnresolvedStarted = new Date(
    Date.now() - 4 * 60 * 60 * 1000
  ).toISOString();
  insertSync.run(
    "sync_older_unresolved_failure",
    "expired",
    '{"message":"Earlier import expired"}',
    olderUnresolvedStarted,
    null,
    null,
    olderUnresolvedStarted,
    olderUnresolvedStarted
  );
  insertSync.run(
    "sync_unresolved_failure",
    "failed",
    '{"message":"Latest import failed"}',
    unresolvedStarted,
    null,
    unresolvedStarted,
    unresolvedStarted,
    unresolvedStarted
  );
}

test("attention inbox deduplicates evidence and keeps operational signals operator-only", async () => {
  await withTestServer(async (app) => {
    seedAttentionSources();
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/v1/attention-inbox"
    });
    assert.equal(unauthenticated.statusCode, 401);

    const operatorCookie = await issueOperatorSessionCookie(app);
    const operatorResponse = await app.inject({
      method: "GET",
      url: "/api/v1/attention-inbox?limit=100",
      headers: { cookie: operatorCookie }
    });
    assert.equal(operatorResponse.statusCode, 200, operatorResponse.body);
    const operatorPayload = operatorResponse.json() as AttentionInboxPayload;
    const operatorIds = operatorPayload.items.map((item) => item.id);
    assert.equal(
      operatorIds.filter((id) => id === "attn:task:task_flagship_review")
        .length,
      1
    );
    assert.ok(operatorIds.includes("attn:insight:ins_attention_review"));
    assert.ok(operatorIds.includes("attn:approval:apr_attention_review"));
    assert.ok(operatorIds.includes("attn:agent-session:agrs_attention_error"));
    assert.ok(
      !operatorIds.includes("attn:agent-session:agrs_attention_error_old")
    );
    assert.ok(
      !operatorIds.includes("attn:agent-session:agrs_attention_hermes_old")
    );
    assert.ok(
      operatorIds.includes("attn:companion-sync:sync_unresolved_failure")
    );
    assert.ok(
      !operatorIds.includes("attn:companion-sync:sync_older_unresolved_failure")
    );
    assert.ok(
      !operatorIds.includes("attn:companion-sync:sync_resolved_failure")
    );
    assert.equal(operatorPayload.summary.sourceCounts.approval, 1);
    assert.equal(operatorPayload.summary.sourceCounts.companion_sync, 1);
    assert.equal(operatorPayload.summary.sourceCounts.agent_session, 1);
    assert.equal(
      operatorPayload.items.find(
        (item) => item.id === "attn:companion-sync:sync_unresolved_failure"
      )?.metadata.unresolvedCount,
      2
    );

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: { cookie: operatorCookie },
      payload: {
        label: "Attention scoped token",
        scopes: ["read", "write"],
        scopePolicy: {
          userIds: ["user_operator"],
          projectIds: [],
          tagIds: []
        }
      }
    });
    assert.equal(tokenResponse.statusCode, 201);
    const token = (tokenResponse.json() as { token: { token: string } }).token
      .token;
    const tokenHeaders = { authorization: `Bearer ${token}` };
    const tokenQueue = await app.inject({
      method: "GET",
      url: "/api/v1/attention-inbox?limit=100",
      headers: tokenHeaders
    });
    assert.equal(tokenQueue.statusCode, 200);
    const tokenIds = (tokenQueue.json() as AttentionInboxPayload).items.map(
      (item) => item.id
    );
    assert.ok(tokenIds.includes("attn:task:task_flagship_review"));
    assert.ok(tokenIds.includes("attn:insight:ins_attention_review"));
    assert.ok(!tokenIds.includes("attn:approval:apr_attention_review"));
    assert.ok(!tokenIds.includes("attn:agent-session:agrs_attention_error"));
    assert.ok(
      !tokenIds.includes("attn:companion-sync:sync_unresolved_failure")
    );

    const narrowedToNone = await app.inject({
      method: "GET",
      url: "/api/v1/attention-inbox?userId=user_forge_bot&limit=100",
      headers: tokenHeaders
    });
    assert.equal(narrowedToNone.statusCode, 200);
    const narrowedIds = (
      narrowedToNone.json() as AttentionInboxPayload
    ).items.map((item) => item.id);
    assert.ok(!narrowedIds.includes("attn:task:task_flagship_review"));
    assert.ok(!narrowedIds.includes("attn:insight:ins_attention_review"));

    const tokenSnooze = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent("attn:insight:ins_attention_review")}/snooze`,
      headers: tokenHeaders,
      payload: {
        until: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      }
    });
    assert.equal(tokenSnooze.statusCode, 200);
    const operatorAfterTokenSnooze = await app.inject({
      method: "GET",
      url: "/api/v1/attention-inbox?limit=100",
      headers: { cookie: operatorCookie }
    });
    assert.ok(
      (operatorAfterTokenSnooze.json() as AttentionInboxPayload).items.some(
        (item) => item.id === "attn:insight:ins_attention_review"
      )
    );
  });
});

test("attention inbox state is audited, reversible, and invalidated by new evidence", async () => {
  await withTestServer(async (app) => {
    seedAttentionSources();
    const cookie = await issueOperatorSessionCookie(app);
    const insightId = "attn:insight:ins_attention_review";
    const taskId = "attn:task:task_flagship_review";

    const dismiss = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(insightId)}/dismiss`,
      headers: { cookie },
      payload: { note: "Reviewed for now" }
    });
    assert.equal(dismiss.statusCode, 200, dismiss.body);
    const dismissedQueue = await app.inject({
      method: "GET",
      url: "/api/v1/attention-inbox?state=dismissed&limit=100",
      headers: { cookie }
    });
    assert.ok(
      (dismissedQueue.json() as AttentionInboxPayload).items.some(
        (item) =>
          item.id === insightId && item.allowedActions.includes("restore")
      )
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM attention_inbox_state_events
             WHERE actor_key = 'operator' AND item_id = ?`
          )
          .get(insightId) as { count: number }
      ).count,
      1
    );

    const changedAt = new Date(Date.now() + 1_000).toISOString();
    getDatabase()
      .prepare("UPDATE insights SET updated_at = ? WHERE id = ?")
      .run(changedAt, "ins_attention_review");
    const activeAfterChange = await app.inject({
      method: "GET",
      url: "/api/v1/attention-inbox?limit=100",
      headers: { cookie }
    });
    assert.ok(
      (activeAfterChange.json() as AttentionInboxPayload).items.some(
        (item) => item.id === insightId && item.state === "active"
      )
    );
    const staleRestore = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(insightId)}/restore`,
      headers: { cookie }
    });
    assert.equal(staleRestore.statusCode, 409);

    const taskDismiss = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(taskId)}/dismiss`,
      headers: { cookie }
    });
    assert.equal(taskDismiss.statusCode, 409);

    const pastSnooze = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(taskId)}/snooze`,
      headers: { cookie },
      payload: { until: new Date(Date.now() - 1_000).toISOString() }
    });
    assert.equal(pastSnooze.statusCode, 400);
    const distantSnooze = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(taskId)}/snooze`,
      headers: { cookie },
      payload: {
        until: new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString()
      }
    });
    assert.equal(distantSnooze.statusCode, 400);

    const snooze = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(taskId)}/snooze`,
      headers: { cookie },
      payload: {
        until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        note: "Wait for the dependency"
      }
    });
    assert.equal(snooze.statusCode, 200);
    getDatabase()
      .prepare(
        `UPDATE attention_inbox_states
         SET snoozed_until = ?
         WHERE actor_key = 'operator' AND item_id = ?`
      )
      .run(new Date(Date.now() - 1_000).toISOString(), taskId);
    const snoozeAfterExpiry = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(taskId)}/snooze`,
      headers: { cookie },
      payload: {
        until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }
    });
    assert.equal(snoozeAfterExpiry.statusCode, 200);
    const latestSnoozeEvent = getDatabase()
      .prepare(
        `SELECT from_status, to_status
         FROM attention_inbox_state_events
         WHERE actor_key = 'operator' AND item_id = ?
         ORDER BY rowid DESC
         LIMIT 1`
      )
      .get(taskId) as { from_status: string | null; to_status: string };
    assert.equal(latestSnoozeEvent.from_status, "active");
    assert.equal(latestSnoozeEvent.to_status, "snoozed");
    const snoozedQueue = await app.inject({
      method: "GET",
      url: "/api/v1/attention-inbox?state=snoozed&limit=100",
      headers: { cookie }
    });
    assert.ok(
      (snoozedQueue.json() as AttentionInboxPayload).items.some(
        (item) => item.id === taskId && item.snoozedUntil !== null
      )
    );
    const restore = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(taskId)}/restore`,
      headers: { cookie }
    });
    assert.equal(restore.statusCode, 200);
    const repeatedRestore = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(taskId)}/restore`,
      headers: { cookie }
    });
    assert.equal(repeatedRestore.statusCode, 409);
  });
});

test("attention inbox pagination stays bounded for a large source queue", async () => {
  await withTestServer(async (app) => {
    const insert = getDatabase().prepare(
      `INSERT INTO insights (
         id, origin_type, origin_agent_id, origin_label, visibility, status,
         entity_type, entity_id, timeframe_label, title, summary,
         recommendation, rationale, confidence, cta_label, evidence_json,
         created_at, updated_at
       ) VALUES (?, 'system', NULL, 'Forge', 'visible', 'open', NULL, NULL,
         'Review', ?, 'Bounded queue fixture', 'Review this signal', '', 0.6,
         'Review insight', '[]', ?, ?)`
    );
    const now = new Date().toISOString();
    runInTransaction(() => {
      for (let index = 0; index < 130; index += 1) {
        insert.run(
          `ins_attention_bulk_${String(index).padStart(3, "0")}`,
          `Attention fixture ${index + 1}`,
          now,
          now
        );
      }
    });
    const cookie = await issueOperatorSessionCookie(app);
    const firstPage = await app.inject({
      method: "GET",
      url: "/api/v1/attention-inbox?limit=20",
      headers: { cookie }
    });
    assert.equal(firstPage.statusCode, 200);
    const firstPayload = firstPage.json() as AttentionInboxPayload;
    assert.ok(firstPayload.total >= 100);
    assert.equal(firstPayload.summary.sourceCounts.insight, 100);
    assert.equal(firstPayload.items.length, 20);
    assert.equal(firstPayload.hasMore, true);

    const lastPage = await app.inject({
      method: "GET",
      url: "/api/v1/attention-inbox?limit=20&offset=100",
      headers: { cookie }
    });
    const lastPayload = lastPage.json() as AttentionInboxPayload;
    assert.equal(lastPayload.items.length, firstPayload.total - 100);
    assert.equal(lastPayload.hasMore, false);
    assert.equal(
      new Set(lastPayload.items.map((item) => item.id)).size,
      lastPayload.items.length
    );
  });
});

test("task due filters and attention use the runtime local date", async () => {
  await withTestServer(async () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati";
    try {
      const now = new Date("2026-01-01T12:30:00.000Z");
      getDatabase()
        .prepare(
          `UPDATE tasks
           SET status = 'backlog', due_date = '2026-01-01', updated_at = ?
           WHERE id = 'task_flagship_review'`
        )
        .run(now.toISOString());
      assert.ok(
        listTasks({ due: "overdue" }, { now }).some(
          (task) => task.id === "task_flagship_review"
        )
      );
      assert.ok(
        listAttentionInbox({
          actorKey: "operator",
          includeOperationalSignals: false,
          now,
          limit: 100
        }).items.some((item) => item.id === "attn:task:task_flagship_review")
      );
    } finally {
      if (originalTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimeZone;
      }
    }
  });
});
