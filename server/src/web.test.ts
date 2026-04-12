import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createManagedDevWebRuntime } from "./web.js";

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
  mkdirSync(path.join(tempDir, "node_modules", "vite", "bin"), { recursive: true });
  writeFileSync(path.join(tempDir, "node_modules", "vite", "bin", "vite.js"), "");

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
      spawnImpl: ((command: string, argsOrOptions?: string[] | object, maybeOptions?: object) => {
        const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
        const options = (Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions) as {
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
    assert.equal(spawnCalls[0]?.args[0], path.join(tempDir, "node_modules", "vite", "bin", "vite.js"));
    assert.deepEqual(spawnCalls[0]?.args.slice(1), ["--host", "127.0.0.1", "--port", "3027"]);
    assert.equal(spawnCalls[0]?.env?.FORGE_BASE_PATH, "/forge/");
    await runtime.stop();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
