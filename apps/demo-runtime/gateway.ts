import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { createServer, request as proxyRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, type ChildProcess } from "node:child_process";

import {
  decodeDemoSessionToken,
  demoRouteAllowed,
  encodeDemoSessionToken
} from "./policy.js";

const repositoryRoot = process.cwd();
const distRoot = path.join(repositoryRoot, "dist");
const demoRoot = path.resolve(process.env.FORGE_DEMO_ROOT?.trim() || path.join(os.tmpdir(), "forge-public-demo"));
const secret = process.env.FORGE_DEMO_SESSION_SECRET?.trim();
const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number(process.env.PORT ?? 4400);
const sessionTtlMs = 30 * 60_000;
const idleTtlMs = 15 * 60_000;
const maxSessions = 20;
const maxBodyBytes = 1_048_576;

if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
  throw new Error("FORGE_DEMO_SESSION_SECRET must contain at least 32 bytes.");
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PORT must be a non-privileged TCP port.");
await mkdir(demoRoot, { recursive: true, mode: 0o700 });

type DemoSession = {
  id: string;
  root: string;
  port: number;
  process: ChildProcess;
  createdAt: number;
  lastSeenAt: number;
  requests: number[];
};
const sessions = new Map<string, DemoSession>();

function cookieValue(request: IncomingMessage, name: string) {
  return request.headers.cookie?.split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
}
function secureRequest(request: IncomingMessage) {
  return Boolean(
    (request.socket as IncomingMessage["socket"] & { encrypted?: boolean }).encrypted ||
      request.headers["x-forwarded-proto"] === "https"
  );
}
function sessionCookie(request: IncomingMessage, token: string) {
  const secure = secureRequest(request);
  return `${secure ? "__Host-forge-demo" : "forge_demo_session"}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(sessionTtlMs / 1000)}${secure ? "; Secure" : ""}`;
}

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a demo port."));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function stopSession(session: DemoSession) {
  sessions.delete(session.id);
  session.process.kill("SIGTERM");
  await rm(session.root, { recursive: true, force: true });
}

