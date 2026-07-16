import assert from "node:assert/strict";
import { spawn, type SpawnOptions } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PeerDaemonSupervisor,
  PeerDaemonSupervisorError,
  type PeerDaemonSupervisorConfig,
  type PeerDaemonSupervisorDependencies
} from "./peer-daemon-supervisor.js";

const TEST_OWNER = "user_peer_supervisor_test";
const TEST_COMMAND_AUTHORITY_PUBLIC_KEY = Buffer.alloc(32, 7).toString(
  "base64url"
);
const FAKE_PEER_SOURCE = `#!${process.execPath}
import { spawn } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) throw new Error("missing " + name);
  return args[index + 1];
};
if (args[0] === "recover-socket") {
  const socketPath = valueAfter("--socket");
  if (existsSync(path.join(path.dirname(socketPath), "recover-fail"))) {
    process.exit(23);
  }
  if (existsSync(socketPath)) unlinkSync(socketPath);
  process.exit(0);
}
const stateDir = valueAfter("--state-dir");
const eventsPath = path.join(stateDir, "fake-events.jsonl");
const event = (value) => {
  appendFileSync(eventsPath, JSON.stringify(value) + "\\n", { mode: 0o600 });
};

if (args[0] === "identity" && args[1] === "init") {
  event({ kind: "identity", args, env: process.env, pid: process.pid });
  const identityPath = path.join(stateDir, "identity-state.bin");
  writeFileSync(identityPath, "fake-owner-identity", { flag: "wx", mode: 0o600 });
  chmodSync(identityPath, 0o600);
  process.exit(0);
}

if (args[0] !== "serve") throw new Error("unsupported fake forge-peer command");
const socketPath = valueAfter("--socket");
const controlPath = path.join(stateDir, "fake-control.json");
const control = existsSync(controlPath)
  ? JSON.parse(readFileSync(controlPath, "utf8"))
  : {};
process.on("SIGTERM", () => {
  event({ kind: "signal", signal: "SIGTERM", pid: process.pid });
  if (!control.ignoreSigterm) process.exit(0);
});
const countPath = path.join(stateDir, "fake-start-count");
const count = existsSync(countPath)
  ? Number(readFileSync(countPath, "utf8")) + 1
  : 1;
writeFileSync(countPath, String(count), { mode: 0o600 });
event({ kind: "serve", args, env: process.env, pid: process.pid, count });

if (control.createSocket) {
  const socket = createServer();
  socket.listen(socketPath, () => chmodSync(socketPath, 0o600));
}

if (typeof control.stderr === "string") process.stderr.write(control.stderr);
if (Number.isInteger(control.stderrBytes) && control.stderrBytes > 0) {
  process.stderr.write("x".repeat(control.stderrBytes));
}

if (control.spawnDescendant) {
  const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore"
  });
  writeFileSync(path.join(stateDir, "fake-descendant-pid"), String(descendant.pid), {
    mode: 0o600
  });
}

const crashCount = Number.isInteger(control.crashCount) ? control.crashCount : 0;
if (count <= crashCount) {
  setTimeout(() => process.exit(17), control.crashDelayMs ?? 15);
} else if (!control.neverReady) {
  setTimeout(() => {
    writeFileSync(
      path.join(stateDir, "fake-ready.json"),
      JSON.stringify({ pid: process.pid, count }),
      { mode: 0o600 }
    );
  }, control.readyDelayMs ?? 0);
}

setInterval(() => {}, 1000);
`;

