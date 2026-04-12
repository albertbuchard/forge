import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyInstance, FastifyReply } from "fastify";

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
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

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

function getDevWebOrigin() {
  const value = process.env.FORGE_DEV_WEB_ORIGIN?.trim();
  return value && value.length > 0 ? value : null;
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
  const port = input.env.FORGE_DEV_WEB_PORT?.trim() || getDefaultDevWebOriginPort(input.origin);
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
};

function parseRequestTarget(requestPath: string) {
  return new URL(requestPath, "http://forge.local");
}

function copyProxyHeaders(response: Response, reply: FastifyReply) {
  for (const [name, value] of response.headers) {
    const lowerName = name.toLowerCase();
    if (
      lowerName === "connection" ||
      lowerName === "content-length" ||
      lowerName === "keep-alive" ||
      lowerName === "transfer-encoding"
    ) {
      continue;
    }
    reply.header(name, value);
  }
}

async function proxyDevAsset(input: {
  origin: URL;
  pathname: string;
  search: string;
  reply: FastifyReply;
  fetchImpl: typeof fetch;
}) {
  const target = new URL(
    input.pathname.startsWith("/") ? input.pathname.slice(1) : input.pathname,
    input.origin
  );
  target.search = input.search;
  const response = await input.fetchImpl(target, { redirect: "manual" });
  input.reply.code(response.status);
  copyProxyHeaders(response, input.reply);
  if (!response.headers.has("cache-control")) {
    input.reply.header("Cache-Control", "no-store, max-age=0, must-revalidate");
  }
  if (!response.body) {
    return "";
  }
  return Buffer.from(await response.arrayBuffer());
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
  options: { devWebRuntime: DevWebRuntime; fetchImpl: typeof fetch }
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

  const devWebOrigin = await options.devWebRuntime.ensureReady();
  if (devWebOrigin) {
    try {
      return await proxyDevAsset({
        origin: devWebOrigin,
        pathname: normalizedRequestPath,
        search: requestTarget.search,
        reply,
        fetchImpl: options.fetchImpl
      });
    } catch {
      reply.header("X-Forge-Web-Fallback", "built");
    }
  }

  const clientDir = await getClientDir();
  const assetPath = resolveAsset(clientDir, normalizedRequestPath);
  const ext = path.extname(assetPath);

  try {
    const payload = await readFile(assetPath);
    reply.type(contentTypes[ext] ?? "application/octet-stream");
    reply.header("Cache-Control", "no-store, max-age=0, must-revalidate");
    if (ext === ".html") {
      reply.header("Pragma", "no-cache");
    }
    return payload;
  } catch {
    if (!path.extname(normalizedRequestPath)) {
      try {
        const payload = await readFile(path.join(clientDir, "index.html"));
        reply.type(contentTypes[".html"]);
        reply.header("Cache-Control", "no-store, max-age=0, must-revalidate");
        reply.header("Pragma", "no-cache");
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

  app.addHook("onClose", async () => {
    await devWebRuntime.stop();
  });
  app.get("/", async (_request, reply) =>
    serveAsset("/", reply, { devWebRuntime, fetchImpl })
  );
  app.get("/*", async (request, reply) =>
    serveAsset(request.url, reply, { devWebRuntime, fetchImpl })
  );
}
