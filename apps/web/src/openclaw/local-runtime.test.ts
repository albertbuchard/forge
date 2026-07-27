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
    injectBootstrapContext: true,
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
        if (runtimeStarted && url.port === String(nextPort) && url.pathname === "/api/health") {
          return new Response(JSON.stringify({
            ok: true,
            app: "forge",
            security: "credential-required"
          }), {
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

  it("waits for another process startup lease instead of spawning a competing runtime", async () => {
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

      const { mkdirSync, writeFileSync } = await import("node:fs");
      const stateDir = path.join(
        tempHome,
        ".openclaw",
        "run",
        "forge-openclaw-plugin"
      );
      const lockPath = path.join(stateDir, "127.0.0.1-4317.startup.lock");
      mkdirSync(lockPath, { recursive: true });
      writeFileSync(
        path.join(lockPath, "owner.json"),
        `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`
      );

      let probeCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          probeCount += 1;
          if (probeCount < 3) {
            throw new Error("runtime is still starting");
          }
          return new Response(
            JSON.stringify({
              ok: true,
              app: "forge",
              security: "credential-required",
              runtime: {
                pid: process.pid,
                storageRoot: "/tmp/shared-forge-root",
                basePath: "/forge/"
              }
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" }
            }
          );
        })
      );

      const { ensureForgeRuntimeReady } = await import("./local-runtime");
      await ensureForgeRuntimeReady(
        createLocalConfig({
          dataRoot: "/tmp/shared-forge-root",
          portSource: "configured"
        })
      );

      expect(spawnMock).not.toHaveBeenCalled();
      expect(probeCount).toBeGreaterThanOrEqual(3);
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("attaches to secured liveness without making an unauthenticated data-root decision", async () => {
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
              app: "forge",
              security: "credential-required",
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

      await expect(ensureForgeRuntimeReady(config)).resolves.toBeUndefined();
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("does not adopt an attached healthy runtime as manager-owned", async () => {
    const tempHome = mkdtempSync(path.join(tmpdir(), "forge-runtime-home-"));
    vi.stubEnv("HOME", tempHome);
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              ok: true,
              app: "forge",
              security: "credential-required",
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
      const { existsSync } = await import("node:fs");
      expect(existsSync(runtimeStatePath)).toBe(false);
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("never signals a saved alternate PID while attaching to a healthy runtime", async () => {
    const tempHome = mkdtempSync(path.join(tmpdir(), "forge-runtime-home-"));
    vi.stubEnv("HOME", tempHome);
    try {
      const stalePid = 987654;
      let stalePidAlive = true;
      const killSpy = vi.spyOn(process, "kill").mockImplementation((pid: number, signal?: string | number) => {
        if (pid !== stalePid) {
          return true;
        }
        if (signal === 0 || signal === undefined) {
          if (!stalePidAlive) {
            const error = Object.assign(new Error("stale process gone"), { code: "ESRCH" });
            throw error;
          }
          return true;
        }
        stalePidAlive = false;
        return true;
      });

      const stateDir = path.join(tempHome, ".openclaw", "run", "forge-openclaw-plugin");
      const staleStatePath = path.join(stateDir, "127.0.0.1-4318.json");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
          if (url.pathname !== "/api/health") {
            throw new Error(`unexpected probe ${url.toString()}`);
          }
          return new Response(
            JSON.stringify({
              ok: true,
              app: "forge",
              security: "credential-required",
              runtime: {
                pid: url.port === "4317" ? process.pid : stalePid,
                storageRoot: "/tmp/shared-forge-root",
                basePath: "/forge/"
              }
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" }
            }
          );
        })
      );

      const { mkdirSync, writeFileSync, existsSync } = await import("node:fs");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(
        staleStatePath,
        `${JSON.stringify(
          {
            pid: stalePid,
            origin: "http://127.0.0.1",
            port: 4318,
            baseUrl: "http://127.0.0.1:4318",
            startedAt: new Date().toISOString(),
            logPath: null
          },
          null,
          2
        )}\n`
      );

      const { ensureForgeRuntimeReady } = await import("./local-runtime");
      const config = createLocalConfig({
        dataRoot: "/tmp/shared-forge-root",
        portSource: "configured"
      });

      await ensureForgeRuntimeReady(config);

      expect(killSpy).not.toHaveBeenCalledWith(stalePid, "SIGTERM");
      expect(killSpy).not.toHaveBeenCalledWith(stalePid, "SIGKILL");
      expect(existsSync(staleStatePath)).toBe(true);
      expect(config.port).toBe(4317);
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
            return new Response(JSON.stringify({
              ok: true,
              app: "forge",
              security: "credential-required"
            }), {
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