const spawnFakePeer = ((
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => spawn(process.execPath, [command, ...args], options)) as typeof spawn;

type FakeControl = {
  crashCount?: number;
  crashDelayMs?: number;
  neverReady?: boolean;
  readyDelayMs?: number;
  ignoreSigterm?: boolean;
  spawnDescendant?: boolean;
  stderr?: string;
  stderrBytes?: number;
  createSocket?: boolean;
};

type Fixture = {
  root: string;
  binaryPath: string;
  stateDir: string;
  socketPath: string;
  eventsPath: string;
  canonicalSentinel: string;
  healthProbe: NonNullable<PeerDaemonSupervisorDependencies["healthProbe"]>;
  cleanup(): Promise<void>;
};

async function createFixture(
  control: FakeControl = {},
  options: { identityExists?: boolean } = {}
): Promise<Fixture> {
  const temporaryRoot = await realpath(
    path.join(path.parse(os.tmpdir()).root, "tmp")
  );
  const root = await mkdtemp(
    path.join(temporaryRoot, "forge-peer-supervisor-test-")
  );
  await chmod(root, 0o700);
  const binaryDir = path.join(root, "bin");
  const stateDir = path.join(root, "peer-state");
  const socketDir = path.join(root, "run");
  await mkdir(binaryDir, { mode: 0o700 });
  await mkdir(stateDir, { mode: 0o700 });
  await mkdir(socketDir, { mode: 0o700 });
  const binaryPath = path.join(binaryDir, "forge-peer-fake.mjs");
  const socketPath = path.join(socketDir, "peer.sock");
  const eventsPath = path.join(stateDir, "fake-events.jsonl");
  await writeFile(binaryPath, FAKE_PEER_SOURCE, { mode: 0o700 });
  await chmod(binaryPath, 0o700);
  await writeFile(
    path.join(stateDir, "fake-control.json"),
    JSON.stringify(control),
    { mode: 0o600 }
  );
  if (options.identityExists) {
    await writeFile(
      path.join(stateDir, "identity-state.bin"),
      "existing-identity",
      {
        mode: 0o600
      }
    );
  }
  const canonicalSentinel = path.join(
    root,
    "canonical-forge-data-must-not-exist"
  );
  return {
    root,
    binaryPath,
    stateDir,
    socketPath,
    eventsPath,
    canonicalSentinel,
    healthProbe: async ({ ownerUserId }) => {
      assert.ok(
        ownerUserId === TEST_OWNER || ownerUserId === "different_owner"
      );
      try {
        const ready = JSON.parse(
          await readFile(path.join(stateDir, "fake-ready.json"), "utf8")
        ) as { pid: number };
        if (!processIsAlive(ready.pid)) throw new Error("stale ready marker");
        return {
          enabled: true,
          healthy: true,
          protocolVersion: "forge-peer/1",
          reason: null
        };
      } catch {
        return {
          enabled: true,
          healthy: false,
          protocolVersion: null,
          reason: "starting"
        };
      }
    },
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    }
  };
}

function enabledConfig(
  fixture: Fixture,
  overrides: Partial<
    Extract<PeerDaemonSupervisorConfig, { enabled: true }>
  > = {}
): Extract<PeerDaemonSupervisorConfig, { enabled: true }> {
  return {
    enabled: true,
    binaryPath: fixture.binaryPath,
    socketPath: fixture.socketPath,
    stateDir: fixture.stateDir,
    ownerUserId: TEST_OWNER,
    commandAuthorityPublicKey: TEST_COMMAND_AUTHORITY_PUBLIC_KEY,
    directEndpoints: ["127.0.0.1:4318", "[::1]:4318"],
    irohEnabled: false,
    allowLoopbackDirect: true,
    startupTimeoutMs: 2_000,
    healthPollIntervalMs: 10,
    healthProbeTimeoutMs: 40,
    shutdownTimeoutMs: 80,
    killTimeoutMs: 500,
    restartInitialDelayMs: 15,
    restartMaxDelayMs: 60,
    restartWindowMs: 2_000,
    maxRestarts: 3,
    diagnosticBytes: 1_024,
    ...overrides
  };
}

function testDependencies(
  fixture: Fixture,
  overrides: PeerDaemonSupervisorDependencies = {}
): PeerDaemonSupervisorDependencies {
  return {
    spawnProcess: spawnFakePeer,
    healthProbe: fixture.healthProbe,
    environment: {
      PATH: process.env.PATH,
      HOME: path.join(fixture.root, "fake-home"),
      LANG: "C.UTF-8",
      FORGE_API_TOKEN: "must-not-reach-child",
      FORGE_DATA_ROOT: fixture.canonicalSentinel,
      DATABASE_URL: "file:///must/not/reach/child.sqlite",
      OPENAI_API_KEY: "must-not-reach-child"
    },
    ...overrides
  };
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    );
  }
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 4_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for the expected supervisor state.");
}

async function readEvents(fixture: Fixture) {
  try {
    return (await readFile(fixture.eventsPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as {
            kind: string;
            args: string[];
            env: Record<string, string>;
            pid: number;
            count?: number;
          }
      );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

async function assertMissing(filePath: string) {
  await assert.rejects(access(filePath), (error: unknown) => {
    assert.ok(error instanceof Error && "code" in error);
    assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
    return true;
  });
}

async function expectSupervisorError(
  promise: Promise<unknown>,
  code: PeerDaemonSupervisorError["code"]
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PeerDaemonSupervisorError);
    assert.equal(error.code, code);
    return true;
  });
}

