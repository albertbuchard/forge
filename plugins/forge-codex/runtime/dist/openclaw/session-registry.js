import { isAgentBootstrapEvent } from "openclaw/plugin-sdk/hook-runtime";
import { callConfiguredForgeApi, expectForgeSuccess, resolveConfiguredForgeActorLabel } from "./api-client.js";
const SESSION_IDS = new Map();
const SESSION_PROVIDER = "openclaw";
const DEFAULT_RUNTIME_AGENT_LABEL = "Forge OpenClaw";
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function asString(value) {
    return typeof value === "string" ? value.trim() : "";
}
function excerpt(value, limit = 140) {
    const normalized = asString(value).replace(/\s+/g, " ").trim();
    if (!normalized) {
        return "";
    }
    if (normalized.length <= limit) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}
function getSessionKey(event) {
    return asString(event.sessionKey);
}
function getAgentBootstrapMetadata(event) {
    if (!isAgentBootstrapEvent(event)) {
        return {};
    }
    return {
        workspaceDir: asString(event.context.workspaceDir),
        openclawAgentId: asString(event.context.agentId)
    };
}
async function registerSession(config, sessionKey, metadata) {
    const actorLabel = await resolveConfiguredForgeActorLabel(config);
    const response = await callConfiguredForgeApi(config, {
        method: "POST",
        path: "/api/v1/agents/sessions",
        body: {
            provider: SESSION_PROVIDER,
            agentLabel: process.env.FORGE_AGENT_LABEL?.trim() || DEFAULT_RUNTIME_AGENT_LABEL,
            agentType: SESSION_PROVIDER,
            actorLabel,
            sessionKey,
            sessionLabel: sessionKey,
            connectionMode: config.apiToken ? "managed_token" : "operator_session",
            baseUrl: config.baseUrl,
            webUrl: config.webAppUrl,
            dataRoot: config.dataRoot || null,
            externalSessionId: sessionKey,
            staleAfterSeconds: 120,
            metadata: {
                ...metadata,
                actorSource: config.actorLabel.trim().length > 0 ? "configured" : "inherited"
            }
        }
    });
    const body = expectForgeSuccess(response);
    const sessionId = isRecord(body.session) && typeof body.session.id === "string"
        ? body.session.id
        : "";
    if (sessionId) {
        SESSION_IDS.set(sessionKey, sessionId);
    }
}
async function heartbeatSession(config, sessionKey, summary = "", metadata = {}) {
    const response = await callConfiguredForgeApi(config, {
        method: "POST",
        path: "/api/v1/agents/sessions/heartbeat",
        body: {
            provider: SESSION_PROVIDER,
            sessionKey,
            externalSessionId: sessionKey,
            summary,
            metadata
        }
    });
    expectForgeSuccess(response);
}
async function appendSessionEvent(config, sessionKey, input) {
    const response = await callConfiguredForgeApi(config, {
        method: "POST",
        path: "/api/v1/agents/sessions/events",
        body: {
            provider: SESSION_PROVIDER,
            sessionKey,
            externalSessionId: sessionKey,
            eventType: input.eventType,
            title: input.title,
            summary: input.summary ?? "",
            metadata: input.metadata ?? {},
            level: input.level ?? "info"
        }
    });
    expectForgeSuccess(response);
}
async function disconnectSession(config, sessionKey, note) {
    const sessionId = SESSION_IDS.get(sessionKey);
    if (!sessionId) {
        return;
    }
    const response = await callConfiguredForgeApi(config, {
        method: "POST",
        path: `/api/v1/agents/sessions/${sessionId}/disconnect`,
        body: {
            note,
            externalSessionId: sessionKey
        }
    });
    expectForgeSuccess(response);
    SESSION_IDS.delete(sessionKey);
}
async function safeCall(api, label, fn) {
    try {
        await fn();
    }
    catch (error) {
        api.logger?.warn?.(`Forge agent session registry hook failed during ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
export function registerForgeSessionRegistryHooks(api, config) {
    if (!api.registerHook) {
        return;
    }
    api.registerHook("agent:bootstrap", async (event) => {
        if (!isAgentBootstrapEvent(event)) {
            return;
        }
        const sessionKey = getSessionKey(event);
        if (!sessionKey) {
            return;
        }
        await safeCall(api, "agent bootstrap", async () => {
            await registerSession(config, sessionKey, getAgentBootstrapMetadata(event));
            await appendSessionEvent(config, sessionKey, {
                eventType: "bootstrap",
                title: "Bootstrap injected",
                summary: "Forge registered the OpenClaw session and injected live startup context.",
                metadata: getAgentBootstrapMetadata(event)
            });
        });
    }, {
        name: "forge-runtime-session-bootstrap",
        description: "Register the live OpenClaw session with Forge when bootstrap context is injected."
    });
    api.registerHook(["message:received", "message:sent", "session:compact:after"], async (event) => {
        const sessionKey = getSessionKey(event);
        if (!sessionKey) {
            return;
        }
        const eventName = asString(isRecord(event) && "type" in event && "action" in event
            ? `${String(event.type)}:${String(event.action)}`
            : "");
        await safeCall(api, eventName || "session event", async () => {
            if (eventName === "message:received") {
                const context = isRecord(event.context)
                    ? (event.context ?? {})
                    : {};
                const bodyPreview = excerpt(context.bodyForAgent) ||
                    excerpt(context.transcript) ||
                    excerpt(context.body);
                await heartbeatSession(config, sessionKey, bodyPreview, {
                    channelId: asString(context.channelId),
                    from: asString(context.from)
                });
                await appendSessionEvent(config, sessionKey, {
                    eventType: "message_received",
                    title: "Message received",
                    summary: bodyPreview,
                    metadata: {
                        channelId: asString(context.channelId),
                        from: asString(context.from)
                    }
                });
                return;
            }
            if (eventName === "message:sent") {
                const messages = Array.isArray(event.messages)
                    ? (event.messages ?? [])
                    : [];
                const summary = excerpt(messages.at(-1));
                await heartbeatSession(config, sessionKey, summary);
                await appendSessionEvent(config, sessionKey, {
                    eventType: "message_sent",
                    title: "Reply sent",
                    summary
                });
                return;
            }
            const context = isRecord(event.context)
                ? (event.context ?? {})
                : {};
            await heartbeatSession(config, sessionKey, "Session compaction completed.", {
                compactedCount: context.compactedCount,
                tokensBefore: context.tokensBefore,
                tokensAfter: context.tokensAfter
            });
            await appendSessionEvent(config, sessionKey, {
                eventType: "session_compacted",
                title: "Session compacted",
                summary: "OpenClaw compacted session history.",
                metadata: {
                    compactedCount: context.compactedCount,
                    tokensBefore: context.tokensBefore,
                    tokensAfter: context.tokensAfter
                }
            });
        });
    }, {
        name: "forge-runtime-session-activity",
        description: "Heartbeat the Forge session registry and append activity events for incoming, outgoing, and compacted OpenClaw session traffic."
    });
    api.registerHook(["command:stop", "command:reset"], async (event) => {
        const sessionKey = getSessionKey(event);
        if (!sessionKey) {
            return;
        }
        await safeCall(api, "session disconnect", async () => {
            await disconnectSession(config, sessionKey, asString(isRecord(event) && "action" in event
                ? `OpenClaw command ${String(event.action)} closed the session.`
                : "OpenClaw closed the session."));
        });
    }, {
        name: "forge-runtime-session-shutdown",
        description: "Mark the Forge runtime session offline when OpenClaw stops or resets the local session."
    });
}
