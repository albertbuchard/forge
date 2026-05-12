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
import { createRequire } from "node:module";
import YAML from "yaml";
import qrcode from "qrcode-terminal";
import open from "open";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

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
    manualHttp: false
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
    else if (arg === "--skip-pair-ios" || arg === "--no-pair-ios") flags.skipPairIos = true;
    else if (arg === "--pair-ios") flags.pairIos = true;
    else if (arg === "--skip-adapters") flags.skipAdapters = true;
    else if (arg === "--print-url") flags.printUrl = true;
    else if (arg === "--remove-data") flags.removeData = true;
    else if (arg === "--remove-adapters") flags.removeAdapters = true;
    else if (arg === "--manual-http" || arg === "--no-iroh") flags.manualHttp = true;
    else if (arg.startsWith("--output=")) values.output = arg.slice("--output=".length);
    else if (arg === "--output") values.output = argv[++index];
    else if (arg.startsWith("--data-root=")) values.dataRoot = arg.slice("--data-root=".length);
    else if (arg === "--data-root") values.dataRoot = argv[++index];
    else if (arg.startsWith("--adapters=")) values.adapters = arg.slice("--adapters=".length);
    else if (arg === "--adapters") values.adapters = argv[++index];
    else if (arg.startsWith("--origin=")) values.origin = arg.slice("--origin=".length);
    else if (arg === "--origin") values.origin = argv[++index];
    else if (arg.startsWith("--port=")) values.port = arg.slice("--port=".length);
    else if (arg === "--port") values.port = argv[++index];
    else if (arg.startsWith("--web-port=")) values.webPort = arg.slice("--web-port=".length);
    else if (arg === "--web-port") values.webPort = argv[++index];
    else if (arg.startsWith("--repo=")) values.repo = arg.slice("--repo=".length);
    else if (arg === "--repo") values.repo = argv[++index];
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
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : fallback;
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

async function writeJson(filePath, payload, { dryRun = false, backup = true } = {}) {
  if (dryRun) return { filePath, backupPath: null, dryRun: true };
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const backupPath = backup ? await backupIfExists(filePath) : null;
  await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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
    dataRoot: typeof config?.dataRoot === "string" ? path.resolve(config.dataRoot) : defaultDataRoot(),
    adapters: Array.isArray(config?.adapters) ? config.adapters.filter((entry) => ADAPTERS.includes(entry)) : [],
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
  const result = spawnSync(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? [command] : ["-v", command], {
    shell: process.platform !== "win32",
    stdio: "ignore"
  });
  return result.status === 0;
}

function runCapture(command, args, timeoutMs = 2_000) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: timeoutMs
  });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout}${result.stderr}`.trim();
}

function detectOpenClaw() {
  const installed = commandExists("openclaw") || fs.existsSync(path.join(homeDir(), ".openclaw"));
  const version = commandExists("openclaw") ? runCapture("openclaw", ["--version"]) : null;
  const config = path.join(homeDir(), ".openclaw", "openclaw.json");
  return {
    id: "openclaw",
    label: "OpenClaw",
    installed,
    disabled: !installed,
    status: installed ? (version || "detected") : "not found",
    configPath: config,
    hint: "Install OpenClaw first, then rerun npx forge-memory configure."
  };
}

function detectHermes() {
  const hermesRoot = path.join(homeDir(), ".hermes");
  const hermesPython = path.join(hermesRoot, "hermes-agent", "venv", "bin", "python");
  const installed = commandExists("hermes") || fs.existsSync(hermesPython) || fs.existsSync(hermesRoot);
  const version = commandExists("hermes") ? runCapture("hermes", ["--version"]) : null;
  return {
    id: "hermes",
    label: "Hermes",
    installed,
    disabled: !installed,
    status: installed ? (version || "detected") : "not found",
    configPath: path.join(hermesRoot, "forge", "config.json"),
    pythonPath: hermesPython,
    hint: "Install Hermes first, then rerun npx forge-memory configure."
  };
}

function detectCodex() {
  const codexRoot = path.join(homeDir(), ".codex");
  const installed = commandExists("codex") || fs.existsSync(codexRoot);
  const version = commandExists("codex") ? runCapture("codex", ["--version"]) : null;
  return {
    id: "codex",
    label: "Codex",
    installed,
    disabled: !installed,
    status: installed ? (version || "detected") : "not found",
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

async function promptLine(question, defaultValue) {
  const suffix = defaultValue ? ` ${color.dim(`[${defaultValue}]`)}` : "";
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return await new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

async function promptYesNo(question, defaultValue = true) {
  const answer = (await promptLine(`${question} ${defaultValue ? "[Y/n]" : "[y/N]"}`, "")).toLowerCase();
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
    console.log("Select host adapters. Space toggles, arrows move, Enter confirms.\n");
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
        resolve(rows.filter((entry) => entry.selected && !entry.disabled && !entry.action).map((entry) => entry.id));
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
        const port = typeof address === "object" && address ? address.port : DEFAULT_PORT;
        server.close(() => resolve(port));
      });
    });
  }
  for (let port = startPort; port < startPort + 30 && port <= 65535; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No free localhost port found near ${startPort}`);
}

