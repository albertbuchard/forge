import {
  Agent as HttpAgent,
  request as httpRequest,
  type IncomingMessage
} from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { Duplex } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { GAMIFICATION_ASSET_VERSION } from "@/lib/gamification-catalog.js";
import { resolveGamificationSpriteAssetPath as resolveGamificationSpriteAssetPathFromStore } from "./services/gamification-assets.js";

const distDir = path.join(process.cwd(), "dist");
const packagedRuntimeDistDir = path.join(
  process.cwd(),
  "plugins",
  "forge-codex",
  "runtime",
  "dist"
);

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const gamificationSpriteRoutePrefix = "/gamification/sprites/";
const gamificationPreviewRoutePrefix = "/gamification-previews/";
const noStoreCacheControl = "no-store, max-age=0, must-revalidate";
const immutableCacheControl = "public, max-age=31536000, immutable";
const revalidatedAssetCacheControl =
  "public, max-age=300, stale-while-revalidate=60";
const viteHashedAssetPattern = /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

function isViteHashedBuiltAssetPath(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  return (
    segments[0] === "assets" &&
    segments.length >= 2 &&
    segments.slice(1).every((segment) => segment !== "." && segment !== "..") &&
    viteHashedAssetPattern.test(pathname)
  );
}

export function resolveBuiltAssetCacheControl(input: {
  pathname: string;
  search: string;
  extension: string;
}) {
  if (input.extension === ".html") {
    return noStoreCacheControl;
  }

  const hasCurrentAssetVersion =
    new URLSearchParams(input.search).get("v") === GAMIFICATION_ASSET_VERSION;
  const isVersionedGamificationAsset =
    hasCurrentAssetVersion &&
    (input.pathname.startsWith(gamificationSpriteRoutePrefix) ||
      input.pathname.startsWith(gamificationPreviewRoutePrefix));
  const isHashedViteAsset = isViteHashedBuiltAssetPath(input.pathname);

  return isVersionedGamificationAsset || isHashedViteAsset
    ? immutableCacheControl
    : revalidatedAssetCacheControl;
}

function normalizeBasePath(value: string) {
  if (!value || value === "/") {
    return "/";
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
}

function normalizeAbsoluteUrl(value: string) {
  const url = new URL(value);
  url.pathname = normalizeBasePath(url.pathname);
  return url;
}

function getDefaultBasePath() {
  return process.env.FORGE_BASE_PATH ?? "/forge/";
}

function shouldAutostartDevWeb(env: NodeJS.ProcessEnv) {
  const value = env.FORGE_DEV_WEB_AUTOSTART?.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "no";
}

function getDevWebCommand(env: NodeJS.ProcessEnv) {
  const value = env.FORGE_DEV_WEB_COMMAND?.trim();
  return value && value.length > 0 ? value : "npm run dev:web";
}

type ManagedDevWebLaunch = {
  command: string;
  args?: string[];
  env: NodeJS.ProcessEnv;
  shell: boolean;
};

function getDefaultDevWebOriginPort(origin: URL | null) {
  if (origin?.port && origin.port.trim().length > 0) {
    return origin.port;
  }
  if (origin?.protocol === "https:") {
    return "443";
  }
  return "3027";
}

function getDefaultViteCliPath(cwd: string) {
  const candidate = path.join(cwd, "node_modules", "vite", "bin", "vite.js");
  return existsSync(candidate) ? candidate : null;
}

function buildManagedDevWebLaunch(input: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  origin: URL | null;
}): ManagedDevWebLaunch {
  const explicitCommand = input.env.FORGE_DEV_WEB_COMMAND?.trim();
  if (explicitCommand && explicitCommand.length > 0) {
    return {
      command: explicitCommand,
      env: input.env,
      shell: true
    };
  }

  const viteCliPath = getDefaultViteCliPath(input.cwd);
  if (!viteCliPath) {
    return {
      command: getDevWebCommand(input.env),
      env: input.env,
      shell: true
    };
  }

  const host = input.env.FORGE_DEV_WEB_HOST?.trim() || "127.0.0.1";
  const port =
    input.env.FORGE_DEV_WEB_PORT?.trim() ||
    getDefaultDevWebOriginPort(input.origin);
  return {
    command: process.execPath,
    args: [viteCliPath, "--host", host, "--port", port],
    env: {
      ...input.env,
      FORGE_BASE_PATH: getDefaultBasePath()
    },
    shell: false
  };
}

