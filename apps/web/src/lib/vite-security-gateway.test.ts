import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough } from "node:stream";
import type { ViteDevServer } from "vite";
import { test } from "vitest";

import { forgeViteSecurityGateway } from "../../vite-security-gateway";

type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void
) => void | Promise<void>;

function request(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("direct Vite HTTP and HMR require the API session check, exact origin, and Vite subprotocol", async () => {
  let middleware: Middleware | null = null;
  let forwardedUpgrades = 0;
  const httpServer = new EventEmitter();
  httpServer.on("upgrade", () => {
    forwardedUpgrades += 1;
  });
  const plugin = forgeViteSecurityGateway({
    apiTarget: "http://127.0.0.1:4317",
    env: {},
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      const validBrowser = headers.get("cookie") === "forge_session=valid";
      const proxyAssertion = headers.get("x-forge-dev-proxy-assertion");
      const proxyTarget = headers.get("x-forge-dev-proxy-target");
      const validProxy =
        (proxyAssertion === "one-time-proxy-assertion" &&
          proxyTarget === "/forge/src/main.tsx") ||
        (proxyAssertion === "one-time-hmr-assertion" &&
          proxyTarget === "/forge/__vite_hmr");
      return new Response(null, {
        status: validBrowser || validProxy ? 200 : 401
      });
    }
  });
  assert.equal(typeof plugin.configureServer, "function");
  const postHook = (
    plugin.configureServer as (server: ViteDevServer) => (() => void) | void
  )({
    middlewares: {
      use(handler: Middleware) {
        middleware = handler;
      }
    },
    httpServer
  } as unknown as ViteDevServer);
  postHook?.();
  assert.ok(middleware);
  const securedMiddleware = middleware as unknown as Middleware;

  let nextCalls = 0;
  const responseState = {
    statusCode: 200,
    body: "",
    setHeader() {
      return this;
    },
    end(body?: string) {
      this.body = body ?? "";
      return this;
    }
  };
  await securedMiddleware(
    request({}),
    responseState as unknown as ServerResponse,
    () => {
      nextCalls += 1;
    }
  );
  assert.equal(responseState.statusCode, 401);
  assert.equal(nextCalls, 0);
  assert.match(responseState.body, /gateway_authentication_required/);

  await securedMiddleware(
    request({ cookie: "forge_session=valid" }),
    responseState as unknown as ServerResponse,
    () => {
      nextCalls += 1;
    }
  );
  assert.equal(nextCalls, 1);

  await securedMiddleware(
    request({
      "x-forge-dev-proxy-assertion": "one-time-proxy-assertion",
      "x-forge-dev-proxy-target": "/forge/src/main.tsx"
    }),
    responseState as unknown as ServerResponse,
    () => {
      nextCalls += 1;
    }
  );
  assert.equal(nextCalls, 2);

  const wrongOriginSocket = new PassThrough();
  let wrongOriginResponse = "";
  wrongOriginSocket.on("data", (chunk) => {
    wrongOriginResponse += chunk.toString();
  });
  httpServer.emit(
    "upgrade",
    request({
      cookie: "forge_session=valid",
      origin: "https://attacker.example",
      "sec-websocket-protocol": "vite-hmr"
    }),
    wrongOriginSocket,
    Buffer.alloc(0)
  );
  await once(wrongOriginSocket, "end");
  assert.match(wrongOriginResponse, /403 Forbidden/);
  assert.equal(forwardedUpgrades, 0);

  const wrongProtocolSocket = new PassThrough();
  httpServer.emit(
    "upgrade",
    request({
      cookie: "forge_session=valid",
      origin: "http://127.0.0.1:3027",
      "sec-websocket-protocol": "unreviewed"
    }),
    wrongProtocolSocket,
    Buffer.alloc(0)
  );
  await settle();
  assert.equal(forwardedUpgrades, 0);

  const anonymousSocket = new PassThrough();
  httpServer.emit(
    "upgrade",
    request({
      origin: "https://paired-forge.example.ts.net",
      "sec-websocket-protocol": "vite-hmr"
    }),
    anonymousSocket,
    Buffer.alloc(0)
  );
  await settle();
  assert.equal(forwardedUpgrades, 0);

  const proxySocket = new PassThrough();
  httpServer.emit(
    "upgrade",
    request({
      origin: "https://paired-forge.example.ts.net",
      "sec-websocket-protocol": "vite-hmr",
      "x-forge-dev-proxy-assertion": "one-time-hmr-assertion",
      "x-forge-dev-proxy-target": "/forge/__vite_hmr"
    }),
    proxySocket,
    Buffer.alloc(0)
  );
  await settle();
  assert.equal(forwardedUpgrades, 1);

  const validSocket = new PassThrough();
  httpServer.emit(
    "upgrade",
    request({
      cookie: "forge_session=valid",
      origin: "http://127.0.0.1:3027",
      "sec-websocket-protocol": "vite-hmr"
    }),
    validSocket,
    Buffer.alloc(0)
  );
  await settle();
  assert.equal(forwardedUpgrades, 2);
});
