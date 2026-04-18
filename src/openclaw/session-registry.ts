import { isAgentBootstrapEvent } from "openclaw/plugin-sdk/hook-runtime";
import type { InternalHookEvent } from "openclaw/plugin-sdk/hook-runtime";
import {
  callConfiguredForgeApi,
  expectForgeSuccess,
  type ForgePluginConfig
} from "./api-client.js";
import type { ForgePluginRegistrationApi } from "./plugin-sdk-types.js";

const SESSION_IDS = new Map<string, string>();
const SESSION_PROVIDER = "openclaw";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function excerpt(value: unknown, limit = 140) {
  const normalized = asString(value).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function getSessionKey(event: InternalHookEvent) {
  return asString((event as { sessionKey?: unknown }).sessionKey);
}

function getAgentBootstrapMetadata(event: InternalHookEvent) {
  if (!isAgentBootstrapEvent(event)) {
    return {};
  }
  return {
    workspaceDir: asString(event.context.workspaceDir),
    openclawAgentId: asString(event.context.agentId)
  };
}

async function registerSession(
  config: ForgePluginConfig,
  sessionKey: string,
  metadata: Record<string, unknown>
) {
  const response = await callConfiguredForgeApi(config, {
    method: "POST",
    path: "/api/v1/agents/sessions",
    body: {
      provider: SESSION_PROVIDER,
      agentLabel: config.actorLabel,
      agentType: SESSION_PROVIDER,
      actorLabel: config.actorLabel,
      sessionKey,
      sessionLabel: sessionKey,
      connectionMode: config.apiToken ? "managed_token" : "operator_session",
      baseUrl: config.baseUrl,
      webUrl: config.webAppUrl,
      dataRoot: config.dataRoot || null,
      staleAfterSeconds: 120,
      metadata
    }
  });
  const body = expectForgeSuccess(response) as {
    session?: { id?: unknown };
  };
  const sessionId =
    isRecord(body.session) && typeof body.session.id === "string"
      ? body.session.id
      : "";
  if (sessionId) {
    SESSION_IDS.set(sessionKey, sessionId);
  }
}

async function heartbeatSession(
  config: ForgePluginConfig,
  sessionKey: string,
  summary = "",
  metadata: Record<string, unknown> = {}
) {
  const response = await callConfiguredForgeApi(config, {
    method: "POST",
    path: "/api/v1/agents/sessions/heartbeat",
    body: {
      provider: SESSION_PROVIDER,
      sessionKey,
      summary,
      metadata
    }
  });
  expectForgeSuccess(response);
}

async function appendSessionEvent(
  config: ForgePluginConfig,
  sessionKey: string,
  input: {
    eventType: string;
    title: string;
    summary?: string;
    metadata?: Record<string, unknown>;
    level?: "info" | "warning" | "error";
  }
) {
  const response = await callConfiguredForgeApi(config, {
    method: "POST",
    path: "/api/v1/agents/sessions/events",
    body: {
      provider: SESSION_PROVIDER,
      sessionKey,
      eventType: input.eventType,
      title: input.title,
      summary: input.summary ?? "",
      metadata: input.metadata ?? {},
      level: input.level ?? "info"
    }
  });
  expectForgeSuccess(response);
}

async function disconnectSession(
  config: ForgePluginConfig,
  sessionKey: string,
  note: string
) {
  const sessionId = SESSION_IDS.get(sessionKey);
  if (!sessionId) {
    return;
  }
  const response = await callConfiguredForgeApi(config, {
    method: "POST",
    path: `/api/v1/agents/sessions/${sessionId}/disconnect`,
    body: {
      note
    }
  });
  expectForgeSuccess(response);
  SESSION_IDS.delete(sessionKey);
}

async function safeCall(
  api: ForgePluginRegistrationApi,
  label: string,
  fn: () => Promise<void>
) {
  try {
    await fn();
  } catch (error) {
    api.logger?.warn?.(
      `Forge agent session registry hook failed during ${label}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export function registerForgeSessionRegistryHooks(
  api: ForgePluginRegistrationApi,
  config: ForgePluginConfig
) {
  if (!api.registerHook) {
    return;
  }

  api.registerHook(
    "agent:bootstrap",
    async (event: InternalHookEvent) => {
      if (!isAgentBootstrapEvent(event)) {
        return;
      }
      const sessionKey = getSessionKey(event);
      if (!sessionKey) {
        return;
      }
      await safeCall(api, "agent bootstrap", async () => {
        await registerSession(
          config,
          sessionKey,
          getAgentBootstrapMetadata(event)
        );
        await appendSessionEvent(config, sessionKey, {
          eventType: "bootstrap",
          title: "Bootstrap injected",
          summary:
            "Forge registered the OpenClaw session and injected live startup context.",
          metadata: getAgentBootstrapMetadata(event)
        });
      });
    },
    {
      name: "forge-runtime-session-bootstrap",
      description:
        "Register the live OpenClaw session with Forge when bootstrap context is injected."
    }
  );

  api.registerHook(
    ["message:received", "message:sent", "session:compact:after"],
    async (event: InternalHookEvent) => {
      const sessionKey = getSessionKey(event);
      if (!sessionKey) {
        return;
      }
      const eventName = asString(
        isRecord(event) && "type" in event && "action" in event
          ? `${String(event.type)}:${String(event.action)}`
          : ""
      );

      await safeCall(api, eventName || "session event", async () => {
        if (eventName === "message:received") {
          const context = isRecord((event as { context?: unknown }).context)
            ? ((event as { context: Record<string, unknown> }).context ?? {})
            : {};
          const bodyPreview =
            excerpt(context.bodyForAgent) ||
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
          const messages = Array.isArray((event as { messages?: unknown }).messages)
            ? ((event as { messages: unknown[] }).messages ?? [])
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

        const context = isRecord((event as { context?: unknown }).context)
          ? ((event as { context: Record<string, unknown> }).context ?? {})
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
    },
    {
      name: "forge-runtime-session-activity",
      description:
        "Heartbeat the Forge session registry and append activity events for incoming, outgoing, and compacted OpenClaw session traffic."
    }
  );

  api.registerHook(
    ["command:stop", "command:reset"],
    async (event: InternalHookEvent) => {
      const sessionKey = getSessionKey(event);
      if (!sessionKey) {
        return;
      }
      await safeCall(api, "session disconnect", async () => {
        await disconnectSession(
          config,
          sessionKey,
          asString(
            isRecord(event) && "action" in event
              ? `OpenClaw command ${String(event.action)} closed the session.`
              : "OpenClaw closed the session."
          )
        );
      });
    },
    {
      name: "forge-runtime-session-shutdown",
      description:
        "Mark the Forge runtime session offline when OpenClaw stops or resets the local session."
    }
  );
}
