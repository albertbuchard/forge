import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import fastify from "fastify";
import {
  createManagedDevWebRuntime,
  registerWebRoutes,
  resolveBuiltAssetCacheControl
} from "./web.js";

test("built asset cache policy keeps HTML fresh and immutable assets stable", () => {
  assert.equal(
    resolveBuiltAssetCacheControl({
      pathname: "/index.html",
      search: "",
      extension: ".html"
    }),
    "no-store, max-age=0, must-revalidate"
  );
  assert.equal(
    resolveBuiltAssetCacheControl({
      pathname: "/assets/sports-page-DAVMqTqP.js",
      search: "",
      extension: ".js"
    }),
    "public, max-age=31536000, immutable"
  );
  assert.equal(
    resolveBuiltAssetCacheControl({
      pathname:
        "/gamification/sprites/themes/mind-locksmith/mascots/mascot-state-020-512.webp",
      search: "?v=0.2.59",
      extension: ".webp"
    }),
    "public, max-age=31536000, immutable"
  );
  assert.equal(
    resolveBuiltAssetCacheControl({
      pathname: "/gamification-previews/mind-locksmith-mascot.webp",
      search: "",
      extension: ".webp"
    }),
    "public, max-age=300, stale-while-revalidate=60"
  );
});

test("managed dev web runtime starts Vite when the dev origin is down", async () => {
  const spawnCalls: string[] = [];
  let ready = false;
  const runtime = createManagedDevWebRuntime({
    env: {
      FORGE_DEV_WEB_ORIGIN: "http://127.0.0.1:3027/forge/",
      FORGE_DEV_WEB_COMMAND: "npm run dev:web",
      FORGE_DEV_WEB_START_TIMEOUT_MS: "5000"
    },
    fetchImpl: (async () => {
      if (!ready) {
        throw new Error("dev web unavailable");
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch,
    spawnImpl: ((command: string) => {
      spawnCalls.push(command);
      ready = true;
      const mockProcess = new EventEmitter() as EventEmitter & {
        exitCode: number | null;
        kill: () => boolean;
      };
      mockProcess.exitCode = null;
      mockProcess.kill = () => {
        mockProcess.exitCode = 0;
        mockProcess.emit("exit", 0, null);
        return true;
      };
      return mockProcess;
    }) as typeof import("node:child_process").spawn
  });

  const origin = await runtime.ensureReady();
  assert.equal(origin?.toString(), "http://127.0.0.1:3027/forge/");
  assert.deepEqual(spawnCalls, ["npm run dev:web"]);
  await runtime.stop();
});

test("managed dev web runtime does not autostart when disabled", async () => {
  let spawnCalled = false;
  const runtime = createManagedDevWebRuntime({
    env: {
      FORGE_DEV_WEB_ORIGIN: "http://127.0.0.1:3027/forge/",
      FORGE_DEV_WEB_AUTOSTART: "0"
    },
    fetchImpl: (async () => {
      throw new Error("dev web unavailable");
    }) as typeof fetch,
    spawnImpl: (() => {
      spawnCalled = true;
      throw new Error("spawn should not run");
    }) as unknown as typeof import("node:child_process").spawn
  });

  const origin = await runtime.ensureReady();
  assert.equal(origin, null);
  assert.equal(spawnCalled, false);
});

test("managed dev web runtime infers a direct Vite launch when no explicit command is set", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "forge-web-runtime-"));
  mkdirSync(path.join(tempDir, "node_modules", "vite", "bin"), {
    recursive: true
  });
  writeFileSync(
    path.join(tempDir, "node_modules", "vite", "bin", "vite.js"),
    ""
  );

  const spawnCalls: {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv | undefined;
  }[] = [];
  let ready = false;

  try {
    const runtime = createManagedDevWebRuntime({
      cwd: tempDir,
      env: {
        FORGE_BASE_PATH: "/forge/",
        FORGE_DEV_WEB_ORIGIN: "http://127.0.0.1:3027/forge/",
        FORGE_DEV_WEB_START_TIMEOUT_MS: "5000"
      },
      fetchImpl: (async () => {
        if (!ready) {
          throw new Error("dev web unavailable");
        }
        return new Response("ok", { status: 200 });
      }) as typeof fetch,
      spawnImpl: ((
        command: string,
        argsOrOptions?: string[] | object,
        maybeOptions?: object
      ) => {
        const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
        const options = (
          Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions
        ) as {
          env?: NodeJS.ProcessEnv;
        };
        spawnCalls.push({ command, args, env: options?.env });
        ready = true;
        const mockProcess = new EventEmitter() as EventEmitter & {
          exitCode: number | null;
          kill: () => boolean;
        };
        mockProcess.exitCode = null;
        mockProcess.kill = () => {
          mockProcess.exitCode = 0;
          mockProcess.emit("exit", 0, null);
          return true;
        };
        return mockProcess;
      }) as typeof import("node:child_process").spawn
    });

    const origin = await runtime.ensureReady();
    assert.equal(origin?.toString(), "http://127.0.0.1:3027/forge/");
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0]?.command, process.execPath);
    assert.equal(
      spawnCalls[0]?.args[0],
      path.join(tempDir, "node_modules", "vite", "bin", "vite.js")
    );
    assert.deepEqual(spawnCalls[0]?.args.slice(1), [
      "--host",
      "127.0.0.1",
      "--port",
      "3027"
    ]);
    assert.equal(spawnCalls[0]?.env?.FORGE_BASE_PATH, "/forge/");
    await runtime.stop();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dev asset proxy reuses an upstream keep-alive socket", async () => {
  const upstreamSockets = new Set<string>();
  const upstreamCredentials: Array<{
    cookie: string | undefined;
    authorization: string | undefined;
    assertion: string | undefined;
    target: string | undefined;
  }> = [];
  const issuedTargets: string[] = [];
  const upstream = createServer((request, response) => {
    upstreamCredentials.push({
      cookie: request.headers.cookie,
      authorization: request.headers.authorization,
      assertion: request.headers["x-forge-dev-proxy-assertion"] as
        | string
        | undefined,
      target: request.headers["x-forge-dev-proxy-target"] as string | undefined
    });
    if (typeof request.headers["x-forge-dev-proxy-assertion"] !== "string") {
      response.statusCode = 401;
      response.end("unauthorized");
      return;
    }
    response.setHeader("Content-Type", "text/plain");
    response.end(`proxied:${request.url ?? ""}`);
  });
  upstream.on("connection", (socket) => {
    upstreamSockets.add(`${socket.remoteAddress}:${socket.remotePort}`);
  });

  await new Promise<void>((resolve) => {
    upstream.listen(0, "127.0.0.1", resolve);
  });
  const address = upstream.address() as AddressInfo;
  const app = fastify();
  await registerWebRoutes(app, {
    devWebRuntime: {
      ensureReady: async () =>
        new URL(`http://127.0.0.1:${address.port}/forge/`),
      stop: async () => {}
    },
    issueDevProxyAssertion: (_request, target) => {
      issuedTargets.push(target);
      return `proxy-assertion-${issuedTargets.length}`;
    }
  });

  try {
    const first = await app.inject({
      method: "GET",
      url: "/forge/src/main.tsx",
      headers: {
        cookie: "forge_session=verified-browser"
      }
    });
    const second = await app.inject({
      method: "GET",
      url: "/forge/@vite/client",
      headers: {
        cookie: "forge_session=verified-browser",
        authorization: "Bearer browser-test-credential"
      }
    });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.match(first.body, /proxied:\/forge\/src\/main\.tsx/);
    assert.match(second.body, /proxied:\/forge\/@vite\/client/);
    assert.equal(upstreamSockets.size, 1);
    assert.deepEqual(upstreamCredentials, [
      {
        cookie: undefined,
        authorization: undefined,
        assertion: "proxy-assertion-1",
        target: "/forge/src/main.tsx"
      },
      {
        cookie: undefined,
        authorization: undefined,
        assertion: "proxy-assertion-2",
        target: "/forge/@vite/client"
      }
    ]);
    assert.deepEqual(issuedTargets, [
      "/forge/src/main.tsx",
      "/forge/@vite/client"
    ]);
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("built hashed assets bypass the dev proxy that cannot serve them", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "forge-built-assets-"));
  const assetDir = path.join(tempDir, "assets");
  const assetPath = path.join(assetDir, "overview-page-DWZlsulP.js");
  mkdirSync(assetDir, { recursive: true });
  writeFileSync(assetPath, "export const source = 'built';");
  let devProxyCalls = 0;
  const app = fastify();
  await registerWebRoutes(app, {
    devWebRuntime: {
      ensureReady: async () => new URL("http://127.0.0.1:3027/forge/"),
      stop: async () => {}
    },
    devAssetProxy: {
      fetch: async () => {
        devProxyCalls += 1;
        return "<!doctype html><title>Vite fallback</title>";
      },
      close: () => {}
    },
    resolveWebAssetLocation: async () => ({
      assetPath,
      clientDir: tempDir
    })
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/forge/assets/overview-page-DWZlsulP.js"
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, "export const source = 'built';");
    assert.match(response.headers["content-type"] ?? "", /javascript/);
    assert.equal(
      response.headers["cache-control"],
      "public, max-age=31536000, immutable"
    );
    assert.equal(devProxyCalls, 0);
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("missing built hashed assets return 404 instead of Vite HTML", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "forge-missing-assets-"));
  let devProxyCalls = 0;
  const app = fastify();
  await registerWebRoutes(app, {
    devWebRuntime: {
      ensureReady: async () => new URL("http://127.0.0.1:3027/forge/"),
      stop: async () => {}
    },
    devAssetProxy: {
      fetch: async () => {
        devProxyCalls += 1;
        return "<!doctype html><title>Vite fallback</title>";
      },
      close: () => {}
    },
    resolveWebAssetLocation: async (requestPath) => ({
      assetPath: path.join(tempDir, requestPath.replace(/^\/+/, "")),
      clientDir: tempDir
    })
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/forge/assets/retired-page-ABCDEFGH.js"
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "Asset not found");
    assert.doesNotMatch(
      response.headers["content-type"] ?? "",
      /text\/html/
    );
    assert.equal(devProxyCalls, 0);
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("an anonymous Vite rejection falls back to the public built shell", async () => {
  const app = fastify();
  await registerWebRoutes(app, {
    devWebRuntime: {
      ensureReady: async () => new URL("http://127.0.0.1:3027/forge/"),
      stop: async () => {}
    },
    fetchImpl: (async () =>
      new Response("development authorization required", {
        status: 401
      })) as typeof fetch
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/forge/"
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["x-forge-web-fallback"], "built");
    assert.equal(
      response.body.includes("development authorization required"),
      false
    );
    assert.match(response.body, /<!doctype html>/i);
  } finally {
    await app.close();
  }
});

test("missing frontend output during asset resolution returns the controlled 503", async () => {
  const app = fastify();
  await registerWebRoutes(app, {
    devWebRuntime: {
      ensureReady: async () => null,
      stop: async () => {}
    },
    resolveWebAssetLocation: async () => {
      throw new Error("frontend build was replaced during resolution");
    }
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/forge/"
    });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      code: "frontend_not_built",
      error:
        "Forge frontend build output is missing. Run the Vite build before serving the modern web client.",
      statusCode: 503
    });
  } finally {
    await app.close();
  }
});

