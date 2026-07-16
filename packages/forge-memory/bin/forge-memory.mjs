#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { TextDecoder, TextEncoder } from "node:util";
import { createRequire } from "node:module";
import {
  inspectForgePeerRuntime,
  prepareForgePeerRuntime
} from "../lib/peer-runtime-install.mjs";
import YAML from "yaml";
import qrcode from "qrcode-terminal";
import open from "open";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError
} from "@modelcontextprotocol/sdk/types.js";

const require = createRequire(import.meta.url);
const VERSION = require("../package.json").version;
const RUNTIME_PACKAGE = "forge-openclaw-plugin";
const RUNTIME_PACKAGE_VERSION = VERSION;
const DEFAULT_ORIGIN = "http://127.0.0.1";
const DEFAULT_PORT = 4317;
const DEFAULT_WEB_PORT = 3027;
const FORGE_PLUGIN_ID = "forge-openclaw-plugin";
const ADAPTERS = ["openclaw", "hermes", "codex", "claude"];
const DEFAULT_UPDATE_BACKUP_CONFIRM_THRESHOLD_BYTES = 100 * 1024 * 1024;
const BACKUP_SKIP_TOP_LEVEL = new Set(["exports", "logs", "run", "runtime"]);

const color = {
  dim: (value) => `\u001b[2m${value}\u001b[22m`,
  green: (value) => `\u001b[32m${value}\u001b[39m`,
  yellow: (value) => `\u001b[33m${value}\u001b[39m`,
  red: (value) => `\u001b[31m${value}\u001b[39m`,
  cyan: (value) => `\u001b[36m${value}\u001b[39m`,
  bold: (value) => `\u001b[1m${value}\u001b[22m`
};

function parseArgs(argv) {
  const flags = {
    yes: false,
    dev: false,
    dryRun: false,
    noStart: false,
    json: false,
    skipPairIos: false,
    pairIos: false,
    skipAdapters: false,
    printUrl: false,
    removeData: false,
    removeAdapters: false,
    manualHttp: false,
    repair: false,
    noDoctor: false,
    enablePeer: false,
    disablePeer: false,
    enablePeerIroh: false,
    disablePeerIroh: false,
    allowLoopbackPeer: false
  };
  const values = { peerEndpoints: [] };
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--yes" || arg === "-y") flags.yes = true;
    else if (arg === "--dev") flags.dev = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--no-start") flags.noStart = true;
    else if (arg === "--json") flags.json = true;
    else if (arg === "--skip-pair-ios" || arg === "--no-pair-ios")
      flags.skipPairIos = true;
    else if (arg === "--pair-ios") flags.pairIos = true;
    else if (arg === "--skip-adapters") flags.skipAdapters = true;
    else if (arg === "--print-url") flags.printUrl = true;
    else if (arg === "--remove-data") flags.removeData = true;
    else if (arg === "--remove-adapters") flags.removeAdapters = true;
    else if (arg === "--manual-http" || arg === "--no-iroh")
      flags.manualHttp = true;
    else if (arg === "--repair") flags.repair = true;
    else if (arg === "--no-doctor") flags.noDoctor = true;
    else if (arg === "--enable-peer") flags.enablePeer = true;
    else if (arg === "--disable-peer") flags.disablePeer = true;
    else if (arg === "--enable-peer-iroh") flags.enablePeerIroh = true;
    else if (arg === "--disable-peer-iroh") flags.disablePeerIroh = true;
    else if (arg === "--allow-loopback-peer") flags.allowLoopbackPeer = true;
    else if (arg.startsWith("--output="))
      values.output = arg.slice("--output=".length);
    else if (arg === "--output") values.output = argv[++index];
    else if (arg.startsWith("--data-root="))
      values.dataRoot = arg.slice("--data-root=".length);
    else if (arg === "--data-root") values.dataRoot = argv[++index];
    else if (arg.startsWith("--adapters="))
      values.adapters = arg.slice("--adapters=".length);
    else if (arg === "--adapters") values.adapters = argv[++index];
    else if (arg.startsWith("--origin="))
      values.origin = arg.slice("--origin=".length);
    else if (arg === "--origin") values.origin = argv[++index];
    else if (arg.startsWith("--port="))
      values.port = arg.slice("--port=".length);
    else if (arg === "--port") values.port = argv[++index];
    else if (arg.startsWith("--web-port="))
      values.webPort = arg.slice("--web-port=".length);
    else if (arg === "--web-port") values.webPort = argv[++index];
    else if (arg.startsWith("--repo="))
      values.repo = arg.slice("--repo=".length);
    else if (arg === "--repo") values.repo = argv[++index];
    else if (arg.startsWith("--public-url="))
      values.publicUrl = arg.slice("--public-url=".length);
    else if (arg === "--public-url" || arg === "--phone-url")
      values.publicUrl = argv[++index];
    else if (arg.startsWith("--peer-endpoint="))
      values.peerEndpoints.push(arg.slice("--peer-endpoint=".length));
    else if (arg === "--peer-endpoint")
      values.peerEndpoints.push(argv[++index]);
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--version" || arg === "-v") flags.version = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (flags.enablePeer && flags.disablePeer) {
    throw new Error(
      "--enable-peer and --disable-peer cannot be used together."
    );
  }
  if (flags.enablePeerIroh && flags.disablePeerIroh) {
    throw new Error(
      "--enable-peer-iroh and --disable-peer-iroh cannot be used together."
    );
  }

  return {
    command: positionals[0] ?? "install",
    positionals,
    flags,
    values
  };
}

function homeDir() {
  return os.homedir();
}

function forgeHome() {
  return path.join(homeDir(), ".forge");
}

function configPath() {
  return path.join(forgeHome(), "config.json");
}

function runtimeStatePath() {
  return path.join(forgeHome(), "run", "forge-memory-runtime.json");
}

function logPath() {
  return path.join(forgeHome(), "logs", "forge-memory-runtime.log");
}

function runtimeInstallRoot() {
  return path.join(forgeHome(), "runtime");
}

function managedSkillsManifestPath() {
  return path.join(forgeHome(), "managed-skills.json");
}

function defaultDataRoot() {
  return forgeHome();
}

function normalizePort(value, fallback = DEFAULT_PORT) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535
    ? parsed
    : fallback;
}

function parsePeerDirectEndpoint(value, { allowLoopback = false } = {}) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 96 ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw new Error("A peer endpoint must be a bounded IP address and port.");
  }
  let host;
  let portText;
  if (value.startsWith("[")) {
    const match = /^\[([^\]]+)\]:(\d{1,5})$/.exec(value);
    if (!match || net.isIP(match[1]) !== 6) {
      throw new Error("A peer endpoint must use an IPv6 address in brackets.");
    }
    host = match[1].toLowerCase();
    portText = match[2];
  } else {
    const separator = value.lastIndexOf(":");
    if (separator <= 0 || net.isIP(value.slice(0, separator)) !== 4) {
      throw new Error("A peer endpoint must use an IPv4 address and port.");
    }
    host = value.slice(0, separator);
    portText = value.slice(separator + 1);
  }
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("A peer endpoint port must be between 1 and 65535.");
  }
  const loopback = host === "::1" || host.startsWith("127.");
  const unspecified = host === "::" || host === "0.0.0.0";
  if (unspecified) {
    throw new Error(
      "A peer endpoint must be an advertised host address, not wildcard."
    );
  }
  if (loopback && !allowLoopback) {
    throw new Error(
      "A loopback peer endpoint requires --allow-loopback-peer and is only useful for local testing."
    );
  }
  return net.isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
}

function normalizePeerDirectEndpoints(values, options = {}) {
  if (!Array.isArray(values)) {
    throw new Error("Peer endpoints must be a list.");
  }
  const endpoints = [
    ...new Set(values.map((value) => parsePeerDirectEndpoint(value, options)))
  ];
  if (endpoints.length > 8) {
    throw new Error("Forge supports at most eight direct peer endpoints.");
  }
  return endpoints;
}

function peerAddressCandidates() {
  const candidates = [];
  const interfaces = os.networkInterfaces();
  for (const interfaceName of Object.keys(interfaces).sort()) {
    for (const address of interfaces[interfaceName] ?? []) {
      const family = net.isIP(address.address);
      const normalized = address.address.toLowerCase();
      if (
        address.internal ||
        (family !== 4 && family !== 6) ||
        normalized === "0.0.0.0" ||
        normalized === "::" ||
        normalized.startsWith("169.254.") ||
        normalized.startsWith("fe80:")
      ) {
        continue;
      }
      candidates.push({ interfaceName, address: normalized, family });
    }
  }
  return candidates;
}

async function isAddressPortAvailable(host, port) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function discoverPeerDirectEndpoint() {
  for (const candidate of peerAddressCandidates()) {
    for (let port = 4318; port <= 4347; port += 1) {
      if (await isAddressPortAvailable(candidate.address, port)) {
        return candidate.family === 6
          ? `[${candidate.address}]:${port}`
          : `${candidate.address}:${port}`;
      }
    }
  }
  return null;
}

function normalizeAdapterList(value) {
  if (!value || value.trim().toLowerCase() === "detected") return null;
  if (value.trim().toLowerCase() === "none") return [];
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .filter((entry) => ADAPTERS.includes(entry));
}

function normalizeByteThreshold(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function updateBackupConfirmThresholdBytes() {
  return normalizeByteThreshold(
    process.env.FORGE_MEMORY_UPDATE_BACKUP_PROMPT_BYTES,
    DEFAULT_UPDATE_BACKUP_CONFIRM_THRESHOLD_BYTES
  );
}

function formatBytes(value) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Number(value) || 0;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 || amount >= 10 ? 0 : 1;
  return `${amount.toFixed(precision)} ${units[unitIndex]}`;
}

