import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { buildOpenApiDocument } from "./openapi.js";
import { setEntityOwner } from "./repositories/entity-ownership.js";
import { listTasks } from "./repositories/tasks.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import {
  checkAttentionResolutionAttempts,
  startAttentionResolutionAttempt
} from "./services/attention-resolution.js";
import type {
  AttentionInboxItem,
  AttentionInboxPayload,
  AttentionResolutionActionKey,
  AttentionResolutionCheckResponse,
  AttentionResolutionList,
  AttentionResolutionStartResult
} from "./types.js";

const migrationName = "126_attention_resolution_receipts.sql";

async function withServer(
  run: (input: {
    app: Awaited<ReturnType<typeof buildServer>>;
    cookie: string;
  }) => Promise<void>
) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-attention-resolution-"));
  const app = await buildServer({ dataRoot, seedDemoData: true });
  try {
    await run({ app, cookie: await issueTestOperatorSessionCookie(app) });
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function insertApproval(id: string, status = "pending", updatedAt = iso()) {
  getDatabase()
    .prepare(
      `INSERT INTO approval_requests (
         id, action_type, status, title, summary, entity_type, entity_id,
         requested_by_agent_id, requested_by_token_id, requested_payload_json,
         approved_by, approved_at, rejected_by, rejected_at, resolution_note,
         created_at, updated_at
       ) VALUES (?, 'update_task', ?, ?, '', NULL, NULL, NULL, NULL, '{}',
         NULL, NULL, NULL, NULL, '', ?, ?)`
    )
    .run(id, status, `Approval ${id}`, updatedAt, updatedAt);
}

function insertInsight(id: string, status = "open", updatedAt = iso()) {
  getDatabase()
    .prepare(
      `INSERT INTO insights (
         id, origin_type, origin_agent_id, origin_label, visibility, status,
         entity_type, entity_id, timeframe_label, title, summary,
         recommendation, rationale, confidence, cta_label, evidence_json,
         created_at, updated_at
       ) VALUES (?, 'agent', NULL, 'Codex', 'visible', ?, NULL, NULL, NULL,
         ?, '', '', '', 0.9, 'Review insight', '[]', ?, ?)`
    )
    .run(id, status, `Insight ${id}`, updatedAt, updatedAt);
}

function insertRuntime(input: {
  id: string;
  label: string;
  provider?: string;
  status: string;
  heartbeatAt: string;
  updatedAt?: string;
}) {
  const updatedAt = input.updatedAt ?? input.heartbeatAt;
  getDatabase()
    .prepare(
      `INSERT INTO agent_runtime_sessions (
         id, agent_id, agent_label, agent_type, provider, session_key,
         session_label, actor_label, connection_mode, status, base_url, web_url,
         data_root, external_session_id, stale_after_seconds, reconnect_count,
         reconnect_requested_at, last_error, last_seen_at, last_heartbeat_at,
         started_at, ended_at, metadata_json, created_at, updated_at
       ) VALUES (?, NULL, ?, 'coding_agent', ?, ?, '', ?, 'unknown', ?,
         NULL, NULL, NULL, NULL, 120, 0, NULL, NULL, ?, ?, ?, NULL, '{}', ?, ?)`
    )
    .run(
      input.id,
      input.label,
      input.provider ?? "codex",
      `session-${input.id}`,
      input.label,
      input.status,
      input.heartbeatAt,
      input.heartbeatAt,
      input.heartbeatAt,
      input.heartbeatAt,
      updatedAt
    );
}

function ensurePairing() {
  const now = iso();
  getDatabase()
    .prepare(
      `INSERT INTO companion_pairing_sessions (
         id, user_id, label, pairing_token, status, capability_flags_json,
         device_name, platform, app_version, api_base_url, last_seen_at,
         last_sync_at, last_sync_error, paired_at, expires_at, created_at,
         updated_at
       ) VALUES ('pair_resolution', 'user_operator', 'Resolution phone',
         'pair_resolution_token', 'verified', '[]', 'iPhone', 'ios', '1', '',
         ?, NULL, NULL, ?, ?, ?, ?)`
    )
    .run(now, now, iso(24 * 60 * 60 * 1000), now, now);
}

function insertSync(input: {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  abortedAt?: string | null;
  failedAt?: string | null;
}) {
  getDatabase()
    .prepare(
      `INSERT INTO health_mobile_sync_sessions (
         id, pairing_session_id, user_id, status, schema_version,
         requested_families_json, source_metadata_json, expected_counts_json,
         received_counts_json, byte_totals_json, affected_workout_ids_json,
         error_json, started_at, completed_at, failed_at, aborted_at, expired_at,
         created_at, updated_at
       ) VALUES (?, 'pair_resolution', 'user_operator', ?, 'healthkit-sync-v2',
         '[]', '{}', '{}', '{}', '{}', '[]', '{}', ?, ?, ?, ?, NULL, ?, ?)`
    )
    .run(
      input.id,
      input.status,
      input.startedAt,
      input.completedAt ?? null,
      input.failedAt ?? null,
      input.abortedAt ?? null,
      input.startedAt,
      input.startedAt
    );
}

function insertAttempt(input: {
  id: string;
  itemId: string;
  source: string;
  kind: string;
  actionKey: AttentionResolutionActionKey;
  sourceRef: string;
  sourceUpdatedAt: string;
  sourceAnchorAt?: string;
  ownerUserId?: string | null;
  scopedUserIds?: string[];
  provider?: string | null;
  normalizedLabel?: string | null;
  status?: "pending" | "resolved" | "unavailable";
  startedAt?: string;
}) {
  getDatabase()
    .prepare(
      `INSERT INTO attention_resolution_attempts (
         id, actor_key, owner_user_id, scoped_user_ids_json, idempotency_key,
         request_fingerprint, item_id, source, kind, action_key, source_ref,
         source_updated_at, source_anchor_at, source_provider,
         source_agent_label_normalized, title, target_label, target_href,
         status, started_at, checked_at
       ) VALUES (?, 'operator', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         '/settings/agents', ?, ?, NULL)`
    )
    .run(
      input.id,
      input.ownerUserId ?? null,
      JSON.stringify(input.scopedUserIds ?? []),
      `idem-${input.id}`,
      "0".repeat(64),
      input.itemId,
      input.source,
      input.kind,
      input.actionKey,
      input.sourceRef,
      input.sourceUpdatedAt,
      input.sourceAnchorAt ?? input.sourceUpdatedAt,
      input.provider ?? null,
      input.normalizedLabel ?? null,
      `Attempt ${input.id}`,
      `Target ${input.id}`,
      input.status ?? "pending",
      input.startedAt ?? iso()
    );
}

async function queue(app: Awaited<ReturnType<typeof buildServer>>, cookie: string) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/attention-inbox?limit=100",
    headers: { cookie }
  });
  assert.equal(response.statusCode, 200, response.body);
  return (response.json() as AttentionInboxPayload).items;
}

