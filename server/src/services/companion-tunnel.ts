import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import { logForgeDebug } from "../debug.js";

export type CompanionPairingTransportMode = "tunnel" | "manual-http";

export type CompanionPairingTransportPayload = {
  protocol: "https-tunnel" | "http";
  provider: "cloudflare-quick-tunnel" | "configured-url" | "manual-http";
  status: "ready" | "starting" | "unavailable" | "error";
  publicBaseUrl?: string;
  localBaseUrl: string;
  proxyBaseUrl?: string;
  recreateCommand?: string;
  startedAt?: string;
  lastError?: string;
  notes: string[];
};

export type CompanionResolvedPairingTransport = {
  transportMode: CompanionPairingTransportMode;
  apiBaseUrl: string;
  uiBaseUrl: string;
  transport: CompanionPairingTransportPayload;
};

type TunnelState = {
  child: ChildProcess | null;
  publicBaseUrl: string | null;
  startedAt: string | null;
  lastError: string | null;
  starting: Promise<TunnelStateSnapshot> | null;
};

type TunnelStateSnapshot = {
  status: CompanionPairingTransportPayload["status"];
  publicBaseUrl: string | null;
  proxyBaseUrl: string | null;
  localBaseUrl: string;
  startedAt: string | null;
  lastError: string | null;
};

type ProxyState = {
  server: http.Server;
  proxyBaseUrl: string;
  localBaseUrl: string;
};

const TRY_CLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/iu;
const DEFAULT_TUNNEL_TIMEOUT_MS = 18_000;
const DEFAULT_MAX_BODY_BYTES = 50 * 1024 * 1024;

let tunnelState: TunnelState = {
  child: null,
  publicBaseUrl: null,
  startedAt: null,
  lastError: null,
  starting: null
};
let proxyState: ProxyState | null = null;

export async function buildCompanionPairingTransport(input: {
  requestedMode: CompanionPairingTransportMode;
  requestApiBaseUrl: string;
  requestUiBaseUrl?: string | null;
}): Promise<CompanionResolvedPairingTransport> {
  const requestApiBaseUrl = normalizeApiBaseUrl(input.requestApiBaseUrl);
  const requestUiBaseUrl =
    normalizeUiBaseUrl(input.requestUiBaseUrl) ??
    deriveUiBaseUrlFromApiBaseUrl(requestApiBaseUrl);

  if (input.requestedMode === "manual-http") {
    return manualHttpTransport(requestApiBaseUrl, requestUiBaseUrl, [
      "Manual HTTP/TCP pairing was explicitly requested."
    ]);
  }

  const configuredTunnelBaseUrl = readConfiguredCompanionTunnelBaseUrl();
  if (configuredTunnelBaseUrl) {
    return tunnelTransport({
      publicBaseUrl: configuredTunnelBaseUrl,
      localBaseUrl: localForgeBaseUrl(),
      provider: "configured-url",
      proxyBaseUrl: undefined,
      startedAt: undefined,
      notes: [
        "Using FORGE_COMPANION_TUNNEL_BASE_URL as the companion tunnel endpoint."
      ]
    });
  }

  if (!shouldAutoStartQuickTunnel()) {
    return manualHttpTransport(requestApiBaseUrl, requestUiBaseUrl, [
      "Tunnel auto-start is unavailable in this runtime, so Forge fell back to direct HTTP."
    ]);
  }

  const snapshot = await ensureCompanionQuickTunnel(localForgeBaseUrl());
  if (snapshot.status === "ready" && snapshot.publicBaseUrl) {
    return tunnelTransport({
      publicBaseUrl: snapshot.publicBaseUrl,
      localBaseUrl: snapshot.localBaseUrl,
      provider: "cloudflare-quick-tunnel",
      proxyBaseUrl: snapshot.proxyBaseUrl ?? undefined,
      startedAt: snapshot.startedAt ?? undefined,
      notes: [
        "Quick tunnel is active through an allow-listed mobile API proxy."
      ]
    });
  }

  return manualHttpTransport(requestApiBaseUrl, requestUiBaseUrl, [
    snapshot.lastError ??
      "No companion tunnel could be started, so Forge fell back to direct HTTP."
  ]);
}

