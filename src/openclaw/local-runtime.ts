import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ForgePluginConfig } from "./api-client.js";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);
const STARTUP_TIMEOUT_MS = 15_000;
const HEALTHCHECK_TIMEOUT_MS = 1_500;
const HEALTHCHECK_INTERVAL_MS = 250;
const EXISTING_RUNTIME_GRACE_MS = 3_000;
const MAX_PORT_SCAN_ATTEMPTS = 20;
const FORGE_PLUGIN_ID = "forge-openclaw-plugin";

type ForgeRuntimeLaunchPlan = {
  packageRoot: string;
  entryFile: string;
};

type ForgeRuntimeProbe = {
  healthy: boolean;
  pid: number | null;
  storageRoot: string | null;
  basePath: string | null;
};

type ForgeRuntimeState = {
  pid: number;
  origin: string;
  port: number;
  baseUrl: string;
  startedAt: string;
  logPath: string | null;
};

type ForgeRuntimeExitDetails = {
  pid: number;
  code: number | null;
  signal: NodeJS.Signals | null;
  logPath: string | null;
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
let managedRuntimeLogPath: string | null = null;
let lastRuntimeExitDetails: ForgeRuntimeExitDetails | null = null;
let startupPromise: Promise<void> | null = null;
let startupRuntimeKey: string | null = null;
const dependencyInstallPromises = new Map<string, Promise<void>>();

function runtimeKey(config: ForgePluginConfig) {
  return `${config.origin}:${config.port}`;
}

function buildForgeBaseUrl(origin: string, port: number) {
  const url = new URL(origin.endsWith("/") ? origin : `${origin}/`);
  url.port = String(port);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

function buildForgeWebAppUrl(origin: string, port: number) {
  return `${buildForgeBaseUrl(origin, port)}/forge/`;
}

function getRuntimeStatePath(config: ForgePluginConfig) {
  const origin = new URL(config.origin).hostname.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return path.join(homedir(), ".openclaw", "run", FORGE_PLUGIN_ID, `${origin}-${config.port}.json`);
}

function getPreferredPortStatePath(origin: string) {
  const hostname = new URL(origin).hostname.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return path.join(homedir(), ".openclaw", "run", FORGE_PLUGIN_ID, `${hostname}-preferred-port.json`);
}

function applyPortToConfig(config: ForgePluginConfig, port: number, portSource: ForgePluginConfig["portSource"]) {
  config.port = port;
  config.baseUrl = buildForgeBaseUrl(config.origin, port);
  config.webAppUrl = buildForgeWebAppUrl(config.origin, port);
  config.portSource = portSource;
}

function getExpectedDataRoot(config: ForgePluginConfig) {
  return config.dataRoot.trim().length > 0 ? path.resolve(config.dataRoot) : null;
}

function isExpectedDataRoot(expectedDataRoot: string | null, actualDataRoot: string | null) {
  if (!expectedDataRoot) {
    return true;
  }
  if (!actualDataRoot) {
    return false;
  }
  return path.resolve(actualDataRoot) === expectedDataRoot;
}

function formatRuntimeDataRootMismatch(config: ForgePluginConfig, expectedDataRoot: string, actualDataRoot: string | null) {
  return [
    `Forge is already responding on ${config.baseUrl}, but it is using storage root ${actualDataRoot ?? "(unknown)"}.`,
    `The OpenClaw plugin is configured to use ${expectedDataRoot}.`,
    "Restart the plugin-managed runtime or stop the conflicting Forge server so the configured dataRoot can take over."
  ].join(" ");
}

async function writePreferredPortState(config: ForgePluginConfig, port: number) {
  const statePath = getPreferredPortStatePath(config.origin);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    `${JSON.stringify({ origin: config.origin, port, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
}

async function isPortAvailable(host: string, port: number) {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      resolve(error.code !== "EADDRINUSE");
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailableLocalPort(host: string, startPort: number) {
  for (let candidate = Math.max(1, startPort), attempts = 0; candidate <= 65_535 && attempts < MAX_PORT_SCAN_ATTEMPTS; candidate += 1, attempts += 1) {
    if (await isPortAvailable(host, candidate)) {
      return candidate;
    }
  }
  return null;
}

async function relocateLocalRuntimePort(config: ForgePluginConfig) {
  if (config.portSource === "configured") {
    throw new Error(
      `Configured Forge port ${config.port} is already in use on ${new URL(config.origin).hostname}. Set a different plugin port or stop the process using it.`
    );
  }

  const nextPort = await findAvailableLocalPort("127.0.0.1", config.port + 1);
  if (nextPort === null) {
    throw new Error(`Forge could not find a free localhost port after ${config.port}.`);
  }

  applyPortToConfig(config, nextPort, "preferred");
  await writePreferredPortState(config, nextPort);
}

async function writeRuntimeState(config: ForgePluginConfig, pid: number) {
  const statePath = getRuntimeStatePath(config);
  await mkdir(path.dirname(statePath), { recursive: true });
  const payload: ForgeRuntimeState = {
    pid,
    origin: config.origin,
    port: config.port,
    baseUrl: config.baseUrl,
    startedAt: new Date().toISOString(),
    logPath: managedRuntimeLogPath
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
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : new Date(0).toISOString(),
      logPath: typeof parsed.logPath === "string" ? parsed.logPath : null
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

function getRuntimeLogPath(config: ForgePluginConfig) {
  const origin = new URL(config.origin).hostname.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return path.join(homedir(), ".openclaw", "logs", FORGE_PLUGIN_ID, `${origin}-${config.port}.log`);
}

function openRuntimeLogFile(logPath: string) {
  mkdirSync(path.dirname(logPath), { recursive: true });
  return openSync(logPath, "a");
}

function isPackagedServerPlan(plan: ForgeRuntimeLaunchPlan) {
  return plan.entryFile.endsWith(path.join("dist", "server", "index.js"));
}

function getNpmInvocation() {
  const binDir = path.dirname(process.execPath);
  const npmCli = process.platform === "win32" ? path.join(binDir, "npm.cmd") : path.join(binDir, "npm");
  if (existsSync(npmCli)) {
    return {
      command: process.execPath,
      args: [npmCli]
    };
  }

  return {
    command: "npm",
    args: []
  };
}

async function getMissingRuntimeDependencies(packageRoot: string) {
  const packageJsonPath = path.join(packageRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const dependencyNames = Object.keys(packageJson.dependencies ?? {});

  return dependencyNames.filter((dependencyName) =>
    !existsSync(path.join(packageRoot, "node_modules", dependencyName, "package.json"))
  );
}

async function installMissingRuntimeDependencies(packageRoot: string, logPath: string) {
  const { command, args } = getNpmInvocation();
  const logFd = openRuntimeLogFile(logPath);

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, [...args, "install", "--omit=dev", "--silent", "--ignore-scripts"], {
        cwd: packageRoot,
        env: process.env,
        stdio: ["ignore", logFd, logFd]
      });

      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`npm dependency install exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}`));
      });
    });
  } finally {
    closeSync(logFd);
  }
}

async function ensurePackagedRuntimeDependencies(plan: ForgeRuntimeLaunchPlan, config: ForgePluginConfig) {
  if (!isPackagedServerPlan(plan)) {
    return;
  }

  const missingDependencies = await getMissingRuntimeDependencies(plan.packageRoot);
  if (missingDependencies.length === 0) {
    return;
  }

  const logPath = getRuntimeLogPath(config);
  managedRuntimeLogPath = logPath;
  const installKey = plan.packageRoot;
  const existingInstall = dependencyInstallPromises.get(installKey);
  if (existingInstall) {
    return existingInstall;
  }

  const installPromise = installMissingRuntimeDependencies(plan.packageRoot, logPath)
    .catch((error) => {
      throw new Error(
        `Forge runtime dependencies are missing (${missingDependencies.join(", ")}) and automatic install failed. Check logs at ${logPath}. Cause: ${error instanceof Error ? error.message : String(error)}`
      );
    })
    .finally(() => {
      dependencyInstallPromises.delete(installKey);
    });

  dependencyInstallPromises.set(installKey, installPromise);
  return installPromise;
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

async function probeForgeRuntime(config: ForgePluginConfig, timeoutMs: number): Promise<ForgeRuntimeProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/api/v1/health", config.baseUrl), {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-forge-runtime-probe": "1"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      return { healthy: false, pid: null, storageRoot: null, basePath: null };
    }
    const payload = (await response.json()) as {
      runtime?: {
        pid?: unknown;
        storageRoot?: unknown;
        basePath?: unknown;
      };
    };
    return {
      healthy: true,
      pid: typeof payload.runtime?.pid === "number" && Number.isFinite(payload.runtime.pid) ? Math.trunc(payload.runtime.pid) : null,
      storageRoot: typeof payload.runtime?.storageRoot === "string" ? path.resolve(payload.runtime.storageRoot) : null,
      basePath: typeof payload.runtime?.basePath === "string" ? payload.runtime.basePath : null
    };
  } catch {
    return { healthy: false, pid: null, storageRoot: null, basePath: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function adoptManagedRuntimeState(config: ForgePluginConfig, probe: ForgeRuntimeProbe) {
  if (probe.pid === null || !processExists(probe.pid)) {
    return false;
  }
  await writeRuntimeState(config, probe.pid);
  return true;
}

async function spawnManagedRuntime(config: ForgePluginConfig, plan: ForgeRuntimeLaunchPlan) {
  const isPackagedServer = isPackagedServerPlan(plan);
  const args = isPackagedServer ? [plan.entryFile] : [plan.entryFile, path.join(plan.packageRoot, "server", "src", "index.ts")];
  const logPath = getRuntimeLogPath(config);
  const logFd = openRuntimeLogFile(logPath);
  const child = spawn(process.execPath, args, {
    cwd: plan.packageRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(config.port),
      FORGE_BASE_PATH: "/forge/",
      ...(config.dataRoot ? { FORGE_DATA_ROOT: config.dataRoot } : {})
    },
    stdio: ["ignore", logFd, logFd],
    detached: true
  });
  closeSync(logFd);

  child.unref();
  managedRuntimeLogPath = logPath;
  lastRuntimeExitDetails = null;
  child.once("exit", (code, signal) => {
    lastRuntimeExitDetails = {
      pid: child.pid ?? -1,
      code,
      signal,
      logPath
    };
    if (managedRuntimeChild === child) {
      managedRuntimeChild = null;
      managedRuntimeKey = null;
    }
    void clearRuntimeState(config);
  });

  managedRuntimeChild = child;
  managedRuntimeKey = runtimeKey(config);
  try {
    await writeRuntimeState(config, child.pid!);
  } catch (error) {
    managedRuntimeChild = null;
    managedRuntimeKey = null;
    try {
      process.kill(child.pid!, "SIGTERM");
    } catch {
      // If the child already exited we still want to surface the state-write failure.
    }
    throw new Error(
      `Forge local runtime started on ${config.baseUrl}, but the plugin could not persist its state. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function formatRuntimeFailure(details: ForgeRuntimeExitDetails | null, config: ForgePluginConfig) {
  if (!details) {
    return `Forge local runtime did not become healthy at ${config.baseUrl} within ${STARTUP_TIMEOUT_MS}ms`;
  }

  const suffix = details.logPath ? ` Check logs at ${details.logPath}.` : "";
  if (details.signal) {
    return `Forge local runtime exited before becoming healthy at ${config.baseUrl} (signal ${details.signal}).${suffix}`;
  }
  if (typeof details.code === "number") {
    return `Forge local runtime exited before becoming healthy at ${config.baseUrl} (code ${details.code}).${suffix}`;
  }
  return `Forge local runtime exited before becoming healthy at ${config.baseUrl}.${suffix}`;
}

async function waitForRuntime(config: ForgePluginConfig, timeoutMs: number, expectedPid: number | null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isForgeHealthy(config, HEALTHCHECK_TIMEOUT_MS)) {
      return;
    }
    if (expectedPid !== null && lastRuntimeExitDetails?.pid === expectedPid) {
      throw new Error(formatRuntimeFailure(lastRuntimeExitDetails, config));
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTHCHECK_INTERVAL_MS));
  }
  throw new Error(formatRuntimeFailure(lastRuntimeExitDetails, config));
}