test("disabled supervision never resolves or starts a process implicitly", async () => {
  let spawnCalls = 0;
  const supervisor = new PeerDaemonSupervisor(
    { enabled: false },
    {
      spawnProcess: ((..._args: unknown[]) => {
        spawnCalls += 1;
        throw new Error("disabled supervisor spawned a process");
      }) as unknown as typeof spawn
    }
  );
  assert.deepEqual(await supervisor.start(), {
    enabled: false,
    state: "disabled",
    pid: null,
    restartCount: 0,
    restartsInWindow: 0,
    circuitOpen: false,
    startedAt: null,
    readyAt: null,
    nextRestartAt: null,
    lastExit: null,
    lastError: null,
    stderrTail: null
  });
  assert.equal(spawnCalls, 0);
});

test("initializes once, becomes ready, and launches only the exact serve contract", async () => {
  const fixture = await createFixture({
    stderr:
      "\u001b[31mtoken=very-secret OPENAI_API_KEY=also-secret\u001b[0m\u0000\n",
    stderrBytes: 2_000
  });
  const spawnCalls: Array<{
    command: string;
    args: readonly string[];
    options: SpawnOptions;
  }> = [];
  const observedSpawn = ((
    command: string,
    args: readonly string[],
    options: SpawnOptions
  ) => {
    spawnCalls.push({
      command,
      args: [...args],
      options: { ...options, env: { ...options.env } }
    });
    return spawn(command, [...args], options);
  }) as typeof spawn;
  const supervisor = new PeerDaemonSupervisor(
    enabledConfig(fixture),
    testDependencies(fixture, { spawnProcess: observedSpawn })
  );
  try {
    const ready = await supervisor.start();
    assert.equal(ready.state, "ready");
    assert.ok(ready.pid && processIsAlive(ready.pid));
    await waitFor(() => supervisor.status().stderrTail !== null);

    const identityMode =
      (await stat(path.join(fixture.stateDir, "identity-state.bin"))).mode &
      0o777;
    const ownerMode =
      (await stat(path.join(fixture.stateDir, "supervisor-owner.json"))).mode &
      0o777;
    assert.equal(identityMode, 0o600);
    assert.equal(ownerMode, 0o600);
    assert.equal(spawnCalls.length, 2);
    assert.deepEqual(spawnCalls[0].args, [
      "identity",
      "init",
      "--state-dir",
      fixture.stateDir,
      "--valid-days",
      "365"
    ]);
    assert.deepEqual(spawnCalls[1].args, [
      "serve",
      "--socket",
      fixture.socketPath,
      "--state-dir",
      fixture.stateDir,
      "--owner-user-id",
      TEST_OWNER,
      "--command-authority-public-key",
      TEST_COMMAND_AUTHORITY_PUBLIC_KEY,
      "--direct-endpoint",
      "127.0.0.1:4318",
      "--direct-endpoint",
      "[::1]:4318",
      "--allow-loopback-direct"
    ]);
    for (const call of spawnCalls) {
      assert.equal(call.command, fixture.binaryPath);
      assert.equal(call.options.shell, false);
      assert.equal(call.options.detached, true);
      assert.equal(call.options.cwd, fixture.stateDir);
      assert.deepEqual(call.options.stdio, ["ignore", "ignore", "pipe"]);
      const environmentKeys = Object.keys(call.options.env ?? {}).sort();
      assert.deepEqual(
        environmentKeys.filter((name) => name !== "NODE_V8_COVERAGE"),
        ["LANG"]
      );
      if (environmentKeys.includes("NODE_V8_COVERAGE")) {
        assert.ok(process.env.NODE_V8_COVERAGE);
      }
    }

    const diagnostics = supervisor.status().stderrTail ?? "";
    assert.ok(Buffer.byteLength(diagnostics) <= 1_024);
    assert.ok(!diagnostics.includes("very-secret"));
    assert.ok(!diagnostics.includes("also-secret"));
    assert.ok(!diagnostics.includes("\u001b"));
    assert.ok(!diagnostics.includes("\u0000"));
    await assertMissing(fixture.canonicalSentinel);

    const firstPid = ready.pid!;
    const stopped = await supervisor.stop();
    assert.equal(stopped.lastExit?.code, 0);
    assert.equal(stopped.lastExit?.intentional, true);
    assert.equal(processIsAlive(firstPid), false);
    assert.ok(
      (await readEvents(fixture)).some(
        (event) => event.kind === "signal" && event.pid === firstPid
      )
    );
    await supervisor.start();
    const events = await readEvents(fixture);
    assert.equal(events.filter((event) => event.kind === "identity").length, 1);
    assert.equal(events.filter((event) => event.kind === "serve").length, 2);
  } finally {
    await supervisor.stop();
    await fixture.cleanup();
  }
});