function baseUrl(config) {
  const url = new URL(config.origin || DEFAULT_ORIGIN);
  url.port = String(config.port || DEFAULT_PORT);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

function webUrl(config) {
  return `${baseUrl(config)}/forge/`;
}

function localHostHeader(config) {
  return `127.0.0.1:${config.port || DEFAULT_PORT}`;
}

function forgeApiUrl(config, pathname) {
  return new URL(pathname, baseUrl(config));
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readJsonSync(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function backupIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.bak-forge-memory-${stamp}`;
  await fsp.copyFile(filePath, backupPath);
  return backupPath;
}

async function writeJson(
  filePath,
  payload,
  { dryRun = false, backup = true } = {}
) {
  if (dryRun) return { filePath, backupPath: null, dryRun: true };
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const backupPath = backup ? await backupIfExists(filePath) : null;
  await fsp.writeFile(
    filePath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
  return { filePath, backupPath, dryRun: false };
}

async function writeText(
  filePath,
  content,
  { dryRun = false, backup = true } = {}
) {
  if (dryRun) return { filePath, backupPath: null, dryRun: true };
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const backupPath = backup ? await backupIfExists(filePath) : null;
  await fsp.writeFile(filePath, content, "utf8");
  return { filePath, backupPath, dryRun: false };
}

async function readConfig() {
  const config = await readJson(configPath(), {});
  const peerAllowLoopbackDirect = config?.peer?.allowLoopbackDirect === true;
  const peerIrohConfigured = typeof config?.peer?.irohEnabled === "boolean";
  return {
    version: VERSION,
    mode: config?.mode === "dev" ? "dev" : "packaged",
    origin: typeof config?.origin === "string" ? config.origin : DEFAULT_ORIGIN,
    port: normalizePort(config?.port, DEFAULT_PORT),
    webPort: normalizePort(config?.webPort, DEFAULT_WEB_PORT),
    dataRoot:
      typeof config?.dataRoot === "string"
        ? path.resolve(config.dataRoot)
        : defaultDataRoot(),
    adapters: Array.isArray(config?.adapters)
      ? config.adapters.filter((entry) => ADAPTERS.includes(entry))
      : [],
    updatedAt: typeof config?.updatedAt === "string" ? config.updatedAt : null,
    repo: typeof config?.repo === "string" ? config.repo : null,
    peerEnabled: config?.peer?.enabled === true,
    peerIrohEnabled: peerIrohConfigured && config?.peer?.irohEnabled === true,
    peerIrohConfigured,
    peerDirectEndpoints: normalizePeerDirectEndpoints(
      Array.isArray(config?.peer?.directEndpoints)
        ? config.peer.directEndpoints
        : [],
      { allowLoopback: peerAllowLoopbackDirect }
    ),
    peerAllowLoopbackDirect
  };
}

async function writeConfig(next, options) {
  const payload = {
    version: VERSION,
    mode: next.mode,
    origin: next.origin,
    port: next.port,
    webPort: next.webPort,
    dataRoot: path.resolve(next.dataRoot),
    adapters: next.adapters,
    repo: next.repo ?? null,
    peer: {
      enabled: next.peerEnabled === true,
      irohEnabled: next.peerIrohEnabled === true,
      directEndpoints: normalizePeerDirectEndpoints(
        next.peerDirectEndpoints ?? [],
        { allowLoopback: next.peerAllowLoopbackDirect === true }
      ),
      allowLoopbackDirect: next.peerAllowLoopbackDirect === true
    },
    updatedAt: new Date().toISOString()
  };
  return writeJson(configPath(), payload, options);
}

function commandExists(command) {
  const result =
    process.platform === "win32"
      ? spawnSync("where", [command], { stdio: "ignore" })
      : spawnSync("sh", ["-c", `command -v ${shellQuote(command)}`], {
          stdio: "ignore"
        });
  return result.status === 0;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function runCapture(command, args, timeoutMs = 2_000) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: timeoutMs
  });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout}${result.stderr}`.trim();
}

function binaryNameForPlatform() {
  return process.platform === "win32"
    ? "forge-companion-iroh.exe"
    : "forge-companion-iroh";
}

function candidateIrohRoots(config) {
  const roots = [];
  if (config.mode === "dev" && config.repo) {
    roots.push(config.repo);
    roots.push(path.join(config.repo, "plugins/openclaw", "dist"));
  }
  const pluginRoot = resolveOpenClawPluginRoot();
  if (pluginRoot) {
    roots.push(pluginRoot);
    roots.push(path.join(pluginRoot, "dist"));
  }
  return [...new Set(roots.map((entry) => path.resolve(entry)))];
}

function candidateIrohBinariesForInstall(config) {
  const binaryName = binaryNameForPlatform();
  const platformKey = `${process.platform}-${process.arch}`;
  const explicitBin = process.env.FORGE_COMPANION_IROH_BIN?.trim();
  return [
    ...(explicitBin ? [explicitBin] : []),
    ...candidateIrohRoots(config).flatMap((root) => [
      path.join(root, "companion-iroh", "target", "release", binaryName),
      path.join(root, "companion-iroh", "target", "debug", binaryName),
      path.join(root, "companion-iroh-src", "target", "release", binaryName),
      path.join(root, "companion-iroh-src", "target", "debug", binaryName),
      path.join(root, "companion-iroh", platformKey, binaryName),
      path.join(root, "companion-iroh", binaryName)
    ])
  ];
}

function findIrohBinaryForInstall(config) {
  return candidateIrohBinariesForInstall(config).find((candidate) =>
    fs.existsSync(candidate)
  );
}

function candidateIrohManifestsForInstall(config) {
  return candidateIrohRoots(config).flatMap((root) => [
    path.join(root, "companion-iroh", "Cargo.toml"),
    path.join(root, "companion-iroh-src", "Cargo.toml")
  ]);
}

function findIrohManifestForInstall(config) {
  return candidateIrohManifestsForInstall(config).find((candidate) =>
    fs.existsSync(candidate)
  );
}

function rustInstallGuidance() {
  if (process.platform === "darwin") {
    return [
      "Install Apple's command line tools first if prompted: xcode-select --install",
      "Then install Rust with the official minimal installer:",
      "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal",
      "Restart the terminal or run: source ~/.cargo/env"
    ];
  }
  if (process.platform === "linux") {
    return [
      "Install build tools with your system package manager, for example: sudo apt-get install -y build-essential pkg-config libssl-dev",
      "Then install Rust with the official minimal installer:",
      "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal",
      "Restart the terminal or run: source ~/.cargo/env"
    ];
  }
  if (process.platform === "win32") {
    return [
      "Install Rustup for Windows:",
      "winget install Rustlang.Rustup",
      "Then reopen PowerShell and rerun: npx forge-memory install"
    ];
  }
  return [
    "Install Rust/Cargo from https://rustup.rs, then rerun: npx forge-memory install"
  ];
}

function tailscaleInstallPlan() {
  if (process.platform === "darwin") {
    return {
      installable: true,
      autoInstallCommand: commandExists("brew")
        ? { command: "brew", args: ["install", "--cask", "tailscale"] }
        : null,
      guidance: [
        "Install Tailscale for macOS from https://tailscale.com/download/mac or with Homebrew: brew install --cask tailscale",
        "Open Tailscale, sign in, and make sure this Mac and the iPhone are in the same tailnet.",
        "Then rerun: npx forge-memory pair-ios"
      ]
    };
  }
  if (process.platform === "linux") {
    return {
      installable: true,
      autoInstallCommand: commandExists("curl")
        ? {
            command: "sh",
            args: ["-c", "curl -fsSL https://tailscale.com/install.sh | sh"]
          }
        : null,
      guidance: [
        "Install Tailscale with your package manager or the official installer: curl -fsSL https://tailscale.com/install.sh | sh",
        "Start and authenticate it: sudo tailscale up",
        "Then rerun: npx forge-memory pair-ios"
      ]
    };
  }
  if (process.platform === "win32") {
    return {
      installable: true,
      autoInstallCommand: commandExists("winget")
        ? {
            command: "winget",
            args: [
              "install",
              "--id",
              "Tailscale.Tailscale",
              "-e",
              "--source",
              "winget",
              "--accept-package-agreements",
              "--accept-source-agreements"
            ]
          }
        : null,
      guidance: [
        "Install Tailscale for Windows from https://tailscale.com/download/windows or with winget: winget install Tailscale.Tailscale",
        "Sign in, make sure this PC and the iPhone are in the same tailnet, then rerun: npx forge-memory pair-ios"
      ]
    };
  }
  return {
    installable: false,
    autoInstallCommand: null,
    guidance: [
      "Install Tailscale from https://tailscale.com/download if your platform supports it, then rerun: npx forge-memory pair-ios"
    ]
  };
}

function tailscaleAutodetectDisabled() {
  return ["1", "true", "yes"].includes(
    String(
      process.env.FORGE_MEMORY_SKIP_TAILSCALE_AUTODETECT ?? ""
    ).toLowerCase()
  );
}

function parseTailscaleStatus(raw) {
  if (!raw) return { running: false, authenticated: false, dnsName: null };
  try {
    const payload = JSON.parse(raw);
    const self = payload.Self ?? payload.self ?? null;
    const dnsName = String(self?.DNSName ?? self?.dnsName ?? "")
      .trim()
      .replace(/\.$/, "");
    const backendState = String(
      payload.BackendState ?? payload.backendState ?? ""
    );
    const running = backendState.toLowerCase() === "running";
    return {
      running,
      authenticated: running && Boolean(dnsName),
      dnsName: dnsName || null,
      backendState: backendState || null
    };
  } catch {
    return { running: false, authenticated: false, dnsName: null };
  }
}

function normalizeForgePublicUiUrl(value) {
  const normalized = normalizePublicPairingUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (
    !url.pathname ||
    url.pathname === "/" ||
    url.pathname.startsWith("/api/")
  ) {
    url.pathname = "/forge/";
  }
  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function forgePublicHealthUrl(publicUiUrl) {
  const url = new URL(publicUiUrl);
  url.pathname = "/api/v1/health";
  url.search = "";
  url.hash = "";
  return url;
}

function publicUrlFallbackMode(publicUrl) {
  try {
    const host = new URL(publicUrl).hostname.toLowerCase();
    return host.endsWith(".ts.net") ? "tailscale" : "fixed-ip";
  } catch {
    return "fixed-ip";
  }
}

function detectTailscaleState() {
  if (tailscaleAutodetectDisabled()) {
    return {
      installed: false,
      running: false,
      authenticated: false,
      publicUrl: null,
      disabled: true
    };
  }
  if (!commandExists("tailscale")) {
    return {
      installed: false,
      running: false,
      authenticated: false,
      publicUrl: null,
      installPlan: tailscaleInstallPlan()
    };
  }
  const status = parseTailscaleStatus(
    runCapture("tailscale", ["status", "--json"], 4_000)
  );
  const envPublicUrl = normalizeForgePublicUiUrl(
    process.env.FORGE_MEMORY_TAILSCALE_PUBLIC_URL
  );
  const publicUrl =
    envPublicUrl ??
    (status.dnsName ? `https://${status.dnsName}/forge/` : null);
  return {
    installed: true,
    running: status.running,
    authenticated: status.authenticated,
    publicUrl,
    backendState: status.backendState,
    dnsName: status.dnsName
  };
}

async function probePublicForgeUrl(publicUrl, timeoutMs = 4_000) {
  if (!publicUrl) return { ok: false, error: "no public URL candidate" };
  const fakeProbeSequencePath =
    process.env.FORGE_MEMORY_FAKE_TAILSCALE_PUBLIC_PROBE_SEQUENCE;
  if (fakeProbeSequencePath) {
    const source = fs.existsSync(fakeProbeSequencePath)
      ? fs.readFileSync(fakeProbeSequencePath, "utf8")
      : "";
    const entries = source
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const current = entries.shift() ?? "fail";
    fs.writeFileSync(
      fakeProbeSequencePath,
      entries.length ? `${entries.join("\n")}\n` : ""
    );
    return current === "ok"
      ? { ok: true, fake: true }
      : {
          ok: false,
          error: current === "fail" ? "fake probe failure" : current
        };
  }
  if (
    ["1", "true", "yes"].includes(
      String(
        process.env.FORGE_MEMORY_SKIP_TAILSCALE_PUBLIC_PROBE ?? ""
      ).toLowerCase()
    )
  ) {
    return { ok: true, skipped: true };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(forgePublicHealthUrl(publicUrl), {
      headers: { accept: "application/json", "x-forge-runtime-probe": "1" },
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, status: response.status };
    const payload = await response.json().catch(() => null);
    if (!isForgeHealthPayload(payload)) {
      return {
        ok: false,
        status: response.status,
        error: "non-Forge health payload"
      };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    return { ok: false, error: describeNetworkError(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function configureTailscaleServe(config, flags) {
  const target = `http://127.0.0.1:${config.port || DEFAULT_PORT}`;
  return runCommand("tailscale", ["serve", "--bg", target], {
    dryRun: flags?.dryRun
  });
}

function tailscalePreferredMessage() {
  return [
    "Tailscale is preferred when available: it gives the iPhone a normal HTTPS Forge URL, is usually faster and steadier than relayed Iroh, and avoids the custom WebView URL scheme.",
    "Iroh remains the fallback when Tailscale is missing, declined, or unreachable."
  ].join(" ");
}

function refreshCargoPath() {
  const cargoBin = path.join(homeDir(), ".cargo", "bin");
  if (fs.existsSync(cargoBin)) {
    const current = process.env.PATH ?? "";
    if (!current.split(path.delimiter).includes(cargoBin)) {
      process.env.PATH = `${cargoBin}${path.delimiter}${current}`;
    }
  }
}

async function maybeInstallRustToolchain(
  flags,
  purpose = "Forge Companion Iroh"
) {
  refreshCargoPath();
  if (commandExists("cargo")) {
    return { ok: true, installed: false };
  }
  const guidance = rustInstallGuidance();
  const canUseRustupScript =
    (process.platform === "darwin" || process.platform === "linux") &&
    commandExists("curl");
  const canUseWinget = process.platform === "win32" && commandExists("winget");
  if (!canUseRustupScript && !canUseWinget) {
    return {
      ok: false,
      installed: false,
      guidance:
        process.platform === "darwin" || process.platform === "linux"
          ? ["Install curl first, then install Rust/Cargo.", ...guidance]
          : guidance
    };
  }
  if (flags?.json || flags?.dryRun) {
    return { ok: false, installed: false, guidance };
  }
  const shouldInstall = flags?.yes
    ? true
    : await promptYesNo(
        `${purpose} needs Rust/Cargo for its local native component. Install the minimal Rust toolchain now?`,
        true
      );
  if (!shouldInstall) {
    return { ok: false, installed: false, guidance };
  }
  console.log(color.cyan("Installing minimal Rust toolchain..."));
  const result = canUseWinget
    ? await runCommand("winget", [
        "install",
        "--id",
        "Rustlang.Rustup",
        "-e",
        "--source",
        "winget",
        "--accept-package-agreements",
        "--accept-source-agreements"
      ])
    : await runCommand("sh", [
        "-c",
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal"
      ]);
  refreshCargoPath();
  return {
    ok: result.ok && commandExists("cargo"),
    installed: result.ok,
    guidance
  };
}

async function ensureIrohTransportPrepared(config, flags = {}) {
  const existingBinary = findIrohBinaryForInstall(config);
  if (existingBinary) {
    return { ok: true, built: false, binary: existingBinary };
  }

  if (config.mode !== "dev") {
    await ensurePackagedRuntimeInstalled();
  }

  const manifestPath = findIrohManifestForInstall(config);
  if (!manifestPath) {
    throw new Error(
      [
        "Forge could not find the bundled companion Iroh source.",
        "Run npx forge-memory doctor --repair so Forge Memory refreshes the packaged runtime.",
        `Runtime log: ${logPath()}.`
      ].join(" ")
    );
  }

  const rust = await maybeInstallRustToolchain(flags);
  if (!rust.ok) {
    throw new Error(
      [
        "Forge Companion Iroh is source-built on this machine, but Rust/Cargo is not installed yet.",
        "Install steps:",
        ...rustInstallGuidance().map((entry) => `- ${entry}`),
        "Then rerun: npx forge-memory install",
        "For a temporary direct network fallback, use: npx forge-memory pair-ios --manual-http --public-url <phone-reachable Forge URL>"
      ].join("\n")
    );
  }

  const result = await runLoggedCommand(
    "cargo",
    [
      "build",
      "--release",
      "--manifest-path",
      manifestPath,
      "--bin",
      "forge-companion-iroh"
    ],
    {
      cwd: path.dirname(manifestPath),
      dryRun: flags.dryRun,
      env: process.env,
      logFile: logPath()
    }
  );
  if (!result.ok) {
    throw new Error(
      [
        "Forge could not build the local companion Iroh transport host from source.",
        `Manifest: ${manifestPath}`,
        `Log: ${logPath()}`,
        "Install or repair Rust/Cargo, then rerun: npx forge-memory install"
      ].join(" ")
    );
  }
  const binary = findIrohBinaryForInstall(config);
  if (!binary && !flags.dryRun) {
    throw new Error(
      [
        "Cargo finished, but Forge could not find the built companion Iroh binary.",
        `Manifest: ${manifestPath}`,
        `Expected one of: ${candidateIrohBinariesForInstall(config).join(", ")}`
      ].join(" ")
    );
  }
  return { ok: true, built: true, binary: binary ?? null, manifestPath };
}

async function ensureForgePeerPrepared(config, flags = null) {
  if (!config.peerEnabled) {
    return { ok: true, enabled: false, built: false, binaryPath: null };
  }
  if (
    config.peerIrohEnabled !== true &&
    (!Array.isArray(config.peerDirectEndpoints) ||
      config.peerDirectEndpoints.length === 0)
  ) {
    throw new Error(
      "Forge peer sharing needs at least one transport. Enable Iroh with --enable-peer-iroh or configure a direct --peer-endpoint <ip:port>."
    );
  }

  const pluginRoot =
    config.mode === "packaged" ? await ensurePackagedRuntimeInstalled() : null;
  const runCargo = async ({ args, cwd, env: cargoEnv }) => {
    refreshCargoPath();
    if (!commandExists("cargo") && flags) {
      await maybeInstallRustToolchain(flags, "Forge peer sharing");
      refreshCargoPath();
    }
    if (!commandExists("cargo")) return { ok: false, missingCargo: true };
    return await runLoggedCommand("cargo", args, {
      cwd,
      dryRun: flags?.dryRun === true,
      env: cargoEnv,
      logFile: logPath()
    });
  };

  try {
    const result = await prepareForgePeerRuntime({
      mode: config.mode,
      pluginRoot,
      repoRoot: config.repo,
      nativeRoot: path.join(forgeHome(), "native"),
      runtimePackageVersion: RUNTIME_PACKAGE_VERSION,
      environment: process.env,
      runCargo
    });
    return { ...result, enabled: true };
  } catch (error) {
    throw new Error(
      [
        "Forge could not prepare the verified forge-peer runtime.",
        error instanceof Error ? error.message : String(error),
        `Log: ${logPath()}`,
        "Run npx forge-memory doctor --repair after checking Rust/Cargo and the packaged source signature.",
        "Your Forge data folder was not changed by this build failure."
      ].join(" "),
      { cause: error }
    );
  }
}

async function inspectConfiguredForgePeer(config) {
  if (!config.peerEnabled) {
    return {
      ok: true,
      enabled: false,
      sourceVerified: null,
      binaryVerified: null,
      binaryPath: null,
      reason: null
    };
  }
  if (
    config.peerIrohEnabled !== true &&
    config.peerDirectEndpoints.length === 0
  ) {
    return {
      ok: false,
      enabled: true,
      sourceVerified: false,
      binaryVerified: false,
      binaryPath: null,
      reason: "No Iroh or direct peer transport is configured."
    };
  }
  const pluginRoot =
    config.mode === "packaged"
      ? resolveOpenClawPluginRoot({ installedOnly: true })
      : null;
  if (config.mode === "packaged" && !pluginRoot) {
    return {
      ok: false,
      enabled: true,
      sourceVerified: false,
      binaryVerified: false,
      binaryPath: null,
      reason: "The installed Forge runtime package is unavailable."
    };
  }
  try {
    const inspection = await inspectForgePeerRuntime({
      mode: config.mode,
      pluginRoot,
      repoRoot: config.repo,
      nativeRoot: path.join(forgeHome(), "native"),
      runtimePackageVersion: RUNTIME_PACKAGE_VERSION,
      now: new Date()
    });
    return { ...inspection, enabled: true };
  } catch (error) {
    return {
      ok: false,
      enabled: true,
      sourceVerified: false,
      binaryVerified: false,
      binaryPath: null,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function forgeRuntimeEnvironment(config, peerPreparation) {
  const environment = { ...process.env };
  for (const name of [
    "FORGE_RUNTIME_PACKAGE_NAME",
    "FORGE_RUNTIME_PACKAGE_VERSION",
    "FORGE_PEER_ENABLED",
    "FORGE_PEER_REQUIRED",
    "FORGE_PEER_BIN",
    "FORGE_PEER_ENABLE_IROH",
    "FORGE_PEER_DIRECT_ENDPOINTS",
    "FORGE_PEER_ALLOW_LOOPBACK_DIRECT",
    "FORGE_PEER_SOCKET_PATH",
    "FORGE_PEER_STATE_DIR"
  ]) {
    delete environment[name];
  }
  if (config.mode === "packaged") {
    environment.FORGE_RUNTIME_PACKAGE_NAME = RUNTIME_PACKAGE;
    environment.FORGE_RUNTIME_PACKAGE_VERSION = RUNTIME_PACKAGE_VERSION;
  }
  environment.FORGE_PEER_ENABLED = config.peerEnabled ? "1" : "0";
  environment.FORGE_PEER_REQUIRED = "0";
  if (config.peerEnabled) {
    if (!peerPreparation?.binaryPath) {
      throw new Error("The enabled forge-peer runtime has no verified binary.");
    }
    environment.FORGE_PEER_BIN = peerPreparation.binaryPath;
    environment.FORGE_PEER_ENABLE_IROH = config.peerIrohEnabled ? "1" : "0";
    environment.FORGE_PEER_DIRECT_ENDPOINTS =
      config.peerDirectEndpoints.join(",");
    environment.FORGE_PEER_ALLOW_LOOPBACK_DIRECT =
      config.peerAllowLoopbackDirect ? "1" : "0";
  }
  return environment;
}

function detectOpenClaw() {
  const installed =
    commandExists("openclaw") ||
    fs.existsSync(path.join(homeDir(), ".openclaw"));
  const version = commandExists("openclaw")
    ? runCapture("openclaw", ["--version"])
    : null;
  const config = path.join(homeDir(), ".openclaw", "openclaw.json");
  return {
    id: "openclaw",
    label: "OpenClaw",
    installed,
    disabled: !installed,
    status: installed ? version || "detected" : "not found",
    configPath: config,
    hint: "Install OpenClaw first, then rerun npx forge-memory configure."
  };
}

function detectHermes() {
  const hermesRoot = path.join(homeDir(), ".hermes");
  const hermesPython = path.join(
    hermesRoot,
    "hermes-agent",
    "venv",
    "bin",
    "python"
  );
  const installed =
    commandExists("hermes") ||
    fs.existsSync(hermesPython) ||
    fs.existsSync(hermesRoot);
  const version = commandExists("hermes")
    ? runCapture("hermes", ["--version"])
    : null;
  return {
    id: "hermes",
    label: "Hermes",
    installed,
    disabled: !installed,
    status: installed ? version || "detected" : "not found",
    configPath: path.join(hermesRoot, "forge", "config.json"),
    pythonPath: hermesPython,
    hint: "Install Hermes first, then rerun npx forge-memory configure."
  };
}

function detectCodex() {
  const codexRoot = path.join(homeDir(), ".codex");
  const installed = commandExists("codex") || fs.existsSync(codexRoot);
  const version = commandExists("codex")
    ? runCapture("codex", ["--version"])
    : null;
  return {
    id: "codex",
    label: "Codex",
    installed,
    disabled: !installed,
    status: installed ? version || "detected" : "not found",
    configPath: path.join(codexRoot, "config.toml"),
    hint: "Install Codex first, then rerun npx forge-memory configure."
  };
}

function claudeConfigPath() {
  const customConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  return customConfigDir
    ? path.join(path.resolve(customConfigDir), ".claude.json")
    : path.join(homeDir(), ".claude.json");
}

function claudeUserDirectory() {
  const customConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  return customConfigDir
    ? path.resolve(customConfigDir)
    : path.join(homeDir(), ".claude");
}

function claudeForgeRulesPath() {
  return path.join(claudeUserDirectory(), "rules", "forge-memory.md");
}

function detectClaude() {
  const config = claudeConfigPath();
  const payload = readJsonSync(config, null);
  const configured = isForgeMemoryMcpServer(payload?.mcpServers?.forge);
  const installed =
    commandExists("claude") || configured || fs.existsSync(config);
  const version = commandExists("claude")
    ? runCapture("claude", ["--version"])
    : null;
  return {
    id: "claude",
    label: "Claude Code",
    installed,
    disabled: !installed,
    configured,
    status: installed
      ? [version || "detected", configured ? "Forge MCP configured" : null]
          .filter(Boolean)
          .join("; ")
      : "not found",
    configPath: config,
    hint: "Install Claude Code first, then rerun npx forge-memory configure."
  };
}

function discover() {
  return {
    generatedAt: new Date().toISOString(),
    adapters: [detectOpenClaw(), detectHermes(), detectCodex(), detectClaude()]
  };
}

function printBanner() {
  console.log(color.bold("Forge Memory"));
  console.log(color.dim(`Guided Forge installer ${VERSION}`));
  console.log("");
}

function progressEnabled(options = {}) {
  return !options.json;
}

function formatElapsed(startedAt) {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function clearLine() {
  process.stdout.write("\r\u001b[2K");
}

async function withProgress(title, detail, options, task) {
  if (!progressEnabled(options)) return task();
  const startedAt = Date.now();
  const interactive = process.stdout.isTTY;
  const frames = ["-", "\\", "|", "/"];
  let frameIndex = 0;
  let timer = null;
  const suffix = detail ? color.dim(` ${detail}`) : "";

  if (interactive) {
    process.stdout.write("\u001b[?25l");
    timer = setInterval(() => {
      clearLine();
      process.stdout.write(
        `${color.cyan(frames[frameIndex % frames.length])} ${title}${suffix} ${color.dim(formatElapsed(startedAt))}`
      );
      frameIndex += 1;
    }, 120);
  } else {
    console.log(`${color.cyan("...")} ${title}${suffix}`);
  }

  try {
    const result = await task();
    if (timer) clearInterval(timer);
    if (interactive) {
      clearLine();
      process.stdout.write("\u001b[?25h");
    }
    console.log(
      `${color.green("ok")} ${title} ${color.dim(formatElapsed(startedAt))}`
    );
    return result;
  } catch (error) {
    if (timer) clearInterval(timer);
    if (interactive) {
      clearLine();
      process.stdout.write("\u001b[?25h");
    }
    console.log(
      `${color.red("fail")} ${title} ${color.dim(formatElapsed(startedAt))}`
    );
    throw error;
  }
}

function printStep(title, detail, options = {}) {
  if (!progressEnabled(options)) return;
  console.log(
    `${color.cyan("->")} ${title}${detail ? color.dim(` ${detail}`) : ""}`
  );
}

async function promptLine(question, defaultValue) {
  const suffix = defaultValue ? ` ${color.dim(`[${defaultValue}]`)}` : "";
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return await new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

async function promptYesNo(question, defaultValue = true) {
  const answer = (
    await promptLine(`${question} ${defaultValue ? "[Y/n]" : "[y/N]"}`, "")
  ).toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes";
}

async function promptCheckbox(adapters, defaults) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return defaults;
  }
  const rows = [
    ...adapters.map((adapter) => ({
      ...adapter,
      selected: defaults.includes(adapter.id) && !adapter.disabled,
      action: false
    })),
    {
      id: "__skip",
      label: "Skip adapter configuration",
      installed: true,
      disabled: false,
      status: "configure later with npx forge-memory configure",
      selected: false,
      action: true
    }
  ];
  let cursor = 0;

  const render = () => {
    process.stdout.write("\u001b[?25l");
    process.stdout.write("\u001b[2J\u001b[H");
    printBanner();
    console.log(
      "Select host adapters. Space toggles, arrows move, Enter confirms.\n"
    );
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const prefix = index === cursor ? color.cyan(">") : " ";
      const marker = row.action ? " " : row.selected ? "x" : " ";
      const disabled = row.disabled ? color.dim(" disabled") : "";
      const line = `${prefix} [${marker}] ${row.label} ${color.dim(`(${row.status})`)}${disabled}`;
      console.log(row.disabled ? color.dim(line) : line);
      if (row.disabled) console.log(color.dim(`    ${row.hint}`));
    }
  };

  return await new Promise((resolve) => {
    const onData = (chunk) => {
      const key = chunk.toString("utf8");
      if (key === "\u0003") {
        cleanup();
        process.exit(130);
      }
      if (key === "\r" || key === "\n") {
        const row = rows[cursor];
        cleanup();
        if (row?.id === "__skip") {
          resolve([]);
          return;
        }
        resolve(
          rows
            .filter(
              (entry) => entry.selected && !entry.disabled && !entry.action
            )
            .map((entry) => entry.id)
        );
        return;
      }
      if (key === " ") {
        const row = rows[cursor];
        if (row && !row.disabled && !row.action) row.selected = !row.selected;
        render();
        return;
      }
      if (key === "\u001b[A") {
        cursor = Math.max(0, cursor - 1);
        render();
        return;
      }
      if (key === "\u001b[B") {
        cursor = Math.min(rows.length - 1, cursor + 1);
        render();
      }
    };
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.off("data", onData);
      process.stdout.write("\u001b[?25h");
      process.stdout.write("\n");
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
    render();
  });
}

async function isPortAvailable(port) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

function resolveDevServerEntry(repoRoot) {
  const candidates = [
    path.join(repoRoot, "apps", "api", "src", "index.ts"),
    path.join(repoRoot, "server", "src", "index.ts")
  ];
  const entry = candidates.find((candidate) => fs.existsSync(candidate));
  if (entry) return entry;
  throw new Error(
    `Forge API source entry was not found. Checked: ${candidates.join(", ")}`
  );
}

async function isForgeDevWebServer(port, repoRoot) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/forge/`, {
      headers: { accept: "text/html" },
      signal: controller.signal
    });
    if (!response.ok) return false;
    const html = await response.text();
    if (
      !html.includes("<title>Forge</title>") ||
      !html.includes("/forge/@vite/client")
    ) {
      return false;
    }

    const sourceEntry = path
      .resolve(repoRoot, "apps", "web", "src", "main.tsx")
      .split(path.sep)
      .join("/");
    const sourceUrlPath = sourceEntry
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const sourceResponse = await fetch(
      `http://127.0.0.1:${port}/forge/@fs${sourceUrlPath}`,
      {
        headers: { accept: "text/javascript" },
        signal: controller.signal
      }
    );
    if (!sourceResponse.ok) return false;
    const source = await sourceResponse.text();
    return source.includes("import.meta.hot") && source.includes(sourceEntry);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function findFreePort(startPort) {
  if (startPort === 0) {
    return await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
        const address = server.address();
        const port =
          typeof address === "object" && address ? address.port : DEFAULT_PORT;
        server.close(() => resolve(port));
      });
    });
  }
  for (
    let port = startPort;
    port < startPort + 30 && port <= 65535;
    port += 1
  ) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No free localhost port found near ${startPort}`);
}

async function resolveDevDataRoot(repoRoot) {
  const preferencePath = path.resolve(
    repoRoot,
    "..",
    "..",
    "data",
    "forge-runtime.json"
  );
  const monorepoDataRoot = path.resolve(repoRoot, "..", "..", "data", "forge");
  const preference = await readJson(preferencePath, null);
  if (typeof preference?.dataRoot === "string" && preference.dataRoot.trim()) {
    return path.resolve(preference.dataRoot);
  }
  if (fs.existsSync(monorepoDataRoot)) return monorepoDataRoot;
  return defaultDataRoot();
}

function findForgeRepo(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    const packageJsonPath = path.join(current, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        if (
          parsed?.name === "forge" &&
          fs.existsSync(path.join(current, "server", "src", "index.ts"))
        ) {
          return current;
        }
      } catch {
        // keep walking
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveRuntimeStorageRoot(healthResult) {
  const storageRoot = healthResult?.payload?.runtime?.storageRoot;
  return typeof storageRoot === "string" && storageRoot.trim()
    ? path.resolve(storageRoot)
    : null;
}

function pathsMatch(left, right) {
  return path.resolve(left) === path.resolve(right);
}

async function resolveInstallRuntimeTarget({
  origin,
  requestedPort,
  requestedWebPort,
  dataRoot,
  dataRootWasExplicit
}) {
  if (requestedPort !== 0) {
    const desiredConfig = { origin, port: requestedPort };
    const desiredHealth = await health(desiredConfig);
    if (isHealthyForgeRuntime(desiredHealth)) {
      const liveDataRoot = resolveRuntimeStorageRoot(desiredHealth);
      if (liveDataRoot && !pathsMatch(liveDataRoot, dataRoot)) {
        if (dataRootWasExplicit) {
          throw new Error(
            [
              `A healthy Forge runtime is already running at ${baseUrl(desiredConfig)}, but it uses a different data folder.`,
              `Live data folder: ${liveDataRoot}.`,
              `Requested data folder: ${path.resolve(dataRoot)}.`,
              "Stop or restart that runtime before switching data folders. Your data folder is unchanged."
            ].join(" ")
          );
        }
        dataRoot = liveDataRoot;
      }
      return {
        port: requestedPort,
        webPort: requestedWebPort,
        dataRoot: path.resolve(dataRoot),
        adoptedExistingRuntime: true
      };
    }
  }

  return {
    port: await findFreePort(requestedPort),
    webPort: await findFreePort(requestedWebPort),
    dataRoot: path.resolve(dataRoot),
    adoptedExistingRuntime: false
  };
}

async function buildInstallConfig(parsed, currentConfig, discovery, command) {
  const repo = parsed.values.repo
    ? path.resolve(parsed.values.repo)
    : findForgeRepo();
  const mode = parsed.flags.dev ? "dev" : currentConfig.mode;
  const detectedDefaults = discovery.adapters
    .filter((adapter) => adapter.installed)
    .map((adapter) => adapter.id);
  const currentDefaults =
    currentConfig.adapters.length > 0
      ? currentConfig.adapters
      : detectedDefaults;
  const adapterOverride = parsed.flags.skipAdapters
    ? []
    : normalizeAdapterList(parsed.values.adapters);
  const adapters =
    adapterOverride ??
    (parsed.flags.yes
      ? currentDefaults
      : await promptCheckbox(discovery.adapters, currentDefaults));
  const dataRootDefault =
    parsed.values.dataRoot ??
    (parsed.flags.dev && repo
      ? await resolveDevDataRoot(repo)
      : currentConfig.dataRoot || defaultDataRoot());
  const dataRoot = parsed.flags.yes
    ? dataRootDefault
    : await promptLine("Forge data folder", dataRootDefault);
  const origin = parsed.values.origin ?? currentConfig.origin ?? DEFAULT_ORIGIN;
  const runtimeTarget = await resolveInstallRuntimeTarget({
    origin,
    requestedPort: normalizePort(
      parsed.values.port ?? currentConfig.port,
      DEFAULT_PORT
    ),
    requestedWebPort: normalizePort(
      parsed.values.webPort ?? currentConfig.webPort,
      DEFAULT_WEB_PORT
    ),
    dataRoot,
    dataRootWasExplicit: typeof parsed.values.dataRoot === "string"
  });
  const peerEnabled = parsed.flags.enablePeer
    ? true
    : parsed.flags.disablePeer
      ? false
      : parsed.flags.yes
        ? currentConfig.peerEnabled
        : await promptYesNo(
            "Enable secure Forge-to-Forge sharing on this host?",
            currentConfig.updatedAt ? currentConfig.peerEnabled : false
          );
  const enablingPeerNow = peerEnabled && !currentConfig.peerEnabled;
  const peerIrohEnabled = parsed.flags.enablePeerIroh
    ? true
    : parsed.flags.disablePeerIroh
      ? false
      : parsed.flags.yes
        ? enablingPeerNow
          ? true
          : currentConfig.peerIrohConfigured
            ? currentConfig.peerIrohEnabled
            : false
        : peerEnabled
          ? await promptYesNo(
              "Use Iroh for secure peer connectivity across different networks?",
              currentConfig.peerIrohConfigured
                ? currentConfig.peerIrohEnabled
                : true
            )
          : false;
  if (!peerEnabled && parsed.flags.enablePeerIroh) {
    throw new Error("--enable-peer-iroh requires --enable-peer.");
  }
  const peerAllowLoopbackDirect = parsed.flags.allowLoopbackPeer
    ? true
    : currentConfig.peerAllowLoopbackDirect;
  let peerDirectEndpoints =
    parsed.values.peerEndpoints.length > 0
      ? normalizePeerDirectEndpoints(parsed.values.peerEndpoints, {
          allowLoopback: peerAllowLoopbackDirect
        })
      : currentConfig.peerDirectEndpoints;
  if (peerEnabled && !peerIrohEnabled && peerDirectEndpoints.length === 0) {
    const discoveredEndpoint = await discoverPeerDirectEndpoint();
    if (discoveredEndpoint) peerDirectEndpoints = [discoveredEndpoint];
  }
  if (peerEnabled && !peerIrohEnabled && peerDirectEndpoints.length === 0) {
    throw new Error(
      "Forge peer sharing has no transport. Enable Iroh, pass --peer-endpoint <ip:port>, or use --allow-loopback-peer only for a local test endpoint."
    );
  }

  return {
    version: VERSION,
    mode: parsed.flags.dev ? "dev" : mode,
    origin,
    port: runtimeTarget.port,
    webPort: runtimeTarget.webPort,
    dataRoot: runtimeTarget.dataRoot,
    adapters,
    repo,
    command,
    peerEnabled,
    peerIrohEnabled,
    peerDirectEndpoints,
    peerAllowLoopbackDirect
  };
}

async function patchOpenClawConfig(config, options) {
  const filePath = path.join(homeDir(), ".openclaw", "openclaw.json");
  const payload = (await readJson(filePath, {})) ?? {};
  const plugins =
    payload.plugins && typeof payload.plugins === "object"
      ? { ...payload.plugins }
      : {};
  const entries =
    plugins.entries && typeof plugins.entries === "object"
      ? { ...plugins.entries }
      : {};
  const currentEntry =
    entries[FORGE_PLUGIN_ID] && typeof entries[FORGE_PLUGIN_ID] === "object"
      ? { ...entries[FORGE_PLUGIN_ID] }
      : {};
  const currentPluginConfig =
    currentEntry.config && typeof currentEntry.config === "object"
      ? { ...currentEntry.config }
      : {};
  currentEntry.enabled = true;
  currentEntry.config = {
    ...currentPluginConfig,
    origin: config.origin,
    port: config.port,
    dataRoot: config.dataRoot
  };
  entries[FORGE_PLUGIN_ID] = currentEntry;
  plugins.entries = entries;
  const next = { ...payload, plugins };
  return writeJson(filePath, next, options);
}

async function patchHermesConfig(config, options) {
  const forgeConfigPath = path.join(
    homeDir(),
    ".hermes",
    "forge",
    "config.json"
  );
  await writeJson(
    forgeConfigPath,
    {
      origin: config.origin,
      port: config.port,
      dataRoot: config.dataRoot,
      actorLabel: "",
      updatedAt: new Date().toISOString()
    },
    options
  );

  const hermesYamlPath = path.join(homeDir(), ".hermes", "config.yaml");
  if (!fs.existsSync(hermesYamlPath)) return { filePath: forgeConfigPath };
  const raw = await fsp.readFile(hermesYamlPath, "utf8");
  const doc = YAML.parseDocument(raw);
  const root = doc.toJSON() ?? {};
  if (!root.plugins || typeof root.plugins !== "object") root.plugins = {};
  if (!Array.isArray(root.plugins.enabled)) root.plugins.enabled = [];
  if (!root.plugins.enabled.includes("forge"))
    root.plugins.enabled.push("forge");
  doc.contents = doc.createNode(root);
  if (!options.dryRun) {
    await backupIfExists(hermesYamlPath);
    await fsp.writeFile(hermesYamlPath, String(doc), "utf8");
  }
  return { filePath: hermesYamlPath };
}

async function patchCodexConfig(config, options) {
  const filePath = path.join(homeDir(), ".codex", "config.toml");
  let source = fs.existsSync(filePath)
    ? await fsp.readFile(filePath, "utf8")
    : "";
  const block = [
    "[mcp_servers.forge]",
    'command = "npx"',
    'args = ["forge-memory", "mcp"]',
    "",
    "[mcp_servers.forge.env]",
    `FORGE_ORIGIN = "${config.origin}"`,
    `FORGE_PORT = "${config.port}"`,
    'FORGE_ACTOR_LABEL = "codex"',
    'FORGE_AGENT_PROVIDER = "codex"',
    'FORGE_TIMEOUT_MS = "15000"',
    `FORGE_DATA_ROOT = "${config.dataRoot.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
    ""
  ].join("\n");
  const cleaned = stripCodexForgeMcpConfig(source).trimEnd();
  source = `${cleaned ? `${cleaned}\n\n` : ""}${block}`;
  if (!options.dryRun) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await backupIfExists(filePath);
    await fsp.writeFile(
      filePath,
      source.endsWith("\n") ? source : `${source}\n`,
      "utf8"
    );
  }
  return { filePath };
}

function forgeMcpEnv(config, actorLabel) {
  return {
    FORGE_ORIGIN: config.origin,
    FORGE_PORT: String(config.port),
    FORGE_ACTOR_LABEL: actorLabel,
    FORGE_AGENT_PROVIDER: actorLabel,
    FORGE_TIMEOUT_MS: "15000",
    FORGE_DATA_ROOT: config.dataRoot
  };
}

function forgeMemoryMcpServerConfig(config, actorLabel) {
  return {
    type: "stdio",
    command: "npx",
    args: ["forge-memory", "mcp"],
    env: forgeMcpEnv(config, actorLabel)
  };
}

function isForgeMemoryMcpServer(entry) {
  return (
    entry &&
    typeof entry === "object" &&
    entry.command === "npx" &&
    Array.isArray(entry.args) &&
    entry.args.length >= 2 &&
    entry.args[0] === "forge-memory" &&
    entry.args[1] === "mcp"
  );
}

const CLAUDE_FORGE_RULES_START = "<!-- forge-memory:rules:start -->";
const CLAUDE_FORGE_RULES_END = "<!-- forge-memory:rules:end -->";

const CLAUDE_FORGE_RULES_BODY = `# Forge Memory

Forge is the durable local memory, wiki, health, planning, and execution runtime connected through the \`forge\` MCP server.

## How To Use Forge

- Prefer Forge MCP tools over ad hoc files or one-off import scripts when the user asks to read, write, ingest, curate, merge, or audit Forge knowledge.
- Start wiki work by checking the active wiki settings and spaces, then use the normal Forge wiki ingest and page APIs. Do not invent a separate wiki storage path.
- Ingest source files as evidence-backed wiki material. Preserve useful facts, relationships, dates, decisions, events, people, organizations, projects, concepts, preferences, and stated uncertainty.
- Redact true secrets such as passwords, tokens, private keys, recovery codes, and payment credentials. Do not strip ordinary personal context merely because it is sensitive or relational.
- Create or update deliberate wiki pages for important people, organizations, events, concepts, projects, and media. Canonical pages should be curated, readable, structured articles, not raw logs or repetitive dumps.
- When duplicate pages exist, merge the information into one canonical page without losing facts. Link out to separate pages when a concept deserves its own page.
- Keep evidence traceable. If facts come from an uploaded conversation, note provenance enough for later audit without pasting huge raw transcripts into canonical pages.
- Before saying ingest/merge/cleanup is done, audit what changed: created pages, updated pages, skipped material, merge candidates, and remaining uncertainty.
- Respect the configured Forge data root. Never delete user data or move a Forge database unless the user explicitly asks and backups are created first.
`;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function forgeManagedBlock(body) {
  return `${CLAUDE_FORGE_RULES_START}\n${body.trim()}\n${CLAUDE_FORGE_RULES_END}`;
}

function upsertForgeManagedBlock(source, body) {
  const block = forgeManagedBlock(body);
  const pattern = new RegExp(
    `${escapeRegExp(CLAUDE_FORGE_RULES_START)}[\\s\\S]*?${escapeRegExp(
      CLAUDE_FORGE_RULES_END
    )}`
  );
  const trimmed = source.trimEnd();
  if (pattern.test(source)) return trimmed.replace(pattern, block).trimEnd();
  return [trimmed, block].filter(Boolean).join("\n\n").trimEnd();
}

function removeForgeManagedBlock(source) {
  const pattern = new RegExp(
    `${escapeRegExp(CLAUDE_FORGE_RULES_START)}[\\s\\S]*?${escapeRegExp(
      CLAUDE_FORGE_RULES_END
    )}`,
    "g"
  );
  return source
    .replace(pattern, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function patchClaudeConfig(config, options) {
  const filePath = claudeConfigPath();
  const payload = (await readJson(filePath, {})) ?? {};
  const currentServers =
    payload.mcpServers && typeof payload.mcpServers === "object"
      ? { ...payload.mcpServers }
      : {};
  currentServers.forge = forgeMemoryMcpServerConfig(config, "claude");
  const next = { ...payload, mcpServers: currentServers };
  return writeJson(filePath, next, options);
}

async function patchClaudeForgeRules(options = {}) {
  const filePath = claudeForgeRulesPath();
  const source = fs.existsSync(filePath)
    ? await fsp.readFile(filePath, "utf8")
    : "";
  const next = `${upsertForgeManagedBlock(source, CLAUDE_FORGE_RULES_BODY)}\n`;
  if (next === source) return { filePath, changed: false };
  await writeText(filePath, next, options);
  return { filePath, changed: true };
}

function stripCodexForgeMcpConfig(source) {
  const orphanForgeLines = new Set([
    'command = "npx"',
    'args = ["forge-memory", "mcp"]',
    "FORGE_ORIGIN",
    "FORGE_PORT",
    "FORGE_ACTOR_LABEL",
    "FORGE_AGENT_PROVIDER",
    "FORGE_TIMEOUT_MS",
    "FORGE_DATA_ROOT"
  ]);
  const lines = source.split(/\r?\n/);
  const kept = [];
  let skippingForgeTable = false;
  let currentTable = null;
  for (const line of lines) {
    const trimmed = line.trim();
    const tableMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (tableMatch) {
      currentTable = tableMatch[1];
      skippingForgeTable =
        currentTable === "mcp_servers.forge" ||
        currentTable.startsWith("mcp_servers.forge.");
      if (skippingForgeTable) continue;
    }
    if (skippingForgeTable) continue;
    const isGlobalOrphanForgeLine =
      currentTable === null &&
      (orphanForgeLines.has(trimmed) ||
        Array.from(orphanForgeLines).some((prefix) =>
          trimmed.startsWith(`${prefix} =`)
        ));
    if (isGlobalOrphanForgeLine) {
      continue;
    }
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

async function runCommand(
  command,
  args,
  { cwd, dryRun = false, env = process.env } = {}
) {
  if (dryRun) {
    return { ok: true, dryRun: true, command, args, cwd };
  }
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", (error) => resolve({ ok: false, error }));
    child.once("exit", (code) => resolve({ ok: code === 0, code }));
  });
}

async function runLoggedCommand(
  command,
  args,
  { cwd, dryRun = false, env = process.env, logFile = logPath() } = {}
) {
  if (dryRun) {
    return { ok: true, dryRun: true, command, args, cwd, logFile };
  }
  await fsp.mkdir(path.dirname(logFile), { recursive: true });
  return await new Promise((resolve) => {
    const out = fs.openSync(logFile, "a");
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", out, out]
    });
    child.once("error", (error) => {
      fs.closeSync(out);
      resolve({ ok: false, error, logFile });
    });
    child.once("exit", (code) => {
      fs.closeSync(out);
      resolve({ ok: code === 0, code, logFile });
    });
  });
}

async function installOpenClawAdapter(config, options) {
  await patchOpenClawConfig(config, options);
  if (!commandExists("openclaw")) {
    return {
      adapter: "openclaw",
      ok: false,
      skipped: true,
      message: "openclaw command not found"
    };
  }
  const installTarget =
    config.mode === "dev" && config.repo
      ? path.join(config.repo, "plugins/openclaw")
      : FORGE_PLUGIN_ID;
  const installArgs =
    config.mode === "dev"
      ? [
          "plugins",
          "install",
          "--link",
          "--dangerously-force-unsafe-install",
          installTarget
        ]
      : [
          "plugins",
          "install",
          "--dangerously-force-unsafe-install",
          installTarget
        ];
  const installResult = await runCommand("openclaw", installArgs, options);
  if (!installResult.ok)
    return {
      adapter: "openclaw",
      ok: false,
      message: "OpenClaw plugin install failed"
    };
  await runCommand("openclaw", ["plugins", "enable", FORGE_PLUGIN_ID], options);
  await runCommand("openclaw", ["gateway", "restart"], options);
  return { adapter: "openclaw", ok: true };
}

async function installHermesAdapter(config, options) {
  await patchHermesConfig(config, options);
  const pythonPath = path.join(
    homeDir(),
    ".hermes",
    "hermes-agent",
    "venv",
    "bin",
    "python"
  );
  if (!fs.existsSync(pythonPath)) {
    return {
      adapter: "hermes",
      ok: false,
      skipped: true,
      message: "Hermes Python environment not found"
    };
  }
  const target =
    config.mode === "dev" && config.repo
      ? [
          "-m",
          "pip",
          "install",
          "--upgrade",
          "-e",
          path.join(config.repo, "plugins", "forge-hermes")
        ]
      : ["-m", "pip", "install", "--upgrade", "forge-hermes-plugin"];
  const result = await runCommand(pythonPath, target, options);
  return {
    adapter: "hermes",
    ok: result.ok,
    message: result.ok ? undefined : "Hermes plugin install failed"
  };
}

async function installCodexAdapter(config, options) {
  await patchCodexConfig(config, options);
  return { adapter: "codex", ok: true };
}

async function installClaudeAdapter(config, options) {
  await patchClaudeConfig(config, options);
  await patchClaudeForgeRules(options);
  return { adapter: "claude", ok: true };
}

async function configureAdapters(config, options) {
  const results = [];
  for (const adapter of config.adapters) {
    if (adapter === "openclaw")
      results.push(await installOpenClawAdapter(config, options));
    if (adapter === "hermes")
      results.push(await installHermesAdapter(config, options));
    if (adapter === "codex")
      results.push(await installCodexAdapter(config, options));
    if (adapter === "claude")
      results.push(await installClaudeAdapter(config, options));
  }
  return results;
}

async function health(config, timeoutMs = 1_500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(forgeApiUrl(config, "/api/v1/health"), {
      headers: { accept: "application/json", "x-forge-runtime-probe": "1" },
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, status: response.status };
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return {
        ok: true,
        status: response.status,
        error: "HTTP health endpoint returned non-JSON content",
        forge: false
      };
    }
    return {
      ok: true,
      payload,
      forge: isForgeHealthPayload(payload)
    };
  } catch (error) {
    return {
      ok: false,
      error: describeNetworkError(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isForgeHealthPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  return payload.app === "forge" && payload.backend === "forge-node-runtime";
}

function describeNetworkError(error) {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "request timed out";
    if (error.message === "fetch failed")
      return "connection failed before Forge responded";
    return error.message;
  }
  return String(error);
}

function describeHealthResult(result) {
  if (result.ok && result.forge === false)
    return "HTTP 200 from a non-Forge service";
  if (result.ok) return "healthy";
  if (result.status) return `HTTP ${result.status}`;
  if (result.error) return result.error;
  return "not reachable";
}

function isHealthyForgeRuntime(result) {
  return Boolean(result?.ok && result.forge !== false);
}

async function readRuntimeState() {
  return readJson(runtimeStatePath(), null);
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcess(pid, signal = "SIGTERM") {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function signalDetachedProcessGroup(pid, signal = "SIGTERM") {
  if (process.platform === "win32") return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processExists(pid);
}

async function stopRecordedRuntimeProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || !processExists(pid)) return false;
  const signaled =
    signalDetachedProcessGroup(pid, "SIGTERM") || signalProcess(pid, "SIGTERM");
  if (!signaled) return false;
  if (await waitForProcessExit(pid)) return true;
  if (!signalDetachedProcessGroup(pid, "SIGKILL")) {
    signalProcess(pid, "SIGKILL");
  }
  await waitForProcessExit(pid, 500);
  return true;
}

async function waitForHealth(config, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await health(config);
    if (result.ok) return result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return health(config);
}

function resolveOpenClawPluginRoot(options = {}) {
  const candidates = [];
  const installedRuntimePackageJson = path.join(
    runtimeInstallRoot(),
    "package.json"
  );
  if (fs.existsSync(installedRuntimePackageJson)) {
    candidates.push(createRequire(installedRuntimePackageJson));
  }
  if (!options.installedOnly) {
    candidates.push(require);
  }

  for (const candidateRequire of candidates) {
    try {
      const entry = candidateRequire.resolve(RUNTIME_PACKAGE);
      const marker = `${path.sep}dist${path.sep}openclaw${path.sep}`;
      const markerIndex = entry.indexOf(marker);
      if (markerIndex > 0) return entry.slice(0, markerIndex);
      return path.resolve(path.dirname(entry), "..", "..");
    } catch {
      // Try the next resolver.
    }
  }
  return null;
}

function readRuntimePackageIdentity(pluginRoot) {
  if (!pluginRoot) return null;
  const manifest = readJsonSync(path.join(pluginRoot, "package.json"));
  if (
    manifest?.name !== RUNTIME_PACKAGE ||
    typeof manifest.version !== "string" ||
    !manifest.version.trim()
  ) {
    return null;
  }
  return {
    name: manifest.name,
    version: manifest.version,
    pluginRoot
  };
}

function resolveInstalledRuntimePackageIdentity() {
  return readRuntimePackageIdentity(
    resolveOpenClawPluginRoot({ installedOnly: true })
  );
}

function healthRuntimePackageIdentity(result) {
  const name = result?.payload?.runtime?.packageName;
  const version = result?.payload?.runtime?.packageVersion;
  if (typeof name !== "string" || typeof version !== "string") return null;
  return { name, version };
}

function runtimePackageIdentityMatches(identity) {
  return (
    identity?.name === RUNTIME_PACKAGE &&
    identity?.version === RUNTIME_PACKAGE_VERSION
  );
}

function runtimeStateOwnsHealthProcess(state, healthResult) {
  const runtimePid = Number(healthResult?.payload?.runtime?.pid);
  return (
    Number.isInteger(runtimePid) &&
    runtimePid > 0 &&
    Array.isArray(state?.children) &&
    state.children.some(
      (child) => child?.role === "server" && child.pid === runtimePid
    )
  );
}

function runtimeStateMatchesPackage(state, config) {
  if (config.mode !== "packaged") return true;
  if (!state) return true;
  return runtimePackageIdentityMatches({
    name: state.runtimePackageName,
    version: state.runtimePackageVersion
  });
}

async function ensurePackagedRuntimeInstalled(options = {}) {
  const existing = options.forceInstall
    ? null
    : resolveInstalledRuntimePackageIdentity();
  if (runtimePackageIdentityMatches(existing)) return existing.pluginRoot;
  const installRoot = runtimeInstallRoot();
  await fsp.mkdir(installRoot, { recursive: true });
  const packageJsonPath = path.join(installRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    await fsp.writeFile(
      packageJsonPath,
      `${JSON.stringify({ name: "forge-memory-runtime", private: true, type: "module" }, null, 2)}\n`,
      "utf8"
    );
  }
  const result = await runLoggedCommand(
    "npm",
    [
      "install",
      `${RUNTIME_PACKAGE}@${RUNTIME_PACKAGE_VERSION}`,
      "--omit=dev",
      "--ignore-scripts",
      "--silent"
    ],
    {
      cwd: installRoot,
      env: process.env,
      logFile: logPath()
    }
  );
  if (!result.ok) {
    throw new Error(
      [
        `Failed to install ${RUNTIME_PACKAGE}@${RUNTIME_PACKAGE_VERSION}.`,
        `Log: ${logPath()}`,
        "Run npx forge-memory doctor --repair after fixing network or npm access."
      ].join(" ")
    );
  }
  const installed = resolveInstalledRuntimePackageIdentity();
  if (!installed)
    throw new Error(
      `${RUNTIME_PACKAGE} installed but its runtime entry could not be resolved. Log: ${logPath()}`
    );
  if (!runtimePackageIdentityMatches(installed)) {
    throw new Error(
      `${RUNTIME_PACKAGE} installed version ${installed.version}, expected ${RUNTIME_PACKAGE_VERSION}. Log: ${logPath()}`
    );
  }
  const entry = path.join(installed.pluginRoot, "server", "index.js");
  if (!fs.existsSync(entry)) {
    throw new Error(
      `${RUNTIME_PACKAGE} installed but ${entry} is missing. Log: ${logPath()}`
    );
  }
  return installed.pluginRoot;
}

async function rotateRuntimeLog(reason) {
  if (!fs.existsSync(logPath())) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${logPath()}.${reason}-${stamp}.log`;
  await fsp.mkdir(path.dirname(backupPath), { recursive: true });
  await fsp.copyFile(logPath(), backupPath);
  return backupPath;
}

async function repairPackagedRuntimeCache(config) {
  if (config.mode === "dev") {
    const result = await startRuntime(config);
    return {
      ok: result.ok,
      mode: "dev",
      dataRoot: config.dataRoot,
      health: result.health ?? { ok: result.ok }
    };
  }

  await stopRuntime();
  const rotatedLogPath = await rotateRuntimeLog("repair");
  await fsp.rm(runtimeStatePath(), { force: true });
  await fsp.rm(runtimeInstallRoot(), { recursive: true, force: true });
  const pluginRoot = await ensurePackagedRuntimeInstalled({
    forceInstall: true
  });
  const result = await startRuntime(config);
  const record = {
    repairedAt: new Date().toISOString(),
    ok: result.ok,
    mode: config.mode,
    runtimePackage: RUNTIME_PACKAGE,
    runtimePackageVersion: RUNTIME_PACKAGE_VERSION,
    pluginRoot,
    dataRoot: config.dataRoot,
    dataPreserved: true,
    rotatedLogPath,
    health: result.health ?? { ok: result.ok }
  };
  const stamp = record.repairedAt.replace(/[:.]/g, "-");
  const repairRecordPath = path.join(
    forgeHome(),
    "run",
    `runtime-repair-${stamp}.json`
  );
  await fsp.mkdir(path.dirname(repairRecordPath), { recursive: true });
  await fsp.writeFile(
    repairRecordPath,
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );
  return { ...record, repairRecordPath };
}

function runtimeStateMatchesPeerConfig(state, config) {
  if (!state?.peer) return !config.peerEnabled;
  return (
    state.peer.enabled === config.peerEnabled &&
    (!config.peerEnabled ||
      (state.peer.irohEnabled === config.peerIrohEnabled &&
        state.peer.allowLoopbackDirect === config.peerAllowLoopbackDirect &&
        JSON.stringify(state.peer.directEndpoints ?? []) ===
          JSON.stringify(config.peerDirectEndpoints)))
  );
}

async function startRuntime(config, options = {}) {
  let current = await health(config);
  let existing = await readRuntimeState();
  if (isHealthyForgeRuntime(current)) {
    const packageMatches =
      config.mode !== "packaged" ||
      (runtimePackageIdentityMatches(healthRuntimePackageIdentity(current)) &&
        runtimeStateMatchesPackage(existing, config));
    if (!packageMatches) {
      if (runtimeStateOwnsHealthProcess(existing, current)) {
        await stopRuntime(config);
        current = await health(config);
        existing = null;
      } else {
        return {
          ok: false,
          started: false,
          adopted: false,
          runtimeVersionMismatch: true,
          expectedRuntimePackage: {
            name: RUNTIME_PACKAGE,
            version: RUNTIME_PACKAGE_VERSION
          },
          runningRuntimePackage: healthRuntimePackageIdentity(current),
          state: existing,
          health: current,
          message:
            "The healthy Forge runtime package version could not be verified. Stop it or run npx forge-memory restart before continuing."
        };
      }
    }
  }
  if (isHealthyForgeRuntime(current)) {
    if (!runtimeStateMatchesPeerConfig(existing, config)) {
      return {
        ok: false,
        started: false,
        adopted: false,
        configurationMismatch: true,
        state: existing,
        health: current,
        message:
          "The healthy Forge runtime was started with different peer-sharing settings. Run npx forge-memory restart."
      };
    }
    return {
      ok: true,
      started: false,
      adopted: true,
      state: existing,
      health: current
    };
  }
  if (current.ok && current.forge === false) {
    return {
      ok: false,
      started: false,
      state: await readRuntimeState(),
      health: current,
      portConflict: true,
      message: `Port ${config.port || DEFAULT_PORT} is already serving a non-Forge HTTP service.`
    };
  }
  if (!(await isPortAvailable(config.port || DEFAULT_PORT))) {
    return {
      ok: false,
      started: false,
      state: await readRuntimeState(),
      health: current,
      portConflict: true,
      message: `Port ${config.port || DEFAULT_PORT} is already in use.`
    };
  }
  if (existing?.pid && processExists(existing.pid)) {
    const existingHealth = await health(config);
    if (
      isHealthyForgeRuntime(existingHealth) &&
      runtimeStateMatchesPeerConfig(existing, config)
    )
      return {
        ok: true,
        started: false,
        adopted: true,
        state: existing,
        health: existingHealth
      };
  }

  const peerPreparation =
    options.peerPreparation ?? (await ensureForgePeerPrepared(config));
  const runtimeEnvironment = forgeRuntimeEnvironment(config, peerPreparation);

  await fsp.mkdir(path.dirname(logPath()), { recursive: true });
  await fsp.mkdir(path.dirname(runtimeStatePath()), { recursive: true });
  await fsp.mkdir(config.dataRoot, { recursive: true });
  const children = [];
  let out;

  try {
    out = fs.openSync(logPath(), "a");
    if (config.mode === "dev") {
      if (!config.repo)
        throw new Error("Dev mode requires a Forge repo checkout.");
      const tsx = path.join(
        config.repo,
        "node_modules",
        "tsx",
        "dist",
        "cli.mjs"
      );
      if (!fs.existsSync(tsx))
        throw new Error(
          `tsx was not found at ${tsx}. Run npm install in the Forge repo.`
        );
      const serverEntry = resolveDevServerEntry(config.repo);
      const webPortAvailable = await isPortAvailable(config.webPort);
      if (
        !webPortAvailable &&
        !(await isForgeDevWebServer(config.webPort, config.repo))
      ) {
        throw new Error(
          `Port ${config.webPort} is already in use by a service that is not the Forge Vite dev server.`
        );
      }
      const server = spawn(process.execPath, [tsx, serverEntry], {
        cwd: config.repo,
        detached: true,
        stdio: ["ignore", out, out],
        env: {
          ...runtimeEnvironment,
          HOST: "127.0.0.1",
          PORT: String(config.port),
          FORGE_BASE_PATH: "/forge/",
          FORGE_DATA_ROOT: config.dataRoot,
          FORGE_DEV_WEB_ORIGIN: `http://127.0.0.1:${config.webPort}/forge/`
        }
      });
      server.unref();
      children.push({ role: "server", pid: server.pid });
      if (webPortAvailable) {
        const web = spawn(
          "npm",
          [
            "run",
            "dev:web",
            "--",
            "--host",
            "127.0.0.1",
            "--port",
            String(config.webPort)
          ],
          {
            cwd: config.repo,
            detached: true,
            stdio: ["ignore", out, out],
            env: {
              ...runtimeEnvironment,
              FORGE_API_ORIGIN: `http://127.0.0.1:${config.port}`,
              FORGE_BASE_PATH: "/forge/"
            }
          }
        );
        web.unref();
        children.push({ role: "web", pid: web.pid });
      }
    } else {
      const pluginRoot = await ensurePackagedRuntimeInstalled();
      const entry = path.join(pluginRoot, "server", "index.js");
      const child = spawn(process.execPath, [entry], {
        cwd: pluginRoot,
        detached: true,
        stdio: ["ignore", out, out],
        env: {
          ...runtimeEnvironment,
          HOST: "127.0.0.1",
          PORT: String(config.port),
          FORGE_BASE_PATH: "/forge/",
          FORGE_DATA_ROOT: config.dataRoot
        }
      });
      child.unref();
      children.push({ role: "server", pid: child.pid });
    }
  } catch (error) {
    await Promise.all(
      children.map(async (child) => {
        if (typeof child.pid !== "number") return;
        await stopRecordedRuntimeProcess(child.pid).catch(() => false);
      })
    );
    throw error;
  } finally {
    if (typeof out === "number") {
      fs.closeSync(out);
    }
  }

  const state = {
    mode: config.mode,
    runtimePackageName: config.mode === "packaged" ? RUNTIME_PACKAGE : null,
    runtimePackageVersion:
      config.mode === "packaged" ? RUNTIME_PACKAGE_VERSION : null,
    baseUrl: baseUrl(config),
    webUrl: webUrl(config),
    dataRoot: config.dataRoot,
    logPath: logPath(),
    peer: {
      enabled: config.peerEnabled,
      irohEnabled: config.peerIrohEnabled,
      binaryPath: peerPreparation.binaryPath,
      sourceIdentity: peerPreparation.sourceIdentity ?? null,
      directEndpoints: config.peerDirectEndpoints,
      allowLoopbackDirect: config.peerAllowLoopbackDirect
    },
    children,
    startedAt: new Date().toISOString()
  };
  await writeJson(runtimeStatePath(), state, { backup: false });
  const result = await waitForHealth(config);
  return { ok: result.ok, started: true, state, health: result };
}