export function getCompanionTunnelStatus(): TunnelStateSnapshot {
  return snapshotFor(tunnelState.publicBaseUrl ? "ready" : "unavailable");
}

export async function stopCompanionTunnel() {
  if (tunnelState.child && !tunnelState.child.killed) {
    tunnelState.child.kill("SIGTERM");
  }
  tunnelState = {
    child: null,
    publicBaseUrl: null,
    startedAt: null,
    lastError: null,
    starting: null
  };

  if (proxyState) {
    await new Promise<void>((resolve) => {
      proxyState?.server.close(() => resolve());
    });
    proxyState = null;
  }
}

export function readConfiguredCompanionTunnelBaseUrl() {
  return normalizePublicBaseUrl(process.env.FORGE_COMPANION_TUNNEL_BASE_URL);
}

export function companionTunnelApiBaseUrlFromPublicBase(publicBaseUrl: string) {
  return `${normalizePublicBaseUrl(publicBaseUrl) ?? publicBaseUrl.replace(/\/+$/, "")}/api/v1`;
}

export function companionTunnelUiBaseUrlFromPublicBase(publicBaseUrl: string) {
  return `${normalizePublicBaseUrl(publicBaseUrl) ?? publicBaseUrl.replace(/\/+$/, "")}/forge/`;
}

async function ensureCompanionQuickTunnel(localBaseUrl: string) {
  if (
    tunnelState.child &&
    !tunnelState.child.killed &&
    tunnelState.publicBaseUrl
  ) {
    return snapshotFor("ready", localBaseUrl);
  }
  if (tunnelState.starting) {
    return tunnelState.starting;
  }

  tunnelState.starting = startCompanionQuickTunnel(localBaseUrl).finally(() => {
    tunnelState.starting = null;
  });
  return tunnelState.starting;
}

async function startCompanionQuickTunnel(localBaseUrl: string) {
  const cloudflaredPath = resolveCommand("cloudflared");
  if (!cloudflaredPath) {
    tunnelState.lastError =
      "cloudflared is not installed. Install it or set FORGE_COMPANION_TUNNEL_BASE_URL to a managed tunnel URL.";
    return snapshotFor("unavailable", localBaseUrl);
  }

  const proxy = await ensureCompanionProxy(localBaseUrl);
  const child = spawn(cloudflaredPath, ["tunnel", "--url", proxy.proxyBaseUrl], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  tunnelState.child = child;
  tunnelState.publicBaseUrl = null;
  tunnelState.startedAt = new Date().toISOString();
  tunnelState.lastError = null;

  const seenLogs: string[] = [];
  const rememberLog = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    seenLogs.push(text);
    if (seenLogs.length > 12) {
      seenLogs.shift();
    }
    const match = text.match(TRY_CLOUDFLARE_URL_PATTERN);
    if (match?.[0]) {
      tunnelState.publicBaseUrl = match[0].replace(/\/+$/, "");
    }
  };

  child.stdout?.on("data", rememberLog);
  child.stderr?.on("data", rememberLog);
  child.once("error", (error) => {
    tunnelState.lastError = error.message;
  });
  child.once("exit", (code, signal) => {
    if (tunnelState.child === child) {
      tunnelState.child = null;
      tunnelState.publicBaseUrl = null;
      tunnelState.lastError =
        code === 0
          ? "cloudflared tunnel stopped."
          : `cloudflared tunnel exited with ${signal ?? `code ${code}`}.`;
    }
  });

  const deadline = Date.now() + DEFAULT_TUNNEL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (tunnelState.publicBaseUrl) {
      return snapshotFor("ready", localBaseUrl);
    }
    if (!tunnelState.child) {
      break;
    }
    await delay(250);
  }

  if (!tunnelState.publicBaseUrl) {
    tunnelState.lastError =
      tunnelState.lastError ??
      `cloudflared did not report a trycloudflare.com URL. Recent output: ${seenLogs
        .join("")
        .trim()
        .slice(-600)}`;
    if (tunnelState.child && !tunnelState.child.killed) {
      tunnelState.child.kill("SIGTERM");
    }
    return snapshotFor("error", localBaseUrl);
  }

  return snapshotFor("ready", localBaseUrl);
}