async function resolveDevDataRoot(repoRoot) {
  const preferencePath = path.resolve(repoRoot, "..", "..", "data", "forge-runtime.json");
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
        if (parsed?.name === "forge" && fs.existsSync(path.join(current, "server", "src", "index.ts"))) {
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

async function buildInstallConfig(parsed, currentConfig, discovery, command) {
  const repo = parsed.values.repo ? path.resolve(parsed.values.repo) : findForgeRepo();
  const mode = parsed.flags.dev ? "dev" : currentConfig.mode;
  const detectedDefaults = discovery.adapters.filter((adapter) => adapter.installed).map((adapter) => adapter.id);
  const currentDefaults = currentConfig.adapters.length > 0 ? currentConfig.adapters : detectedDefaults;
  const adapterOverride = parsed.flags.skipAdapters ? [] : normalizeAdapterList(parsed.values.adapters);
  const adapters = adapterOverride ?? (parsed.flags.yes ? currentDefaults : await promptCheckbox(discovery.adapters, currentDefaults));
  const dataRootDefault =
    parsed.values.dataRoot ??
    (parsed.flags.dev && repo ? await resolveDevDataRoot(repo) : currentConfig.dataRoot || defaultDataRoot());
  const dataRoot = parsed.flags.yes
    ? dataRootDefault
    : await promptLine("Forge data folder", dataRootDefault);
  const portInput = parsed.values.port ?? currentConfig.port;
  const port = await findFreePort(normalizePort(portInput, DEFAULT_PORT));
  const webPort = await findFreePort(normalizePort(parsed.values.webPort ?? currentConfig.webPort, DEFAULT_WEB_PORT));

  return {
    version: VERSION,
    mode: parsed.flags.dev ? "dev" : mode,
    origin: parsed.values.origin ?? currentConfig.origin ?? DEFAULT_ORIGIN,
    port,
    webPort,
    dataRoot: path.resolve(dataRoot),
    adapters,
    repo,
    command
  };
}

async function patchOpenClawConfig(config, options) {
  const filePath = path.join(homeDir(), ".openclaw", "openclaw.json");
  const payload = (await readJson(filePath, {})) ?? {};
  const plugins = payload.plugins && typeof payload.plugins === "object" ? { ...payload.plugins } : {};
  const entries = plugins.entries && typeof plugins.entries === "object" ? { ...plugins.entries } : {};
  const currentEntry = entries[FORGE_PLUGIN_ID] && typeof entries[FORGE_PLUGIN_ID] === "object" ? { ...entries[FORGE_PLUGIN_ID] } : {};
  const currentPluginConfig = currentEntry.config && typeof currentEntry.config === "object" ? { ...currentEntry.config } : {};
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
  const forgeConfigPath = path.join(homeDir(), ".hermes", "forge", "config.json");
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
  if (!root.plugins.enabled.includes("forge")) root.plugins.enabled.push("forge");
  doc.contents = doc.createNode(root);
  if (!options.dryRun) {
    await backupIfExists(hermesYamlPath);
    await fsp.writeFile(hermesYamlPath, String(doc), "utf8");
  }
  return { filePath: hermesYamlPath };
}

async function patchCodexConfig(config, options) {
  const filePath = path.join(homeDir(), ".codex", "config.toml");
  let source = fs.existsSync(filePath) ? await fsp.readFile(filePath, "utf8") : "";
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
  const pattern = /(?:^|\n)\[mcp_servers\.forge\][\s\S]*?(?=\n\[[^\]]+\]|\s*$)/m;
  if (pattern.test(source)) {
    source = source.replace(pattern, `\n${block}`.trimEnd());
  } else {
    source = `${source.trimEnd()}\n\n${block}`.trimStart();
  }
  if (!options.dryRun) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await backupIfExists(filePath);
    await fsp.writeFile(filePath, source.endsWith("\n") ? source : `${source}\n`, "utf8");
  }
  return { filePath };
}