function assertRuntimeStartedForPairing(result, config) {
  if (result?.ok) return;
  if (result?.portConflict) {
    throw new Error(
      [
        `Forge runtime did not start because ${baseUrl(config)} is already in use by another service.`,
        `Health check: ${describeHealthResult(result?.health ?? { ok: false })}.`,
        "Run npx forge-memory status to inspect the configured runtime.",
        "If Forge Memory owns the running process, run npx forge-memory stop; otherwise stop the conflicting process or choose another --port.",
        `Runtime log: ${logPath()}.`,
        "Your data folder is unchanged."
      ].join(" ")
    );
  }
  throw new Error(
    [
      `Forge runtime did not become healthy at ${baseUrl(config)}, so iOS pairing was not started.`,
      `Health check: ${describeHealthResult(result?.health ?? { ok: false })}.`,
      `Run npx forge-memory doctor --repair and inspect ${logPath()}.`,
      `Your data folder is unchanged.`
    ].join(" ")
  );
}

async function stopRuntime(config = null) {
  const effectiveConfig = config ?? (await readConfig());
  const state = await readRuntimeState();
  const stopped = [];
  for (const child of state?.children ?? []) {
    if (!child?.pid || !processExists(child.pid)) continue;
    if (await stopRecordedRuntimeProcess(child.pid)) stopped.push(child.pid);
  }
  const current = await health(effectiveConfig);
  const runtimePid = Number(current?.payload?.runtime?.pid);
  if (
    isHealthyForgeRuntime(current) &&
    Number.isInteger(runtimePid) &&
    runtimePid > 0 &&
    !stopped.includes(runtimePid) &&
    processExists(runtimePid)
  ) {
    if (await stopRecordedRuntimeProcess(runtimePid)) stopped.push(runtimePid);
  }
  await fsp.rm(runtimeStatePath(), { force: true });
  if (stopped.length === 0) {
    return {
      ok: true,
      stopped: false,
      message: state?.children?.length
        ? "No recorded Forge Memory runtime processes were alive."
        : "No Forge Memory runtime state or live Forge runtime was found."
    };
  }
  return { ok: true, stopped: true, pids: stopped };
}