function stripBasePath(requestPath: string, basePath: string) {
  const normalizedBasePath = normalizeBasePath(basePath);
  if (normalizedBasePath === "/") {
    return requestPath;
  }

  const normalizedRoot = normalizedBasePath.slice(0, -1);
  if (requestPath === normalizedRoot) {
    return "/";
  }

  if (requestPath.startsWith(normalizedBasePath)) {
    const stripped = requestPath.slice(normalizedRoot.length);
    return stripped.startsWith("/") ? stripped : `/${stripped}`;
  }

  return requestPath;
}

function resolveAsset(clientDir: string, requestPath: string): string {
  if (requestPath === "/") {
    return path.join(clientDir, "index.html");
  }

  const safePath = requestPath.replace(/^\/+/, "");
  return path.join(clientDir, safePath);
}

type WebAssetLocation = {
  assetPath: string;
  clientDir: string | null;
};

type WebAssetLocationResolvers = {
  getClientDir?: () => Promise<string>;
  resolveGamificationSpriteAssetPath?: (
    relativePath: string
  ) => Promise<string>;
};

export async function resolveWebAssetLocation(
  requestPath: string,
  resolvers: WebAssetLocationResolvers = {}
): Promise<WebAssetLocation> {
  if (requestPath.startsWith(gamificationSpriteRoutePrefix)) {
    const relativeSpritePath = requestPath.slice(
      gamificationSpriteRoutePrefix.length
    );
    return {
      assetPath: await (
        resolvers.resolveGamificationSpriteAssetPath ??
        resolveGamificationSpriteAssetPathFromStore
      )(relativeSpritePath),
      clientDir: null
    };
  }
  const clientDir = await (resolvers.getClientDir ?? getClientDir)();
  return {
    assetPath: resolveAsset(clientDir, requestPath),
    clientDir
  };
}

async function getClientDir() {
  try {
    await access(path.join(distDir, "index.html"));
    return distDir;
  } catch {
    await access(path.join(packagedRuntimeDistDir, "index.html"));
    return packagedRuntimeDistDir;
  }
}

type DevWebRuntime = {
  ensureReady(): Promise<URL | null>;
  stop(): Promise<void>;
};

type ManagedDevWebRuntimeOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  spawnImpl?: typeof spawn;
};

type WebRouteOptions = {
  devWebRuntime?: DevWebRuntime;
  fetchImpl?: typeof fetch;
  devAssetProxy?: DevAssetProxy;
  resolveWebAssetLocation?: typeof resolveWebAssetLocation;
  issueDevProxyAssertion?: (
    request: FastifyRequest,
    target: string
  ) => string | null;
  authorizeUpgrade?: (
    request: IncomingMessage,
    target: string
  ) => Promise<string | null> | string | null;
  allowedOrigins?: readonly string[];
};

function parseRequestTarget(requestPath: string) {
  return new URL(requestPath, "http://forge.local");
}

function copyProxyHeaders(response: Response, reply: FastifyReply) {
  for (const [name, value] of response.headers) {
    const lowerName = name.toLowerCase();
    if (hopByHopHeaders.has(lowerName)) {
      continue;
    }
    reply.header(name, value);
  }
}

function isHtmlResponse(contentType: string | string[] | undefined) {
  const values = Array.isArray(contentType) ? contentType : [contentType];
  return values.some(
    (value) =>
      typeof value === "string" && value.toLowerCase().includes("text/html")
  );
}

function forceUncachedHtml(reply: FastifyReply) {
  reply.header("Cache-Control", noStoreCacheControl);
  reply.header("Pragma", "no-cache");
}

const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

function buildDevWebTarget(origin: URL, pathname: string, search: string) {
  const target = new URL(
    pathname.startsWith("/") ? pathname.slice(1) : pathname,
    origin
  );
  target.search = search;
  return target;
}

