import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { Value } from "@sinclair/typebox/value";
import {
  resolveForgePluginConfig
} from "../runtime/dist/openclaw/plugin-entry-shared.js";
import { registerForgePluginTools } from "../runtime/dist/openclaw/tools.js";

function normalizeEnvNumber(value, fallback) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildPluginConfigFromEnv() {
  return resolveForgePluginConfig({
    origin: process.env.FORGE_ORIGIN ?? "http://127.0.0.1",
    port: normalizeEnvNumber(process.env.FORGE_PORT, 4317),
    apiToken: process.env.FORGE_API_TOKEN ?? "",
    actorLabel: process.env.FORGE_ACTOR_LABEL ?? "codex",
    timeoutMs: normalizeEnvNumber(process.env.FORGE_TIMEOUT_MS, 15_000)
  });
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
  const tools = createToolRegistry(config);
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

  const server = new Server(
    {
      name: "forge-codex",
      version: "0.1.0"
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
      const result = await tool.execute(request.params.name, args);
      return {
        content: toMcpContent(result),
        structuredContent: maybeStructuredContent(result.details)
      };
    } catch (error) {
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
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