async function exportForgeData(parsed) {
  const config = await readConfig();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const requestedOutput = parsed.values.output ?? parsed.positionals[1];
  const outputPath = path.resolve(
    requestedOutput ??
      path.join(forgeHome(), "exports", `forge-memory-export-${stamp}.tar.gz`)
  );
  return createForgeDataExport(config, {
    outputPath,
    json: parsed.flags.json
  });
}

async function createForgeDataExport(config, { outputPath, json = false }) {
  if (!fs.existsSync(config.dataRoot)) {
    throw new Error(`Forge data folder does not exist: ${config.dataRoot}`);
  }
  const stagingRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "forge-memory-export-")
  );
  const stagingData = path.join(stagingRoot, "data");
  const manifest = {
    exportedAt: new Date().toISOString(),
    forgeMemoryVersion: VERSION,
    sourceDataRoot: config.dataRoot,
    config: {
      mode: config.mode,
      origin: config.origin,
      port: config.port,
      webPort: config.webPort,
      adapters: config.adapters
    }
  };

  await fsp.cp(config.dataRoot, stagingData, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (source) => {
      const relative = path.relative(config.dataRoot, source);
      if (!relative) return true;
      return !BACKUP_SKIP_TOP_LEVEL.has(relative.split(path.sep)[0]);
    }
  });
  if (fs.existsSync(configPath())) {
    await fsp.copyFile(
      configPath(),
      path.join(stagingRoot, "forge-memory-config.json")
    );
  }
  await fsp.writeFile(
    path.join(stagingRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  const wantsArchive =
    outputPath.endsWith(".tar.gz") || outputPath.endsWith(".tgz");
  if (wantsArchive && commandExists("tar")) {
    const result = spawnSync(
      "tar",
      ["-czf", outputPath, "-C", stagingRoot, "."],
      {
        stdio: json ? "ignore" : "inherit"
      }
    );
    await fsp.rm(stagingRoot, { recursive: true, force: true });
    if (result.status !== 0)
      throw new Error(`Failed to write export archive: ${outputPath}`);
    return {
      ok: true,
      outputPath,
      archive: true,
      sourceDataRoot: config.dataRoot
    };
  }

  await fsp.rm(outputPath, { recursive: true, force: true });
  await fsp.cp(stagingRoot, outputPath, { recursive: true });
  await fsp.rm(stagingRoot, { recursive: true, force: true });
  return {
    ok: true,
    outputPath,
    archive: false,
    sourceDataRoot: config.dataRoot
  };
}

async function directorySize(root, { skipTopLevel = new Set() } = {}) {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  const walk = async (current) => {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute);
      if (relative && skipTopLevel.has(relative.split(path.sep)[0])) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fsp.stat(absolute);
      total += stat.size;
    }
  };
  await walk(root);
  return total;
}

