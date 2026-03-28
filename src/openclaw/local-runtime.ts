import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ForgePluginConfig } from "./api-client.js";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);
const STARTUP_TIMEOUT_MS = 15_000;
const HEALTHCHECK_TIMEOUT_MS = 1_500;
const HEALTHCHECK_INTERVAL_MS = 250;

type ForgeRuntimeLaunchPlan = {
  packageRoot: string;
  entryFile: string;
};

type ForgeRuntimeState = {
  pid: number;
  origin: string;
  port: number;
  baseUrl: string;
  startedAt: string;
};

export type ForgeRuntimeStopResult = {
  ok: boolean;
  stopped: boolean;
  managed: boolean;
  message: string;
  pid: number | null;
};

export type ForgeRuntimeStartResult = {
  ok: boolean;
  started: boolean;
  managed: boolean;
  message: string;
  pid: number | null;
  baseUrl: string;
};

export type ForgeRuntimeStatusResult = {
  ok: boolean;
  running: boolean;
  healthy: boolean;
  managed: boolean;
  message: string;
  pid: number | null;
  baseUrl: string;
};

export type ForgeRuntimeRestartResult = {
  ok: boolean;
  restarted: boolean;
  managed: boolean;
  message: string;
  pid: number | null;
  baseUrl: string;
};

let managedRuntimeChild: ChildProcess | null = null;
let managedRuntimeKey: string | null = null;
let startupPromise: Promise<void> | null = null;

function runtimeKey(config: ForgePluginConfig) {
  return `${config.origin}:${config.port}`;
}

function getRuntimeStatePath(config: ForgePluginConfig) {
  const origin = new URL(config.origin).hostname.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return path.join(homedir(), ".openclaw", "run", "forge-openclaw-plugin", `${origin}-${config.port}.json`);
}

async function writeRuntimeState(config: ForgePluginConfig, pid: number) {
  const statePath = getRuntimeStatePath(config);
  await mkdir(path.dirname(statePath), { recursive: true });
  const payload: ForgeRuntimeState = {
    pid,
    origin: config.origin,
    port: config.port,
    baseUrl: config.baseUrl,
    startedAt: new Date().toISOString()
  };
  await writeFile(statePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function clearRuntimeState(config: ForgePluginConfig) {
  await rm(getRuntimeStatePath(config), { force: true });
}

async function readRuntimeState(config: ForgePluginConfig): Promise<ForgeRuntimeState | null> {
  try {
    const payload = await readFile(getRuntimeStatePath(config), "utf8");
    const parsed = JSON.parse(payload) as Partial<ForgeRuntimeState>;
    if (typeof parsed.pid !== "number" || !Number.isFinite(parsed.pid)) {
      return null;
    }
    return {
      pid: Math.trunc(parsed.pid),
      origin: typeof parsed.origin === "string" ? parsed.origin : config.origin,
      port: typeof parsed.port === "number" ? parsed.port : config.port,
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : config.baseUrl,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date(0).toISOString()
    };
  } catch {
    return null;
  }
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error) || !("code" in error) || error.code !== "ESRCH";
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTHCHECK_INTERVAL_MS));
  }
  return !processExists(pid);
}

