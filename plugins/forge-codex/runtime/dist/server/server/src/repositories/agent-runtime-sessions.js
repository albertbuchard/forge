import { createHash, randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { recordActivityEvent } from "./activity-events.js";
import { listAgentActions } from "./collaboration.js";
import { ensureBotUser, getUserById } from "./users.js";
import { agentActionSchema, agentRuntimeEventLevelSchema, agentRuntimeReconnectPlanSchema, agentRuntimeSessionEventSchema, agentRuntimeSessionSchema, createAgentRuntimeSessionEventSchema, createAgentRuntimeSessionSchema, disconnectAgentRuntimeSessionSchema, heartbeatAgentRuntimeSessionSchema, reconnectAgentRuntimeSessionSchema } from "../types.js";
function parseMetadata(raw) {
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
function normalizeText(value) {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
}
function toReconnectPlan(row) {
    const forgeBaseUrl = normalizeText(row.base_url) ?? "http://127.0.0.1:4317";
    if (row.provider === "openclaw") {
        return agentRuntimeReconnectPlanSchema.parse({
            summary: "Restart the OpenClaw gateway, then verify the Forge plugin can talk to the shared Forge runtime again.",
            commands: [
                "openclaw gateway status",
                "openclaw gateway restart",
                "openclaw forge health"
            ],
            notes: [
                "The Forge OpenClaw plugin registers new sessions automatically through its hook surface on the next active session.",
                "If this session should share one Forge graph with Hermes or Codex, keep the same Forge base URL and data root."
            ],
            automationSupported: false
        });
    }
    if (row.provider === "hermes") {
        return agentRuntimeReconnectPlanSchema.parse({
            summary: "Ensure the Hermes Forge plugin is installed in Hermes' runtime environment, then bring Hermes back up so it can re-register its session.",
            commands: [
                "~/.hermes/hermes-agent/venv/bin/python -m pip show forge-hermes-plugin",
                "hermes gateway",
                `curl -s ${forgeBaseUrl}/api/v1/health`
            ],
            notes: [
                "Hermes keeps its Forge plugin config under ~/.hermes/forge/config.json.",
                "Session registration happens on Hermes session start and refreshes on later turns."
            ],
            automationSupported: false
        });
    }
    return agentRuntimeReconnectPlanSchema.parse({
        summary: "Restart or resume the Codex session so the Forge MCP bridge launches again and re-registers with Forge.",
        commands: [
            "codex mcp list",
            "codex",
            `curl -s ${forgeBaseUrl}/api/v1/health`
        ],
        notes: [
            "The Forge Codex bridge registers itself when the MCP process starts and heartbeats while it stays alive.",
            "If Forge is local, keep Codex pointed at the same Forge origin, port, and shared data root."
        ],
        automationSupported: false
    });
}
function deriveStatus(row, nowMs = Date.now()) {
    if (row.status === "disconnected" || row.status === "reconnecting") {
        return row.status;
    }
    if (row.status === "error") {
        return "error";
    }
    const heartbeatMs = new Date(row.last_heartbeat_at).getTime();
    const staleAfterMs = Math.max(1, row.stale_after_seconds) * 1000;
    return nowMs - heartbeatMs > staleAfterMs ? "stale" : "connected";
}
function mapEvent(row) {
    return agentRuntimeSessionEventSchema.parse({
        id: row.id,
        sessionId: row.session_id,
        eventType: row.event_type,
        level: row.level,
        title: row.title,
        summary: row.summary,
        metadata: parseMetadata(row.metadata_json),
        createdAt: row.created_at
    });
}
function countAgentActionsForSession(row) {
    if (!row.agent_id) {
        return 0;
    }
    const endAt = row.ended_at ?? new Date().toISOString();
    const result = getDatabase()
        .prepare(`SELECT COUNT(*) AS count
       FROM agent_actions
       WHERE agent_id = ?
         AND created_at >= ?
         AND created_at <= ?`)
        .get(row.agent_id, row.started_at, endAt);
    return result.count;
}
function listAgentActionsForSession(row, limit = 20) {
    if (!row.agent_id) {
        return [];
    }
    const startedAtMs = Date.parse(row.started_at);
    const endedAtMs = Date.parse(row.ended_at ?? new Date().toISOString());
    return listAgentActions(row.agent_id)
        .filter((action) => {
        const createdAtMs = Date.parse(action.createdAt);
        return (!Number.isNaN(createdAtMs) &&
            createdAtMs >= startedAtMs &&
            createdAtMs <= endedAtMs);
    })
        .slice(0, limit)
        .map((action) => agentActionSchema.parse(action));
}
function listRecentSessionEvents(sessionId, limit = 4) {
    const rows = getDatabase()
        .prepare(`SELECT id, session_id, event_type, level, title, summary, metadata_json, created_at
       FROM agent_runtime_session_events
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ?`)
        .all(sessionId, limit);
    return rows.map(mapEvent);
}
function countSessionEvents(sessionId) {
    const result = getDatabase()
        .prepare(`SELECT COUNT(*) AS count
       FROM agent_runtime_session_events
       WHERE session_id = ?`)
        .get(sessionId);
    return result.count;
}
function mapSession(row) {
    const status = deriveStatus(row);
    return agentRuntimeSessionSchema.parse({
        id: row.id,
        agentId: row.agent_id,
        agentLabel: row.agent_label,
        agentType: row.agent_type,
        provider: row.provider,
        sessionKey: row.session_key,
        sessionLabel: row.session_label || row.session_key,
        actorLabel: row.actor_label,
        connectionMode: row.connection_mode,
        status,
        alive: status === "connected",
        baseUrl: row.base_url,
        webUrl: row.web_url,
        dataRoot: row.data_root,
        externalSessionId: row.external_session_id,
        staleAfterSeconds: row.stale_after_seconds,
        reconnectCount: row.reconnect_count,
        reconnectRequestedAt: row.reconnect_requested_at,
        lastError: row.last_error,
        lastSeenAt: row.last_seen_at,
        lastHeartbeatAt: row.last_heartbeat_at,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: parseMetadata(row.metadata_json),
        recentEvents: listRecentSessionEvents(row.id),
        eventCount: countSessionEvents(row.id),
        actionCount: countAgentActionsForSession(row),
        reconnectPlan: toReconnectPlan(row)
    });
}
function getSessionRowById(sessionId) {
    return getDatabase()
        .prepare(`SELECT
         id, agent_id, agent_label, agent_type, provider, session_key, session_label, actor_label,
         connection_mode, status, base_url, web_url, data_root, external_session_id,
         stale_after_seconds, reconnect_count, reconnect_requested_at, last_error,
         last_seen_at, last_heartbeat_at, started_at, ended_at, metadata_json,
         created_at, updated_at
       FROM agent_runtime_sessions
       WHERE id = ?`)
        .get(sessionId);
}
function getSessionRowByCompositeKey(provider, sessionKey) {
    return getDatabase()
        .prepare(`SELECT
         id, agent_id, agent_label, agent_type, provider, session_key, session_label, actor_label,
         connection_mode, status, base_url, web_url, data_root, external_session_id,
         stale_after_seconds, reconnect_count, reconnect_requested_at, last_error,
         last_seen_at, last_heartbeat_at, started_at, ended_at, metadata_json,
         created_at, updated_at
       FROM agent_runtime_sessions
       WHERE provider = ? AND session_key = ?`)
        .get(provider, sessionKey);
}
function resolveSessionRow(locator) {
    if (locator.sessionId?.trim()) {
        return getSessionRowById(locator.sessionId.trim());
    }
    if (locator.provider?.trim() && locator.sessionKey?.trim()) {
        return getSessionRowByCompositeKey(locator.provider.trim(), locator.sessionKey.trim());
    }
    return undefined;
}
function ensureCurrentSessionInstance(row, externalSessionId) {
    const claimedExternalSessionId = normalizeText(externalSessionId);
    const currentExternalSessionId = normalizeText(row.external_session_id);
    if (claimedExternalSessionId &&
        currentExternalSessionId &&
        claimedExternalSessionId !== currentExternalSessionId) {
        return false;
    }
    return true;
}
function normalizeIdentityPart(value) {
    return (value
        ?.trim()
        .toLowerCase()
        .replace(/[^a-z0-9._:]+/g, "_")
        .replace(/^_+|_+$/g, "") ?? "");
}
function shortHash(value) {
    return createHash("sha1").update(value).digest("hex").slice(0, 12);
}
function canonicalRuntimeAgentLabel(provider) {
    if (provider === "openclaw") {
        return "Forge OpenClaw";
    }
    if (provider === "hermes") {
        return "Forge Hermes";
    }
    return "Forge Codex";
}
function canonicalRuntimeDescription(provider) {
    return `${canonicalRuntimeAgentLabel(provider)} runtime agent with stable Forge identity and linked Kanban user.`;
}
function canonicalAgentUserSpec(provider) {
    if (provider === "openclaw") {
        return {
            id: "user_agent_openclaw",
            handle: "openclaw",
            displayName: "OpenClaw",
            description: "OpenClaw runtime actor linked to Forge agent identity and Kanban ownership.",
            accentColor: "#38bdf8"
        };
    }
    if (provider === "hermes") {
        return {
            id: "user_agent_hermes",
            handle: "hermes",
            displayName: "Hermes",
            description: "Hermes runtime actor linked to Forge agent identity and Kanban ownership.",
            accentColor: "#a78bfa"
        };
    }
    return {
        id: "user_agent_codex",
        handle: "codex",
        displayName: "Codex",
        description: "Codex runtime actor linked to Forge agent identity and Kanban ownership.",
        accentColor: "#22c55e"
    };
}
function deriveMachineKey(input) {
    const explicit = normalizeIdentityPart(input.machineKey);
    if (explicit) {
        return explicit;
    }
    const source = [
        normalizeText(input.dataRoot) ?? "",
        normalizeText(input.baseUrl) ?? "local"
    ].join("|");
    return `machine_${shortHash(source)}`;
}
function derivePersonaKey(input) {
    return (normalizeIdentityPart(input.personaKey) ||
        normalizeIdentityPart(input.agentType) ||
        "default");
}
function deriveAgentIdentityKey(input) {
    const explicit = normalizeIdentityPart(input.agentIdentityKey);
    if (explicit) {
        return explicit;
    }
    return `runtime:${input.provider}:${deriveMachineKey(input)}:${derivePersonaKey(input)}`;
}
function linkAgentIdentityUsers(agentId, provider, linkedUserIds, now) {
    const primaryUser = ensureBotUser(canonicalAgentUserSpec(provider));
    const normalizedUserIds = Array.from(new Set([primaryUser.id, ...linkedUserIds.map((id) => id.trim()).filter(Boolean)]));
    for (const userId of normalizedUserIds) {
        if (!getUserById(userId)) {
            continue;
        }
        getDatabase()
            .prepare(`INSERT INTO agent_identity_users (agent_id, user_id, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(agent_id, user_id) DO UPDATE SET
           role = excluded.role,
           updated_at = excluded.updated_at`)
            .run(agentId, userId, userId === primaryUser.id ? "primary" : "linked", now, now);
    }
}
function disconnectSupersededSingletonSessions(parsed, sessionId, agentId, now) {
    if (!parsed.metadata?.singleton) {
        return;
    }
    const rows = getDatabase()
        .prepare(`SELECT
         id, agent_id, agent_label, agent_type, provider, session_key, session_label, actor_label,
         connection_mode, status, base_url, web_url, data_root, external_session_id,
         stale_after_seconds, reconnect_count, reconnect_requested_at, last_error,
         last_seen_at, last_heartbeat_at, started_at, ended_at, metadata_json,
         created_at, updated_at
       FROM agent_runtime_sessions
       WHERE provider = ?
         AND agent_id = ?
         AND coalesce(base_url, '') = coalesce(?, '')
         AND coalesce(data_root, '') = coalesce(?, '')
         AND id <> ?`)
        .all(parsed.provider, agentId, normalizeText(parsed.baseUrl), normalizeText(parsed.dataRoot), sessionId);
    for (const row of rows) {
        if (row.status === "disconnected" && row.ended_at) {
            continue;
        }
        getDatabase()
            .prepare(`UPDATE agent_runtime_sessions
         SET status = 'disconnected', last_error = ?, last_seen_at = ?, ended_at = ?, updated_at = ?
         WHERE id = ?`)
            .run("Superseded by a newer singleton runtime bridge.", now, now, now, row.id);
        insertSessionEvent(row.id, {
            eventType: "session_superseded",
            level: "warning",
            title: "Session superseded",
            summary: `${parsed.provider} registered a newer singleton bridge and replaced this runtime session.`,
            metadata: {
                replacementSessionId: sessionId,
                replacementSessionKey: parsed.sessionKey
            }
        }, now);
    }
}
function upsertRuntimeAgentIdentity(input) {
    const identityKey = deriveAgentIdentityKey(input);
    const machineKey = deriveMachineKey(input);
    const personaKey = derivePersonaKey(input);
    const label = canonicalRuntimeAgentLabel(input.provider);
    const existing = getDatabase()
        .prepare(`SELECT id
       FROM agent_identities
       WHERE identity_key = ?
          OR (
            (identity_key IS NULL OR machine_key IS NULL OR machine_key = 'legacy' OR identity_key LIKE 'runtime:%:legacy:%')
            AND (
              provider = ?
              OR lower(agent_type) = lower(?)
              OR lower(label) = lower(?)
            )
          )
       LIMIT 1`)
        .get(identityKey, input.provider, input.provider, label);
    const now = new Date().toISOString();
    const description = canonicalRuntimeDescription(input.provider);
    if (existing) {
        getDatabase()
            .prepare(`UPDATE agent_identities
         SET label = ?, agent_type = ?, identity_key = ?, provider = ?,
             machine_key = ?, persona_key = ?, description = ?, updated_at = ?
         WHERE id = ?`)
            .run(label, input.agentType || input.provider, identityKey, input.provider, machineKey, personaKey, description, now, existing.id);
        linkAgentIdentityUsers(existing.id, input.provider, input.linkedUserIds, now);
        return existing.id;
    }
    const agentId = `agt_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
        .prepare(`INSERT INTO agent_identities (
        id, label, agent_type, identity_key, provider, machine_key, persona_key,
        trust_level, autonomy_mode, approval_mode,
        description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'trusted', 'approval_required', 'approval_by_default', ?, ?, ?)`)
        .run(agentId, label, input.agentType || input.provider, identityKey, input.provider, machineKey, personaKey, description, now, now);
    linkAgentIdentityUsers(agentId, input.provider, input.linkedUserIds, now);
    return agentId;
}
function insertSessionEvent(sessionId, input, now = new Date().toISOString()) {
    const eventId = `agse_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    getDatabase()
        .prepare(`INSERT INTO agent_runtime_session_events (
        id, session_id, event_type, level, title, summary, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(eventId, sessionId, input.eventType, agentRuntimeEventLevelSchema.parse(input.level ?? "info"), input.title, input.summary?.trim() ?? "", JSON.stringify(input.metadata ?? {}), now);
}
export function listAgentRuntimeSessions() {
    const rows = getDatabase()
        .prepare(`SELECT
         id, agent_id, agent_label, agent_type, provider, session_key, session_label, actor_label,
         connection_mode, status, base_url, web_url, data_root, external_session_id,
         stale_after_seconds, reconnect_count, reconnect_requested_at, last_error,
         last_seen_at, last_heartbeat_at, started_at, ended_at, metadata_json,
         created_at, updated_at
       FROM agent_runtime_sessions
       ORDER BY last_seen_at DESC, created_at DESC`)
        .all();
    return rows.map(mapSession);
}
export function getAgentRuntimeSessionHistory(sessionId) {
    const row = getSessionRowById(sessionId);
    if (!row) {
        return null;
    }
    const session = mapSession(row);
    const events = getDatabase()
        .prepare(`SELECT id, session_id, event_type, level, title, summary, metadata_json, created_at
       FROM agent_runtime_session_events
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT 40`)
        .all(sessionId);
    return {
        session,
        events: events.map(mapEvent),
        actions: listAgentActionsForSession(row, 40)
    };
}
export function registerAgentRuntimeSession(input) {
    const parsed = createAgentRuntimeSessionSchema.parse(input);
    return runInTransaction(() => {
        const now = new Date().toISOString();
        const agentId = upsertRuntimeAgentIdentity(parsed);
        const agentLabel = canonicalRuntimeAgentLabel(parsed.provider);
        const existing = getSessionRowByCompositeKey(parsed.provider, parsed.sessionKey);
        const sessionId = existing?.id ?? `ags_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
        if (existing) {
            getDatabase()
                .prepare(`UPDATE agent_runtime_sessions
           SET agent_id = ?, agent_label = ?, agent_type = ?, session_label = ?, actor_label = ?,
               connection_mode = ?, status = ?, base_url = ?, web_url = ?, data_root = ?,
               external_session_id = ?, stale_after_seconds = ?, reconnect_requested_at = NULL,
               last_error = ?, last_seen_at = ?, last_heartbeat_at = ?, started_at = ?,
               ended_at = NULL, metadata_json = ?, updated_at = ?
           WHERE id = ?`)
                .run(agentId, agentLabel, parsed.agentType || parsed.provider, parsed.sessionLabel || parsed.sessionKey, parsed.actorLabel, parsed.connectionMode, parsed.status === "error" ? "error" : "connected", normalizeText(parsed.baseUrl), normalizeText(parsed.webUrl), normalizeText(parsed.dataRoot), normalizeText(parsed.externalSessionId), parsed.staleAfterSeconds, normalizeText(parsed.lastError), now, now, now, JSON.stringify(parsed.metadata), now, sessionId);
            insertSessionEvent(sessionId, {
                eventType: "session_registered",
                title: "Session re-registered",
                summary: `${parsed.provider} reconnected as ${parsed.actorLabel}.`,
                metadata: parsed.metadata
            }, now);
        }
        else {
            getDatabase()
                .prepare(`INSERT INTO agent_runtime_sessions (
             id, agent_id, agent_label, agent_type, provider, session_key, session_label, actor_label,
             connection_mode, status, base_url, web_url, data_root, external_session_id,
             stale_after_seconds, reconnect_count, reconnect_requested_at, last_error,
             last_seen_at, last_heartbeat_at, started_at, ended_at, metadata_json,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, NULL, ?, ?, ?)`)
                .run(sessionId, agentId, agentLabel, parsed.agentType || parsed.provider, parsed.provider, parsed.sessionKey, parsed.sessionLabel || parsed.sessionKey, parsed.actorLabel, parsed.connectionMode, parsed.status === "error" ? "error" : "connected", normalizeText(parsed.baseUrl), normalizeText(parsed.webUrl), normalizeText(parsed.dataRoot), normalizeText(parsed.externalSessionId), parsed.staleAfterSeconds, normalizeText(parsed.lastError), now, now, now, JSON.stringify(parsed.metadata), now, now);
            insertSessionEvent(sessionId, {
                eventType: "session_registered",
                title: "Session registered",
                summary: `${parsed.provider} registered as ${parsed.actorLabel}.`,
                metadata: parsed.metadata
            }, now);
        }
        disconnectSupersededSingletonSessions(parsed, sessionId, agentId, now);
        recordActivityEvent({
            entityType: "session",
            entityId: sessionId,
            eventType: "agent_session_registered",
            title: `Agent session registered: ${agentLabel}`,
            description: `${parsed.provider} registered a live agent session.`,
            actor: parsed.actorLabel,
            source: "agent",
            metadata: {
                provider: parsed.provider,
                sessionKey: parsed.sessionKey
            }
        });
        return mapSession(getSessionRowById(sessionId));
    });
}
export function heartbeatAgentRuntimeSession(input) {
    const parsed = heartbeatAgentRuntimeSessionSchema.parse(input);
    return runInTransaction(() => {
        const row = resolveSessionRow(parsed);
        if (!row) {
            throw new Error("Agent runtime session not found.");
        }
        if (!ensureCurrentSessionInstance(row, parsed.externalSessionId)) {
            return mapSession(row);
        }
        const now = new Date().toISOString();
        const nextStatus = parsed.status === "error"
            ? "error"
            : parsed.status === "reconnecting"
                ? "reconnecting"
                : "connected";
        const mergedMetadata = {
            ...parseMetadata(row.metadata_json),
            ...parsed.metadata
        };
        getDatabase()
            .prepare(`UPDATE agent_runtime_sessions
         SET status = ?, last_error = ?, last_seen_at = ?, last_heartbeat_at = ?,
             metadata_json = ?, updated_at = ?, ended_at = CASE WHEN ? = 'connected' THEN NULL ELSE ended_at END
         WHERE id = ?`)
            .run(nextStatus, normalizeText(parsed.lastError), now, now, JSON.stringify(mergedMetadata), now, nextStatus, row.id);
        if (parsed.summary.trim().length > 0 || parsed.status === "error") {
            insertSessionEvent(row.id, {
                eventType: "heartbeat",
                level: parsed.status === "error" ? "error" : "info",
                title: parsed.status === "error" ? "Heartbeat reported an error" : "Heartbeat",
                summary: parsed.summary,
                metadata: mergedMetadata
            }, now);
        }
        return mapSession(getSessionRowById(row.id));
    });
}
export function appendAgentRuntimeSessionEvent(input) {
    const parsed = createAgentRuntimeSessionEventSchema.parse(input);
    return runInTransaction(() => {
        const row = resolveSessionRow(parsed);
        if (!row) {
            throw new Error("Agent runtime session not found.");
        }
        if (!ensureCurrentSessionInstance(row, parsed.externalSessionId)) {
            return mapEvent(getDatabase()
                .prepare(`SELECT id, session_id, event_type, level, title, summary, metadata_json, created_at
             FROM agent_runtime_session_events
             WHERE session_id = ?
             ORDER BY created_at DESC
             LIMIT 1`)
                .get(row.id));
        }
        const now = new Date().toISOString();
        const mergedMetadata = {
            ...parseMetadata(row.metadata_json),
            ...parsed.metadata
        };
        const nextStatus = parsed.status === "stale"
            ? "connected"
            : parsed.status ?? row.status;
        getDatabase()
            .prepare(`UPDATE agent_runtime_sessions
         SET status = ?, last_error = ?, last_seen_at = ?, metadata_json = ?, updated_at = ?
         WHERE id = ?`)
            .run(nextStatus, nextStatus === "error"
            ? normalizeText(parsed.summary) ?? row.last_error
            : row.last_error, now, JSON.stringify(mergedMetadata), now, row.id);
        insertSessionEvent(row.id, {
            eventType: parsed.eventType,
            level: parsed.level,
            title: parsed.title,
            summary: parsed.summary,
            metadata: parsed.metadata
        }, now);
        return mapEvent(getDatabase()
            .prepare(`SELECT id, session_id, event_type, level, title, summary, metadata_json, created_at
           FROM agent_runtime_session_events
           WHERE session_id = ?
           ORDER BY created_at DESC
           LIMIT 1`)
            .get(row.id));
    });
}
export function reconnectAgentRuntimeSession(sessionId, input) {
    const parsed = reconnectAgentRuntimeSessionSchema.parse(input);
    return runInTransaction(() => {
        const row = getSessionRowById(sessionId);
        if (!row) {
            return null;
        }
        const now = new Date().toISOString();
        getDatabase()
            .prepare(`UPDATE agent_runtime_sessions
         SET status = 'reconnecting', reconnect_count = reconnect_count + 1,
             reconnect_requested_at = ?, updated_at = ?
         WHERE id = ?`)
            .run(now, now, sessionId);
        insertSessionEvent(sessionId, {
            eventType: "reconnect_requested",
            level: "warning",
            title: "Reconnect requested",
            summary: parsed.note,
            metadata: {}
        }, now);
        recordActivityEvent({
            entityType: "session",
            entityId: sessionId,
            eventType: "agent_session_reconnect_requested",
            title: `Reconnect requested for ${row.agent_label}`,
            description: parsed.note || `${row.provider} session marked for reconnect.`,
            actor: null,
            source: "ui",
            metadata: {
                provider: row.provider,
                sessionKey: row.session_key
            }
        });
        return mapSession(getSessionRowById(sessionId));
    });
}
export function disconnectAgentRuntimeSession(sessionId, input) {
    const parsed = disconnectAgentRuntimeSessionSchema.parse(input);
    return runInTransaction(() => {
        const row = getSessionRowById(sessionId);
        if (!row) {
            return null;
        }
        if (!ensureCurrentSessionInstance(row, parsed.externalSessionId)) {
            return mapSession(row);
        }
        const now = new Date().toISOString();
        getDatabase()
            .prepare(`UPDATE agent_runtime_sessions
         SET status = 'disconnected', last_error = ?, last_seen_at = ?, ended_at = ?, updated_at = ?
         WHERE id = ?`)
            .run(normalizeText(parsed.lastError), now, now, now, sessionId);
        insertSessionEvent(sessionId, {
            eventType: "session_disconnected",
            level: parsed.lastError ? "warning" : "info",
            title: "Session disconnected",
            summary: parsed.note,
            metadata: parsed.lastError ? { lastError: parsed.lastError } : {}
        }, now);
        recordActivityEvent({
            entityType: "session",
            entityId: sessionId,
            eventType: "agent_session_disconnected",
            title: `Agent session disconnected: ${row.agent_label}`,
            description: parsed.note || `${row.provider} session marked disconnected.`,
            actor: row.actor_label,
            source: "agent",
            metadata: {
                provider: row.provider,
                sessionKey: row.session_key
            }
        });
        return mapSession(getSessionRowById(sessionId));
    });
}