class UpdateBackupConfirmationError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "UpdateBackupConfirmationError";
    this.code = "update_backup_confirmation_required";
    this.detail = detail;
    this.guidance = [
      "Forge did not update anything because it could not create a confirmed backup first.",
      "Rerun npx forge-memory update in an interactive terminal, or pass --yes to accept the backup.",
      "Forge Memory updates never delete your data folder."
    ];
  }
}

class ManagedSkillUpdateConfirmationError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "ManagedSkillUpdateConfirmationError";
    this.code = "managed_skill_update_confirmation_required";
    this.detail = detail;
    this.guidance = [
      "Forge found an existing Forge-related skill folder that may contain manual edits.",
      "Rerun npx forge-memory update in an interactive terminal and confirm, or pass --yes after reviewing the backup.",
      "Forge backs up those skill folders before adapter updates."
    ];
  }
}

async function createUpdateBackup(config, parsed) {
  const sourceBytes = await directorySize(config.dataRoot, {
    skipTopLevel: BACKUP_SKIP_TOP_LEVEL
  });
  const thresholdBytes = updateBackupConfirmThresholdBytes();
  const needsConfirmation =
    !parsed.flags.dryRun && sourceBytes > thresholdBytes;
  if (needsConfirmation && !parsed.flags.yes) {
    if (!process.stdin.isTTY || parsed.flags.json) {
      throw new UpdateBackupConfirmationError(
        [
          `Forge data is ${formatBytes(sourceBytes)}, above the automatic backup prompt threshold of ${formatBytes(thresholdBytes)}.`,
          "No files were changed."
        ].join(" "),
        { sourceBytes, thresholdBytes, dataRoot: config.dataRoot }
      );
    }
    const confirmed = await promptYesNo(
      `Forge data is ${formatBytes(sourceBytes)}. Create a backup before updating?`,
      true
    );
    if (!confirmed) {
      throw new UpdateBackupConfirmationError(
        "Update cancelled before any files were changed because the backup was not confirmed.",
        { sourceBytes, thresholdBytes, dataRoot: config.dataRoot }
      );
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(
    forgeHome(),
    "exports",
    `forge-memory-pre-update-${stamp}.tar.gz`
  );
  if (parsed.flags.dryRun) {
    return {
      ok: true,
      dryRun: true,
      outputPath,
      sourceDataRoot: config.dataRoot,
      sourceBytes,
      thresholdBytes,
      archive: true
    };
  }
  return {
    ...(await createForgeDataExport(config, {
      outputPath,
      json: parsed.flags.json
    })),
    sourceBytes,
    thresholdBytes,
    dryRun: false
  };
}

function candidateManagedSkillTargets(config) {
  const candidates = [
    ["codex", path.join(homeDir(), ".codex", "skills", "forge-openclaw")],
    [
      "codex",
      path.join(homeDir(), ".codex", "skills", "forge-openclaw-plugin")
    ],
    ["codex", path.join(homeDir(), ".codex", "skills", "forge-memory")],
    ["openclaw", path.join(homeDir(), ".openclaw", "skills", "forge-openclaw")],
    [
      "openclaw",
      path.join(homeDir(), ".openclaw", "skills", "forge-openclaw-plugin")
    ],
    ["hermes", path.join(homeDir(), ".hermes", "skills", "forge")],
    ["hermes", path.join(homeDir(), ".hermes", "skills", "forge-openclaw")]
  ];
  const selected = new Set(config.adapters);
  return candidates
    .filter(([adapter]) => selected.has(adapter))
    .map(([adapter, targetPath]) => ({ adapter, path: targetPath }));
}

async function hashFile(filePath) {
  return createHash("sha256")
    .update(await fsp.readFile(filePath))
    .digest("hex");
}

async function hashDirectoryTree(root) {
  const entries = [];
  const walk = async (current) => {
    const children = await fsp.readdir(current, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolute = path.join(current, child.name);
      const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
      if (child.isDirectory()) {
        entries.push(`dir:${relative}`);
        await walk(absolute);
        continue;
      }
      if (child.isFile()) {
        entries.push(`file:${relative}:${await hashFile(absolute)}`);
        continue;
      }
      if (child.isSymbolicLink()) {
        entries.push(`symlink:${relative}:${await fsp.readlink(absolute)}`);
      }
    }
  };
  await walk(root);
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

async function readManagedSkillsManifest() {
  return readJson(managedSkillsManifestPath(), { version: 1, skills: {} });
}

async function writeManagedSkillsManifest(targets, options = {}) {
  const skills = {};
  for (const target of targets) {
    if (!fs.existsSync(target.path)) continue;
    skills[target.path] = {
      adapter: target.adapter,
      hash: await hashDirectoryTree(target.path),
      recordedAt: new Date().toISOString()
    };
  }
  return writeJson(
    managedSkillsManifestPath(),
    { version: 1, skills },
    { dryRun: options.dryRun, backup: true }
  );
}

async function detectManagedSkillChanges(config) {
  const manifest = await readManagedSkillsManifest();
  const targets = candidateManagedSkillTargets(config).filter((target) =>
    fs.existsSync(target.path)
  );
  const changes = [];
  for (const target of targets) {
    const currentHash = await hashDirectoryTree(target.path);
    const previous = manifest?.skills?.[target.path];
    if (!previous || previous.hash !== currentHash) {
      changes.push({
        ...target,
        currentHash,
        previousHash: previous?.hash ?? null,
        reason: previous ? "modified" : "untracked"
      });
    }
  }
  return { targets, changes };
}

async function backupManagedSkillTargets(changes, parsed) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backups = [];
  for (const change of changes) {
    const destination = path.join(
      forgeHome(),
      "backups",
      "skills",
      stamp,
      change.adapter,
      path.basename(change.path)
    );
    backups.push({
      ...change,
      backupPath: destination,
      dryRun: parsed.flags.dryRun
    });
    if (parsed.flags.dryRun) continue;
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.cp(change.path, destination, { recursive: true });
  }
  return backups;
}

async function prepareManagedSkillUpdates(config, parsed) {
  const { targets, changes } = await detectManagedSkillChanges(config);
  if (!changes.length) return { targets, changes: [], backups: [] };
  if (parsed.flags.dryRun) {
    const backups = await backupManagedSkillTargets(changes, parsed);
    return { targets, changes, backups };
  }
  if (!parsed.flags.yes) {
    if (!process.stdin.isTTY || parsed.flags.json) {
      throw new ManagedSkillUpdateConfirmationError(
        [
          `Forge found ${changes.length} existing Forge-related skill folder(s) with unknown or manual changes.`,
          "No update was applied after the data backup."
        ].join(" "),
        { changes }
      );
    }
    console.log(color.yellow("Forge found skill folders with possible edits:"));
    for (const change of changes) {
      console.log(
        `- ${change.path} ${color.dim(`(${change.adapter}, ${change.reason})`)}`
      );
    }
    const confirmed = await promptYesNo(
      "Back up these skill folders and continue updating adapters?",
      true
    );
    if (!confirmed) {
      throw new ManagedSkillUpdateConfirmationError(
        "Update cancelled after the data backup because skill update was not confirmed.",
        { changes }
      );
    }
  }
  const backups = await backupManagedSkillTargets(changes, parsed);
  return { targets, changes, backups };
}

async function removeOpenClawAdapterConfig() {
  const filePath = path.join(homeDir(), ".openclaw", "openclaw.json");
  const payload = await readJson(filePath, null);
  if (!payload?.plugins?.entries?.[FORGE_PLUGIN_ID])
    return { filePath, changed: false };
  await backupIfExists(filePath);
  delete payload.plugins.entries[FORGE_PLUGIN_ID];
  if (Array.isArray(payload.plugins.allow)) {
    payload.plugins.allow = payload.plugins.allow.filter(
      (entry) => entry !== FORGE_PLUGIN_ID
    );
  }
  await fsp.writeFile(
    filePath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
  return { filePath, changed: true };
}

async function removeHermesAdapterConfig() {
  const forgeConfigPath = path.join(
    homeDir(),
    ".hermes",
    "forge",
    "config.json"
  );
  let changed = false;
  if (fs.existsSync(forgeConfigPath)) {
    await backupIfExists(forgeConfigPath);
    await fsp.rm(forgeConfigPath, { force: true });
    changed = true;
  }
  const forgeConfigDir = path.dirname(forgeConfigPath);
  if (fs.existsSync(forgeConfigDir)) {
    await fsp
      .rm(forgeConfigDir, { recursive: false, force: true })
      .catch(() => {});
  }

  const hermesYamlPath = path.join(homeDir(), ".hermes", "config.yaml");
  if (fs.existsSync(hermesYamlPath)) {
    const raw = await fsp.readFile(hermesYamlPath, "utf8");
    const doc = YAML.parseDocument(raw);
    const root = doc.toJSON() ?? {};
    const enabled = Array.isArray(root.plugins?.enabled)
      ? root.plugins.enabled
      : null;
    if (enabled?.includes("forge")) {
      root.plugins.enabled = enabled.filter((entry) => entry !== "forge");
      doc.contents = doc.createNode(root);
      await backupIfExists(hermesYamlPath);
      await fsp.writeFile(hermesYamlPath, String(doc), "utf8");
      changed = true;
    }
  }
  return { filePath: forgeConfigPath, yamlPath: hermesYamlPath, changed };
}

async function removeCodexAdapterConfig() {
  const filePath = path.join(homeDir(), ".codex", "config.toml");
  if (!fs.existsSync(filePath)) return { filePath, changed: false };
  const source = await fsp.readFile(filePath, "utf8");
  const next = stripCodexForgeMcpConfig(source);
  if (next === source.trimEnd()) return { filePath, changed: false };
  await backupIfExists(filePath);
  await fsp.writeFile(filePath, next ? `${next}\n` : "", "utf8");
  return { filePath, changed: true };
}

async function removeClaudeAdapterConfig() {
  const filePath = claudeConfigPath();
  const payload = await readJson(filePath, null);
  let changed = false;
  if (payload && typeof payload === "object") {
    const servers =
      payload.mcpServers && typeof payload.mcpServers === "object"
        ? { ...payload.mcpServers }
        : null;
    if (servers?.forge && isForgeMemoryMcpServer(servers.forge)) {
      delete servers.forge;
      const next = { ...payload };
      if (Object.keys(servers).length > 0) next.mcpServers = servers;
      else delete next.mcpServers;
      await writeJson(filePath, next, { backup: true });
      changed = true;
    }
  }

  const rulesPath = claudeForgeRulesPath();
  if (fs.existsSync(rulesPath)) {
    const source = await fsp.readFile(rulesPath, "utf8");
    const next = removeForgeManagedBlock(source);
    if (next !== source.trim()) {
      await backupIfExists(rulesPath);
      if (next) await fsp.writeFile(rulesPath, `${next}\n`, "utf8");
      else await fsp.rm(rulesPath, { force: true });
      changed = true;
    }
  }

  return { filePath, rulesPath, changed };
}

async function uninstallForgeMemory(parsed) {
  const config = await readConfig();
  const confirmed = parsed.flags.yes
    ? true
    : await promptYesNo(
        `Uninstall Forge Memory runtime manager and keep data at ${config.dataRoot}?`,
        true
      );
  if (!confirmed) return { ok: false, cancelled: true };

  const stop = await stopRuntime();
  const removed = [];
  for (const target of [
    runtimeInstallRoot(),
    runtimeStatePath(),
    logPath(),
    configPath()
  ]) {
    if (fs.existsSync(target)) {
      await fsp.rm(target, { recursive: true, force: true });
      removed.push(target);
    }
  }

  let adapterResults = [];
  const removeAdapters =
    parsed.flags.removeAdapters ||
    (!parsed.flags.yes &&
      (await promptYesNo(
        "Remove Forge adapter entries from OpenClaw, Hermes, Codex, and Claude Code?",
        false
      )));
  if (removeAdapters) {
    adapterResults = [
      await removeOpenClawAdapterConfig(),
      await removeHermesAdapterConfig(),
      await removeCodexAdapterConfig(),
      await removeClaudeAdapterConfig()
    ];
  }

  let removedDataRoot = false;
  if (parsed.flags.removeData) {
    const dataConfirmed = parsed.flags.yes
      ? true
      : await promptYesNo(
          `Delete Forge data folder ${config.dataRoot}? This cannot be undone.`,
          false
        );
    if (dataConfirmed) {
      await fsp.rm(config.dataRoot, { recursive: true, force: true });
      removedDataRoot = true;
    }
  }

  return {
    ok: true,
    stop,
    removed,
    adapterResults,
    dataRoot: config.dataRoot,
    dataKept: !removedDataRoot,
    removedDataRoot
  };
}

function normalizePublicPairingUrl(value) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.toString();
  } catch {
    throw new Error(
      `Invalid --public-url value: ${value}. Use a full URL such as https://your-mac.tailnet.ts.net/forge/`
    );
  }
}

function readSetCookieHeader(headers) {
  if (typeof headers.getSetCookie === "function") {
    const values = headers.getSetCookie();
    if (values.length > 0) return values[0];
  }
  return headers.get("set-cookie");
}

function cookiePairFromSetCookie(value) {
  if (!value) return null;
  return value.split(";")[0]?.trim() || null;
}

class PairingAuthError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "PairingAuthError";
    this.code = "pairing_auth_failed";
    this.detail = detail;
    this.guidance = [
      "Forge is reachable, but Forge Memory could not create a local operator session for iOS pairing.",
      "Run npx forge-memory doctor to confirm the runtime is healthy.",
      "Then rerun npx forge-memory pair-ios."
    ];
  }
}

class PairingRequestError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "PairingRequestError";
    this.code = "pairing_request_failed";
    this.detail = detail;
    this.guidance =
      detail.status === 401
        ? [
            "Forge is reachable, but the pairing request was not authenticated.",
            "Forge Memory should bootstrap a local operator session before pairing; rerun npx forge-memory pair-ios after updating.",
            "Run npx forge-memory doctor only if runtime health also fails."
          ]
        : [
            "Forge is reachable, but it rejected the iOS pairing request.",
            "Run npx forge-memory doctor to confirm runtime health, then inspect the response above."
          ];
  }
}

class PairingTransportUnavailableError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "PairingTransportUnavailableError";
    this.code = "pairing_transport_unavailable";
    this.detail = detail;
    this.guidance = [
      "Run npx forge-memory install or npx forge-memory configure so the installer can prepare the Iroh transport.",
      "If Rust/Cargo is missing, the installer will guide you through installing the minimal Rust toolchain and building Forge's bundled Iroh host source.",
      "For an explicit Tailscale or LAN fallback, rerun with npx forge-memory pair-ios --manual-http --public-url <phone-reachable Forge URL>.",
      "Do not scan a QR whose API URL is 127.0.0.1 on a physical iPhone; that address only works in the iOS Simulator."
    ];
  }
}

async function bootstrapLocalOperatorSession(config) {
  const sessionUrl = forgeApiUrl(config, "/api/v1/auth/operator-session");
  let response;
  try {
    response = await fetch(sessionUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        host: localHostHeader(config)
      }
    });
  } catch (error) {
    throw new PairingAuthError(
      [
        `Could not create a local operator session at ${sessionUrl}.`,
        `Network: ${describeNetworkError(error)}.`
      ].join(" "),
      { url: sessionUrl.toString() }
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new PairingAuthError(
      [
        `Could not create a local operator session at ${sessionUrl}: Forge returned HTTP ${response.status}.`,
        body ? `Response: ${body.slice(0, 500)}` : ""
      ]
        .filter(Boolean)
        .join(" "),
      { url: sessionUrl.toString(), status: response.status }
    );
  }
  const cookie = cookiePairFromSetCookie(readSetCookieHeader(response.headers));
  if (!cookie) {
    throw new PairingAuthError(
      `Could not create a local operator session at ${sessionUrl}: Forge did not return a session cookie.`,
      { url: sessionUrl.toString(), status: response.status }
    );
  }
  return cookie;
}

