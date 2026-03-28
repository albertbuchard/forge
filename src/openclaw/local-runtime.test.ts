import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForgePluginConfig } from "./api-client";

async function listenOnPort(port: number) {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, () => resolve());
  });
  return server;
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
    const occupiedServer = await listenOnPort(4317);
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
        if (runtimeStarted && url.port === "4318" && url.pathname === "/api/v1/health") {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        throw new Error(`no healthy Forge runtime at ${url.toString()}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { ensureForgeRuntimeReady } = await import("./local-runtime");
      const config = createLocalConfig();

      await ensureForgeRuntimeReady(config);

      expect(config.port).toBe(4318);
      expect(config.baseUrl).toBe("http://127.0.0.1:4318");
      expect(config.webAppUrl).toBe("http://127.0.0.1:4318/forge/");
      expect(config.portSource).toBe("preferred");
      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(spawnMock.mock.calls[0]?.[2]).toEqual(
        expect.objectContaining({
          env: expect.objectContaining({
            PORT: "4318",
            HOST: "127.0.0.1"
          })
        })
      );

      const preferredPortState = JSON.parse(
        readFileSync(path.join(tempHome, ".openclaw", "run", "forge-openclaw-plugin", "127.0.0.1-preferred-port.json"), "utf8")
      ) as { port: number };
      expect(preferredPortState.port).toBe(4318);
    } finally {
      await new Promise<void>((resolve, reject) => occupiedServer.close((error) => (error ? reject(error) : resolve())));
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("fails clearly when an explicitly configured local port is occupied", async () => {
    const tempHome = mkdtempSync(path.join(tmpdir(), "forge-runtime-home-"));
    vi.stubEnv("HOME", tempHome);
    const occupiedServer = await listenOnPort(4317);
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
      const config = createLocalConfig({ portSource: "configured" });

      await expect(ensureForgeRuntimeReady(config)).rejects.toThrow("Configured Forge port 4317 is already in use");
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => occupiedServer.close((error) => (error ? reject(error) : resolve())));
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
