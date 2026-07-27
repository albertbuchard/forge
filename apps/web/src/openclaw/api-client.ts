import type { IncomingMessage, ServerResponse } from "node:http";
import { userInfo } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureForgeRuntimeReady } from "./local-runtime.js";
import { createLocalOwnerSession } from "./local-owner-client.js";
import { forgeRemoteAuthorization } from "./remote-client-credential.js";

const DEFAULT_REQUEST_BODY_LIMIT = 256_000;
const DEFAULT_RESPONSE_BODY_LIMIT = 2_000_000;
const FORGE_PLUGIN_VERSION = readForgePluginVersion();

export type ForgeHttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type ForgePluginConfig = {
  origin: string;
  port: number;
  baseUrl: string;
  webAppUrl: string;
  portSource: "configured" | "default" | "preferred";
  dataRoot: string;
  apiToken: string;
  remoteCredentialId?: string;
  actorLabel: string;
  injectBootstrapContext: boolean;
  timeoutMs: number;
};

type OperatorSessionState = {
  cookie: string;
  csrfToken: string;
  actorLabel: string | null;
};

const operatorSessionStates = new Map<string, OperatorSessionState>();
const verifiedRuntimeStates = new Map<string, ForgeProxyResponse>();

function readForgePluginVersion() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(currentDir, "../../package.json"),
    path.resolve(currentDir, "../../../../plugins/openclaw/package.json"),
    path.resolve(currentDir, "../../../../package.json")
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
        version?: unknown;
      };
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return parsed.version;
      }
    } catch {
      continue;
    }
  }

  return "unknown";
}

export type CallForgeApiArgs = {
  baseUrl: string;
  dataRoot?: string;
  apiToken?: string;
  remoteCredentialId?: string;
  actorLabel?: string;
  timeoutMs?: number;
  method: ForgeHttpMethod;
  path: string;
  body?: unknown;
  idempotencyKey?: string | null;
  extraHeaders?: Record<string, string | null | undefined>;
};

export type CallConfiguredForgeApiArgs = Omit<
  CallForgeApiArgs,
  "baseUrl" | "dataRoot" | "apiToken" | "remoteCredentialId" | "actorLabel" | "timeoutMs"
>;

export type ForgeProxyResponse = {
  status: number;
  body: unknown;
};

type PluginErrorPayload = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export class ForgePluginError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ForgePluginError";
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function normalizeOriginUrl(baseUrl: string) {
  return new URL(normalizeBaseUrl(baseUrl)).origin;
}

function requireSafeCredentialTransport(args: CallForgeApiArgs) {
  const target = new URL(normalizeBaseUrl(args.baseUrl));
  if (target.username || target.password) {
    throw new ForgePluginError(
      400,
      "forge_plugin_credential_url_rejected",
      "Forge credentials cannot be sent to a URL containing embedded user information."
    );
  }
  if (
    (args.apiToken || args.remoteCredentialId) &&
    !canBootstrapOperatorSession(args.baseUrl) &&
    target.protocol !== "https:"
  ) {
    throw new ForgePluginError(
      400,
      "forge_plugin_secure_transport_required",
      "Remote Forge credentials require HTTPS. Tailscale users should use the tailnet-only HTTPS Serve URL."
    );
  }
}

const FORBIDDEN_EXTRA_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "dpop",
  "proxy-authorization",
  "x-forge-csrf",
  "x-forge-dev-proxy-assertion",
  "x-forge-dev-proxy-target"
]);

function assertSafeExtraHeaders(
  extraHeaders: CallForgeApiArgs["extraHeaders"]
) {
  for (const name of Object.keys(extraHeaders ?? {})) {
    const normalized = name.trim().toLowerCase();
    if (
      FORBIDDEN_EXTRA_HEADER_NAMES.has(normalized) ||
      normalized === "forwarded" ||
      normalized.startsWith("x-forwarded-") ||
      normalized.startsWith("tailscale-")
    ) {
      throw new ForgePluginError(
        400,
        "forge_plugin_security_header_override_rejected",
        `Forge does not allow callers to override the managed ${normalized || "security"} header.`
      );
    }
  }
}

