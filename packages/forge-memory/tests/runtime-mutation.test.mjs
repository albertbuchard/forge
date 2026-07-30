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
  await fsp.rm(runtime.openClawRuntimeStartupLockPath(config), {
    recursive: true,
    force: true
  });
  await fsp.rm(runtime.openClawRuntimeStatePath(config), {
    force: true
  });
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

test("Forge Memory renews its OpenClaw compatibility lease before the legacy lifetime", async () => {
  await resetRuntimeFiles();
  const lease = await runtime.acquireOpenClawRuntimeStartupLease(config, {
    timeoutMs: 200,
    refreshMs: 10,
    waitMs: 5
  });
  const ownerPath =
    runtime.openClawRuntimeStartupLockOwnerPath(config);
  const first = JSON.parse(await fsp.readFile(ownerPath, "utf8"));
  for (let index = 0; index < 80; index += 1) {
    await delay(1);
    const concurrentRead = JSON.parse(
      await fsp.readFile(ownerPath, "utf8")
    );
    assert.equal(concurrentRead.token, first.token);
  }
  const refreshed = JSON.parse(await fsp.readFile(ownerPath, "utf8"));
  assert.equal(refreshed.pid, process.pid);
  assert.equal(refreshed.token, first.token);
  assert.ok(
    Date.parse(refreshed.acquiredAt) > Date.parse(first.acquiredAt)
  );
  assert.ok(Date.now() - Date.parse(refreshed.acquiredAt) < 30);
  await lease.assertOwned();
  await lease.release();
  assert.equal(
    fs.existsSync(runtime.openClawRuntimeStartupLockPath(config)),
    false
  );
});

test("Windows retries a shared lease-owner rename and rechecks ownership", async () => {
  let reads = 0;
  let renames = 0;
  const waits = [];
  const result = await runtime.replaceOpenClawLeaseOwnerFile({
    temporaryPath: "temporary-owner.json",
    ownerPath: "owner.json",
    expectedToken: "owned-token",
    platform: "win32",
    readOwner: async () => {
      reads += 1;
      return { token: "owned-token" };
    },
    rename: async () => {
      renames += 1;
      if (renames === 1) {
        throw Object.assign(new Error("sharing violation"), {
          code: "EPERM"
        });
      }
    },
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
    maxAttempts: 3,
    retryDelayMs: 7
  });
  assert.equal(result, true);
  assert.equal(reads, 2);
  assert.equal(renames, 2);
  assert.deepEqual(waits, [7]);
});

test("Windows never overwrites a replacement lease owner during retry", async () => {
  let reads = 0;
  let renames = 0;
  const result = await runtime.replaceOpenClawLeaseOwnerFile({
    temporaryPath: "temporary-owner.json",
    ownerPath: "owner.json",
    expectedToken: "owned-token",
    platform: "win32",
    readOwner: async () => {
      reads += 1;
      return {
        token: reads === 1 ? "owned-token" : "replacement-token"
      };
    },
    rename: async () => {
      renames += 1;
      throw Object.assign(new Error("sharing violation"), {
        code: "EACCES"
      });
    },
    wait: async () => {},
    maxAttempts: 3,
    retryDelayMs: 1
  });
  assert.equal(result, false);
  assert.equal(reads, 2);
  assert.equal(renames, 1);
});

test("Windows does not retry a non-sharing lease-owner failure", async () => {
  let renames = 0;
  let waits = 0;
  await assert.rejects(
    runtime.replaceOpenClawLeaseOwnerFile({
      temporaryPath: "temporary-owner.json",
      ownerPath: "owner.json",
      expectedToken: "owned-token",
      platform: "win32",
      readOwner: async () => ({ token: "owned-token" }),
      rename: async () => {
        renames += 1;
        throw Object.assign(new Error("invalid path"), {
          code: "EINVAL"
        });
      },
      wait: async () => {
        waits += 1;
      },
      maxAttempts: 3,
      retryDelayMs: 1
    }),
    /invalid path/
  );
  assert.equal(renames, 1);
  assert.equal(waits, 0);
});