test("enabled Iroh starts without a direct endpoint and is part of the serve contract", async () => {
  const fixture = await createFixture();
  const supervisor = new PeerDaemonSupervisor(
    enabledConfig(fixture, {
      directEndpoints: [],
      irohEnabled: true,
      allowLoopbackDirect: false
    }),
    testDependencies(fixture)
  );
  try {
    const ready = await supervisor.start();
    assert.equal(ready.state, "ready");
    const serve = (await readEvents(fixture)).find(
      (event) => event.kind === "serve"
    );
    assert.deepEqual(serve?.args, [
      "serve",
      "--socket",
      fixture.socketPath,
      "--state-dir",
      fixture.stateDir,
      "--owner-user-id",
      TEST_OWNER,
      "--command-authority-public-key",
      TEST_COMMAND_AUTHORITY_PUBLIC_KEY,
      "--enable-iroh"
    ]);
  } finally {
    await supervisor.stop();
    await fixture.cleanup();
  }
});

test("restarts a pre-readiness crash with bounded backoff", async () => {
  const fixture = await createFixture({ crashCount: 1, crashDelayMs: 15 });
  const supervisor = new PeerDaemonSupervisor(
    enabledConfig(fixture),
    testDependencies(fixture)
  );
  try {
    const status = await supervisor.start();
    assert.equal(status.state, "ready");
    assert.equal(status.restartCount, 1);
    const events = await readEvents(fixture);
    assert.equal(events.filter((event) => event.kind === "serve").length, 2);
    assert.equal(status.lastExit?.code, 17);
    assert.equal(status.lastExit?.intentional, false);
  } finally {
    await supervisor.stop();
    await fixture.cleanup();
  }
});

test("recovers a proven stale owner socket before restarting", async () => {
  const fixture = await createFixture({
    crashCount: 1,
    crashDelayMs: 80,
    createSocket: true
  });
  const supervisor = new PeerDaemonSupervisor(
    enabledConfig(fixture),
    testDependencies(fixture)
  );
  try {
    const status = await supervisor.start();
    assert.equal(status.state, "ready");
    assert.equal(status.restartCount, 1);
    assert.equal(
      (await readEvents(fixture)).filter((event) => event.kind === "serve")
        .length,
      2
    );
    assert.equal((await stat(fixture.socketPath)).mode & 0o777, 0o600);
  } finally {
    await supervisor.stop();
    await fixture.cleanup();
  }
});

test("fails closed when forge-peer cannot prove an existing socket is stale", async () => {
  const fixture = await createFixture({
    crashCount: 1,
    crashDelayMs: 80,
    createSocket: true
  });
  await writeFile(
    path.join(path.dirname(fixture.socketPath), "recover-fail"),
    "1",
    {
      mode: 0o600
    }
  );
  const supervisor = new PeerDaemonSupervisor(
    enabledConfig(fixture),
    testDependencies(fixture)
  );
  try {
    await expectSupervisorError(supervisor.start(), "filesystem_security");
    assert.equal(supervisor.status().state, "failed");
    assert.equal(
      (await readEvents(fixture)).filter((event) => event.kind === "serve")
        .length,
      1
    );
  } finally {
    await rm(path.join(path.dirname(fixture.socketPath), "recover-fail"), {
      force: true
    });
    await supervisor.stop();
    await fixture.cleanup();
  }
});

test("revalidates private state before an automatic restart", async () => {
  const fixture = await createFixture();
  const supervisor = new PeerDaemonSupervisor(
    enabledConfig(fixture),
    testDependencies(fixture)
  );
  try {
    const started = await supervisor.start();
    assert.ok(started.pid);
    await chmod(fixture.stateDir, 0o750);
    process.kill(-started.pid, "SIGKILL");
    await waitFor(() => supervisor.status().state === "failed");
    const failed = supervisor.status();
    assert.equal(failed.pid, null);
    assert.match(failed.lastError ?? "", /filesystem security/);
    assert.equal(failed.restartCount, 1);
  } finally {
    await chmod(fixture.stateDir, 0o700);
    await supervisor.stop();
    await fixture.cleanup();
  }
});

