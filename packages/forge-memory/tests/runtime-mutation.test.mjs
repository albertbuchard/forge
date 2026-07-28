import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempHome = await fsp.mkdtemp(
  path.join(os.tmpdir(), "forge-memory-runtime-mutation-")
);
process.env.NODE_ENV = "test";
process.env.FORGE_MEMORY_TEST_IMPORT = "1";
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const { __forgeMemoryRuntimeMutationTest: runtime } = await import(
  `${new URL("../bin/forge-memory.mjs", import.meta.url).href}?runtime-mutation=${Date.now()}`
);
const packageVersion = JSON.parse(
  await fsp.readFile(new URL("../package.json", import.meta.url), "utf8")
).version;

const config = {
  mode: "packaged",
  origin: "http://127.0.0.1",
  port: 43991,
  webPort: 43992,
  dataRoot: path.join(tempHome, "data"),
  canonicalExternalOrigin: null,
  peerEnabled: false,
  peerIrohEnabled: false,
  peerDirectEndpoints: [],
  peerAllowLoopbackDirect: false
};

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessIdentity(pid) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const identity = runtime.captureProcessIdentity(pid);
    if (identity) return identity;
    await delay(25);
  }
  throw new Error(`Could not capture process identity for ${pid}`);
}

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return;
    await delay(25);
  }
  throw new Error(`Process ${pid} did not exit`);
}

async function resetRuntimeFiles() {
  await fsp.rm(runtime.runtimeStartLockPath(), {
    recursive: true,
    force: true
  });
  await fsp.rm(runtime.runtimeStatePath(), { force: true });
}

function protectedHealth(
  pid,
  version = packageVersion,
  storageRoot = config.dataRoot
) {
  return {
    ok: true,
    forge: true,
    status: 200,
    payload: {
      app: "forge",
      backend: "forge-node-runtime",
      runtime: {
        pid,
        packageName: "forge-openclaw-plugin",
        packageVersion: version,
        storageRoot
      }
    }
  };
}

test("a live lock owner cannot be bypassed or reaped because the lock is old", async () => {
  await resetRuntimeFiles();
  const firstRelease = await runtime.acquireRuntimeStartLock(config, 1_000);
  const old = new Date(Date.now() - 5 * 60_000);
  await fsp.utimes(runtime.runtimeStartLockPath(), old, old);

  let secondSettled = false;
  const second = runtime
    .acquireRuntimeStartLock(config, 2_000)
    .then((release) => {
      secondSettled = true;
      return release;
    });
  await delay(200);
  assert.equal(secondSettled, false);
  assert.equal(fs.existsSync(runtime.runtimeStartLockOwnerPath()), true);

  await firstRelease();
  const secondRelease = await second;
  assert.equal(secondSettled, true);
  await secondRelease();
});

test("a lock whose recorded owner is dead is reaped safely", async () => {
  await resetRuntimeFiles();
  await fsp.mkdir(runtime.runtimeStartLockPath(), {
    recursive: true,
    mode: 0o700
  });
  await fsp.writeFile(
    runtime.runtimeStartLockOwnerPath(),
    `${JSON.stringify({
      pid: 2_147_483_000,
      identity: "a".repeat(64),
      token: "b".repeat(64),
      acquiredAt: new Date(0).toISOString()
    })}\n`,
    { encoding: "utf8", mode: 0o600 }
  );

  const release = await runtime.acquireRuntimeStartLock(config, 1_000);
  const owner = JSON.parse(
    await fsp.readFile(runtime.runtimeStartLockOwnerPath(), "utf8")
  );
  assert.equal(owner.pid, process.pid);
  assert.notEqual(owner.token, "b".repeat(64));
  await release();
});

test("a stale reaper cannot remove a replacement lock owner", async () => {
  await resetRuntimeFiles();
  const release = await runtime.acquireRuntimeStartLock(config, 1_000);
  const reaped = await runtime.reapAbandonedRuntimeStartLock(
    runtime.runtimeStartLockPath(),
    {
      pid: 2_147_483_000,
      identity: "a".repeat(64),
      token: "b".repeat(64)
    }
  );
  assert.equal(reaped, false);
  assert.equal(fs.existsSync(runtime.runtimeStartLockOwnerPath()), true);
  await release();
});

test("stop waits for the runtime mutation lock before touching state or processes", async () => {
  await resetRuntimeFiles();
  const child = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { detached: true, stdio: "ignore" }
  );
  child.unref();
  try {
    const identity = await waitForProcessIdentity(child.pid);
    await fsp.mkdir(path.dirname(runtime.runtimeStatePath()), {
      recursive: true
    });
    await fsp.writeFile(
      runtime.runtimeStatePath(),
      `${JSON.stringify({
        mode: "packaged",
        children: [{ role: "server", pid: child.pid, identity }]
      })}\n`
    );

    const release = await runtime.acquireRuntimeStartLock(config, 1_000);
    let stopSettled = false;
    const stopping = runtime.stopRuntime(config).then((result) => {
      stopSettled = true;
      return result;
    });
    await delay(200);
    assert.equal(stopSettled, false);
    assert.equal(processExists(child.pid), true);
    assert.equal(fs.existsSync(runtime.runtimeStatePath()), true);

    await release();
    const result = await stopping;
    assert.equal(result.stopped, true);
    assert.deepEqual(result.pids, [child.pid]);
    await waitForProcessExit(child.pid);
    assert.equal(fs.existsSync(runtime.runtimeStatePath()), false);
  } finally {
    if (processExists(child.pid)) {
      try {
        if (process.platform === "win32") process.kill(child.pid, "SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        // Best-effort test cleanup.
      }
    }
  }
});