async function startItem(input: {
  app: Awaited<ReturnType<typeof buildServer>>;
  cookie: string;
  item: AttentionInboxItem;
  key: string;
}) {
  return input.app.inject({
    method: "POST",
    url: `/api/v1/attention-inbox/${encodeURIComponent(input.item.id)}/actions/start`,
    headers: { cookie: input.cookie, "idempotency-key": input.key },
    payload: {
      actionKey: input.item.primaryAction.key,
      sourceUpdatedAt: input.item.sourceUpdatedAt
    }
  });
}

async function check(input: {
  app: Awaited<ReturnType<typeof buildServer>>;
  cookie: string;
  key: string;
}) {
  return input.app.inject({
    method: "POST",
    url: "/api/v1/attention-resolutions/check",
    headers: { cookie: input.cookie, "idempotency-key": input.key },
    payload: {}
  });
}

function p95(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

test("HOME-08 migration rolls back a failed record, retries once, and preserves prior Attention state", async () => {
  await withServer(async () => {
    const database = getDatabase();
    const before = iso();
    database
      .prepare(
        `INSERT INTO attention_inbox_states (
           actor_key, item_id, status, snoozed_until, source_updated_at, note,
           created_at, updated_at
         ) VALUES ('operator', 'attn:preserved', 'dismissed', NULL, ?, '', ?, ?)`
      )
      .run(before, before, before);
    database.exec(`
      DROP TABLE attention_resolution_check_idempotency;
      DROP TABLE attention_resolution_receipts;
      DROP TABLE attention_resolution_attempts;
    `);
    database.prepare("DELETE FROM migrations WHERE id = ?").run(migrationName);
    const sql = await readFile(
      path.resolve("apps/api/migrations", migrationName),
      "utf8"
    );
    database.exec("BEGIN");
    assert.throws(() => {
      database.exec(sql);
      database.exec("INSERT INTO attention_resolution_attempts (id) VALUES ('invalid')");
    });
    database.exec("ROLLBACK");
    assert.equal(
      database
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'attention_resolution_attempts'")
        .get(),
      undefined
    );
    assert.equal(
      database.prepare("SELECT 1 FROM migrations WHERE id = ?").get(migrationName),
      undefined
    );
    assert.equal(
      (database
        .prepare("SELECT status FROM attention_inbox_states WHERE item_id = 'attn:preserved'")
        .get() as { status: string }).status,
      "dismissed"
    );

    database.exec("BEGIN");
    database.exec(sql);
    database
      .prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)")
      .run(migrationName, iso());
    database.exec("COMMIT");
    const appliedBeforeIdempotentPass = (
      database.prepare("SELECT COUNT(*) AS count FROM migrations WHERE id = ?").get(migrationName) as { count: number }
    ).count;
    if (!database.prepare("SELECT 1 FROM migrations WHERE id = ?").get(migrationName)) {
      database.exec(sql);
    }
    assert.equal(appliedBeforeIdempotentPass, 1);
    assert.equal(
      (database
        .prepare("SELECT status FROM attention_inbox_states WHERE item_id = 'attn:preserved'")
        .get() as { status: string }).status,
      "dismissed"
    );
  });
});

test("HOME-08 scoped Attention filters do not reveal whether an unauthorized user exists", async () => {
  await withServer(async ({ app, cookie }) => {
    const now = iso();
    getDatabase()
      .prepare(
        `INSERT INTO users (
           id, kind, handle, display_name, description, accent_color,
           created_at, updated_at
         ) VALUES ('user_attention_outside_scope', 'human',
           'attention-outside-scope', 'Attention outside scope', '', '#000000',
           ?, ?)`
      )
      .run(now, now);

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: { cookie },
      payload: {
        label: "HOME-08 user-scope privacy",
        scopes: ["read"],
        scopePolicy: {
          userIds: ["user_operator"],
          projectIds: [],
          tagIds: []
        }
      }
    });
    assert.equal(tokenResponse.statusCode, 201, tokenResponse.body);
    const token = (tokenResponse.json() as { token: { token: string } }).token
      .token;
    const headers = { authorization: `Bearer ${token}` };

    const outsideScope = await app.inject({
      method: "GET",
      url: "/api/v1/attention-inbox?userId=user_attention_outside_scope",
      headers
    });
    const unknown = await app.inject({
      method: "GET",
      url: "/api/v1/attention-inbox?userId=user_attention_unknown",
      headers
    });

    assert.equal(outsideScope.statusCode, 200, outsideScope.body);
    assert.equal(unknown.statusCode, 200, unknown.body);
    const outsideBody = outsideScope.json() as AttentionInboxPayload;
    const unknownBody = unknown.json() as AttentionInboxPayload;
    assert.match(outsideBody.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(unknownBody.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(
      { ...outsideBody, generatedAt: "<generated>" },
      { ...unknownBody, generatedAt: "<generated>" }
    );
    assert.equal(outsideBody.total, 0);
    assert.deepEqual(outsideBody.items, []);
  });
});

