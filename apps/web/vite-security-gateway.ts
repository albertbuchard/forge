import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Plugin } from "vite";

const DEV_SESSION_CHECK_PATH = "/api/v1/security/dev-session-check";
const VITE_HMR_SUBPROTOCOL = "vite-hmr";

function exactOrigin(value: string) {
  const parsed = new URL(value);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.origin !== value
  ) {
    throw new Error(`Forge requires an exact HTTP origin, received ${value}.`);
  }
  return parsed.origin;
}

function isExactHttpOrigin(value: string) {
  try {
    return exactOrigin(value) === value;
  } catch {
    return false;
  }
}

function allowedOrigins(env: NodeJS.ProcessEnv) {
  const configured = (env.FORGE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(exactOrigin);
  const devOrigin = env.FORGE_DEV_WEB_ORIGIN?.trim();
  return new Set([
    "http://127.0.0.1:3027",
    "http://localhost:3027",
    "http://[::1]:3027",
    ...(devOrigin ? [exactOrigin(new URL(devOrigin).origin)] : []),
    ...configured
  ]);
}

function requestHeaders(request: IncomingMessage) {
  const headers = new Headers({
    Accept: "application/json",
    "X-Forge-Dev-Gateway": "vite"
  });
  for (const name of [
    "cookie",
    "authorization",
    "x-forge-dev-proxy-assertion",
    "x-forge-dev-proxy-target"
  ]) {
    const value = request.headers[name];
    if (typeof value === "string") {
      headers.set(name, value);
    }
  }
  return headers;
}

async function isAuthorized(
  request: IncomingMessage,
  apiTarget: string,
  fetchImpl: typeof fetch
) {
  try {
    const response = await fetchImpl(
      new URL(DEV_SESSION_CHECK_PATH, apiTarget),
      {
        method: "GET",
        headers: requestHeaders(request),
        redirect: "manual",
        signal: AbortSignal.timeout(2_000)
      }
    );
    return response.status === 200;
  } catch {
    return false;
  }
}

function rejectUpgrade(socket: Duplex, code: number, message: string) {
  if (!socket.destroyed) {
    socket.end(
      `HTTP/1.1 ${code} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
    );
  }
}

export function forgeViteSecurityGateway(input: {
  apiTarget: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Plugin {
  const origins = allowedOrigins(input.env ?? process.env);
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    name: "forge-vite-security-gateway",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (await isAuthorized(request, input.apiTarget, fetchImpl)) {
          next();
          return;
        }
        response.statusCode = 401;
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(
          JSON.stringify({
            code: "gateway_authentication_required",
            error: "A valid paired Forge browser session is required."
          })
        );
      });

      return () => {
        const httpServer = server.httpServer;
        if (!httpServer) {
          return;
        }
        const upgradeListeners = httpServer.listeners("upgrade");
        httpServer.removeAllListeners("upgrade");
        httpServer.on("upgrade", (request, socket, head) => {
          void (async () => {
            const origin = request.headers.origin;
            const hasProxyAssertion =
              typeof request.headers["x-forge-dev-proxy-assertion"] ===
                "string" &&
              typeof request.headers["x-forge-dev-proxy-target"] === "string";
            if (
              typeof origin !== "string" ||
              (!origins.has(origin) &&
                !(hasProxyAssertion && isExactHttpOrigin(origin))) ||
              request.headers["sec-websocket-protocol"] !== VITE_HMR_SUBPROTOCOL
            ) {
              rejectUpgrade(socket, 403, "Forbidden");
              return;
            }
            if (!(await isAuthorized(request, input.apiTarget, fetchImpl))) {
              rejectUpgrade(socket, 401, "Unauthorized");
              return;
            }
            for (const listener of upgradeListeners) {
              listener.call(httpServer, request, socket, head);
            }
          })();
        });
      };
    }
  };
}
