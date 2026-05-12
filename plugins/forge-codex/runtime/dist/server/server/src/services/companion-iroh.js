import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logForgeDebug } from "../debug.js";
import { getEffectiveDataRoot } from "../db.js";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const companionIrohManifestPath = path.join(projectRoot, "companion-iroh", "Cargo.toml");
const DEFAULT_IROH_START_TIMEOUT_MS = 25_000;
const COMPANION_IROH_ALPN = "forge-companion/1";
const FORGE_IROH_AGENT = "forge";
let irohHostState = emptyIrohHostState();
export async function buildCompanionPairingTransport(input) {
    const requestApiBaseUrl = normalizeApiBaseUrl(input.requestApiBaseUrl);
    const requestUiBaseUrl = normalizeUiBaseUrl(input.requestUiBaseUrl) ??
        deriveUiBaseUrlFromApiBaseUrl(requestApiBaseUrl);
    if (input.requestedMode === "manual-http") {
        return manualHttpTransport(requestApiBaseUrl, requestUiBaseUrl, [
            "Manual HTTP/TCP pairing was explicitly requested."
        ]);
    }
    if (!shouldAutoStartIrohHost()) {
        return manualHttpTransport(requestApiBaseUrl, requestUiBaseUrl, [
            "Forge Iroh companion transport is unavailable in this runtime, so Forge fell back to direct HTTP."
        ]);
    }
    const snapshot = await ensureCompanionIrohHost(localForgeBaseUrl());
    if (snapshot.status === "ready" && snapshot.pairPayload) {
        return irohTransport({
            pairPayload: snapshot.pairPayload,
            alpn: snapshot.alpn ?? COMPANION_IROH_ALPN,
            localBaseUrl: snapshot.localBaseUrl,
            recreateCommand: snapshot.recreateCommand ?? undefined,
            startedAt: snapshot.startedAt ?? undefined,
            notes: [
                "Default pairing uses Forge's Rust Iroh transport over QUIC.",
                "The QR payload carries the Iroh node id, host token, optional relay, and ALPN forge-companion/1.",
                "Manual HTTP/TCP pairing remains available with --manual-http for advanced local setups."
            ]
        });
    }
    return manualHttpTransport(requestApiBaseUrl, requestUiBaseUrl, [
        snapshot.lastError ??
            "No Forge Iroh companion host could be started, so Forge fell back to direct HTTP."
    ]);
}
export function getCompanionIrohStatus() {
    return snapshotFor(irohHostState.pairPayload && irohHostState.child ? "ready" : "unavailable");
}
export async function stopCompanionIroh() {
    if (irohHostState.child && !irohHostState.child.killed) {
        irohHostState.child.kill("SIGTERM");
    }
    irohHostState = emptyIrohHostState();
}
export function companionIrohApiBaseUrlFromNodeId(nodeId) {
    return `forge-iroh://${nodeId.trim()}/api/v1`;
}
export function companionIrohUiBaseUrlFromNodeId(nodeId) {
    return `forge-iroh://${nodeId.trim()}/forge/`;
}
async function ensureCompanionIrohHost(localBaseUrl) {
    if (irohHostState.child &&
        !irohHostState.child.killed &&
        irohHostState.pairPayload &&
        irohHostState.localBaseUrl === localBaseUrl) {
        return snapshotFor("ready", localBaseUrl);
    }
    if (irohHostState.starting) {
        return irohHostState.starting;
    }
    irohHostState.starting = startCompanionIrohHost(localBaseUrl).finally(() => {
        irohHostState.starting = null;
    });
    return irohHostState.starting;
}
async function startCompanionIrohHost(localBaseUrl) {
    const stateDir = path.join(getEffectiveDataRoot(), "companion-iroh");
    await mkdir(stateDir, { recursive: true });
    const hostCommand = resolveIrohHostCommand({
        stateDir,
        localBaseUrl
    });
    if (!hostCommand) {
        irohHostState.lastError =
            "Forge companion Iroh host is unavailable. Build companion-iroh, install cargo, or set FORGE_COMPANION_IROH_BIN.";
        return snapshotFor("unavailable", localBaseUrl, stateDir);
    }
    if (irohHostState.child && !irohHostState.child.killed) {
        irohHostState.child.kill("SIGTERM");
    }
    const child = spawn(hostCommand.command, hostCommand.args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
    });
    irohHostState.child = child;
    irohHostState.pairPayload = null;
    irohHostState.alpn = null;
    irohHostState.localBaseUrl = localBaseUrl;
    irohHostState.stateDir = stateDir;
    irohHostState.recreateCommand = hostCommand.displayCommand;
    irohHostState.startedAt = new Date().toISOString();
    irohHostState.lastError = null;
    const seenLogs = [];
    let stdoutBuffer = "";
    const rememberLog = (chunk) => {
        const text = chunk.toString("utf8");
        seenLogs.push(text);
        if (seenLogs.length > 20) {
            seenLogs.shift();
        }
    };
    const parseReadyLines = (chunk) => {
        stdoutBuffer += chunk.toString("utf8");
        let lineEnd = stdoutBuffer.indexOf("\n");
        while (lineEnd >= 0) {
            const line = stdoutBuffer.slice(0, lineEnd).trim();
            stdoutBuffer = stdoutBuffer.slice(lineEnd + 1);
            applyIrohHostReadyLine(line);
            lineEnd = stdoutBuffer.indexOf("\n");
        }
    };
    child.stdout?.on("data", (chunk) => {
        rememberLog(chunk);
        parseReadyLines(chunk);
    });
    child.stderr?.on("data", rememberLog);
    child.once("error", (error) => {
        irohHostState.lastError = error.message;
    });
    child.once("exit", (code, signal) => {
        if (irohHostState.child === child) {
            irohHostState.child = null;
            irohHostState.pairPayload = null;
            irohHostState.alpn = null;
            irohHostState.lastError =
                code === 0
                    ? "Forge companion Iroh host stopped."
                    : `Forge companion Iroh host exited with ${signal ?? `code ${code}`}.`;
        }
    });
    const deadline = Date.now() + readIrohStartTimeoutMs();
    while (Date.now() < deadline) {
        if (irohHostState.pairPayload) {
            return snapshotFor("ready", localBaseUrl, stateDir);
        }
        if (!irohHostState.child) {
            break;
        }
        await delay(200);
    }
    if (!irohHostState.pairPayload) {
        irohHostState.lastError =
            irohHostState.lastError ??
                `Forge companion Iroh host did not report a ready pair payload. Recent output: ${seenLogs
                    .join("")
                    .trim()
                    .slice(-800)}`;
        if (irohHostState.child && !irohHostState.child.killed) {
            irohHostState.child.kill("SIGTERM");
        }
        return snapshotFor("error", localBaseUrl, stateDir);
    }
    return snapshotFor("ready", localBaseUrl, stateDir);
}
function applyIrohHostReadyLine(line) {
    if (!line) {
        return;
    }
    try {
        const parsed = JSON.parse(line);
        if (parsed.event !== "ready" || !isIrohPairPayload(parsed.pairPayload)) {
            return;
        }
        if (parsed.alpn !== undefined && parsed.alpn !== COMPANION_IROH_ALPN) {
            irohHostState.lastError = `Unsupported companion Iroh ALPN: ${String(parsed.alpn)}`;
            return;
        }
        irohHostState.pairPayload = parsed.pairPayload;
        irohHostState.alpn = COMPANION_IROH_ALPN;
    }
    catch {
        // Non-JSON stdout is treated as diagnostic output from cargo or the host.
    }
}
function isIrohPairPayload(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const payload = value;
    return (payload.v === 1 &&
        typeof payload.node_id === "string" &&
        payload.node_id.trim().length > 0 &&
        typeof payload.token === "string" &&
        payload.token.trim().length > 0 &&
        (payload.host_name === undefined || typeof payload.host_name === "string") &&
        (payload.relay === undefined || typeof payload.relay === "string"));
}
function irohTransport(input) {
    const nodeId = input.pairPayload.node_id;
    return {
        transportMode: "iroh",
        apiBaseUrl: companionIrohApiBaseUrlFromNodeId(nodeId),
        uiBaseUrl: companionIrohUiBaseUrlFromNodeId(nodeId),
        transport: {
            protocol: "iroh",
            provider: "forge-companion-iroh",
            status: "ready",
            localBaseUrl: input.localBaseUrl,
            nodeId,
            relay: input.pairPayload.relay,
            alpn: input.alpn,
            agent: FORGE_IROH_AGENT,
            pairPayload: input.pairPayload,
            recreateCommand: input.recreateCommand,
            startedAt: input.startedAt,
            notes: input.notes
        }
    };
}
function manualHttpTransport(apiBaseUrl, uiBaseUrl, notes) {
    return {
        transportMode: "manual-http",
        apiBaseUrl,
        uiBaseUrl,
        transport: {
            protocol: "http",
            provider: "manual-http",
            status: "ready",
            localBaseUrl: apiBaseUrl.replace(/\/api\/v1\/?$/u, ""),
            notes
        }
    };
}
function snapshotFor(status, localBaseUrl = localForgeBaseUrl(), stateDir = irohHostState.stateDir) {
    return {
        status,
        pairPayload: irohHostState.pairPayload,
        alpn: irohHostState.alpn,
        localBaseUrl,
        stateDir,
        recreateCommand: irohHostState.recreateCommand,
        startedAt: irohHostState.startedAt,
        lastError: irohHostState.lastError
    };
}
function resolveIrohHostCommand(input) {
    const hostArgs = [
        "host",
        "--state-dir",
        input.stateDir,
        "--local-base-url",
        input.localBaseUrl
    ];
    const explicitBin = process.env.FORGE_COMPANION_IROH_BIN?.trim();
    if (explicitBin) {
        const command = path.isAbsolute(explicitBin)
            ? explicitBin
            : path.resolve(projectRoot, explicitBin);
        return {
            command,
            args: hostArgs,
            displayCommand: `${shellQuote(command)} ${hostArgs.map(shellQuote).join(" ")}`
        };
    }
    for (const candidate of candidateIrohBinaries()) {
        if (existsSync(candidate)) {
            return {
                command: candidate,
                args: hostArgs,
                displayCommand: `${shellQuote(candidate)} ${hostArgs.map(shellQuote).join(" ")}`
            };
        }
    }
    const cargoPath = resolveCommand("cargo");
    const manifestPath = resolveCompanionIrohManifestPath();
    if (!cargoPath || !manifestPath) {
        return null;
    }
    const args = [
        "run",
        "--manifest-path",
        manifestPath,
        "--quiet",
        "--",
        ...hostArgs
    ];
    return {
        command: cargoPath,
        args,
        displayCommand: `${shellQuote(cargoPath)} ${args.map(shellQuote).join(" ")}`
    };
}
function candidateIrohBinaries() {
    const binaryName = process.platform === "win32" ? "forge-companion-iroh.exe" : "forge-companion-iroh";
    const platformKey = `${process.platform}-${process.arch}`;
    return [
        path.join(projectRoot, "companion-iroh", "target", "release", binaryName),
        path.join(projectRoot, "companion-iroh", "target", "debug", binaryName),
        path.join(projectRoot, "openclaw-plugin", "dist", "companion-iroh", platformKey, binaryName),
        path.join(projectRoot, "companion-iroh", platformKey, binaryName),
        path.join(projectRoot, "companion-iroh", binaryName)
    ];
}
function resolveCompanionIrohManifestPath() {
    const candidates = [
        companionIrohManifestPath,
        path.join(projectRoot, "companion-iroh-src", "Cargo.toml")
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
function shouldAutoStartIrohHost() {
    if (process.env.FORGE_COMPANION_IROH_DISABLED === "1") {
        return false;
    }
    if (process.env.FORGE_COMPANION_IROH_AUTOSTART === "0") {
        return false;
    }
    if (isTestRuntime() && !process.env.FORGE_COMPANION_IROH_BIN?.trim()) {
        return false;
    }
    return true;
}
function isTestRuntime() {
    return (process.env.NODE_ENV === "test" ||
        process.env.VITEST === "true" ||
        process.argv.some((arg) => arg === "--test" || arg.includes("vitest")));
}
function localForgeBaseUrl() {
    const configured = process.env.FORGE_COMPANION_IROH_LOCAL_BASE_URL?.trim();
    if (configured) {
        return configured.replace(/\/+$/u, "");
    }
    const port = Number(process.env.PORT ?? 4317);
    const safePort = Number.isInteger(port) && port > 0 ? port : 4317;
    return `http://127.0.0.1:${safePort}`;
}
function normalizeApiBaseUrl(value) {
    const trimmed = value.trim();
    try {
        const url = new URL(trimmed);
        url.pathname = url.pathname.replace(/\/+$/u, "");
        if (!url.pathname.endsWith("/api/v1")) {
            url.pathname = `${url.pathname}/api/v1`.replace(/\/{2,}/gu, "/");
        }
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/$/u, "");
    }
    catch {
        return trimmed;
    }
}
function normalizeUiBaseUrl(value) {
    if (!value?.trim()) {
        return null;
    }
    try {
        const url = new URL(value);
        url.pathname = "/forge/";
        url.search = "";
        url.hash = "";
        return url.toString();
    }
    catch {
        return null;
    }
}
function deriveUiBaseUrlFromApiBaseUrl(apiBaseUrl) {
    try {
        const url = new URL(apiBaseUrl);
        url.pathname = "/forge/";
        url.search = "";
        url.hash = "";
        return url.toString();
    }
    catch {
        return apiBaseUrl;
    }
}
function readIrohStartTimeoutMs() {
    const parsed = Number(process.env.FORGE_COMPANION_IROH_START_TIMEOUT_MS);
    if (Number.isFinite(parsed) && parsed > 0) {
        return Math.round(parsed);
    }
    return DEFAULT_IROH_START_TIMEOUT_MS;
}
function emptyIrohHostState() {
    return {
        child: null,
        pairPayload: null,
        alpn: null,
        localBaseUrl: null,
        stateDir: null,
        recreateCommand: null,
        startedAt: null,
        lastError: null,
        starting: null
    };
}
function resolveCommand(command) {
    const result = spawnSync(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? [command] : ["-v", command], {
        encoding: "utf8",
        shell: process.platform !== "win32"
    });
    if (result.status !== 0) {
        return null;
    }
    const resolved = result.stdout.split(/\r?\n/u)[0]?.trim();
    if (!resolved) {
        return null;
    }
    logForgeDebug(`[companion-iroh] resolved ${command} at ${resolved}`);
    return resolved;
}
function shellQuote(value) {
    if (/^[a-zA-Z0-9_./:=+-]+$/u.test(value)) {
        return value;
    }
    return `'${value.replaceAll("'", "'\\''")}'`;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