async function proxyDevAsset(input: {
  origin: URL;
  pathname: string;
  search: string;
  reply: FastifyReply;
  fetchImpl: typeof fetch;
  assertion?: string | null;
}) {
  const target = buildDevWebTarget(input.origin, input.pathname, input.search);
  const response = await input.fetchImpl(target, {
    headers: {
      Accept: "*/*",
      ...devAssetAssertionHeaders(
        input.assertion,
        `${target.pathname}${target.search}`
      )
    },
    redirect: "manual"
  });
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new DevWebAuthorizationError();
  }
  input.reply.code(response.status);
  copyProxyHeaders(response, input.reply);
  if (isHtmlResponse(response.headers.get("content-type") ?? undefined)) {
    forceUncachedHtml(input.reply);
  } else if (!response.headers.has("cache-control")) {
    input.reply.header("Cache-Control", noStoreCacheControl);
  }
  if (!response.body) {
    return "";
  }
  return Buffer.from(await response.arrayBuffer());
}

type DevAssetProxy = {
  fetch(input: {
    origin: URL;
    pathname: string;
    search: string;
    reply: FastifyReply;
    assertion?: string | null;
  }): Promise<Buffer | string>;
  close(): void;
};

class DevWebAuthorizationError extends Error {
  constructor() {
    super("The development web runtime rejected the browser credential.");
    this.name = "DevWebAuthorizationError";
  }
}

function devAssetAssertionHeaders(
  assertion: string | null | undefined,
  target: string
): Record<string, string> {
  if (!assertion) {
    return {};
  }
  return {
    "X-Forge-Dev-Proxy-Assertion": assertion,
    "X-Forge-Dev-Proxy-Target": target
  };
}

export function createKeepAliveDevAssetProxy(): DevAssetProxy {
  const httpAgent = new HttpAgent({
    keepAlive: true,
    maxFreeSockets: 8,
    maxSockets: 32
  });
  const httpsAgent = new HttpsAgent({
    keepAlive: true,
    maxFreeSockets: 8,
    maxSockets: 32
  });

  return {
    fetch(input) {
      const target = buildDevWebTarget(
        input.origin,
        input.pathname,
        input.search
      );
      const isHttps = target.protocol === "https:";
      const request = isHttps ? httpsRequest : httpRequest;
      const agent = isHttps ? httpsAgent : httpAgent;

      return new Promise((resolve, reject) => {
        const proxyRequest = request(
          target,
          {
            agent,
            headers: {
              Accept: "*/*",
              Host: target.host,
              ...devAssetAssertionHeaders(
                input.assertion,
                `${target.pathname}${target.search}`
              )
            },
            method: "GET"
          },
          (response) => {
            if (response.statusCode === 401 || response.statusCode === 403) {
              response.resume();
              response.once("end", () =>
                reject(new DevWebAuthorizationError())
              );
              response.once("error", reject);
              return;
            }
            input.reply.code(response.statusCode ?? 502);
            for (const [name, value] of Object.entries(response.headers)) {
              if (!value || hopByHopHeaders.has(name.toLowerCase())) {
                continue;
              }
              input.reply.header(name, value);
            }
            if (isHtmlResponse(response.headers["content-type"])) {
              forceUncachedHtml(input.reply);
            } else if (!response.headers["cache-control"]) {
              input.reply.header("Cache-Control", noStoreCacheControl);
            }

            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer | string) => {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            response.on("end", () => {
              resolve(Buffer.concat(chunks));
            });
            response.on("error", reject);
          }
        );
        proxyRequest.on("error", reject);
        proxyRequest.end();
      });
    },
    close() {
      httpAgent.destroy();
      httpsAgent.destroy();
    }
  };
}

function createDevAssetProxy(fetchImpl: typeof fetch): DevAssetProxy {
  if (fetchImpl !== fetch) {
    return {
      fetch(input) {
        return proxyDevAsset({ ...input, fetchImpl });
      },
      close() {}
    };
  }
  return createKeepAliveDevAssetProxy();
}

function writeProxyUpgradeResponse(socket: Duplex, response: IncomingMessage) {
  const statusCode = response.statusCode ?? 101;
  const statusMessage = response.statusMessage ?? "Switching Protocols";
  const headerLines: string[] = [];
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index];
    const value = response.rawHeaders[index + 1];
    if (name && value) {
      headerLines.push(`${name}: ${value}`);
    }
  }
  socket.write(
    `HTTP/${response.httpVersion} ${statusCode} ${statusMessage}\r\n${headerLines.join("\r\n")}\r\n\r\n`
  );
}

