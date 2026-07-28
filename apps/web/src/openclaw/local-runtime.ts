import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ForgePluginConfig } from "./api-client.js";
import { resolveLocalOwnerBrokerDescriptor } from "./local-owner-client.js";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);
const STARTUP_TIMEOUT_MS = 15_000;
const HEALTHCHECK_TIMEOUT_MS = 1_500;
const HEALTHCHECK_INTERVAL_MS = 250;
const EXISTING_RUNTIME_GRACE_MS = 3_000;
const STARTUP_LOCK_STALE_MS = STARTUP_TIMEOUT_MS * 2;
const MAX_PORT_SCAN_ATTEMPTS = 20;
const FORGE_PLUGIN_ID = "forge-openclaw-plugin";

type ForgeRuntimeLaunchPlan = {
  packageRoot: string;
  entryFile: string;
  mode: "packaged" | "source";
  sourceEntryFile?: string;
};

type ForgeSourceRuntimeCandidate = {
  root: string;
  entryFile: string;
  tsxCli: string;
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

type ForgeRuntimeStartupLockOwner = {
  pid: number;
  acquiredAt: string;
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

function getRuntimeStateDir() {
  return path.join(homedir(), ".openclaw", "run", FORGE_PLUGIN_ID);
}

function getRuntimeStartupLockPath(config: ForgePluginConfig) {
  return path.join(
    getRuntimeStateDir(),
    `${getRuntimeStateOrigin(config)}-${config.port}.startup.lock`
  );
}

function getRuntimeStateOrigin(config: ForgePluginConfig) {
  return new URL(config.origin).hostname.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
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

async function readRuntimeStartupLockOwner(
  lockPath: string
): Promise<ForgeRuntimeStartupLockOwner | null> {
  try {
    const payload = await readFile(path.join(lockPath, "owner.json"), "utf8");
    const parsed = JSON.parse(payload) as Partial<ForgeRuntimeStartupLockOwner>;
    if (
      typeof parsed.pid !== "number" ||
      !Number.isFinite(parsed.pid) ||
      typeof parsed.acquiredAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.acquiredAt))
    ) {
      return null;
    }
    return {
      pid: Math.trunc(parsed.pid),
      acquiredAt: parsed.acquiredAt
    };
  } catch {
    return null;
  }
}

async function acquireRuntimeStartupLock(
  config: ForgePluginConfig
): Promise<(() => Promise<void>) | null> {
  const lockPath = getRuntimeStartupLockPath(config);
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  await mkdir(getRuntimeStateDir(), { recursive: true });

  while (Date.now() < deadline) {
    try {
      await mkdir(lockPath);
      const owner: ForgeRuntimeStartupLockOwner = {
        pid: process.pid,
        acquiredAt: new Date().toISOString()
      };
      await writeFile(
        path.join(lockPath, "owner.json"),
        `${JSON.stringify(owner, null, 2)}\n`,
        "utf8"
      );
      return async () => {
        await rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
        throw error;
      }
    }

    const probe = await probeForgeRuntime(config, HEALTHCHECK_TIMEOUT_MS);
    if (probe.healthy) {
      return null;
    }

    const owner = await readRuntimeStartupLockOwner(lockPath);
    const ownerIsStale =
      owner !== null &&
      (!processExists(owner.pid) ||
        Date.now() - Date.parse(owner.acquiredAt) > STARTUP_LOCK_STALE_MS);
    if (ownerIsStale) {
      await rm(lockPath, { recursive: true, force: true });
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, HEALTHCHECK_INTERVAL_MS));
  }

  throw new Error(
    `Forge runtime startup on ${config.baseUrl} is already owned by another process and did not become healthy within ${STARTUP_TIMEOUT_MS}ms.`
  );
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

function isTruthyEnvFlag(value: string | undefined) {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function shouldEnableManagedDevWeb(plan: ForgeRuntimeLaunchPlan, env: NodeJS.ProcessEnv = process.env) {
  return plan.mode === "source" || isTruthyEnvFlag(env.FORGE_OPENCLAW_DEV);
}

function getCurrentModuleRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function uniquePaths(paths: string[]) {
  return Array.from(new Set(paths.map((candidate) => path.resolve(candidate))));
}

function buildLaunchPlanSearchPaths(moduleRoot: string) {
  const repoRoot = path.resolve(moduleRoot, "..", "..");
  const sourceRoots = uniquePaths([
    repoRoot,
    path.resolve(moduleRoot, ".."),
    moduleRoot,
    path.resolve(moduleRoot, "..", "..", "..")
  ]);
  const sourceEntries = sourceRoots.flatMap((root) => [
    path.join(root, "apps", "api", "src", "index.ts"),
    path.join(root, "server", "src", "index.ts")
  ]);
  const tsxCliCandidates = sourceRoots.map((root) =>
    path.join(root, "node_modules", "tsx", "dist", "cli.mjs")
  );
  return {
    packagedEntries: [
      path.join(moduleRoot, "server", "index.js"),
      path.join(moduleRoot, "dist", "server", "apps", "api", "src", "index.js"),
      path.join(moduleRoot, "dist", "server", "index.js"),
      path.join(moduleRoot, "dist", "server", "src", "index.js"),
      path.join(moduleRoot, "dist", "server", "server", "src", "index.js")
    ],
    packagedMigrationCandidates: [
      path.join(moduleRoot, "server", "migrations"),
      path.join(moduleRoot, "dist", "server", "apps", "api", "migrations"),
      path.join(moduleRoot, "dist", "server", "server", "migrations")
    ],
    sourceRoots,
    sourceEntries,
    tsxCliCandidates,
    repoRoot
  };
}

function formatLaunchPlanFailure(moduleRoot: string) {
  const paths = buildLaunchPlanSearchPaths(moduleRoot);
  return [
    "Forge local runtime could not find a launchable server entry.",
    `Packaged entry candidates: ${paths.packagedEntries.join(", ")}.`,
    `Expected migrations at: ${paths.packagedMigrationCandidates.join(", ")}.`,
    `Source entry candidates: ${paths.sourceEntries.join(", ")}.`,
    `tsx candidates: ${paths.tsxCliCandidates.join(", ")}.`
  ].join(" ");
}

function resolveSourceRuntimeCandidate(paths: ReturnType<typeof buildLaunchPlanSearchPaths>): ForgeSourceRuntimeCandidate | null {
  for (const sourceRoot of paths.sourceRoots) {
    const entryFileCandidates = [
      path.join(sourceRoot, "apps", "api", "src", "index.ts"),
      path.join(sourceRoot, "server", "src", "index.ts")
    ];
    const tsxCli = path.join(sourceRoot, "node_modules", "tsx", "dist", "cli.mjs");
    for (const entryFile of entryFileCandidates) {
      if (existsSync(entryFile) && existsSync(tsxCli)) {
        return {
          root: sourceRoot,
          entryFile,
          tsxCli
        };
      }
    }
  }
  return null;
}

function resolveForgeSourceCheckoutCandidate(
  candidate: ForgeSourceRuntimeCandidate | null
): ForgeSourceRuntimeCandidate | null {
  const isCheckout =
    candidate !== null &&
    existsSync(path.join(candidate.root, ".git")) &&
    existsSync(path.join(candidate.root, "package.json")) &&
    existsSync(path.join(candidate.root, "plugins", "openclaw", "package.json"));
  return isCheckout ? candidate : null;
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
  return plan.mode === "packaged";
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

export function resolveLaunchPlan(
  moduleRoot = getCurrentModuleRoot()
): ForgeRuntimeLaunchPlan | null {
  const paths = buildLaunchPlanSearchPaths(moduleRoot);
  const sourceCandidate = resolveSourceRuntimeCandidate(paths);
  const sourceCheckoutCandidate =
    resolveForgeSourceCheckoutCandidate(sourceCandidate);

  if (isTruthyEnvFlag(process.env.FORGE_OPENCLAW_DEV)) {
    if (sourceCandidate) {
      return {
        packageRoot: sourceCandidate.root,
        entryFile: sourceCandidate.tsxCli,
        mode: "source",
        sourceEntryFile: sourceCandidate.entryFile
      };
    }
    throw new Error(formatLaunchPlanFailure(moduleRoot));
  }

  // A linked development install contains both a generated package runtime and
  // the current Forge checkout. Prefer the checkout so an integration cannot
  // replace a freshly restarted source server with an older generated bundle.
  if (sourceCheckoutCandidate) {
    return {
      packageRoot: sourceCheckoutCandidate.root,
      entryFile: sourceCheckoutCandidate.tsxCli,
      mode: "source",
      sourceEntryFile: sourceCheckoutCandidate.entryFile
    };
  }

  // Published or linked plugin package runtime.
  const packagedEntry = paths.packagedEntries.find((candidate) => existsSync(candidate));
  const packagedMigrations = paths.packagedMigrationCandidates.find((candidate) => existsSync(candidate));
  if (packagedEntry && packagedMigrations) {
    return {
      packageRoot: moduleRoot,
      entryFile: packagedEntry,
      mode: "packaged"
    };
  }

  // Source-tree fallback for local development before packaging.
  if (sourceCandidate) {
    return {
      packageRoot: sourceCandidate.root,
      entryFile: sourceCandidate.tsxCli,
      mode: "source",
      sourceEntryFile: sourceCandidate.entryFile
    };
  }

  return null;
}

async function isForgeHealthy(config: ForgePluginConfig, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/api/health", config.baseUrl), {
      method: "GET",
      headers: {
        accept: "application/json"
      },
      signal: controller.signal
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as {
      ok?: unknown;
      app?: unknown;
      security?: unknown;
    };
    return (
      payload.ok === true &&
      payload.app === "forge" &&
      payload.security === "credential-required"
    );
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
    const response = await fetch(new URL("/api/health", config.baseUrl), {
      method: "GET",
      headers: {
        accept: "application/json"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      return { healthy: false, pid: null, storageRoot: null, basePath: null };
    }
    const payload = (await response.json()) as {
      ok?: unknown;
      app?: unknown;
      security?: unknown;
    };
    const healthy =
      payload.ok === true &&
      payload.app === "forge" &&
      payload.security === "credential-required";
    return {
      healthy,
      pid: null,
      storageRoot: null,
      basePath: null
    };
  } catch {
    return { healthy: false, pid: null, storageRoot: null, basePath: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function spawnManagedRuntime(config: ForgePluginConfig, plan: ForgeRuntimeLaunchPlan) {
  const isPackagedServer = isPackagedServerPlan(plan);
  const args = isPackagedServer
    ? [plan.entryFile]
    : [plan.entryFile, plan.sourceEntryFile ?? path.join(plan.packageRoot, "apps", "api", "src", "index.ts")];
  const logPath = getRuntimeLogPath(config);
  const logFd = openRuntimeLogFile(logPath);
  const enableManagedDevWeb = shouldEnableManagedDevWeb(plan);
  const ownerBroker = resolveLocalOwnerBrokerDescriptor();
  const child = spawn(process.execPath, args, {
    cwd: plan.packageRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(config.port),
      FORGE_BASE_PATH: "/forge/",
      ...(ownerBroker
        ? {
            FORGE_OWNER_BROKER_BIN: ownerBroker.binaryPath,
            FORGE_OWNER_BROKER_SHA256: ownerBroker.binarySha256
          }
        : {}),
      ...(enableManagedDevWeb
        ? {
            FORGE_DEV_WEB_ORIGIN:
              process.env.FORGE_DEV_WEB_ORIGIN ?? "http://127.0.0.1:3027/forge/"
          }
        : {}),
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

  const initialProbe = await probeForgeRuntime(config, HEALTHCHECK_TIMEOUT_MS);
  if (initialProbe.healthy) {
    return;
  }

  const savedState = await readRuntimeState(config);
  if (savedState && !processExists(savedState.pid)) {
    await clearRuntimeState(config);
  } else if (savedState && processExists(savedState.pid)) {
    try {
      await waitForRuntime(config, EXISTING_RUNTIME_GRACE_MS, null);
      return;
    } catch {
      // A persisted PID is not sufficient proof of manager ownership. Never
      // signal it from readiness detection; normal port handling below decides
      // whether a new runtime may safely start.
    }
  }

  const key = runtimeKey(config);
  if (startupPromise && (startupRuntimeKey === null || startupRuntimeKey === key)) {
    return startupPromise;
  }

  const plan = resolveLaunchPlan();
  if (!plan) {
    throw new Error(formatLaunchPlanFailure(getCurrentModuleRoot()));
  }

  startupPromise = (async () => {
    const releaseStartupLock = await acquireRuntimeStartupLock(config);
    if (!releaseStartupLock) {
      return;
    }
    try {
      const probeBeforeStart = await probeForgeRuntime(
        config,
        HEALTHCHECK_TIMEOUT_MS
      );
      if (
        probeBeforeStart.healthy
      ) {
        return;
      }
      startupRuntimeKey = runtimeKey(config);
      if (!(await isPortAvailable("127.0.0.1", config.port))) {
        await relocateLocalRuntimePort(config);
        startupRuntimeKey = runtimeKey(config);
        const probeAfterRelocation = await probeForgeRuntime(
          config,
          HEALTHCHECK_TIMEOUT_MS
        );
        if (
          probeAfterRelocation.healthy
        ) {
          return;
        }
      }
      await ensurePackagedRuntimeDependencies(plan, config);
      if (
        !managedRuntimeChild ||
        managedRuntimeKey !== key ||
        managedRuntimeChild.killed
      ) {
        await spawnManagedRuntime(config, plan);
      }
      await waitForRuntime(
        config,
        STARTUP_TIMEOUT_MS,
        managedRuntimeChild?.pid ?? null
      );
      const probeAfterStart = await probeForgeRuntime(
        config,
        HEALTHCHECK_TIMEOUT_MS
      );
      if (
        !probeAfterStart.healthy
      ) {
        throw new Error(formatRuntimeFailure(lastRuntimeExitDetails, config));
      }
    } finally {
      await releaseStartupLock();
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

  const probe = await probeForgeRuntime(config, HEALTHCHECK_TIMEOUT_MS);
  const existingState = await readRuntimeState(config);
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
    const ownedByCurrentManager =
      managedRuntimeChild?.pid === existingState.pid &&
      managedRuntimeKey === runtimeKey(config);
    return {
      ok: true,
      started: false,
      managed: ownedByCurrentManager,
      message: ownedByCurrentManager
        ? `Forge is already running on ${config.baseUrl}.`
        : `Forge is already running on ${config.baseUrl}; this plugin process is attached but does not own its lifecycle.`,
      pid: ownedByCurrentManager ? existingState.pid : null,
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

export function primeForgeRuntime(
  config: ForgePluginConfig,
  logger?: {
    warn?(message: string): void;
  }
) {
  void ensureForgeRuntimeReady(config).catch((error) => {
    logger?.warn?.(
      `Forge local runtime bootstrap failed for ${config.baseUrl}: ${error instanceof Error ? error.message : String(error)}`
    );
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

  if (
    managedRuntimeChild?.pid !== state.pid ||
    managedRuntimeKey !== runtimeKey(config)
  ) {
    return {
      ok: true,
      stopped: false,
      managed: false,
      message:
        "Forge is running, but this plugin process did not launch it. Stop it where it was started.",
      pid: null
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
  const probe = await probeForgeRuntime(config, HEALTHCHECK_TIMEOUT_MS);
  const healthy = probe.healthy;
  const state = await readRuntimeState(config);
  const managed =
    Boolean(state) &&
    managedRuntimeChild?.pid === state?.pid &&
    managedRuntimeKey === runtimeKey(config);
  const pid = managed ? (state?.pid ?? null) : null;

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
