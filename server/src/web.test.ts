import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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
