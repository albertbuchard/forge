import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";

import {
  closeDatabase,
  configureDatabase,
  getDatabase,
  initializeDatabase
} from "./db.js";
import {
  disconnectAgentRuntimeSession,
  registerAgentRuntimeSession
} from "./repositories/agent-runtime-sessions.js";

test("routine agent session lifecycle stays out of general activity", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-agent-runtime-sessions-")
  );
  configureDatabase({ dataRoot: rootDir, seedDemoData: false });
  await initializeDatabase();

  try {
    const session = registerAgentRuntimeSession({
      provider: "codex",
      agentLabel: "Forge Codex",
      sessionKey: "codex-test-session",
      sessionLabel: "Codex test",
      actorLabel: "Forge Codex",
      connectionMode: "mcp",
      status: "connected",
      baseUrl: "http://127.0.0.1:4317",
      dataRoot: rootDir,
      externalSessionId: "external-session-1",
      staleAfterSeconds: 120,
      metadata: {
        singleton: true
      }
    });

    disconnectAgentRuntimeSession(session.id, {
      note: "Codex MCP server shutdown (SIGTERM).",
      externalSessionId: "external-session-1",
      lastError: null
    });

    const lifecycleActivity = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM activity_events
         WHERE entity_type = 'session'
           AND event_type IN (
             'agent_session_registered',
             'agent_session_disconnected'
           )`
      )
      .get() as { count: number };
    assert.equal(lifecycleActivity.count, 0);

    const lifecycleLog = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM event_log
         WHERE entity_type = 'session'
           AND event_kind IN (
             'activity.agent_session_registered',
             'activity.agent_session_disconnected'
           )`
      )
      .get() as { count: number };
    assert.equal(lifecycleLog.count, 0);

    const sessionEvents = getDatabase()
      .prepare(
        `SELECT event_type
         FROM agent_runtime_session_events
         WHERE session_id = ?
         ORDER BY created_at ASC`
      )
      .all(session.id) as Array<{ event_type: string }>;
    assert.deepEqual(
      sessionEvents.map((row) => row.event_type),
      ["session_registered", "session_disconnected"]
    );
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
