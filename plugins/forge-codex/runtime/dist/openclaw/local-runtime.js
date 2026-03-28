import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);
const STARTUP_TIMEOUT_MS = 15_000;
const HEALTHCHECK_TIMEOUT_MS = 1_500;
const HEALTHCHECK_INTERVAL_MS = 250;
let managedRuntimeChild = null;
let managedRuntimeKey = null;
let startupPromise = null;
function runtimeKey(config) {
    return `${config.origin}:${config.port}`;
}
function isLocalOrigin(origin) {
    try {
        return LOCAL_HOSTNAMES.has(new URL(origin).hostname.toLowerCase());
    }
    catch {
        return false;
    }
}
function getCurrentModuleRoot() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}
function resolveLaunchPlan() {
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
async function isForgeHealthy(config, timeoutMs) {
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
    }
    catch {
        return false;
    }
    finally {
        clearTimeout(timeout);
    }
}
function spawnManagedRuntime(config, plan) {
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
    });
    managedRuntimeChild = child;
    managedRuntimeKey = runtimeKey(config);
}
async function waitForRuntime(config, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await isForgeHealthy(config, HEALTHCHECK_TIMEOUT_MS)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, HEALTHCHECK_INTERVAL_MS));
    }
    throw new Error(`Forge local runtime did not become healthy at ${config.baseUrl} within ${timeoutMs}ms`);
}
export async function ensureForgeRuntimeReady(config) {
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
export function primeForgeRuntime(config) {
    void ensureForgeRuntimeReady(config).catch(() => {
        // Keep plugin registration non-blocking. Failures surface on first real call.
    });
}
