import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { resolveForgePluginConfig } from "../../../src/openclaw/plugin-entry-shared.ts";
import { ensureForgeRuntimeReady, getForgeRuntimeStatus } from "../../../src/openclaw/local-runtime.ts";

function readEnvNumber(name) {
  const raw = process.env[name];
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getHermesHome() {
  const configured = process.env.HERMES_HOME?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(homedir(), ".hermes");
}

function getConfigPath() {
  return path.join(getHermesHome(), "forge", "config.json");
}

function getDefaultDataRoot() {
  return path.join(getHermesHome(), "forge");
}

function readFileConfig() {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readConfigNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

const fileConfig = readFileConfig();

const rawConfig = {
  origin: process.env.FORGE_ORIGIN ?? fileConfig.origin,
  port: readEnvNumber("FORGE_PORT") ?? readConfigNumber(fileConfig.port),
  dataRoot: process.env.FORGE_DATA_ROOT ?? fileConfig.dataRoot ?? getDefaultDataRoot(),
  apiToken: process.env.FORGE_API_TOKEN ?? fileConfig.apiToken,
  actorLabel: process.env.FORGE_ACTOR_LABEL ?? fileConfig.actorLabel ?? "hermes",
  timeoutMs: readEnvNumber("FORGE_TIMEOUT_MS") ?? readConfigNumber(fileConfig.timeoutMs)
};

const config = resolveForgePluginConfig(rawConfig);
await ensureForgeRuntimeReady(config);
const status = await getForgeRuntimeStatus(config);

process.stdout.write(
  `${JSON.stringify(
    {
      config: {
        origin: config.origin,
        port: config.port,
        baseUrl: config.baseUrl,
        webAppUrl: config.webAppUrl,
        dataRoot: config.dataRoot,
        apiToken: config.apiToken,
        actorLabel: config.actorLabel,
        timeoutMs: config.timeoutMs
      },
      status
    },
    null,
    2
  )}\n`
);