async function createPairing(config, options = {}) {
  const transportMode = options.transportMode ?? "iroh";
  const publicUrl = validatePairingOptions({
    transportMode,
    publicUrl: options.publicUrl
  });
  const pairingUrl = forgeApiUrl(config, "/api/v1/health/pairing-sessions");
  const operatorCookie = await bootstrapLocalOperatorSession(config);
  let response;
  try {
    response = await fetch(pairingUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        cookie: operatorCookie,
        ...(publicUrl ? { referer: publicUrl } : {})
      },
      body: JSON.stringify({
        userId: null,
        transportMode,
        fallbackMode: publicUrl ? publicUrlFallbackMode(publicUrl) : "none",
        publicUrl: publicUrl ?? undefined
      })
    });
  } catch (error) {
    const healthResult = await health(config, 1_500);
    const manualHttpHint =
      transportMode === "manual-http" && !publicUrl
        ? " For a physical iPhone using manual HTTP, rerun with --public-url set to your Tailscale or LAN Forge URL, for example: npx forge-memory pair-ios --manual-http --public-url https://your-mac.tailnet.ts.net/forge/"
        : "";
    throw new Error(
      [
        `Could not create iOS pairing because Forge did not respond at ${pairingUrl}.`,
        `Network: ${describeNetworkError(error)}.`,
        `Health check: ${describeHealthResult(healthResult)}.`,
        `Run npx forge-memory doctor --repair, then npx forge-memory pair-ios again.`,
        `Runtime log: ${logPath()}.${manualHttpHint}`
      ].join(" ")
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new PairingRequestError(
      [
        `Could not create iOS pairing at ${pairingUrl}: Forge returned HTTP ${response.status}.`,
        body ? `Response: ${body.slice(0, 500)}` : "",
        response.status === 401
          ? "Forge Memory did not obtain or pass a valid local operator session cookie."
          : "Inspect the response and rerun npx forge-memory doctor if runtime health is uncertain."
      ]
        .filter(Boolean)
        .join(" "),
      { url: pairingUrl.toString(), status: response.status }
    );
  }
  const pairing = await response.json();
  assertPairingTransportUsable(pairing, {
    requestedTransportMode: transportMode
  });
  return pairing;
}

async function maybeInstallTailscaleForPairing(parsed) {
  const plan = tailscaleInstallPlan();
  if (parsed.flags.json || parsed.flags.dryRun || !process.stdin.isTTY) {
    return { installed: false, guidance: plan.guidance };
  }
  console.log(color.bold("Tailscale pairing"));
  console.log(tailscalePreferredMessage());
  console.log(color.dim("Tailscale is not installed or not visible on PATH."));
  for (const item of plan.guidance) console.log(color.dim(`- ${item}`));
  if (!plan.installable || !plan.autoInstallCommand) {
    return { installed: false, guidance: plan.guidance };
  }
  const shouldInstall = await promptYesNo(
    "Install Tailscale now before falling back to Iroh?",
    true
  );
  if (!shouldInstall) return { installed: false, guidance: plan.guidance };
  const result = await runCommand(
    plan.autoInstallCommand.command,
    plan.autoInstallCommand.args
  );
  return { installed: result.ok, guidance: plan.guidance, result };
}

async function resolveTailscalePairingOptions(parsed, config) {
  const state = detectTailscaleState();
  if (state.disabled) return null;
  if (!state.installed) {
    const installAttempt = await maybeInstallTailscaleForPairing(parsed);
    if (installAttempt.installed) {
      const installedState = detectTailscaleState();
      if (
        installedState.installed &&
        installedState.running &&
        installedState.authenticated
      ) {
        return resolveTailscalePairingOptions(parsed, config);
      }
    }
    return null;
  }
  if (!state.running || !state.authenticated || !state.publicUrl) {
    if (!parsed.flags.json && process.stdin.isTTY) {
      console.log(color.bold("Tailscale pairing"));
      console.log(tailscalePreferredMessage());
      console.log(
        color.yellow(
          "Tailscale is installed, but it is not running/authenticated or does not expose a MagicDNS name."
        )
      );
      console.log(
        color.dim(
          "Open Tailscale, sign in, then rerun npx forge-memory pair-ios. Falling back to Iroh for this pairing."
        )
      );
    }
    return null;
  }

  const firstProbe = await probePublicForgeUrl(state.publicUrl);
  if (firstProbe.ok) {
    if (!parsed.flags.json) {
      console.log(
        color.green(`Using Tailscale for iOS pairing: ${state.publicUrl}`)
      );
    }
    return {
      transportMode: "manual-http",
      publicUrl: validatePairingOptions({
        transportMode: "manual-http",
        publicUrl: state.publicUrl
      }),
      source: "tailscale"
    };
  }

  const canConfigureServe =
    !parsed.flags.json &&
    !parsed.flags.dryRun &&
    (parsed.flags.yes ||
      (process.stdin.isTTY &&
        (await promptYesNo(
          [
            `Tailscale is running, but Forge is not reachable at ${state.publicUrl}.`,
            "Serve Forge through Tailscale now?"
          ].join(" "),
          true
        ))));
  if (!canConfigureServe) {
    if (!parsed.flags.json && process.stdin.isTTY) {
      console.log(
        color.yellow(
          `Tailscale is running, but Forge was not reachable at ${state.publicUrl}: ${firstProbe.error ?? firstProbe.status ?? "unknown error"}. Falling back to Iroh.`
        )
      );
    }
    return null;
  }

  const serveResult = await configureTailscaleServe(config, parsed.flags);
  if (!serveResult.ok) {
    if (!parsed.flags.json) {
      console.log(
        color.yellow(
          "Could not configure Tailscale Serve automatically. Falling back to Iroh."
        )
      );
    }
    return null;
  }
  const secondProbe = await probePublicForgeUrl(state.publicUrl, 8_000);
  if (!secondProbe.ok) {
    if (!parsed.flags.json) {
      console.log(
        color.yellow(
          `Tailscale Serve was configured, but Forge still was not reachable at ${state.publicUrl}: ${secondProbe.error ?? secondProbe.status ?? "unknown error"}. Falling back to Iroh.`
        )
      );
    }
    return null;
  }
  if (!parsed.flags.json) {
    console.log(
      color.green(`Using Tailscale for iOS pairing: ${state.publicUrl}`)
    );
  }
  return {
    transportMode: "manual-http",
    publicUrl: validatePairingOptions({
      transportMode: "manual-http",
      publicUrl: state.publicUrl
    }),
    source: "tailscale"
  };
}

async function resolveIosPairingOptions(parsed, config = null) {
  if (parsed.flags.manualHttp) {
    return {
      transportMode: "manual-http",
      publicUrl: validatePairingOptions({
        transportMode: "manual-http",
        publicUrl: parsed.values.publicUrl
      })
    };
  }
  if (parsed.values.publicUrl) {
    return {
      transportMode: "manual-http",
      publicUrl: validatePairingOptions({
        transportMode: "manual-http",
        publicUrl: parsed.values.publicUrl
      }),
      source: publicUrlFallbackMode(parsed.values.publicUrl)
    };
  }
  if (config) {
    const tailscalePairing = await resolveTailscalePairingOptions(
      parsed,
      config
    );
    if (tailscalePairing) return tailscalePairing;
  }
  if (parsed.flags.yes || parsed.flags.json || !process.stdin.isTTY) {
    return {
      transportMode: "iroh",
      publicUrl: validatePairingOptions({
        transportMode: "iroh",
        publicUrl: parsed.values.publicUrl
      })
    };
  }
  console.log(color.bold("iOS companion connection"));
  console.log(color.dim(tailscalePreferredMessage()));
  console.log(
    color.dim("Choose Iroh or a fixed/private IP fallback for this pairing.")
  );
  const choice = (
    await promptLine("Connection [iroh/ip]", "iroh")
  ).toLowerCase();
  if (choice === "ip" || choice === "fixed" || choice === "private") {
    const publicUrl = await promptLine(
      "Private/fixed Forge URL",
      parsed.values.publicUrl ?? "http://192.168.1.98:4317/forge/"
    );
    return {
      transportMode: "manual-http",
      publicUrl: validatePairingOptions({
        transportMode: "manual-http",
        publicUrl
      })
    };
  }
  return {
    transportMode: "iroh",
    publicUrl: validatePairingOptions({
      transportMode: "iroh",
      publicUrl: parsed.values.publicUrl
    })
  };
}

function assertPairingTransportUsable(pairing, { requestedTransportMode }) {
  const payload = pairing?.qrPayload;
  if (!payload || requestedTransportMode !== "iroh") {
    return;
  }
  const resolvedTransportMode =
    payload.transportMode ?? payload.transport?.protocol;
  const resolvedProtocol = payload.transport?.protocol;
  if (resolvedTransportMode === "iroh" || resolvedProtocol === "iroh") {
    const phoneFacingUrls = [
      payload.apiBaseUrl,
      payload.uiBaseUrl,
      payload.transport?.publicBaseUrl
    ].filter(Boolean);
    const loopbackUrl = phoneFacingUrls.find((url) =>
      isLoopbackPairingUrl(url)
    );
    if (loopbackUrl) {
      throw new PairingTransportUnavailableError(
        [
          "Forge created an Iroh pairing that exposes a loopback URL as phone-facing pairing data.",
          `Bad URL: ${loopbackUrl}.`,
          "A physical iPhone cannot reach localhost on this Mac.",
          "Use Iroh logical URLs, a selected Tailscale URL, or a selected private/fixed IP URL."
        ].join(" "),
        {
          apiBaseUrl: payload.apiBaseUrl,
          transportMode: resolvedTransportMode,
          protocol: resolvedProtocol
        }
      );
    }
    return;
  }
  const apiBaseUrl = payload.apiBaseUrl ?? "";
  const lastError = payload.transport?.lastError;
  const notes = Array.isArray(payload.transport?.notes)
    ? payload.transport.notes
    : [];
  throw new PairingTransportUnavailableError(
    [
      "Forge created a direct HTTP pairing while default iOS pairing requested Iroh.",
      isLoopbackPairingUrl(apiBaseUrl)
        ? `The generated API URL is ${apiBaseUrl}, which a physical iPhone cannot reach.`
        : apiBaseUrl
          ? `The generated API URL is ${apiBaseUrl}, but this was not an Iroh pairing.`
          : "The response did not include a usable Iroh API URL.",
      lastError ? `Iroh error: ${lastError}` : "",
      notes.length ? `Notes: ${notes.join(" ")}` : ""
    ]
      .filter(Boolean)
      .join(" "),
    {
      apiBaseUrl,
      transportMode: resolvedTransportMode,
      protocol: resolvedProtocol
    }
  );
}

function validatePairingOptions({ transportMode, publicUrl }) {
  const normalizedPublicUrl = normalizePublicPairingUrl(publicUrl);
  if (normalizedPublicUrl && isLoopbackPairingUrl(normalizedPublicUrl)) {
    throw new Error(
      [
        `--public-url points at ${normalizedPublicUrl}, which is loopback-only.`,
        "A physical iPhone cannot reach localhost on this Mac.",
        "Use Iroh, Tailscale, or a private/fixed IP URL."
      ].join(" ")
    );
  }
  if (transportMode !== "manual-http") {
    return normalizedPublicUrl;
  }
  if (!normalizedPublicUrl) {
    throw new Error(
      [
        "Manual HTTP pairing for a physical iPhone requires --public-url.",
        "Use a phone-reachable Tailscale or LAN Forge URL, for example:",
        "npx forge-memory pair-ios --manual-http --public-url https://your-mac.tailnet.ts.net/forge/",
        "For normal pairing, omit --manual-http and use the default Iroh transport."
      ].join(" ")
    );
  }
  return normalizedPublicUrl;
}

function compactPairingPayload(payload) {
  const transport = payload.transport
    ? {
        protocol: payload.transport.protocol,
        provider: payload.transport.provider,
        status: payload.transport.status,
        publicBaseUrl: payload.transport.publicBaseUrl,
        localBaseUrl: payload.transport.localBaseUrl,
        nodeId: payload.transport.nodeId,
        relay: payload.transport.relay,
        alpn: payload.transport.alpn,
        agent: payload.transport.agent,
        pairPayload: payload.transport.pairPayload,
        lastError: payload.transport.lastError,
        notes: []
      }
    : undefined;
  return compactObject({
    kind: payload.kind,
    apiBaseUrl: payload.apiBaseUrl,
    uiBaseUrl: payload.uiBaseUrl,
    transportMode: payload.transportMode,
    transport,
    sessionId: payload.sessionId,
    pairingToken: payload.pairingToken,
    expiresAt: payload.expiresAt,
    capabilities: payload.capabilities
  });
}

function compactQrPairingPayload(payload) {
  const manualPayload = compactPairingPayload(payload);
  const transport = manualPayload.transport
    ? compactObject({
        p: manualPayload.transport.protocol,
        d: manualPayload.transport.provider,
        s: manualPayload.transport.status,
        pb: manualPayload.transport.publicBaseUrl,
        lb: manualPayload.transport.localBaseUrl,
        n: manualPayload.transport.nodeId,
        r: manualPayload.transport.relay,
        a: manualPayload.transport.alpn,
        g: manualPayload.transport.agent,
        pp: manualPayload.transport.pairPayload
          ? compactObject({
              v: manualPayload.transport.pairPayload.v,
              n:
                manualPayload.transport.pairPayload.node_id ??
                manualPayload.transport.pairPayload.nodeId,
              t: manualPayload.transport.pairPayload.token,
              h:
                manualPayload.transport.pairPayload.host_name ??
                manualPayload.transport.pairPayload.hostName,
              r: manualPayload.transport.pairPayload.relay
            })
          : undefined,
        le: manualPayload.transport.lastError
      })
    : undefined;
  return compactObject({
    k: "fcp1",
    a: manualPayload.apiBaseUrl,
    u: manualPayload.uiBaseUrl,
    m: manualPayload.transportMode,
    t: transport,
    s: manualPayload.sessionId,
    pt: manualPayload.pairingToken,
    e: manualPayload.expiresAt,
    c: manualPayload.capabilities
  });
}

function compactObject(value) {
  if (Array.isArray(value)) {
    const compacted = value
      .map((entry) => compactObject(entry))
      .filter((entry) => entry !== undefined);
    return compacted.length ? compacted : undefined;
  }
  if (!value || typeof value !== "object") {
    return value ?? undefined;
  }
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    const compacted = compactObject(entry);
    if (
      compacted !== undefined &&
      !(Array.isArray(compacted) && compacted.length === 0)
    ) {
      output[key] = compacted;
    }
  }
  return Object.keys(output).length ? output : undefined;
}

