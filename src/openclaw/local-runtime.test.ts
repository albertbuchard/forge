import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForgePluginConfig } from "./api-client";

function installNetMock(occupiedPorts: number[]) {
  const occupied = new Set(occupiedPorts);
  vi.doMock("node:net", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:net")>();
    const createServer = () => {
      let errorHandler: ((error: NodeJS.ErrnoException) => void) | null = null;
      return {
        unref: vi.fn(),
        once(event: string, handler: (error: NodeJS.ErrnoException) => void) {
          if (event === "error") {
            errorHandler = handler;
          }
          return this;
        },
        listen(
          options: { host?: string; port?: number; exclusive?: boolean },
          callback?: () => void
        ) {
          const port = options.port ?? 0;
          if (occupied.has(port)) {
            errorHandler?.(
              Object.assign(new Error(`port ${port} in use`), {
                code: "EADDRINUSE"
              })
            );
            return this;
          }
          callback?.();
          return this;
        },
        close(callback?: () => void) {
          callback?.();
          return this;
        }
      };
    };
    return {
      ...actual,
      createServer,
      default: {
        ...("default" in actual && actual.default ? actual.default : {}),
        createServer
      }
    };
  });
}

function createLocalConfig(overrides: Partial<ForgePluginConfig> = {}): ForgePluginConfig {
  return {
    origin: "http://127.0.0.1",
    port: 4317,
    baseUrl: "http://127.0.0.1:4317",
    webAppUrl: "http://127.0.0.1:4317/forge/",
    portSource: "default",
    dataRoot: "",
    apiToken: "",
    actorLabel: "aurel",
    timeoutMs: 15_000,
    ...overrides
  };
}

