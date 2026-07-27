import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { resolveForgePluginConfig } from "../runtime/dist/openclaw/plugin-entry-shared.js";
import { callConfiguredForgeApi } from "../runtime/dist/openclaw/api-client.js";

const MAXIMUM_INPUT_BYTES = 512 * 1024;
const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

function getHermesHome() {
  const configured = process.env.HERMES_HOME?.trim();
  return configured ? path.resolve(configured) : path.join(homedir(), ".hermes");
}

function readFileConfig() {
  const configPath = path.join(getHermesHome(), "forge", "config.json");
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function readInput() {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAXIMUM_INPUT_BYTES) {
      throw new Error("request_too_large");
    }
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !ALLOWED_METHODS.has(parsed.method) ||
    typeof parsed.path !== "string" ||
    !parsed.path.startsWith("/api/") ||
    parsed.path.startsWith("//") ||
    parsed.path.includes("\0")
  ) {
    throw new Error("request_invalid");
  }
  return parsed;
}

function readNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

try {
  const input = await readInput();
  const fileConfig = readFileConfig();
  const config = resolveForgePluginConfig({
    origin: process.env.FORGE_ORIGIN ?? fileConfig.origin,
    port:
      readNumber(process.env.FORGE_PORT) ??
      readNumber(fileConfig.port),
    dataRoot:
      process.env.FORGE_DATA_ROOT ??
      fileConfig.dataRoot ??
      path.join(homedir(), ".forge"),
    apiToken: process.env.FORGE_API_TOKEN ?? fileConfig.apiToken,
    remoteCredentialId:
      process.env.FORGE_REMOTE_CREDENTIAL_ID ??
      fileConfig.remoteCredentialId,
    actorLabel:
      process.env.FORGE_ACTOR_LABEL ??
      fileConfig.actorLabel ??
      "Forge Hermes",
    timeoutMs:
      readNumber(process.env.FORGE_TIMEOUT_MS) ??
      readNumber(fileConfig.timeoutMs)
  });
  const response = await callConfiguredForgeApi(config, {
    method: input.method,
    path: input.path,
    body: input.body,
    idempotencyKey:
      typeof input.idempotencyKey === "string"
        ? input.idempotencyKey
        : undefined
  });
  process.stdout.write(
    `${JSON.stringify({ status: response.status, body: response.body })}\n`
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      code:
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "forge_node_client_failed",
      message:
        error instanceof Error
          ? error.message
          : "Forge authenticated client failed."
    })}\n`
  );
  process.exitCode = 1;
}