async function writePairingPayloadFile(payload) {
  const pairingDir = path.join(forgeHome(), "pairing");
  await fsp.mkdir(pairingDir, { recursive: true });
  const filePath = path.join(
    pairingDir,
    `forge-companion-${payload.sessionId}.json`
  );
  await fsp.writeFile(
    filePath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
  return filePath;
}

function isLoopbackPairingUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

async function printPairing(pairing) {
  const manualPayload = compactPairingPayload(pairing.qrPayload);
  const qrPayload = compactQrPairingPayload(pairing.qrPayload);
  const qrPayloadText = JSON.stringify(qrPayload);
  const terminalColumns = process.stdout.columns ?? 120;
  if (terminalColumns >= 72 && qrPayloadText.length <= 1_500) {
    console.log("\nScan this compact QR in Forge Companion:\n");
    qrcode.generate(qrPayloadText, { small: true });
  } else {
    console.log("");
    console.log(
      color.yellow(
        "QR skipped because the terminal is too narrow or the payload is too large to scan reliably."
      )
    );
    console.log(
      "Use Manual connection in the iPhone app and paste the saved payload below."
    );
  }
  const transport = manualPayload.transport;
  if (transport?.provider) {
    const label =
      manualPayload.transport?.protocol === "iroh"
        ? "Iroh"
        : manualPayload.transportMode === "iroh"
          ? "Iroh"
          : "Manual HTTP";
    console.log(`${color.cyan(label)}: ${manualPayload.apiBaseUrl}`);
    if (
      label === "Manual HTTP" &&
      isLoopbackPairingUrl(manualPayload.apiBaseUrl)
    ) {
      console.log(
        color.yellow(
          "Manual HTTP points at this machine's loopback address. That is only useful for the iOS Simulator; a real iPhone needs Iroh, Tailscale, or a LAN URL passed with --public-url."
        )
      );
    }
    for (const note of pairing.qrPayload?.transport?.notes ?? []) {
      console.log(color.dim(note));
    }
  }
  try {
    const filePath = await writePairingPayloadFile(manualPayload);
    console.log("");
    console.log(
      color.bold("If the QR is too large or the camera will not scan:")
    );
    console.log("1. Open Manual connection in the iPhone app.");
    console.log("2. Tap Paste pairing payload.");
    console.log(`3. Paste the payload saved at: ${filePath}`);
    console.log(color.dim(`   cat ${filePath}`));
    console.log("");
    console.log(
      color.dim(
        `QR payload bytes: ${qrPayloadText.length}; manual payload bytes: ${JSON.stringify(manualPayload).length}`
      )
    );
  } catch (error) {
    console.log(
      color.yellow(
        `Could not save pairing payload file: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    console.log(JSON.stringify(manualPayload));
  }
}

function peerRuntimeConfigChanged(left, right) {
  return (
    left.peerEnabled !== right.peerEnabled ||
    left.peerIrohEnabled !== right.peerIrohEnabled ||
    left.peerAllowLoopbackDirect !== right.peerAllowLoopbackDirect ||
    JSON.stringify(left.peerDirectEndpoints) !==
      JSON.stringify(right.peerDirectEndpoints)
  );
}

async function runInstall(parsed, command) {
  const currentConfig = await readConfig();
  if (!parsed.flags.yes) {
    printBanner();
    console.log(
      color.dim(
        "Forge UI/runtime is always installed. Host adapter discovery runs first.\n"
      )
    );
  }
  const discovery = await withProgress(
    "Looking for host adapters",
    "OpenClaw, Hermes, and Codex",
    parsed.flags,
    async () => discover()
  );
  const config = await buildInstallConfig(
    parsed,
    currentConfig,
    discovery,
    command
  );
  const writeResult = await withProgress(
    "Saving Forge settings",
    configPath(),
    parsed.flags,
    () =>
      writeConfig(config, {
        dryRun: parsed.flags.dryRun
      })
  );
  if (
    peerRuntimeConfigChanged(currentConfig, config) &&
    !parsed.flags.noStart &&
    !parsed.flags.dryRun
  ) {
    await withProgress(
      "Applying Forge peer runtime settings",
      "restarting only the managed runtime process",
      parsed.flags,
      () => stopRuntime(currentConfig)
    );
  }
  await withProgress(
    "Preparing Forge data folder",
    config.dataRoot,
    parsed.flags,
    async () => {
      if (!parsed.flags.dryRun) {
        await fsp.mkdir(config.dataRoot, { recursive: true });
      }
      return { ok: true, dataRoot: config.dataRoot };
    }
  );
  const adapterResults = await withProgress(
    config.adapters.length
      ? "Configuring selected host adapters"
      : "Skipping host adapter configuration",
    config.adapters.length ? config.adapters.join(", ") : "none selected",
    parsed.flags,
    () =>
      configureAdapters(config, {
        dryRun: parsed.flags.dryRun
      })
  );
  let peerPreparation = {
    ok: true,
    enabled: config.peerEnabled,
    built: false,
    binaryPath: null,
    dryRun: parsed.flags.dryRun
  };
  if (config.peerEnabled && !parsed.flags.dryRun) {
    peerPreparation = await withProgress(
      "Preparing secure Forge peer sharing",
      "verifying signed source and the owner-only native runtime",
      parsed.flags,
      () => ensureForgePeerPrepared(config, parsed.flags)
    );
  }
  const shouldPair =
    parsed.flags.pairIos ||
    (!parsed.flags.skipPairIos &&
      (parsed.flags.yes
        ? true
        : await promptYesNo("Pair the iOS companion now?", true)));
  let runtimeResult = null;
  if (!parsed.flags.noStart && !parsed.flags.dryRun) {
    runtimeResult = await withProgress(
      config.mode === "dev"
        ? "Starting source-backed Forge runtime"
        : "Installing and starting Forge runtime",
      `logs: ${logPath()}`,
      parsed.flags,
      () => startRuntime(config, { peerPreparation })
    );
  } else if (parsed.flags.noStart) {
    printStep(
      "Runtime start skipped",
      "run npx forge-memory ui or npx forge-memory restart later",
      parsed.flags
    );
  }
  let doctorResult = null;
  if (!parsed.flags.noDoctor) {
    doctorResult = await withProgress(
      "Running Forge doctor",
      parsed.flags.noStart ? "offline checks" : "health and repair checks",
      parsed.flags,
      () =>
        runDoctorChecks(parsed, config, {
          repair: true,
          noStart: parsed.flags.noStart,
          dryRun: parsed.flags.dryRun
        })
    );
    if (!doctorResult.ok && !parsed.flags.json && !parsed.flags.dryRun) {
      console.log(color.yellow("Forge doctor found follow-up work:"));
      for (const check of doctorResult.checks.filter((entry) => !entry.ok)) {
        console.log(`- ${check.id}: ${check.guidance}`);
      }
    }
  }
  const pairingOptions = shouldPair
    ? await resolveIosPairingOptions(parsed, config)
    : null;
  let irohTransportResult = null;
  if (
    shouldPair &&
    pairingOptions?.transportMode !== "manual-http" &&
    !parsed.flags.dryRun
  ) {
    irohTransportResult = await withProgress(
      "Preparing Forge Companion Iroh transport",
      "checking Rust/Cargo and building the local host",
      parsed.flags,
      () => ensureIrohTransportPrepared(config, parsed.flags)
    );
  }
  let pairing = null;
  if (shouldPair && !parsed.flags.dryRun) {
    if (!runtimeResult) {
      runtimeResult = await withProgress(
        "Starting Forge runtime for iOS pairing",
        `logs: ${logPath()}`,
        parsed.flags,
        () => startRuntime(config, { peerPreparation })
      );
    }
    assertRuntimeStartedForPairing(runtimeResult, config);
    pairing = await withProgress(
      "Creating iOS companion pairing",
      pairingOptions.transportMode === "manual-http"
        ? "phone-reachable HTTP"
        : "Iroh QR",
      parsed.flags,
      () =>
        createPairing(config, {
          transportMode: pairingOptions.transportMode,
          publicUrl: pairingOptions.publicUrl
        })
    );
    if (pairing?.qrPayload && !parsed.flags.json) {
      await printPairing(pairing);
    }
  } else if (parsed.flags.skipPairIos) {
    printStep(
      "iOS pairing skipped",
      "run npx forge-memory pair-ios when you want the QR",
      parsed.flags
    );
  }
  const summary = {
    ok: true,
    config,
    writeResult,
    adapterResults,
    runtimeResult,
    doctorResult,
    peerPreparation,
    irohTransportResult,
    pairing: Boolean(pairing)
  };
  if (parsed.flags.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(color.green("Forge Memory configured and checked."));
    console.log(`UI: ${webUrl(config)}`);
    console.log(`Data: ${config.dataRoot}`);
    console.log(
      `Peer sharing: ${
        config.peerEnabled
          ? peerPreparation.ok
            ? color.green("enabled")
            : color.yellow("needs attention")
          : "disabled"
      }`
    );
    console.log(
      `Doctor: ${
        parsed.flags.dryRun
          ? color.yellow("preview only")
          : doctorResult?.ok === false
            ? color.yellow("needs attention")
            : color.green("passed")
      }`
    );
    if (parsed.flags.dryRun)
      console.log(
        color.yellow("Dry run only; no files or adapter installs were changed.")
      );
  }
}

async function refreshPackagedRuntimeCache(parsed) {
  if (parsed.flags.dryRun) {
    return {
      ok: true,
      dryRun: true,
      mode: "packaged",
      removedRuntimeCache: runtimeInstallRoot(),
      runtimePackage: RUNTIME_PACKAGE,
      runtimePackageVersion: RUNTIME_PACKAGE_VERSION
    };
  }
  await fsp.rm(runtimeInstallRoot(), { recursive: true, force: true });
  const pluginRoot = await ensurePackagedRuntimeInstalled({
    forceInstall: true
  });
  return {
    ok: true,
    mode: "packaged",
    removedRuntimeCache: runtimeInstallRoot(),
    runtimePackage: RUNTIME_PACKAGE,
    runtimePackageVersion: RUNTIME_PACKAGE_VERSION,
    pluginRoot
  };
}

async function runUpdate(parsed) {
  const currentConfig = await readConfig();
  const adapterOverride = parsed.flags.skipAdapters
    ? null
    : normalizeAdapterList(parsed.values.adapters);
  const config =
    adapterOverride === null
      ? currentConfig
      : { ...currentConfig, adapters: adapterOverride };

  if (!parsed.flags.json) {
    printBanner();
    console.log(
      color.dim(
        "Forge update creates a backup first, refreshes the runtime cache, then updates selected adapters."
      )
    );
    console.log("");
  }

  const backup = await withProgress(
    "Backing up Forge data before update",
    currentConfig.dataRoot,
    parsed.flags,
    () => createUpdateBackup(currentConfig, parsed)
  );
  if (!parsed.flags.json) {
    console.log(
      `${color.green("Backup ready")}: ${backup.outputPath} ${color.dim(`(${formatBytes(backup.sourceBytes)} source data)`)}`
    );
  }

  const skillPlan = await withProgress(
    "Checking Forge-managed skill folders",
    config.adapters.length
      ? config.adapters.join(", ")
      : "no selected adapters",
    parsed.flags,
    () => prepareManagedSkillUpdates(config, parsed)
  );

  let writeResult = null;
  if (adapterOverride !== null) {
    writeResult = await withProgress(
      "Saving updated adapter selection",
      config.adapters.length ? config.adapters.join(", ") : "none",
      parsed.flags,
      () => writeConfig(config, { dryRun: parsed.flags.dryRun })
    );
  }

  const stopResult = await withProgress(
    "Stopping Forge runtime before update",
    "runtime cache only; data is preserved",
    parsed.flags,
    () =>
      parsed.flags.dryRun
        ? { ok: true, dryRun: true, stopped: false }
        : stopRuntime(config)
  );

  const runtimeUpdateResult = await withProgress(
    config.mode === "dev"
      ? "Skipping packaged runtime refresh"
      : "Refreshing packaged Forge runtime",
    config.mode === "dev"
      ? "source-backed dev install"
      : `${RUNTIME_PACKAGE}@${RUNTIME_PACKAGE_VERSION}`,
    parsed.flags,
    () =>
      config.mode === "dev"
        ? {
            ok: true,
            mode: "dev",
            skipped: true,
            message:
              "Dev mode uses the Forge checkout on disk; pull/build that checkout separately when needed."
          }
        : refreshPackagedRuntimeCache(parsed)
  );

  let peerPreparation = {
    ok: true,
    enabled: config.peerEnabled,
    built: false,
    binaryPath: null,
    dryRun: parsed.flags.dryRun
  };
  if (config.peerEnabled && !parsed.flags.dryRun) {
    peerPreparation = await withProgress(
      "Verifying secure Forge peer sharing",
      "signed source, owner-only build cache, and executable receipt",
      parsed.flags,
      () => ensureForgePeerPrepared(config, parsed.flags)
    );
  }

  const adapterResults = await withProgress(
    parsed.flags.skipAdapters || config.adapters.length === 0
      ? "Skipping host adapter updates"
      : "Updating selected host adapters",
    parsed.flags.skipAdapters
      ? "--skip-adapters"
      : config.adapters.length
        ? config.adapters.join(", ")
        : "none selected",
    parsed.flags,
    () =>
      parsed.flags.skipAdapters
        ? []
        : configureAdapters(config, { dryRun: parsed.flags.dryRun })
  );

  if (!parsed.flags.dryRun && !parsed.flags.skipAdapters) {
    await writeManagedSkillsManifest(skillPlan.targets, {
      dryRun: parsed.flags.dryRun
    });
  }

  let runtimeResult = null;
  if (!parsed.flags.noStart && !parsed.flags.dryRun) {
    runtimeResult = await withProgress(
      "Starting updated Forge runtime",
      `logs: ${logPath()}`,
      parsed.flags,
      () => startRuntime(config, { peerPreparation })
    );
  } else if (parsed.flags.noStart) {
    printStep(
      "Runtime start skipped",
      "run npx forge-memory restart or npx forge-memory ui when ready",
      parsed.flags
    );
  }

  let doctorResult = null;
  if (!parsed.flags.noDoctor) {
    doctorResult = await withProgress(
      "Running Forge doctor",
      parsed.flags.noStart ? "offline checks" : "health checks",
      parsed.flags,
      () =>
        runDoctorChecks(parsed, config, {
          repair: false,
          noStart: parsed.flags.noStart,
          dryRun: parsed.flags.dryRun
        })
    );
  }

  const summary = {
    ok: true,
    command: "update",
    backup,
    skillPlan,
    writeResult,
    stopResult,
    runtimeUpdateResult,
    peerPreparation,
    adapterResults,
    runtimeResult,
    doctorResult,
    dataRoot: currentConfig.dataRoot,
    dataPreserved: true
  };

  if (parsed.flags.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(color.green("Forge Memory update complete."));
  console.log(`Backup: ${backup.outputPath}`);
  console.log(`Data: ${currentConfig.dataRoot}`);
  console.log(`UI: ${webUrl(config)}`);
  console.log(`Peer sharing: ${config.peerEnabled ? "enabled" : "disabled"}`);
  if (skillPlan.backups.length > 0) {
    console.log("Skill backups:");
    for (const backupEntry of skillPlan.backups) {
      console.log(`- ${backupEntry.path} -> ${backupEntry.backupPath}`);
    }
  }
  if (parsed.flags.dryRun) {
    console.log(
      color.yellow(
        "Dry run only; no files, runtime cache, or adapters were changed."
      )
    );
  }
}

async function runStatus(parsed) {
  const config = await readConfig();
  const state = await readRuntimeState();
  const currentHealth = await health(config);
  const peerRuntime = await inspectConfiguredForgePeer(config);
  const stateExists = fs.existsSync(runtimeStatePath());
  const running = isHealthyForgeRuntime(currentHealth);
  const payload = {
    ok: running,
    running,
    mode: config.mode,
    baseUrl: baseUrl(config),
    webUrl: webUrl(config),
    dataRoot: config.dataRoot,
    adapters: config.adapters,
    peer: {
      enabled: config.peerEnabled,
      irohEnabled: config.peerIrohEnabled,
      directEndpoints: config.peerDirectEndpoints,
      allowLoopbackDirect: config.peerAllowLoopbackDirect,
      runtime: peerRuntime
    },
    health: currentHealth,
    runtimeStatePath: runtimeStatePath(),
    runtimeStateExists: stateExists,
    adoptedRuntime: running && !stateExists,
    state
  };
  if (parsed.flags.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`${color.bold("Forge Memory Status")}`);
    console.log(
      `Runtime: ${running ? color.green("healthy") : color.yellow(describeHealthResult(currentHealth))}`
    );
    console.log(`Mode: ${config.mode}`);
    console.log(`UI: ${webUrl(config)}`);
    console.log(`Data: ${config.dataRoot}`);
    console.log(
      `Runtime state: ${stateExists ? runtimeStatePath() : color.yellow("missing; healthy runtimes will be adopted")}`
    );
    console.log(
      `Adapters: ${config.adapters.length ? config.adapters.join(", ") : "none configured"}`
    );
    console.log(
      `Peer sharing: ${
        config.peerEnabled
          ? peerRuntime.ok
            ? color.green("ready")
            : color.yellow("needs attention")
          : "disabled"
      }`
    );
    if (config.peerEnabled) {
      console.log(
        `Peer transports: ${[
          config.peerIrohEnabled ? "Iroh" : null,
          config.peerDirectEndpoints.length > 0
            ? `${config.peerDirectEndpoints.length} direct endpoint${config.peerDirectEndpoints.length === 1 ? "" : "s"}`
            : null
        ]
          .filter(Boolean)
          .join(", ")}`
      );
      if (!peerRuntime.ok && peerRuntime.reason) {
        console.log(color.dim(`   ${peerRuntime.reason}`));
      }
    }
    if (state?.logPath) console.log(`Logs: ${state.logPath}`);
  }
}

async function doctorCheckRuntime(config, options) {
  let result = await health(config);
  let repaired = false;
  let repairRecordPath = null;
  if (
    !isHealthyForgeRuntime(result) &&
    !(result.ok && result.forge === false) &&
    options.repair &&
    !options.noStart &&
    !options.dryRun
  ) {
    const repair = await repairPackagedRuntimeCache(config);
    repairRecordPath = repair.repairRecordPath ?? null;
    result = await health(config, 3_000);
    repaired = isHealthyForgeRuntime(result);
  }
  const ok = isHealthyForgeRuntime(result);
  return {
    id: "runtime",
    ok,
    detail:
      result.ok && result.forge === false
        ? `${baseUrl(config)} (non-Forge service responded)`
        : baseUrl(config),
    repaired,
    repairRecordPath,
    health: result,
    statePath: runtimeStatePath(),
    stateExists: fs.existsSync(runtimeStatePath()),
    guidance: ok
      ? "Forge API is reachable."
      : result.ok && result.forge === false
        ? `Port ${config.port || DEFAULT_PORT} responded, but not with Forge runtime health. Stop the conflicting process or choose another --port.`
        : `Run npx forge-memory doctor --repair, then inspect ${logPath()} if the runtime still does not start. Repair reinstalls only the owned runtime cache and preserves the data folder.`
  };
}

async function doctorCheckPeerRuntime(parsed, config, options) {
  if (!config.peerEnabled) {
    return {
      id: "peerRuntime",
      ok: true,
      detail: "disabled",
      enabled: false,
      repaired: false,
      guidance:
        "Peer sharing is opt-in. Run npx forge-memory configure --enable-peer to enable it."
    };
  }

  let result;
  let repaired = false;
  try {
    if (options.repair && !options.dryRun) {
      result = await ensureForgePeerPrepared(config, parsed.flags);
      repaired = result.built === true;
      result = {
        ...result,
        sourceVerified: true,
        binaryVerified: Boolean(result.binaryPath),
        reason: null
      };
    } else {
      result = await inspectConfiguredForgePeer(config);
    }
  } catch (error) {
    result = {
      ok: false,
      sourceVerified: false,
      binaryVerified: false,
      binaryPath: null,
      reason: error instanceof Error ? error.message : String(error)
    };
  }

  return {
    id: "peerRuntime",
    ok: result.ok === true,
    detail: result.ok
      ? `${config.peerIrohEnabled ? "Iroh" : "direct-only"}; ${config.peerDirectEndpoints.length} direct endpoint${config.peerDirectEndpoints.length === 1 ? "" : "s"}; verified executable`
      : (result.reason ?? "not ready"),
    enabled: true,
    repaired,
    sourceVerified: result.sourceVerified === true,
    binaryVerified: result.binaryVerified === true,
    binaryPath: result.binaryPath ?? null,
    guidance: result.ok
      ? "The signed peer source and owner-only native executable are ready."
      : "Run npx forge-memory doctor --repair after checking the peer transports, Rust/Cargo, and the packaged source signature. Existing Forge data is not changed by peer runtime repair."
  };
}

async function runDoctorChecks(parsed, config, options = {}) {
  const discovery = discover();
  const checks = [];

  checks.push({
    id: "node",
    ok: Number(process.versions.node.split(".")[0]) >= 22,
    detail: process.versions.node,
    guidance:
      "Forge Memory requires Node 22 or newer. Install a current Node release, then rerun npx forge-memory configure."
  });

  const configExists = fs.existsSync(configPath());
  checks.push({
    id: "config",
    ok: configExists,
    detail: configPath(),
    guidance:
      "Run npx forge-memory configure to create the runtime manager config."
  });

  let dataRootExists = fs.existsSync(config.dataRoot);
  let dataRootRepaired = false;
  if (!dataRootExists && options.repair && !options.dryRun) {
    await fsp.mkdir(config.dataRoot, { recursive: true });
    dataRootExists = true;
    dataRootRepaired = true;
  }
  let dataRootIsDirectory = false;
  let dataRootReadable = false;
  let dataRootWritable = false;
  let dataRootError = null;
  if (dataRootExists) {
    try {
      dataRootIsDirectory = (await fsp.stat(config.dataRoot)).isDirectory();
      if (dataRootIsDirectory) {
        await fsp.access(
          config.dataRoot,
          fs.constants.R_OK | fs.constants.W_OK
        );
        dataRootReadable = true;
        dataRootWritable = true;
      }
    } catch (error) {
      dataRootError = error instanceof Error ? error.message : String(error);
    }
  }
  checks.push({
    id: "dataRoot",
    ok:
      dataRootExists &&
      dataRootIsDirectory &&
      dataRootReadable &&
      dataRootWritable,
    detail: config.dataRoot,
    repaired: dataRootRepaired,
    exists: dataRootExists,
    directory: dataRootIsDirectory,
    readable: dataRootReadable,
    writable: dataRootWritable,
    error: dataRootError,
    guidance:
      "Forge data is preserved here. Doctor verifies that this is a readable, writable directory and can create it when missing, but it will not delete existing data."
  });

  checks.push(await doctorCheckPeerRuntime(parsed, config, options));
  checks.push(await doctorCheckRuntime(config, options));

  for (const adapter of discovery.adapters) {
    const selected = config.adapters.includes(adapter.id);
    checks.push({
      id: adapter.id,
      ok: selected ? adapter.installed : true,
      detail: selected
        ? adapter.status
        : adapter.installed
          ? `${adapter.status}; not selected`
          : "not selected",
      selected,
      guidance: selected
        ? adapter.hint
        : `${adapter.label} is not selected for this Forge install.`
    });
  }

  return {
    ok: checks.every((check) => check.ok),
    checks
  };
}

async function runDoctor(parsed) {
  const config = await readConfig();
  const payload = await withProgress(
    "Checking Forge Memory install",
    parsed.flags.repair ? "repair enabled" : "read-only",
    parsed.flags,
    () =>
      runDoctorChecks(parsed, config, {
        repair: parsed.flags.repair,
        noStart: parsed.flags.noStart,
        dryRun: parsed.flags.dryRun
      })
  );
  if (parsed.flags.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(color.bold("Forge Memory Doctor"));
    for (const check of payload.checks) {
      const repaired = check.repaired ? color.cyan(" repaired") : "";
      console.log(
        `${check.ok ? color.green("ok") : color.yellow("warn")} ${check.id}: ${check.detail}${repaired}`
      );
      if (!check.ok && check.guidance) {
        console.log(color.dim(`   ${check.guidance}`));
      }
    }
  }
}

async function runUi(parsed) {
  const config = await readConfig();
  if (!parsed.flags.noStart) await startRuntime(config);
  if (parsed.flags.printUrl || parsed.flags.json) {
    console.log(
      parsed.flags.json
        ? JSON.stringify({ url: webUrl(config) }, null, 2)
        : webUrl(config)
    );
    return;
  }
  await open(webUrl(config));
}

async function runPairIos(parsed) {
  const config = await readConfig();
  const explicitPairingOptions =
    parsed.flags.manualHttp || parsed.values.publicUrl
      ? await resolveIosPairingOptions(parsed, config)
      : null;
  const noStartPairingOptions =
    !explicitPairingOptions && parsed.flags.noStart
      ? await resolveIosPairingOptions(parsed, config)
      : null;
  if (noStartPairingOptions?.transportMode === "iroh") {
    await withProgress(
      "Preparing Forge Companion Iroh transport",
      "checking Rust/Cargo and building the local host",
      parsed.flags,
      () => ensureIrohTransportPrepared(config, parsed.flags)
    );
  }
  if (!parsed.flags.noStart) {
    const runtimeResult = await withProgress(
      "Starting Forge runtime for iOS pairing",
      `logs: ${logPath()}`,
      parsed.flags,
      () => startRuntime(config)
    );
    assertRuntimeStartedForPairing(runtimeResult, config);
  } else {
    const currentHealth = await health(config, 3_000);
    assertRuntimeStartedForPairing(
      { ok: currentHealth.ok, started: false, health: currentHealth },
      config
    );
  }
  const pairingOptions =
    explicitPairingOptions ??
    noStartPairingOptions ??
    (await resolveIosPairingOptions(parsed, config));
  const transportMode = pairingOptions.transportMode;
  const publicUrl = pairingOptions.publicUrl;
  if (
    transportMode === "iroh" &&
    noStartPairingOptions?.transportMode !== "iroh"
  ) {
    await withProgress(
      "Preparing Forge Companion Iroh transport",
      "checking Rust/Cargo and building the local host",
      parsed.flags,
      () => ensureIrohTransportPrepared(config, parsed.flags)
    );
  }
  const pairing = await createPairing(config, {
    transportMode,
    publicUrl
  });
  if (parsed.flags.json) {
    console.log(JSON.stringify(pairing, null, 2));
    return;
  }
  await printPairing(pairing);
}

async function runLogs() {
  if (!fs.existsSync(logPath())) {
    console.log("No forge-memory runtime log found.");
    return;
  }
  const source = await fsp.readFile(logPath(), "utf8");
  console.log(source.split("\n").slice(-120).join("\n"));
}

function sha(input) {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

const DEFAULT_MCP_TEXT_CONTENT_LIMIT_BYTES = 1_500_000;
const DEFAULT_MCP_STRUCTURED_CONTENT_LIMIT_BYTES = 750_000;
const MCP_PREVIEW_BYTES = 24_000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function importFile(filePath) {
  return import(pathToFileURL(filePath).href);
}

function normalizePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveMcpResponseLimits() {
  return {
    textContentLimitBytes: normalizePositiveNumber(
      process.env.FORGE_MCP_TEXT_CONTENT_LIMIT_BYTES,
      DEFAULT_MCP_TEXT_CONTENT_LIMIT_BYTES
    ),
    structuredContentLimitBytes: normalizePositiveNumber(
      process.env.FORGE_MCP_STRUCTURED_CONTENT_LIMIT_BYTES,
      DEFAULT_MCP_STRUCTURED_CONTENT_LIMIT_BYTES
    )
  };
}

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return JSON.stringify(
      {
        error: "Forge MCP could not serialize this response.",
        reason: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    );
  }
}

function utf8ByteLength(value) {
  return textEncoder.encode(value).byteLength;
}

function truncateUtf8(value, limitBytes) {
  const encoded = textEncoder.encode(value);
  if (encoded.byteLength <= limitBytes) return value;
  return textDecoder.decode(encoded.slice(0, Math.max(0, limitBytes)));
}

function createTruncatedMcpPayload({ kind, value, limitBytes }) {
  const serialized = typeof value === "string" ? value : safeStringify(value);
  return {
    forgeMcpResponseTruncated: true,
    kind,
    approximateBytes: utf8ByteLength(serialized),
    limitBytes,
    preview: truncateUtf8(serialized, Math.min(MCP_PREVIEW_BYTES, limitBytes)),
    guidance:
      "The Forge MCP bridge truncated this response before writing to stdio. Narrow the request, lower the limit, or fetch one specific wiki page/result."
  };
}

function toMcpContent(result, limits) {
  const source =
    Array.isArray(result?.content) && result.content.length > 0
      ? result.content
      : [{ type: "text", text: safeStringify(result?.details ?? null) }];

  return source.map((item) => {
    const text =
      item && typeof item === "object" && item.type === "text" && "text" in item
        ? typeof item.text === "string"
          ? item.text
          : safeStringify(item.text ?? null)
        : safeStringify(item);

    if (utf8ByteLength(text) <= limits.textContentLimitBytes) {
      return { type: "text", text };
    }

    return {
      type: "text",
      text: safeStringify(
        createTruncatedMcpPayload({
          kind: "content",
          value: text,
          limitBytes: limits.textContentLimitBytes
        })
      )
    };
  });
}

function maybeStructuredContent(details, limits) {
  if (typeof details !== "object" || details === null) return undefined;
  const serialized = safeStringify(details);
  if (utf8ByteLength(serialized) <= limits.structuredContentLimitBytes) {
    return details;
  }
  return createTruncatedMcpPayload({
    kind: "structuredContent",
    value: serialized,
    limitBytes: limits.structuredContentLimitBytes
  });
}

function resolveMcpRuntimeRoot(config) {
  if (config.mode === "dev" && config.repo) {
    const devRoot = path.join(config.repo, "plugins/openclaw");
    if (fs.existsSync(path.join(devRoot, "dist", "openclaw", "tools.js"))) {
      return devRoot;
    }
  }
  return resolveOpenClawPluginRoot();
}

async function loadForgeToolRuntime(config) {
  const pluginRoot = resolveMcpRuntimeRoot(config);
  if (!pluginRoot) return null;

  const pluginRequire = createRequire(path.join(pluginRoot, "package.json"));
  const [
    { Value },
    { resolveForgePluginConfig },
    { registerForgePluginTools }
  ] = await Promise.all([
    importFile(pluginRequire.resolve("@sinclair/typebox/value")),
    importFile(
      path.join(pluginRoot, "dist", "openclaw", "plugin-entry-shared.js")
    ),
    importFile(path.join(pluginRoot, "dist", "openclaw", "tools.js"))
  ]);

  const forgeConfig = resolveForgePluginConfig({
    origin: process.env.FORGE_ORIGIN ?? config.origin,
    port: normalizePort(process.env.FORGE_PORT, config.port),
    dataRoot: process.env.FORGE_DATA_ROOT?.trim() || config.dataRoot,
    apiToken: process.env.FORGE_API_TOKEN ?? "",
    actorLabel: process.env.FORGE_ACTOR_LABEL ?? "codex",
    timeoutMs: normalizePositiveNumber(process.env.FORGE_TIMEOUT_MS, 15_000)
  });
  const tools = [];
  registerForgePluginTools(
    { registerTool: (tool) => tools.push(tool) },
    forgeConfig
  );
  return { pluginRoot, Value, tools, forgeConfig };
}

function validationErrorMessage(Value, schema, value) {
  const firstError = Value.Errors(schema, value).First();
  if (!firstError) return "Invalid arguments";
  return `${firstError.path || "input"}: ${firstError.message}`;
}

function toMcpInputSchema(parameters) {
  return parameters.type === "object"
    ? parameters
    : { ...parameters, type: "object" };
}

function resolveMcpAgentProvider() {
  const rawProvider = process.env.FORGE_AGENT_PROVIDER?.trim().toLowerCase();
  if (ADAPTERS.includes(rawProvider)) return rawProvider;
  const actor = process.env.FORGE_ACTOR_LABEL?.trim().toLowerCase();
  if (ADAPTERS.includes(actor)) return actor;
  if (actor?.includes("claude")) return "claude";
  if (actor?.includes("hermes")) return "hermes";
  if (actor?.includes("openclaw")) return "openclaw";
  return "codex";
}

function resolveMcpRuntimeLabel(provider) {
  if (provider === "openclaw") return "Forge OpenClaw";
  if (provider === "hermes") return "Forge Hermes";
  if (provider === "claude") return "Forge Claude Code";
  return "Forge Codex";
}

function resolveMcpSessionLabel(provider) {
  if (provider === "claude") return "Forge Claude Code MCP server";
  return `${resolveMcpRuntimeLabel(provider)} MCP server`;
}

function createMcpMachineKey(config) {
  const fingerprint = createHash("sha1")
    .update(
      JSON.stringify({
        baseUrl: config.baseUrl,
        dataRoot: config.dataRoot || ""
      })
    )
    .digest("hex")
    .slice(0, 12);
  return `machine_${fingerprint}`;
}

function createMcpSessionKey(provider, config) {
  const fingerprint = createHash("sha1")
    .update(
      JSON.stringify({
        provider,
        baseUrl: config.baseUrl,
        dataRoot: config.dataRoot || "",
        cwd: process.cwd()
      })
    )
    .digest("hex")
    .slice(0, 12);
  return `${provider}-${fingerprint}`;
}

async function postMcpRuntimeSessionEvent(config, pathname, body) {
  const url = new URL(pathname, config.baseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forge-source": "agent",
      ...(config.apiToken ? { authorization: `Bearer ${config.apiToken}` } : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs || 15_000)
  });
  if (!response.ok) {
    throw new Error(`Forge session endpoint returned ${response.status}`);
  }
  return response.json().catch(() => ({}));
}

async function registerMcpRuntimeSession(forgeConfig) {
  const provider = resolveMcpAgentProvider();
  const machineKey = createMcpMachineKey(forgeConfig);
  const instanceId = `${provider}-${process.pid}-${Date.now().toString(36)}`;
  const state = {
    id: null,
    provider,
    sessionKey: createMcpSessionKey(provider, forgeConfig),
    instanceId,
    connected: false,
    heartbeat: null,
    config: forgeConfig
  };
  try {
    const payload = await postMcpRuntimeSessionEvent(
      forgeConfig,
      "/api/v1/agents/sessions",
      {
        provider,
        agentLabel: resolveMcpRuntimeLabel(provider),
        agentType: provider,
        agentIdentityKey: `runtime:${provider}:${machineKey}:default`,
        machineKey,
        personaKey: "default",
        actorLabel: forgeConfig.actorLabel || provider,
        sessionKey: state.sessionKey,
        sessionLabel: resolveMcpSessionLabel(provider),
        connectionMode: "mcp",
        baseUrl: forgeConfig.baseUrl,
        webUrl: forgeConfig.webAppUrl,
        dataRoot: forgeConfig.dataRoot || null,
        externalSessionId: instanceId,
        staleAfterSeconds: 90,
        metadata: {
          singleton: true,
          instanceId,
          pid: process.pid,
          packageName: "forge-memory",
          packageVersion: VERSION,
          cwd: process.cwd()
        }
      }
    );
    state.id =
      payload &&
      typeof payload === "object" &&
      payload.session &&
      typeof payload.session.id === "string"
        ? payload.session.id
        : null;
    state.connected = Boolean(state.id);
  } catch {
    state.connected = false;
  }
  return state;
}

async function heartbeatMcpRuntimeSession(state, summary, metadata = {}) {
  if (!state.connected) return;
  try {
    await postMcpRuntimeSessionEvent(
      state.config,
      "/api/v1/agents/sessions/heartbeat",
      {
        provider: state.provider,
        sessionKey: state.sessionKey,
        externalSessionId: state.instanceId,
        summary,
        metadata
      }
    );
  } catch {
    state.connected = false;
  }
}

async function disconnectMcpRuntimeSession(state, note, lastError = null) {
  if (!state.connected || !state.id) return;
  try {
    await postMcpRuntimeSessionEvent(
      state.config,
      `/api/v1/agents/sessions/${state.id}/disconnect`,
      {
        note,
        externalSessionId: state.instanceId,
        lastError
      }
    );
  } catch {
    // MCP hosts often terminate stdio abruptly; disconnect cleanup is best-effort.
  } finally {
    state.connected = false;
  }
}

async function runMcp() {
  const config = await readConfig();
  const responseLimits = resolveMcpResponseLimits();
  let toolRuntime = null;
  let toolRuntimeError = null;
  try {
    toolRuntime = await loadForgeToolRuntime(config);
  } catch (error) {
    toolRuntimeError = error instanceof Error ? error.message : String(error);
  }
  const forgeTools = toolRuntime?.tools ?? [];
  const forgeToolByName = new Map(forgeTools.map((tool) => [tool.name, tool]));
  const runtimeSession = toolRuntime
    ? await registerMcpRuntimeSession(toolRuntime.forgeConfig).catch(() => null)
    : null;
  if (runtimeSession?.connected) {
    runtimeSession.heartbeat = setInterval(() => {
      void heartbeatMcpRuntimeSession(
        runtimeSession,
        `${resolveMcpRuntimeLabel(runtimeSession.provider)} MCP heartbeat.`,
        { pid: process.pid }
      );
    }, 45_000);
    runtimeSession.heartbeat.unref?.();
  }
  const cleanupRuntimeSession = (note, lastError = null) => {
    if (!runtimeSession) return;
    if (runtimeSession?.heartbeat) {
      clearInterval(runtimeSession.heartbeat);
      runtimeSession.heartbeat = null;
    }
    void disconnectMcpRuntimeSession(runtimeSession, note, lastError);
  };
  process.once("beforeExit", () => cleanupRuntimeSession("MCP server exited."));
  const server = new Server(
    { name: "forge-memory", version: VERSION },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "forge_memory_status",
        description: "Return local Forge Memory runtime status.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "forge_memory_health",
        description: "Check the configured Forge API health endpoint.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: "forge_memory_mcp_diagnostics",
        description: "Return Forge Memory MCP runtime loading diagnostics.",
        inputSchema: { type: "object", properties: {} }
      }
    ].concat(
      forgeTools.map((tool) => ({
        name: tool.name,
        title: tool.label,
        description: tool.description,
        inputSchema: toMcpInputSchema(tool.parameters)
      }))
    )
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "forge_memory_status") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                baseUrl: baseUrl(config),
                webUrl: webUrl(config),
                dataRoot: config.dataRoot,
                identity: sha(config.dataRoot)
              },
              null,
              2
            )
          }
        ]
      };
    }
    if (request.params.name === "forge_memory_health") {
      return {
        content: [
          { type: "text", text: JSON.stringify(await health(config), null, 2) }
        ]
      };
    }
    if (request.params.name === "forge_memory_mcp_diagnostics") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                runtimeLoaded: Boolean(toolRuntime),
                runtimeRoot: toolRuntime?.pluginRoot ?? null,
                runtimeError: toolRuntimeError,
                forgeToolCount: forgeTools.length,
                wikiTools: forgeTools
                  .filter((tool) => tool.name.includes("wiki"))
                  .map((tool) => tool.name)
                  .sort()
              },
              null,
              2
            )
          }
        ]
      };
    }

    const tool = forgeToolByName.get(request.params.name);
    if (!tool) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Forge tool not found: ${request.params.name}`
      );
    }

    const args = request.params.arguments ?? {};
    if (!toolRuntime.Value.Check(tool.parameters, args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        validationErrorMessage(toolRuntime.Value, tool.parameters, args)
      );
    }

    try {
      const result = await tool.execute(request.params.name, args);
      return {
        content: toMcpContent(result, responseLimits),
        structuredContent: maybeStructuredContent(
          result.details,
          responseLimits
        )
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error)
          }
        ],
        isError: true
      };
    }
  });
  await server.connect(new StdioServerTransport());
}

