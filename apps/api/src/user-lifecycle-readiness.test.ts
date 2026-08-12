import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import {
  appendAgentRuntimeSessionEvent,
  disconnectAgentRuntimeSession,
  heartbeatAgentRuntimeSession,
  registerAgentRuntimeSession
} from "./repositories/agent-runtime-sessions.js";
import { setEntityOwner } from "./repositories/entity-ownership.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("user lifecycle atomically transfers responsibility, disables bot authority, replays exactly, and preserves history", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-user-lifecycle-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  const cookie = issueTestOperatorSessionCookie(app);
  const sourceUserId = "user_agent_codex";
  const replacementUserId = "user_operator";
  const now = new Date().toISOString();

  try {
    const session = registerAgentRuntimeSession({
      provider: "codex",
      agentLabel: "Forge Codex",
      agentType: "codex",
      actorLabel: "Codex",
      sessionKey: "lifecycle-test-session",
      sessionLabel: "Lifecycle test session",
      linkedUserIds: [],
      connectionMode: "mcp",
      baseUrl: "http://127.0.0.1:4317",
      webUrl: null,
      dataRoot: rootDir,
      externalSessionId: null,
      staleAfterSeconds: 3600,
      metadata: { test: true },
      status: "connected",
      lastError: null
    });
    const identity = getDatabase()
      .prepare(
        `SELECT agent_id
         FROM agent_identity_users
         WHERE user_id = ? AND role = 'primary'
         LIMIT 1`
      )
      .get(sourceUserId) as { agent_id: string };
    getDatabase()
      .prepare(
        `INSERT INTO agent_tokens (
           id, label, token_hash, token_prefix, scopes_json, agent_id,
           trust_level, autonomy_mode, approval_mode, description,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'trusted', 'approval_required',
                   'approval_by_default', '', ?, ?)`
      )
      .run(
        "tok_lifecycle_test",
        "Lifecycle test token",
        "a".repeat(64),
        "forge_life••••",
        JSON.stringify(["read", "write"]),
        identity.agent_id,
        now,
        now
      );
    getDatabase()
      .prepare(
        `INSERT INTO entity_owners (
           entity_type, entity_id, user_id, role, created_at, updated_at
         ) VALUES ('goal', 'goal_lifecycle_owned', ?, 'owner', ?, ?)`
      )
      .run(sourceUserId, now, now);
    getDatabase()
      .prepare(
        `INSERT INTO entity_assignments (
           entity_type, entity_id, user_id, role, created_at, updated_at
         ) VALUES ('task', 'task_lifecycle_assigned', ?, 'assignee', ?, ?)`
      )
      .run(sourceUserId, now, now);

    const directoryBefore = await app.inject({
      method: "GET",
      url: "/api/v1/users/directory",
      headers: { cookie }
    });
    assert.equal(directoryBefore.statusCode, 200, directoryBefore.body);
    const sourceEvidence = (
      directoryBefore.json() as {
        directory: {
          identityEvidence: Array<{
            userId: string;
            trustState: string;
            connectedSessionCount: number;
          }>;
        };
      }
    ).directory.identityEvidence.find((entry) => entry.userId === sourceUserId);
    assert.equal(sourceEvidence?.trustState, "verified_runtime");
    assert.equal(sourceEvidence?.connectedSessionCount, 1);

    disconnectAgentRuntimeSession(session.id, {
      note: "Prove a linked identity without a live runtime is not verified.",
      externalSessionId: session.externalSessionId,
      lastError: null
    });
    const configuredDirectory = await app.inject({
      method: "GET",
      url: "/api/v1/users/directory",
      headers: { cookie }
    });
    assert.equal(configuredDirectory.statusCode, 200, configuredDirectory.body);
    const configuredEvidence = (
      configuredDirectory.json() as {
        directory: {
          identityEvidence: Array<{
            userId: string;
            trustState: string;
            connectedSessionCount: number;
          }>;
        };
      }
    ).directory.identityEvidence.find((entry) => entry.userId === sourceUserId);
    assert.equal(configuredEvidence?.trustState, "configured");
    assert.equal(configuredEvidence?.connectedSessionCount, 0);
    heartbeatAgentRuntimeSession({
      sessionId: session.id,
      externalSessionId: session.externalSessionId ?? undefined,
      status: "connected",
      summary: "",
      lastError: null,
      metadata: {}
    });

    const previewResponse = await app.inject({
      method: "GET",
      url: `/api/v1/users/${sourceUserId}/deactivation-preview?replacementUserId=${replacementUserId}`,
      headers: { cookie }
    });
    assert.equal(previewResponse.statusCode, 200, previewResponse.body);
    const preview = (
      previewResponse.json() as {
        preview: {
          totalOwnedEntities: number;
          totalAssignments: number;
          activeRuntimeSessions: number;
          activeAgentTokens: number;
          canDeactivate: boolean;
        };
      }
    ).preview;
    assert.deepEqual(preview, {
      ...preview,
      totalOwnedEntities: 1,
      totalAssignments: 1,
      activeRuntimeSessions: 1,
      activeAgentTokens: 1,
      canDeactivate: true
    });

    const withoutDisconnect = await app.inject({
      method: "POST",
      url: `/api/v1/users/${sourceUserId}/deactivate`,
      headers: { cookie },
      payload: {
        replacementUserId,
        reason: "Move current Codex responsibility to the operator.",
        disconnectActiveSessions: false,
        idempotencyKey: "lifecycle-deactivate-no-disconnect"
      }
    });
    assert.equal(withoutDisconnect.statusCode, 409, withoutDisconnect.body);

    const request = {
      replacementUserId,
      reason: "Move current Codex responsibility to the operator.",
      disconnectActiveSessions: true,
      idempotencyKey: "lifecycle-deactivate-stable"
    };
    const deactivated = await app.inject({
      method: "POST",
      url: `/api/v1/users/${sourceUserId}/deactivate`,
      headers: { cookie },
      payload: request
    });
    assert.equal(deactivated.statusCode, 200, deactivated.body);
    assert.equal(deactivated.headers["idempotency-replayed"], "false");
    const receipt = (
      deactivated.json() as {
        receipt: {
          id: string;
          ownershipTransferred: number;
          assignmentsTransferred: number;
          sessionsDisconnected: number;
          tokensRevoked: number;
          lifecycleStatus: string;
          replayed: boolean;
        };
      }
    ).receipt;
    assert.equal(receipt.ownershipTransferred, 1);
    assert.equal(receipt.assignmentsTransferred, 1);
    assert.equal(receipt.sessionsDisconnected, 1);
    assert.equal(receipt.tokensRevoked, 1);
    assert.equal(receipt.lifecycleStatus, "inactive");
    assert.equal(receipt.replayed, false);

    const owner = getDatabase()
      .prepare(
        `SELECT user_id FROM entity_owners
         WHERE entity_type = 'goal' AND entity_id = 'goal_lifecycle_owned'`
      )
      .get() as { user_id: string };
    const assignment = getDatabase()
      .prepare(
        `SELECT user_id FROM entity_assignments
         WHERE entity_type = 'task' AND entity_id = 'task_lifecycle_assigned'`
      )
      .get() as { user_id: string };
    assert.equal(owner.user_id, replacementUserId);
    assert.equal(assignment.user_id, replacementUserId);
    assert.equal(
      (
        getDatabase()
          .prepare(`SELECT status FROM agent_runtime_sessions WHERE id = ?`)
          .get(session.id) as { status: string }
      ).status,
      "disconnected"
    );
    assert.ok(
      (
        getDatabase()
          .prepare(`SELECT revoked_at FROM agent_tokens WHERE id = ?`)
          .get("tok_lifecycle_test") as { revoked_at: string | null }
      ).revoked_at
    );

    const activeUsers = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: { cookie }
    });
    assert.equal(activeUsers.statusCode, 200, activeUsers.body);
    assert.equal(
      (activeUsers.json() as { users: Array<{ id: string }> }).users.some(
        (user) => user.id === sourceUserId
      ),
      false
    );
    assert.throws(
      () => setEntityOwner("goal", "goal_inactive_denied", sourceUserId),
      /inactive and cannot own/u
    );

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/users/${sourceUserId}/deactivate`,
      headers: { cookie },
      payload: request
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.headers["idempotency-replayed"], "true");
    assert.equal(
      (replay.json() as { receipt: { id: string; replayed: boolean } }).receipt
        .id,
      receipt.id
    );
    assert.equal(
      (replay.json() as { receipt: { replayed: boolean } }).receipt.replayed,
      true
    );

    const changedReplay = await app.inject({
      method: "POST",
      url: `/api/v1/users/${sourceUserId}/deactivate`,
      headers: { cookie },
      payload: { ...request, reason: "Changed after the uncertain response." }
    });
    assert.equal(changedReplay.statusCode, 409, changedReplay.body);

    assert.throws(
      () =>
        registerAgentRuntimeSession({
          provider: "codex",
          agentLabel: "Forge Codex",
          agentType: "codex",
          actorLabel: "Codex",
          sessionKey: "lifecycle-test-session-after-deactivation",
          sessionLabel: "Lifecycle test session after deactivation",
          linkedUserIds: [],
          connectionMode: "mcp",
          baseUrl: "http://127.0.0.1:4317",
          webUrl: null,
          dataRoot: rootDir,
          externalSessionId: null,
          staleAfterSeconds: 3600,
          metadata: {},
          status: "connected",
          lastError: null
        }),
      /inactive/u
    );
    assert.throws(
      () =>
        appendAgentRuntimeSessionEvent({
          sessionId: session.id,
          externalSessionId: session.externalSessionId ?? undefined,
          eventType: "work_update",
          level: "info",
          title: "Inactive runtime attempted an update",
          summary: "This event must not be persisted.",
          metadata: {},
          status: "connected"
        }),
      /inactive/u
    );

    const reactivated = await app.inject({
      method: "POST",
      url: `/api/v1/users/${sourceUserId}/reactivate`,
      headers: { cookie },
      payload: {
        reason: "Codex is approved to return with newly rotated credentials.",
        idempotencyKey: "lifecycle-reactivate-stable"
      }
    });
    assert.equal(reactivated.statusCode, 200, reactivated.body);
    assert.equal(
      (reactivated.json() as { user: { lifecycleStatus: string } }).user
        .lifecycleStatus,
      "active"
    );
    assert.ok(
      (
        getDatabase()
          .prepare(`SELECT revoked_at FROM agent_tokens WHERE id = ?`)
          .get("tok_lifecycle_test") as { revoked_at: string | null }
      ).revoked_at,
      "reactivation must not silently restore the old credential"
    );

    const defaultResponse = await app.inject({
      method: "PUT",
      url: `/api/v1/users/${sourceUserId}/ownership-default`,
      headers: { cookie },
      payload: {
        ownerUserId: replacementUserId,
        idempotencyKey: "lifecycle-default-stable"
      }
    });
    assert.equal(defaultResponse.statusCode, 200, defaultResponse.body);
    const attributedOwner = setEntityOwner(
      "goal",
      "goal_default_owner",
      undefined,
      "Codex"
    );
    assert.equal(attributedOwner.userId, replacementUserId);

    const operatorDeactivation = await app.inject({
      method: "POST",
      url: "/api/v1/users/user_operator/deactivate",
      headers: { cookie },
      payload: {
        replacementUserId: sourceUserId,
        reason: "This must never be accepted.",
        disconnectActiveSessions: true,
        idempotencyKey: "lifecycle-operator-denied"
      }
    });
    assert.equal(
      operatorDeactivation.statusCode,
      409,
      operatorDeactivation.body
    );

    const lifecycleActivities = (
      getDatabase()
        .prepare(
          `SELECT event_type FROM activity_events
           WHERE entity_type = 'system' AND entity_id = ?
           ORDER BY created_at`
        )
        .all(sourceUserId) as Array<{ event_type: string }>
    ).map((row) => row.event_type);
    assert.deepEqual(lifecycleActivities, [
      "user_deactivated",
      "user_reactivated",
      "user_ownership_default_updated"
    ]);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