async function runCommand(command, args, { cwd, dryRun = false, env = process.env } = {}) {
  if (dryRun) {
    return { ok: true, dryRun: true, command, args, cwd };
  }
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", (error) => resolve({ ok: false, error }));
    child.once("exit", (code) => resolve({ ok: code === 0, code }));
  });
}

async function installOpenClawAdapter(config, options) {
  await patchOpenClawConfig(config, options);
  if (!commandExists("openclaw")) {
    return { adapter: "openclaw", ok: false, skipped: true, message: "openclaw command not found" };
  }
  const installTarget = config.mode === "dev" && config.repo ? path.join(config.repo, "openclaw-plugin") : FORGE_PLUGIN_ID;
  const installArgs = config.mode === "dev"
    ? ["plugins", "install", "--link", "--dangerously-force-unsafe-install", installTarget]
    : ["plugins", "install", "--dangerously-force-unsafe-install", installTarget];
  const installResult = await runCommand("openclaw", installArgs, options);
  if (!installResult.ok) return { adapter: "openclaw", ok: false, message: "OpenClaw plugin install failed" };
  await runCommand("openclaw", ["plugins", "enable", FORGE_PLUGIN_ID], options);
  await runCommand("openclaw", ["gateway", "restart"], options);
  return { adapter: "openclaw", ok: true };
}

async function installHermesAdapter(config, options) {
  await patchHermesConfig(config, options);
  const pythonPath = path.join(homeDir(), ".hermes", "hermes-agent", "venv", "bin", "python");
  if (!fs.existsSync(pythonPath)) {
    return { adapter: "hermes", ok: false, skipped: true, message: "Hermes Python environment not found" };
  }
  const target = config.mode === "dev" && config.repo
    ? ["-m", "pip", "install", "--upgrade", "-e", path.join(config.repo, "plugins", "forge-hermes")]
    : ["-m", "pip", "install", "--upgrade", "forge-hermes-plugin"];
  const result = await runCommand(pythonPath, target, options);
  return { adapter: "hermes", ok: result.ok, message: result.ok ? undefined : "Hermes plugin install failed" };
}

async function installCodexAdapter(config, options) {
  await patchCodexConfig(config, options);
  return { adapter: "codex", ok: true };
}

async function configureAdapters(config, options) {
  const results = [];
  for (const adapter of config.adapters) {
    if (adapter === "openclaw") results.push(await installOpenClawAdapter(config, options));
    if (adapter === "hermes") results.push(await installHermesAdapter(config, options));
    if (adapter === "codex") results.push(await installCodexAdapter(config, options));
  }
  return results;
}

