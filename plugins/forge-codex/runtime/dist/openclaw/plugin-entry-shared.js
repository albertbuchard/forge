import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { buildForgeBaseUrl, buildForgeWebAppUrl } from "./api-client.js";
import { primeForgeRuntime } from "./local-runtime.js";
import { registerForgePluginCli, registerForgePluginRoutes } from "./routes.js";
import { registerForgePluginTools } from "./tools.js";
export const FORGE_PLUGIN_ID = "forge-openclaw-plugin";
export const FORGE_PLUGIN_NAME = "Forge";
export const FORGE_PLUGIN_DESCRIPTION = "Curated OpenClaw adapter for the Forge collaboration API, UI entrypoint, and localhost auto-start runtime.";
export const DEFAULT_FORGE_ORIGIN = "http://127.0.0.1";
export const DEFAULT_FORGE_PORT = 4317;
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);
function normalizeString(value, fallback) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}
function normalizeOrigin(value, fallback) {
    const candidate = normalizeString(value, fallback);
    try {
        const url = new URL(candidate);
        url.port = "";
        url.pathname = "/";
        url.search = "";
        url.hash = "";
        return url.origin;
    }
    catch {
        return fallback;
    }
}
function normalizePort(value, fallback) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(65535, Math.max(1, Math.round(value)));
}
function normalizeTimeout(value, fallback) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(120_000, Math.max(1000, Math.round(value)));
}
function isLocalOrigin(origin) {
    try {
        return LOCAL_HOSTNAMES.has(new URL(origin).hostname.toLowerCase());
    }
    catch {
        return false;
    }
}
function getPreferredLocalPortPath(origin) {
    const hostname = new URL(origin).hostname.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    return path.join(homedir(), ".openclaw", "run", FORGE_PLUGIN_ID, `${hostname}-preferred-port.json`);
}
function readPreferredLocalPort(origin) {
    if (!isLocalOrigin(origin)) {
        return null;
    }
    try {
        const preferredPortPath = getPreferredLocalPortPath(origin);
        if (!existsSync(preferredPortPath)) {
            return null;
        }
        const payload = JSON.parse(readFileSync(preferredPortPath, "utf8"));
        return typeof payload.port === "number" && Number.isFinite(payload.port) ? payload.port : null;
    }
    catch {
        return null;
    }
}
export function resolveForgePluginConfig(pluginConfig) {
    const raw = (pluginConfig ?? {});
    const origin = normalizeOrigin(raw.origin, DEFAULT_FORGE_ORIGIN);
    const hasConfiguredPort = typeof raw.port === "number" && Number.isFinite(raw.port);
    const preferredPort = hasConfiguredPort ? null : readPreferredLocalPort(origin);
    const port = normalizePort(hasConfiguredPort ? raw.port : preferredPort ?? DEFAULT_FORGE_PORT, DEFAULT_FORGE_PORT);
    return {
        origin,
        port,
        baseUrl: buildForgeBaseUrl(origin, port),
        webAppUrl: buildForgeWebAppUrl(origin, port),
        portSource: hasConfiguredPort ? "configured" : preferredPort !== null ? "preferred" : "default",
        dataRoot: typeof raw.dataRoot === "string" ? raw.dataRoot.trim() : "",
        apiToken: typeof raw.apiToken === "string" ? raw.apiToken.trim() : "",
        actorLabel: normalizeString(raw.actorLabel, "aurel"),
        timeoutMs: normalizeTimeout(raw.timeoutMs, 15_000)
    };
}
export const forgePluginConfigSchema = {
    parse(value) {
        return resolveForgePluginConfig(value);
    },
    jsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            origin: {
                type: "string",
                default: DEFAULT_FORGE_ORIGIN,
                description: "Forge protocol and host without the port. Example: http://127.0.0.1. Localhost targets auto-start the bundled Forge runtime."
            },
            port: {
                type: "integer",
                default: DEFAULT_FORGE_PORT,
                minimum: 1,
                maximum: 65535,
                description: "Forge server port. Override this when your local machine uses a different port."
            },
            dataRoot: {
                type: "string",
                default: "",
                description: "Optional absolute path for the Forge data folder root. Leave blank to use the runtime working directory."
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
        origin: {
            label: "Forge Origin",
            help: "Protocol and host for Forge without the port. Example: http://127.0.0.1. Localhost targets auto-start Forge.",
            placeholder: "http://127.0.0.1"
        },
        port: {
            label: "Forge Port",
            help: "Forge server port. Change this if your local machine uses another port.",
            placeholder: "4317"
        },
        dataRoot: {
            label: "Forge Data Root",
            help: "Optional absolute folder path for Forge data. Use this when you want Forge to read and write a specific data directory instead of the runtime working directory.",
            placeholder: "/Users/you/forge-data",
            advanced: true
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
export function registerForgePlugin(api) {
    const config = resolveForgePluginConfig(api.pluginConfig);
    primeForgeRuntime(config);
    registerForgePluginRoutes(api, config);
    registerForgePluginCli(api, config);
    registerForgePluginTools(api, config);
}