export async function ensureForgeRuntimeReady(config: ForgePluginConfig) {
  if (!isLocalOrigin(config.origin)) {
    return;
  }

  const expectedDataRoot = getExpectedDataRoot(config);
  const initialProbe = await probeForgeRuntime(config, HEALTHCHECK_TIMEOUT_MS);
  if (initialProbe.healthy && isExpectedDataRoot(expectedDataRoot, initialProbe.storageRoot)) {
    const existingState = await readRuntimeState(config);
    if (!existingState) {
      await adoptManagedRuntimeState(config, initialProbe);
    }
    return;
  }

  const savedState = await readRuntimeState(config);
  if (savedState && !processExists(savedState.pid)) {
    await clearRuntimeState(config);
  } else if (savedState && processExists(savedState.pid)) {
    if (initialProbe.healthy && !isExpectedDataRoot(expectedDataRoot, initialProbe.storageRoot)) {
      await stopForgeRuntime(config);
    } else {
      try {
        await waitForRuntime(config, EXISTING_RUNTIME_GRACE_MS, null);
        return;
      } catch {
        await stopForgeRuntime(config);
      }
    }
  } else if (initialProbe.healthy) {
    if (!isExpectedDataRoot(expectedDataRoot, initialProbe.storageRoot)) {
      throw new Error(formatRuntimeDataRootMismatch(config, expectedDataRoot!, initialProbe.storageRoot));
    }
    try {
      await waitForRuntime(config, EXISTING_RUNTIME_GRACE_MS, null);
      return;
    } catch {
      // There is no plugin-managed pid to stop here; fall through into normal startup handling.
    }
  }

  const key = runtimeKey(config);
  if (startupPromise && (startupRuntimeKey === null || startupRuntimeKey === key)) {
    return startupPromise;
  }

  const plan = resolveLaunchPlan();
  if (!plan) {
    return;
  }

  startupPromise = (async () => {
    const probeBeforeStart = await probeForgeRuntime(config, HEALTHCHECK_TIMEOUT_MS);
    if (probeBeforeStart.healthy && isExpectedDataRoot(expectedDataRoot, probeBeforeStart.storageRoot)) {
      return;
    }
    startupRuntimeKey = runtimeKey(config);
    if (!(await isPortAvailable("127.0.0.1", config.port))) {
      await relocateLocalRuntimePort(config);
      startupRuntimeKey = runtimeKey(config);
      const probeAfterRelocation = await probeForgeRuntime(config, HEALTHCHECK_TIMEOUT_MS);
      if (probeAfterRelocation.healthy && isExpectedDataRoot(expectedDataRoot, probeAfterRelocation.storageRoot)) {
        return;
      }
    }
    await ensurePackagedRuntimeDependencies(plan, config);
    if (!managedRuntimeChild || managedRuntimeKey !== key || managedRuntimeChild.killed) {
      await spawnManagedRuntime(config, plan);
    }
    await waitForRuntime(config, STARTUP_TIMEOUT_MS, managedRuntimeChild?.pid ?? null);
    const probeAfterStart = await probeForgeRuntime(config, HEALTHCHECK_TIMEOUT_MS);
    if (!probeAfterStart.healthy || !isExpectedDataRoot(expectedDataRoot, probeAfterStart.storageRoot)) {
      throw new Error(formatRuntimeDataRootMismatch(config, expectedDataRoot!, probeAfterStart.storageRoot));
    }
  })().finally(() => {
    startupPromise = null;
    startupRuntimeKey = null;
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

  const expectedDataRoot = getExpectedDataRoot(config);
  const probe = await probeForgeRuntime(config, HEALTHCHECK_TIMEOUT_MS);
  let existingState = await readRuntimeState(config);
  if (!existingState && probe.healthy && isExpectedDataRoot(expectedDataRoot, probe.storageRoot)) {
    const adopted = await adoptManagedRuntimeState(config, probe);
    if (adopted) {
      existingState = await readRuntimeState(config);
    }
  }
  if (probe.healthy && !isExpectedDataRoot(expectedDataRoot, probe.storageRoot)) {
    return {
      ok: false,
      started: false,
      managed: Boolean(existingState),
      message: formatRuntimeDataRootMismatch(config, expectedDataRoot!, probe.storageRoot),
      pid: existingState?.pid ?? null,
      baseUrl: config.baseUrl
    };
  }
  if (!existingState && probe.healthy) {
    return {
      ok: true,
      started: false,
      managed: false,
      message: `Forge is already running on ${config.baseUrl}, but it does not look like a plugin-managed runtime.`,
      pid: null,
      baseUrl: config.baseUrl
    };
  }

  if (existingState && processExists(existingState.pid) && probe.healthy) {
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
  if (!state && (await isForgeHealthy(config, HEALTHCHECK_TIMEOUT_MS))) {
    return {
      ok: true,
      started: false,
      managed: false,
      message: `Forge is healthy on ${config.baseUrl}, but it does not look like a plugin-managed runtime.`,
      pid: null,
      baseUrl: config.baseUrl
    };
  }

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
  const expectedDataRoot = getExpectedDataRoot(config);
  const probe = await probeForgeRuntime(config, HEALTHCHECK_TIMEOUT_MS);
  const healthy = probe.healthy;
  let state = await readRuntimeState(config);
  if (!state && healthy && isExpectedDataRoot(expectedDataRoot, probe.storageRoot)) {
    const adopted = await adoptManagedRuntimeState(config, probe);
    if (adopted) {
      state = await readRuntimeState(config);
    }
  }
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
    if (!isExpectedDataRoot(expectedDataRoot, probe.storageRoot)) {
      return {
        ok: false,
        running: true,
        healthy: true,
        managed: true,
        message: formatRuntimeDataRootMismatch(config, expectedDataRoot!, probe.storageRoot),
        pid,
        baseUrl: config.baseUrl
      };
    }
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
    if (!isExpectedDataRoot(expectedDataRoot, probe.storageRoot)) {
      return {
        ok: false,
        running: true,
        healthy: true,
        managed: false,
        message: formatRuntimeDataRootMismatch(config, expectedDataRoot!, probe.storageRoot),
        pid: null,
        baseUrl: config.baseUrl
      };
    }
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