async function ensureCompanionProxy(localBaseUrl: string): Promise<ProxyState> {
  if (proxyState?.localBaseUrl === localBaseUrl) {
    return proxyState;
  }
  if (proxyState) {
    await new Promise<void>((resolve) => {
      proxyState?.server.close(() => resolve());
    });
    proxyState = null;
  }

  const server = http.createServer((request, response) => {
    void proxyCompanionRequest(localBaseUrl, request, response);
  });
  const port = await listenOnLoopback(server);
  proxyState = {
    server,
    proxyBaseUrl: `http://127.0.0.1:${port}`,
    localBaseUrl
  };
  return proxyState;
}

async function proxyCompanionRequest(
  localBaseUrl: string,
  request: IncomingMessage,
  response: ServerResponse
) {
  try {
    const method = request.method ?? "GET";
    const requestUrl = new URL(request.url ?? "/", localBaseUrl);
    if (!isAllowedCompanionProxyRequest(method, requestUrl.pathname)) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Route is not exposed by the companion tunnel." }));
      return;
    }

    const body = await readRequestBody(request);
    const headers = forwardedHeaders(request);
    const upstreamResponse = await fetch(new URL(request.url ?? "/", localBaseUrl), {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body
    });
    response.statusCode = upstreamResponse.status;
    for (const [key, value] of upstreamResponse.headers) {
      if (["connection", "content-encoding", "transfer-encoding"].includes(key)) {
        continue;
      }
      response.setHeader(key, value);
    }
    const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
    response.end(responseBody);
  } catch (error) {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: "Companion tunnel proxy failed.",
        message: error instanceof Error ? error.message : String(error)
      })
    );
  }
}

function isAllowedCompanionProxyRequest(method: string, pathname: string) {
  if (method === "OPTIONS") {
    return true;
  }
  if ((method === "GET" || method === "HEAD") && pathname === "/api/v1/health") {
    return true;
  }
  return pathname.startsWith("/api/v1/mobile/");
}

function forwardedHeaders(request: IncomingMessage) {
  const headers = new Headers();
  const allowedHeaders = [
    "accept",
    "accept-language",
    "content-type",
    "user-agent"
  ];
  for (const header of allowedHeaders) {
    const value = request.headers[header];
    if (Array.isArray(value)) {
      headers.set(header, value.join(", "));
    } else if (typeof value === "string") {
      headers.set(header, value);
    }
  }
  headers.set("x-forge-companion-tunnel", "1");
  return headers;
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let total = 0;
  const maxBodyBytes = readMaxBodyBytes();
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBodyBytes) {
      throw new Error(
        `Companion tunnel request exceeded ${Math.round(maxBodyBytes / 1024 / 1024)} MB.`
      );
    }
    chunks.push(buffer);
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function listenOnLoopback(server: http.Server) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (typeof address === "object" && address) {
        resolve(address.port);
        return;
      }
      reject(new Error("Companion tunnel proxy did not receive a TCP port."));
    });
  });
}