describe("forge local runtime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("auto-picks the next free localhost port when the default port is occupied", async () => {
    const tempHome = mkdtempSync(path.join(tmpdir(), "forge-runtime-home-"));
    vi.stubEnv("HOME", tempHome);
    const occupiedPort = 46001;
    const nextPort = 46002;
    installNetMock([occupiedPort]);
    try {
      let runtimeStarted = false;
      const fakeChild = {
        pid: 54231,
        killed: false,
        unref: vi.fn(),
        once: vi.fn().mockReturnThis()
      };
      const spawnMock = vi.fn().mockImplementation(() => {
        runtimeStarted = true;
        return fakeChild;
      });
      vi.doMock("node:child_process", async (importOriginal) => {
        const actual = await importOriginal<typeof import("node:child_process")>();
        return {
          ...actual,
          spawn: spawnMock,
          default: {
            ...("default" in actual && actual.default ? actual.default : {}),
            spawn: spawnMock
          }
        };
      });

      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
        if (runtimeStarted && url.port === String(nextPort) && url.pathname === "/api/v1/health") {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        throw new Error(`no healthy Forge runtime at ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { ensureForgeRuntimeReady } = await import("./local-runtime");
      const config = createLocalConfig({
        port: occupiedPort,
        baseUrl: `http://127.0.0.1:${occupiedPort}`,
        webAppUrl: `http://127.0.0.1:${occupiedPort}/forge/`
      });

      await ensureForgeRuntimeReady(config);

      expect(config.port).toBe(nextPort);
      expect(config.baseUrl).toBe(`http://127.0.0.1:${nextPort}`);
      expect(config.webAppUrl).toBe(`http://127.0.0.1:${nextPort}/forge/`);
      expect(config.portSource).toBe("preferred");
      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(spawnMock.mock.calls[0]?.[2]).toEqual(
        expect.objectContaining({
          env: expect.objectContaining({
            PORT: String(nextPort),
            HOST: "127.0.0.1"
          })
        })
      );

      const preferredPortState = JSON.parse(
        readFileSync(path.join(tempHome, ".openclaw", "run", "forge-openclaw-plugin", "127.0.0.1-preferred-port.json"), "utf8")
      ) as { port: number };
      expect(preferredPortState.port).toBe(nextPort);
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("fails clearly when an explicitly configured local port is occupied", async () => {
    const tempHome = mkdtempSync(path.join(tmpdir(), "forge-runtime-home-"));
    vi.stubEnv("HOME", tempHome);
    const occupiedPort = 46011;
    installNetMock([occupiedPort]);
    try {
      const spawnMock = vi.fn();
      vi.doMock("node:child_process", async (importOriginal) => {
        const actual = await importOriginal<typeof import("node:child_process")>();
        return {
          ...actual,
          spawn: spawnMock,
          default: {
            ...("default" in actual && actual.default ? actual.default : {}),
            spawn: spawnMock
          }
        };
      });

      vi.stubGlobal("fetch", vi.fn(async () => {
        throw new Error("port occupied by a different process");
      }));

      const { ensureForgeRuntimeReady } = await import("./local-runtime");
      const config = createLocalConfig({
        port: occupiedPort,
        baseUrl: `http://127.0.0.1:${occupiedPort}`,
        webAppUrl: `http://127.0.0.1:${occupiedPort}/forge/`,
        portSource: "configured"
      });

      await expect(ensureForgeRuntimeReady(config)).rejects.toThrow(
        `Configured Forge port ${occupiedPort} is already in use`
      );
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("rejects a healthy runtime when the configured dataRoot does not match", async () => {
    const tempHome = mkdtempSync(path.join(tmpdir(), "forge-runtime-home-"));
    vi.stubEnv("HOME", tempHome);
    try {
      const spawnMock = vi.fn();
      vi.doMock("node:child_process", async (importOriginal) => {
        const actual = await importOriginal<typeof import("node:child_process")>();
        return {
          ...actual,
          spawn: spawnMock,
          default: {
            ...("default" in actual && actual.default ? actual.default : {}),
            spawn: spawnMock
          }
        };
      });

      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              ok: true,
              runtime: {
                storageRoot: "/tmp/other-forge-root",
                basePath: "/forge/"
              }
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" }
            }
          )
        )
      );

      const { ensureForgeRuntimeReady } = await import("./local-runtime");
      const config = createLocalConfig({
        dataRoot: "/tmp/expected-forge-root",
        portSource: "configured"
      });

      await expect(ensureForgeRuntimeReady(config)).rejects.toThrow("The OpenClaw plugin is configured to use /tmp/expected-forge-root");
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("adopts a healthy runtime on the configured dataRoot so restart can manage it later", async () => {
    const tempHome = mkdtempSync(path.join(tmpdir(), "forge-runtime-home-"));
    vi.stubEnv("HOME", tempHome);
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              ok: true,
              runtime: {
                pid: process.pid,
                storageRoot: "/tmp/adopted-forge-root",
                basePath: "/forge/"
              }
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" }
            }
          )
        )
      );

      const { ensureForgeRuntimeReady } = await import("./local-runtime");
      const config = createLocalConfig({
        dataRoot: "/tmp/adopted-forge-root",
        portSource: "configured"
      });

      await ensureForgeRuntimeReady(config);

      const runtimeStatePath = path.join(tempHome, ".openclaw", "run", "forge-openclaw-plugin", "127.0.0.1-4317.json");
      const runtimeState = JSON.parse(readFileSync(runtimeStatePath, "utf8")) as { pid: number };
      expect(runtimeState.pid).toBe(process.pid);
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("enables managed dev web supervision for local dev runtimes", async () => {
    const tempHome = mkdtempSync(path.join(tmpdir(), "forge-runtime-home-"));
    vi.stubEnv("HOME", tempHome);
    vi.stubEnv("FORGE_OPENCLAW_DEV", "1");
    try {
      let runtimeStarted = false;
      const fakeChild = {
        pid: 61234,
        killed: false,
        unref: vi.fn(),
        once: vi.fn().mockReturnThis()
      };
      const spawnMock = vi.fn().mockImplementation(() => {
        runtimeStarted = true;
        return fakeChild;
      });
      vi.doMock("node:child_process", async (importOriginal) => {
        const actual = await importOriginal<typeof import("node:child_process")>();
        return {
          ...actual,
          spawn: spawnMock,
          default: {
            ...("default" in actual && actual.default ? actual.default : {}),
            spawn: spawnMock
          }
        };
      });

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (runtimeStarted) {
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { "content-type": "application/json" }
            });
          }
          throw new Error("Forge runtime unavailable");
        })
      );

      const { ensureForgeRuntimeReady } = await import("./local-runtime");
      const config = createLocalConfig();

      await ensureForgeRuntimeReady(config);

      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(spawnMock.mock.calls[0]?.[2]).toEqual(
        expect.objectContaining({
          env: expect.objectContaining({
            FORGE_DEV_WEB_ORIGIN: "http://127.0.0.1:3027/forge/",
            FORGE_BASE_PATH: "/forge/",
            PORT: "4317"
          })
        })
      );
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