test("opens the circuit after the configured crash budget", async () => {
  const fixture = await createFixture({ crashCount: 20, crashDelayMs: 10 });
  const supervisor = new PeerDaemonSupervisor(
    enabledConfig(fixture, { maxRestarts: 2 }),
    testDependencies(fixture)
  );
  try {
    await expectSupervisorError(supervisor.start(), "circuit_open");
    const status = supervisor.status();
    assert.equal(status.state, "circuit_open");
    assert.equal(status.circuitOpen, true);
    assert.equal(status.restartCount, 2);
    assert.equal(status.pid, null);
    const events = await readEvents(fixture);
    assert.equal(events.filter((event) => event.kind === "serve").length, 3);
    await expectSupervisorError(supervisor.start(), "circuit_open");
  } finally {
    await supervisor.stop();
    await fixture.cleanup();
  }
});

test("bounds startup timeout and kills a daemon that ignores SIGTERM", async () => {
  const fixture = await createFixture(
    { neverReady: true, ignoreSigterm: true },
    { identityExists: true }
  );
  let monotonicAdvanceMs = 0;
  const supervisor = new PeerDaemonSupervisor(
    enabledConfig(fixture, {
      startupTimeoutMs: 400,
      maxRestarts: 0,
      shutdownTimeoutMs: 30,
      killTimeoutMs: 500
    }),
    testDependencies(fixture, {
      monotonicNow: () => process.uptime() * 1_000 + monotonicAdvanceMs
    })
  );
  try {
    const failedStart = expectSupervisorError(
      supervisor.start(),
      "circuit_open"
    );
    await waitFor(
      async () =>
        (await readEvents(fixture)).some((event) => event.kind === "serve"),
      15_000
    );
    const beganAt = Date.now();
    monotonicAdvanceMs += 1_000;
    await failedStart;
    assert.ok(Date.now() - beganAt < 2_000);
    const status = supervisor.status();
    assert.equal(status.state, "circuit_open");
    assert.match(status.lastError ?? "", /startup deadline/);
    assert.equal(status.pid, null);
    assert.equal(status.lastExit?.signal, "SIGKILL");
    assert.equal(status.lastExit?.intentional, false);
  } finally {
    await supervisor.stop();
    await fixture.cleanup();
  }
});

test("marks a stop during startup as intentional", async () => {
  const fixture = await createFixture(
    { neverReady: true },
    { identityExists: true }
  );
  const supervisor = new PeerDaemonSupervisor(
    enabledConfig(fixture),
    testDependencies(fixture)
  );
  try {
    const stoppedStart = expectSupervisorError(supervisor.start(), "stopped");
    await waitFor(async () =>
      (await readEvents(fixture)).some((event) => event.kind === "serve")
    );
    const stopping = supervisor.stop();
    await expectSupervisorError(supervisor.start(), "stopped");
    const stopped = await stopping;
    await stoppedStart;
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.lastExit?.intentional, true);
    assert.equal(stopped.lastExit?.code, 0);
  } finally {
    await supervisor.stop();
    await fixture.cleanup();
  }
});

test("stop awaits SIGKILL cleanup for the daemon and its descendant", async () => {
  const fixture = await createFixture({
    ignoreSigterm: true,
    spawnDescendant: true
  });
  const supervisor = new PeerDaemonSupervisor(
    enabledConfig(fixture, { shutdownTimeoutMs: 30, killTimeoutMs: 800 }),
    testDependencies(fixture)
  );
  try {
    const started = await supervisor.start();
    assert.ok(started.pid);
    await waitFor(async () => {
      try {
        await access(path.join(fixture.stateDir, "fake-descendant-pid"));
        return true;
      } catch {
        return false;
      }
    });
    const descendantPid = Number(
      await readFile(path.join(fixture.stateDir, "fake-descendant-pid"), "utf8")
    );
    assert.ok(processIsAlive(started.pid));
    assert.ok(processIsAlive(descendantPid));

    const stopped = await supervisor.stop();
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.pid, null);
    assert.equal(stopped.lastExit?.intentional, true);
    assert.equal(stopped.lastExit?.signal, "SIGKILL");
    await waitFor(() => !processIsAlive(started.pid!));
    await waitFor(() => !processIsAlive(descendantPid));
  } finally {
    await supervisor.stop();
    await fixture.cleanup();
  }
});