function isExactRequestOrigin(request: IncomingMessage, origin: string) {
  const host = request.headers.host;
  if (!host) {
    return false;
  }
  try {
    const parsed = new URL(origin);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      parsed.origin === origin &&
      parsed.host === host
    );
  } catch {
    return false;
  }
}

async function proxyDevWebSocket(input: {
  devWebRuntime: DevWebRuntime;
  request: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  assertion: string;
}) {
  const requestTarget = parseRequestTarget(input.request.url ?? "/");
  const normalizedRequestPath = stripBasePath(
    requestTarget.pathname,
    getDefaultBasePath()
  );
  if (normalizedRequestPath !== "/__vite_hmr") {
    return false;
  }

  const devWebOrigin = await input.devWebRuntime.ensureReady();
  if (!devWebOrigin) {
    input.socket.destroy();
    return true;
  }

  const target = buildDevWebTarget(
    devWebOrigin,
    normalizedRequestPath,
    requestTarget.search
  );
  const proxyHeaders = { ...input.request.headers };
  for (const sensitiveHeader of [
    "authorization",
    "cookie",
    "dpop",
    "x-forge-dev-proxy-assertion",
    "x-forge-dev-proxy-target"
  ]) {
    delete proxyHeaders[sensitiveHeader];
  }
  const proxyRequest = (
    target.protocol === "https:" ? httpsRequest : httpRequest
  )(target, {
    headers: {
      ...proxyHeaders,
      host: target.host,
      ...devAssetAssertionHeaders(
        input.assertion,
        `${target.pathname}${target.search}`
      )
    }
  });

  proxyRequest.on("upgrade", (response, proxySocket, proxyHead) => {
    const closeBothSockets = () => {
      proxySocket.destroy();
      input.socket.destroy();
    };
    proxySocket.on("error", closeBothSockets);
    input.socket.on("error", closeBothSockets);
    writeProxyUpgradeResponse(input.socket, response);
    if (proxyHead.length > 0) {
      input.socket.write(proxyHead);
    }
    if (input.head.length > 0) {
      proxySocket.write(input.head);
    }
    proxySocket.pipe(input.socket).pipe(proxySocket);
  });

  proxyRequest.on("response", () => {
    input.socket.destroy();
  });
  proxyRequest.on("error", () => {
    input.socket.destroy();
  });
  proxyRequest.end();
  return true;
}

function rejectWebSocketUpgrade(
  socket: Duplex,
  statusCode: 401 | 404,
  reason: "Unauthorized" | "Not Found"
) {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.end(
    `HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n\r\n`
  );
}

async function waitForProcessExit(child: ChildProcess, timeoutMs = 5_000) {
  if (child.exitCode !== null) {
    return;
  }
  await Promise.race([
    new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("close", () => resolve());
    }),
    delay(timeoutMs).then(() => {})
  ]);
}

export function createManagedDevWebRuntime(
  options: ManagedDevWebRuntimeOptions = {}
): DevWebRuntime {
  const env = options.env ?? process.env;
  const originValue = env.FORGE_DEV_WEB_ORIGIN?.trim();
  const origin = originValue ? normalizeAbsoluteUrl(originValue) : null;
  const cwd = options.cwd ?? process.cwd();
  const fetchImpl = options.fetchImpl ?? fetch;
  const spawnImpl = options.spawnImpl ?? spawn;
  const autostart = shouldAutostartDevWeb(env);
  const waitTimeoutMs = Number(env.FORGE_DEV_WEB_START_TIMEOUT_MS ?? 30_000);
  const pollIntervalMs = 500;
  let child: ChildProcess | null = null;
  let startupPromise: Promise<URL | null> | null = null;

  async function probe() {
    if (!origin) {
      return null;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_500);
    try {
      const response = await fetchImpl(origin, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal
      });
      return response.status < 500 ? origin : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function waitUntilReady(processRef: ChildProcess) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < waitTimeoutMs) {
      const readyOrigin = await probe();
      if (readyOrigin) {
        return readyOrigin;
      }
      if (processRef.exitCode !== null) {
        break;
      }
      await delay(pollIntervalMs);
    }
    return null;
  }

  async function ensureReady() {
    if (!origin) {
      return null;
    }
    const readyOrigin = await probe();
    if (readyOrigin || !autostart) {
      return readyOrigin;
    }
    if (!startupPromise) {
      startupPromise = (async () => {
        if (!child || child.exitCode !== null) {
          const launch = buildManagedDevWebLaunch({ cwd, env, origin });
          const nextChild = launch.shell
            ? spawnImpl(launch.command, {
                cwd,
                env: launch.env,
                shell: true,
                stdio: "inherit"
              })
            : spawnImpl(launch.command, launch.args ?? [], {
                cwd,
                env: launch.env,
                stdio: "inherit"
              });
          child = nextChild;
          nextChild.once("exit", () => {
            if (child === nextChild) {
              child = null;
            }
          });
        }
        const startedOrigin = await waitUntilReady(child);
        startupPromise = null;
        return startedOrigin;
      })().catch((error) => {
        startupPromise = null;
        throw error;
      });
    }
    return startupPromise;
  }

  async function stop() {
    if (!child || child.exitCode !== null) {
      return;
    }
    const childRef = child;
    childRef.kill("SIGTERM");
    await waitForProcessExit(childRef);
    if (childRef.exitCode === null) {
      childRef.kill("SIGKILL");
      await waitForProcessExit(childRef, 1_000);
    }
    child = null;
  }

  return {
    ensureReady,
    stop
  };
}