function isLocalOrigin(origin: string) {
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function getCurrentModuleRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function resolveLaunchPlan(): ForgeRuntimeLaunchPlan | null {
  const moduleRoot = getCurrentModuleRoot();

  // Published or linked plugin package runtime.
  const packagedEntry = path.join(moduleRoot, "dist", "server", "index.js");
  const packagedMigrations = path.join(moduleRoot, "server", "migrations");
  if (existsSync(packagedEntry) && existsSync(packagedMigrations)) {
    return {
      packageRoot: moduleRoot,
      entryFile: packagedEntry
    };
  }

  // Source-tree fallback for local development before packaging.
  const repoRoot = moduleRoot;
  const sourceEntry = path.join(repoRoot, "server", "src", "index.ts");
  const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  if (existsSync(sourceEntry) && existsSync(tsxCli)) {
    return {
      packageRoot: repoRoot,
      entryFile: tsxCli
    };
  }

  return null;
}

async function isForgeHealthy(config: ForgePluginConfig, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/api/v1/health", config.baseUrl), {
      method: "GET",
      headers: {
        accept: "application/json"
      },
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function spawnManagedRuntime(config: ForgePluginConfig, plan: ForgeRuntimeLaunchPlan) {
  const isPackagedServer = plan.entryFile.endsWith(path.join("dist", "server", "index.js"));
  const args = isPackagedServer ? [plan.entryFile] : [plan.entryFile, path.join(plan.packageRoot, "server", "src", "index.ts")];
  const child = spawn(process.execPath, args, {
    cwd: plan.packageRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(config.port),
      FORGE_BASE_PATH: "/forge/",
      ...(config.dataRoot ? { FORGE_DATA_ROOT: config.dataRoot } : {})
    },
    stdio: "ignore",
    detached: true
  });

  child.unref();
  child.once("exit", () => {
    if (managedRuntimeChild === child) {
      managedRuntimeChild = null;
      managedRuntimeKey = null;
    }
    void clearRuntimeState(config);
  });

  managedRuntimeChild = child;
  managedRuntimeKey = runtimeKey(config);
  void writeRuntimeState(config, child.pid!).catch(() => {
    // State tracking is best effort. Runtime health checks remain authoritative.
  });
}

async function waitForRuntime(config: ForgePluginConfig, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isForgeHealthy(config, HEALTHCHECK_TIMEOUT_MS)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTHCHECK_INTERVAL_MS));
  }
  throw new Error(`Forge local runtime did not become healthy at ${config.baseUrl} within ${timeoutMs}ms`);
}

export async function ensureForgeRuntimeReady(config: ForgePluginConfig) {
  if (!isLocalOrigin(config.origin)) {
    return;
  }

  if (await isForgeHealthy(config, HEALTHCHECK_TIMEOUT_MS)) {
    return;
  }

  const key = runtimeKey(config);
  if (startupPromise && managedRuntimeKey === key) {
    return startupPromise;
  }

  const plan = resolveLaunchPlan();
  if (!plan) {
    return;
  }

  startupPromise = (async () => {
    if (await isForgeHealthy(config, HEALTHCHECK_TIMEOUT_MS)) {
      return;
    }
    if (!managedRuntimeChild || managedRuntimeKey !== key || managedRuntimeChild.killed) {
      spawnManagedRuntime(config, plan);
    }
    await waitForRuntime(config, STARTUP_TIMEOUT_MS);
  })().finally(() => {
    startupPromise = null;
  });

  return startupPromise;
}

export async function startForgeRuntime(config: ForgePluginConfig): Promise<ForgeRuntimeStartResult> {
  if (!isLocalOrigin(config.origin)) {
    return {
      ok: false,
      started: false,
      managed: false,
      message: "Forge start only supports local plugin-managed runtimes. Remote Forge targets must be started where they are hosted.",
      pid: null,
      baseUrl: config.baseUrl
    };
  }

  const existingState = await readRuntimeState(config);
  if (existingState && processExists(existingState.pid) && (await isForgeHealthy(config, HEALTHCHECK_TIMEOUT_MS))) {
    return {
      ok: true,
      started: false,
      managed: true,
      message: `Forge is already running on ${config.baseUrl}.`,
      pid: existingState.pid,
      baseUrl: config.baseUrl
    };
  }

  await ensureForgeRuntimeReady(config);
  const state = await readRuntimeState(config);
  return {
    ok: true,
    started: true,
    managed: true,
    message: `Started the plugin-managed Forge runtime on ${config.baseUrl}.`,
    pid: state?.pid ?? managedRuntimeChild?.pid ?? null,
    baseUrl: config.baseUrl
  };
}

export function primeForgeRuntime(config: ForgePluginConfig) {
  void ensureForgeRuntimeReady(config).catch(() => {
    // Keep plugin registration non-blocking. Failures surface on first real call.
  });
}