async function createSession() {
  if (sessions.size >= maxSessions) {
    throw Object.assign(
      new Error("The public demo is at its 20-session capacity. Try again after an existing session expires."),
      { statusCode: 503 }
    );
  }
  const id = randomBytes(18).toString("base64url");
  const root = path.join(demoRoot, id);
  const childPort = await freePort();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, ["--import", "tsx", "apps/demo-runtime/session-server.ts", "--root", root, "--port", String(childPort)], {
    cwd: repositoryRoot,
    env: { ...process.env, FORGE_DATA_ROOT: root, HOST: "127.0.0.1", PORT: String(childPort), FORGE_DISCOVERY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let diagnostic = "";
  child.stderr?.on("data", (chunk) => {
    diagnostic = `${diagnostic}${String(chunk)}`.slice(-2_000);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Demo session startup timed out.")), 20_000);
      let output = "";
      child.stdout?.on("data", (chunk) => {
        output = `${output}${String(chunk)}`.slice(-2_000);
        if (output.includes(`FORGE_DEMO_READY=${childPort}`)) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Demo session exited during startup (${code ?? "signal"}).`));
      });
    });
  } catch (error) {
    child.kill("SIGTERM");
    await rm(root, { recursive: true, force: true });
    console.error("Forge demo session startup failed", {
      message: error instanceof Error ? error.message : "unknown startup error",
      diagnostic
    });
    throw Object.assign(
      new Error("The isolated demo session could not start. Try again shortly."),
      { statusCode: 503 }
    );
  }
  const now = Date.now();
  const session: DemoSession = { id, root, port: childPort, process: child, createdAt: now, lastSeenAt: now, requests: [] };
  child.once("exit", () => {
    sessions.delete(id);
    void rm(root, { recursive: true, force: true });
  });
  sessions.set(id, session);
  return session;
}

async function resolveSession(request: IncomingMessage, response: ServerResponse) {
  const secure = secureRequest(request);
  const decoded = decodeDemoSessionToken(
    secret,
    cookieValue(request, secure ? "__Host-forge-demo" : "forge_demo_session")
  );
  let session = decoded ? sessions.get(decoded.id) : null;
  if (!session || decoded!.createdAt !== session.createdAt || Date.now() - session.createdAt > sessionTtlMs) {
    if (session) await stopSession(session);
    session = await createSession();
    response.setHeader(
      "Set-Cookie",
      sessionCookie(
        request,
        encodeDemoSessionToken(secret, session.id, session.createdAt)
      )
    );
  }
  session.lastSeenAt = Date.now();
  const minuteAgo = Date.now() - 60_000;
  session.requests = session.requests.filter((entry) => entry >= minuteAgo);
  if (session.requests.length >= 120) throw Object.assign(new Error("Demo request limit reached. Wait one minute."), { statusCode: 429 });
  session.requests.push(Date.now());
  return session;
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBodyBytes) throw Object.assign(new Error("Demo requests are limited to 1 MiB."), { statusCode: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function contentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" } as Record<string, string>)[extension] ?? "application/octet-stream";
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (url.pathname === "/") {
    response.writeHead(302, { Location: "/forge/" });
    response.end();
    return;
  }
  const relative = url.pathname.startsWith("/forge/") ? url.pathname.slice("/forge/".length) : url.pathname.slice(1);
  const requested = path.resolve(distRoot, relative || "index.html");
  const requestedFile =
    requested.startsWith(`${distRoot}${path.sep}`) &&
    (await stat(requested).catch(() => null))?.isFile()
      ? requested
      : null;
  if (!requestedFile && path.extname(relative)) {
    response.writeHead(404, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    });
    response.end(JSON.stringify({ error: "Demo asset not found." }));
    return;
  }
  const candidate = requestedFile ?? path.join(distRoot, "index.html");
  response.writeHead(200, { "Content-Type": contentType(candidate), "Cache-Control": candidate.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable", "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'" });
  createReadStream(candidate).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/api/v1/demo/status") {
      const session = await resolveSession(request, response);
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ demo: { sampleData: true, isolatedSession: true, resettable: true, expiresAt: new Date(session.createdAt + sessionTtlMs).toISOString(), limits: { sessionMinutes: 30, idleMinutes: 15, requestsPerMinute: 120, requestBytes: maxBodyBytes }, allowedMutation: "sample_task_status_only" } }));
      return;
    }
    if (url.pathname === "/api/v1/demo/reset" && request.method === "POST") {
      const session = await resolveSession(request, response);
      await stopSession(session);
      const replacement = await createSession();
      response.setHeader(
        "Set-Cookie",
        sessionCookie(
          request,
          encodeDemoSessionToken(secret, replacement.id, replacement.createdAt)
        )
      );
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ reset: true }));
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await serveStatic(request, response, url);
      return;
    }
    const session = await resolveSession(request, response);
    const body = await readBody(request);
    if (!demoRouteAllowed(request.method ?? "GET", url, body)) {
      response.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "This public demonstration exposes sample-data reads and sample task status changes only.", code: "demo_route_denied" }));
      return;
    }
    const headers = { ...request.headers, host: `127.0.0.1:${session.port}`, "content-length": String(body.length) };
    delete headers["x-forwarded-for"];
    delete headers["x-real-ip"];
    const proxied = proxyRequest({ host: "127.0.0.1", port: session.port, path: url.pathname + url.search, method: request.method, headers }, (upstream) => {
      const responseHeaders = { ...upstream.headers, "cache-control": "no-store" };
      const gatewayCookies = response.getHeader("Set-Cookie");
      const upstreamCookies = upstream.headers["set-cookie"] ?? [];
      const combinedCookies = [
        ...(Array.isArray(gatewayCookies)
          ? gatewayCookies
          : gatewayCookies
            ? [String(gatewayCookies)]
            : []),
        ...upstreamCookies
      ];
      if (combinedCookies.length > 0) responseHeaders["set-cookie"] = combinedCookies;
      response.writeHead(upstream.statusCode ?? 502, responseHeaders);
      upstream.pipe(response);
    });
    proxied.on("error", () => { if (!response.headersSent) response.writeHead(502, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: "The isolated demo session is restarting." })); });
    proxied.end(body);
  } catch (error) {
    const status = Number((error as { statusCode?: unknown }).statusCode ?? 500);
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Demo request failed." }));
  }
});

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const session of sessions.values()) if (now - session.lastSeenAt > idleTtlMs || now - session.createdAt > sessionTtlMs) void stopSession(session);
}, 60_000).unref();

const close = async () => {
  clearInterval(cleanup);
  for (const session of [...sessions.values()]) await stopSession(session);
  server.close();
};
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
server.listen(port, host, () => console.log(`Forge public demo listening on http://${host}:${port}/forge/`));