test("restart holds one mutation lock across stop and start", async () => {
  await resetRuntimeFiles();
  const outerRelease = await runtime.acquireRuntimeStartLock(config, 1_000);
  const events = [];
  let restartSettled = false;
  const restarting = runtime
    .restartRuntime(config, {
      stopImplementation: async (_config, options) => {
        assert.equal(options.runtimeMutationLockHeld, true);
        assert.equal(fs.existsSync(runtime.runtimeStartLockOwnerPath()), true);
        events.push("stop");
        return { ok: true, stopped: true };
      },
      startImplementation: async (_config, options) => {
        assert.equal(options.runtimeMutationLockHeld, true);
        assert.equal(fs.existsSync(runtime.runtimeStartLockOwnerPath()), true);
        events.push("start");
        return { ok: true, started: true };
      }
    })
    .then((result) => {
      restartSettled = true;
      return result;
    });
  await delay(200);
  assert.equal(restartSettled, false);
  assert.deepEqual(events, []);

  await outerRelease();
  const result = await restarting;
  assert.deepEqual(events, ["stop", "start"]);
  assert.equal(result.ok, true);
  assert.equal(result.stop.stopped, true);
});

test("two config writers cannot split persisted settings from the runtime they start", async () => {
  await resetRuntimeFiles();
  let persistedConfig = { ...config };
  let runtimePort = config.port;
  const events = [];
  let releaseFirstRuntime;
  const firstRuntimeBlocked = new Promise((resolve) => {
    releaseFirstRuntime = resolve;
  });
  let firstRuntimeEntered;
  const firstRuntimeReady = new Promise((resolve) => {
    firstRuntimeEntered = resolve;
  });

  const apply = (label, port, blockRuntime = false) =>
    runtime.applyRuntimeConfigTransaction(
      {
        lockConfig: config,
        resolveConfig: async (latestConfig) => ({
          ...latestConfig,
          port
        }),
        runtimeMutation: async ({
          config: nextConfig,
          runtimeMutationLockHeld
        }) => {
          assert.equal(runtimeMutationLockHeld, true);
          events.push(`runtime:${label}:enter`);
          if (blockRuntime) {
            firstRuntimeEntered();
            await firstRuntimeBlocked;
          }
          runtimePort = nextConfig.port;
          events.push(`runtime:${label}:done`);
          return { ok: true, started: true };
        }
      },
      {
        readConfig: async () => ({ ...persistedConfig }),
        writeConfig: async (nextConfig) => {
          persistedConfig = { ...nextConfig };
          events.push(`write:${label}`);
          return { ok: true };
        }
      }
    );

  const first = apply("first", 44_001, true);
  await firstRuntimeReady;
  const second = apply("second", 44_002);
  await delay(200);
  assert.deepEqual(events, ["write:first", "runtime:first:enter"]);
  assert.equal(persistedConfig.port, 44_001);
  assert.equal(runtimePort, config.port);

  releaseFirstRuntime();
  await Promise.all([first, second]);
  assert.deepEqual(events, [
    "write:first",
    "runtime:first:enter",
    "runtime:first:done",
    "write:second",
    "runtime:second:enter",
    "runtime:second:done"
  ]);
  assert.equal(persistedConfig.port, 44_002);
  assert.equal(runtimePort, 44_002);
});