function printHelp() {
  console.log(`Forge Memory ${VERSION}

Usage:
  npx forge-memory
  npx forge-memory --dev
  npx forge-memory configure
  npx forge-memory status
  npx forge-memory doctor
  npx forge-memory update
  npx forge-memory ui
  npx forge-memory restart
  npx forge-memory stop
  npx forge-memory export
  npx forge-memory uninstall
  npx forge-memory pair-ios

Options:
  --yes, -y              Accept defaults/non-interactive mode
  --dev                 Use source-backed Forge runtime and adapter links
  --data-root <path>    Forge data root
  --adapters <list>     Comma list: openclaw,hermes,codex,claude or none
  --skip-adapters       Skip adapter configuration/update
  --skip-pair-ios       Do not prompt or create iOS pairing
  --manual-http         Force direct HTTP/TCP for iOS pairing
  --public-url <url>    Phone-facing Tailscale/LAN/fixed URL for direct pairing; never localhost
  --enable-peer         Enable secure Forge-to-Forge sharing for this install
  --disable-peer        Disable Forge-to-Forge sharing for this install
  --enable-peer-iroh    Use Iroh for peer connectivity across different networks (default for new peer installs)
  --disable-peer-iroh   Disable Iroh and require an explicit/discovered direct endpoint
  --peer-endpoint <ip:port>
                        Advertise a literal IPv4 or bracketed IPv6 peer endpoint; repeat up to 8 times
  --allow-loopback-peer Allow 127.0.0.0/8 or ::1 peer endpoints for local tests only
  --no-start            Configure without starting runtime
  --no-doctor           Skip install-time doctor checks
  --repair              Let doctor create missing folders and restart unhealthy runtime
  --output <path>        Export destination for forge-memory export
  --remove-adapters      During uninstall, remove host adapter config entries
  --remove-data          During uninstall, delete the Forge data folder too
  --dry-run             Show actions without writing files or installing adapters
  --json                Print machine-readable output where supported
`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.flags.help) {
    printHelp();
    return;
  }
  if (parsed.flags.version) {
    console.log(VERSION);
    return;
  }
  switch (parsed.command) {
    case "install":
    case "configure":
      await runInstall(parsed, parsed.command);
      break;
    case "status":
      await runStatus(parsed);
      break;
    case "doctor":
      await runDoctor(parsed);
      break;
    case "update":
      await runUpdate(parsed);
      break;
    case "start":
      console.log(
        JSON.stringify(await startRuntime(await readConfig()), null, 2)
      );
      break;
    case "stop":
      console.log(JSON.stringify(await stopRuntime(), null, 2));
      break;
    case "export":
      {
        const result = await exportForgeData(parsed);
        console.log(
          parsed.flags.json
            ? JSON.stringify(result, null, 2)
            : `Exported Forge data to ${result.outputPath}`
        );
      }
      break;
    case "uninstall":
      {
        const result = await uninstallForgeMemory(parsed);
        console.log(
          parsed.flags.json
            ? JSON.stringify(result, null, 2)
            : result.cancelled
              ? "Uninstall cancelled."
              : "Forge Memory uninstalled."
        );
      }
      break;
    case "restart":
      await stopRuntime();
      console.log(
        JSON.stringify(await startRuntime(await readConfig()), null, 2)
      );
      break;
    case "ui":
      await runUi(parsed);
      break;
    case "pair-ios":
      await runPairIos(parsed);
      break;
    case "logs":
      await runLogs();
      break;
    case "mcp":
      await runMcp();
      break;
    case "help":
      printHelp();
      break;
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}

function printFatalError(error, { json = false } = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const guidance =
    error && typeof error === "object" && Array.isArray(error.guidance)
      ? error.guidance
      : [
          "Run npx forge-memory doctor --repair to check and repair the local install.",
          "Run npx forge-memory logs to inspect the runtime log.",
          "Forge Memory repair never deletes your data folder."
        ];
  const payload = {
    ok: false,
    code:
      error && typeof error === "object" && typeof error.code === "string"
        ? error.code
        : "forge_memory_failed",
    error: message,
    guidance,
    logPath: logPath()
  };
  if (json) {
    console.error(JSON.stringify(payload, null, 2));
    return;
  }
  console.error(color.red("Forge Memory could not finish this step."));
  console.error(color.red(message));
  console.error("");
  console.error(color.cyan("Next steps:"));
  for (const item of payload.guidance) {
    console.error(`- ${item}`);
  }
  console.error(`- Runtime log: ${payload.logPath}`);
}

main().catch((error) => {
  printFatalError(error, { json: process.argv.includes("--json") });
  process.exitCode = 1;
});
