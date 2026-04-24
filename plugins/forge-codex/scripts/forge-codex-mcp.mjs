import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { Value } from "@sinclair/typebox/value";
import {
  callConfiguredForgeApi,
  expectForgeSuccess,
  resolveConfiguredForgeActorLabel
} from "../runtime/dist/openclaw/api-client.js";
import { ensureForgeRuntimeReady } from "../runtime/dist/openclaw/local-runtime.js";
import { resolveForgePluginConfig } from "../runtime/dist/openclaw/plugin-entry-shared.js";
import { registerForgePluginTools } from "../runtime/dist/openclaw/tools.js";

const SESSION_PROVIDER = "codex";
const DEFAULT_RUNTIME_AGENT_LABEL = "Forge Codex";

function resolvePluginVersion() {
  const pluginManifestPath = path.resolve(import.meta.dirname, "..", ".codex-plugin", "plugin.json");
  try {
    const parsed = JSON.parse(readFileSync(pluginManifestPath, "utf8"));
    if (typeof parsed?.version === "string" && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch {
    // Fall back to a stable placeholder if local metadata is unavailable.
  }
  return "0.1.0";
}

function normalizeEnvNumber(value, fallback) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveSharedDataRoot() {
  if (process.env.FORGE_DATA_ROOT?.trim()) {
    return process.env.FORGE_DATA_ROOT.trim();
  }
  const projectRoot = path.resolve(import.meta.dirname, "..", "..", "..");
  const runtimePreferencePath = path.resolve(projectRoot, "..", "..", "data", "forge-runtime.json");
  const monorepoDataRoot = path.resolve(projectRoot, "..", "..", "data", "forge");
  if (existsSync(runtimePreferencePath)) {
    try {
      const parsed = JSON.parse(readFileSync(runtimePreferencePath, "utf8"));
      if (typeof parsed?.dataRoot === "string" && parsed.dataRoot.trim().length > 0) {
        return path.resolve(parsed.dataRoot.trim());
      }
    } catch {
      // Ignore invalid local runtime preference files and continue to defaults.
    }
  }
  if (existsSync(monorepoDataRoot)) {
    return monorepoDataRoot;
  }
  return path.join(homedir(), ".forge");
}

function resolveRuntimeAgentLabel() {
  return process.env.FORGE_AGENT_LABEL?.trim() || DEFAULT_RUNTIME_AGENT_LABEL;
}

function createStableMachineKey(config) {
  const fingerprint = createHash("sha1")
    .update(JSON.stringify({
      baseUrl: config.baseUrl,
      dataRoot: config.dataRoot || ""
    }))
    .digest("hex")
    .slice(0, 12);
  return `machine_${fingerprint}`;
}

function createStableAgentIdentityKey(config) {
  return `${["runtime", SESSION_PROVIDER, createStableMachineKey(config), "default"].join(":")}`;
}

function buildPluginConfigFromEnv() {
  return resolveForgePluginConfig({
    origin: process.env.FORGE_ORIGIN ?? "http://127.0.0.1",
    port: normalizeEnvNumber(process.env.FORGE_PORT, 4317),
    dataRoot: resolveSharedDataRoot(),
    apiToken: process.env.FORGE_API_TOKEN ?? "",
    actorLabel: process.env.FORGE_ACTOR_LABEL ?? "",
    timeoutMs: normalizeEnvNumber(process.env.FORGE_TIMEOUT_MS, 15_000)
  });
}

async function postSessionEvent(config, path, body) {
  const response = await callConfiguredForgeApi(config, {
    method: "POST",
    path,
    body,
    extraHeaders: {
      "x-forge-source": "agent"
    }
  });
  return expectForgeSuccess(response);
}

function createStableSessionKey(config) {
  const fingerprint = createHash("sha1")
    .update(JSON.stringify({
      provider: SESSION_PROVIDER,
      baseUrl: config.baseUrl,
      dataRoot: config.dataRoot || "",
      cwd: process.cwd()
    }))
    .digest("hex")
    .slice(0, 12);
  return `codex-${fingerprint}`;
}

function createRuntimeSessionState(config) {
  return {
    id: null,
    key: createStableSessionKey(config),
    instanceId: `codex-${process.pid}-${Date.now().toString(36)}`,
    heartbeat: null,
    connected: false,
    config
  };
}

async function registerRuntimeSession(state) {
  try {
    await ensureForgeRuntimeReady(state.config);
    const actorLabel = await resolveConfiguredForgeActorLabel(state.config);
    const payload = await postSessionEvent(state.config, "/api/v1/agents/sessions", {
      provider: SESSION_PROVIDER,
      agentLabel: resolveRuntimeAgentLabel(),
      agentType: SESSION_PROVIDER,
      agentIdentityKey: createStableAgentIdentityKey(state.config),
      machineKey: createStableMachineKey(state.config),
      personaKey: "default",
      actorLabel,
      sessionKey: state.key,
      sessionLabel: "Forge Codex bridge",
      connectionMode: "mcp",
      baseUrl: state.config.baseUrl,
      webUrl: state.config.webAppUrl,
      dataRoot: state.config.dataRoot || null,
      externalSessionId: state.instanceId,
      staleAfterSeconds: 90,
      metadata: {
        singleton: true,
        instanceId: state.instanceId,
        pid: process.pid,
        pluginVersion: resolvePluginVersion(),
        cwd: process.cwd()
      }
    });
    state.id =
      payload && typeof payload === "object" && payload.session && typeof payload.session.id === "string"
        ? payload.session.id
        : null;
    state.connected = Boolean(state.id);
  } catch {
    state.connected = false;
  }
}

async function heartbeatRuntimeSession(state, summary = "", metadata = {}) {
  if (!state.connected) {
    return;
  }
  try {
    await postSessionEvent(state.config, "/api/v1/agents/sessions/heartbeat", {
      provider: SESSION_PROVIDER,
      sessionKey: state.key,
      externalSessionId: state.instanceId,
      summary,
      metadata
    });
  } catch {
    state.connected = false;
  }
}

async function appendRuntimeSessionEvent(
  state,
  { eventType, title, summary = "", metadata = {}, level = "info" }
) {
  if (!state.connected) {
    return;
  }
  try {
    await postSessionEvent(state.config, "/api/v1/agents/sessions/events", {
      provider: SESSION_PROVIDER,
      sessionKey: state.key,
      externalSessionId: state.instanceId,
      eventType,
      title,
      summary,
      metadata,
      level
    });
  } catch {
    state.connected = false;
  }
}

async function disconnectRuntimeSession(state, note, lastError = null) {
  if (!state.connected || !state.id) {
    return;
  }
  try {
    await postSessionEvent(
      state.config,
      `/api/v1/agents/sessions/${state.id}/disconnect`,
      {
        note,
        externalSessionId: state.instanceId,
        lastError
      }
    );
  } catch {
    // Ignore disconnect cleanup failures on process shutdown.
  } finally {
    state.connected = false;
  }
}

function createToolRegistry(config) {
  const tools = [];
  const api = {
    registerTool(tool) {
      tools.push(tool);
    }
  };
  registerForgePluginTools(api, config);
  return tools;
}

function getValidationErrorMessage(schema, value) {
  const firstError = Value.Errors(schema, value).First();
  if (!firstError) {
    return "Invalid arguments";
  }
  const path = firstError.path || "input";
  return `${path}: ${firstError.message}`;
}

function toMcpContent(result) {
  if (!Array.isArray(result.content) || result.content.length === 0) {
    return [{ type: "text", text: JSON.stringify(result.details ?? null, null, 2) }];
  }

  return result.content.map((item) => {
    if (item && typeof item === "object" && item.type === "text" && "text" in item) {
      return {
        type: "text",
        text: typeof item.text === "string" ? item.text : JSON.stringify(item.text ?? null)
      };
    }

    return {
      type: "text",
      text: JSON.stringify(item, null, 2)
    };
  });
}

function maybeStructuredContent(details) {
  if (typeof details === "object" && details !== null) {
    return details;
  }
  return undefined;
}

async function main() {
  const config = buildPluginConfigFromEnv();
  const runtimeSession = createRuntimeSessionState(config);
  await registerRuntimeSession(runtimeSession);
  if (runtimeSession.connected) {
    runtimeSession.heartbeat = setInterval(() => {
      void heartbeatRuntimeSession(runtimeSession, "Codex MCP server heartbeat.", {
        pid: process.pid
      });
    }, 45_000);
    runtimeSession.heartbeat.unref?.();
    await appendRuntimeSessionEvent(runtimeSession, {
      eventType: "session_started",
      title: "MCP server started",
      summary: "Forge registered the Codex MCP bridge as a live agent session."
    });
  }
  const tools = createToolRegistry(config);
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

  const server = new Server(
    {
      name: "forge-codex",
      version: resolvePluginVersion()
    },
    {
      capabilities: {
        tools: {
          listChanged: false
        }
      },
      instructions:
        "Use Forge as a curated life operating system tool surface. Start from forge_get_operator_overview, search before creating duplicates, prefer batch entity tools for multi-entity work, and use forge_get_ui_entrypoint when a visual workflow is better."
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      title: tool.label,
      description: tool.description,
      inputSchema: tool.parameters
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolByName.get(request.params.name);
    if (!tool) {
      throw new McpError(ErrorCode.InvalidParams, `Forge tool not found: ${request.params.name}`);
    }

    const args = request.params.arguments ?? {};
    if (!Value.Check(tool.parameters, args)) {
      throw new McpError(ErrorCode.InvalidParams, getValidationErrorMessage(tool.parameters, args));
    }

    try {
      const startedAt = Date.now();
      await heartbeatRuntimeSession(runtimeSession, `Tool call: ${request.params.name}`, {
        toolName: request.params.name
      });
      await appendRuntimeSessionEvent(runtimeSession, {
        eventType: "tool_call",
        title: `Tool call: ${request.params.name}`,
        summary: "Codex invoked a Forge MCP tool.",
        metadata: {
          toolName: request.params.name
        }
      });
      const result = await tool.execute(request.params.name, args);
      await appendRuntimeSessionEvent(runtimeSession, {
        eventType: "tool_result",
        title: `Tool result: ${request.params.name}`,
        summary: "Forge returned a result to Codex.",
        metadata: {
          toolName: request.params.name,
          durationMs: Date.now() - startedAt
        }
      });
      return {
        content: toMcpContent(result),
        structuredContent: maybeStructuredContent(result.details)
      };
    } catch (error) {
      await appendRuntimeSessionEvent(runtimeSession, {
        eventType: "tool_error",
        title: `Tool error: ${request.params.name}`,
        summary: error instanceof Error ? error.message : String(error),
        metadata: {
          toolName: request.params.name
        },
        level: "error"
      });
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error)
          }
        ],
        isError: true
      };
    }
  });

  const transport = new StdioServerTransport();
  const shutdown = async (signal) => {
    if (runtimeSession.heartbeat) {
      clearInterval(runtimeSession.heartbeat);
      runtimeSession.heartbeat = null;
    }
    await disconnectRuntimeSession(
      runtimeSession,
      `Codex MCP server shutdown (${signal}).`
    );
    process.exit(0);
  };
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