test("HOME-08 operator resolution routes enforce evidence, idempotency, atomicity, bounds, and latency", async () => {
  await withServer(async ({ app, cookie }) => {
    const now = iso();
    const old = iso(-4 * 60 * 60 * 1000);
    const taskRows = listTasks().slice(0, 2);
    assert.equal(taskRows.length, 2);
    const blockedTask = taskRows[0]!;
    const overdueTask = taskRows[1]!;
    getDatabase()
      .prepare("UPDATE tasks SET status = 'blocked', due_date = '2000-01-01', updated_at = ? WHERE id = ?")
      .run(now, blockedTask.id);
    getDatabase()
      .prepare("UPDATE tasks SET status = 'in_progress', due_date = '2000-01-01', updated_at = ? WHERE id = ?")
      .run(now, overdueTask.id);
    setEntityOwner("task", blockedTask.id, "user_operator");
    setEntityOwner("task", overdueTask.id, "user_operator");
    insertApproval("apr_resolution_positive", "pending", now);
    insertInsight("ins_resolution_positive", "open", now);
    insertRuntime({
      id: "agrs_resolution_positive",
      label: "Resolution Codex",
      status: "error",
      heartbeatAt: old,
      updatedAt: now
    });
    ensurePairing();
    insertSync({
      id: "sync_resolution_positive",
      status: "failed",
      startedAt: old,
      failedAt: old
    });

    const items = await queue(app, cookie);
    const ids = [
      "attn:approval:apr_resolution_positive",
      "attn:insight:ins_resolution_positive",
      `attn:task:${blockedTask.id}`,
      `attn:task:${overdueTask.id}`,
      "attn:companion-sync:sync_resolution_positive",
      "attn:agent-session:agrs_resolution_positive"
    ];
    const primaryActions = new Map(
      ids.map((id) => {
        const item = items.find((candidate) => candidate.id === id);
        assert.ok(item, `missing queue item ${id}`);
        return [id, item] as const;
      })
    );
    assert.deepEqual(
      [...primaryActions.values()].map((item) => item.primaryAction.sourceRef),
      [
        "approval_request:apr_resolution_positive",
        "insight:ins_resolution_positive",
        `task:${blockedTask.id}`,
        `task:${overdueTask.id}`,
        "health_mobile_sync_session:sync_resolution_positive",
        "agent_runtime_session:agrs_resolution_positive"
      ]
    );

    const unauth = await app.inject({
      method: "POST",
      url: "/api/v1/attention-inbox/attn%3Aapproval%3Adoes-not-exist/actions/start",
      headers: { "idempotency-key": "unauth-no-leak" },
      payload: { actionKey: "review_decision", sourceUpdatedAt: now }
    });
    assert.equal(unauth.statusCode, 401);
    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: { cookie },
      payload: {
        label: "HOME-08 scoped token",
        scopes: ["read", "write"],
        scopePolicy: { userIds: ["user_operator"], projectIds: [], tagIds: [] }
      }
    });
    const token = (tokenResponse.json() as { token: { token: string } }).token.token;
    const tokenHeaders = {
      authorization: `Bearer ${token}`,
      "idempotency-key": "token-no-leak"
    };
    const tokenExisting = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(ids[0]!)}/actions/start`,
      headers: tokenHeaders,
      payload: {
        actionKey: primaryActions.get(ids[0]!)!.primaryAction.key,
        sourceUpdatedAt: primaryActions.get(ids[0]!)!.sourceUpdatedAt
      }
    });
    const tokenMissing = await app.inject({
      method: "POST",
      url: "/api/v1/attention-inbox/attn%3Aapproval%3Adoes-not-exist/actions/start",
      headers: tokenHeaders,
      payload: { actionKey: "review_decision", sourceUpdatedAt: now }
    });
    assert.equal(tokenExisting.statusCode, 403);
    assert.equal(tokenMissing.statusCode, 403);
    assert.equal(tokenExisting.json().code, tokenMissing.json().code);

    const blockedItem = primaryActions.get(`attn:task:${blockedTask.id}`)!;
    const first = await startItem({ app, cookie, item: blockedItem, key: "start-blocked" });
    assert.equal(first.statusCode, 200, first.body);
    const firstBody = first.json() as AttentionResolutionStartResult;
    assert.equal(firstBody.replayed, false);
    const replay = await startItem({ app, cookie, item: blockedItem, key: "start-blocked" });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.headers["idempotency-replayed"], "true");
    assert.deepEqual(replay.json(), { ...firstBody, replayed: true });
    const mismatch = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(blockedItem.id)}/actions/start`,
      headers: { cookie, "idempotency-key": "start-blocked" },
      payload: { actionKey: "review_due_work", sourceUpdatedAt: blockedItem.sourceUpdatedAt }
    });
    assert.equal(mismatch.statusCode, 409);
    const scopeReplayMismatch = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(blockedItem.id)}/actions/start?userId=user_operator`,
      headers: { cookie, "idempotency-key": "start-blocked" },
      payload: {
        actionKey: blockedItem.primaryAction.key,
        sourceUpdatedAt: blockedItem.sourceUpdatedAt
      }
    });
    assert.equal(scopeReplayMismatch.statusCode, 409);
    const stale = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(blockedItem.id)}/actions/start`,
      headers: { cookie, "idempotency-key": "start-stale" },
      payload: { actionKey: blockedItem.primaryAction.key, sourceUpdatedAt: old }
    });
    assert.equal(stale.statusCode, 409);
    const forged = await app.inject({
      method: "POST",
      url: `/api/v1/attention-inbox/${encodeURIComponent(blockedItem.id)}/actions/start`,
      headers: { cookie, "idempotency-key": "start-forged" },
      payload: { actionKey: "review_due_work", sourceUpdatedAt: blockedItem.sourceUpdatedAt }
    });
    assert.equal(forged.statusCode, 409);

    for (const [id, item] of primaryActions) {
      if (id === blockedItem.id) continue;
      const response = await startItem({ app, cookie, item, key: `start-${id}` });
      assert.equal(response.statusCode, 200, response.body);
    }
    getDatabase().prepare("UPDATE approval_requests SET status = 'approved', updated_at = ? WHERE id = ?").run(iso(1_000), "apr_resolution_positive");
    getDatabase().prepare("UPDATE insights SET status = 'accepted', updated_at = ? WHERE id = ?").run(iso(1_000), "ins_resolution_positive");
    getDatabase().prepare("UPDATE tasks SET status = 'in_progress', due_date = '2000-01-01', updated_at = ? WHERE id = ?").run(iso(1_000), blockedTask.id);
    getDatabase().prepare("UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?").run(iso(1_000), overdueTask.id);
    insertSync({
      id: "sync_resolution_later_complete",
      status: "completed",
      startedAt: iso(-60 * 60 * 1000),
      completedAt: iso(-30 * 60 * 1000)
    });
    getDatabase()
      .prepare("UPDATE agent_runtime_sessions SET status = 'connected', last_heartbeat_at = ?, last_seen_at = ?, updated_at = ? WHERE id = ?")
      .run(iso(2_000), iso(2_000), iso(2_000), "agrs_resolution_positive");
    const positiveCheck = await check({ app, cookie, key: "check-positive" });
    assert.equal(positiveCheck.statusCode, 200, positiveCheck.body);
    const positiveBody = positiveCheck.json() as AttentionResolutionCheckResponse;
    assert.equal(positiveBody.results.length, 6);
    assert.equal(positiveBody.receipts.length, 6);
    assert.deepEqual(
      new Set(positiveBody.receipts.map((receipt) => receipt.evidenceCode)),
      new Set([
        "approval_terminal_decision",
        "insight_accepted_or_applied",
        "blocked_condition_cleared",
        "overdue_condition_cleared",
        "companion_sync_recovered",
        "runtime_reconnected"
      ])
    );
    assert.equal(
      (getDatabase().prepare("SELECT COUNT(*) AS count FROM activity_events WHERE event_type = 'attention_resolution_confirmed'").get() as { count: number }).count,
      6
    );
    const positiveReplay = await check({ app, cookie, key: "check-positive" });
    assert.equal(positiveReplay.headers["idempotency-replayed"], "true");
    assert.deepEqual(positiveReplay.json(), positiveBody);
    const scopeMismatch = await app.inject({
      method: "POST",
      url: "/api/v1/attention-resolutions/check?userId=user_operator",
      headers: { cookie, "idempotency-key": "check-positive" },
      payload: {}
    });
    assert.equal(scopeMismatch.statusCode, 409);

    const listWarmups = 3;
    const measured = 30;
    const listMeasured = measured;
    const listDurations: number[] = [];
    for (let index = 0; index < listWarmups + listMeasured; index += 1) {
      const started = performance.now();
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/attention-inbox?limit=100",
        headers: { cookie }
      });
      const duration = performance.now() - started;
      assert.equal(response.statusCode, 200);
      if (index >= listWarmups) listDurations.push(duration);
    }
    const listP95 = p95(listDurations);

    getDatabase()
      .prepare(
        `INSERT INTO users (
           id, kind, handle, display_name, description, accent_color,
           created_at, updated_at
         ) VALUES ('user_deleted_home08', 'human', 'deleted-home08',
           'Deleted HOME-08 user', '', '#000000', ?, ?)`
      )
      .run(now, now);
    getDatabase()
      .prepare("DELETE FROM users WHERE id = 'user_deleted_home08'")
      .run();
    const resolutionPhysicalCounts = () =>
      getDatabase()
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM attention_resolution_attempts) AS attempts,
             (SELECT COUNT(*) FROM attention_resolution_receipts) AS receipts,
             (SELECT COUNT(*) FROM attention_resolution_check_idempotency) AS checks,
             (SELECT COUNT(*) FROM activity_events
              WHERE event_type = 'attention_resolution_confirmed') AS activities`
        )
        .get() as {
        attempts: number;
        receipts: number;
        checks: number;
        activities: number;
      };
    for (const selectedUserId of [
      "user_unknown_home08",
      "user_deleted_home08"
    ]) {
      const beforeInvalidScope = resolutionPhysicalCounts();
      const query = `userId=${encodeURIComponent(selectedUserId)}`;
      const invalidResponses = [
        await app.inject({
          method: "GET",
          url: `/api/v1/attention-inbox?${query}`,
          headers: { cookie }
        }),
        await app.inject({
          method: "POST",
          url: `/api/v1/attention-inbox/${encodeURIComponent(blockedItem.id)}/actions/start?${query}`,
          headers: {
            cookie,
            "idempotency-key": `invalid-start-${selectedUserId}`
          },
          payload: {
            actionKey: blockedItem.primaryAction.key,
            sourceUpdatedAt: blockedItem.sourceUpdatedAt
          }
        }),
        await app.inject({
          method: "POST",
          url: `/api/v1/attention-inbox/${encodeURIComponent(blockedItem.id)}/actions/start?${query}`,
          headers: { cookie, "idempotency-key": "start-blocked" },
          payload: {
            actionKey: blockedItem.primaryAction.key,
            sourceUpdatedAt: blockedItem.sourceUpdatedAt
          }
        }),
        await app.inject({
          method: "POST",
          url: `/api/v1/attention-resolutions/check?${query}`,
          headers: {
            cookie,
            "idempotency-key": `invalid-check-${selectedUserId}`
          },
          payload: {}
        }),
        await app.inject({
          method: "POST",
          url: `/api/v1/attention-resolutions/check?${query}`,
          headers: { cookie, "idempotency-key": "check-positive" },
          payload: {}
        }),
        await app.inject({
          method: "GET",
          url: `/api/v1/attention-resolutions?${query}`,
          headers: { cookie }
        })
      ];
      for (const response of invalidResponses) {
        assert.equal(response.statusCode, 400, response.body);
        assert.equal(response.json().code, "attention_user_scope_invalid");
      }
      assert.deepEqual(resolutionPhysicalCounts(), beforeInvalidScope);
      const globalQueue = await app.inject({
        method: "GET",
        url: "/api/v1/attention-inbox?limit=1",
        headers: { cookie }
      });
      assert.equal(globalQueue.statusCode, 200, globalQueue.body);
    }

    insertApproval("apr_false_cancelled", "cancelled", iso(3_000));
    insertInsight("ins_false_dismissed", "dismissed", iso(3_000));
    insertInsight("ins_false_snoozed", "snoozed", iso(3_000));
    insertInsight("ins_false_expired", "expired", iso(3_000));
    insertRuntime({ id: "agrs_false_reconnecting", label: "Reconnect False", status: "reconnecting", heartbeatAt: iso(4_000) });
    insertRuntime({ id: "agrs_false_disconnected", label: "Disconnect False", status: "disconnected", heartbeatAt: iso(4_000) });
    insertRuntime({ id: "agrs_false_old", label: "Old False", status: "connected", heartbeatAt: old });
    const future = iso(24 * 60 * 60 * 1000);
    insertSync({ id: "sync_false_aborted", status: "aborted", startedAt: future, abortedAt: future });
    insertSync({ id: "sync_false_new_failure", status: "failed", startedAt: iso(25 * 60 * 60 * 1000), failedAt: iso(25 * 60 * 60 * 1000) });
    const falseAttempts = [
      { id: "a_cancel", source: "approval", kind: "decision", actionKey: "review_decision" as const, ref: "approval_request:apr_false_cancelled", updated: iso(3_000) },
      { id: "a_dismiss", source: "insight", kind: "review", actionKey: "review_insight" as const, ref: "insight:ins_false_dismissed", updated: iso(3_000) },
      { id: "a_snoozed", source: "insight", kind: "review", actionKey: "review_insight" as const, ref: "insight:ins_false_snoozed", updated: iso(3_000) },
      { id: "a_expired", source: "insight", kind: "review", actionKey: "review_insight" as const, ref: "insight:ins_false_expired", updated: iso(3_000) },
      { id: "a_deleted", source: "task", kind: "blocked_work", actionKey: "resolve_blocker" as const, ref: "task:missing-task", updated: now },
      { id: "a_denied", source: "task", kind: "overdue_work", actionKey: "review_due_work" as const, ref: `task:${blockedTask.id}`, updated: now, scope: ["user_forge_bot"] },
      { id: "a_abort", source: "companion_sync", kind: "sync_problem", actionKey: "recover_companion_sync" as const, ref: "health_mobile_sync_session:sync_false_aborted", updated: future, anchor: future, owner: "user_operator" },
      { id: "a_new_failure", source: "companion_sync", kind: "sync_problem", actionKey: "recover_companion_sync" as const, ref: "health_mobile_sync_session:sync_false_new_failure", updated: future, anchor: future, owner: "user_operator" },
      { id: "a_disappeared", source: "companion_sync", kind: "sync_problem", actionKey: "recover_companion_sync" as const, ref: "health_mobile_sync_session:missing-sync", updated: future, anchor: future, owner: "user_operator" },
      { id: "a_reconnecting", source: "agent_session", kind: "runtime_problem", actionKey: "reconnect_runtime" as const, ref: "agent_runtime_session:agrs_false_reconnecting", updated: now, provider: "codex", label: "reconnect false" },
      { id: "a_disconnected", source: "agent_session", kind: "runtime_problem", actionKey: "reconnect_runtime" as const, ref: "agent_runtime_session:agrs_false_disconnected", updated: now, provider: "codex", label: "disconnect false" },
      { id: "a_old", source: "agent_session", kind: "runtime_problem", actionKey: "reconnect_runtime" as const, ref: "agent_runtime_session:agrs_false_old", updated: now, provider: "codex", label: "old false" }
      ,{ id: "a_runtime_deleted", source: "agent_session", kind: "runtime_problem", actionKey: "reconnect_runtime" as const, ref: "agent_runtime_session:missing-runtime", updated: now, provider: "codex", label: "resolution codex" }
    ];
    for (const attempt of falseAttempts) {
      insertAttempt({
        id: attempt.id,
        itemId: `attn:false:${attempt.id}`,
        source: attempt.source,
        kind: attempt.kind,
        actionKey: attempt.actionKey,
        sourceRef: attempt.ref,
        sourceUpdatedAt: attempt.updated,
        sourceAnchorAt: attempt.anchor,
        ownerUserId: attempt.owner,
        scopedUserIds: attempt.scope,
        provider: attempt.provider,
        normalizedLabel: attempt.label
      });
    }
    insertInsight("ins_false_queue_state", "open", iso(5_000));
    const stateItem = (await queue(app, cookie)).find((item) => item.id === "attn:insight:ins_false_queue_state")!;
    assert.ok(stateItem);
    assert.equal((await startItem({ app, cookie, item: stateItem, key: "start-state-only" })).statusCode, 200);
    const stateUrl = `/api/v1/attention-inbox/${encodeURIComponent(stateItem.id)}`;
    assert.equal((await app.inject({ method: "POST", url: `${stateUrl}/snooze`, headers: { cookie }, payload: { until: iso(60 * 60 * 1000) } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: `${stateUrl}/restore`, headers: { cookie } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: `${stateUrl}/dismiss`, headers: { cookie }, payload: {} })).statusCode, 200);

    const falseCheck = await check({ app, cookie, key: "check-false-clears" });
    assert.equal(falseCheck.statusCode, 200, falseCheck.body);
    const falseBody = falseCheck.json() as AttentionResolutionCheckResponse;
    assert.equal(falseBody.receipts.length, 0);
    const statuses = new Map(falseBody.results.map((result) => [result.itemId, result.status]));
    assert.equal(statuses.get("attn:false:a_cancel"), "stale");
    assert.equal(statuses.get("attn:false:a_dismiss"), "stale");
    assert.equal(statuses.get("attn:false:a_snoozed"), "stale");
    assert.equal(statuses.get("attn:false:a_expired"), "stale");
    assert.equal(statuses.get("attn:false:a_deleted"), "deleted");
    assert.equal(statuses.has("attn:false:a_denied"), false);
    assert.equal(statuses.get("attn:false:a_disappeared"), "deleted");
    assert.equal(statuses.get("attn:false:a_runtime_deleted"), "deleted");
    for (const id of ["a_abort", "a_new_failure", "a_reconnecting", "a_disconnected", "a_old"]) {
      assert.equal(statuses.get(`attn:false:${id}`), "still_open");
    }
    assert.equal(statuses.get(stateItem.id), "still_open");
    const deniedCheck = await app.inject({
      method: "POST",
      url: "/api/v1/attention-resolutions/check?userId=user_forge_bot",
      headers: { cookie, "idempotency-key": "check-denied" },
      payload: {}
    });
    assert.equal(deniedCheck.statusCode, 200, deniedCheck.body);
    const deniedBody = deniedCheck.json() as AttentionResolutionCheckResponse;
    assert.equal(deniedBody.results.length, 1);
    assert.equal(deniedBody.results[0]?.status, "denied");
    assert.equal(deniedBody.receipts.length, 0);

    insertApproval("apr_atomic", "approved", iso(6_000));
    insertAttempt({
      id: "a_atomic",
      itemId: "attn:approval:apr_atomic",
      source: "approval",
      kind: "decision",
      actionKey: "review_decision",
      sourceRef: "approval_request:apr_atomic",
      sourceUpdatedAt: iso(6_000)
    });
    getDatabase().exec(`
      CREATE TRIGGER fail_attention_resolution_receipt
      BEFORE INSERT ON attention_resolution_receipts
      BEGIN
        SELECT RAISE(ABORT, 'forced receipt failure after activity insert');
      END;
    `);
    const failedAtomic = await check({ app, cookie, key: "check-atomic" });
    assert.equal(failedAtomic.statusCode, 500);
    assert.equal(
      (getDatabase().prepare("SELECT COUNT(*) AS count FROM attention_resolution_receipts WHERE attempt_id = 'a_atomic'").get() as { count: number }).count,
      0
    );
    assert.equal(
      (getDatabase().prepare("SELECT COUNT(*) AS count FROM activity_events WHERE entity_id = 'a_atomic' AND event_type = 'attention_resolution_confirmed'").get() as { count: number }).count,
      0
    );
    assert.equal(
      (getDatabase().prepare("SELECT status FROM attention_resolution_attempts WHERE id = 'a_atomic'").get() as { status: string }).status,
      "pending"
    );
    assert.equal(
      getDatabase().prepare("SELECT 1 FROM attention_resolution_check_idempotency WHERE idempotency_key = 'check-atomic'").get(),
      undefined
    );
    getDatabase().exec("DROP TRIGGER fail_attention_resolution_receipt");
    const retriedAtomic = await check({ app, cookie, key: "check-atomic" });
    assert.equal(retriedAtomic.statusCode, 200, retriedAtomic.body);
    assert.equal((retriedAtomic.json() as AttentionResolutionCheckResponse).receipts.length, 1);

    const startDurations: number[] = [];
    const checkDurations: number[] = [];
    for (let index = 0; index < listWarmups + measured; index += 1) {
      const id = `apr_perf_${String(index).padStart(2, "0")}`;
      const sourceUpdatedAt = iso(10_000 + index);
      insertApproval(id, "pending", sourceUpdatedAt);
      const item = (await queue(app, cookie)).find((candidate) => candidate.id === `attn:approval:${id}`)!;
      const startAt = performance.now();
      const started = await startItem({ app, cookie, item, key: `perf-start-${index}` });
      const startDuration = performance.now() - startAt;
      assert.equal(started.statusCode, 200, started.body);
      getDatabase().prepare("UPDATE approval_requests SET status = 'approved', updated_at = ? WHERE id = ?").run(iso(20_000 + index), id);
      const checkAt = performance.now();
      const checked = await check({ app, cookie, key: `perf-check-${index}` });
      const checkDuration = performance.now() - checkAt;
      assert.equal(checked.statusCode, 200, checked.body);
      if (index >= listWarmups) {
        startDurations.push(startDuration);
        checkDurations.push(checkDuration);
      }
    }
    const startP95 = p95(startDurations);
    const checkP95 = p95(checkDurations);
    console.log(
      `HOME-08 p95: list=${listP95.toFixed(3)}ms start=${startP95.toFixed(3)}ms check=${checkP95.toFixed(3)}ms (3 warmups + ${measured} measurements each)`
    );
    assert.ok(listP95 <= 15.759, `Attention list p95 ${listP95.toFixed(3)}ms exceeded 15.759ms`);
    assert.ok(startP95 <= 400, `Resolution start p95 ${startP95.toFixed(3)}ms exceeded 400ms`);
    assert.ok(checkP95 <= 400, `Resolution check p95 ${checkP95.toFixed(3)}ms exceeded 400ms`);

    const bounded = await app.inject({
      method: "GET",
      url: "/api/v1/attention-resolutions?limit=2",
      headers: { cookie }
    });
    assert.equal(bounded.statusCode, 200, bounded.body);
    const boundedBody = bounded.json() as AttentionResolutionList;
    assert.equal(boundedBody.receipts.length, 2);
    assert.ok(boundedBody.total >= 37);
    assert.deepEqual(boundedBody.retention, { days: 365, maxPerActor: 5000 });
    const exactScopedHistory = await app.inject({
      method: "GET",
      url: "/api/v1/attention-resolutions?userId=user_operator",
      headers: { cookie }
    });
    assert.equal(exactScopedHistory.statusCode, 200);
    assert.equal((exactScopedHistory.json() as AttentionResolutionList).total, 0);
    const clamped = await app.inject({
      method: "GET",
      url: "/api/v1/attention-resolutions?limit=101",
      headers: { cookie }
    });
    assert.equal(clamped.statusCode, 400);
  });
});

test("HOME-08 physically enforces attempt, receipt, check, and 365-day retention at response commit", async () => {
  await withServer(async () => {
    const database = getDatabase();
    const retentionNow = new Date();
    const baseMs = retentionNow.getTime() - 60_000;
    const clearResolutionTables = () =>
      database.exec(`
        DELETE FROM attention_resolution_check_idempotency;
        DELETE FROM attention_resolution_receipts;
        DELETE FROM attention_resolution_attempts;
      `);
    const physicalCounts = () => {
      const row = database
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM attention_resolution_attempts) AS attempts,
             (SELECT COUNT(*) FROM attention_resolution_receipts) AS receipts,
             (SELECT COUNT(*) FROM attention_resolution_check_idempotency) AS checks`
        )
        .get() as { attempts: number; receipts: number; checks: number };
      return {
        attempts: row.attempts,
        receipts: row.receipts,
        checks: row.checks
      };
    };

    clearResolutionTables();
    const bulkStartedAt = new Date(baseMs).toISOString();
    database
      .prepare(
        `WITH RECURSIVE sequence(value) AS (
           VALUES (0)
           UNION ALL
           SELECT value + 1 FROM sequence WHERE value < 4999
         )
         INSERT INTO attention_resolution_attempts (
           id, actor_key, owner_user_id, scoped_user_ids_json,
           idempotency_key, request_fingerprint, item_id, source, kind,
           action_key, source_ref, source_updated_at, source_anchor_at,
           source_provider, source_agent_label_normalized, title,
           target_label, target_href, status, started_at, checked_at
         )
         SELECT
           printf('retention_start_%04d', value), 'operator', NULL, '[]',
           printf('retention-start-key-%04d', value), ?,
           printf('attn:retention:start:%d', value), 'task', 'overdue_work',
           'review_due_work', printf('task:retention-start-%d', value),
           ?, ?, NULL, NULL, printf('Retention start %d', value),
           printf('Retention target %d', value), '/settings/agents',
           'unavailable', ?, NULL
         FROM sequence`
      )
      .run("0".repeat(64), bulkStartedAt, bulkStartedAt, bulkStartedAt);
    const newItem: AttentionInboxItem = {
      id: "attn:task:retention-new-start",
      source: "task",
      kind: "overdue_work",
      severity: "notice",
      state: "active",
      title: "Retention boundary start",
      reason: "This task is overdue.",
      detail: "",
      target: {
        entityType: "task",
        entityId: "retention-new-start",
        label: "Retention boundary start",
        href: "/tasks/retention-new-start"
      },
      primaryAction: {
        key: "review_due_work",
        label: "Review due work",
        href: "/tasks/retention-new-start",
        sourceRef: "task:retention-new-start",
        resolutionCondition:
          "Resolved after the existing task is done, has no due date, or is due today or later."
      },
      allowedActions: ["open", "snooze"],
      createdAt: retentionNow.toISOString(),
      updatedAt: retentionNow.toISOString(),
      sourceUpdatedAt: retentionNow.toISOString(),
      dueAt: "2000-01-01",
      snoozedUntil: null,
      metadata: {}
    };
    const boundaryStart = startAttentionResolutionAttempt({
      actorKey: "operator",
      idempotencyKey: "retention-5000-plus-one-start",
      item: newItem,
      actionKey: "review_due_work",
      sourceUpdatedAt: newItem.sourceUpdatedAt,
      now: retentionNow
    });
    assert.equal(boundaryStart.replayed, false);
    assert.deepEqual(physicalCounts(), { attempts: 5_000, receipts: 0, checks: 0 });
    assert.ok(
      database
        .prepare("SELECT 1 FROM attention_resolution_attempts WHERE id = ?")
        .get(boundaryStart.attempt.id)
    );
    assert.equal(
      database
        .prepare(
          "SELECT 1 FROM attention_resolution_attempts WHERE id = 'retention_start_0000'"
        )
        .get(),
      undefined
    );
    const boundaryStartReplay = startAttentionResolutionAttempt({
      actorKey: "operator",
      idempotencyKey: "retention-5000-plus-one-start",
      item: newItem,
      actionKey: "review_due_work",
      sourceUpdatedAt: newItem.sourceUpdatedAt,
      now: new Date(retentionNow.getTime() + 1)
    });
    assert.equal(boundaryStartReplay.replayed, true);
    assert.equal(boundaryStartReplay.attempt.id, boundaryStart.attempt.id);
    assert.equal(physicalCounts().attempts, 5_000);

    clearResolutionTables();
    const batchUpdatedAt = retentionNow.toISOString();
    database.exec("BEGIN");
    database
      .prepare(
        `WITH RECURSIVE sequence(value) AS (
           VALUES (0)
           UNION ALL
           SELECT value + 1 FROM sequence WHERE value < 99
         )
         INSERT INTO approval_requests (
           id, action_type, status, title, summary, entity_type, entity_id,
           requested_by_agent_id, requested_by_token_id,
           requested_payload_json, approved_by, approved_at, rejected_by,
           rejected_at, resolution_note, created_at, updated_at
         )
         SELECT printf('apr_retention_%04d', value), 'update_task',
           'approved', printf('Retention approval %d', value), '', NULL, NULL,
           NULL, NULL, '{}', 'operator', ?, NULL, NULL, '', ?, ?
         FROM sequence`
      )
      .run(batchUpdatedAt, batchUpdatedAt, batchUpdatedAt);
    database
      .prepare(
        `WITH RECURSIVE sequence(value) AS (
           VALUES (0)
           UNION ALL
           SELECT value + 1 FROM sequence WHERE value < 4999
         )
         INSERT INTO attention_resolution_attempts (
           id, actor_key, owner_user_id, scoped_user_ids_json,
           idempotency_key, request_fingerprint, item_id, source, kind,
           action_key, source_ref, source_updated_at, source_anchor_at,
           source_provider, source_agent_label_normalized, title,
           target_label, target_href, status, started_at, checked_at
         )
         SELECT
           printf('retention_batch_%04d', value), 'operator', NULL, '[]',
           printf('retention-batch-key-%04d', value), ?,
           printf('attn:approval:apr_retention_%04d', value), 'approval',
           'decision', 'review_decision',
           printf('approval_request:apr_retention_%04d', value), ?, ?, NULL,
           NULL, printf('Retention batch %d', value),
           printf('Retention target %d', value), '/settings/agents',
           CASE WHEN value < 100 THEN 'pending' ELSE 'unavailable' END,
           ?, NULL
         FROM sequence`
      )
      .run(
        "0".repeat(64),
        batchUpdatedAt,
        batchUpdatedAt,
        bulkStartedAt
      );
    database.exec("COMMIT");
    const batchCheck = checkAttentionResolutionAttempts({
      actorKey: "operator",
      idempotencyKey: "retention-batch-check",
      now: retentionNow
    });
    assert.equal(batchCheck.replayed, false);
    assert.equal(batchCheck.response.results.length, 100);
    assert.equal(batchCheck.response.receipts.length, 100);
    assert.deepEqual(physicalCounts(), {
      attempts: 5_000,
      receipts: 100,
      checks: 1
    });
    const returnedReceiptIds = batchCheck.response.receipts.map(
      (receipt) => receipt.id
    );
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM attention_resolution_receipts
             WHERE id IN (${returnedReceiptIds.map(() => "?").join(", ")})`
          )
          .get(...returnedReceiptIds) as { count: number }
      ).count,
      100
    );
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM activity_events
             WHERE entity_id LIKE 'retention_batch_%'
               AND event_type = 'attention_resolution_confirmed'`
          )
          .get() as { count: number }
      ).count,
      100
    );
    const batchReplay = checkAttentionResolutionAttempts({
      actorKey: "operator",
      idempotencyKey: "retention-batch-check",
      now: new Date(retentionNow.getTime() + 1)
    });
    assert.equal(batchReplay.replayed, true);
    assert.deepEqual(batchReplay.response, batchCheck.response);
    assert.deepEqual(physicalCounts(), {
      attempts: 5_000,
      receipts: 100,
      checks: 1
    });

    const afterRetention = new Date(
      retentionNow.getTime() + 366 * 24 * 60 * 60 * 1000
    );
    const futureCheck = checkAttentionResolutionAttempts({
      actorKey: "operator",
      idempotencyKey: "retention-future-check",
      now: afterRetention
    });
    assert.equal(futureCheck.replayed, false);
    assert.deepEqual(futureCheck.response, { results: [], receipts: [] });
    assert.deepEqual(physicalCounts(), { attempts: 0, receipts: 0, checks: 1 });
    const expiredReplay = checkAttentionResolutionAttempts({
      actorKey: "operator",
      idempotencyKey: "retention-batch-check",
      now: new Date(afterRetention.getTime() + 1)
    });
    assert.equal(expiredReplay.replayed, false);
    assert.deepEqual(expiredReplay.response, { results: [], receipts: [] });
    assert.deepEqual(physicalCounts(), { attempts: 0, receipts: 0, checks: 2 });
  });
});