export function buildForgeBaseUrl(origin: string, port: number) {
  const url = new URL(origin.endsWith("/") ? origin : `${origin}/`);
  url.port = String(port);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

export function buildForgeWebAppUrl(origin: string, port: number) {
  return `${buildForgeBaseUrl(origin, port)}/forge/`;
}

export function canBootstrapOperatorSession(baseUrl: string) {
  const parsed = new URL(normalizeBaseUrl(baseUrl));
  const hostname = parsed.hostname.toLowerCase();
  return (
    parsed.protocol === "http:" &&
    (hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractUpstreamErrorCode(body: unknown) {
  return isRecord(body) &&
    isRecord(body.error) &&
    typeof body.error.code === "string"
    ? body.error.code
    : null;
}

function buildGuidedUpstreamMessage(result: ForgeProxyResponse, fallback: string) {
  const upstreamCode = extractUpstreamErrorCode(result.body);
  if (result.status === 401 && upstreamCode === "auth_required") {
    return `${fallback} In OpenClaw, do not fall back to raw Forge routes. Call forge_get_agent_onboarding, then use the shared plugin tools. For official habit outcomes, use forge_update_entities on entityType "habit" with patch.checkIn instead of a direct check-in route call.`;
  }
  return fallback;
}

function buildErrorBody(code: string, message: string): PluginErrorPayload {
  return {
    ok: false,
    error: {
      code,
      message
    }
  };
}

async function readReadableStreamBody(stream: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new ForgePluginError(502, "forge_plugin_response_too_large", `Forge response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function readResponseBody(response: Response, maxBytes = DEFAULT_RESPONSE_BODY_LIMIT) {
  if (!response.body) {
    return null;
  }
  const text = await readReadableStreamBody(response.body, maxBytes);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      error: {
        code: "forge_upstream_invalid_json",
        message: text
      }
    };
  }
}

function fallbackActorLabel() {
  const username = userInfo().username.trim();
  return username.length > 0 ? username : "Local Operator";
}

function buildRequestHeaders(args: CallForgeApiArgs) {
  assertSafeExtraHeaders(args.extraHeaders);
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-forge-source": "openclaw",
    "x-forge-plugin-version": FORGE_PLUGIN_VERSION
  };

  if (args.actorLabel) {
    headers["x-forge-actor"] = args.actorLabel;
  }
  if (args.apiToken) {
    headers.authorization = `Bearer ${args.apiToken}`;
  }
  if (args.idempotencyKey) {
    headers["idempotency-key"] = args.idempotencyKey;
  }
  if (args.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  for (const [name, value] of Object.entries(args.extraHeaders ?? {})) {
    if (typeof value === "string" && value.trim().length > 0) {
      headers[name] = value;
    }
  }

  return headers;
}

async function ensureOperatorSessionState(
  baseUrl: string,
  timeoutMs: number,
  dataRoot: string
) {
  const origin = `${normalizeOriginUrl(baseUrl)}|${path.resolve(dataRoot)}`;
  const cached = operatorSessionStates.get(origin);
  if (cached) {
    return cached;
  }

  try {
    const state = await createLocalOwnerSession(baseUrl, timeoutMs, dataRoot);
    operatorSessionStates.set(origin, state);
    return state;
  } catch (error) {
    if (error instanceof ForgePluginError) {
      throw error;
    }
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Forge local-owner authentication timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    throw new ForgePluginError(502, "forge_plugin_session_bootstrap_failed", message);
  }
}

export async function resolveForgeActorLabel(
  args: Pick<
    CallForgeApiArgs,
    | "baseUrl"
    | "dataRoot"
    | "apiToken"
    | "remoteCredentialId"
    | "actorLabel"
    | "timeoutMs"
  >
) {
  const explicitActorLabel = args.actorLabel?.trim();
  if (explicitActorLabel) {
    return explicitActorLabel;
  }
  if (
    !args.apiToken &&
    !args.remoteCredentialId &&
    canBootstrapOperatorSession(args.baseUrl)
  ) {
    const sessionState = await ensureOperatorSessionState(
      args.baseUrl,
      Math.max(1000, args.timeoutMs ?? 15_000),
      args.dataRoot ?? ""
    );
    if (sessionState.actorLabel) {
      return sessionState.actorLabel;
    }
  }
  return fallbackActorLabel();
}

export async function resolveConfiguredForgeActorLabel(config: ForgePluginConfig) {
  return resolveForgeActorLabel({
    baseUrl: config.baseUrl,
    dataRoot: config.dataRoot,
    apiToken: config.apiToken,
    remoteCredentialId: config.remoteCredentialId ?? "",
    actorLabel: config.actorLabel,
    timeoutMs: config.timeoutMs
  });
}

export async function callForgeApi(args: CallForgeApiArgs): Promise<ForgeProxyResponse> {
  return callForgeApiInternal(args, false);
}

export async function callConfiguredForgeApi(config: ForgePluginConfig, args: CallConfiguredForgeApiArgs): Promise<ForgeProxyResponse> {
  await ensureForgeRuntimeReady(config);
  const identity = await ensureConfiguredForgeIdentity(config);
  if (args.path === "/api/v1/health") {
    return identity;
  }
  return callForgeApiInternal(
    {
      baseUrl: config.baseUrl,
      dataRoot: config.dataRoot,
      apiToken: config.apiToken,
      remoteCredentialId: config.remoteCredentialId ?? "",
      actorLabel: config.actorLabel,
      timeoutMs: config.timeoutMs,
      ...args
    },
    false,
    async () => {
      await ensureConfiguredForgeIdentity(config);
    }
  );
}

async function ensureConfiguredForgeIdentity(
  config: ForgePluginConfig
): Promise<ForgeProxyResponse> {
  const key = `${normalizeOriginUrl(config.baseUrl)}|${path.resolve(config.dataRoot)}`;
  const cached = verifiedRuntimeStates.get(key);
  if (cached) {
    return cached;
  }
  const result = await callForgeApi({
    baseUrl: config.baseUrl,
    dataRoot: config.dataRoot,
    apiToken: config.apiToken,
    actorLabel: config.actorLabel,
    timeoutMs: config.timeoutMs,
    method: "GET",
    path: "/api/v1/health",
    extraHeaders: { "x-forge-runtime-probe": "1" }
  });
  if (
    result.status !== 200 ||
    !isRecord(result.body) ||
    result.body.app !== "forge" ||
    result.body.backend !== "forge-node-runtime"
  ) {
    throw new ForgePluginError(
      502,
      "forge_plugin_identity_verification_failed",
      "The reachable service did not prove that it is the configured secured Forge runtime."
    );
  }
  if (canBootstrapOperatorSession(config.baseUrl) && config.dataRoot.trim()) {
    const runtime = isRecord(result.body.runtime)
      ? result.body.runtime
      : null;
    const storageRoot =
      runtime && typeof runtime.storageRoot === "string"
        ? path.resolve(runtime.storageRoot)
        : null;
    if (!storageRoot || storageRoot !== path.resolve(config.dataRoot)) {
      throw new ForgePluginError(
        409,
        "forge_plugin_data_root_mismatch",
        `Forge is authenticated at ${config.baseUrl}, but it is not using the configured data root ${path.resolve(config.dataRoot)}.`
      );
    }
  }
  verifiedRuntimeStates.set(key, result);
  return result;
}

async function callForgeApiInternal(
  args: CallForgeApiArgs,
  retriedWithFreshSession: boolean,
  verifyFreshSession?: () => Promise<void>
): Promise<ForgeProxyResponse> {
  requireSafeCredentialTransport(args);
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, args.timeoutMs ?? 15_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const actorLabel = await resolveForgeActorLabel(args);
  const targetUrl = new URL(
    args.path,
    normalizeBaseUrl(args.baseUrl)
  );
  const remoteAuthorization =
    args.remoteCredentialId && !args.apiToken
      ? await forgeRemoteAuthorization({
          credentialId: args.remoteCredentialId,
          baseUrl: args.baseUrl,
          method: args.method,
          targetUri: targetUrl.toString(),
          timeoutMs
        })
      : null;
  const sessionKey = `${normalizeOriginUrl(args.baseUrl)}|${path.resolve(args.dataRoot ?? "")}`;
  const sessionState =
    !args.apiToken &&
    !args.remoteCredentialId &&
    canBootstrapOperatorSession(args.baseUrl)
    ? await ensureOperatorSessionState(
        args.baseUrl,
        timeoutMs,
        args.dataRoot ?? ""
      )
    : null;

  try {
    const response = await fetch(targetUrl, {
      method: args.method,
      headers: {
        ...buildRequestHeaders({
          ...args,
          actorLabel
        }),
        ...(sessionState
          ? {
              cookie: sessionState.cookie,
              "x-forge-csrf": sessionState.csrfToken
            }
          : {}),
        ...(remoteAuthorization ?? {})
      },
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
      signal: controller.signal
    });

    if (!args.apiToken && sessionState && response.status === 401 && !retriedWithFreshSession) {
      operatorSessionStates.delete(sessionKey);
      verifiedRuntimeStates.delete(
        `${normalizeOriginUrl(args.baseUrl)}|${path.resolve(args.dataRoot ?? "")}`
      );
      await verifyFreshSession?.();
      return callForgeApiInternal(args, true, verifyFreshSession);
    }

    const body = await readResponseBody(response);
    return {
      status: response.status,
      body: body ?? (response.ok ? { ok: true } : buildErrorBody("forge_upstream_empty_response", `Forge API ${response.status} returned no body`))
    };
  } catch (error) {
    if (error instanceof ForgePluginError) {
      throw error;
    }
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Forge API request timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    throw new ForgePluginError(502, "forge_plugin_upstream_unreachable", message);
  } finally {
    if (sessionState) {
      operatorSessionStates.delete(sessionKey);
    }
    clearTimeout(timeout);
  }
}

export async function readJsonRequestBody(
  request: IncomingMessage,
  options: {
    maxBytes?: number;
    emptyObject?: boolean;
  } = {}
) {
  const maxBytes = options.maxBytes ?? DEFAULT_REQUEST_BODY_LIMIT;
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new ForgePluginError(413, "forge_plugin_body_too_large", `Request body exceeded ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return options.emptyObject ? {} : undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return options.emptyObject ? {} : undefined;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ForgePluginError(
      400,
      "forge_plugin_invalid_json",
      error instanceof Error ? error.message : "Request body must be valid JSON"
    );
  }
}

export function readSingleHeaderValue(headers: IncomingMessage["headers"], name: string) {
  const raw = headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw[0] ?? null;
  }
  return typeof raw === "string" ? raw : null;
}

export function requireApiToken(config: ForgePluginConfig) {
  if (
    config.apiToken.trim().length === 0 &&
    (config.remoteCredentialId?.trim().length ?? 0) === 0 &&
    !canBootstrapOperatorSession(config.baseUrl)
  ) {
    throw new ForgePluginError(
      401,
      "forge_plugin_token_required",
      "Forge requires a paired credential for remote API access. Tailscale reachability alone does not authorize this client."
    );
  }
}

export function writeJsonResponse(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export function writeRedirectResponse(response: ServerResponse, location: string) {
  response.statusCode = 302;
  response.setHeader("location", location);
  response.end("");
}

export function writeForgeProxyResponse(response: ServerResponse, result: ForgeProxyResponse) {
  writeJsonResponse(response, result.status, result.body);
}

export function writePluginError(response: ServerResponse, error: unknown) {
  if (error instanceof ForgePluginError) {
    writeJsonResponse(response, error.status, buildErrorBody(error.code, error.message));
    return;
  }

  writeJsonResponse(
    response,
    500,
    buildErrorBody("forge_plugin_internal_error", error instanceof Error ? error.message : String(error))
  );
}

export function expectForgeSuccess(result: ForgeProxyResponse) {
  if (result.status >= 400) {
    const message =
      isRecord(result.body) &&
      isRecord(result.body.error) &&
      typeof result.body.error.message === "string"
        ? result.body.error.message
        : `Forge API returned ${result.status}`;
    throw new ForgePluginError(
      result.status,
      "forge_plugin_upstream_error",
      buildGuidedUpstreamMessage(result, message)
    );
  }
  return result.body;
}