test("missing sprite during asset resolution remains a 404", async () => {
  const app = fastify();
  await registerWebRoutes(app, {
    devWebRuntime: {
      ensureReady: async () => {
        throw new Error("sprite requests must not contact Vite");
      },
      stop: async () => {}
    },
    resolveWebAssetLocation: async () => {
      throw new Error("sprite not installed");
    }
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/forge/gamification/sprites/themes/missing/sprite.webp"
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), {
      error: "Asset not found"
    });
  } finally {
    await app.close();
  }
});

test("dev asset proxy forces the HTML entrypoint to no-store", async () => {
  const upstream = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache");
    response.end("<!doctype html><title>Forge</title>");
  });

  await new Promise<void>((resolve) => {
    upstream.listen(0, "127.0.0.1", resolve);
  });
  const address = upstream.address() as AddressInfo;
  const app = fastify();
  await registerWebRoutes(app, {
    devWebRuntime: {
      ensureReady: async () =>
        new URL(`http://127.0.0.1:${address.port}/forge/`),
      stop: async () => {}
    }
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/forge"
    });

    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers["cache-control"],
      "no-store, max-age=0, must-revalidate"
    );
    assert.equal(response.headers.pragma, "no-cache");
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("development-web upgrades require application authentication before contacting Vite", async () => {
  let readinessChecks = 0;
  let authorizationChecks = 0;
  const app = fastify();
  await registerWebRoutes(app, {
    devWebRuntime: {
      ensureReady: async () => {
        readinessChecks += 1;
        throw new Error("Vite must not be contacted for an anonymous upgrade.");
      },
      stop: async () => {}
    },
    authorizeUpgrade: async () => {
      authorizationChecks += 1;
      return null;
    },
    allowedOrigins: ["http://127.0.0.1:3027"]
  });
  await app.listen({ host: "127.0.0.1", port: 0 });

  try {
    const address = app.server.address() as AddressInfo;
    const upgradeStatus = (requestPath: string) =>
      new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          {
            host: "127.0.0.1",
            port: address.port,
            method: "GET",
            path: requestPath,
            headers: {
              connection: "Upgrade",
              upgrade: "websocket",
              origin: "http://127.0.0.1:3027",
              "sec-websocket-protocol": "vite-hmr"
            }
          },
          (response) => {
            response.resume();
            response.once("end", () => resolve(response.statusCode ?? 0));
          }
        );
        request.once("upgrade", () =>
          reject(new Error("Upgrade was admitted."))
        );
        request.once("error", reject);
        request.end();
      });
    assert.equal(await upgradeStatus("/forge/__vite_hmr"), 401);
    assert.equal(await upgradeStatus("/forge/__vite_hmr_unreviewed"), 404);
    assert.equal(authorizationChecks, 1);
    assert.equal(readinessChecks, 0);
  } finally {
    await app.close();
  }
});