test("HOME-08 OpenAPI publishes operator permissions, evidence rules, limits, idempotency, and retention", () => {
  const document = buildOpenApiDocument() as {
    components?: { schemas?: Record<string, unknown> };
    paths?: Record<string, { get?: { description?: string }; post?: { description?: string; tags?: string[] } }>;
  };
  for (const schema of [
    "AttentionPrimaryAction",
    "AttentionResolutionAttempt",
    "AttentionResolutionReceipt",
    "AttentionResolutionStartResult",
    "AttentionResolutionCheckResult",
    "AttentionResolutionCheckResponse",
    "AttentionResolutionList"
  ]) {
    assert.ok(document.components?.schemas?.[schema], `missing schema ${schema}`);
  }
  const start = document.paths?.["/api/v1/attention-inbox/{id}/actions/start"]?.post;
  const checkRoute = document.paths?.["/api/v1/attention-resolutions/check"]?.post;
  const list = document.paths?.["/api/v1/attention-resolutions"]?.get;
  assert.deepEqual(checkRoute?.tags, ["Attention"]);
  assert.match(start?.description ?? "", /Operator-session only/);
  assert.match(start?.description ?? "", /4,096 bytes/);
  assert.match(checkRoute?.description ?? "", /approval approved\/rejected\/executed/);
  assert.match(checkRoute?.description ?? "", /candidate disappearance alone never create a receipt/);
  assert.match(checkRoute?.description ?? "", /1,024 bytes/);
  assert.match(list?.description ?? "", /365-day, newest-5,000-records-per-actor/);
  assert.match(list?.description ?? "", /distinct from SYS-18 ten-minute Undo receipts/);
});
