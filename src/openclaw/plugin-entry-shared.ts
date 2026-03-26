import { registerForgePluginCli, registerForgePluginRoutes } from "./routes.js";
import { registerForgePluginTools } from "./tools.js";
import type { ForgePluginConfig } from "./api-client.js";
import type { ForgePluginConfigSchema, ForgePluginRegistrationApi } from "./plugin-sdk-types.js";

type RawPluginConfig = Partial<Record<"baseUrl" | "apiToken" | "actorLabel" | "timeoutMs", unknown>>;

export const FORGE_PLUGIN_ID = "forge";
export const FORGE_PLUGIN_NAME = "Forge";
export const FORGE_PLUGIN_DESCRIPTION = "Thin OpenClaw adapter for the live Forge /api/v1 collaboration API.";

function normalizeString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeTimeout(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(120_000, Math.max(1000, Math.round(value)));
}

export function resolveForgePluginConfig(pluginConfig: unknown): ForgePluginConfig {
  const raw = (pluginConfig ?? {}) as RawPluginConfig;
  return {
    baseUrl: normalizeString(raw.baseUrl, "http://127.0.0.1:3017"),
    apiToken: typeof raw.apiToken === "string" ? raw.apiToken.trim() : "",
    actorLabel: normalizeString(raw.actorLabel, "aurel"),
    timeoutMs: normalizeTimeout(raw.timeoutMs, 15_000)
  };
}

export const forgePluginConfigSchema: ForgePluginConfigSchema = {
  parse(value) {
    return resolveForgePluginConfig(value);
  },
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      baseUrl: {
        type: "string",
        default: "http://127.0.0.1:3017",
        description: "Base URL of the live Forge API bridge."
      },
      apiToken: {
        type: "string",
        default: "",
        description: "Optional bearer token for remote or explicit scoped access. Localhost and Tailscale Forge instances can bootstrap an operator session automatically."
      },
      actorLabel: {
        type: "string",
        default: "aurel",
        description: "Actor label recorded in Forge provenance headers."
      },
      timeoutMs: {
        type: "integer",
        default: 15000,
        minimum: 1000,
        maximum: 120000,
        description: "Timeout for proxy calls from the OpenClaw plugin to Forge."
      }
    }
  },
  uiHints: {
    baseUrl: {
      label: "Forge Base URL",
      help: "Base URL of the live Forge API bridge.",
      placeholder: "http://127.0.0.1:3017"
    },
    apiToken: {
      label: "Forge API Token",
      help: "Optional bearer token. Leave blank for one-step localhost or Tailscale operator-session bootstrap.",
      sensitive: true,
      placeholder: "fg_live_..."
    },
    actorLabel: {
      label: "Actor Label",
      help: "Recorded in Forge provenance headers for plugin-originated writes.",
      placeholder: "aurel"
    },
    timeoutMs: {
      label: "Request Timeout (ms)",
      help: "Maximum time to wait before the plugin aborts an upstream Forge request.",
      advanced: true
    }
  }
};

export function registerForgePlugin(api: ForgePluginRegistrationApi) {
  const config = resolveForgePluginConfig(api.pluginConfig);
  registerForgePluginRoutes(api, config);
  registerForgePluginCli(api, config);
  registerForgePluginTools(api, config);
}
