import type { IncomingMessage, ServerResponse } from "node:http";
import { userInfo } from "node:os";
import packageJson from "../../package.json" with { type: "json" };
import { ensureForgeRuntimeReady } from "./local-runtime.js";

const DEFAULT_REQUEST_BODY_LIMIT = 256_000;
const DEFAULT_RESPONSE_BODY_LIMIT = 2_000_000;

export type ForgeHttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type ForgePluginConfig = {
  origin: string;
  port: number;
  baseUrl: string;
  webAppUrl: string;
  portSource: "configured" | "default" | "preferred";
  dataRoot: string;
  apiToken: string;
  actorLabel: string;
  timeoutMs: number;
};

type OperatorSessionState = {
  cookie: string;
  actorLabel: string | null;
};

const operatorSessionStates = new Map<string, OperatorSessionState>();

export type CallForgeApiArgs = {
  baseUrl: string;
  apiToken?: string;
  actorLabel?: string;
  timeoutMs?: number;
  method: ForgeHttpMethod;
  path: string;
  body?: unknown;
  idempotencyKey?: string | null;
  extraHeaders?: Record<string, string | null | undefined>;
};

export type CallConfiguredForgeApiArgs = Omit<CallForgeApiArgs, "baseUrl" | "apiToken" | "actorLabel" | "timeoutMs">;

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

function isTailscaleIpv4(hostname: string) {
  const match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return false;
  }
  const [a, b] = match.slice(1).map((value) => Number(value));
  return Number.isInteger(a) && Number.isInteger(b) && a === 100 && b >= 64 && b <= 127;
}

export function canBootstrapOperatorSession(baseUrl: string) {
  const hostname = new URL(normalizeBaseUrl(baseUrl)).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".ts.net") || isTailscaleIpv4(hostname);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function readOperatorSessionActorLabel(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }
  const session = payload.session;
  if (!isRecord(session)) {
    return null;
  }
  const actorLabel = session.actorLabel;
  return typeof actorLabel === "string" && actorLabel.trim().length > 0
    ? actorLabel.trim()
    : null;
}

function fallbackActorLabel() {
  const username = userInfo().username.trim();
  return username.length > 0 ? username : "Local Operator";
}

function buildRequestHeaders(args: CallForgeApiArgs) {
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-forge-source": "openclaw",
    "x-forge-plugin-version": packageJson.version
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

async function ensureOperatorSessionState(baseUrl: string, timeoutMs: number) {
  const origin = normalizeOriginUrl(baseUrl);
  const cached = operatorSessionStates.get(origin);
  if (cached) {
    return cached;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/api/v1/auth/operator-session", normalizeBaseUrl(baseUrl)), {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-forge-source": "openclaw"
      },
      signal: controller.signal
    });
    const setCookie = response.headers.get("set-cookie");
    if (!response.ok || !setCookie) {
      throw new ForgePluginError(
        401,
        "forge_plugin_session_bootstrap_failed",
        "Forge did not issue an operator session. Add a token or use a trusted local/Tailscale Forge URL."
      );
    }
    const cookie = setCookie.split(";")[0]?.trim();
    if (!cookie) {
      throw new ForgePluginError(
        401,
        "forge_plugin_session_bootstrap_failed",
        "Forge issued an unusable operator session cookie."
      );
    }
    const body = await readResponseBody(response);
    const state = {
      cookie,
      actorLabel: readOperatorSessionActorLabel(body)
    };
    operatorSessionStates.set(origin, state);
    return state;
  } catch (error) {
    if (error instanceof ForgePluginError) {
      throw error;
    }
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Forge operator-session bootstrap timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    throw new ForgePluginError(502, "forge_plugin_session_bootstrap_failed", message);
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveForgeActorLabel(args: Pick<CallForgeApiArgs, "baseUrl" | "apiToken" | "actorLabel" | "timeoutMs">) {
  const explicitActorLabel = args.actorLabel?.trim();
  if (explicitActorLabel) {
    return explicitActorLabel;
  }
  if (!args.apiToken && canBootstrapOperatorSession(args.baseUrl)) {
    const sessionState = await ensureOperatorSessionState(
      args.baseUrl,
      Math.max(1000, args.timeoutMs ?? 15_000)
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
    apiToken: config.apiToken,
    actorLabel: config.actorLabel,
    timeoutMs: config.timeoutMs
  });
}

export async function callForgeApi(args: CallForgeApiArgs): Promise<ForgeProxyResponse> {
  return callForgeApiInternal(args, false);
}

export async function callConfiguredForgeApi(config: ForgePluginConfig, args: CallConfiguredForgeApiArgs): Promise<ForgeProxyResponse> {
  await ensureForgeRuntimeReady(config);
  return callForgeApi({
    baseUrl: config.baseUrl,
    apiToken: config.apiToken,
    actorLabel: config.actorLabel,
    timeoutMs: config.timeoutMs,
    ...args
  });
}

async function callForgeApiInternal(args: CallForgeApiArgs, retriedWithFreshSession: boolean): Promise<ForgeProxyResponse> {
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, args.timeoutMs ?? 15_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const actorLabel = await resolveForgeActorLabel(args);
  const sessionState = !args.apiToken && canBootstrapOperatorSession(args.baseUrl)
    ? await ensureOperatorSessionState(args.baseUrl, timeoutMs)
    : null;

  try {
    const response = await fetch(new URL(args.path, normalizeBaseUrl(args.baseUrl)), {
      method: args.method,
      headers: {
        ...buildRequestHeaders({
          ...args,
          actorLabel
        }),
        ...(sessionState ? { cookie: sessionState.cookie } : {})
      },
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
      signal: controller.signal
    });

    if (!args.apiToken && sessionState && response.status === 401 && !retriedWithFreshSession) {
      operatorSessionStates.delete(normalizeOriginUrl(args.baseUrl));
      return callForgeApiInternal(args, true);
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
  if (config.apiToken.trim().length === 0 && !canBootstrapOperatorSession(config.baseUrl)) {
    throw new ForgePluginError(
      401,
      "forge_plugin_token_required",
      "Forge apiToken is required for remote plugin mutations when this target cannot use local or Tailscale operator-session bootstrap"
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
    throw new ForgePluginError(result.status, "forge_plugin_upstream_error", message);
  }
  return result.body;
}