async function health(config, timeoutMs = 1_500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/api/v1/health", baseUrl(config)), {
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, payload: await response.json() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
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

async function waitForHealth(config, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await health(config);
    if (result.ok) return result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return health(config);
}

function resolveOpenClawPluginRoot() {
  const candidates = [require];
  const installedRuntimePackageJson = path.join(runtimeInstallRoot(), "package.json");
  if (fs.existsSync(installedRuntimePackageJson)) {
    candidates.push(createRequire(installedRuntimePackageJson));
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

async function ensurePackagedRuntimeInstalled() {
  const existing = resolveOpenClawPluginRoot();
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
  await fsp.mkdir(path.dirname(logPath()), { recursive: true });
  const out = fs.openSync(logPath(), "a");
  try {
    const result = spawnSync(
      "npm",
      ["install", `${RUNTIME_PACKAGE}@${RUNTIME_PACKAGE_VERSION}`, "--omit=dev", "--ignore-scripts", "--silent"],
      {
        cwd: installRoot,
        stdio: ["ignore", out, out],
        env: process.env
      }
    );
    if (result.status !== 0) {
      throw new Error(`Failed to install ${RUNTIME_PACKAGE}@${RUNTIME_PACKAGE_VERSION}. Check ${logPath()}.`);
    }
  } finally {
    fs.closeSync(out);
  }
  const installed = resolveOpenClawPluginRoot();
  if (!installed) throw new Error(`${RUNTIME_PACKAGE} installed but its runtime entry could not be resolved.`);
  return installed;
}

async function startRuntime(config) {
  const existing = await readRuntimeState();
  if (existing?.pid && processExists(existing.pid)) {
    const current = await health(config);
    if (current.ok) return { ok: true, started: false, state: existing };
  }

  await fsp.mkdir(path.dirname(logPath()), { recursive: true });
  await fsp.mkdir(path.dirname(runtimeStatePath()), { recursive: true });
  await fsp.mkdir(config.dataRoot, { recursive: true });
  const out = fs.openSync(logPath(), "a");
  const children = [];

  if (config.mode === "dev") {
    if (!config.repo) throw new Error("Dev mode requires a Forge repo checkout.");
    const tsx = path.join(config.repo, "node_modules", "tsx", "dist", "cli.mjs");
    if (!fs.existsSync(tsx)) throw new Error(`tsx was not found at ${tsx}. Run npm install in the Forge repo.`);
    const server = spawn(process.execPath, [tsx, path.join(config.repo, "server", "src", "index.ts")], {
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
    });
    server.unref();
    children.push({ role: "server", pid: server.pid });
    const web = spawn("npm", ["run", "dev:web", "--", "--host", "127.0.0.1", "--port", String(config.webPort)], {
      cwd: config.repo,
      detached: true,
      stdio: ["ignore", out, out],
      env: { ...process.env, FORGE_BASE_PATH: "/forge/" }
    });
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

async function stopRuntime() {
  const state = await readRuntimeState();
  if (!state?.children?.length) return { ok: true, stopped: false, message: "No forge-memory runtime state found." };
  const stopped = [];
  for (const child of state.children) {
    if (!child?.pid || !processExists(child.pid)) continue;
    process.kill(child.pid, "SIGTERM");
    stopped.push(child.pid);
  }
  await fsp.rm(runtimeStatePath(), { force: true });
  return { ok: true, stopped: stopped.length > 0, pids: stopped };
}

async function exportForgeData(parsed) {
  const config = await readConfig();
  if (!fs.existsSync(config.dataRoot)) {
    throw new Error(`Forge data folder does not exist: ${config.dataRoot}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const requestedOutput = parsed.values.output ?? parsed.positionals[1];
  const outputPath = path.resolve(
    requestedOutput ?? path.join(forgeHome(), "exports", `forge-memory-export-${stamp}.tar.gz`)
  );
  const stagingRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "forge-memory-export-"));
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
    await fsp.copyFile(configPath(), path.join(stagingRoot, "forge-memory-config.json"));
  }
  await fsp.writeFile(path.join(stagingRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  const wantsArchive = outputPath.endsWith(".tar.gz") || outputPath.endsWith(".tgz");
  if (wantsArchive && commandExists("tar")) {
    const result = spawnSync("tar", ["-czf", outputPath, "-C", stagingRoot, "."], {
      stdio: parsed.flags.json ? "ignore" : "inherit"
    });
    await fsp.rm(stagingRoot, { recursive: true, force: true });
    if (result.status !== 0) throw new Error(`Failed to write export archive: ${outputPath}`);
    return { ok: true, outputPath, archive: true, sourceDataRoot: config.dataRoot };
  }

  await fsp.rm(outputPath, { recursive: true, force: true });
  await fsp.cp(stagingRoot, outputPath, { recursive: true });
  await fsp.rm(stagingRoot, { recursive: true, force: true });
  return { ok: true, outputPath, archive: false, sourceDataRoot: config.dataRoot };
}

async function removeOpenClawAdapterConfig() {
  const filePath = path.join(homeDir(), ".openclaw", "openclaw.json");
  const payload = await readJson(filePath, null);
  if (!payload?.plugins?.entries?.[FORGE_PLUGIN_ID]) return { filePath, changed: false };
  await backupIfExists(filePath);
  delete payload.plugins.entries[FORGE_PLUGIN_ID];
  if (Array.isArray(payload.plugins.allow)) {
    payload.plugins.allow = payload.plugins.allow.filter((entry) => entry !== FORGE_PLUGIN_ID);
  }
  await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { filePath, changed: true };
}

async function removeHermesAdapterConfig() {
  const forgeConfigPath = path.join(homeDir(), ".hermes", "forge", "config.json");
  const changed = fs.existsSync(forgeConfigPath);
  if (changed) {
    await backupIfExists(forgeConfigPath);
    await fsp.rm(forgeConfigPath, { force: true });
  }
  return { filePath: forgeConfigPath, changed };
}

async function removeCodexAdapterConfig() {
  const filePath = path.join(homeDir(), ".codex", "config.toml");
  if (!fs.existsSync(filePath)) return { filePath, changed: false };
  const source = await fsp.readFile(filePath, "utf8");
  const pattern = /(?:^|\n)\[mcp_servers\.forge\][\s\S]*?(?=\n\[[^\]]+\]|\s*$)/m;
  if (!pattern.test(source)) return { filePath, changed: false };
  await backupIfExists(filePath);
  const next = source.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n").trimEnd();
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
  for (const target of [runtimeInstallRoot(), runtimeStatePath(), logPath(), configPath()]) {
    if (fs.existsSync(target)) {
      await fsp.rm(target, { recursive: true, force: true });
      removed.push(target);
    }
  }

  let adapterResults = [];
  const removeAdapters = parsed.flags.removeAdapters || (!parsed.flags.yes && await promptYesNo("Remove Forge adapter entries from OpenClaw, Hermes, and Codex?", false));
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
      : await promptYesNo(`Delete Forge data folder ${config.dataRoot}? This cannot be undone.`, false);
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

async function createPairing(config, options = {}) {
  const transportMode = options.transportMode ?? "iroh";
  const response = await fetch(new URL("/api/v1/health/pairing-sessions", baseUrl(config)), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ userId: null, transportMode })
  });
  if (!response.ok) throw new Error(`Pairing request failed with ${response.status}`);
  return response.json();
}

function printPairing(pairing) {
  console.log("\nScan this QR in Forge Companion:\n");
  qrcode.generate(JSON.stringify(pairing.qrPayload), { small: true });
  const transport = pairing.qrPayload?.transport;
  if (transport?.provider) {
    const label = pairing.qrPayload.transport?.protocol === "iroh"
      ? "Iroh"
      : pairing.qrPayload.transportMode === "iroh"
        ? "Iroh"
        : "Manual HTTP";
    console.log(`${color.cyan(label)}: ${pairing.qrPayload.apiBaseUrl}`);
    if (transport.recreateCommand) {
      console.log(`${color.dim("recreate:")} ${transport.recreateCommand}`);
    }
    for (const note of transport.notes ?? []) {
      console.log(color.dim(note));
    }
  }
  console.log(JSON.stringify(pairing.qrPayload, null, 2));
}

async function runInstall(parsed, command) {
  const currentConfig = await readConfig();
  const discovery = discover();
  if (!parsed.flags.yes) {
    printBanner();
    console.log(color.dim("Discovery runs in the background. Forge UI/runtime is always installed.\n"));
  }
  const config = await buildInstallConfig(parsed, currentConfig, discovery, command);
  const writeResult = await writeConfig(config, { dryRun: parsed.flags.dryRun });
  const adapterResults = await configureAdapters(config, { dryRun: parsed.flags.dryRun });
  let runtimeResult = null;
  if (!parsed.flags.noStart && !parsed.flags.dryRun) {
    runtimeResult = await startRuntime(config);
  }
  const shouldPair = parsed.flags.pairIos || (!parsed.flags.skipPairIos && (parsed.flags.yes ? true : await promptYesNo("Pair the iOS companion now?", true)));
  let pairing = null;
  if (shouldPair && !parsed.flags.dryRun) {
    if (!runtimeResult) await startRuntime(config);
    pairing = await createPairing(config, {
      transportMode: parsed.flags.manualHttp ? "manual-http" : "iroh"
    });
    if (pairing?.qrPayload && !parsed.flags.json) {
      printPairing(pairing);
    }
  }
  const summary = { ok: true, config, writeResult, adapterResults, runtimeResult, pairing: Boolean(pairing) };
  if (parsed.flags.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(color.green("Forge Memory configured."));
    console.log(`UI: ${webUrl(config)}`);
    console.log(`Data: ${config.dataRoot}`);
    if (parsed.flags.dryRun) console.log(color.yellow("Dry run only; no files or adapter installs were changed."));
  }
}

async function runStatus(parsed) {
  const config = await readConfig();
  const state = await readRuntimeState();
  const currentHealth = await health(config);
  const payload = {
    ok: currentHealth.ok,
    running: currentHealth.ok,
    mode: config.mode,
    baseUrl: baseUrl(config),
    webUrl: webUrl(config),
    dataRoot: config.dataRoot,
    adapters: config.adapters,
    state
  };
  if (parsed.flags.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`${color.bold("Forge Memory Status")}`);
    console.log(`Runtime: ${currentHealth.ok ? color.green("healthy") : color.yellow("not reachable")}`);
    console.log(`Mode: ${config.mode}`);
    console.log(`UI: ${webUrl(config)}`);
    console.log(`Data: ${config.dataRoot}`);
    console.log(`Adapters: ${config.adapters.length ? config.adapters.join(", ") : "none configured"}`);
    if (state?.logPath) console.log(`Logs: ${state.logPath}`);
  }
}

async function runDoctor(parsed) {
  const config = await readConfig();
  const discovery = discover();
  const checks = [
    { id: "node", ok: Number(process.versions.node.split(".")[0]) >= 22, detail: process.versions.node },
    { id: "config", ok: fs.existsSync(configPath()), detail: configPath() },
    { id: "dataRoot", ok: fs.existsSync(config.dataRoot), detail: config.dataRoot },
    { id: "runtime", ok: (await health(config)).ok, detail: baseUrl(config) },
    ...discovery.adapters.map((adapter) => ({ id: adapter.id, ok: adapter.installed, detail: adapter.status }))
  ];
  const payload = { ok: checks.every((check) => check.ok || ADAPTERS.includes(check.id)), checks };
  if (parsed.flags.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(color.bold("Forge Memory Doctor"));
    for (const check of checks) {
      console.log(`${check.ok ? color.green("ok") : color.yellow("warn")} ${check.id}: ${check.detail}`);
    }
  }
}

async function runUi(parsed) {
  const config = await readConfig();
  if (!parsed.flags.noStart) await startRuntime(config);
  if (parsed.flags.printUrl || parsed.flags.json) {
    console.log(parsed.flags.json ? JSON.stringify({ url: webUrl(config) }, null, 2) : webUrl(config));
    return;
  }
  await open(webUrl(config));
}

async function runPairIos(parsed) {
  const config = await readConfig();
  await startRuntime(config);
  const pairing = await createPairing(config, {
    transportMode: parsed.flags.manualHttp ? "manual-http" : "iroh"
  });
  if (parsed.flags.json) {
    console.log(JSON.stringify(pairing, null, 2));
    return;
  }
  printPairing(pairing);
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

async function runMcp() {
  const config = await readConfig();
  const server = new Server({ name: "forge-memory", version: VERSION }, { capabilities: { tools: {} } });
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
      }
    ]
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "forge_memory_status") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ baseUrl: baseUrl(config), webUrl: webUrl(config), dataRoot: config.dataRoot, identity: sha(config.dataRoot) }, null, 2)
          }
        ]
      };
    }
    if (request.params.name === "forge_memory_health") {
      return { content: [{ type: "text", text: JSON.stringify(await health(config), null, 2) }] };
    }
    throw new Error(`Unknown tool: ${request.params.name}`);
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
  --manual-http         Use direct HTTP/TCP for iOS pairing instead of the default Iroh transport
  --no-start            Configure without starting runtime
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
      console.log(JSON.stringify(await startRuntime(await readConfig()), null, 2));
      break;
    case "stop":
      console.log(JSON.stringify(await stopRuntime(), null, 2));
      break;
    case "export":
      {
        const result = await exportForgeData(parsed);
        console.log(parsed.flags.json ? JSON.stringify(result, null, 2) : `Exported Forge data to ${result.outputPath}`);
      }
      break;
    case "uninstall":
      {
        const result = await uninstallForgeMemory(parsed);
        console.log(parsed.flags.json ? JSON.stringify(result, null, 2) : result.cancelled ? "Uninstall cancelled." : "Forge Memory uninstalled.");
      }
      break;
    case "restart":
      await stopRuntime();
      console.log(JSON.stringify(await startRuntime(await readConfig()), null, 2));
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

main().catch((error) => {
  console.error(color.red(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