async function serveAsset(
  requestPath: string,
  reply: FastifyReply,
  options: {
    devWebRuntime: DevWebRuntime;
    devAssetProxy: DevAssetProxy;
    request: FastifyRequest;
    resolveWebAssetLocation: typeof resolveWebAssetLocation;
    issueDevProxyAssertion?: WebRouteOptions["issueDevProxyAssertion"];
  }
) {
  const requestTarget = parseRequestTarget(requestPath);
  if (requestTarget.pathname.startsWith("/api")) {
    reply.code(404);
    return { error: "Not found" };
  }

  const normalizedRequestPath = stripBasePath(
    requestTarget.pathname,
    getDefaultBasePath()
  );

  if (isViteHashedBuiltAssetPath(normalizedRequestPath)) {
    let assetLocation: WebAssetLocation;
    try {
      assetLocation = await options.resolveWebAssetLocation(
        normalizedRequestPath
      );
    } catch {
      reply.code(404);
      return { error: "Asset not found" };
    }

    try {
      const payload = await readFile(assetLocation.assetPath);
      const extension = path.extname(assetLocation.assetPath);
      reply.type(contentTypes[extension] ?? "application/octet-stream");
      reply.header(
        "Cache-Control",
        resolveBuiltAssetCacheControl({
          pathname: normalizedRequestPath,
          search: requestTarget.search,
          extension
        })
      );
      return payload;
    } catch {
      reply.code(404);
      return { error: "Asset not found" };
    }
  }

  const handlesLocalGamificationSprite = normalizedRequestPath.startsWith(
    gamificationSpriteRoutePrefix
  );
  const devWebOrigin = handlesLocalGamificationSprite
    ? null
    : await options.devWebRuntime.ensureReady();
  if (devWebOrigin) {
    try {
      const devTarget = buildDevWebTarget(
        devWebOrigin,
        normalizedRequestPath,
        requestTarget.search
      );
      const assertion =
        options.issueDevProxyAssertion?.(
          options.request,
          `${devTarget.pathname}${devTarget.search}`
        ) ?? null;
      return await options.devAssetProxy.fetch({
        origin: devWebOrigin,
        pathname: normalizedRequestPath,
        search: requestTarget.search,
        reply,
        assertion
      });
    } catch {
      reply.header("X-Forge-Web-Fallback", "built");
    }
  }

  let assetLocation: WebAssetLocation;
  try {
    assetLocation = await options.resolveWebAssetLocation(
      normalizedRequestPath
    );
  } catch {
    if (handlesLocalGamificationSprite) {
      reply.code(404);
      return { error: "Asset not found" };
    }

    reply.code(503);
    return {
      code: "frontend_not_built",
      error:
        "Forge frontend build output is missing. Run the Vite build before serving the modern web client.",
      statusCode: 503
    };
  }
  const { assetPath, clientDir } = assetLocation;
  const ext = path.extname(assetPath);

  try {
    const payload = await readFile(assetPath);
    reply.type(contentTypes[ext] ?? "application/octet-stream");
    reply.header(
      "Cache-Control",
      resolveBuiltAssetCacheControl({
        pathname: normalizedRequestPath,
        search: requestTarget.search,
        extension: ext
      })
    );
    if (ext === ".html") {
      forceUncachedHtml(reply);
    }
    return payload;
  } catch {
    if (clientDir && !path.extname(normalizedRequestPath)) {
      try {
        const payload = await readFile(path.join(clientDir, "index.html"));
        reply.type(contentTypes[".html"]);
        forceUncachedHtml(reply);
        return payload;
      } catch {
        reply.code(503);
        return {
          code: "frontend_not_built",
          error:
            "Forge frontend build output is missing. Run the Vite build before serving the modern web client.",
          statusCode: 503
        };
      }
    }

    reply.code(404);
    return { error: "Asset not found" };
  }
}