function tunnelTransport(input: {
  publicBaseUrl: string;
  localBaseUrl: string;
  provider: "cloudflare-quick-tunnel" | "configured-url";
  proxyBaseUrl?: string;
  startedAt?: string;
  notes: string[];
}): CompanionResolvedPairingTransport {
  const publicBaseUrl = normalizePublicBaseUrl(input.publicBaseUrl) ?? input.publicBaseUrl;
  return {
    transportMode: "tunnel",
    apiBaseUrl: companionTunnelApiBaseUrlFromPublicBase(publicBaseUrl),
    uiBaseUrl: companionTunnelUiBaseUrlFromPublicBase(publicBaseUrl),
    transport: {
      protocol: "https-tunnel",
      provider: input.provider,
      status: "ready",
      publicBaseUrl,
      localBaseUrl: input.localBaseUrl,
      proxyBaseUrl: input.proxyBaseUrl,
      recreateCommand:
        input.provider === "cloudflare-quick-tunnel"
          ? `cloudflared tunnel --url ${input.proxyBaseUrl ?? input.localBaseUrl}`
          : undefined,
      startedAt: input.startedAt,
      notes: input.notes
    }
  };
}

function manualHttpTransport(
  apiBaseUrl: string,
  uiBaseUrl: string,
  notes: string[]
): CompanionResolvedPairingTransport {
  return {
    transportMode: "manual-http",
    apiBaseUrl,
    uiBaseUrl,
    transport: {
      protocol: "http",
      provider: "manual-http",
      status: "ready",
      localBaseUrl: apiBaseUrl.replace(/\/api\/v1\/?$/u, ""),
      notes
    }
  };
}

function snapshotFor(
  status: CompanionPairingTransportPayload["status"],
  localBaseUrl = localForgeBaseUrl()
): TunnelStateSnapshot {
  return {
    status,
    publicBaseUrl: tunnelState.publicBaseUrl,
    proxyBaseUrl: proxyState?.proxyBaseUrl ?? null,
    localBaseUrl,
    startedAt: tunnelState.startedAt,
    lastError: tunnelState.lastError
  };
}

function shouldAutoStartQuickTunnel() {
  if (process.env.FORGE_COMPANION_TUNNEL_DISABLED === "1") {
    return false;
  }
  if (process.env.FORGE_COMPANION_TUNNEL_AUTOSTART === "0") {
    return false;
  }
  if (isTestRuntime()) {
    return false;
  }
  return true;
}

function isTestRuntime() {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.argv.some((arg) => arg === "--test" || arg.includes("vitest"))
  );
}

function localForgeBaseUrl() {
  const configured = process.env.FORGE_COMPANION_TUNNEL_LOCAL_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/u, "");
  }
  const port = Number(process.env.PORT ?? 4317);
  const safePort = Number.isInteger(port) && port > 0 ? port : 4317;
  return `http://127.0.0.1:${safePort}`;
}

function normalizeApiBaseUrl(value: string) {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace(/\/+$/u, "");
    if (!url.pathname.endsWith("/api/v1")) {
      url.pathname = `${url.pathname}/api/v1`.replace(/\/{2,}/gu, "/");
    }
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return trimmed;
  }
}

function normalizeUiBaseUrl(value?: string | null) {
  if (!value?.trim()) {
    return null;
  }
  try {
    const url = new URL(value);
    url.pathname = "/forge/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function deriveUiBaseUrlFromApiBaseUrl(apiBaseUrl: string) {
  try {
    const url = new URL(apiBaseUrl);
    url.pathname = "/forge/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return apiBaseUrl;
  }
}

function normalizePublicBaseUrl(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      return null;
    }
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

function readMaxBodyBytes() {
  const parsed = Number(process.env.FORGE_COMPANION_TUNNEL_MAX_BODY_MB);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(parsed * 1024 * 1024);
  }
  return DEFAULT_MAX_BODY_BYTES;
}

function resolveCommand(command: string) {
  const result = spawnSync(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? [command] : ["-v", command], {
    encoding: "utf8",
    shell: process.platform !== "win32"
  });
  if (result.status !== 0) {
    return null;
  }
  const resolved = result.stdout.split(/\r?\n/u)[0]?.trim();
  if (!resolved) {
    return null;
  }
  if (process.platform !== "win32" && !net.isIP(resolved)) {
    return resolved;
  }
  logForgeDebug(`[companion-tunnel] resolved ${command} at ${resolved}`);
  return resolved;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
