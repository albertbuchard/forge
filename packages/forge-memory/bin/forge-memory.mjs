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
const ADAPTERS = ["openclaw", "hermes", "codex"];

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
    noDoctor: false
  };
  const values = {};
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
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--version" || arg === "-v") flags.version = true;
    else throw new Error(`Unknown option: ${arg}`);
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

function defaultDataRoot() {
  return forgeHome();
}

function normalizePort(value, fallback = DEFAULT_PORT) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535
    ? parsed
    : fallback;
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

async function readConfig() {
  const config = await readJson(configPath(), {});
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
    repo: typeof config?.repo === "string" ? config.repo : null
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
    roots.push(path.join(config.repo, "openclaw-plugin", "dist"));
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

async function maybeInstallRustToolchain(flags) {
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
        "Forge Companion Iroh needs Rust/Cargo to build the local transport host. Install the minimal Rust toolchain now?",
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

function discover() {
  return {
    generatedAt: new Date().toISOString(),
    adapters: [detectOpenClaw(), detectHermes(), detectCodex()]
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

  return {
    version: VERSION,
    mode: parsed.flags.dev ? "dev" : mode,
    origin,
    port: runtimeTarget.port,
    webPort: runtimeTarget.webPort,
    dataRoot: runtimeTarget.dataRoot,
    adapters,
    repo,
    command
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

function stripCodexForgeMcpConfig(source) {
  const orphanForgeLines = new Set([
    'command = "npx"',
    'args = ["forge-memory", "mcp"]',
    "FORGE_ORIGIN",
    "FORGE_PORT",
    "FORGE_ACTOR_LABEL",
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
      ? path.join(config.repo, "openclaw-plugin")
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

async function configureAdapters(config, options) {
  const results = [];
  for (const adapter of config.adapters) {
    if (adapter === "openclaw")
      results.push(await installOpenClawAdapter(config, options));
    if (adapter === "hermes")
      results.push(await installHermesAdapter(config, options));
    if (adapter === "codex")
      results.push(await installCodexAdapter(config, options));
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
  signalDetachedProcessGroup(pid, "SIGKILL") || signalProcess(pid, "SIGKILL");
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

async function ensurePackagedRuntimeInstalled(options = {}) {
  const existing = options.forceInstall ? null : resolveOpenClawPluginRoot();
  if (existing) return existing;
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
  const installed = resolveOpenClawPluginRoot({ installedOnly: true });
  if (!installed)
    throw new Error(
      `${RUNTIME_PACKAGE} installed but its runtime entry could not be resolved. Log: ${logPath()}`
    );
  const entry = path.join(installed, "server", "index.js");
  if (!fs.existsSync(entry)) {
    throw new Error(
      `${RUNTIME_PACKAGE} installed but ${entry} is missing. Log: ${logPath()}`
    );
  }
  return installed;
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

async function startRuntime(config) {
  const current = await health(config);
  if (isHealthyForgeRuntime(current)) {
    const existing = await readRuntimeState();
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
  const existing = await readRuntimeState();
  if (existing?.pid && processExists(existing.pid)) {
    const existingHealth = await health(config);
    if (isHealthyForgeRuntime(existingHealth))
      return {
        ok: true,
        started: false,
        adopted: true,
        state: existing,
        health: existingHealth
      };
  }

  await fsp.mkdir(path.dirname(logPath()), { recursive: true });
  await fsp.mkdir(path.dirname(runtimeStatePath()), { recursive: true });
  await fsp.mkdir(config.dataRoot, { recursive: true });
  const out = fs.openSync(logPath(), "a");
  const children = [];

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
    const server = spawn(
      process.execPath,
      [tsx, path.join(config.repo, "server", "src", "index.ts")],
      {
        cwd: config.repo,
        detached: true,
        stdio: ["ignore", out, out],
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: String(config.port),
          FORGE_BASE_PATH: "/forge/",
          FORGE_DATA_ROOT: config.dataRoot,
          FORGE_DEV_WEB_ORIGIN: `http://127.0.0.1:${config.webPort}/forge/`
        }
      }
    );
    server.unref();
    children.push({ role: "server", pid: server.pid });
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
        env: { ...process.env, FORGE_BASE_PATH: "/forge/" }
      }
    );
    web.unref();
    children.push({ role: "web", pid: web.pid });
  } else {
    const pluginRoot = await ensurePackagedRuntimeInstalled();
    const entry = path.join(pluginRoot, "server", "index.js");
    const child = spawn(process.execPath, [entry], {
      cwd: pluginRoot,
      detached: true,
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(config.port),
        FORGE_BASE_PATH: "/forge/",
        FORGE_DATA_ROOT: config.dataRoot
      }
    });
    child.unref();
    children.push({ role: "server", pid: child.pid });
  }
  fs.closeSync(out);

  const state = {
    mode: config.mode,
    baseUrl: baseUrl(config),
    webUrl: webUrl(config),
    dataRoot: config.dataRoot,
    logPath: logPath(),
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
  if (!fs.existsSync(config.dataRoot)) {
    throw new Error(`Forge data folder does not exist: ${config.dataRoot}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const requestedOutput = parsed.values.output ?? parsed.positionals[1];
  const outputPath = path.resolve(
    requestedOutput ??
      path.join(forgeHome(), "exports", `forge-memory-export-${stamp}.tar.gz`)
  );
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

  const skipTopLevel = new Set(["exports", "logs", "run", "runtime"]);
  await fsp.cp(config.dataRoot, stagingData, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (source) => {
      const relative = path.relative(config.dataRoot, source);
      if (!relative) return true;
      return !skipTopLevel.has(relative.split(path.sep)[0]);
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
        stdio: parsed.flags.json ? "ignore" : "inherit"
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
        "Remove Forge adapter entries from OpenClaw, Hermes, and Codex?",
        false
      )));
  if (removeAdapters) {
    adapterResults = [
      await removeOpenClawAdapterConfig(),
      await removeHermesAdapterConfig(),
      await removeCodexAdapterConfig()
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
      () => startRuntime(config)
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
        () => startRuntime(config)
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
    irohTransportResult,
    pairing: Boolean(pairing)
  };
  if (parsed.flags.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(color.green("Forge Memory configured and checked."));
    console.log(`UI: ${webUrl(config)}`);
    console.log(`Data: ${config.dataRoot}`);
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

async function runStatus(parsed) {
  const config = await readConfig();
  const state = await readRuntimeState();
  const currentHealth = await health(config);
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
  checks.push({
    id: "dataRoot",
    ok: dataRootExists,
    detail: config.dataRoot,
    repaired: dataRootRepaired,
    guidance:
      "Forge data is preserved here. Doctor can create the folder, but it will not delete existing data."
  });

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
    const devRoot = path.join(config.repo, "openclaw-plugin");
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
  return { pluginRoot, Value, tools };
}

function validationErrorMessage(Value, schema, value) {
  const firstError = Value.Errors(schema, value).First();
  if (!firstError) return "Invalid arguments";
  return `${firstError.path || "input"}: ${firstError.message}`;
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
        inputSchema: tool.parameters
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
  --adapters <list>     Comma list: openclaw,hermes,codex or none
  --skip-adapters       Configure UI/runtime only
  --skip-pair-ios       Do not prompt or create iOS pairing
  --manual-http         Force direct HTTP/TCP for iOS pairing
  --public-url <url>    Phone-facing Tailscale/LAN/fixed URL for direct pairing; never localhost
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