export async function registerWebRoutes(
  app: FastifyInstance,
  options: WebRouteOptions = {}
): Promise<void> {
  const devWebRuntime = options.devWebRuntime ?? createManagedDevWebRuntime();
  const fetchImpl = options.fetchImpl ?? fetch;
  const devAssetProxy = options.devAssetProxy ?? createDevAssetProxy(fetchImpl);
  const basePath = normalizeBasePath(getDefaultBasePath());

  app.addHook("onClose", async () => {
    await devWebRuntime.stop();
    devAssetProxy.close();
  });
  app.server.on("upgrade", (request, socket, head) => {
    void (async () => {
      const requestTarget = parseRequestTarget(request.url ?? "/");
      const normalizedRequestPath = stripBasePath(
        requestTarget.pathname,
        basePath
      );
      if (normalizedRequestPath !== "/__vite_hmr") {
        rejectWebSocketUpgrade(socket, 404, "Not Found");
        return;
      }
      let assertion: string | null = null;
      try {
        const origin = request.headers.origin;
        const exactOriginAllowed =
          typeof origin === "string" &&
          ((options.allowedOrigins ?? []).includes(origin) ||
            isExactRequestOrigin(request, origin));
        const hmrSubprotocol =
          request.headers["sec-websocket-protocol"] === "vite-hmr";
        if (exactOriginAllowed && hmrSubprotocol && options.authorizeUpgrade) {
          assertion = await options.authorizeUpgrade(
            request,
            `${requestTarget.pathname}${requestTarget.search}`
          );
        }
      } catch {
        assertion = null;
      }
      if (!assertion) {
        rejectWebSocketUpgrade(socket, 401, "Unauthorized");
        return;
      }
      const handled = await proxyDevWebSocket({
        devWebRuntime,
        request,
        socket,
        head,
        assertion
      });
      if (!handled) {
        rejectWebSocketUpgrade(socket, 404, "Not Found");
      }
    })();
  });
  app.all("/api/*", async (_request, reply) => {
    reply.code(404);
    return {
      code: "api_route_not_found",
      error: "Forge API route not found.",
      statusCode: 404
    };
  });
  app.get("/__forge-ui-root-redirect", async (request, reply) => {
    if (basePath !== "/") {
      return reply.redirect(basePath, 302);
    }
    return serveAsset("/", reply, {
      devWebRuntime,
      devAssetProxy,
      request,
      resolveWebAssetLocation:
        options.resolveWebAssetLocation ?? resolveWebAssetLocation,
      issueDevProxyAssertion: options.issueDevProxyAssertion
    });
  });
  app.get("/__forge-ui-base-redirect", async (_request, reply) => {
    return reply.redirect(basePath, 302);
  });
  app.get("/", async (request, reply) =>
    serveAsset("/", reply, {
      devWebRuntime,
      devAssetProxy,
      request,
      resolveWebAssetLocation:
        options.resolveWebAssetLocation ?? resolveWebAssetLocation,
      issueDevProxyAssertion: options.issueDevProxyAssertion
    })
  );
  app.get("/*", async (request, reply) =>
    serveAsset(request.url, reply, {
      devWebRuntime,
      devAssetProxy,
      request,
      resolveWebAssetLocation:
        options.resolveWebAssetLocation ?? resolveWebAssetLocation,
      issueDevProxyAssertion: options.issueDevProxyAssertion
    })
  );
}