test("Windows bounds repeated lease-owner sharing violations", async () => {
  let reads = 0;
  let renames = 0;
  let waits = 0;
  await assert.rejects(
    runtime.replaceOpenClawLeaseOwnerFile({
      temporaryPath: "temporary-owner.json",
      ownerPath: "owner.json",
      expectedToken: "owned-token",
      platform: "win32",
      readOwner: async () => {
        reads += 1;
        return { token: "owned-token" };
      },
      rename: async () => {
        renames += 1;
        throw Object.assign(new Error("busy owner file"), {
          code: "EBUSY"
        });
      },
      wait: async () => {
        waits += 1;
      },
      maxAttempts: 3,
      retryDelayMs: 1
    }),
    /busy owner file/
  );
  assert.equal(reads, 3);
  assert.equal(renames, 3);
  assert.equal(waits, 2);
});

test("Forge Memory never removes a live or ambiguous foreign OpenClaw lease", async () => {
  await resetRuntimeFiles();
  const lockPath = runtime.openClawRuntimeStartupLockPath(config);
  const ownerPath =
    runtime.openClawRuntimeStartupLockOwnerPath(config);
  await fsp.mkdir(lockPath, { recursive: true, mode: 0o700 });
  const foreign = {
    pid: process.pid,
    acquiredAt: new Date(0).toISOString()
  };
  await fsp.writeFile(
    ownerPath,
    `${JSON.stringify(foreign)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  await assert.rejects(
    runtime.acquireOpenClawRuntimeStartupLease(config, {
      timeoutMs: 50,
      refreshMs: 10,
      waitMs: 5
    }),
    /timed out waiting for OpenClaw/
  );
  assert.deepEqual(
    JSON.parse(await fsp.readFile(ownerPath, "utf8")),
    foreign
  );
});

test("OpenClaw compatibility release cannot remove a replacement owner", async () => {
  await resetRuntimeFiles();
  const lease = await runtime.acquireOpenClawRuntimeStartupLease(config, {
    timeoutMs: 200,
    refreshMs: 10,
    waitMs: 5
  });
  const ownerPath =
    runtime.openClawRuntimeStartupLockOwnerPath(config);
  const replacement = {
    pid: process.pid,
    token: "f".repeat(64),
    acquiredAt: new Date().toISOString()
  };
  await fsp.writeFile(
    ownerPath,
    `${JSON.stringify(replacement)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  await lease.release();
  assert.equal(
    fs.existsSync(runtime.openClawRuntimeStartupLockPath(config)),
    true
  );
  assert.deepEqual(
    JSON.parse(await fsp.readFile(ownerPath, "utf8")),
    replacement
  );
});

test("a failed runtime mutation releases both manager locks", async () => {
  await resetRuntimeFiles();
  await assert.rejects(
    runtime.withRuntimeMutationLock(config, async () => {
      assert.equal(
        fs.existsSync(runtime.runtimeStartLockOwnerPath()),
        true
      );
      assert.equal(
        fs.existsSync(
          runtime.openClawRuntimeStartupLockOwnerPath(config)
        ),
        true
      );
      throw new Error("bounded test failure");
    }),
    /bounded test failure/
  );
  assert.equal(fs.existsSync(runtime.runtimeStartLockPath()), false);
  assert.equal(
    fs.existsSync(runtime.openClawRuntimeStartupLockPath(config)),
    false
  );
});

test("a remote runtime mutation does not touch OpenClaw loopback state", async () => {
  await resetRuntimeFiles();
  const remote = {
    ...config,
    origin: "https://forge.example.test",
    port: 443
  };
  const lease = await runtime.acquireOpenClawRuntimeStartupLease(remote, {
    timeoutMs: 50,
    refreshMs: 10,
    waitMs: 5
  });
  await lease.assertOwned();
  await lease.release();
  assert.equal(
    fs.existsSync(runtime.openClawRuntimeStartupLockPath(remote)),
    false
  );
});

test("OpenClaw's normal owner-matched directory and record modes are accepted", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX ownership modes do not apply on Windows.");
    return;
  }
  await resetRuntimeFiles();
  const statePath = runtime.openClawRuntimeStatePath(config);
  await fsp.mkdir(path.dirname(statePath), {
    recursive: true,
    mode: 0o755
  });
  await fsp.chmod(path.dirname(statePath), 0o755);
  await fsp.writeFile(
    statePath,
    `${JSON.stringify({
      pid: process.pid,
      origin: config.origin,
      port: config.port,
      baseUrl: `${config.origin}:${config.port}`,
      startedAt: new Date().toISOString(),
      logPath: runtime.openClawRuntimeLogPath(config)
    }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o644 }
  );
  await fsp.chmod(statePath, 0o644);
  const record =
    await runtime.readVerifiedOpenClawRuntimeRecord(config);
  assert.equal(record.state.pid, process.pid);
  assert.equal(
    fs.statSync(path.dirname(statePath)).mode & 0o777,
    0o755
  );
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o644);
});

test(
  "Windows refuses automatic OpenClaw transfer without a provable launch boundary",
  { skip: process.platform !== "win32" },
  () => {
    assert.throws(
      () =>
        runtime.inspectOpenClawRuntimeLaunchBoundary(config, {
          pid: process.pid
        }),
      /automatic ownership transfer is disabled/
    );
  }
);

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

test("restart transfers an exactly verified OpenClaw runtime under both manager locks", async () => {
  await resetRuntimeFiles();
  await fsp.mkdir(
    path.dirname(runtime.openClawRuntimeStatePath(config)),
    { recursive: true, mode: 0o700 }
  );
  await fsp.writeFile(
    runtime.openClawRuntimeStatePath(config),
    "{}\n",
    { encoding: "utf8", mode: 0o600 }
  );
  const candidate = {
    state: { pid: 9001 },
    path: runtime.openClawRuntimeStatePath(config),
    sha256: "a".repeat(64),
    launchBoundary: {
      executable: process.execPath,
      args: [new URL(import.meta.url).pathname],
      cwd: process.cwd(),
      mode: "packaged",
      logPath: runtime.openClawRuntimeLogPath(config)
    }
  };
  const events = [];
  const assertBothLocks = () => {
    assert.equal(
      fs.existsSync(runtime.runtimeStartLockOwnerPath()),
      true
    );
    assert.equal(
      fs.existsSync(
        runtime.openClawRuntimeStartupLockOwnerPath(config)
      ),
      true
    );
  };
  const result = await runtime.restartRuntime(config, {
    peerPreparation: {},
    healthImplementation: async () => ({
      ok: true,
      forge: true
    }),
    authenticatedHealth: async () => protectedHealth(9002),
    readState: async () => null,
    verifyTransfer: async () => {
      assertBothLocks();
      events.push("verify");
      return candidate;
    },
    stopTransfer: async (received) => {
      assertBothLocks();
      assert.equal(received, candidate);
      events.push("stop-openclaw");
      return {
        ok: true,
        stopped: true,
        pids: [9001],
        manager: "openclaw"
      };
    },
    waitForQuiescence: async (_config, received) => {
      assertBothLocks();
      assert.equal(received, candidate);
      events.push("quiesce");
      return { ok: true, quiesced: true };
    },
    verifyStartedTransfer: async (_config, result) => {
      assertBothLocks();
      assert.equal(result.ok, true);
      events.push("verify-managed");
      return { ok: true };
    },
    startImplementation: async (_config, options) => {
      assertBothLocks();
      assert.equal(options.runtimeMutationLockHeld, true);
      events.push("start-forge-memory");
      return {
        ok: true,
        started: true,
        adopted: false,
        state: { children: [{ role: "server", pid: 9003 }] }
      };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.transferredFrom, "openclaw");
  assert.deepEqual(events, [
    "verify",
    "stop-openclaw",
    "quiesce",
    "start-forge-memory",
    "verify-managed"
  ]);
  assert.equal(fs.existsSync(runtime.runtimeStartLockPath()), false);
  assert.equal(
    fs.existsSync(runtime.openClawRuntimeStartupLockPath(config)),
    false
  );
});

test("restart performs one clean retry and restores OpenClaw on transfer failure", async () => {
  await resetRuntimeFiles();
  await fsp.mkdir(
    path.dirname(runtime.openClawRuntimeStatePath(config)),
    { recursive: true, mode: 0o700 }
  );
  await fsp.writeFile(
    runtime.openClawRuntimeStatePath(config),
    "{}\n",
    { encoding: "utf8", mode: 0o600 }
  );
  const candidate = {
    state: { pid: 9101 },
    path: runtime.openClawRuntimeStatePath(config),
    sha256: "b".repeat(64),
    launchBoundary: {
      executable: process.execPath,
      args: [new URL(import.meta.url).pathname],
      cwd: process.cwd(),
      mode: "packaged",
      logPath: runtime.openClawRuntimeLogPath(config)
    }
  };
  let healthReads = 0;
  let starts = 0;
  let rollbacks = 0;
  let quiescenceChecks = 0;
  const result = await runtime.restartRuntime(config, {
    peerPreparation: {},
    healthImplementation: async () => {
      healthReads += 1;
      return healthReads === 1
        ? { ok: true, forge: true }
        : { ok: false, forge: false };
    },
    authenticatedHealth: async () => protectedHealth(9102),
    readState: async () => null,
    verifyTransfer: async () => candidate,
    stopTransfer: async () => ({
      ok: true,
      stopped: true,
      pids: [9101],
      manager: "openclaw"
    }),
    waitForQuiescence: async () => {
      quiescenceChecks += 1;
      return { ok: true, quiesced: true };
    },
    startImplementation: async () => {
      starts += 1;
      return {
        ok: false,
        started: false,
        message: `start failure ${starts}`
      };
    },
    rollbackImplementation: async (
      _config,
      received,
      peerPreparation
    ) => {
      assert.equal(received, candidate);
      assert.deepEqual(peerPreparation, {});
      assert.equal(
        fs.existsSync(
          runtime.openClawRuntimeStartupLockOwnerPath(config)
        ),
        true
      );
      rollbacks += 1;
      return { ok: true, restored: true };
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.transferredFrom, "openclaw");
  assert.equal(starts, 2);
  assert.equal(rollbacks, 1);
  assert.equal(quiescenceChecks, 3);
  assert.equal(result.rollback.restored, true);
  assert.match(result.message, /prior OpenClaw source runtime was restored/);
});

test("OpenClaw transfer waits for the exact responder and endpoint to quiesce", async () => {
  const observations = [
    {
      responderAlive: true,
      health: { ok: true, forge: true },
      portAvailable: false
    },
    {
      responderAlive: true,
      health: { ok: false, forge: false },
      portAvailable: false
    },
    {
      responderAlive: false,
      health: { ok: false, forge: false },
      portAvailable: true
    }
  ];
  let observationIndex = 0;
  const candidate = {
    protectedResponder: {
      role: "protected-health-responder",
      pid: 9201,
      identity: "c".repeat(64)
    }
  };
  const result =
    await runtime.waitForTransferredRuntimeQuiescence(
      config,
      candidate,
      {
        responderAliveImplementation: () =>
          observations[observationIndex].responderAlive,
        healthImplementation: async () =>
          observations[observationIndex].health,
        portAvailableImplementation: async () =>
          observations[observationIndex].portAvailable,
        delayImplementation: async () => {
          observationIndex += 1;
        },
        timeoutMs: 1_000,
        intervalMs: 1
      }
    );
  assert.equal(result.ok, true);
  assert.equal(result.quiesced, true);
  assert.equal(observationIndex, 2);
});

test("OpenClaw transfer quiescence fails closed while any Forge responder remains healthy", async () => {
  const candidate = {
    protectedResponder: {
      role: "protected-health-responder",
      pid: 9301,
      identity: "d".repeat(64)
    }
  };
  const result =
    await runtime.waitForTransferredRuntimeQuiescence(
      config,
      candidate,
      {
        responderAliveImplementation: () => false,
        healthImplementation: async () => ({
          ok: true,
          forge: true
        }),
        portAvailableImplementation: async () => false,
        delayImplementation: async () => delay(1),
        timeoutMs: 5,
        intervalMs: 1
      }
    );
  assert.equal(result.ok, false);
  assert.equal(result.quiesced, false);
  assert.equal(result.responderAlive, false);
  assert.equal(result.endpointHealthy, true);
  assert.equal(result.portAvailable, false);
  assert.match(result.message, /No replacement runtime was started/);
});

test("OpenClaw transfer never starts when the protected endpoint does not quiesce", async () => {
  await resetRuntimeFiles();
  await fsp.mkdir(
    path.dirname(runtime.openClawRuntimeStatePath(config)),
    { recursive: true, mode: 0o700 }
  );
  await fsp.writeFile(
    runtime.openClawRuntimeStatePath(config),
    "{}\n",
    { encoding: "utf8", mode: 0o600 }
  );
  const candidate = {
    state: { pid: 9401 },
    path: runtime.openClawRuntimeStatePath(config),
    sha256: "e".repeat(64),
    protectedResponder: {
      role: "protected-health-responder",
      pid: 9402,
      identity: "f".repeat(64)
    },
    launchBoundary: {
      executable: process.execPath,
      args: [new URL(import.meta.url).pathname],
      cwd: process.cwd(),
      mode: "packaged",
      logPath: runtime.openClawRuntimeLogPath(config)
    }
  };
  let starts = 0;
  let rollbacks = 0;
  const result = await runtime.restartRuntime(config, {
    peerPreparation: {},
    healthImplementation: async () => ({
      ok: true,
      forge: true
    }),
    authenticatedHealth: async () => protectedHealth(9402),
    readState: async () => null,
    verifyTransfer: async () => candidate,
    stopTransfer: async () => ({
      ok: true,
      stopped: true,
      pids: [9401],
      manager: "openclaw"
    }),
    waitForQuiescence: async () => ({
      ok: false,
      quiesced: false,
      message:
        "Protected endpoint remained live. No replacement runtime was started."
    }),
    startImplementation: async () => {
      starts += 1;
      return { ok: true, started: true };
    },
    rollbackImplementation: async () => {
      rollbacks += 1;
      return { ok: true, restored: true };
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.quiescence.ok, false);
  assert.equal(starts, 0);
  assert.equal(rollbacks, 0);
  assert.match(result.message, /No replacement runtime was started/);
});

test("OpenClaw transfer rejects an adopted race winner after quiescence", async () => {
  await resetRuntimeFiles();
  await fsp.mkdir(
    path.dirname(runtime.openClawRuntimeStatePath(config)),
    { recursive: true, mode: 0o700 }
  );
  await fsp.writeFile(
    runtime.openClawRuntimeStatePath(config),
    "{}\n",
    { encoding: "utf8", mode: 0o600 }
  );
  const candidate = {
    state: { pid: 9501 },
    path: runtime.openClawRuntimeStatePath(config),
    sha256: "1".repeat(64),
    protectedResponder: {
      role: "protected-health-responder",
      pid: 9502,
      identity: "2".repeat(64)
    }
  };
  let starts = 0;
  let rollbacks = 0;
  const result = await runtime.restartRuntime(config, {
    peerPreparation: {},
    healthImplementation: async () => ({
      ok: true,
      forge: true
    }),
    authenticatedHealth: async () => protectedHealth(9502),
    readState: async () => null,
    verifyTransfer: async () => candidate,
    stopTransfer: async () => ({
      ok: true,
      stopped: true,
      pids: [9501],
      manager: "openclaw"
    }),
    waitForQuiescence: async () => ({
      ok: true,
      quiesced: true
    }),
    startImplementation: async () => {
      starts += 1;
      return {
        ok: true,
        started: false,
        adopted: true,
        state: { adopted: true, children: [] }
      };
    },
    rollbackImplementation: async () => {
      rollbacks += 1;
      return { ok: true, restored: true };
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.adopted, false);
  assert.equal(starts, 1);
  assert.equal(rollbacks, 0);
  assert.match(result.message, /not a newly started managed runtime/);
});

test("OpenClaw transfer never retries after a failed start leaves a survivor", async () => {
  await resetRuntimeFiles();
  await fsp.mkdir(
    path.dirname(runtime.openClawRuntimeStatePath(config)),
    { recursive: true, mode: 0o700 }
  );
  await fsp.writeFile(
    runtime.openClawRuntimeStatePath(config),
    "{}\n",
    { encoding: "utf8", mode: 0o600 }
  );
  let starts = 0;
  let quiescenceChecks = 0;
  let rollbacks = 0;
  const result = await runtime.restartRuntime(config, {
    peerPreparation: {},
    healthImplementation: async () => ({
      ok: true,
      forge: true
    }),
    authenticatedHealth: async () => protectedHealth(9602),
    readState: async () => null,
    verifyTransfer: async () => ({
      state: { pid: 9601 },
      path: runtime.openClawRuntimeStatePath(config),
      sha256: "3".repeat(64),
      protectedResponder: {
        role: "protected-health-responder",
        pid: 9602,
        identity: "4".repeat(64)
      }
    }),
    stopTransfer: async () => ({
      ok: true,
      stopped: true,
      pids: [9601],
      manager: "openclaw"
    }),
    waitForQuiescence: async () => {
      quiescenceChecks += 1;
      return { ok: true, quiesced: true };
    },
    startImplementation: async () => {
      starts += 1;
      return {
        ok: false,
        started: false,
        cleanupFailed: true,
        survivingCandidatePids: [9603],
        message: "candidate survived cleanup"
      };
    },
    rollbackImplementation: async () => {
      rollbacks += 1;
      return { ok: true, restored: true };
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.cleanupFailed, true);
  assert.equal(starts, 1);
  assert.equal(quiescenceChecks, 1);
  assert.equal(rollbacks, 0);
  assert.deepEqual(result.survivingCandidatePids, [9603]);
});

test("OpenClaw transfer never rolls back after a retry leaves a survivor", async () => {
  await resetRuntimeFiles();
  await fsp.mkdir(
    path.dirname(runtime.openClawRuntimeStatePath(config)),
    { recursive: true, mode: 0o700 }
  );
  await fsp.writeFile(
    runtime.openClawRuntimeStatePath(config),
    "{}\n",
    { encoding: "utf8", mode: 0o600 }
  );
  let starts = 0;
  let quiescenceChecks = 0;
  let rollbacks = 0;
  const result = await runtime.restartRuntime(config, {
    peerPreparation: {},
    healthImplementation: async () => ({
      ok: true,
      forge: true
    }),
    authenticatedHealth: async () => protectedHealth(9702),
    readState: async () => null,
    verifyTransfer: async () => ({
      state: { pid: 9701 },
      path: runtime.openClawRuntimeStatePath(config),
      sha256: "5".repeat(64),
      protectedResponder: {
        role: "protected-health-responder",
        pid: 9702,
        identity: "6".repeat(64)
      }
    }),
    stopTransfer: async () => ({
      ok: true,
      stopped: true,
      pids: [9701],
      manager: "openclaw"
    }),
    waitForQuiescence: async () => {
      quiescenceChecks += 1;
      return { ok: true, quiesced: true };
    },
    startImplementation: async () => {
      starts += 1;
      if (starts === 1) {
        return {
          ok: false,
          started: false,
          message: "first start failed cleanly"
        };
      }
      return {
        ok: false,
        started: false,
        cleanupFailed: true,
        survivingCandidatePids: [9703],
        message: "retry candidate survived cleanup"
      };
    },
    rollbackImplementation: async () => {
      rollbacks += 1;
      return { ok: true, restored: true };
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.cleanupFailed, true);
  assert.equal(starts, 2);
  assert.equal(quiescenceChecks, 2);
  assert.equal(rollbacks, 0);
  assert.deepEqual(result.survivingCandidatePids, [9703]);
});

test("OpenClaw transfer verification binds record, process identity, health PID, and storage root", async (t) => {
  if (process.platform === "win32") {
    t.skip("Exact automatic ownership transfer is disabled on Windows.");
    return;
  }
  await resetRuntimeFiles();
  const fakeRepo = path.join(tempHome, "verified-openclaw-repo");
  const tsx = path.join(
    fakeRepo,
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs"
  );
  const sourceEntry = path.join(
    fakeRepo,
    "apps",
    "api",
    "src",
    "index.ts"
  );
  await fsp.mkdir(path.dirname(tsx), { recursive: true });
  await fsp.mkdir(path.dirname(sourceEntry), { recursive: true });
  await fsp.writeFile(
    tsx,
    "setInterval(() => {}, 1000);\n",
    "utf8"
  );
  await fsp.writeFile(sourceEntry, "export {};\n", "utf8");
  const transferConfig = {
    ...config,
    mode: "dev",
    port: 43993,
    repo: fakeRepo,
    dataRoot: path.join(tempHome, "verified-data")
  };
  const logPath = runtime.openClawRuntimeLogPath(transferConfig);
  await fsp.mkdir(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, "a");
  const child = spawn(
    process.execPath,
    [tsx, sourceEntry],
    {
      cwd: fakeRepo,
      detached: true,
      stdio: ["ignore", logFd, logFd]
    }
  );
  fs.closeSync(logFd);
  child.unref();
  try {
    await waitForProcessIdentity(child.pid);
    const statePath =
      runtime.openClawRuntimeStatePath(transferConfig);
    await fsp.mkdir(path.dirname(statePath), {
      recursive: true,
      mode: 0o755
    });
    await fsp.writeFile(
      statePath,
      `${JSON.stringify({
        pid: child.pid,
        origin: transferConfig.origin,
        port: transferConfig.port,
        baseUrl: `${transferConfig.origin}:${transferConfig.port}`,
        startedAt: new Date().toISOString(),
        logPath
      }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o644 }
    );
    const candidate =
      await runtime.verifyOpenClawRuntimeTransferCandidate(
        transferConfig,
        protectedHealth(
          child.pid,
          packageVersion,
          transferConfig.dataRoot
        )
      );
    assert.equal(candidate.state.pid, child.pid);
    assert.equal(candidate.launchBoundary.cwd, fakeRepo);
    assert.deepEqual(candidate.launchBoundary.args, [
      tsx,
      sourceEntry
    ]);
    assert.equal(candidate.launchBoundary.logPath, logPath);
    assert.equal(candidate.protectedResponder.pid, child.pid);
    assert.equal(
      runtime.recordedProcessIdentityMatches(
        candidate.protectedResponder
      ),
      true
    );
    assert.equal(
      runtime.recordedProcessIdentityMatches(candidate.recorded),
      true
    );
    assert.throws(
      () =>
        runtime.inspectOpenClawRuntimeLaunchBoundary(
          transferConfig,
          {
            ...candidate.state,
            logPath: path.join(tempHome, "wrong-runtime.log")
          }
        ),
      /log descriptors/
    );
    const otherRepo = path.join(tempHome, "other-openclaw-repo");
    const otherTsx = path.join(
      otherRepo,
      "node_modules",
      "tsx",
      "dist",
      "cli.mjs"
    );
    const otherSource = path.join(
      otherRepo,
      "apps",
      "api",
      "src",
      "index.ts"
    );
    await fsp.mkdir(path.dirname(otherTsx), { recursive: true });
    await fsp.mkdir(path.dirname(otherSource), {
      recursive: true
    });
    await fsp.writeFile(otherTsx, "export {};\n", "utf8");
    await fsp.writeFile(otherSource, "export {};\n", "utf8");
    assert.throws(
      () =>
        runtime.inspectOpenClawRuntimeLaunchBoundary(
          { ...transferConfig, repo: otherRepo },
          candidate.state
        ),
      /checkout or entrypoint/
    );
    const stopped =
      await runtime.stopVerifiedOpenClawRuntimeCandidate(candidate);
    assert.equal(stopped.ok, true);
    assert.equal(stopped.stopped, true);
    await waitForProcessExit(child.pid);
    assert.equal(fs.existsSync(statePath), false);
  } finally {
    if (processExists(child.pid)) {
      try {
        if (process.platform === "win32") {
          process.kill(child.pid, "SIGKILL");
        } else {
          process.kill(-child.pid, "SIGKILL");
        }
      } catch {
        // Best-effort test cleanup.
      }
    }
  }
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