test("runtime ownership is written only after protected health proves the candidate PID", async () => {
  const candidate = {
    children: [
      { role: "server", pid: 101, identity: "c".repeat(64) }
    ]
  };
  const events = [];
  const result = await runtime.finalizeStartedRuntimeAttempt(
    {
      config,
      peerPreparation: {},
      state: candidate,
      publicHealth: { ok: true, forge: true }
    },
    {
      authenticatedHealth: async () => {
        events.push("authenticated");
        return protectedHealth(101);
      },
      ownsHealthProcess: (state, health) =>
        state === candidate && health.payload.runtime.pid === 101,
      stopChildren: async () => {
        throw new Error("owned candidate must not be cleaned up");
      },
      readState: async () => null,
      writeState: async (state) => {
        events.push("write");
        assert.equal(state, candidate);
      }
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.started, true);
  assert.deepEqual(events, ["authenticated", "write"]);
});

test("a cleanup survivor prevents adoption and no ownership is written", async () => {
  const survivor = {
    role: "server",
    pid: 202,
    identity: "d".repeat(64)
  };
  let writes = 0;
  let authentications = 0;
  const result = await runtime.finalizeStartedRuntimeAttempt(
    {
      config,
      peerPreparation: {},
      state: { children: [survivor] },
      publicHealth: { ok: true, forge: true }
    },
    {
      authenticatedHealth: async () => {
        authentications += 1;
        return protectedHealth(303);
      },
      ownsHealthProcess: () => false,
      stopChildren: async () => ({
        ok: false,
        stopped: [],
        survivors: [survivor]
      }),
      readState: async () => null,
      writeState: async () => {
        writes += 1;
      }
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.cleanupFailed, true);
  assert.deepEqual(result.survivingCandidatePids, [202]);
  assert.equal(authentications, 1);
  assert.equal(writes, 0);
});

test("a race winner must pass package and peer adoption gates", async () => {
  const candidate = {
    children: [
      { role: "server", pid: 404, identity: "e".repeat(64) }
    ]
  };
  const baseDependencies = {
    ownsHealthProcess: () => false,
    stopChildren: async () => ({ ok: true, stopped: [404], survivors: [] }),
    readState: async () => null,
    writeState: async () => {
      throw new Error("a race loser must not write managed state");
    }
  };

  const stalePackage = await runtime.finalizeStartedRuntimeAttempt(
    {
      config,
      peerPreparation: {},
      state: candidate,
      publicHealth: { ok: true, forge: true }
    },
    {
      ...baseDependencies,
      authenticatedHealth: async () => protectedHealth(505, "0.0.0-stale")
    }
  );
  assert.equal(stalePackage.ok, false);
  assert.equal(stalePackage.runtimeVersionMismatch, true);

  const peerEnabledConfig = {
    ...config,
    peerEnabled: true,
    peerIrohEnabled: true
  };
  const unknownPeerSettings = await runtime.finalizeStartedRuntimeAttempt(
    {
      config: peerEnabledConfig,
      peerPreparation: {},
      state: candidate,
      publicHealth: { ok: true, forge: true }
    },
    {
      ...baseDependencies,
      authenticatedHealth: async () => protectedHealth(606)
    }
  );
  assert.equal(unknownPeerSettings.ok, false);
  assert.equal(unknownPeerSettings.configurationMismatch, true);

  const unknownOwner = await runtime.finalizeStartedRuntimeAttempt(
    {
      config,
      peerPreparation: {},
      state: candidate,
      publicHealth: { ok: true, forge: true }
    },
    {
      ...baseDependencies,
      authenticatedHealth: async () => protectedHealth(707)
    }
  );
  assert.equal(unknownOwner.ok, false);
  assert.equal(unknownOwner.runtimeOwnershipUnknown, true);
});

test("adoption rejects missing package identity and a mismatched protected storage root", async () => {
  const missingIdentity = protectedHealth(808);
  delete missingIdentity.payload.runtime.packageName;
  delete missingIdentity.payload.runtime.packageVersion;
  const missingIdentityResult = runtime.runtimeAdoptionFailure(
    config,
    null,
    missingIdentity
  );
  assert.equal(missingIdentityResult.ok, false);
  assert.equal(missingIdentityResult.runtimeVersionMismatch, true);

  const mismatchedStorageResult = runtime.runtimeAdoptionFailure(
    config,
    null,
    protectedHealth(909, packageVersion, path.join(tempHome, "other-data"))
  );
  assert.equal(mismatchedStorageResult.ok, false);
  assert.equal(mismatchedStorageResult.storageRootMismatch, true);
  assert.equal(
    mismatchedStorageResult.expectedStorageRoot,
    path.resolve(config.dataRoot)
  );
});

test("a post-stop responder is never adopted without protected owned state", async () => {
  const candidate = {
    children: [
      { role: "server", pid: 1_010, identity: "f".repeat(64) }
    ]
  };
  let authentications = 0;
  let publicReads = 0;
  const result = await runtime.finalizeStartedRuntimeAttempt(
    {
      config,
      peerPreparation: {},
      state: candidate,
      publicHealth: { ok: true, forge: true }
    },
    {
      authenticatedHealth: async () => {
        authentications += 1;
        return protectedHealth(authentications === 1 ? 1_111 : 1_212);
      },
      ownsHealthProcess: () => false,
      stopChildren: async () => ({
        ok: true,
        stopped: [candidate.children[0].pid],
        survivors: []
      }),
      readState: async () => null,
      readPublicHealth: async () => {
        publicReads += 1;
        return { ok: true, forge: true };
      },
      writeState: async () => {
        throw new Error("a post-stop responder must never be recorded");
      }
    }
  );
  assert.equal(authentications, 2);
  assert.equal(publicReads, 0);
  assert.equal(result.ok, false);
  assert.equal(result.runtimeOwnershipUnknown, true);
  assert.equal(result.health.payload.runtime.pid, 1_212);
});

test.after(async () => {
  await resetRuntimeFiles();
  await fsp.rm(tempHome, { recursive: true, force: true });
});