test("rejects unsafe paths and permissions before spawning", async (context) => {
  await context.test("relative paths fail synchronously", () => {
    assert.throws(
      () =>
        new PeerDaemonSupervisor({
          enabled: true,
          binaryPath: "./forge-peer",
          socketPath: "/tmp/forge-peer-test.sock",
          stateDir: "/tmp/forge-peer-test-state",
          ownerUserId: TEST_OWNER,
          commandAuthorityPublicKey: TEST_COMMAND_AUTHORITY_PUBLIC_KEY,
          directEndpoints: ["127.0.0.1:4318"],
          irohEnabled: false
        }),
      (error: unknown) => {
        assert.ok(error instanceof PeerDaemonSupervisorError);
        assert.equal(error.code, "configuration");
        return true;
      }
    );
  });

  await context.test("group-readable state is rejected", async () => {
    const fixture = await createFixture();
    await chmod(fixture.stateDir, 0o750);
    const supervisor = new PeerDaemonSupervisor(
      enabledConfig(fixture),
      testDependencies(fixture)
    );
    try {
      await expectSupervisorError(supervisor.start(), "filesystem_security");
      assert.equal((await readEvents(fixture)).length, 0);
    } finally {
      await chmod(fixture.stateDir, 0o700);
      await fixture.cleanup();
    }
  });

  await context.test("a writable executable is rejected", async () => {
    const fixture = await createFixture();
    await chmod(fixture.binaryPath, 0o777);
    const supervisor = new PeerDaemonSupervisor(
      enabledConfig(fixture),
      testDependencies(fixture)
    );
    try {
      await expectSupervisorError(supervisor.start(), "filesystem_security");
      assert.equal((await readEvents(fixture)).length, 0);
    } finally {
      await chmod(fixture.binaryPath, 0o700);
      await fixture.cleanup();
    }
  });

  await context.test("an existing identity must remain mode 0600", async () => {
    const fixture = await createFixture({}, { identityExists: true });
    const identityPath = path.join(fixture.stateDir, "identity-state.bin");
    await chmod(identityPath, 0o400);
    const supervisor = new PeerDaemonSupervisor(
      enabledConfig(fixture),
      testDependencies(fixture)
    );
    try {
      await expectSupervisorError(supervisor.start(), "filesystem_security");
      assert.equal((await readEvents(fixture)).length, 0);
    } finally {
      await chmod(identityPath, 0o600);
      await fixture.cleanup();
    }
  });

  await context.test("a symlinked state directory is rejected", async () => {
    const fixture = await createFixture();
    const target = path.join(fixture.root, "alternate-state");
    const link = path.join(fixture.root, "linked-state");
    await mkdir(target, { mode: 0o700 });
    await symlink(target, link);
    const supervisor = new PeerDaemonSupervisor(
      enabledConfig(fixture, { stateDir: link }),
      testDependencies(fixture)
    );
    try {
      await expectSupervisorError(supervisor.start(), "filesystem_security");
    } finally {
      await fixture.cleanup();
    }
  });

  await context.test("a non-private socket directory is rejected", async () => {
    const fixture = await createFixture();
    await chmod(path.dirname(fixture.socketPath), 0o755);
    const supervisor = new PeerDaemonSupervisor(
      enabledConfig(fixture),
      testDependencies(fixture)
    );
    try {
      await expectSupervisorError(supervisor.start(), "filesystem_security");
      assert.equal((await readEvents(fixture)).length, 0);
    } finally {
      await chmod(path.dirname(fixture.socketPath), 0o700);
      await fixture.cleanup();
    }
  });
});

test("persists the owner binding and rejects a later owner change", async () => {
  const fixture = await createFixture();
  const first = new PeerDaemonSupervisor(
    enabledConfig(fixture),
    testDependencies(fixture)
  );
  try {
    await first.start();
    await first.stop();
    const second = new PeerDaemonSupervisor(
      enabledConfig(fixture, { ownerUserId: "different_owner" }),
      testDependencies(fixture)
    );
    await expectSupervisorError(second.start(), "owner_mismatch");
    assert.equal(second.status().state, "failed");
    const events = await readEvents(fixture);
    assert.equal(events.filter((event) => event.kind === "identity").length, 1);
    assert.equal(events.filter((event) => event.kind === "serve").length, 1);
  } finally {
    await first.stop();
    await fixture.cleanup();
  }
});