export async function stopForgeRuntime(config: ForgePluginConfig): Promise<ForgeRuntimeStopResult> {
  if (!isLocalOrigin(config.origin)) {
    return {
      ok: false,
      stopped: false,
      managed: false,
      message: "Forge stop only supports local plugin-managed runtimes. Remote Forge targets must be stopped where they are hosted.",
      pid: null
    };
  }

  const state = await readRuntimeState(config);
  if (!state) {
    return {
      ok: true,
      stopped: false,
      managed: false,
      message: (await isForgeHealthy(config, HEALTHCHECK_TIMEOUT_MS))
        ? "Forge is running, but it does not look like a plugin-managed runtime. Stop it where it was started."
        : "Forge is not running through the plugin-managed local runtime.",
      pid: null
    };
  }

  if (!processExists(state.pid)) {
    await clearRuntimeState(config);
    return {
      ok: true,
      stopped: false,
      managed: true,
      message: "The saved Forge runtime PID was stale. The plugin-managed runtime is already stopped.",
      pid: state.pid
    };
  }

  process.kill(state.pid, "SIGTERM");
  if (!(await waitForProcessExit(state.pid, 5_000))) {
    process.kill(state.pid, "SIGKILL");
    if (!(await waitForProcessExit(state.pid, 2_000))) {
      return {
        ok: false,
        stopped: false,
        managed: true,
        message: `Forge runtime pid ${state.pid} did not stop cleanly.`,
        pid: state.pid
      };
    }
  }

  if (managedRuntimeChild?.pid === state.pid) {
    managedRuntimeChild = null;
    managedRuntimeKey = null;
  }
  await clearRuntimeState(config);

  return {
    ok: true,
    stopped: true,
    managed: true,
    message: `Stopped the plugin-managed Forge runtime on ${config.baseUrl}.`,
    pid: state.pid
  };
}

export async function getForgeRuntimeStatus(config: ForgePluginConfig): Promise<ForgeRuntimeStatusResult> {
  const healthy = await isForgeHealthy(config, HEALTHCHECK_TIMEOUT_MS);
  const state = await readRuntimeState(config);
  const pid = state?.pid ?? null;
  const managed = Boolean(state);
  const running = healthy || (pid !== null && processExists(pid));

  if (!isLocalOrigin(config.origin)) {
    return {
      ok: healthy,
      running: healthy,
      healthy,
      managed: false,
      message: healthy
        ? `Forge is reachable at ${config.baseUrl}. Runtime lifecycle is managed remotely.`
        : `Forge is not reachable at ${config.baseUrl}. Runtime lifecycle is managed remotely.`,
      pid: null,
      baseUrl: config.baseUrl
    };
  }

  if (managed && pid !== null && !processExists(pid)) {
    await clearRuntimeState(config);
    return {
      ok: true,
      running: false,
      healthy: false,
      managed: true,
      message: "The saved Forge runtime PID was stale. The plugin-managed runtime is stopped.",
      pid,
      baseUrl: config.baseUrl
    };
  }

  if (healthy && managed) {
    return {
      ok: true,
      running: true,
      healthy: true,
      managed: true,
      message: `Forge is running and healthy on ${config.baseUrl}.`,
      pid,
      baseUrl: config.baseUrl
    };
  }

  if (healthy) {
    return {
      ok: true,
      running: true,
      healthy: true,
      managed: false,
      message: `Forge is running on ${config.baseUrl}, but it does not look like a plugin-managed runtime.`,
      pid: null,
      baseUrl: config.baseUrl
    };
  }

  if (managed) {
    return {
      ok: true,
      running: false,
      healthy: false,
      managed: true,
      message: "The plugin-managed Forge runtime is stopped.",
      pid,
      baseUrl: config.baseUrl
    };
  }

  return {
    ok: true,
    running: false,
    healthy: false,
    managed: false,
    message: "Forge is not running through the plugin-managed local runtime.",
    pid: null,
    baseUrl: config.baseUrl
  };
}

export async function restartForgeRuntime(config: ForgePluginConfig): Promise<ForgeRuntimeRestartResult> {
  if (!isLocalOrigin(config.origin)) {
    return {
      ok: false,
      restarted: false,
      managed: false,
      message: "Forge restart only supports local plugin-managed runtimes. Remote Forge targets must be restarted where they are hosted.",
      pid: null,
      baseUrl: config.baseUrl
    };
  }

  const stopResult = await stopForgeRuntime(config);
  if (!stopResult.ok) {
    return {
      ok: false,
      restarted: false,
      managed: stopResult.managed,
      message: stopResult.message,
      pid: stopResult.pid,
      baseUrl: config.baseUrl
    };
  }

  const startResult = await startForgeRuntime(config);
  return {
    ok: startResult.ok,
    restarted: startResult.ok,
    managed: true,
    message: startResult.ok
      ? `Restarted the plugin-managed Forge runtime on ${config.baseUrl}.`
      : startResult.message,
    pid: startResult.pid,
    baseUrl: config.baseUrl
  };
}