test("authenticated same-origin HMR proxy replaces browser secrets with a one-time assertion", async () => {
  let upstreamHeaders:
    | {
        cookie: string | undefined;
        authorization: string | undefined;
        assertion: string | undefined;
        target: string | undefined;
        origin: string | undefined;
      }
    | undefined;
  const upstream = createServer();
  upstream.on("upgrade", (request, socket) => {
    upstreamHeaders = {
      cookie: request.headers.cookie,
      authorization: request.headers.authorization,
      assertion: request.headers["x-forge-dev-proxy-assertion"] as
        | string
        | undefined,
      target: request.headers["x-forge-dev-proxy-target"] as string | undefined,
      origin: request.headers.origin
    };
    socket.end(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"
    );
  });
  await new Promise<void>((resolve) => {
    upstream.listen(0, "127.0.0.1", resolve);
  });
  const upstreamAddress = upstream.address() as AddressInfo;

  const app = fastify();
  await registerWebRoutes(app, {
    devWebRuntime: {
      ensureReady: async () =>
        new URL(`http://127.0.0.1:${upstreamAddress.port}/forge/`),
      stop: async () => {}
    },
    authorizeUpgrade: async (_request, target) =>
      target === "/forge/__vite_hmr" ? "hmr-proxy-assertion" : null,
    allowedOrigins: []
  });
  await app.listen({ host: "127.0.0.1", port: 0 });

  try {
    const address = app.server.address() as AddressInfo;
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port: address.port,
        method: "GET",
        path: "/forge/__vite_hmr",
        headers: {
          authorization: "Bearer must-not-reach-vite",
          connection: "Upgrade",
          cookie: "forge_session=must-not-reach-vite",
          host: "forge.example.ts.net",
          origin: "https://forge.example.ts.net",
          "sec-websocket-protocol": "vite-hmr",
          upgrade: "websocket"
        }
      });
      request.once("upgrade", (response, socket) => {
        socket.destroy();
        resolve(response.statusCode ?? 0);
      });
      request.once("response", (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      });
      request.once("error", reject);
      request.end();
    });

    assert.equal(status, 101);
    assert.deepEqual(upstreamHeaders, {
      cookie: undefined,
      authorization: undefined,
      assertion: "hmr-proxy-assertion",
      target: "/forge/__vite_hmr",
      origin: "https://forge.example.ts.net"
    });
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("authenticated HMR proxy rejects a cross-origin websocket before authorization", async () => {
  let authorizationChecks = 0;
  const app = fastify();
  await registerWebRoutes(app, {
    devWebRuntime: {
      ensureReady: async () => {
        throw new Error("Vite must not be contacted cross-origin.");
      },
      stop: async () => {}
    },
    authorizeUpgrade: async () => {
      authorizationChecks += 1;
      return "must-not-be-issued";
    },
    allowedOrigins: []
  });
  await app.listen({ host: "127.0.0.1", port: 0 });

  try {
    const address = app.server.address() as AddressInfo;
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port: address.port,
        method: "GET",
        path: "/forge/__vite_hmr",
        headers: {
          connection: "Upgrade",
          host: "forge.example.ts.net",
          origin: "https://attacker.example",
          "sec-websocket-protocol": "vite-hmr",
          upgrade: "websocket"
        }
      });
      request.once("upgrade", (_response, socket) => {
        socket.destroy();
        reject(new Error("Cross-origin upgrade was admitted."));
      });
      request.once("response", (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      });
      request.once("error", reject);
      request.end();
    });

    assert.equal(status, 401);
    assert.equal(authorizationChecks, 0);
  } finally {
    await app.close();
  }
});
